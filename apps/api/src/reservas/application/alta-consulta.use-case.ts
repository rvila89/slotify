/**
 * Caso de uso de APLICACIÓN: alta de consulta exploratoria sin fecha
 * (US-003 / UC-03).
 *
 * Orquesta la creación del agregado RESERVA en su entrada inicial `consulta`/`2a`
 * (ttl NULL), junto con el CLIENTE (find-or-create idempotente por tenant+email),
 * la COMUNICACION E1 y el registro de AUDIT_LOG, TODO dentro de una ÚNICA unidad
 * de trabajo transaccional (el adaptador abre `$transaction` + `fijarTenant` para
 * el contexto RLS). Si algo falla, no se crea NADA (all-or-nothing).
 *
 * Orden (design.md §4):
 *   0. Validación de forma PREVIA a abrir la transacción (rechazo sin efectos).
 *   1. (dentro de la UoW) find-or-create CLIENTE → crear RESERVA → crear
 *      COMUNICACION E1 en estado NO final (`borrador`, sin `fecha_envio`) →
 *      registrar AUDIT_LOG. La fila E1 nace SIEMPRE en `borrador` para preservar la
 *      atomicidad US-003 (all-or-nothing con la reserva) sin acoplar el resultado
 *      del proveedor —que aún no se conoce— a la transacción.
 *   2. (POST-COMMIT) si NO hay comentarios (auto-envío), DELEGAR el envío en el motor
 *      `DespacharEmailService.finalizarEnvio` (decisión 6 del Gate 1): este envía y
 *      PROMUEVE la fila a `enviado`+`fecha_envio` o, ante fallo del proveedor, a
 *      `fallido` + AUDIT_LOG, SIN reintento y SIN propagar excepción (el alta ya está
 *      commiteada: un fallo de email NO debe tumbar el 201). Con comentarios, la fila
 *      queda en `borrador` y no se envía. El envío NUNCA ocurre dentro de la
 *      transacción ni si esta falla.
 *
 * Hexagonal: depende solo de PUERTOS (interfaces) inyectados; no importa Prisma ni
 * `@nestjs/*`. La regla de entrada inicial proviene del dominio puro
 * (`maquina-estados`). El camino de fallo de email vive centralizado en el motor.
 */
import type { AuditLogPort } from '../../shared/audit/audit-log.port';
import {
  esFechaEstrictamenteFutura,
  resolverPlanBloqueo,
  type ClockPort,
  type TenantSettingsPort,
} from '../domain/bloquear-fecha.service';
import {
  determinarAltaConFecha,
  entradaInicialConsultaExploratoria,
  type EstadoReserva,
  type SubEstadoConsulta,
} from '../domain/maquina-estados';
import type { CatalogoPlantillasPort } from '../../comunicaciones/domain/catalogo-plantillas.port';
import type { AdjuntoRef } from '../../comunicaciones/domain/enviar-email.port';

export type { ClockPort };

/** Días de TTL del bloqueo blando por defecto si el tenant no tiene settings. */
const TTL_CONSULTA_DIAS_DEFECTO = 3;

// ---------------------------------------------------------------------------
// Tipos de dominio del comando/resultado (en español, snake-free / camelCase)
// ---------------------------------------------------------------------------

/** Canales de entrada del lead (alineado con el enum del contrato). */
export type CanalEntrada =
  | 'web'
  | 'email'
  | 'whatsapp'
  | 'instagram'
  | 'telefono'
  | 'cocopool'
  | 'holaplace';

/** Tipos de evento (alineado con el enum del contrato). */
export type TipoEvento = 'boda' | 'corporativo' | 'privado' | 'otro' | 'cumpleanos';

/** Datos de contacto mínimos del CLIENTE embebidos en el alta. */
export interface AltaConsultaCliente {
  nombre: string;
  apellidos: string;
  email: string;
  telefono: string;
}

/** Comando de entrada del alta de consulta. */
export interface AltaConsultaComando {
  /** Tenant del gestor (del JWT, nunca del body). */
  tenantId: string;
  /** Identificador del gestor que ejecuta el alta (para auditoría). */
  usuarioId: string;
  /** Canal por el que entra el lead. */
  canalEntrada: CanalEntrada;
  /**
   * Fecha del evento (US-004). Si se OMITE → alta exploratoria US-003 (`2a`, sin
   * bloqueo). Si se ENVÍA debe ser estrictamente futura (`> hoy`); el sub-estado
   * resultante (`2b` / `2d` / `2a`) lo determina el estado de la fecha.
   */
  fechaEvento?: Date;
  /**
   * Comentarios libres del gestor. Su PRESENCIA decide el flujo de E1: ausente
   * (o en blanco) → auto-envío; presente → borrador pendiente de revisión.
   */
  comentarios?: string;
  /** Opcionales del evento (se almacenan; NO se calcula tarifa sin fecha). */
  tipoEvento?: TipoEvento;
  duracionHoras?: number;
  numAdultosNinosMayores4?: number;
  numNinosMenores4?: number;
  notas?: string;
  /** Idioma de comunicación con el cliente (`es` por defecto, `ca` disponible). */
  idioma?: string;
  /** Hora de inicio del evento (`HH:MM`); solo válido junto a `duracionHoras`. */
  horario?: string;
  /** Datos del cliente del lead. */
  cliente: AltaConsultaCliente;
}

