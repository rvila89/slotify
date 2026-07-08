/**
 * Caso de uso de APLICACIÓN: barrido de INICIO AUTOMÁTICO de evento en T-0 (US-031 /
 * UC-23, actor Sistema). Cierra el patrón "estado en fila + barrido periódico" (skill
 * `async-jobs`): NO hay timer en memoria; el trabajo pendiente es ESTADO en la BBDD
 * (`RESERVA.estado` + `fecha_evento` + los tres `*_status` + `cond_part_firmadas`).
 *
 * Orquesta el dominio puro a través de TRES puertos inyectados (hexagonal), en paralelo
 * estricto al barrido de US-012/US-026:
 *   1. `CandidatasInicioEventoPort.listarCandidatas()` — lectura CROSS-TENANT de las
 *      RESERVA con `estado = 'reserva_confirmada'` AND `date(fecha_evento) = date(hoy)`
 *      (D-4/D-5). La SELECCIÓN (filtro estricto por estado y por fecha de calendario) es
 *      del adaptador; aquí se procesa lo que la lista entrega. Cada fila trae su
 *      `tenantId`.
 *   2. `InicioEventoPort.iniciarEvento(candidata)` — UoW ATÓMICA por RESERVA: bajo el
 *      contexto RLS del tenant de LA candidata, `SELECT … FOR UPDATE`, re-evalúa la guarda
 *      de origen + las tres precondiciones y —si sigue siendo candidata y cumple—
 *      transiciona `reserva_confirmada → evento_en_curso` + AUDIT_LOG transición origen
 *      Sistema; si no cumple, NO transiciona y devuelve las precondiciones incumplidas;
 *      además señala A29 si `cond_part_firmadas = false`.
 *   3. `AlertaInicioEventoPort` — emite la alerta CRÍTICA (precondiciones incumplidas) y
 *      la alerta A29 (no bloqueante), sin acoplar la superficie de notificaciones (D-8).
 *
 * Cada candidata se procesa en su PROPIA transacción independiente con FALLO AISLADO
 * (semántica de lote de US-012/US-026, D-6/D-7): el fallo de una NO aborta el lote; el
 * resumen registra el fallo aislado. A29 se emite con INDEPENDENCIA del resultado de la
 * transición (D-8).
 *
 * Hexagonal: depende SOLO de puertos; no importa Prisma ni `@nestjs/*`.
 */
import type {
  FianzaStatusDominio,
  LiquidacionStatusDominio,
  PreEventoStatusDominio,
} from '../domain/maquina-estados';

// ---------------------------------------------------------------------------
// Tipos del dominio del barrido
// ---------------------------------------------------------------------------

/**
 * Proyección mínima de una RESERVA candidata al inicio de evento, tal como la devuelve la
 * lectura cross-tenant. El `tenantId` viaja con la fila (D-5): las mutaciones lo reponen
 * para el contexto RLS, nunca lo toman de input externo.
 */
export interface EventoCandidato {
  reservaId: string;
  tenantId: string;
  /** Fecha del evento (T-0 = hoy); la candidatura se decide por fecha de calendario. */
  fechaEvento: Date;
  preEventoStatus: PreEventoStatusDominio;
  liquidacionStatus: LiquidacionStatusDominio;
  fianzaStatus: FianzaStatusDominio;
  /** `false` dispara la alerta A29 (no bloqueante), con independencia de la transición. */
  condPartFirmadas: boolean;
}

/**
 * Desenlace del inicio de UNA RESERVA (lo devuelve la UoW por-reserva).
 *  - `iniciado = true`: la transición se aplicó en esta pasada (las tres precondiciones se
 *    cumplían y la guarda de origen seguía válida bajo el lock).
 *  - `iniciado = false` con `precondicionesIncumplidas` no nulo: NO se transiciona; la
 *    lista enumera las precondiciones que faltan (para la alerta crítica).
 *  - `iniciado = false` con `precondicionesIncumplidas = null`: bajo el lock ya NO era
 *    candidata (otro pase o el gestor US-032 la dejó en `evento_en_curso`): no-op
 *    idempotente, no cuenta como iniciada, incumplida ni fallo.
 *  - `condPartNoFirmadas`: refleja `cond_part_firmadas = false` de la fila leída bajo el
 *    lock; dispara A29 con independencia del resultado de la transición.
 */
export interface ResultadoInicioEvento {
  reservaId: string;
  iniciado: boolean;
  precondicionesIncumplidas: string[] | null;
  condPartNoFirmadas: boolean;
}

/** Resumen agregado del barrido (shape del contrato `BarridoEventosResponse`). */
export interface ResumenBarridoEventos {
  candidatas: number;
  eventosIniciados: number;
  precondicionesIncumplidas: number;
  fallos: number;
}

