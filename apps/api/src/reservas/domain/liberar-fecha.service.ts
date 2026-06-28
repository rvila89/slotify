/**
 * Operación de dominio `liberarFecha()` (US-041 / UC-31) — DOMINIO PURO.
 *
 * Complemento atómico de `bloquearFecha()` (US-040): elimina la fila de
 * `FECHA_BLOQUEADA` de una `(tenant_id, fecha)` de forma idempotente y, si había
 * una cola apuntando a la reserva liberada, dispara POST-COMMIT el seam de
 * promoción (US-018). Dolores D4/D13.
 *
 * Hexagonal (hook `no-infra-in-domain`): este módulo NO importa `@nestjs/*`,
 * Prisma ni infraestructura. Depende solo de PUERTOS (interfaces) que la
 * infraestructura implementa con adaptadores. La única dependencia es hacia otro
 * módulo de DOMINIO (`bloquear-fecha.service`) para reutilizar `TipoBloqueoDominio`.
 *
 * Orden de evaluación (design.md §D-3..D-8), garantía exactamente-una-vez:
 *   1. Consultar el bloqueo actual (lectura) para resolver la guarda firme.
 *   2. Guarda firme declarativa (D-5): un bloqueo `firme` solo se libera si su
 *      RESERVA está `reserva_cancelada`; en caso contrario se audita la tentativa
 *      como `rechazo_firme` y se lanza error SIN tocar el DELETE.
 *   3. DELETE serializado devolviendo rows-affected (D-4) en una transacción.
 *   4a. rows = 0  → idempotencia: éxito silencioso, tentativa auditada, SIN promoción.
 *   4b. rows = 1  → auditar la liberación con su causa; si hay cola activa apuntando
 *       a la reserva liberada, disparar la promoción FUERA de la transacción del
 *       DELETE (post-commit), exactamente una vez.
 *
 * La liberación NO posee ningún puerto de ESCRITURA de la RESERVA (D-7, §3.7): solo
 * lee su estado para la guarda firme.
 */
import type { AuditLogPort, RegistroAuditoria } from '../../shared/audit/audit-log.port';
import type { TipoBloqueoDominio } from './bloquear-fecha.service';

// Re-export del puerto de auditoría COMPARTIDO (extraído a `shared/audit`): los
// consumidores de reservas siguen importándolo desde aquí sin cambios.
export type { AuditLogPort } from '../../shared/audit/audit-log.port';

// ---------------------------------------------------------------------------
// Tipos de dominio
// ---------------------------------------------------------------------------

/** Estados de la RESERVA contemplados por la máquina de estados (er-diagram). */
export type EstadoReservaDominio =
  | 'consulta'
  | 'pre_reserva'
  | 'reserva_confirmada'
  | 'evento_en_curso'
  | 'post_evento'
  | 'reserva_completada'
  | 'reserva_cancelada';

/** Causa de la liberación, propagada al AUDIT_LOG (D-8). */
export type CausaLiberacion = 'TTL' | 'descarte' | 'cancelacion';

/** Resultado del registro de auditoría de una tentativa de liberación. */
export type ResultadoLiberacionAudit = 'liberada' | 'tentativa_idempotente' | 'rechazo_firme';

/** Comando de entrada de `liberarFecha()`. */
export interface LiberarFechaComando {
  tenantId: string;
  fecha: Date;
  causa: CausaLiberacion;
}

/** Resultado canónico de una liberación (éxito o no-op idempotente). */
export interface LiberacionResultado {
  liberada: boolean;
  filasAfectadas: number;
  promocionDisparada: boolean;
}

// ---------------------------------------------------------------------------
// Puertos (interfaces) — implementados en infraestructura (adaptadores Prisma)
// ---------------------------------------------------------------------------

/** Datos mínimos del bloqueo vigente (lectura para la guarda firme). */
export interface BloqueoActual {
  reservaId: string;
  tipoBloqueo: TipoBloqueoDominio;
}