/** Proyección del CLIENTE relevante para el alta. */
export interface ClienteParaAlta {
  idCliente: string;
  tenantId: string;
  nombre: string;
  apellidos: string;
  email: string;
  telefono: string;
}

/** Sub-estados de consulta admitidos como entrada inicial del alta. */
export type SubEstadoAlta = '2a' | '2b' | '2d';

/** Proyección de la RESERVA creada en la entrada inicial. */
export interface ReservaParaAlta {
  idReserva: string;
  tenantId: string;
  clienteId: string;
  codigo: string;
  estado: 'consulta';
  subEstado: SubEstadoAlta;
  ttlExpiracion: Date | null;
  canalEntrada: CanalEntrada;
  posicionCola?: number | null;
  consultaBloqueanteId?: string | null;
}

/** Proyección de la COMUNICACION E1 creada. */
export interface ComunicacionParaAlta {
  idComunicacion: string;
  tenantId: string;
  reservaId: string;
  clienteId: string;
  codigoEmail: 'E1';
  /**
   * Estado OBSERVABLE final de la fila: nace `borrador` en la transacción y, tras el
   * envío post-commit, queda `enviado` (éxito) o `fallido` (proveedor caído). Con
   * comentarios permanece `borrador`.
   */
  estado: 'enviado' | 'borrador' | 'fallido';
  destinatarioEmail: string;
  fechaEnvio: Date | null;
}

/** Resultado del alta. */
export interface AltaConsultaResultado {
  reserva: ReservaParaAlta;
  cliente: ClienteParaAlta;
  comunicacion: ComunicacionParaAlta;
  /** `true` si se reutilizó un CLIENTE existente (no se creó uno nuevo). */
  clienteReutilizado: boolean;
  /**
   * Tipo del bloqueo creado por el alta (`blando`) cuando nace en `2.b`; `null`
   * en `2.a`/`2.d` y en el alta sin fecha (no crea `FECHA_BLOQUEADA` propia).
   */
  tipoBloqueo?: 'blando' | 'firme' | null;
  /**
   * Disponibilidad de la fecha: `false` cuando el alta se degrada a `2.a` por una
   * fecha bloqueada por estado no encolable; `true`/`null` en el resto.
   */
  fechaDisponible?: boolean | null;
  /** Mensaje informativo para la UI cuando la fecha no está disponible (`2.a`). */
  avisoDisponibilidad?: string | null;
  /** Tarifa estimada que enriquece E1 (decorativa, tolerante); `null` si no aplica. */
  tarifaEstimada?: TarifaEstimadaResultado | null;
  /**
   * Errores de validación. En un alta exitosa es SIEMPRE vacío; las violaciones
   * de forma se rechazan antes de la transacción lanzando
   * `AltaConsultaValidacionError`. Se expone para uniformar el tipo de retorno
   * con el del error de validación al inspeccionarlo.
   */
  errores: ReadonlyArray<ErrorCampo>;
}

// ---------------------------------------------------------------------------
// Puertos de repositorio (implementados en infraestructura, dentro de la UoW)
// ---------------------------------------------------------------------------

/** Parámetros de búsqueda idempotente de CLIENTE por tenant + email. */
export interface BuscarClienteParams {
  tenantId: string;
  email: string;
}

/** Parámetros de creación de CLIENTE. */
export interface CrearClienteParams {
  tenantId: string;
  nombre: string;
  apellidos: string;
  email: string;
  telefono: string;
}

/** Repositorio de CLIENTE (find-or-create) ligado a la transacción del alta. */
export interface ClienteRepositoryPort {
  buscarPorEmail(params: BuscarClienteParams): Promise<ClienteParaAlta | null>;
  crear(params: CrearClienteParams): Promise<ClienteParaAlta>;
}

/** Parámetros de creación de la RESERVA en la entrada inicial. */
export interface CrearReservaParams {
  tenantId: string;
  clienteId: string;
  estado: 'consulta';
  subEstado: SubEstadoAlta;
  ttlExpiracion: Date | null;
  canalEntrada: CanalEntrada;
  /** Fecha del evento (US-004); ausente en el alta exploratoria `2.a`. */
  fechaEvento?: Date;
  /** Posición de cola (solo `2.d`). */
  posicionCola?: number;
  /** Id de la RESERVA bloqueante (solo `2.d`). */
  consultaBloqueanteId?: string;
  tipoEvento?: TipoEvento;
  duracionHoras?: number;
  numAdultosNinosMayores4?: number;
  numNinosMenores4?: number;
  notas?: string;
  /**
   * Comentarios libres del alta (mejoras-detalle-consulta). Se persisten ya
   * recortados (trim); ausentes/en blanco → columna NULL.
   */
  comentarios?: string;
  idioma?: string;
  horario?: string;
}

/** Repositorio de RESERVA ligado a la transacción del alta. */
export interface ReservaRepositoryPort {
  crear(params: CrearReservaParams): Promise<ReservaParaAlta>;
}

// ---------------------------------------------------------------------------
// Puerto del bloqueo/cola de FECHA_BLOQUEADA ligado a la transacción (US-004)
// ---------------------------------------------------------------------------

/**
 * Estado de disponibilidad de la fecha leído DENTRO de la transacción del alta.
 * `reservaBloqueanteId` identifica la RESERVA dueña del bloqueo (para enlazar la
 * cola en `2.d`).
 */
