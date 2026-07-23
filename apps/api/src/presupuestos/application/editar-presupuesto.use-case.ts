/**
 * Caso de uso de APLICACIÓN: EDITAR y REENVIAR el presupuesto en `pre_reserva`
 * (UC-15 / US-015).
 *
 * Dos casos de uso relacionados:
 *   - `EditarPresupuestoUseCase` (`preview`/`confirmar`): recalcula el borrador de la
 *     edición (sin persistir) y, al confirmar, crea una NUEVA versión de PRESUPUESTO
 *     (`version = MAX(version) + 1`, inmutable; la anterior persiste como historial),
 *     materializa las líneas `RESERVA_EXTRA` con el `precio_unitario` CONGELADO al
 *     añadir, recalcula el desglose fiscal por régimen (reutiliza el motor de tarifa
 *     de US-016 y `calcularDesgloseFiscal`/`calcularReparto` de US-014) y —si
 *     `enviar=true`— consume un `numero_presupuesto` `AAAANNN` nuevo, registra la
 *     COMUNICACION E2 (`es_reenvio=true`) y el AUDIT_LOG (`accion='actualizar'`). Con
 *     `enviar=false` la versión queda en `borrador`, `numero_presupuesto=null`, sin
 *     COMUNICACION ni email.
 *   - `ReenviarPresupuestoUseCase` (`ejecutar`): reenvío SIN cambios de la versión
 *     vigente (`MAX(version)`). NO versiona ni consume número; solo registra la
 *     COMUNICACION E2 (`es_reenvio=true`) + AUDIT_LOG y reenvía el PDF vigente
 *     (patrón US-023/US-028). Intencionadamente NO expone puertos de versión/
 *     numeración/UoW.
 *
 * Invariantes (design.md §D5): la edición/reenvío NO muta `RESERVA.estado` (sigue
 * `pre_reserva`) ni `FECHA_BLOQUEADA.ttl_expiracion` (UC-15 no extiende el bloqueo);
 * por eso los repositorios de la UoW NO exponen puertos de RESERVA ni de bloqueo de
 * fecha. Concurrencia (design.md §D2.5): reintento acotado ante `P2002` sobre
 * `@@unique([reservaId, version])` recalculando `MAX+1` (sin locks distribuidos).
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
  esEstadoValidoParaEditarPresupuesto,
  type EstadoReserva,
  type SubEstadoConsulta,
} from '../../reservas/domain/maquina-estados';
import type {
  CalculadoraTarifaService,
  CalculoTarifaResultado,
} from '../../tarifas/domain/calculadora-tarifa.service';
import type { GuardarPdfUrlPresupuestoPort } from './generar-presupuesto.use-case';

// ---------------------------------------------------------------------------
// Tipos de comando / entrada
// ---------------------------------------------------------------------------

/**
 * Una línea de extra propuesta en la edición (camelCase del contrato de negocio).
 * El body NUNCA dicta el `precioUnitario`: el server lo CONGELA con el precio actual
 * del EXTRA del catálogo (líneas nuevas) o conserva el congelado (líneas existentes,
 * identificadas por `id_reserva_extra`).
 */
export interface EdicionExtraInput {
  /** Id de la línea `RESERVA_EXTRA` existente (conserva su precio congelado). */
  id_reserva_extra?: string;
  /** Id del EXTRA del catálogo del tenant (línea de catálogo). */
  extra_id?: string;
  /** Descripción de un extra fuera de catálogo (`extra_id` nulo). */
  concepto_libre?: string;
  cantidad: number;
}

/** Comando base compartido por preview y confirmar. */
interface ComandoBaseEdicion {
  /** Tenant del gestor (del JWT, nunca del body/path). */
  tenantId: string;
  /** Gestor que ejecuta la operación (para auditoría). */
  usuarioId: string;
  /** RESERVA en `pre_reserva` sobre la que se edita el presupuesto. */
  reservaId: string;
  /** Método de pago elegido (deriva el régimen fiscal; obligatorio). */
  metodoPago: MetodoPago;
  /** Conjunto propuesto de líneas de extras (sustituye el conjunto vivo). */
  extras: EdicionExtraInput[];
  /** Nuevo nº de invitados (adultos + niños > 4); si cambia recalcula la tarifa. */
  numAdultosNinosMayores4?: number;
  /** Nueva duración del evento en horas (`{4,8,12}`); si cambia recalcula la tarifa. */
  duracionHoras?: number;
  /** Descuento a restar del total (>= 0 y <= base_imponible). */
  descuentoEur?: string;
  /** Justificación del descuento, opcional. */
  descuentoMotivo?: string;
  /** Precio total manual (IVA incluido) del caso `tarifa_a_consultar` (>50). */
  precioManualEur?: string;
}

/** Comando del preview de edición (no persiste). */
export type EditarPresupuestoPreviewComando = ComandoBaseEdicion;

/** Comando de la confirmación de edición (crea nueva versión). */
export interface EditarPresupuestoConfirmarComando extends ComandoBaseEdicion {
  /** `true` ⇒ `enviado` + número + E2; `false` ⇒ `borrador` sin email. */
  enviar: boolean;
}

/** Comando del reenvío sin cambios (opera sobre la versión vigente). */
export interface ReenviarPresupuestoComando {
  tenantId: string;
  usuarioId: string;
  reservaId: string;
}

// ---------------------------------------------------------------------------
// Proyecciones de lectura
// ---------------------------------------------------------------------------

