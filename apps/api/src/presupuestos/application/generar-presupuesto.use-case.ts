/**
 * Caso de uso de APLICACIÓN: generar el presupuesto y activar la pre-reserva
 * (UC-14 / US-014) — el nodo de mayor complejidad del camino feliz.
 *
 * Orquesta TRES agregados/capabilities en una sola transacción de BD (all-or-nothing)
 * más un efecto post-commit:
 *   1. `preview(cmd)` — calcula el borrador delegando en el motor de tarifa (US-016).
 *      NO persiste NADA (sin PRESUPUESTO, sin transición, sin bloqueo, sin cola, sin
 *      email). Deriva el desglose fiscal (base/IVA 21%/total) y el reparto 40/60/fianza.
 *   2. `confirmar(cmd)` — en UNA unidad de trabajo (tx + RLS):
 *        a. Crea el PRESUPUESTO congelado (`version=1`, `estado='enviado'`,
 *           `tarifaCongelada=true`, `ivaPorcentaje='21.00'`, desglose fiscal).
 *        b. Transiciona la RESERVA `{2a,2b,2c,2v} → pre_reserva`, `ttl = now() +
 *           ttl_prereserva_dias` (derivado del setting, nunca hardcodeado).
 *        c. Bloqueo `FECHA_BLOQUEADA` insert-o-update en fase `pre_reserva` (blando, 7d)
 *           — serializado por `UNIQUE(tenant_id, fecha)` + `SELECT … FOR UPDATE`; nada
 *           de Redis/locks distribuidos.
 *        d. Vaciado de cola A16 (`2.d → 2.y`, `posicion_cola`/`consulta_bloqueante_id`
 *           a NULL); AUDIT_LOG por cada descartada; SIN emails a la cola (MVP).
 *        e. AUDIT_LOG `transicion` de la principal (`datos_nuevos.estado='pre_reserva'`).
 *      Tras el commit dispara E2 (post-commit, idempotente por `(reserva, E2)`); un
 *      fallo del proveedor NO revierte la pre-reserva.
 *   3. `reenviarE2(...)` — reintento idempotente del E2 (no duplica por (reserva, E2)).
 *
 * Guardas ANTES del motor y de la tx (rechazo sin efectos): origen válido
 * (`{2a,2b,2c,2v}`), datos fiscales completos (CLIENTE + RESERVA). El presupuesto
 * previo y la re-guarda de origen se comprueban DENTRO de la tx bajo el lock para
 * resolver el doble clic / la carrera D4.
 *
 * Hexagonal (hook `no-infra-in-domain`): depende SOLO de puertos inyectados; no
 * importa Prisma ni `@nestjs/*`.
 */
import {
  calcularDesgloseFiscal,
  calcularReparto,
  type DesgloseFiscal,
  type RepartoPago,
} from '../domain/desglose-fiscal';
import { siguienteNumeroPresupuesto } from '../domain/numeracion-presupuesto';
import {
  regimenDesdeMetodoPago,
  esMetodoPagoValido,
  type MetodoPago,
  type RegimenIva,
} from '../domain/regimen-desde-metodo-pago';
import {
  esOrigenValidoParaActivarPrereserva,
  type EstadoReserva,
  type SubEstadoConsulta,
} from '../../reservas/domain/maquina-estados';
import type {
  CalculadoraTarifaService,
  CalculoTarifaResultado,
} from '../../tarifas/domain/calculadora-tarifa.service';

// ---------------------------------------------------------------------------
// Tipos de comando / proyecciones / puertos
// ---------------------------------------------------------------------------

/** Un extra solicitado (snake_case, coherente con el motor de tarifa US-016). */
export interface PresupuestoExtraInput {
  extra_id: string;
  cantidad: number;
}

/** Comando base compartido por preview y confirmar. */
interface ComandoBasePresupuesto {
  /** Tenant del gestor (del JWT, nunca del body/path). */
  tenantId: string;
  /** Identificador del gestor que ejecuta la operación (para auditoría). */
  usuarioId: string;
  /** RESERVA sobre la que se genera el presupuesto (debe existir y ser origen válido). */
  reservaId: string;
  /** Extras a incluir (se pasan al motor de tarifa para sumar subtotales). */
  extras: PresupuestoExtraInput[];
  /** Descuento a restar del total, opcional. */
  descuentoEur?: string;
  /** Justificación del descuento (PRESUPUESTO.descuento_motivo), opcional. */
  descuentoMotivo?: string;
  /** Precio total manual (IVA incluido) del caso `tarifa_a_consultar` (>50 invitados). */
  precioManualEur?: string;
  /**
   * Método de pago elegido por el gestor (OBLIGATORIO en preview y confirmar, 6.2). El
   * régimen fiscal se DERIVA de él (`regimenDesdeMetodoPago`); NUNCA viaja en el comando.
   */
  metodoPago: MetodoPago;
}

/** Comando del preview (no persiste). */
export type PreviewPresupuestoComando = ComandoBasePresupuesto;
/** Comando de la confirmación (crea PRESUPUESTO + activa pre_reserva). */
export type ConfirmarPresupuestoComando = ComandoBasePresupuesto;