export type EstadoFechaAlta =
  | { tipo: 'libre' }
  | {
      tipo: 'bloqueada';
      subEstadoBloqueante: SubEstadoConsulta | null;
      estadoBloqueante: EstadoReserva;
      reservaBloqueanteId: string;
    };

/**
 * Repositorio tx-bound del bloqueo de fecha para el alta (US-004 §D-2/§D-5). Vive
 * dentro de la MISMA transacción del alta (atomicidad RESERVA `2.b` +
 * `FECHA_BLOQUEADA`), reutilizando la primitiva `bloquearEnTx` de US-040.
 */
export interface FechaBloqueadaAltaRepositoryPort {
  /** Lee el estado de la fecha (libre / bloqueada por X) bajo el contexto RLS. */
  leerEstadoFecha(params: {
    tenantId: string;
    fecha: Date;
  }): Promise<EstadoFechaAlta>;
  /** Inserta el bloqueo blando de la nueva consulta `2.b` (UNIQUE → P2002). */
  bloquear(params: {
    tenantId: string;
    fecha: Date;
    reservaId: string;
    ttlExpiracion: Date;
  }): Promise<void>;
  /**
   * Calcula la siguiente posición de cola (`MAX+1`) serializando con `SELECT … FOR
   * UPDATE` sobre la fila `FECHA_BLOQUEADA` bloqueante (sin locks distribuidos).
   */
  siguientePosicionCola(params: {
    tenantId: string;
    fecha: Date;
    consultaBloqueanteId: string;
  }): Promise<number>;
}

// ---------------------------------------------------------------------------
// Puerto de tarifa estimada (US-004 §D-4) — tolerante, decorativo de E1
// ---------------------------------------------------------------------------

/** Parámetros de la estimación de tarifa para E1. */
export interface TarifaEstimadaParams {
  tenantId: string;
  fechaEvento: Date;
  duracionHoras: number;
  numAdultosNinosMayores4: number;
  extras: ReadonlyArray<{ extraId: string; cantidad: number }>;
}

/** Resultado de la estimación de tarifa (subconjunto del motor UC-16). */
export interface TarifaEstimadaResultado {
  temporada?: string;
  tarifaAConsultar: boolean;
  precioTarifaEur: number | null;
  extrasTotalEur?: number | null;
  totalEur: number | null;
  tarifaId?: string | null;
}

/**
 * Puerto de tarifa estimada (US-004 §D-4). El adaptador envuelve el motor UC-16; el
 * use-case lo invoca de forma TOLERANTE (degrada a `null` ante faltas o errores: la
 * tarifa nunca bloquea el alta). El retorno es `unknown` para no acoplar el puerto a
 * la forma exacta del motor; el use-case lo normaliza a `TarifaEstimadaResultado`.
 */
export interface TarifaEstimadaPort {
  estimar(params: TarifaEstimadaParams): Promise<unknown>;
}

/** Parámetros de creación de la COMUNICACION E1. */
export interface CrearComunicacionParams {
  tenantId: string;
  reservaId: string;
  clienteId: string;
  codigoEmail: 'E1';
  estado: 'enviado' | 'borrador';
  asunto: string;
  cuerpo: string;
  destinatarioEmail: string;
  fechaEnvio: Date | null;
}

/** Repositorio de COMUNICACION ligado a la transacción del alta. */
export interface ComunicacionRepositoryPort {
  crear(params: CrearComunicacionParams): Promise<ComunicacionParaAlta>;
}

/** Conjunto de repositorios disponibles dentro de la unidad de trabajo. */
export interface RepositoriosAltaConsulta {
  clientes: ClienteRepositoryPort;
  reservas: ReservaRepositoryPort;
  comunicaciones: ComunicacionRepositoryPort;
  auditoria: AuditLogPort;
  /**
   * Repositorio de bloqueo/cola (US-004). Opcional: el alta SIN fecha (US-003 →
   * `2.a`) no lo necesita ni lo recibe. El alta CON fecha lo usa dentro de la tx.
   */
  fechaBloqueada?: FechaBloqueadaAltaRepositoryPort;
}

/**
 * Unidad de trabajo transaccional. El adaptador envuelve `$transaction` +
 * `fijarTenant(tenantId)` (RLS) y expone los repositorios ligados a esa
 * transacción. Si el `trabajo` rechaza, la transacción revierte (rollback total).
 */
export interface UnidadDeTrabajoPort {
  ejecutar(
    tenantId: string,
    trabajo: (repos: RepositoriosAltaConsulta) => Promise<unknown>,
  ): Promise<unknown>;
}

/**
 * Parámetros del envío POST-COMMIT de la COMUNICACION E1 ya creada (en `borrador`)
 * dentro de la transacción del alta. El motor los usa para enviar y promover la fila.
 */
export interface FinalizarEnvioEmailParams {
  tenantId: string;
  reservaId: string;
  idComunicacion: string;
  destinatario: string;
  asunto: string;
  cuerpo: string;
  /**
   * Formato del `cuerpo` (change `consulta-fecha-borrador-fix`, design.md §D-2): el E1 del
   * alta se renderiza como HTML del catálogo (`cuerpoHtml`), por eso viaja `true` para que
   * el borde de envío NO lo doble-escape.
   */
  cuerpoEsHtml?: boolean;
  codigoEmail: 'E1';
  /** Adjuntos opcionales (ej. dossier) a incluir en el envío. */
  adjuntos?: AdjuntoRef[];
}