/** Proyección de la RESERVA en `pre_reserva` relevante para la edición. */
export interface ReservaEdicion {
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

/** Proyección del PRESUPUESTO VIGENTE (`MAX(version)`) de la RESERVA. */
export interface PresupuestoVigente {
  idPresupuesto: string;
  reservaId: string;
  version: number;
  estado: string;
  numeroPresupuesto: string | null;
  metodoPago: MetodoPago | null;
  regimenIva: RegimenIva | null;
  baseImponible: string;
  ivaPorcentaje: string;
  ivaImporte: string;
  total: string;
  descuentoEur: string | null;
  descuentoMotivo: string | null;
  tarifaId: string | null;
  pdfUrl: string | null;
}

/** Un EXTRA del catálogo del tenant (precio ACTUAL, para congelar líneas nuevas). */
export interface ExtraCatalogo {
  idExtra: string;
  precioEur: number;
  activo: boolean;
}

/** Una línea `RESERVA_EXTRA` YA existente (conjunto vivo ligado a la RESERVA). */
export interface LineaExtraExistente {
  idReservaExtra: string;
  extraId: string | null;
  conceptoLibre: string | null;
  cantidad: number;
  /** Precio congelado en su día (inmune a cambios de catálogo). */
  precioUnitario: string;
  subtotal: string;
  origen: string;
  facturaId: string | null;
}

/** Reloj inyectable para determinismo. */
export interface ClockPort {
  ahora(): Date;
}

/** Settings del tenant necesarios para el reparto (nunca hardcodeados). */
export interface TenantSettingsPresupuesto {
  ttlPrereservaDias: number;
  pctSenal: number;
  fianzaDefaultEur: number;
}

/** Lectura de los settings del tenant (RLS: cross-tenant → null). */
export interface TenantSettingsPresupuestoPort {
  obtener(tenantId: string): Promise<TenantSettingsPresupuesto | null>;
}

// ---------------------------------------------------------------------------
// Puertos de lectura (fuera de la tx crítica; RLS: cross-tenant → null)
// ---------------------------------------------------------------------------

/** Lectura de la RESERVA (RLS: cross-tenant → null). */
export interface CargarReservaEdicionPort {
  (params: {
    tenantId: string;
    reservaId: string;
  }): Promise<ReservaEdicion | null | undefined>;
}

/** Lectura del PRESUPUESTO vigente (`MAX(version)`) de la RESERVA. */
export interface CargarPresupuestoVigentePort {
  (params: {
    tenantId: string;
    reservaId: string;
  }): Promise<PresupuestoVigente | null | undefined>;
}

/** Lectura de un EXTRA del catálogo del tenant por id (RLS: cross-tenant → null). */
export interface CargarExtraCatalogoPort {
  (params: {
    tenantId: string;
    extraId: string;
  }): Promise<ExtraCatalogo | null | undefined>;
}

/** Lectura del conjunto vivo de líneas `RESERVA_EXTRA` de la RESERVA. */
export interface CargarLineasExistentesPort {
  (params: {
    tenantId: string;
    reservaId: string;
  }): Promise<LineaExtraExistente[]>;
}

/** Puerto de (re)generación del PDF de la versión. */
export interface GenerarPdfEdicionPort {
  (params: {
    tenantId: string;
    reservaId: string;
    idPresupuesto: string;
  }): Promise<string | null>;
}

/**
 * Disparo del E2 POST-COMMIT (adaptador que reutiliza el motor de email US-045).
 * Idempotente/es_reenvio; un fallo del proveedor NO revierte la nueva versión.
 */
export interface DispararE2EdicionPort {
  disparar(params: {
    tenantId: string;
    reservaId: string;
    pdfUrl: string | null;
    /**
     * Marca de EDICIÓN (D1/D2): cuando el disparo proviene de una edición con envío,
     * el adaptador enruta por `despacharReenvio` (envío real, no idempotente) y propaga
     * la marca hasta el render de E2 ("presupuesto actualizado").
     */
    esEdicion?: boolean;
    /** Número `AAAANNN` del presupuesto (para el nombre del adjunto PDF del email E2). */
    numeroPresupuesto?: string | null;
  }): Promise<void>;
}

// ---------------------------------------------------------------------------
// Puertos tx-bound (dentro de la unidad de trabajo)
// ---------------------------------------------------------------------------

/** Datos que se persisten al crear la NUEVA versión de PRESUPUESTO. */
export interface CrearVersionParams {
  tenantId: string;
  reservaId: string;
  version: number;
  estado: 'enviado' | 'borrador';
  tarifaCongelada: true;
  numeroPresupuesto: string | null;
  baseImponible: string;
  ivaPorcentaje: string;
  ivaImporte: string;
  total: string;
  descuentoEur: string | null;
  descuentoMotivo: string | null;
  tarifaId: string | null;
  metodoPago: MetodoPago;
  regimenIva: RegimenIva;
  pdfUrl: string | null;
}

/** PRESUPUESTO creado (proyección de vuelta). */
export interface PresupuestoVersionCreada {
  idPresupuesto: string;
  version: number;
  estado: string;
  numeroPresupuesto: string | null;
  total: string;
  baseImponible: string;
  ivaPorcentaje: string;
  ivaImporte: string;
  tarifaCongelada: boolean;
  pdfUrl: string | null;
  regimenIva: RegimenIva;
}

/** Repositorio tx-bound de PRESUPUESTO (versionado). */
export interface PresupuestoVersionRepositoryPort {
  /** MAX(version) actual de la RESERVA (para calcular version = MAX+1). */
  versionMaxima(params: { tenantId: string; reservaId: string }): Promise<number>;
  /** Último `numero_presupuesto` del año y RÉGIMEN (numeración por envío). */
  ultimoNumeroDelAnio(
    tenantId: string,
    anio: number,
    regimen: RegimenIva,
  ): Promise<string | null>;
  /** Crea la NUEVA fila de PRESUPUESTO (version=MAX+1, inmutable). */
  crearVersion(params: CrearVersionParams): Promise<PresupuestoVersionCreada>;
}

/** Una línea `RESERVA_EXTRA` a materializar (conjunto vivo). */
export interface LineaExtraAMaterializar {
  /** Id de la línea existente a conservar (null si es nueva). */
  idReservaExtra: string | null;
  extraId: string | null;
  conceptoLibre: string | null;
  cantidad: number;
  precioUnitario: string;
  subtotal: string;
  origen: string;
  facturaId: string | null;
}

/** Repositorio tx-bound de líneas `RESERVA_EXTRA` (conjunto vivo). */
export interface ExtrasRepositoryPort {
  /**
   * Reemplaza el conjunto de líneas `RESERVA_EXTRA` de la RESERVA por el nuevo
   * conjunto (añadir/quitar/modificar). Devuelve las líneas resultantes.
   */
  reemplazarLineas(params: {
    tenantId: string;
    reservaId: string;
    lineas: LineaExtraAMaterializar[];
  }): Promise<{ lineas: unknown[] }>;
}

/**
 * COMUNICACION E2 de reenvío proyectada (respuesta HTTP optimista). La fila real la
 * escribe el motor de email post-commit (`despacharReenvio`), fuente única (D1): la
 * edición/reenvío YA NO persiste una segunda fila COMUNICACION dentro de la tx.
 */
export interface ComunicacionE2Reenvio {
  idComunicacion: string;
  codigoEmail: string;
  estado: string;
  esReenvio: boolean;
}

/** Registro de auditoría de la edición/reenvío. */
export interface RegistroAuditoriaEdicion {
  tenantId: string;
  usuarioId?: string | null;
  entidad: string;
  entidadId: string;
  accion: 'actualizar';
  datosAnteriores?: Record<string, unknown>;
  datosNuevos?: Record<string, unknown>;
}

/** Repositorio tx-bound de AUDIT_LOG. */
export interface AuditoriaEdicionPort {
  registrar(registro: RegistroAuditoriaEdicion): Promise<void>;
}

/**
 * Conjunto de repositorios disponibles dentro de la unidad de trabajo. NO incluye
 * COMUNICACION: la fila E2 la escribe el motor de email post-commit (fuente única D1),
 * nunca dentro de la tx de edición (evita el doble-registro).
 */
export interface ReposEditarPresupuesto {
  presupuestos: PresupuestoVersionRepositoryPort;
  extras: ExtrasRepositoryPort;
  auditoria: AuditoriaEdicionPort;
}

/**
 * Unidad de trabajo transaccional de la edición. El adaptador envuelve
 * `$transaction` + `fijarTenant(tenantId)` (RLS) y expone los repositorios tx-bound.
 * Si el `trabajo` rechaza, la transacción revierte por completo (all-or-nothing).
 * NO expone puertos de RESERVA ni de bloqueo de fecha (invariante §D5).
 */
export interface UnidadDeTrabajoEditarPresupuestoPort {
  ejecutar(
    tenantId: string,
    trabajo: (repos: ReposEditarPresupuesto) => Promise<unknown>,
  ): Promise<unknown>;
}

/** Dependencias del caso de uso de EDICIÓN (puertos inyectados). */
export interface EditarPresupuestoDeps {
  motorTarifa: CalculadoraTarifaService;
  unidadDeTrabajo: UnidadDeTrabajoEditarPresupuestoPort;
  tenantSettings: TenantSettingsPresupuestoPort;
  cargarReserva: CargarReservaEdicionPort;
  cargarPresupuestoVigente: CargarPresupuestoVigentePort;
  cargarExtraCatalogo: CargarExtraCatalogoPort;
  cargarLineasExistentes: CargarLineasExistentesPort;
  generarPdf: GenerarPdfEdicionPort;
  clock: ClockPort;
  /** Disparo del E2 post-commit (opcional en tests unitarios sin BD). */
  dispararE2?: DispararE2EdicionPort;
  /** Persistencia best-effort de `pdf_url` de la v2 (opcional en tests sin BD). */
  guardarPdfUrl?: GuardarPdfUrlPresupuestoPort;
}

/**
 * Puerto de reenvío del E2 (post-commit) del reenvío sin cambios. Distinto del
 * disparo de la edición: aquí no hay versión nueva, solo se reenvía el PDF vigente.
 */
export interface ReenviarE2Port {
  (params: Record<string, unknown>): Promise<void>;
}

/**
 * Dependencias del caso de uso de REENVÍO SIN CAMBIOS. Intencionadamente NO expone
 * puertos de versión/numeración/UoW (D2.4): el reenvío jamás versiona ni consume
 * número. Los puertos de registro aceptan `Record<string, unknown>` para que los
 * adaptadores (Prisma) los implementen con libertad; el use-case pasa objetos
 * estructurados (tipados por construcción).
 */
export interface ReenviarPresupuestoDeps {
  cargarReserva: CargarReservaEdicionPort;
  cargarPresupuestoVigente: CargarPresupuestoVigentePort;
  reenviarE2: ReenviarE2Port;
  registrarE2Reenvio(params: Record<string, unknown>): Promise<ComunicacionE2Reenvio>;
  registrarAuditoria(registro: Record<string, unknown>): Promise<void>;
  clock: ClockPort;
  /**
   * (Re)generación del PDF del presupuesto vigente (best-effort, opcional). Se usa para
   * presupuestos HISTÓRICOS previos al fix de persistencia de `pdf_url`: si el vigente no
   * tiene `pdf_url` (null), se regenera antes de despachar para que el reenvío siga
   * llevando adjunto. Sin puerto configurado (tests sin BD) → se reenvía con el
   * `pdf_url` vigente tal cual.
   */
  generarPdf?: GenerarPdfEdicionPort;
}

// ---------------------------------------------------------------------------
// Resultados
// ---------------------------------------------------------------------------

/** Resultado del preview de edición (no persiste). */
export interface EditarPresupuestoPreviewResultado {
  tarifaAConsultar: boolean;
  tarifa: CalculoTarifaResultado;
  extrasTotalEur: string;
  descuentoEur: string | null;
  desglose: DesgloseFiscal | null;
  reparto: RepartoPago | null;
  regimenIva: RegimenIva;
  lineasExtras: LineaExtraAMaterializar[];
}

/** Resultado de la confirmación de edición: nueva versión + reparto + líneas. */
export interface EditarPresupuestoConfirmarResultado {
  presupuesto: PresupuestoVersionCreada;
  tarifaId: string | null;
  reparto: RepartoPago;
  lineasExtras: unknown[];
  comunicacion: ComunicacionE2Reenvio | null;
}

/** Resultado del reenvío sin cambios: PRESUPUESTO vigente + COMUNICACION E2. */
export interface ReenviarPresupuestoResultado {
  presupuesto: PresupuestoVigente;
  comunicacion: ComunicacionE2Reenvio;
}

// ---------------------------------------------------------------------------
// Errores de dominio tipados, en español (con propiedad `codigo`)
// ---------------------------------------------------------------------------

/** El PRESUPUESTO vigente está `aceptado`/`rechazado` (no editable). Mapea a 409. */
export class PresupuestoNoEditableError extends Error {
  readonly codigo = 'PRESUPUESTO_NO_EDITABLE' as const;
  readonly motivo: string;