/** Resultado del DELETE serializado: filas afectadas + datos de la fila eliminada. */
export interface ResultadoLiberacionFila {
  filasAfectadas: number;
  reservaIdLiberada: string | null;
  tipoBloqueo: TipoBloqueoDominio | null;
}

/**
 * Repositorio transaccional de liberación de `FECHA_BLOQUEADA`. `consultarBloqueo`
 * es una lectura para la guarda; `liberar` encapsula la transacción `SELECT … FOR
 * UPDATE` + `DELETE`, devolviendo rows-affected como primitiva (D-4).
 */
export interface FechaBloqueadaLiberacionPort {
  consultarBloqueo(params: { tenantId: string; fecha: Date }): Promise<BloqueoActual | null>;
  liberar(params: { tenantId: string; fecha: Date }): Promise<ResultadoLiberacionFila>;
}

/** Lee el estado de la RESERVA para la guarda firme (D-5). LECTURA pura. */
export interface ReservaEstadoPort {
  obtenerEstado(params: {
    reservaId: string;
    tenantId?: string;
  }): Promise<EstadoReservaDominio | null>;
}

/** Detecta si hay cola activa apuntando a la reserva liberada (D-2). LECTURA pura. */
export interface ColaQueryPort {
  hayColaActiva(params: { reservaBloqueanteId: string; tenantId?: string }): Promise<boolean>;
}

/**
 * Seam de promoción de cola (US-018). La liberación lo dispara post-commit; el
 * adaptador real (stub no-op hasta US-018) decide el efecto.
 */
export interface PromocionColaPort {
  promoverPrimeroEnCola(params: { tenantId: string; fecha: Date }): Promise<void>;
}

/**
 * Registro inmutable de una tentativa de liberación en el AUDIT_LOG (D-8). Extiende
 * el `RegistroAuditoria` compartido, estrechando `accion`/`entidad` y añadiendo la
 * causa y el resultado específicos de la liberación.
 */
export interface RegistroAuditoriaLiberacion extends RegistroAuditoria {
  accion: 'eliminar';
  entidad: 'FECHA_BLOQUEADA';
  entidadId: string;
  causa: CausaLiberacion;
  resultado: ResultadoLiberacionAudit;
  fecha: Date;
  reservaId: string | null;
}

/** Dependencias del servicio: puertos inyectados (hexagonal). */
export interface LiberarFechaDeps {
  repositorio: FechaBloqueadaLiberacionPort;
  reservaEstado: ReservaEstadoPort;
  cola: ColaQueryPort;
  promocion: PromocionColaPort;
  auditoria: AuditLogPort<RegistroAuditoriaLiberacion>;
}

// ---------------------------------------------------------------------------
// Errores de dominio tipados, en español
// ---------------------------------------------------------------------------

/**
 * Se intentó liberar un bloqueo `firme` cuya RESERVA no está cancelada. La guarda
 * firme (D-5) prohíbe destruir el bloqueo firme de una reserva viva: la fila queda
 * intacta (el DELETE nunca se ejecuta) y el intento se audita como `rechazo_firme`.
 */
export class LiberacionBloqueoFirmeNoPermitidaError extends Error {
  readonly codigo = 'LIBERACION_BLOQUEO_FIRME_NO_PERMITIDA' as const;
  readonly tenantId: string;
  readonly fecha: Date;
  readonly reservaId: string;
  readonly estadoReserva: EstadoReservaDominio | null;

  constructor(
    tenantId: string,
    fecha: Date,
    reservaId: string,
    estadoReserva: EstadoReservaDominio | null,
  ) {
    super('No se puede liberar un bloqueo firme de una reserva no cancelada');
    this.name = 'LiberacionBloqueoFirmeNoPermitidaError';
    this.tenantId = tenantId;
    this.fecha = fecha;
    this.reservaId = reservaId;
    this.estadoReserva = estadoReserva;
  }
}

// ---------------------------------------------------------------------------
// Guarda firme declarativa (D-5) — estructura de datos, no condicionales dispersos
// ---------------------------------------------------------------------------

/**
 * Estados de la RESERVA en los que se PERMITE liberar un bloqueo `firme`. Es una
 * tabla de datos (no `if/else` disperso): un firme solo se libera si la reserva ya
 * está cancelada (descarte/cancelación), nunca mientras la reserva está viva.
 */