/** Estado terminal alcanzado tras el intento de envío post-commit. */
export interface FinalizarEnvioEmailResultado {
  estado: 'enviado' | 'fallido';
  fechaEnvio: Date | null;
}

/**
 * Puerto del camino de envío POST-COMMIT. Lo SATISFACE el motor de email
 * (`DespacharEmailService.finalizarEnvio`), que centraliza el try/catch del proveedor
 * (decisión 6 del Gate 1): éxito → `enviado`+`fecha_envio`; fallo → `fallido` +
 * AUDIT_LOG, sin reintento y sin propagar excepción. El alta solo lo invoca tras el
 * commit, jamás dentro de la transacción.
 */
export interface FinalizarEnvioEmailPort {
  finalizarEnvio(
    params: FinalizarEnvioEmailParams,
  ): Promise<FinalizarEnvioEmailResultado>;
}

/** Resultado de las fechas alternativas disponibles en el mismo fin de semana. */
export interface FechasAlternativas {
  anterior: Date | null;
  posterior: Date | null;
}

/**
 * Puerto para verificar disponibilidad de fechas adyacentes (Caso 3: fecha ocupada
 * por reserva confirmada). Lee FECHA_BLOQUEADA fuera de la transacción del alta.
 */
export interface FechasAlternativasPort {
  leerAlternativas(params: {
    tenantId: string;
    fecha: Date;
  }): Promise<FechasAlternativas>;
}

/**
 * Parámetros del UPDATE POST-COMMIT del contenido de la fila E1 en `borrador`
 * (fix-borrador-e1-cuerpo-prerelleno). Solo `asunto` + `cuerpo`; el estado permanece
 * `borrador` y `fecha_envio` intacto.
 */
export interface ActualizarBorradorEmailParams {
  tenantId: string;
  idComunicacion: string;
  asunto: string;
  cuerpo: string;
}

/**
 * Puerto ESTRECHO del UPDATE del borrador E1 con comentarios. Lo SATISFACE el motor
 * de email (`DespacharEmailService.actualizarContenidoBorrador`), ya inyectado en el
 * alta para `finalizarEnvio`. Reutilizado sin wiring nuevo (design.md D-1). El alta
 * solo lo invoca POST-COMMIT y de forma best-effort (D-3): un fallo no tumba el 201.
 */
export interface ActualizarBorradorEmailPort {
  actualizarContenidoBorrador(
    params: ActualizarBorradorEmailParams,
  ): Promise<unknown>;
}

/** Dependencias del caso de uso (puertos inyectados). */
export interface AltaConsultaDeps {
  unidadDeTrabajo: UnidadDeTrabajoPort;
  finalizarEnvio: FinalizarEnvioEmailPort;
  clock: ClockPort;
  /** Tarifa estimada para E1 (US-004 §D-4). Opcional: el alta sin fecha no la usa. */
  tarifaEstimada?: TarifaEstimadaPort;
  /** Settings del tenant para el TTL del bloqueo blando (US-004 §D-2/§D-7). */
  tenantSettings?: TenantSettingsPort;
  /** Catálogo de plantillas para renderizar E1 personalizada por caso e idioma. */
  catalogo?: CatalogoPlantillasPort;
  /** Verificación de fechas adyacentes disponibles (Caso 3: fecha confirmada). */
  fechasAlternativas?: FechasAlternativasPort;
  /**
   * UPDATE del borrador E1 con comentarios (fix-borrador-e1-cuerpo-prerelleno).
   * Opcional: si falta, el borrador con comentarios queda sin rellenar (degradación
   * graceful; los montajes de test que no lo inyectan no rompen).
   */
  actualizarBorrador?: ActualizarBorradorEmailPort;
  /** URL base del almacén de documentos para construir la referencia del dossier. */
  dossierBaseUrl?: string;
}

// ---------------------------------------------------------------------------
// Error de validación (rechazo sin efectos colaterales)
// ---------------------------------------------------------------------------

/** Detalle de un campo que ha fallado la validación. */
export interface ErrorCampo {
  campo: string;
  mensaje: string;
}

/** El alta no supera la validación de forma: se rechaza antes de tocar la BD. */
export class AltaConsultaValidacionError extends Error {
  readonly codigo = 'ALTA_CONSULTA_VALIDACION' as const;
  readonly errores: ReadonlyArray<ErrorCampo>;

  constructor(errores: ReadonlyArray<ErrorCampo>) {
    super('La validación del alta de consulta ha fallado');
    this.name = 'AltaConsultaValidacionError';
    this.errores = errores;
  }
}

// ---------------------------------------------------------------------------
// Reglas/constantes de validación y plantilla E1
// ---------------------------------------------------------------------------

/** RFC 5322 básico: local@dominio.tld, sin espacios (alineado con el contrato). */
const EMAIL_REGEX = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

const MAX_NOMBRE = 100;

const CANALES_VALIDOS: ReadonlyArray<CanalEntrada> = [
  'web',
  'email',
  'whatsapp',
  'instagram',
  'telefono',
  'cocopool',
  'holaplace',
];

/** Asunto/cuerpo PLACEHOLDER de la fila E1 creada en la transacción (se sobreescribe post-commit). */
const ASUNTO_E1_PLACEHOLDER = 'Hem rebut la teva consulta';