/** Proyección de la RESERVA relevante para el presupuesto (origen y datos fiscales). */
export interface ReservaPresupuesto {
  idReserva: string;
  tenantId: string;
  clienteId: string;
  estado: EstadoReserva;
  subEstado: SubEstadoConsulta | null;
  fechaEvento: Date | null;
  duracionHoras: number | null;
  numAdultosNinosMayores4: number | null;
  numNinosMenores4: number | null;
  tipoEvento: string | null;
  ttlExpiracion: Date | null;
}

/** Proyección del CLIENTE con sus datos fiscales (para la validación FA-01). */
export interface ClientePresupuesto {
  idCliente: string;
  tenantId: string;
  nombre: string;
  apellidos: string | null;
  email: string | null;
  telefono: string | null;
  dniNif: string | null;
  direccion: string | null;
  codigoPostal: string | null;
  poblacion: string | null;
  provincia: string | null;
}

/** Reloj inyectable para determinismo (TTL de la pre_reserva). */
export interface ClockPort {
  ahora(): Date;
}

/** Settings del tenant necesarios para el TTL y el reparto (nunca hardcodeados). */
export interface TenantSettingsPresupuesto {
  ttlPrereservaDias: number;
  pctSenal: number;
  fianzaDefaultEur: number;
}

/** Lectura de los settings del tenant (RLS: cross-tenant → null). */
export interface TenantSettingsPresupuestoPort {
  obtener(tenantId: string): Promise<TenantSettingsPresupuesto | null>;
}

/** Datos que se persisten al crear el PRESUPUESTO congelado. */
export interface CrearPresupuestoParams {
  /** Tenant del presupuesto (= el de la reserva); aísla la numeración por tenant. */
  tenantId: string;
  reservaId: string;
  /** Número `AAAANNN` asignado en la tx de confirmación (N1). */
  numeroPresupuesto: string;
  version: number;
  estado: 'enviado';
  tarifaCongelada: true;
  baseImponible: string;
  ivaPorcentaje: string;
  ivaImporte: string;
  total: string;
  descuentoEur: string | null;
  descuentoMotivo: string | null;
  /** Trazabilidad de la TARIFA congelada usada; `null` en el caso a-consultar. */
  tarifaId: string | null;
  /** Método de pago elegido (auditoría / origen del régimen); se persiste (6.2). */
  metodoPago: MetodoPago;
  /** Régimen fiscal derivado del método; discrimina la numeración y el render (6.2). */
  regimenIva: RegimenIva;
}

/** PRESUPUESTO enviado/aceptado previo (para la precondición PRESUPUESTO_YA_EXISTE). */
export interface PresupuestoPrevio {
  idPresupuesto: string;
  estado: string;
}

/** PRESUPUESTO creado (proyección de vuelta). */
export interface PresupuestoCreado {
  idPresupuesto: string;
  version: number;
  estado: string;
  total: string;
  baseImponible: string;
  ivaPorcentaje: string;
  ivaImporte: string;
  tarifaCongelada: boolean;
  pdfUrl: string | null;
  /** Número `AAAANNN` asignado (6.2 D4: se expone en la respuesta). */
  numeroPresupuesto: string | null;
  /** Régimen fiscal derivado (6.2 D4: se expone en la respuesta). */
  regimenIva: RegimenIva;
}

/** Repositorio tx-bound de PRESUPUESTO. */
export interface PresupuestoRepositoryPort {
  /** Devuelve el PRESUPUESTO enviado/aceptado de la reserva o `null` (precondición). */
  buscarEnviadoOAceptado(params: {
    tenantId: string;
    reservaId: string;
  }): Promise<PresupuestoPrevio | null>;
  /**
   * Último `numero_presupuesto` del tenant en el año dado y RÉGIMEN dado (para calcular el
   * siguiente), o `null` si no hay ninguno (N1). El año va embebido en el literal
   * `AAAANNN`; el `regimen` discrimina la doble secuencia (6.2, D2 Opción A): CON y SIN
   * mantienen contadores independientes que pueden compartir el mismo literal.
   */
  ultimoNumeroDelAnio(
    tenantId: string,
    anio: number,
    regimen: RegimenIva,
  ): Promise<string | null>;
  /** Crea el PRESUPUESTO congelado (version 1, enviado) con su número asignado. */
  crear(params: CrearPresupuestoParams): Promise<PresupuestoCreado>;
}

/** Parámetros de la transición de la RESERVA a `pre_reserva`. */
export interface TransicionarAPrereservaParams {
  idReserva: string;
  ttlExpiracion: Date;
}

/** Repositorio tx-bound de la RESERVA: aplica la transición a `pre_reserva`. */
export interface ReservaPrereservaRepositoryPort {
  transicionarAPrereserva(params: TransicionarAPrereservaParams): Promise<void>;
}

/** Repositorio tx-bound del bloqueo de fecha (insert-o-update, fase `pre_reserva`). */
export interface FechaBloqueadaPrereservaRepositoryPort {
  /**
   * Insert-o-update del bloqueo blando de `(tenant, fecha)` a `now()+ttlPrereservaDias`:
   * INSERT si no había fila (origen `2.a`), UPDATE del TTL si ya existía
   * (`2.b`/`2.c`/`2.v`). Serializado por `SELECT … FOR UPDATE` + `UNIQUE(tenant,fecha)`.
   */
  bloquearInsertOUpdate(params: {
    tenantId: string;
    fecha: Date;
    reservaId: string;
    ttlExpiracion: Date;
  }): Promise<void>;
}

