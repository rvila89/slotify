/**
 * Puertos y tipos compartidos de la FICHA_OPERATIVA (US-025 / UC-20) — DOMINIO PURO.
 *
 * Define la vista de lectura de la RESERVA con su ficha, el modelo de ficha, los
 * errores de dominio y los puertos que la aplicación orquesta (carga, unidad de
 * trabajo transaccional con repositorios ligados, reloj y auditoría). Los adaptadores
 * Prisma viven en `infrastructure/` (hexagonal, hook `no-infra-in-domain`).
 */
import type { PreEventoStatus } from './maquina-estados-pre-evento';
import type { AuditLogPort } from '../../shared/audit/audit-log.port';

export type { PreEventoStatus };

/**
 * Estados de la RESERVA relevantes para la guarda de acceso a la ficha (§D-3). La
 * ficha es accesible en {reserva_confirmada, evento_en_curso, post_evento}; cualquier
 * estado anterior devuelve "no disponible".
 */
export type EstadoReservaFicha =
  | 'consulta'
  | 'pre_reserva'
  | 'reserva_confirmada'
  | 'evento_en_curso'
  | 'post_evento'
  | 'reserva_completada';

/** Vista de la FICHA_OPERATIVA (contenido + estado de cierre + sub-proceso). */
export interface FichaOperativa {
  idFicha: string;
  reservaId: string;
  numInvitadosConfirmado: number | null;
  contactoEventoNombre: string | null;
  contactoEventoTelefono: string | null;
  contactoEventoCorreo: string | null;
  horaLlegada: string | null;
  duracion: string | null;
  notasOperativas: string | null;
  briefingEquipo: string | null;
  fichaCerrada: boolean;
  fechaCierre: Date | null;
  preEventoStatus: PreEventoStatus;
}

/** RESERVA cargada con su ficha (o `null` si aún no existe, estado anterior). */
export interface ReservaFichaOperativa {
  idReserva: string;
  tenantId: string;
  estado: EstadoReservaFicha;
  ficha: FichaOperativa | null;
}

/** Subconjunto de campos de contenido a persistir en un guardado parcial (§D-5). */
export type CamposFichaOperativa = Partial<
  Pick<
    FichaOperativa,
    | 'numInvitadosConfirmado'
    | 'contactoEventoNombre'
    | 'contactoEventoTelefono'
    | 'contactoEventoCorreo'
    | 'horaLlegada'
    | 'duracion'
    | 'notasOperativas'
    | 'briefingEquipo'
  >
>;

/** Reloj inyectable (aísla `new Date()` para determinismo/tests). */
export interface ClockPort {
  ahora(): Date;
}

/** Datos del cierre de la ficha (§D-6). */
export interface DatosCierreFicha {
  fichaCerrada: boolean;
  fechaCierre: Date;
  preEventoStatus: PreEventoStatus;
}

/**
 * Repositorio de la ficha operativa ligado a la unidad de trabajo del GUARDADO
 * parcial (§D-2/§D-4). Todas las operaciones ocurren en la MISMA transacción.
 */
export interface FichaGuardadoRepositoryPort {
  /** Persiste el subconjunto de campos enviado y devuelve la ficha resultante. */
  guardarCampos(reservaId: string, campos: CamposFichaOperativa): Promise<FichaOperativa>;
  /** Transiciona `pre_evento_status` de la RESERVA (máquina de estados). */
  transicionarPreEvento(reservaId: string, destino: PreEventoStatus): Promise<void>;
  /** Reescribe `fecha_cierre = now()` en la edición post-cierre (§D-4). */
  tocarFechaCierre(reservaId: string, fechaCierre: Date): Promise<void>;
}

/** Repositorio de la ficha operativa ligado a la unidad de trabajo del CIERRE (§D-6). */
export interface FichaCierreRepositoryPort {
  /** Cierra la ficha (`ficha_cerrada`, `fecha_cierre`, `pre_evento_status`). */
  cerrar(reservaId: string, datos: DatosCierreFicha): Promise<FichaOperativa>;
}

/** Repositorios expuestos dentro de la unidad de trabajo del guardado parcial. */
export interface RepositoriosGuardadoFicha {
  ficha: FichaGuardadoRepositoryPort;
  auditoria: AuditLogPort;
}

/** Repositorios expuestos dentro de la unidad de trabajo del cierre. */
export interface RepositoriosCierreFicha {
  ficha: FichaCierreRepositoryPort;
  auditoria: AuditLogPort;
}

/**
 * Unidad de trabajo transaccional genérica: abre UNA `$transaction` (con RLS `SET
 * LOCAL app.tenant_id`) y ejecuta el `trabajo` con los repositorios `R` ligados a
 * ella. Cada caso de uso la parametriza con su conjunto de repositorios.
 */
export interface UnidadDeTrabajoFichaPort<R> {
  ejecutar<T>(tenantId: string, trabajo: (repos: R) => Promise<T>): Promise<unknown>;
}

/** Puerto de carga de la RESERVA + ficha filtrada por tenant (RLS). */
export interface CargarReservaConFichaPort {
  (params: {
    tenantId: string;
    reservaId: string;
  }): Promise<ReservaFichaOperativa | null | undefined>;
}

/**
 * Error de dominio: la ficha operativa no está disponible porque la RESERVA está en
 * un estado anterior a `reserva_confirmada` (§D-3). El controlador lo mapea a
 * `409` con `code: 'ficha_no_disponible'` SIN exponer la entidad.
 */
export class FichaNoDisponibleError extends Error {
  readonly code = 'ficha_no_disponible' as const;

  constructor(
    message = 'La ficha operativa estará disponible una vez confirmada la reserva',
  ) {
    super(message);
    this.name = 'FichaNoDisponibleError';
  }
}

/**
 * Error de dominio: la RESERVA no existe para el tenant (o es de otro tenant, invisible
 * por RLS). El controlador lo mapea a `404` sin exponer la ficha ajena.
 */
export class ReservaNoEncontradaError extends Error {
  constructor(message = 'La reserva no existe') {
    super(message);
    this.name = 'ReservaNoEncontradaError';
  }
}

/**
 * Señal de dominio (coordinación de concurrencia C-2): al re-evaluar la guarda de la
 * máquina de estados DENTRO de la transacción (bajo `SELECT … FOR UPDATE`), la ficha ya
 * estaba `cerrado`. Es decir, el cierre manual (US-025) PERDIÓ la carrera contra otra
 * vía que ya la cerró (el barrido automático A10 de US-026, u otro cierre concurrente).
 *
 * La UoW aborta la transacción SIN mutar ni auditar (idempotencia: exactamente UNA vía
 * aplica `→ cerrado`, la otra se autoexcluye). NO es un error HTTP: el caso de uso lo
 * intercepta y resuelve el cierre manual de forma IDEMPOTENTE (la ficha YA está en el
 * estado deseado por el gestor), devolviendo la ficha cerrada actual → HTTP 200.
 */
export class FichaYaCerradaError extends Error {
  constructor(message = 'La ficha ya estaba cerrada (transición no aplicable)') {
    super(message);
    this.name = 'FichaYaCerradaError';
  }
}

/** Estados en los que la ficha operativa es accesible (§D-3). */
const ESTADOS_ACCESIBLES: ReadonlyArray<EstadoReservaFicha> = [
  'reserva_confirmada',
  'evento_en_curso',
  'post_evento',
];

/** ¿La RESERVA está en un estado que permite acceder a la ficha operativa? */
export const permiteAccederFicha = (estado: EstadoReservaFicha): boolean =>
  ESTADOS_ACCESIBLES.includes(estado);