/** ¿Hay comentarios significativos (no vacíos ni en blanco)? */
const tieneComentarios = (comentarios?: string): boolean =>
  (comentarios ?? '').trim().length > 0;

/** Plan resuelto del alta: sub-estado destino + acción + metadatos de fecha. */
interface PlanAlta {
  subEstado: SubEstadoAlta;
  accion: 'bloquear' | 'encolar' | 'exploratoria';
  ttlExpiracion: Date | null;
  posicionCola?: number;
  consultaBloqueanteId?: string;
  fechaDisponible: boolean | null;
  avisoDisponibilidad: string | null;
}

// ---------------------------------------------------------------------------
// Caso de uso
// ---------------------------------------------------------------------------

export class AltaConsultaUseCase {
  constructor(private readonly deps: AltaConsultaDeps) {}

  async ejecutar(comando: AltaConsultaComando): Promise<AltaConsultaResultado> {
    // 0. Validación PREVIA a abrir la transacción: rechazo sin efectos.
    const errores = this.validar(comando);
    if (errores.length > 0) {
      throw new AltaConsultaValidacionError(errores);
    }

    const ahora = this.deps.clock.ahora();

    // 0.b Validación de fecha estrictamente futura (US-004 §D-1): regla única
    //     `esFechaEstrictamenteFutura`. Rechaza hoy y pasado con 400 sin efectos.
    if (comando.fechaEvento !== undefined && !esFechaEstrictamenteFutura(comando.fechaEvento, ahora)) {
      throw new AltaConsultaValidacionError([
        {
          campo: 'fechaEvento',
          mensaje: 'La fecha del evento debe ser estrictamente futura (posterior a hoy)',
        },
      ]);
    }

    const enviarAutomaticamente = !tieneComentarios(comando.comentarios);
    const email = comando.cliente.email.trim();
    // Comentarios recortados: si tras trim queda vacío, se persiste NULL (undefined).
    const comentariosTrim = (comando.comentarios ?? '').trim();
    const comentarios = comentariosTrim.length > 0 ? comentariosTrim : undefined;

    // 0.c Tarifa estimada para E1 (US-004 §D-4): TOLERANTE. Se calcula FUERA de la
    //     transacción (lectura pura) y degrada a `null` ante faltas o errores: nunca
    //     bloquea el alta.
    const tarifaEstimada = await this.calcularTarifaTolerante(comando);

    // 0.d TTL del bloqueo blando (US-004 §D-2): now() + ttl_consulta_dias del tenant.
    const ttlBloqueo =
      comando.fechaEvento !== undefined
        ? await this.calcularTtlConsulta(comando.tenantId, ahora)
        : null;

    // 1. Toda la escritura, dentro de la unidad de trabajo (tx + RLS). La
    //    determinación del sub-estado (D-3) ocurre DENTRO del cuerpo transaccional
    //    para que un reintento tras colisión (D-6) re-evalúe la rama con la fecha ya
    //    actualizada.
    const resultado = (await this.deps.unidadDeTrabajo.ejecutar(
      comando.tenantId,
      async (repos): Promise<AltaConsultaResultado> => {
        // find-or-create idempotente del CLIENTE por (tenant_id, email).
        const previo = await repos.clientes.buscarPorEmail({
          tenantId: comando.tenantId,
          email,
        });
        const clienteReutilizado = previo !== null;
        const cliente =
          previo ??
          (await repos.clientes.crear({
            tenantId: comando.tenantId,
            nombre: comando.cliente.nombre.trim(),
            apellidos: comando.cliente.apellidos.trim(),
            email,
            telefono: comando.cliente.telefono.trim(),
          }));

        // Resolución del sub-estado y de la acción de fecha (libre/cola/exploratoria).
        const plan = await this.resolverPlanAlta(repos, comando, ttlBloqueo);

        // RESERVA en el sub-estado resuelto.
        const reserva = await repos.reservas.crear({
          tenantId: comando.tenantId,
          clienteId: cliente.idCliente,
          estado: 'consulta',
          subEstado: plan.subEstado,
          ttlExpiracion: plan.ttlExpiracion,
          canalEntrada: comando.canalEntrada,
          ...(comando.fechaEvento !== undefined
            ? { fechaEvento: comando.fechaEvento }
            : {}),
          ...(plan.posicionCola !== undefined
            ? { posicionCola: plan.posicionCola }
            : {}),
          ...(plan.consultaBloqueanteId !== undefined
            ? { consultaBloqueanteId: plan.consultaBloqueanteId }
            : {}),
          ...(comando.tipoEvento !== undefined
            ? { tipoEvento: comando.tipoEvento }
            : {}),
          ...(comando.duracionHoras !== undefined
            ? { duracionHoras: comando.duracionHoras }
            : {}),
          ...(comando.numAdultosNinosMayores4 !== undefined
            ? { numAdultosNinosMayores4: comando.numAdultosNinosMayores4 }
            : {}),
          ...(comando.numNinosMenores4 !== undefined
            ? { numNinosMenores4: comando.numNinosMenores4 }
            : {}),
          ...(comando.notas !== undefined ? { notas: comando.notas } : {}),
          ...(comentarios !== undefined ? { comentarios } : {}),
          ...(comando.idioma !== undefined ? { idioma: comando.idioma } : {}),
          ...(comando.horario !== undefined ? { horario: comando.horario } : {}),
        });

        // Bloqueo atómico en `2.b` DENTRO de la misma transacción del alta (D-2). En
        // `2.d`/`2.a` no se inserta `FECHA_BLOQUEADA` para la nueva consulta.
        if (plan.accion === 'bloquear' && ttlBloqueo !== null) {
          await this.repoFechaBloqueada(repos).bloquear({
            tenantId: comando.tenantId,
            fecha: comando.fechaEvento as Date,
            reservaId: reserva.idReserva,
            ttlExpiracion: ttlBloqueo,
          });
        }

        // COMUNICACION E1: nace SIEMPRE en `borrador` (estado NO final, sin
        // `fecha_envio`) dentro de la transacción, preservando la atomicidad US-003.
        // El estado terminal (`enviado`/`fallido`) lo decide el envío post-commit
        // (US-045); con comentarios la fila se queda en `borrador` y no se envía.
        const comunicacion = await repos.comunicaciones.crear({
          tenantId: comando.tenantId,
          reservaId: reserva.idReserva,
          clienteId: cliente.idCliente,
          codigoEmail: 'E1',
          estado: 'borrador',
          asunto: ASUNTO_E1_PLACEHOLDER,
          // El cuerpo real de E1 se renderiza POST-COMMIT (personalizado por caso e
          // idioma), cuando ya se conoce el sub-estado resultante de la transacción.
          cuerpo: '',
          destinatarioEmail: email,
          fechaEnvio: null,
        });

        // AUDIT_LOG dentro de la misma transacción.
        await repos.auditoria.registrar({
          tenantId: comando.tenantId,
          accion: 'crear',
          entidad: 'RESERVA',
          entidadId: reserva.idReserva,
          usuarioId: comando.usuarioId,
          datosNuevos: {
            idReserva: reserva.idReserva,
            codigo: reserva.codigo,
            estado: reserva.estado,
            subEstado: reserva.subEstado,
            clienteId: cliente.idCliente,
            canalEntrada: reserva.canalEntrada,
          },
        });

        return {
          reserva,
          cliente,
          comunicacion,
          clienteReutilizado,
          tipoBloqueo: plan.accion === 'bloquear' ? 'blando' : null,
          fechaDisponible: plan.fechaDisponible,
          avisoDisponibilidad: plan.avisoDisponibilidad,
          tarifaEstimada,
          errores: [],
        };
      },
    )) as AltaConsultaResultado;

    // 2. Efecto POST-COMMIT: solo si la transacción confirmó y NO hay comentarios
    //    (auto-envío). Se DELEGA el envío en el motor, que centraliza el camino de
    //    éxito/fallo (decisión 6 del Gate 1): promueve la fila a `enviado`/`fallido`
    //    sin propagar excepción (un fallo de email NO debe tumbar el alta ya
    //    commiteada → el alta responde 201 igualmente). Con comentarios, la fila
    //    permanece en `borrador` y no se envía.
    // POST-COMMIT: la CASUÍSTICA de E1 (`tipoE1`) se decide con el sub-estado YA
    // commiteado, así que la renderización de la plantilla personalizada ocurre aquí
    // (nunca dentro de la transacción). El MISMO helper alimenta ambas ramas (envío y
    // borrador con comentarios) → paridad de asunto/cuerpo por construcción (D-2).
    const { asunto, cuerpo } = await this.renderizarE1(comando, resultado);

    // Con comentarios: el E1 permanece en `borrador` y NO se envía; se RELLENA con el
    // asunto/cuerpo renderizados para que el gestor edite y envíe (US-046). El UPDATE es
    // POST-COMMIT best-effort (D-3): si falla, el alta ya commiteó y responde 201 igual;
    // el borrador queda editable. La fila ya existe (creada en la tx) → es un UPDATE por
    // id, sin INSERT ni duplicado.
    if (!enviarAutomaticamente) {
      if (this.deps.actualizarBorrador) {
        try {
          await this.deps.actualizarBorrador.actualizarContenidoBorrador({
            tenantId: comando.tenantId,
            idComunicacion: resultado.comunicacion.idComunicacion,
            asunto,
            cuerpo,
          });
        } catch {
          // best-effort: un fallo del UPDATE no debe tumbar el 201 del alta commiteada.
        }
      }
      return resultado;
    }

    // Sin comentarios (auto-envío): se DELEGA en el motor, que envía y promueve la fila.
    // Adjunto del dossier (por idioma). Solo si se conoce la URL base del almacén.
    const idioma = comando.idioma ?? 'es';
    const dossierRef: AdjuntoRef | undefined = this.deps.dossierBaseUrl
      ? {
          clave: 'dossier',
          nombre: `Dossier-Masia-Encis-${idioma}.pdf`,
          pdfUrl: `${this.deps.dossierBaseUrl}/dossiers/Dossier-Masia-Encis-${idioma}.pdf`,
        }
      : undefined;

    const envio = await this.deps.finalizarEnvio.finalizarEnvio({
      tenantId: comando.tenantId,
      reservaId: resultado.reserva.idReserva,
      idComunicacion: resultado.comunicacion.idComunicacion,
      destinatario: email,
      asunto,
      cuerpo,
      // El cuerpo del E1 del alta es HTML del catálogo (`cuerpoHtml`): no doble-escapar (§D-2).
      cuerpoEsHtml: true,
      codigoEmail: 'E1',
      ...(dossierRef !== undefined ? { adjuntos: [dossierRef] } : {}),
    });

    return {
      ...resultado,
      comunicacion: {
        ...resultado.comunicacion,
        estado: envio.estado,
        fechaEnvio: envio.fechaEnvio,
      },
    };
  }

