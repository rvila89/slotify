/**
 * Caso de uso de APLICACIÓN: barrido de ARCHIVADO AUTOMÁTICO de reservas completadas en
 * T+7d (US-037 / UC-28, actor Sistema). Cierra el patrón "estado en fila + barrido
 * periódico" (skill `async-jobs`): NO hay timer en memoria; el trabajo pendiente es ESTADO
 * en la BBDD (`RESERVA.estado = post_evento` + `fecha_post_evento` + `fianza_status`/
 * `fianza_eur`).
 *
 * Orquesta el dominio puro a través de TRES puertos inyectados (hexagonal), en paralelo
 * estricto al barrido de US-031/US-012:
 *   1. `CandidatasArchivadoPort.listarCandidatas()` — lectura CROSS-TENANT de las RESERVA
 *      con `estado = 'post_evento'` AND `date(fechaPostEvento) <= hoy - 7` (D-2=A). La
 *      SELECCIÓN (filtro estricto por estado y por FECHA DE CALENDARIO — blindaje del
 *      off-by-one de TZ) es del adaptador; aquí la lista llega ya filtrada. Cada fila trae
 *      su `tenantId`.
 *   2. `ArchivadoPort.archivarReserva(candidata)` — UoW ATÓMICA por RESERVA: bajo el
 *      contexto RLS del tenant de LA candidata, `SELECT … FOR UPDATE`, re-evalúa la guarda
 *      de origen (`resolverArchivadoAutomatico`) + la guarda de fianza (`fianzaResuelta`) y
 *      —si sigue siendo `post_evento` y la fianza está resuelta— transiciona a
 *      `reserva_completada` + AUDIT_LOG transición origen Sistema (causa 'T+7d'); si la
 *      fianza está pendiente NO transiciona y devuelve `fianzaPendiente = true`; si bajo el
 *      lock ya no era candidata (idempotencia / RC-1/RC-2) devuelve `archivada = false` y
 *      `fianzaPendiente = false` sin más.
 *   3. `AlertaFianzaPendientePort` — emite la alerta interna FA-01 (D-3=3.1) con
 *      ANTI-DUPLICACIÓN por AUDIT_LOG (D-4=4.2): `debeEmitir(candidata)` consulta si ya
 *      existe una alerta posterior al último cambio de `fianza_status`/`fianza_eur`; solo se
 *      emite si NO existe.
 *
 * Cada candidata se procesa en su PROPIA transacción independiente con FALLO AISLADO
 * (semántica de lote de US-012/US-026/US-031, D-6/D-7): el fallo de una NO aborta el lote;
 * el resumen registra el fallo aislado.
 *
 * Hexagonal: depende SOLO de puertos; no importa Prisma ni `@nestjs/*`.
 */
import type { FianzaStatusDominio } from '../domain/maquina-estados';

// ---------------------------------------------------------------------------
// Tipos del dominio del barrido
// ---------------------------------------------------------------------------

/**
 * Proyección mínima de una RESERVA candidata al archivado automático, tal como la devuelve
 * la lectura cross-tenant. El `tenantId` viaja con la fila (D-8): las mutaciones lo reponen
 * para el contexto RLS, nunca lo toman de input externo.
 */
export interface ReservaCompletableCandidata {
  reservaId: string;
  codigo: string;
  tenantId: string;
  /** Instante de entrada a `post_evento`; la candidatura se decide por fecha de calendario. */
  fechaPostEvento: Date;
  fianzaStatus: FianzaStatusDominio;
  fianzaEur: number | null;
}

/**
 * Desenlace del archivado de UNA RESERVA (lo devuelve la UoW por-reserva).
 *  - `archivada = true`: la transición `post_evento → reserva_completada` se aplicó en esta
 *    pasada (la guarda de origen seguía válida bajo el lock y la fianza estaba resuelta).
 *  - `archivada = false` con `fianzaPendiente = true`: NO se transiciona; la fianza no está
 *    resuelta (FA-01) → el use-case decide emitir la alerta interna.
 *  - `archivada = false` con `fianzaPendiente = false`: bajo el lock ya NO era candidata
 *    (otro pase o el gestor US-038 la dejó en `reserva_completada`): no-op idempotente, no
 *    cuenta como archivada, ni como fianza pendiente, ni alerta.
 */
export interface ResultadoArchivado {
  reservaId: string;
  archivada: boolean;
  fianzaPendiente: boolean;
}

/** Datos de la alerta interna FA-01 (D-3=3.1); lleva al menos el código y el tenant. */
export interface AlertaFianzaPendiente {
  reservaId: string;
  tenantId: string;
  codigo: string;
}

/** Resumen agregado del barrido (shape del contrato `BarridoCompletadasResponse`). */
export interface ResumenBarridoCompletadas {
  candidatas: number;
  archivadas: number;
  fianzaPendiente: number;
  fallos: number;
}

// ---------------------------------------------------------------------------
// Puertos (interfaces) — implementados en infraestructura (adaptadores Prisma)
// ---------------------------------------------------------------------------

/**
 * Lectura CROSS-TENANT de las candidatas al archivado (D-8). Selecciona por FECHA DE
 * CALENDARIO (`date(fechaPostEvento) <= date(hoy) - 7`) AND `estado = 'post_evento'`, sin
 * fijar tenant (rol técnico del proceso de Sistema); `fechaPostEvento` null → NO candidata.
 * Cada fila trae su `tenantId` para la mutación RLS.
 */