  constructor(
    motivo = 'El presupuesto vigente no es editable (aceptado o rechazado)',
  ) {
    super(motivo);
    this.name = 'PresupuestoNoEditableError';
    this.motivo = motivo;
  }
}

/** La RESERVA no está en `pre_reserva` (guarda de estado). Mapea a 409. */
export class ReservaFueraDePrereservaError extends Error {
  readonly codigo = 'RESERVA_FUERA_DE_PRERESERVA' as const;
  readonly motivo: string;

  constructor(motivo = 'La reserva no está en estado pre_reserva') {
    super(motivo);
    this.name = 'ReservaFueraDePrereservaError';
    this.motivo = motivo;
  }
}

/** `tarifa_a_consultar` (>50) sin `precioManualEur` al confirmar. Mapea a 422. */
export class PrecioManualRequeridoError extends Error {
  readonly codigo = 'PRECIO_MANUAL_REQUERIDO' as const;

  constructor() {
    super(
      'Se requiere un precio manual para confirmar el presupuesto (>50 invitados)',
    );
    this.name = 'PrecioManualRequeridoError';
  }
}

/** `descuento_eur` inválido (< 0 o > base_imponible). Mapea a 422. */
export class DescuentoInvalidoError extends Error {
  readonly codigo = 'DESCUENTO_INVALIDO' as const;