  /**
   * Renderiza la plantilla E1 personalizada (4 casos `tipoE1` × idioma) a partir del
   * sub-estado YA commiteado. Reutilizado por el auto-envío y por el relleno del borrador
   * con comentarios (fix-borrador-e1-cuerpo-prerelleno) para garantizar PARIDAD EXACTA de
   * asunto/cuerpo. Si el catálogo no está cableado o no hay plantilla, degrada a un
   * asunto/cuerpo mínimo (nunca peor que hoy; el motor centraliza éxito/fallo del envío).
   */
  private async renderizarE1(
    comando: AltaConsultaComando,
    resultado: AltaConsultaResultado,
  ): Promise<{ asunto: string; cuerpo: string }> {
    const idioma = comando.idioma ?? 'es';
    const tienesFecha = comando.fechaEvento !== undefined;
    const subEstado = resultado.reserva.subEstado;

    type TipoE1 = 'sin_fecha' | 'fecha_disponible' | 'fecha_confirmada' | 'fecha_cola';
    let tipoE1: TipoE1;
    if (!tienesFecha) {
      tipoE1 = 'sin_fecha';
    } else if (subEstado === '2b') {
      tipoE1 = 'fecha_disponible';
    } else if (subEstado === '2d') {
      tipoE1 = 'fecha_cola';
    } else {
      // `2a` con fecha: la fecha estaba confirmada por otra reserva (alta degradada).
      tipoE1 = 'fecha_confirmada';
    }

    // Fechas alternativas del mismo fin de semana (solo Caso 3: fecha confirmada).
    let fechaAlternativa1: Date | undefined;
    let fechaAlternativa2: Date | undefined;
    if (tipoE1 === 'fecha_confirmada' && this.deps.fechasAlternativas && comando.fechaEvento) {
      const alternativas = await this.deps.fechasAlternativas.leerAlternativas({
        tenantId: comando.tenantId,
        fecha: comando.fechaEvento,
      });
      fechaAlternativa1 = alternativas.anterior ?? undefined;
      fechaAlternativa2 = alternativas.posterior ?? undefined;
    }

    const plantilla = this.deps.catalogo?.seleccionar('E1', idioma);
    const rendered = plantilla
      ? plantilla.render({
          nombre: resultado.cliente.nombre,
          tipoE1,
          ...(comando.fechaEvento !== undefined ? { fechaEvento: comando.fechaEvento } : {}),
          ...(fechaAlternativa1 !== undefined ? { fechaAlternativa1 } : {}),
          ...(fechaAlternativa2 !== undefined ? { fechaAlternativa2 } : {}),
        })
      : (() => {
          // Fallback mínimo cuando el catálogo no está disponible.
          // Se escapa el nombre para evitar email content injection en el HTML.
          const safeName = resultado.cliente.nombre
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
          return {
            asunto: ASUNTO_E1_PLACEHOLDER,
            cuerpoHtml: `<p>Hola ${safeName},</p><p>Hem rebut la teva consulta i et contactarem molt aviat.</p>`,
            cuerpoTexto: `Hola ${resultado.cliente.nombre},\n\nHem rebut la teva consulta i et contactarem molt aviat.`,
          };
        })();

    return { asunto: rendered.asunto, cuerpo: rendered.cuerpoHtml };
  }