/** Repositorio tx-bound del vaciado de cola A16 (`2.d → 2.y`). */
export interface ColaPrereservaRepositoryPort {
  /**
   * UPDATE masivo de las RESERVA `2.d` que apuntan a la bloqueante: pasan a `2.y`
   * (terminal) con `posicion_cola=NULL` y `consulta_bloqueante_id=NULL`. Devuelve los
   * ids descartados para que el caso de uso audite cada descarte (una entrada de
   * AUDIT_LOG por descartada) y calcule el recuento.
   */
  vaciar(params: {
    tenantId: string;
    consultaBloqueanteId: string;
  }): Promise<{ descartadas: ReadonlyArray<string> }>;
}

/** Registro de auditoría de la transición (principal o descartada). */
export interface RegistroAuditoriaPrereserva {
  tenantId: string;
  usuarioId?: string | null;
  entidad?: string;
  entidadId?: string;
  accion: 'transicion';
  datosAnteriores?: Record<string, unknown>;
  datosNuevos?: Record<string, unknown>;
}

/** Repositorio tx-bound de AUDIT_LOG. */
export interface AuditoriaPrereservaPort {
  registrar(registro: RegistroAuditoriaPrereserva): Promise<void>;
}

/** Conjunto de repositorios disponibles dentro de la unidad de trabajo. */
export interface RepositoriosActivarPrereserva {
  presupuestos: PresupuestoRepositoryPort;
  reservas: ReservaPrereservaRepositoryPort;
  fechaBloqueada: FechaBloqueadaPrereservaRepositoryPort;
  cola: ColaPrereservaRepositoryPort;
  auditoria: AuditoriaPrereservaPort;
}

/**
 * Unidad de trabajo transaccional. El adaptador envuelve `$transaction` +
 * `fijarTenant(tenantId)` (RLS) y expone los repositorios tx-bound. Si el `trabajo`
 * rechaza, la transacción revierte por completo (all-or-nothing).
 */
export interface UnidadDeTrabajoActivarPrereservaPort {
  ejecutar(
    tenantId: string,
    trabajo: (repos: RepositoriosActivarPrereserva) => Promise<unknown>,
  ): Promise<unknown>;
}

/**
 * Puerto de disparo del E2 POST-COMMIT (adaptador que reutiliza el motor de email de
 * US-045). Idempotente por `(reserva_id, codigo_email=E2)`; un fallo del proveedor no
 * revierte la pre-reserva. En test/CI el transporte va en modo fake.
 */
export interface DispararE2Port {
  disparar(params: {
    tenantId: string;
    reservaId: string;
    pdfUrl: string | null;
    /**
     * Marca de EDICIÓN (derivada en servidor). El primer envío (US-014) NO la pasa:
     * usa el camino idempotente `despachar`. La edición pasa `true` para enrutar por
     * `despacharReenvio` (envío real) y renderizar la variante "presupuesto actualizado".
     */
    esEdicion?: boolean;
  }): Promise<void>;
}

/** Puerto de generación del PDF del presupuesto (infraestructura: Puppeteer/react-pdf). */
export interface GenerarPdfPresupuestoPort {
  (params: {
    tenantId: string;
    reservaId: string;
    idPresupuesto: string;
  }): Promise<string | null>;
}

/**
 * Puerto de PERSISTENCIA de la `pdf_url` en la fila del PRESUPUESTO (best-effort,
 * post-commit). Espejo de `FacturaRepositoryPort.guardarPdfUrl` (US-022): tras generar
 * el PDF fuera de la tx crítica se guarda la URL para que el REENVÍO sin cambios (que lee
 * `vigente.pdfUrl`) disponga del adjunto. Un fallo aquí NO revierte la pre_reserva/versión
 * (el envío usa la URL en memoria igualmente); se traga. Bajo RLS (`fijarTenant`).
 */
export interface GuardarPdfUrlPresupuestoPort {
  (params: {
    tenantId: string;
    idPresupuesto: string;
    pdfUrl: string;
  }): Promise<void>;
}

/** Lectura de la RESERVA (fuera de la tx crítica; RLS: cross-tenant → null). */
export interface CargarReservaPort {
  (params: {
    tenantId: string;
    reservaId: string;
  }): Promise<ReservaPresupuesto | null | undefined>;
}

/** Lectura del CLIENTE de la RESERVA (para la validación fiscal FA-01). */
export interface CargarClientePort {
  (params: {
    tenantId: string;
    clienteId: string;
  }): Promise<ClientePresupuesto | null | undefined>;
}

/** Dependencias del caso de uso (puertos inyectados). */
export interface GenerarPresupuestoDeps {
  motorTarifa: CalculadoraTarifaService;
  unidadDeTrabajo: UnidadDeTrabajoActivarPrereservaPort;
  tenantSettings: TenantSettingsPresupuestoPort;
  cargarReserva: CargarReservaPort;
  cargarCliente: CargarClientePort;
  generarPdf: GenerarPdfPresupuestoPort;
  clock: ClockPort;
  /** Disparo del E2 post-commit (opcional en tests unitarios sin BD). */
  dispararE2?: DispararE2Port;
  /** Persistencia best-effort de `pdf_url` (opcional en tests unitarios sin BD). */
  guardarPdfUrl?: GuardarPdfUrlPresupuestoPort;
}