  constructor(
    motivo = 'El descuento debe ser >= 0 y <= la base imponible calculada',
  ) {
    super(motivo);
    this.name = 'DescuentoInvalidoError';
  }
}

/** `duracion_horas` fuera de `{4,8,12}`. Mapea a 422. */
export class DuracionInvalidaError extends Error {
  readonly codigo = 'DURACION_INVALIDA' as const;

  constructor(motivo = 'La duración debe ser 4, 8 o 12 horas') {
    super(motivo);
    this.name = 'DuracionInvalidaError';
  }
}

/** No hay un PRESUPUESTO vigente que editar/reenviar. Mapea a 404. */
export class PresupuestoVigenteNoEncontradoError extends Error {
  readonly codigo = 'PRESUPUESTO_VIGENTE_NO_ENCONTRADO' as const;

  constructor(motivo = 'No existe un presupuesto vigente que reenviar') {
    super(motivo);
    this.name = 'PresupuestoVigenteNoEncontradoError';
  }
}

/** La RESERVA no existe para el tenant (RLS): cross-tenant invisible → 404. */
export class ReservaNoEncontradaError extends Error {
  readonly codigo = 'RESERVA_NO_ENCONTRADA' as const;
  readonly reservaId: string;

  constructor(reservaId: string) {
    super('La reserva no existe para el tenant');
    this.name = 'ReservaNoEncontradaError';
    this.reservaId = reservaId;
  }
}

/** Falta/es inválido el método de pago (sin él no hay régimen). Mapea a 422/400. */
export class MetodoPagoRequeridoError extends Error {
  readonly codigo = 'METODO_PAGO_REQUERIDO' as const;

  constructor() {
    super('El método de pago es obligatorio y debe ser transferencia o efectivo');
    this.name = 'MetodoPagoRequeridoError';
  }
}

// ---------------------------------------------------------------------------
// Helpers puros
// ---------------------------------------------------------------------------

const DURACIONES_VALIDAS: readonly number[] = [4, 8, 12];
const MAX_REINTENTOS_VERSION = 10;
const ORIGEN_POST_CONFIRMACION = 'anadido_post_confirmacion';

/** Índice/columnas del `@@unique([reservaId, version])` — colisión reintentable. */
const INDICE_RESERVA_VERSION = 'presupuesto_reserva_id_version_key';
const COLUMNAS_RESERVA_VERSION = ['reservaId', 'version'];

/** ¿El valor de texto está presente (no nulo/undefined/vacío)? */
const presente = (valor: string | null | undefined): boolean =>
  valor !== null && valor !== undefined && valor.trim() !== '';

/** Formatea un número EUR a Decimal string de 2 decimales. */
const aDecimal2 = (valor: number): string => valor.toFixed(2);

/** ¿El error es una violación de unicidad `P2002` de Prisma (con `meta.target`)? */
const esP2002 = (
  error: unknown,
): error is { code: 'P2002'; meta?: { target?: unknown } } =>
  typeof error === 'object' &&
  error !== null &&
  'code' in error &&
  (error as { code?: string }).code === 'P2002';

/**
 * ¿El `P2002` es del `@@unique([reservaId, version])` y por tanto REINTENTABLE?
 * Discrimina por `meta.target` (nombre del índice string o array de columnas según
 * versión/driver). Cualquier otro `P2002` propaga (rollback).
 */
const esColisionVersion = (error: unknown): boolean => {
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
    (o) => o === INDICE_RESERVA_VERSION || COLUMNAS_RESERVA_VERSION.includes(o),
  );
};