  /**
   * Resuelve el sub-estado/acción del alta. Sin `fechaEvento` → entrada exploratoria
   * `2.a` (US-003). Con fecha → lee el estado de la fecha y aplica la tabla
   * declarativa `determinarAltaConFecha` (D-3); en `2.d` calcula la posición de cola
   * serializada (D-5). Se ejecuta DENTRO de la transacción (re-evaluable en D-6).
   */
  private async resolverPlanAlta(
    repos: RepositoriosAltaConsulta,
    comando: AltaConsultaComando,
    ttlBloqueo: Date | null,
  ): Promise<PlanAlta> {
    if (comando.fechaEvento === undefined) {
      const entrada = entradaInicialConsultaExploratoria();
      return {
        subEstado: entrada.subEstado,
        accion: 'exploratoria',
        ttlExpiracion: entrada.ttlExpiracion,
        fechaDisponible: null,
        avisoDisponibilidad: null,
      };
    }

    const fechaBloqueada = this.repoFechaBloqueada(repos);
    const estadoFecha = await fechaBloqueada.leerEstadoFecha({
      tenantId: comando.tenantId,
      fecha: comando.fechaEvento,
    });
    const resultado = determinarAltaConFecha(estadoFecha);

    if (resultado.accion === 'bloquear') {
      return {
        subEstado: '2b',
        accion: 'bloquear',
        ttlExpiracion: ttlBloqueo,
        fechaDisponible: true,
        avisoDisponibilidad: null,
      };
    }

    if (resultado.accion === 'encolar' && estadoFecha.tipo === 'bloqueada') {
      const posicionCola = await fechaBloqueada.siguientePosicionCola({
        tenantId: comando.tenantId,
        fecha: comando.fechaEvento,
        consultaBloqueanteId: estadoFecha.reservaBloqueanteId,
      });
      return {
        subEstado: '2d',
        accion: 'encolar',
        ttlExpiracion: null,
        posicionCola,
        consultaBloqueanteId: estadoFecha.reservaBloqueanteId,
        fechaDisponible: false,
        avisoDisponibilidad:
          'La fecha está reservada por otra consulta; tu solicitud queda en lista de espera.',
      };
    }

    // Exploratoria (2.a): fecha bloqueada por estado no encolable.
    return {
      subEstado: '2a',
      accion: 'exploratoria',
      ttlExpiracion: null,
      fechaDisponible: false,
      avisoDisponibilidad:
        'La fecha seleccionada no está disponible; la consulta queda como exploratoria.',
    };
  }