/** Datos de la alerta CRÍTICA por precondiciones incumplidas (D-8). */
export interface AlertaPrecondicionesIncumplidas {
  reservaId: string;
  tenantId: string;
  incumplidas: string[];
}

/** Datos de la alerta A29 (no bloqueante) por condiciones particulares no firmadas (D-8). */
export interface AlertaA29 {
  reservaId: string;
  tenantId: string;
}

// ---------------------------------------------------------------------------
// Puertos (interfaces) — implementados en infraestructura (adaptadores Prisma)
// ---------------------------------------------------------------------------

/**
 * Lectura CROSS-TENANT de las candidatas al inicio de evento (D-5). Selecciona por FECHA
 * DE CALENDARIO (`date(fecha_evento) = date(hoy)`) AND `estado = 'reserva_confirmada'`, sin
 * fijar tenant (rol técnico del proceso de Sistema); cada fila trae su `tenantId` para la
 * mutación RLS.
 */
export interface CandidatasInicioEventoPort {
  listarCandidatas(): Promise<EventoCandidato[]>;
}

/**
 * UoW atómica por RESERVA: abre una transacción bajo el contexto RLS del tenant de la
 * candidata, toma `SELECT … FOR UPDATE` sobre la fila RESERVA, re-evalúa la guarda de
 * origen + las tres precondiciones y —si sigue siendo candidata y cumple— aplica la
 * transición + auditoría origen Sistema. Devuelve el desenlace para agregar el resumen y
 * alimentar las alertas. Un fallo se PROPAGA para que el use-case lo aísle (rollback de
 * solo esa transacción).
 */
export interface InicioEventoPort {
  iniciarEvento(candidata: EventoCandidato): Promise<ResultadoInicioEvento>;
}

/**
 * Emisión de alertas del inicio de evento (D-8), desacoplada de la superficie de
 * notificaciones (US-044): la crítica por precondiciones incumplidas y la A29 no
 * bloqueante por condiciones particulares no firmadas.
 */
export interface AlertaInicioEventoPort {
  emitirPrecondicionesIncumplidas(alerta: AlertaPrecondicionesIncumplidas): Promise<void>;
  emitirA29(alerta: AlertaA29): Promise<void>;
}

/** Dependencias del caso de uso (puertos inyectados, hexagonal). */
export interface IniciarEventosDelDiaDeps {
  candidatas: CandidatasInicioEventoPort;
  inicio: InicioEventoPort;
  alerta: AlertaInicioEventoPort;
}

// ---------------------------------------------------------------------------
// Caso de uso
// ---------------------------------------------------------------------------

export class IniciarEventosDelDiaService {
  constructor(private readonly deps: IniciarEventosDelDiaDeps) {}

  /**
   * Ejecuta un barrido idempotente: lista las candidatas cross-tenant y procesa cada una
   * en su propia transacción con FALLO AISLADO (D-6). Por cada candidata: si se inicia,
   * cuenta el evento; si tiene precondiciones incumplidas, cuenta y emite la alerta
   * crítica; si bajo el lock ya no era candidata, no-op idempotente; A29 se emite con
   * independencia del resultado. El resumen agrega candidatas, eventos iniciados,
   * precondiciones incumplidas y fallos aislados.
   */
  async ejecutar(): Promise<ResumenBarridoEventos> {
    const candidatas = await this.deps.candidatas.listarCandidatas();

    const resumen: ResumenBarridoEventos = {
      candidatas: candidatas.length,
      eventosIniciados: 0,
      precondicionesIncumplidas: 0,
      fallos: 0,
    };

    // Secuencial con fallo aislado por RESERVA: cada `iniciarEvento` abre su propia
    // transacción; una excepción se captura y NO aborta el lote (semántica de US-012/026).
    for (const candidata of candidatas) {
      try {
        const resultado = await this.deps.inicio.iniciarEvento(candidata);

        if (resultado.iniciado) {
          resumen.eventosIniciados += 1;
        } else if (resultado.precondicionesIncumplidas !== null) {
          // NO transiciona: alerta crítica al gestor con las precondiciones incumplidas.
          resumen.precondicionesIncumplidas += 1;
          await this.deps.alerta.emitirPrecondicionesIncumplidas({
            reservaId: candidata.reservaId,
            tenantId: candidata.tenantId,
            incumplidas: resultado.precondicionesIncumplidas,
          });
        }
        // `iniciado = false` + `precondicionesIncumplidas = null`: no-op idempotente (bajo
        // lock ya no era candidata) → no cuenta ni alerta (D-4/D-6).

        // A29 no bloqueante: se emite con INDEPENDENCIA del resultado de la transición.
        if (resultado.condPartNoFirmadas) {
          await this.deps.alerta.emitirA29({
            reservaId: candidata.reservaId,
            tenantId: candidata.tenantId,
          });
        }
      } catch {
        resumen.fallos += 1;
      }
    }

    return resumen;
  }
}