/** Resultado del preview (no persiste): desglose y reparto o `null` (a-consultar). */
export interface PreviewPresupuestoResultado {
  tarifaAConsultar: boolean;
  tarifa: CalculoTarifaResultado;
  extrasTotalEur: string;
  descuentoEur: string | null;
  desglose: DesgloseFiscal | null;
  reparto: RepartoPago | null;
  /** Régimen fiscal derivado del método de pago (6.2 D4: la UI pinta el badge). */
  regimenIva: RegimenIva;
}

/** Resultado de la confirmación: PRESUPUESTO creado + reparto + descartadas. */
export interface ConfirmarPresupuestoResultado {
  presupuesto: PresupuestoCreado;
  tarifaId: string | null;
  reparto: RepartoPago;
  ttlExpiracion: Date;
  consultasDescartadas: number;
}

// ---------------------------------------------------------------------------
// Errores de dominio tipados, en español (con propiedad `codigo`)
// ---------------------------------------------------------------------------

/** Campo fiscal/de reserva requerido no nulo (para enumerar en FA-01). */
export type CampoFiscalFaltante =
  | 'dniNif'
  | 'direccion'
  | 'codigoPostal'
  | 'poblacion'
  | 'provincia'
  | 'fechaEvento'
  | 'duracionHoras'
  | 'numAdultosNinosMayores4'
  | 'tipoEvento';

/** FA-01: faltan datos fiscales del CLIENTE o datos de la RESERVA. Mapea a 422. */
export class DatosFiscalesIncompletosError extends Error {
  readonly codigo = 'DATOS_FISCALES_INCOMPLETOS' as const;
  readonly camposFaltantes: CampoFiscalFaltante[];

  constructor(camposFaltantes: CampoFiscalFaltante[]) {
    super(
      `Faltan datos para generar el presupuesto: ${camposFaltantes.join(', ')}`,
    );
    this.name = 'DatosFiscalesIncompletosError';
    this.camposFaltantes = camposFaltantes;
  }
}

/** FA-02: `tarifa_a_consultar` (>50) sin `precioManualEur` al confirmar. Mapea a 422. */
export class PrecioManualRequeridoError extends Error {
  readonly codigo = 'PRECIO_MANUAL_REQUERIDO' as const;

  constructor() {
    super(
      'Se requiere un precio manual para confirmar el presupuesto (>50 invitados)',
    );
    this.name = 'PrecioManualRequeridoError';
  }
}

/** La RESERVA no es origen válido para generar/confirmar presupuesto. Mapea a 409. */
export class OrigenInvalidoError extends Error {
  readonly codigo = 'ORIGEN_INVALIDO' as const;
  readonly motivo: string;

  constructor(motivo = 'La reserva no es un origen válido para generar el presupuesto') {
    super(motivo);
    this.name = 'OrigenInvalidoError';
    this.motivo = motivo;
  }
}

/** Ya existe un PRESUPUESTO enviado/aceptado (remite a UC-15). Mapea a 409. */
export class PresupuestoYaExisteError extends Error {
  readonly codigo = 'PRESUPUESTO_YA_EXISTE' as const;
  readonly motivo: string;

  constructor(motivo = 'Ya existe un presupuesto enviado; usa la edición del presupuesto') {
    super(motivo);
    this.name = 'PresupuestoYaExisteError';
    this.motivo = motivo;
  }
}

/**
 * Se agotaron los reintentos de numeración (`UNIQUE(tenant_id, regimen_iva,
 * numero_presupuesto)`, 6.2) — escenario extremadamente improbable de contención
 * sostenida. Es un fallo interno, NO una colisión de fecha: se mapea a 500, nunca a 409
 * "fecha no disponible".
 */
export class NumeracionPresupuestoAgotadaError extends Error {
  readonly codigo = 'NUMERACION_PRESUPUESTO_AGOTADA' as const;

  constructor() {
    super('No se pudo asignar un número de presupuesto único tras varios reintentos');
    this.name = 'NumeracionPresupuestoAgotadaError';
  }
}

/**
 * Falta el método de pago (o es inválido) al generar el presupuesto (6.2, D4). Sin método
 * no hay régimen derivable; se rechaza SIN efectos (ni motor ni persistencia). Mapea a
 * 422/400.
 */
export class MetodoPagoRequeridoError extends Error {
  readonly codigo = 'METODO_PAGO_REQUERIDO' as const;

  constructor() {
    super('El método de pago es obligatorio y debe ser transferencia o efectivo');
    this.name = 'MetodoPagoRequeridoError';
  }
}

/** La RESERVA no existe para el tenant (RLS): cross-tenant es invisible → 404. */
export class ReservaNoEncontradaError extends Error {
  readonly codigo = 'RESERVA_NO_ENCONTRADA' as const;
  readonly reservaId: string;

  constructor(reservaId: string) {
    super('La reserva no existe para el tenant');
    this.name = 'ReservaNoEncontradaError';
    this.reservaId = reservaId;
  }
}