// ---------------------------------------------------------------------------
// Caso de uso: EDICIÓN
// ---------------------------------------------------------------------------

export class EditarPresupuestoUseCase {
  constructor(private readonly deps: EditarPresupuestoDeps) {}

  /**
   * Recalcula el borrador de la edición delegando en el motor de tarifa. NO persiste
   * NADA. Aplica las guardas previas (existencia, estado, presupuesto editable,
   * validaciones) ANTES del motor.
   */
  async preview(
    comando: EditarPresupuestoPreviewComando,
  ): Promise<EditarPresupuestoPreviewResultado> {
    const regimen = this.resolverRegimen(comando.metodoPago);
    this.validarDuracion(comando);
    const { reserva } = await this.cargarYGuardar(comando);
    const settings = await this.obtenerSettings(comando.tenantId);

    const lineasExistentes = await this.deps.cargarLineasExistentes({
      tenantId: comando.tenantId,
      reservaId: comando.reservaId,
    });
    const lineas = await this.resolverLineasExtras(comando, lineasExistentes);
    const extrasTotalEur = aDecimal2(
      lineas.reduce((suma, l) => suma + Number(l.subtotal), 0),
    );

    const tarifa = await this.calcularTarifa(reserva, comando);
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
        lineasExtras: lineas,
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
      lineasExtras: lineas,
    };
  }

  /**
   * Confirma la edición: crea una NUEVA versión de PRESUPUESTO (`MAX+1`, inmutable),
   * materializa las líneas `RESERVA_EXTRA` con precio congelado, registra el
   * AUDIT_LOG y —si `enviar`— consume número + registra la COMUNICACION E2 — todo en
   * UNA transacción. Tras el commit dispara el E2 (post-commit, idempotente).
   */
  async confirmar(
    comando: EditarPresupuestoConfirmarComando,
  ): Promise<EditarPresupuestoConfirmarResultado> {
    const regimen = this.resolverRegimen(comando.metodoPago);
    this.validarDuracion(comando);

    // Guardas previas SIN efectos (404 existencia, 409 estado, 409 no editable).
    const { reserva } = await this.cargarYGuardar(comando);
    const settings = await this.obtenerSettings(comando.tenantId);

    const lineasExistentes = await this.deps.cargarLineasExistentes({
      tenantId: comando.tenantId,
      reservaId: comando.reservaId,
    });
    const lineas = await this.resolverLineasExtras(comando, lineasExistentes);

    // Motor de tarifa (delegado). Propaga TARIFA/TEMPORADA_NO_CONFIGURADA.
    const tarifa = await this.calcularTarifa(reserva, comando);

    // >50 invitados exige precio manual al confirmar.
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
    const tarifaId = tarifa.tarifaAConsultar ? null : tarifa.tarifaId;
    const ahora = this.deps.clock.ahora();
    const anioEmision = ahora.getUTCFullYear();
    const estado: 'enviado' | 'borrador' = comando.enviar ? 'enviado' : 'borrador';

    // Transacción única (all-or-nothing). Ante colisión de version (`P2002` del
    // `@@unique([reservaId, version])`) se re-abre la tx recalculando `MAX+1` (bucle
    // acotado). Cualquier OTRO error propaga (rollback). No hay locks distribuidos.
    const trabajo = async (
      repos: ReposEditarPresupuesto,
    ): Promise<{
      presupuesto: PresupuestoVersionCreada;
      lineas: unknown[];
    }> => {
      const maxVersion = await repos.presupuestos.versionMaxima({
        tenantId: comando.tenantId,
        reservaId: comando.reservaId,
      });
      const version = maxVersion + 1;

      // Numeración por ENVÍO: el borrador NO consume número (queda null).
      let numeroPresupuesto: string | null = null;
      if (comando.enviar) {
        const ultimoNumero = await repos.presupuestos.ultimoNumeroDelAnio(
          comando.tenantId,
          anioEmision,
          regimen,
        );
        numeroPresupuesto = siguienteNumeroPresupuesto({
          anio: anioEmision,
          ultimoNumero,
        });
      }

      // Nueva fila PRESUPUESTO congelada (la v anterior persiste como historial).
      const presupuesto = await repos.presupuestos.crearVersion({
        tenantId: comando.tenantId,
        reservaId: comando.reservaId,
        version,
        estado,
        tarifaCongelada: true,
        numeroPresupuesto,
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
        pdfUrl: null,
      });

      // Materializa el conjunto vivo de líneas RESERVA_EXTRA (añadir/quitar/modificar).
      const { lineas: lineasPersistidas } = await repos.extras.reemplazarLineas({
        tenantId: comando.tenantId,
        reservaId: comando.reservaId,
        lineas,
      });

      // D1 (fuente única post-commit): la fila COMUNICACION E2 (`es_reenvio=true`) YA NO
      // se escribe dentro de la transacción — la persiste el motor de email post-commit
      // (`despacharReenvio` vía `dispararE2PostCommit`), evitando el doble registro. La
      // respuesta HTTP proyecta `comunicacion` con estado OPTIMISTA (ver más abajo).

      // AUDIT_LOG accion='actualizar' referenciando el nuevo PRESUPUESTO (siempre).
      await repos.auditoria.registrar({
        tenantId: comando.tenantId,
        usuarioId: comando.usuarioId,
        entidad: 'PRESUPUESTO',
        entidadId: presupuesto.idPresupuesto,
        accion: 'actualizar',
        datosNuevos: {
          version: presupuesto.version,
          estado: presupuesto.estado,
          total: presupuesto.total,
        },
      });

      return { presupuesto, lineas: lineasPersistidas };
    };

    let salida: {
      presupuesto: PresupuestoVersionCreada;
      lineas: unknown[];
    } | null = null;
    for (let intento = 0; intento < MAX_REINTENTOS_VERSION; intento += 1) {
      try {
        salida = (await this.deps.unidadDeTrabajo.ejecutar(
          comando.tenantId,
          trabajo,
        )) as {
          presupuesto: PresupuestoVersionCreada;
          lineas: unknown[];
        };
        break;
      } catch (error) {
        if (esColisionVersion(error)) {
          continue;
        }
        throw error;
      }
    }
    if (salida === null) {
      throw new Error(
        'No se pudo asignar una versión única de presupuesto tras varios reintentos',
      );
    }

    // Post-commit (FUERA de la tx): PDF + E2 (solo al enviar). Un fallo aquí NO
    // revierte la versión ya comprometida. El envío enruta por `despacharReenvio`
    // (envío REAL, no idempotente) con la marca de edición (D1/D2).
    let comunicacion: ComunicacionE2Reenvio | null = null;
    if (comando.enviar) {
      const pdfUrl = await this.generarPdfPostCommit(comando, salida.presupuesto);
      await this.dispararE2PostCommit(
        comando,
        pdfUrl ?? salida.presupuesto.pdfUrl,
        salida.presupuesto.numeroPresupuesto,
      );
      // Proyección OPTIMISTA (D1): la fila real (con su estado enviado/fallido) la
      // escribe el motor post-commit; la respuesta HTTP proyecta el encolado como
      // `enviado` / `esReenvio=true` sin depender de la fila de la tx (ya eliminada).
      comunicacion = {
        idComunicacion: '',
        codigoEmail: 'E2',
        estado: 'enviado',
        esReenvio: true,
      };
    }

    return {
      presupuesto: salida.presupuesto,
      tarifaId,
      reparto,
      lineasExtras: salida.lineas,
      comunicacion,
    };
  }

  // -------------------------------------------------------------------------
  // Pasos privados
  // -------------------------------------------------------------------------

  /**
   * Carga la RESERVA (404), valida la guarda de estado (409 fuera de pre_reserva) y
   * el PRESUPUESTO vigente (409 no editable si aceptado/rechazado).
   */
  private async cargarYGuardar(
    comando: ComandoBaseEdicion,
  ): Promise<{ reserva: ReservaEdicion; vigente: PresupuestoVigente }> {
    const reserva = await this.deps.cargarReserva({
      tenantId: comando.tenantId,
      reservaId: comando.reservaId,
    });
    if (reserva === null || reserva === undefined) {
      throw new ReservaNoEncontradaError(comando.reservaId);
    }
    if (!esEstadoValidoParaEditarPresupuesto(reserva.estado)) {
      throw new ReservaFueraDePrereservaError();
    }
    const vigente = await this.deps.cargarPresupuestoVigente({
      tenantId: comando.tenantId,
      reservaId: comando.reservaId,
    });
    if (vigente === null || vigente === undefined) {
      throw new PresupuestoVigenteNoEncontradoError();
    }
    if (vigente.estado === 'aceptado' || vigente.estado === 'rechazado') {
      throw new PresupuestoNoEditableError();
    }
    return { reserva, vigente };
  }

  /** Lee los settings del tenant (nunca hardcodeados). */
  private async obtenerSettings(
    tenantId: string,
  ): Promise<TenantSettingsPresupuesto> {
    const settings = await this.deps.tenantSettings.obtener(tenantId);
    if (settings === null) {
      throw new Error(`No hay TENANT_SETTINGS configurado para el tenant ${tenantId}`);
    }
    return settings;
  }

  /**
   * Resuelve el conjunto vivo de líneas RESERVA_EXTRA a partir del comando. La
   * IDENTIDAD DE CONGELADO que usan el contrato OpenAPI (`EdicionExtraInput` solo
   * expone `extraId`), el SDK y el frontend (`useBorradorEdicion` construye los
   * extras keyeados por `extraId`, sin `id_reserva_extra`) es el `extra_id`. Por eso
   * una línea se considera EXISTENTE cuando su `extra_id` casa con una línea ya
   * persistida:
   *   - Línea existente (mismo `extra_id`, o `id_reserva_extra` explícito si viniera)
   *     → CONSERVA su `precio_unitario` congelado y su `origen`; recalcula
   *     `subtotal = precioCongelado × cantidad`. Inmune a cambios de catálogo.
   *   - Línea nueva de catálogo (sin existente que casar) → congela el precio ACTUAL
   *     del EXTRA del catálogo.
   *   - Línea `concepto_libre` (sin `extra_id`) → precio MVP 0 (no bloquea).
   *
   * El emparejamiento por `extra_id` CONSUME una línea existente por cada propuesta
   * (cola FIFO por `extra_id`): si se proponen N líneas del mismo `extra_id` y solo
   * hay M<N persistidas, las M primeras conservan su congelado y el resto son NUEVAS
   * al precio actual (soporta el caso "existente 250 + nueva 300" de AC-2).
   */
  private async resolverLineasExtras(
    comando: ComandoBaseEdicion,
    existentes: LineaExtraExistente[],
  ): Promise<LineaExtraAMaterializar[]> {
    const porId = new Map(existentes.map((l) => [l.idReservaExtra, l]));
    // Cola FIFO de líneas persistidas por `extra_id` (para consumir una por propuesta).
    const porExtraId = new Map<string, LineaExtraExistente[]>();
    for (const existente of existentes) {
      if (existente.extraId !== null) {
        const cola = porExtraId.get(existente.extraId) ?? [];
        cola.push(existente);
        porExtraId.set(existente.extraId, cola);
      }
    }
    const consumidos = new Set<string>();
    const lineas: LineaExtraAMaterializar[] = [];

    for (const propuesta of comando.extras) {
      const existente = this.emparejarExistente(
        propuesta,
        porId,
        porExtraId,
        consumidos,
      );

      if (existente !== undefined) {
        // Línea existente: conserva el precio congelado; recalcula subtotal por cantidad.
        const precioUnitario = existente.precioUnitario;
        lineas.push({
          idReservaExtra: existente.idReservaExtra,
          extraId: existente.extraId,
          conceptoLibre: existente.conceptoLibre,
          cantidad: propuesta.cantidad,
          precioUnitario,
          subtotal: aDecimal2(Number(precioUnitario) * propuesta.cantidad),
          origen: existente.origen,
          facturaId: existente.facturaId,
        });
        continue;
      }

      // Línea NUEVA: congela el precio actual del EXTRA del catálogo.
      const precioActual = await this.precioCongeladoNuevaLinea(comando, propuesta);
      lineas.push({
        idReservaExtra: null,
        extraId: propuesta.extra_id ?? null,
        conceptoLibre: propuesta.concepto_libre ?? null,
        cantidad: propuesta.cantidad,
        precioUnitario: precioActual,
        subtotal: aDecimal2(Number(precioActual) * propuesta.cantidad),
        origen: ORIGEN_POST_CONFIRMACION,
        facturaId: null,
      });
    }
    return lineas;
  }

  /**
   * Empareja una propuesta con una línea PERSISTIDA no consumida aún. Prioriza el
   * `id_reserva_extra` explícito (si el cliente lo enviara) y, si no, casa por
   * `extra_id` (identidad de congelado del contrato/SDK/frontend). Devuelve la línea
   * existente y la marca como consumida, o `undefined` si es NUEVA.
   */
  private emparejarExistente(
    propuesta: EdicionExtraInput,
    porId: Map<string, LineaExtraExistente>,
    porExtraId: Map<string, LineaExtraExistente[]>,
    consumidos: Set<string>,
  ): LineaExtraExistente | undefined {
    // Path por id_reserva_extra explícito (compat: algunos clientes/tests lo envían).
    if (propuesta.id_reserva_extra !== undefined) {
      const porIdent = porId.get(propuesta.id_reserva_extra);
      if (porIdent !== undefined && !consumidos.has(porIdent.idReservaExtra)) {
        consumidos.add(porIdent.idReservaExtra);
        return porIdent;
      }
      return undefined;
    }

    // Path por extra_id (identidad de congelado del contrato real): consume la
    // primera línea persistida con ese extra_id que no se haya usado ya.
    if (propuesta.extra_id !== undefined) {
      const cola = porExtraId.get(propuesta.extra_id) ?? [];
      const siguiente = cola.find((l) => !consumidos.has(l.idReservaExtra));
      if (siguiente !== undefined) {
        consumidos.add(siguiente.idReservaExtra);
        return siguiente;
      }
    }
    return undefined;
  }

  /** Congela el precio de una línea NUEVA con el precio ACTUAL del catálogo. */
  private async precioCongeladoNuevaLinea(
    comando: ComandoBaseEdicion,
    propuesta: EdicionExtraInput,
  ): Promise<string> {
    if (propuesta.extra_id === undefined) {
      // Extra fuera de catálogo sin precio de referencia (MVP): precio 0.
      return aDecimal2(0);
    }
    const extra = await this.deps.cargarExtraCatalogo({
      tenantId: comando.tenantId,
      extraId: propuesta.extra_id,
    });
    return aDecimal2(extra?.precioEur ?? 0);
  }

  /** Invoca el motor de tarifa con los datos de la edición (nuevos si se cambian). */
  private async calcularTarifa(
    reserva: ReservaEdicion,
    comando: ComandoBaseEdicion,
  ): Promise<CalculoTarifaResultado> {
    return this.deps.motorTarifa.calcular(
      {
        fechaEvento: reserva.fechaEvento as Date,
        duracionHoras: (comando.duracionHoras ??
          reserva.duracionHoras) as number,
        numAdultosNinosMayores4: (comando.numAdultosNinosMayores4 ??
          reserva.numAdultosNinosMayores4) as number,
        extras: comando.extras
          .filter((e) => e.extra_id !== undefined)
          .map((e) => ({ extraId: e.extra_id as string, cantidad: e.cantidad })),
      },
      comando.tenantId,
    );
  }

  /** Valida el método de pago (obligatorio) y deriva el régimen fiscal. */
  private resolverRegimen(metodoPago: MetodoPago | undefined): RegimenIva {
    if (!esMetodoPagoValido(metodoPago)) {
      throw new MetodoPagoRequeridoError();
    }
    return regimenDesdeMetodoPago(metodoPago);
  }

  /** Valida `duracion_horas ∈ {4,8,12}` (solo si se envía). Antes del motor. */
  private validarDuracion(comando: ComandoBaseEdicion): void {
    if (
      comando.duracionHoras !== undefined &&
      !DURACIONES_VALIDAS.includes(comando.duracionHoras)
    ) {
      throw new DuracionInvalidaError();
    }
  }

  /**
   * Deriva el desglose fiscal (con IVA / sin IVA) restando el descuento, y valida
   * `descuento_eur` (>= 0 y <= base_imponible sin descuento). El precio manual manda
   * en el caso `tarifa_a_consultar`.
   */
  private resolverDesglose(
    tarifa: CalculoTarifaResultado,
    comando: ComandoBaseEdicion,
    regimen: RegimenIva,
  ): DesgloseFiscal {
    const totalConIva = tarifa.tarifaAConsultar
      ? Number(comando.precioManualEur)
      : (tarifa.totalEur ?? 0);

    this.validarDescuento(totalConIva, comando, regimen);

    return calcularDesgloseFiscal({
      totalConIva,
      regimen,
      ...(presente(comando.descuentoEur)
        ? { descuentoEur: Number(comando.descuentoEur) }
        : {}),
    });
  }

  /**
   * Valida `descuento_eur`: `>= 0` y `<= base_imponible` (derivada del total SIN
   * descuento, en el régimen). Cualquier violación → `DescuentoInvalidoError` (422).
   */
  private validarDescuento(
    totalConIva: number,
    comando: ComandoBaseEdicion,
    regimen: RegimenIva,
  ): void {
    if (!presente(comando.descuentoEur)) {
      return;
    }
    const descuento = Number(comando.descuentoEur);
    if (Number.isNaN(descuento) || descuento < 0) {
      throw new DescuentoInvalidoError();
    }
    const baseSinDescuento = Number(
      calcularDesgloseFiscal({ totalConIva, regimen }).baseImponible,
    );
    if (descuento > baseSinDescuento) {
      throw new DescuentoInvalidoError();
    }
  }

  /**
   * Genera el PDF de la nueva versión post-commit y PERSISTE su `pdf_url` en la fila
   * (best-effort) para que el REENVÍO sin cambios disponga del adjunto. Un fallo (de la
   * generación o de la persistencia) se traga: NO revierte la versión ya comprometida.
   */
  private async generarPdfPostCommit(
    comando: EditarPresupuestoConfirmarComando,
    presupuesto: PresupuestoVersionCreada,
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

  /**
   * Dispara el E2 post-commit de la EDICIÓN. Enruta por el camino de reenvío real del
   * motor (`despacharReenvio`, no idempotente) y propaga la MARCA DE EDICIÓN
   * (`esEdicion=true`, derivada en servidor) hasta el render de E2. Sin puerto
   * configurado → no-op (tests unitarios sin BD). Best-effort: un fallo no revierte.
   */
  private async dispararE2PostCommit(
    comando: EditarPresupuestoConfirmarComando,
    pdfUrl: string | null,
    numeroPresupuesto?: string | null,
  ): Promise<void> {
    if (this.deps.dispararE2 === undefined) {
      return;
    }
    await this.deps.dispararE2.disparar({
      tenantId: comando.tenantId,
      reservaId: comando.reservaId,
      pdfUrl,
      esEdicion: true,
      numeroPresupuesto,
    });
  }
}

