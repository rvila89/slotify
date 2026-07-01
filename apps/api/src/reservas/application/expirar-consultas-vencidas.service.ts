/**
 * Caso de uso de APLICACIÓN: barrido de EXPIRACIÓN de consultas por TTL agotado
 * (US-012 / UC-09, actor Sistema). Cierra el patrón "estado en fila + barrido
 * periódico" (skill `async-jobs`): NO hay timer en memoria; el trabajo pendiente es
 * ESTADO en la BBDD (`RESERVA.ttl_expiracion` + `estado`/`sub_estado`).
 *
 * Orquesta el dominio puro a través de DOS puertos inyectados (hexagonal):
 *   1. `CandidatasExpiracionPort.listarCandidatas()` — lectura CROSS-TENANT de las
 *      RESERVA con `ttl_expiracion < now()` AND estados candidatos (`2b/2c/2v` o
 *      `pre_reserva`). Único punto cross-tenant legítimo del sistema (D-6); la
 *      comparación es por INSTANTE `timestamptz`, nunca por fecha formateada (D-7).
 *   2. `ExpiracionReservaPort.expirarReserva(candidata)` — UoW ATÓMICA por RESERVA:
 *      bajo `SELECT … FOR UPDATE` re-evalúa la guarda de origen (`resolverExpiracionTtl`,
 *      idempotencia + RC-1), aplica la transición de estado, invoca `liberarFecha()`
 *      (US-041: libera + audita + dispara el seam de promoción si hay cola), y bajo
 *      el contexto RLS del `tenantId` de LA candidata (nunca de input externo).
 *
 * Cada candidata se procesa en su PROPIA transacción independiente con FALLO AISLADO
 * (semántica de `LiberarFechasEnLoteService`, D-9): el fallo de una NO aborta el lote;
 * el resumen registra el fallo aislado. El seam de promoción se DISPARA exactamente
 * una vez por expiración con cola (D-8); la reordenación FIFO/re-bloqueo (A15) es de
 * US-018 (aquí solo el trigger).
 *
 * Hexagonal: depende SOLO de puertos; no importa Prisma ni `@nestjs/*`.
 */
import type {
  EstadoReserva,
  SubEstadoConsulta,
} from '../domain/maquina-estados';

// ---------------------------------------------------------------------------
// Tipos del dominio del barrido
// ---------------------------------------------------------------------------

/**
 * Proyección mínima de una RESERVA candidata a expirar, tal como la devuelve la
 * lectura cross-tenant. El `tenantId` viaja con la fila (D-6): las mutaciones lo
 * reponen para el contexto RLS, nunca lo toman de input externo.
 */
export interface ReservaCandidata {
  reservaId: string;
  tenantId: string;
  /** Fecha del evento bloqueado (clave de `FECHA_BLOQUEADA` a liberar). */
  fecha: Date;
  estado: EstadoReserva;
  subEstado: SubEstadoConsulta | null;
  /** Instante de vencimiento (`timestamptz`); la candidatura se decide por instante. */
  ttlExpiracion: Date | null;
}

/**
 * Desenlace de la expiración de UNA RESERVA (lo devuelve la UoW por-reserva). Si bajo
 * el lock la RESERVA dejó de ser candidata (otra TX la expiró, o US-006 extendió el
 * TTL), `expirada = false` (no cuenta como expirada ni como fallo: idempotencia).
 */
export interface ResultadoExpiracionReserva {
  reservaId: string;
  /** `true` si la transición se aplicó en esta pasada; `false` si ya no era candidata. */
  expirada: boolean;
  estadoFinal: EstadoReserva;
  subEstadoFinal: SubEstadoConsulta | null;
  /** `true` si el DELETE de `FECHA_BLOQUEADA` afectó a una fila (US-041). */
  fechaLiberada: boolean;
  /** `true` si se disparó el seam de promoción de cola (US-018), exactamente una vez. */
  promocionDisparada: boolean;
}

/** Resumen agregado del barrido (shape del contrato `BarridoExpiracionResponse`). */
export interface ResumenBarrido {
  candidatas: number;
  expiradas: number;
  promocionesDisparadas: number;
  fallos: number;
}

// ---------------------------------------------------------------------------
// Puertos (interfaces) — implementados en infraestructura (adaptadores Prisma)
// ---------------------------------------------------------------------------

/**
 * Lectura CROSS-TENANT de las candidatas a expirar (D-6). Selecciona por INSTANTE
 * (`ttl_expiracion < now()`) AND estados candidatos, sin fijar tenant (rol técnico
 * del proceso de Sistema); cada fila trae su `tenantId` para la mutación RLS.
 */
export interface CandidatasExpiracionPort {
  listarCandidatas(): Promise<ReservaCandidata[]>;
}

/**
 * UoW atómica por RESERVA: abre una transacción bajo el contexto RLS del tenant de la
 * candidata, toma `SELECT … FOR UPDATE` sobre la fila bloqueante, re-evalúa la guarda
 * de origen y —si sigue siendo candidata— aplica la transición + liberación + seam.
 * Devuelve el desenlace para agregar el resumen. Un fallo se PROPAGA para que el
 * use-case lo aísle (rollback de solo esa transacción).
 */
export interface ExpiracionReservaPort {
  expirarReserva(candidata: ReservaCandidata): Promise<ResultadoExpiracionReserva>;
}

/** Dependencias del caso de uso (puertos inyectados, hexagonal). */
export interface ExpirarConsultasVencidasDeps {
  candidatas: CandidatasExpiracionPort;
  expiracion: ExpiracionReservaPort;
}

// ---------------------------------------------------------------------------
// Caso de uso
// ---------------------------------------------------------------------------

export class ExpirarConsultasVencidasService {
  constructor(private readonly deps: ExpirarConsultasVencidasDeps) {}

  /**
   * Ejecuta un barrido idempotente: lista las candidatas cross-tenant y procesa cada
   * una en su propia transacción con FALLO AISLADO (D-9). El resumen agrega candidatas,
   * expiradas, promociones disparadas y fallos aislados.
   */
  async ejecutar(): Promise<ResumenBarrido> {
    const candidatas = await this.deps.candidatas.listarCandidatas();

    const resumen: ResumenBarrido = {
      candidatas: candidatas.length,
      expiradas: 0,
      promocionesDisparadas: 0,
      fallos: 0,
    };

    // Secuencial con fallo aislado por RESERVA: cada `expirarReserva` abre su propia
    // transacción; una excepción se captura y NO aborta el lote (semántica de lote de
    // `LiberarFechasEnLoteService`, US-041 §D-9).
    for (const candidata of candidatas) {
      try {
        const resultado = await this.deps.expiracion.expirarReserva(candidata);
        // Idempotencia: si bajo lock ya no era candidata (`expirada=false`), no cuenta
        // como expirada ni como fallo (D-4).
        if (resultado.expirada) {
          resumen.expiradas += 1;
          if (resultado.promocionDisparada) {
            resumen.promocionesDisparadas += 1;
          }
        }
      } catch {
        resumen.fallos += 1;
      }
    }

    return resumen;
  }
}