// ---------------------------------------------------------------------------
// Helpers puros
// ---------------------------------------------------------------------------

const DIA_MS = 24 * 60 * 60 * 1000;

/** Máximo de reintentos ante colisión de numeración (`P2002`) en la confirmación (N1). */
const MAX_REINTENTOS_NUMERACION = 10;

/**
 * Índice/constraint y columnas del `UNIQUE(tenant_id, regimen_iva, numero_presupuesto)`
 * (6.2, D2 Opción A) que serializa la doble numeración por tenant, año y RÉGIMEN. Solo un
 * `P2002` sobre ESTE objetivo es reintentable. `meta.target` de Prisma llega como el nombre
 * del índice (string) o como el array de columnas del constraint según versión/driver; se
 * acepta cualquiera de las dos formas. NO se reintenta el `UNIQUE(tenant_id, fecha)` (D4).
 */
const INDICE_NUMERO_PRESUPUESTO =
  'presupuesto_tenant_id_regimen_iva_numero_presupuesto_key';
const COLUMNA_NUMERO_PRESUPUESTO = 'numero_presupuesto';

/** ¿El valor de texto está presente (no nulo/undefined/vacío)? */
const presente = (valor: string | null | undefined): boolean =>
  valor !== null && valor !== undefined && valor.trim() !== '';

/** ¿El error es una violación de unicidad `P2002` de Prisma (con `meta.target`)? */
const esP2002 = (
  error: unknown,
): error is { code: 'P2002'; meta?: { target?: unknown } } =>
  typeof error === 'object' &&
  error !== null &&
  'code' in error &&
  (error as { code?: string }).code === 'P2002';

/**
 * ¿El `P2002` es de la NUMERACIÓN (`UNIQUE(tenant_id, numero_presupuesto)`) y por tanto
 * REINTENTABLE? Discrimina por `meta.target`, que Prisma expone como el nombre del
 * índice (string) o como el array de columnas del constraint según versión/driver. Solo
 * la colisión de numeración se reintenta; cualquier otro `P2002` (en particular el de la
 * fecha D4, `UNIQUE(tenant_id, fecha)` de FECHA_BLOQUEADA) NO se reintenta y propaga.
 */
const esColisionNumeracion = (error: unknown): boolean => {
  if (!esP2002(error)) {
    return false;
  }
  const target = error.meta?.target;
  const objetivos = Array.isArray(target)
    ? target.map(String)
    : typeof target === 'string'
      ? [target]
      : [];
  return objetivos.some(
    (o) => o === INDICE_NUMERO_PRESUPUESTO || o === COLUMNA_NUMERO_PRESUPUESTO,
  );
};

// ---------------------------------------------------------------------------
// Caso de uso
// ---------------------------------------------------------------------------

export class GenerarPresupuestoUseCase {
  constructor(private readonly deps: GenerarPresupuestoDeps) {}

  /**
   * Calcula el borrador editable del presupuesto delegando en el motor de tarifa. NO
   * persiste NADA. Aplica las guardas previas (existencia, origen) ANTES del motor.
   */
  async preview(
    comando: PreviewPresupuestoComando,
  ): Promise<PreviewPresupuestoResultado> {
    // 6.2: método de pago OBLIGATORIO ANTES de cualquier efecto (deriva el régimen).
    const regimen = this.resolverRegimen(comando.metodoPago);
    const { reserva } = await this.cargarYGuardarOrigen(comando);
    const settings = await this.obtenerSettings(comando.tenantId);
    const tarifa = await this.calcularTarifa(reserva, comando);
    return this.componerBorrador(tarifa, comando, settings, regimen);
  }