// ---------------------------------------------------------------------------
// Caso de uso: REENVÍO SIN CAMBIOS
// ---------------------------------------------------------------------------

export class ReenviarPresupuestoUseCase {
  constructor(private readonly deps: ReenviarPresupuestoDeps) {}

  /**
   * Reenvía SIN cambios la versión vigente (`MAX(version)`). NO versiona ni consume
   * número: registra la COMUNICACION E2 (`es_reenvio=true`) + AUDIT_LOG y reenvía el
   * PDF vigente. Guardas: RESERVA en `pre_reserva` (409), PRESUPUESTO vigente
   * existente (404), no aceptado/rechazado (409).
   */
  async ejecutar(
    comando: ReenviarPresupuestoComando,
  ): Promise<ReenviarPresupuestoResultado> {
    const reserva = await this.deps.cargarReserva({
      tenantId: comando.tenantId,
      reservaId: comando.reservaId,
    });
    if (reserva === null || reserva === undefined) {
      throw new ReservaNoEncontradaError(comando.reservaId);
    }
    if (!esEstadoValidoParaEditarPresupuesto(reserva.estado)) {
      throw new ReservaFueraDePrereservaError();
    }

    const vigente = await this.deps.cargarPresupuestoVigente({
      tenantId: comando.tenantId,
      reservaId: comando.reservaId,
    });
    if (vigente === null || vigente === undefined) {
      throw new PresupuestoVigenteNoEncontradoError();
    }
    if (vigente.estado === 'aceptado' || vigente.estado === 'rechazado') {
      throw new PresupuestoNoEditableError();
    }

    // Reenvía el PDF de la versión vigente (SIN crear versión ni número). Para
    // presupuestos HISTÓRICOS sin `pdf_url` persistido (previos al fix), se regenera el
    // PDF del vigente para que el reenvío siga llevando adjunto (best-effort).
    const pdfUrl = await this.resolverPdfVigente(comando, vigente);
    await this.deps.reenviarE2({
      tenantId: comando.tenantId,
      reservaId: comando.reservaId,
      pdfUrl,
      numeroPresupuesto: vigente.numeroPresupuesto,
    });

    const comunicacion = await this.deps.registrarE2Reenvio({
      tenantId: comando.tenantId,
      reservaId: comando.reservaId,
      codigoEmail: 'E2',
      estado: 'enviado',
      esReenvio: true,
    });

    await this.deps.registrarAuditoria({
      tenantId: comando.tenantId,
      usuarioId: comando.usuarioId,
      entidad: 'PRESUPUESTO',
      entidadId: vigente.idPresupuesto,
      accion: 'actualizar',
      datosNuevos: { reenvio: true, version: vigente.version },
    });

    return { presupuesto: vigente, comunicacion };
  }

  /**
   * Resuelve el `pdf_url` a adjuntar en el reenvío. Si el vigente ya tiene URL (flujo
   * normal tras el fix de persistencia), la reutiliza. Si es null (presupuesto histórico
   * previo al fix) y hay puerto de generación, regenera el PDF del vigente (best-effort:
   * un fallo NO impide el reenvío, solo lo deja sin adjunto).
   */
  private async resolverPdfVigente(
    comando: ReenviarPresupuestoComando,
    vigente: PresupuestoVigente,
  ): Promise<string | null> {
    if (vigente.pdfUrl !== null || this.deps.generarPdf === undefined) {
      return vigente.pdfUrl;
    }
    try {
      return await this.deps.generarPdf({
        tenantId: comando.tenantId,
        reservaId: comando.reservaId,
        idPresupuesto: vigente.idPresupuesto,
      });
    } catch {
      return null;
    }
  }
}