  /** Obtiene el repositorio de FECHA_BLOQUEADA de la UoW (debe existir en la rama con fecha). */
  private repoFechaBloqueada(
    repos: RepositoriosAltaConsulta,
  ): FechaBloqueadaAltaRepositoryPort {
    if (repos.fechaBloqueada === undefined) {
      throw new Error('La unidad de trabajo no expone el repositorio de FECHA_BLOQUEADA');
    }
    return repos.fechaBloqueada;
  }

  /** Calcula el TTL del bloqueo blando (now()+ttl_consulta_dias del tenant). */
  private async calcularTtlConsulta(tenantId: string, ahora: Date): Promise<Date> {
    const settings = this.deps.tenantSettings
      ? await this.deps.tenantSettings.obtener(tenantId)
      : null;
    const plan = resolverPlanBloqueo({
      fase: '2.b',
      ahora,
      settings: {
        ttlConsultaDias: settings?.ttlConsultaDias ?? TTL_CONSULTA_DIAS_DEFECTO,
        ttlPrereservaDias: settings?.ttlPrereservaDias ?? TTL_CONSULTA_DIAS_DEFECTO,
      },
    });
    return plan.ttl ?? new Date(ahora.getTime());
  }

  /**
   * Calcula la tarifa estimada de E1 de forma TOLERANTE (US-004 §D-4): solo si hay
   * fecha + invitados + horas; degrada a `null` ante faltas o cualquier error del
   * motor (la tarifa es decorativa, nunca un bloqueante del alta).
   */
  private async calcularTarifaTolerante(
    comando: AltaConsultaComando,
  ): Promise<TarifaEstimadaResultado | null> {
    if (
      this.deps.tarifaEstimada === undefined ||
      comando.fechaEvento === undefined ||
      comando.numAdultosNinosMayores4 === undefined ||
      comando.duracionHoras === undefined
    ) {
      return null;
    }
    try {
      const resultado = await this.deps.tarifaEstimada.estimar({
        tenantId: comando.tenantId,
        fechaEvento: comando.fechaEvento,
        duracionHoras: comando.duracionHoras,
        numAdultosNinosMayores4: comando.numAdultosNinosMayores4,
        extras: [],
      });
      return (resultado as TarifaEstimadaResultado | null) ?? null;
    } catch {
      return null;
    }
  }

  /** Validación de forma (obligatorios / longitudes / email / canal). */
  private validar(comando: AltaConsultaComando): ErrorCampo[] {
    const errores: ErrorCampo[] = [];
    const cliente = comando.cliente ?? ({} as AltaConsultaCliente);

    const nombre = (cliente.nombre ?? '').trim();
    if (nombre.length === 0) {
      errores.push({ campo: 'nombre', mensaje: 'El nombre es obligatorio' });
    } else if (nombre.length > MAX_NOMBRE) {
      errores.push({
        campo: 'nombre',
        mensaje: `El nombre no puede superar los ${MAX_NOMBRE} caracteres`,
      });
    }

    const apellidos = (cliente.apellidos ?? '').trim();
    if (apellidos.length === 0) {
      errores.push({ campo: 'apellidos', mensaje: 'Los apellidos son obligatorios' });
    } else if (apellidos.length > MAX_NOMBRE) {
      errores.push({
        campo: 'apellidos',
        mensaje: `Los apellidos no pueden superar los ${MAX_NOMBRE} caracteres`,
      });
    }

    const telefono = (cliente.telefono ?? '').trim();
    if (telefono.length === 0) {
      errores.push({ campo: 'telefono', mensaje: 'El teléfono es obligatorio' });
    }

    const email = (cliente.email ?? '').trim();
    if (email.length === 0) {
      errores.push({ campo: 'email', mensaje: 'El email es obligatorio' });
    } else if (!EMAIL_REGEX.test(email)) {
      errores.push({ campo: 'email', mensaje: 'El email no tiene un formato válido' });
    }

    if (!CANALES_VALIDOS.includes(comando.canalEntrada)) {
      errores.push({
        campo: 'canalEntrada',
        mensaje: 'El canal de entrada no está contemplado',
      });
    }

    if (comando.horario !== undefined) {
      if (!/^\d{2}:\d{2}$/.test(comando.horario)) {
        errores.push({ campo: 'horario', mensaje: 'El horario debe tener formato HH:MM' });
      }
      if (comando.duracionHoras === undefined) {
        errores.push({
          campo: 'horario',
          mensaje: 'El horario requiere que se indique también la duración (duracionHoras)',
        });
      }
    }

    return errores;
  }
}