  /**
   * Confirma el presupuesto: crea el PRESUPUESTO congelado, transiciona la RESERVA a
   * `pre_reserva`, bloquea la fecha (insert-o-update, 7 d), vacía la cola A16 y audita
   * — todo en UNA transacción. Tras el commit dispara el E2 (post-commit, idempotente).
   */
  async confirmar(
    comando: ConfirmarPresupuestoComando,
  ): Promise<ConfirmarPresupuestoResultado> {
    // 6.2: método de pago OBLIGATORIO — se valida ANTES de cualquier efecto (ni motor ni
    // persistencia); de él se deriva el régimen fiscal que gobierna cálculo/render/numeración.
    const regimen = this.resolverRegimen(comando.metodoPago);

    // Guardas previas SIN efectos (existencia 404, origen 409, datos fiscales 422).
    const { reserva, cliente } = await this.cargarYGuardarOrigen(comando);
    this.validarDatosFiscales(reserva, cliente);

    const settings = await this.obtenerSettings(comando.tenantId);

    // Motor de tarifa (delegado). Propaga TARIFA_NO_CONFIGURADA/TEMPORADA_NO_CONFIGURADA.
    const tarifa = await this.calcularTarifa(reserva, comando);

    // FA-02: >50 invitados exige precio manual al confirmar.
    if (tarifa.tarifaAConsultar && !presente(comando.precioManualEur)) {
      throw new PrecioManualRequeridoError();
    }

    const desglose = this.resolverDesglose(tarifa, comando, regimen);
    const reparto = calcularReparto({
      totalConIva: Number(desglose.total),
      pctSenal: settings.pctSenal,
      fianzaDefaultEur: settings.fianzaDefaultEur,
      regimen,
    });
    const ahora = this.deps.clock.ahora();
    const ttlExpiracion = new Date(ahora.getTime() + settings.ttlPrereservaDias * DIA_MS);
    const tarifaId = tarifa.tarifaAConsultar ? null : tarifa.tarifaId;

    // Transacción única (all-or-nothing). Las precondiciones bajo lock (presupuesto
    // previo, re-guarda de origen implícita por el bloqueo) resuelven el doble clic /
    // la carrera D4; cualquier rechazo se propaga para que la UoW revierta. La numeración
    // `AAAANNN` se asigna DENTRO de la tx (N1); ante colisión de unicidad concurrente
    // (`P2002` del `UNIQUE(tenant_id, numero_presupuesto)`) se re-abre la tx recalculando
    // el número (bucle acotado), nunca locks distribuidos.
    const anioEmision = ahora.getUTCFullYear();
    const trabajoConfirmacion = async (
      repos: RepositoriosActivarPrereserva,
    ): Promise<{ presupuesto: PresupuestoCreado; consultasDescartadas: number }> => {
      // Precondición PRESUPUESTO_YA_EXISTE (UC-15) bajo el contexto de la tx.
      const previo = await repos.presupuestos.buscarEnviadoOAceptado({
        tenantId: comando.tenantId,
        reservaId: comando.reservaId,
      });
      if (previo !== null) {
        throw new PresupuestoYaExisteError();
      }

      // Numeración `AAAANNN` por tenant, año y RÉGIMEN (N1 + 6.2 D2): último del año del
      // PROPIO régimen → siguiente (doble secuencia; CON y SIN son independientes).
      const ultimoNumero = await repos.presupuestos.ultimoNumeroDelAnio(
        comando.tenantId,
        anioEmision,
        regimen,
      );
      const numeroPresupuesto = siguienteNumeroPresupuesto({
        anio: anioEmision,
        ultimoNumero,
      });

      // (a) PRESUPUESTO congelado con su número asignado.
      const presupuesto = await repos.presupuestos.crear({
        tenantId: comando.tenantId,
        reservaId: comando.reservaId,
        numeroPresupuesto,
        version: 1,
        estado: 'enviado',
        tarifaCongelada: true,
        baseImponible: desglose.baseImponible,
        ivaPorcentaje: desglose.ivaPorcentaje,
        ivaImporte: desglose.ivaImporte,
        total: desglose.total,
        descuentoEur: presente(comando.descuentoEur) ? comando.descuentoEur! : null,
        descuentoMotivo: presente(comando.descuentoMotivo)
          ? comando.descuentoMotivo!
          : null,
        tarifaId,
        metodoPago: comando.metodoPago,
        regimenIva: regimen,
      });

      // (b) Transición de la RESERVA a pre_reserva (ttl = now()+ttl_prereserva_dias).
      await repos.reservas.transicionarAPrereserva({
        idReserva: comando.reservaId,
        ttlExpiracion,
      });

      // (c) Bloqueo insert-o-update a 7 d (mismo TTL que la RESERVA). El UNIQUE /
      //     FOR UPDATE serializa la carrera D4; una colisión propaga (rollback).
      if (reserva.fechaEvento !== null) {
        await repos.fechaBloqueada.bloquearInsertOUpdate({
          tenantId: comando.tenantId,
          fecha: reserva.fechaEvento,
          reservaId: comando.reservaId,
          ttlExpiracion,
        });
      }

      // (d) Vaciado de cola A16 (2.d → 2.y). Cola vacía → 0 filas. Sin emails a cola.
      const { descartadas } = await repos.cola.vaciar({
        tenantId: comando.tenantId,
        consultaBloqueanteId: comando.reservaId,
      });

      // (e) AUDIT_LOG: principal (→ pre_reserva) + una por cada descartada (2d→2y).
      await repos.auditoria.registrar({
        tenantId: comando.tenantId,
        usuarioId: comando.usuarioId,
        entidad: 'RESERVA',
        entidadId: comando.reservaId,
        accion: 'transicion',
        datosAnteriores: { estado: 'consulta', subEstado: reserva.subEstado },
        datosNuevos: { estado: 'pre_reserva', ttlExpiracion: ttlExpiracion.toISOString() },
      });
      for (const idDescartada of descartadas) {
        await repos.auditoria.registrar({
          tenantId: comando.tenantId,
          usuarioId: comando.usuarioId,
          entidad: 'RESERVA',
          entidadId: idDescartada,
          accion: 'transicion',
          datosAnteriores: { subEstado: '2d' },
          datosNuevos: { subEstado: '2y' },
        });
      }

      return { presupuesto, consultasDescartadas: descartadas.length };
    };

    // Bucle de reintento acotado ante colisión de NUMERACIÓN (P2002 del
    // `UNIQUE(tenant_id, numero_presupuesto)`). Cada intento re-abre la tx recalculando el
    // número desde el último del año. Cualquier OTRO error propaga de inmediato — en
    // particular el P2002 de la fecha D4 (`UNIQUE(tenant_id, fecha)`), que NO debe
    // reintentarse (es "fecha no disponible" → 409) para no interferir con el bloqueo
    // atómico ni acabar mapeado engañosamente como colisión de fecha.
    let salida: { presupuesto: PresupuestoCreado; consultasDescartadas: number } | null =
      null;
    for (let intento = 0; intento < MAX_REINTENTOS_NUMERACION; intento += 1) {
      try {
        salida = (await this.deps.unidadDeTrabajo.ejecutar(
          comando.tenantId,
          trabajoConfirmacion,
        )) as { presupuesto: PresupuestoCreado; consultasDescartadas: number };
        break;
      } catch (error) {
        if (esColisionNumeracion(error)) {
          continue;
        }
        throw error;
      }
    }
    if (salida === null) {
      // Se agotaron los reintentos de numeración (extremadamente improbable). NO se
      // propaga el P2002 de numeración crudo: acabaría mapeado a 409 "fecha no disponible".
      // Se emite un error propio (→ 500) que NO coincide con ese mapeo.
      throw new NumeracionPresupuestoAgotadaError();
    }

    // Post-commit (D-6/D-7, FUERA de la tx crítica): genera el PDF y dispara el E2.
    // Un fallo aquí NO revierte la pre_reserva ya comprometida.
    const pdfUrl = await this.generarPdfPostCommit(comando, salida.presupuesto);
    await this.dispararE2PostCommit(comando, pdfUrl ?? salida.presupuesto.pdfUrl);

    return {
      presupuesto: salida.presupuesto,
      tarifaId,
      reparto,
      ttlExpiracion,
      consultasDescartadas: salida.consultasDescartadas,
    };
  }