const ESTADOS_QUE_PERMITEN_LIBERAR_FIRME: ReadonlySet<EstadoReservaDominio> = new Set<EstadoReservaDominio>([
  'reserva_cancelada',
]);

/** Guarda firme pura: ¿se puede liberar un bloqueo firme en este estado? */
export const liberacionFirmePermitida = (estado: EstadoReservaDominio): boolean =>
  ESTADOS_QUE_PERMITEN_LIBERAR_FIRME.has(estado);

/** Día natural en formato `YYYY-MM-DD` (UTC) para identificar el bloqueo. */
const formatearFecha = (fecha: Date): string => fecha.toISOString().slice(0, 10);

// ---------------------------------------------------------------------------
// Servicio de dominio
// ---------------------------------------------------------------------------

export class LiberarFechaService {
  constructor(private readonly deps: LiberarFechaDeps) {}

  async ejecutar(comando: LiberarFechaComando): Promise<LiberacionResultado> {
    const { tenantId, fecha, causa } = comando;

    // Paso 1: leer el bloqueo vigente (lectura para la guarda firme).
    const bloqueo = await this.deps.repositorio.consultarBloqueo({ tenantId, fecha });

    // Paso 2: guarda firme (D-5). PREVIA al DELETE: si rechaza, la fila queda
    // intacta y el intento se audita como `rechazo_firme`.
    if (bloqueo !== null && bloqueo.tipoBloqueo === 'firme') {
      const estado = await this.deps.reservaEstado.obtenerEstado({
        reservaId: bloqueo.reservaId,
        tenantId,
      });
      if (estado === null || !liberacionFirmePermitida(estado)) {
        await this.deps.auditoria.registrar({
          tenantId,
          accion: 'eliminar',
          entidad: 'FECHA_BLOQUEADA',
          entidadId: bloqueo.reservaId,
          causa,
          resultado: 'rechazo_firme',
          fecha,
          reservaId: bloqueo.reservaId,
        });
        throw new LiberacionBloqueoFirmeNoPermitidaError(
          tenantId,
          fecha,
          bloqueo.reservaId,
          estado,
        );
      }
    }

    // Paso 3: DELETE serializado devolviendo rows-affected (D-4).
    const { filasAfectadas, reservaIdLiberada } = await this.deps.repositorio.liberar({
      tenantId,
      fecha,
    });

    // Paso 4a: idempotencia — DELETE de 0 filas es éxito silencioso, tentativa
    // auditada, SIN promoción (otra TX liberó antes).
    if (filasAfectadas === 0) {
      await this.deps.auditoria.registrar({
        tenantId,
        accion: 'eliminar',
        entidad: 'FECHA_BLOQUEADA',
        entidadId: formatearFecha(fecha),
        causa,
        resultado: 'tentativa_idempotente',
        fecha,
        reservaId: null,
      });
      return { liberada: false, filasAfectadas: 0, promocionDisparada: false };
    }

    // Paso 4b: liberación efectiva — auditar con su causa.
    await this.deps.auditoria.registrar({
      tenantId,
      accion: 'eliminar',
      entidad: 'FECHA_BLOQUEADA',
      entidadId: reservaIdLiberada ?? formatearFecha(fecha),
      causa,
      resultado: 'liberada',
      fecha,
      reservaId: reservaIdLiberada,
    });

    // Paso 5: disparo POST-COMMIT del seam de promoción (D-2), exactamente una vez
    // y solo si hay cola activa apuntando a la reserva liberada.
    let promocionDisparada = false;
    if (reservaIdLiberada !== null) {
      const hayCola = await this.deps.cola.hayColaActiva({
        reservaBloqueanteId: reservaIdLiberada,
        tenantId,
      });
      if (hayCola) {
        await this.deps.promocion.promoverPrimeroEnCola({ tenantId, fecha });
        promocionDisparada = true;
      }
    }

    return { liberada: true, filasAfectadas, promocionDisparada };
  }
}
