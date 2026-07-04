/**
 * Caso de uso de APLICACIÓN: barrido de CIERRE AUTOMÁTICO de la ficha operativa en
 * T-1d (US-026 / UC-20 FA-01, actor Sistema). Cierra el patrón "estado en fila +
 * barrido periódico" (skill `async-jobs`): NO hay timer en memoria; el trabajo
 * pendiente es ESTADO en la BBDD (`RESERVA.fecha_evento` + `pre_evento_status` +
 * `estado`).
 *
 * Orquesta el dominio puro a través de DOS puertos inyectados (hexagonal), en paralelo
 * estricto al barrido de expiración de US-012:
 *   1. `CandidatasCierreFichaPort.listarCandidatas()` — lectura CROSS-TENANT de las
 *      RESERVA con `estado = 'reserva_confirmada'` AND `pre_evento_status != 'cerrado'`
 *      AND `date(fecha_evento) = date(hoy) + 1 día` (D-4). La SELECCIÓN es del adaptador;
 *      aquí se cierra lo que la lista entrega. Cada fila trae su `tenantId`.
 *   2. `CierreFichaVencidaPort.cerrarFicha(candidata)` — UoW ATÓMICA por RESERVA: bajo
 *      el contexto RLS del tenant de LA candidata, re-evalúa la guarda A10 dentro de la
 *      transacción y —si sigue siendo candidata— cierra la ficha (`ficha_cerrada = true`,
 *      `fecha_cierre = now()`, `pre_evento_status → cerrado`) + AUDIT_LOG transición
 *      origen Sistema causa A10.
 *
 * Cada candidata se procesa en su PROPIA transacción independiente con FALLO AISLADO
 * (semántica de lote de US-012, D-6/D-7): el fallo de una NO aborta el lote; el resumen
 * registra el fallo aislado.
 *
 * Hexagonal: depende SOLO de puertos; no importa Prisma ni `@nestjs/*`.
 */
import type { PreEventoStatus } from '../domain/maquina-estados-pre-evento';

// ---------------------------------------------------------------------------
// Tipos del dominio del barrido
// ---------------------------------------------------------------------------

/**
 * Proyección mínima de una RESERVA candidata al cierre A10, tal como la devuelve la
 * lectura cross-tenant. El `tenantId` viaja con la fila (D-5): las mutaciones lo reponen
 * para el contexto RLS, nunca lo toman de input externo.
 */
export interface FichaCandidataCierre {
  reservaId: string;
  tenantId: string;
  /** Fecha del evento (T-1d = mañana); la candidatura se decide por fecha de calendario. */
  fechaEvento: Date;
  preEventoStatus: PreEventoStatus;
}

/**
 * Desenlace del cierre de UNA RESERVA (lo devuelve la UoW por-reserva). Si bajo la
 * transacción la RESERVA dejó de ser candidata (otra TX la cerró, o el cierre manual de
 * US-025 ganó la carrera), `cerrada = false` (no cuenta como cerrada ni como fallo:
 * idempotencia).
 */
export interface ResultadoCierreFicha {
  reservaId: string;
  /** `true` si el cierre se aplicó en esta pasada; `false` si ya no era candidata. */
  cerrada: boolean;
  preEventoStatusAnterior: PreEventoStatus;
}

/** Resumen agregado del barrido (shape del contrato `BarridoFichasResumen`). */
export interface ResumenBarridoFichas {
  candidatas: number;
  fichasCerradas: number;
  fallos: number;
}

// ---------------------------------------------------------------------------
// Puertos (interfaces) — implementados en infraestructura (adaptadores Prisma)
// ---------------------------------------------------------------------------

/**
 * Lectura CROSS-TENANT de las candidatas al cierre A10 (D-5). Selecciona por FECHA DE
 * CALENDARIO (`date(fecha_evento) = date(hoy) + 1 día`) AND `estado = 'reserva_confirmada'`
 * AND `pre_evento_status != 'cerrado'`, sin fijar tenant (rol técnico del proceso de
 * Sistema); cada fila trae su `tenantId` para la mutación RLS.
 */
export interface CandidatasCierreFichaPort {
  listarCandidatas(): Promise<FichaCandidataCierre[]>;
}

/**
 * UoW atómica por RESERVA: abre una transacción bajo el contexto RLS del tenant de la
 * candidata, re-evalúa la guarda A10 dentro de la transacción y —si sigue siendo
 * candidata— aplica la mutación de cierre (reuso de US-025) + auditoría origen Sistema.
 * Devuelve el desenlace para agregar el resumen. Un fallo se PROPAGA para que el
 * use-case lo aísle (rollback de solo esa transacción).
 */
export interface CierreFichaVencidaPort {
  cerrarFicha(candidata: FichaCandidataCierre): Promise<ResultadoCierreFicha>;
}

/** Dependencias del caso de uso (puertos inyectados, hexagonal). */
export interface CerrarFichasVencidasDeps {
  candidatas: CandidatasCierreFichaPort;
  cierre: CierreFichaVencidaPort;
}

// ---------------------------------------------------------------------------
// Caso de uso
// ---------------------------------------------------------------------------

export class CerrarFichasVencidasService {
  constructor(private readonly deps: CerrarFichasVencidasDeps) {}

  /**
   * Ejecuta un barrido idempotente: lista las candidatas cross-tenant y cierra cada una
   * en su propia transacción con FALLO AISLADO (D-6). El resumen agrega candidatas,
   * fichas cerradas y fallos aislados.
   */
  async ejecutar(): Promise<ResumenBarridoFichas> {
    const candidatas = await this.deps.candidatas.listarCandidatas();

    const resumen: ResumenBarridoFichas = {
      candidatas: candidatas.length,
      fichasCerradas: 0,
      fallos: 0,
    };

    // Secuencial con fallo aislado por RESERVA: cada `cerrarFicha` abre su propia
    // transacción; una excepción se captura y NO aborta el lote (semántica de US-012).
    for (const candidata of candidatas) {
      try {
        const resultado = await this.deps.cierre.cerrarFicha(candidata);
        // Idempotencia: si bajo transacción ya no era candidata (`cerrada = false`), no
        // cuenta como cerrada ni como fallo (D-4/D-6).
        if (resultado.cerrada) {
          resumen.fichasCerradas += 1;
        }
      } catch {
        resumen.fallos += 1;
      }
    }

    return resumen;
  }
}