  /**
   * Reintento idempotente del E2 (US-045): la idempotencia por
   * `(reserva_id, codigo_email=E2)` garantiza que un segundo disparo NO duplica la
   * COMUNICACION. Sin BD-adjunta (tests unitarios) es un no-op.
   */
  async reenviarE2(params: { tenantId: string; reservaId: string }): Promise<void> {
    if (this.deps.dispararE2 === undefined) {
      return;
    }
    await this.deps.dispararE2.disparar({
      tenantId: params.tenantId,
      reservaId: params.reservaId,
      pdfUrl: null,
    });
  }

  // -------------------------------------------------------------------------
  // Pasos privados
  // -------------------------------------------------------------------------

  /** Carga la RESERVA (404) + su CLIENTE y valida la guarda de origen (409). */
  private async cargarYGuardarOrigen(
    comando: ComandoBasePresupuesto,
  ): Promise<{ reserva: ReservaPresupuesto; cliente: ClientePresupuesto | null }> {
    const reserva = await this.deps.cargarReserva({
      tenantId: comando.tenantId,
      reservaId: comando.reservaId,
    });
    if (reserva === null || reserva === undefined) {
      throw new ReservaNoEncontradaError(comando.reservaId);
    }
    if (!esOrigenValidoParaActivarPrereserva(reserva.estado, reserva.subEstado)) {
      throw new OrigenInvalidoError();
    }
    const cliente =
      (await this.deps.cargarCliente({
        tenantId: comando.tenantId,
        clienteId: reserva.clienteId,
      })) ?? null;
    return { reserva, cliente };
  }

  /** Lee los settings del tenant (nunca hardcodeados). */
  private async obtenerSettings(tenantId: string): Promise<TenantSettingsPresupuesto> {
    const settings = await this.deps.tenantSettings.obtener(tenantId);
    if (settings === null) {
      throw new Error(`No hay TENANT_SETTINGS configurado para el tenant ${tenantId}`);
    }
    return settings;
  }

  /**
   * Invoca el motor de tarifa pasando SOLO `numAdultosNinosMayores4` (los menores de 4
   * son informativos/gratuitos y NO se pasan). Propaga los errores del motor.
   */
  private async calcularTarifa(
    reserva: ReservaPresupuesto,
    comando: ComandoBasePresupuesto,
  ): Promise<CalculoTarifaResultado> {
    return this.deps.motorTarifa.calcular(
      {
        fechaEvento: reserva.fechaEvento as Date,
        duracionHoras: reserva.duracionHoras as number,
        numAdultosNinosMayores4: reserva.numAdultosNinosMayores4 as number,
        extras: comando.extras.map((e) => ({ extraId: e.extra_id, cantidad: e.cantidad })),
      },
      comando.tenantId,
    );
  }

  /**
   * Valida el método de pago (obligatorio, valor del dominio) y deriva el régimen fiscal.
   * Falta o valor inválido → `MetodoPagoRequeridoError` (sin efectos).
   */
  private resolverRegimen(metodoPago: MetodoPago | undefined): RegimenIva {
    if (!esMetodoPagoValido(metodoPago)) {
      throw new MetodoPagoRequeridoError();
    }
    return regimenDesdeMetodoPago(metodoPago);
  }