export interface CandidatasArchivadoPort {
  listarCandidatas(): Promise<ReservaCompletableCandidata[]>;
}

/**
 * UoW atómica por RESERVA: abre una transacción bajo el contexto RLS del tenant de la
 * candidata, toma `SELECT … FOR UPDATE` sobre la fila RESERVA, re-evalúa la guarda de
 * origen + la guarda de fianza y —si sigue siendo candidata y la fianza está resuelta—
 * aplica la transición + auditoría origen Sistema. Devuelve el desenlace para agregar el
 * resumen y decidir la alerta. Un fallo se PROPAGA para que el use-case lo aísle (rollback
 * de solo esa transacción).
 */
export interface ArchivadoPort {
  archivarReserva(candidata: ReservaCompletableCandidata): Promise<ResultadoArchivado>;
}

/**
 * Emisión de la alerta interna FA-01 (D-3=3.1), desacoplada de la superficie de
 * notificaciones (US-044). `debeEmitir` implementa la anti-duplicación por AUDIT_LOG
 * (D-4=4.2): `false` si ya existe una alerta `fianza_pendiente_t7d` posterior al último
 * cambio de `fianza_status`/`fianza_eur` de esa RESERVA.
 */
export interface AlertaFianzaPendientePort {
  debeEmitir(candidata: ReservaCompletableCandidata): Promise<boolean>;
  emitir(alerta: AlertaFianzaPendiente): Promise<void>;
}

/**
 * Registrador mínimo del barrido (puerto de observabilidad, hexagonal): la aplicación NO
 * importa el `Logger` de `@nestjs/*`; el adaptador de interfaz (scheduler/controller) puede
 * inyectar uno respaldado por Nest. Por defecto usa `console.error`, de modo que un fallo
 * AISLADO por RESERVA quede SIEMPRE trazado y nunca sea silencioso (deuda conocida: un
 * `catch {}` ciego ocultó un bug de RLS en US-037).
 */
export interface RegistradorBarrido {
  error(mensaje: string): void;
}

/** Dependencias del caso de uso (puertos inyectados, hexagonal). */
export interface ArchivarReservasCompletadasDeps {
  candidatas: CandidatasArchivadoPort;
  archivado: ArchivadoPort;
  alerta: AlertaFianzaPendientePort;
  /** Opcional; por defecto `console` (no rompe el doble de test, que solo pasa los puertos). */
  logger?: RegistradorBarrido;
}

// ---------------------------------------------------------------------------
// Caso de uso
// ---------------------------------------------------------------------------

export class ArchivarReservasCompletadasService {
  constructor(private readonly deps: ArchivarReservasCompletadasDeps) {}

  /** Registrador del barrido; por defecto `console` para que el fallo aislado sea observable. */
  private get logger(): RegistradorBarrido {
    return this.deps.logger ?? console;
  }

  /**
   * Ejecuta un barrido idempotente: lista las candidatas cross-tenant y procesa cada una
   * en su propia transacción con FALLO AISLADO (D-6). Por cada candidata: si se archiva,
   * cuenta la archivada; si la fianza está pendiente, cuenta y —tras la anti-duplicación—
   * emite la alerta interna FA-01; si bajo el lock ya no era candidata, no-op idempotente
   * (ni cuenta ni alerta). El resumen agrega candidatas, archivadas, fianza pendiente y
   * fallos aislados.
   */
  async ejecutar(): Promise<ResumenBarridoCompletadas> {
    const candidatas = await this.deps.candidatas.listarCandidatas();

    const resumen: ResumenBarridoCompletadas = {
      candidatas: candidatas.length,
      archivadas: 0,
      fianzaPendiente: 0,
      fallos: 0,
    };

    // Secuencial con fallo aislado por RESERVA: cada `archivarReserva` abre su propia
    // transacción; una excepción se captura y NO aborta el lote (semántica de US-012/026/031).
    for (const candidata of candidatas) {
      try {
        const resultado = await this.deps.archivado.archivarReserva(candidata);

        if (resultado.archivada) {
          resumen.archivadas += 1;
        } else if (resultado.fianzaPendiente) {
          // FA-01: NO transiciona. Anti-duplicación por AUDIT_LOG (D-4=4.2): solo se emite
          // si no hay una alerta posterior al último cambio de fianza_status/fianza_eur.
          resumen.fianzaPendiente += 1;
          if (await this.deps.alerta.debeEmitir(candidata)) {
            await this.deps.alerta.emitir({
              reservaId: candidata.reservaId,
              tenantId: candidata.tenantId,
              codigo: candidata.codigo,
            });
          }
        }
        // `archivada = false` + `fianzaPendiente = false`: no-op idempotente (bajo lock ya
        // no era candidata) → no cuenta ni alerta (FA-02 / RC-1/RC-2).
      } catch (error) {
        // FALLO AISLADO (D-6): NO aborta el lote. Pero NO se traga en silencio: se registra
        // para que un fallo de archivado/alerta (p. ej. un rechazo de RLS) sea OBSERVABLE.
        resumen.fallos += 1;
        this.logger.error(
          `Barrido de archivado automático: fallo aislado en la reserva ` +
            `${candidata.reservaId} (tenant ${candidata.tenantId}): ${String(error)}`,
        );
      }
    }

    return resumen;
  }
}