  /** Compone el borrador del preview (desglose + reparto, o `null` si a-consultar). */
  private componerBorrador(
    tarifa: CalculoTarifaResultado,
    comando: ComandoBasePresupuesto,
    settings: TenantSettingsPresupuesto,
    regimen: RegimenIva,
  ): PreviewPresupuestoResultado {
    const extrasTotalEur = (tarifa.extrasTotalEur ?? 0).toFixed(2);
    const descuentoEur = presente(comando.descuentoEur) ? comando.descuentoEur! : null;

    // tarifa_a_consultar sin precio manual → desglose/reparto null (a completar).
    if (tarifa.tarifaAConsultar && !presente(comando.precioManualEur)) {
      return {
        tarifaAConsultar: true,
        tarifa,
        extrasTotalEur,
        descuentoEur,
        desglose: null,
        reparto: null,
        regimenIva: regimen,
      };
    }

    const desglose = this.resolverDesglose(tarifa, comando, regimen);
    const reparto = calcularReparto({
      totalConIva: Number(desglose.total),
      pctSenal: settings.pctSenal,
      fianzaDefaultEur: settings.fianzaDefaultEur,
      regimen,
    });
    return {
      tarifaAConsultar: tarifa.tarifaAConsultar,
      tarifa,
      extrasTotalEur,
      descuentoEur,
      desglose,
      reparto,
      regimenIva: regimen,
    };
  }

  /**
   * Deriva el desglose fiscal: en el caso normal desde `totalEur` del motor (IVA
   * incluido) menos el descuento; en el caso `tarifa_a_consultar` desde el precio
   * manual (IVA incluido).
   */
  private resolverDesglose(
    tarifa: CalculoTarifaResultado,
    comando: ComandoBasePresupuesto,
    regimen: RegimenIva,
  ): DesgloseFiscal {
    const totalConIva = tarifa.tarifaAConsultar
      ? Number(comando.precioManualEur)
      : (tarifa.totalEur ?? 0);
    return calcularDesgloseFiscal({
      totalConIva,
      regimen,
      ...(presente(comando.descuentoEur)
        ? { descuentoEur: Number(comando.descuentoEur) }
        : {}),
    });
  }

  /** Valida datos fiscales del CLIENTE + datos de la RESERVA; enumera los faltantes. */
  private validarDatosFiscales(
    reserva: ReservaPresupuesto,
    cliente: ClientePresupuesto | null,
  ): void {
    const faltantes: CampoFiscalFaltante[] = [];

    if (!presente(cliente?.dniNif)) faltantes.push('dniNif');
    if (!presente(cliente?.direccion)) faltantes.push('direccion');
    if (!presente(cliente?.codigoPostal)) faltantes.push('codigoPostal');
    if (!presente(cliente?.poblacion)) faltantes.push('poblacion');
    if (!presente(cliente?.provincia)) faltantes.push('provincia');

    if (reserva.fechaEvento === null) faltantes.push('fechaEvento');
    if (reserva.duracionHoras === null) faltantes.push('duracionHoras');
    if (
      reserva.numAdultosNinosMayores4 === null ||
      reserva.numAdultosNinosMayores4 < 1
    ) {
      faltantes.push('numAdultosNinosMayores4');
    }
    if (!presente(reserva.tipoEvento)) faltantes.push('tipoEvento');

    if (faltantes.length > 0) {
      throw new DatosFiscalesIncompletosError(faltantes);
    }
  }

  /**
   * Genera el PDF del presupuesto post-commit (D-6) y PERSISTE su `pdf_url` en la fila
   * (best-effort) para que el REENVÍO sin cambios disponga del adjunto. Un fallo (de la
   * generación o de la persistencia) se traga: NO revierte la pre_reserva ya comprometida
   * y el envío usa la URL en memoria igualmente.
   */
  private async generarPdfPostCommit(
    comando: ConfirmarPresupuestoComando,
    presupuesto: PresupuestoCreado,
  ): Promise<string | null> {
    let pdfUrl: string | null;
    try {
      pdfUrl = await this.deps.generarPdf({
        tenantId: comando.tenantId,
        reservaId: comando.reservaId,
        idPresupuesto: presupuesto.idPresupuesto,
      });
    } catch {
      return null;
    }
    if (pdfUrl !== null) {
      await this.persistirPdfUrl(comando.tenantId, presupuesto.idPresupuesto, pdfUrl);
    }
    return pdfUrl;
  }

  /** Persiste `pdf_url` en la fila del PRESUPUESTO (best-effort; un fallo NO propaga). */
  private async persistirPdfUrl(
    tenantId: string,
    idPresupuesto: string,
    pdfUrl: string,
  ): Promise<void> {
    if (this.deps.guardarPdfUrl === undefined) {
      return;
    }
    try {
      await this.deps.guardarPdfUrl({ tenantId, idPresupuesto, pdfUrl });
    } catch {
      // Best-effort: si no se puede persistir la URL no se revierte nada (el envío usa
      // la URL en memoria); el reenvío defensivo regenerará el PDF si `pdf_url` sigue null.
    }
  }

  /** Dispara el E2 post-commit (idempotente). Sin puerto configurado → no-op. */
  private async dispararE2PostCommit(
    comando: ConfirmarPresupuestoComando,
    pdfUrl: string | null,
  ): Promise<void> {
    if (this.deps.dispararE2 === undefined) {
      return;
    }
    await this.deps.dispararE2.disparar({
      tenantId: comando.tenantId,
      reservaId: comando.reservaId,
      pdfUrl,
    });
  }
}
