/**
 * Caso de uso de APLICACIÓN `ArchivarReservaManualUseCase` (US-038 / UC-28 flujo alternativo
 * MANUAL, actor Gestor).
 *
 * Es la ACCIÓN MANUAL que cierra la RESERVA desde la ficha: transiciona
 * `post_evento → reserva_completada` (terminal, inmutable) SIN esperar al archivado
 * automático de T+7d (US-037), CUANDO la fianza está resuelta. Orquesta el dominio puro a
 * través de puertos inyectados (hexagonal, hook `no-infra-in-domain`): NO importa Prisma ni
 * `@nestjs/*`. La ATOMICIDAD REAL (`$transaction` + `fijarTenant` + `SELECT … FOR UPDATE` +
 * re-evaluación de las guardas bajo el lock) vive en el adaptador Prisma de la unidad de
 * trabajo (`UnidadDeTrabajoArchivadoManualPort`).
 *
 * REUTILIZACIÓN DE DOMINIO (design.md §D-1=1.A, regla dura anti-duplicación): usa las MISMAS
 * guardas puras que el archivado automático de US-037 — `resolverArchivadoAutomatico` (origen)
 * y `fianzaResuelta` (fianza) — importadas de `domain/maquina-estados.ts`. NO crea guardas
 * nuevas ni añade aristas.
 *
 * Algoritmo (design.md §D-3=3.B, §D-5, §D-7):
 *   0. Cargar la RESERVA bajo RLS del tenant del JWT (`cargarReserva`). `null` → 404
 *      (`ReservaNoEncontradaError`): inexistente o de otro tenant.
 *   1. Guarda de ORIGEN previa a la transacción (`resolverArchivadoAutomatico`): si el
 *      estado NO es `post_evento` → `TransicionNoPermitidaError` (409), SIN efectos (sin tx,
 *      sin AUDIT_LOG). Base de la idempotencia (una RESERVA ya `reserva_completada` da 409).
 *   2. Guarda de FIANZA previa a la transacción (`fianzaResuelta`): si NO está resuelta
 *      (`fianza_eur > 0` y `fianza_status ∈ {cobrada, recibo_enviado, pendiente}`) →
 *      `FianzaNoResueltaError` (422, D-3=3.B) con el mensaje de FA-01, SIN tx, SIN auditar.
 *   3. Paso TRANSACCIONAL vía la UoW: la UPDATE condicional `WHERE estado='post_evento'` bajo
 *      el `SELECT … FOR UPDATE` devuelve `filasAfectadas`; `0` ⇒ carrera perdida (doble clic /
 *      cron US-037) → `TransicionNoPermitidaError`. En éxito, AUDIT_LOG `accion='transicion'`
 *      origen Gestor (`usuario_id` del JWT). SIN filtro T+7d (el manual no exige antigüedad).
 */
import {
  fianzaResuelta,
  resolverArchivadoAutomatico,
  type EstadoReserva,
  type FianzaStatusDominio,
  type SubEstadoConsulta,
} from '../domain/maquina-estados';
import type { AuditLogPort } from '../../shared/audit/audit-log.port';
import type { ReservaDetalleLectura } from './obtener-reserva.query';

// ---------------------------------------------------------------------------
// Literal FIJO del mensaje de bloqueo por fianza no resuelta (FA-01/FA-02).
// ---------------------------------------------------------------------------

/**
 * Mensaje canónico devuelto al gestor cuando la fianza NO está resuelta (FA-01/FA-02). Es el
 * texto exacto exigido por la spec-delta; el frontend lo muestra diferenciado del conflicto de
 * estado (409). NO editar sin alinear el contrato OpenAPI.
 */
export const MENSAJE_FIANZA_NO_RESUELTA =
  'No se puede archivar la reserva: la fianza está pendiente de resolución. Registra la devolución o retención de fianza antes de archivar.' as const;

// ---------------------------------------------------------------------------
// Tipos del dominio de la aplicación
// ---------------------------------------------------------------------------

/**
 * Proyección MÍNIMA de la RESERVA que el archivado manual necesita (leída bajo RLS del tenant
 * del JWT). NO incluye `fecha_post_evento` ni ninguna referencia de antigüedad: el manual NO
 * aplica el filtro T+7d de US-037. `fianzaEur` viaja como STRING (Decimal(10,2), sin coma
 * flotante) o `null`.
 */
export interface ReservaArchivable {
  idReserva: string;
  tenantId: string;
  estado: EstadoReserva;
  subEstado: SubEstadoConsulta | null;
  fianzaEur: string | null;
  fianzaStatus: FianzaStatusDominio;
}

/** Comando de entrada: identidad de la RESERVA + actor (tenant/usuario del JWT). */
export interface ArchivarReservaManualComando {
  /** Tenant del JWT (nunca del path/body): contexto RLS de toda la operación. */
  tenantId: string;
  /** Gestor autenticado (JWT): origen Gestor del AUDIT_LOG de la transición. */
  usuarioId: string;
  /** RESERVA a archivar (path). */
  reservaId: string;
}

/**
 * Read-model de la RESERVA hidratada POST-COMMIT que alimenta el `allOf(Reserva)` de la
 * respuesta 200. Reusa la MISMA proyección que `GET /reservas/{id}` (`ReservaDetalleLectura`);
 * el campo `cliente` embebido NO forma parte de `Reserva` (solo de `ReservaDetalle`) y el
 * controlador lo omite al mapear.
 */
export type ReservaHidratadaArchivado = ReservaDetalleLectura;

/**
 * Resultado del caso de uso (alimenta la respuesta `allOf(Reserva)`). `reserva` es la RESERVA
 * COMPLETA re-leída tras el commit (bajo RLS del tenant) para hidratar el objeto del contrato;
 * `null` solo si la relectura no resuelve, en cuyo caso el controlador cae a la proyección
 * mínima (`reservaId`/`estado`). `reservaId`/`estado` se conservan en el nivel superior.
 */
export interface ArchivarReservaManualResultado {
  reservaId: string;
  estado: EstadoReserva;
  reserva: ReservaHidratadaArchivado | null;
}

// ---------------------------------------------------------------------------
// Puertos (interfaces) — implementados en infraestructura (adaptadores Prisma)
// ---------------------------------------------------------------------------

/** Parámetros de la mutación transaccional de la transición (bajo el lock). */
export interface MutacionArchivadoManualParams {
  reservaId: string;
  tenantId: string;
  /** Estado de origen esperado bajo el lock (guarda de la UPDATE condicional). */
  estadoOrigen: EstadoReserva;
  /** Estado destino de la transición (`reserva_completada`). */
  estadoDestino: EstadoReserva;
}

/** Resultado de la mutación: filas afectadas por la UPDATE condicional bajo el lock. */
export interface MutacionArchivadoManualResultado {
  /** `1` si la transición ganó; `0` si bajo el lock el estado ya no era el de origen. */
  filasAfectadas: number;
}

/** Registro de auditoría de la transición (origen Gestor, `usuario_id` poblado). */
export interface RegistroAuditoriaArchivadoManual {
  tenantId: string;
  usuarioId?: string;
  accion: 'transicion';
  entidad: 'RESERVA';
  entidadId: string;
  datosAnteriores?: Record<string, unknown>;
  datosNuevos?: Record<string, unknown>;
}

/**
 * Repositorios tx-bound disponibles DENTRO de la unidad de trabajo del archivado manual. El
 * adaptador real (Prisma) los liga a la MISMA transacción (bajo el `SELECT … FOR UPDATE`).
 */
export interface RepositoriosArchivadoManual {
  reservas: {
    /**
     * UPDATE condicional de la transición bajo el lock: `UPDATE reserva SET
     * estado=estadoDestino WHERE id=reservaId AND estado=estadoOrigen`. Devuelve las filas
     * afectadas (`0` ⇒ la guarda ya no se cumple bajo el lock: carrera perdida).
     */
    archivar(
      params: MutacionArchivadoManualParams,
    ): Promise<MutacionArchivadoManualResultado>;
  };
  auditoria: AuditLogPort<RegistroAuditoriaArchivadoManual>;
}

/**
 * Unidad de trabajo del archivado manual: abre UNA transacción bajo el contexto RLS del
 * tenant del JWT, toma el `SELECT … FOR UPDATE` de la fila RESERVA y ejecuta `trabajo` con los
 * repos ligados a esa transacción. La atomicidad y el lock viven en el adaptador (sin locks
 * distribuidos).
 */
export interface UnidadDeTrabajoArchivadoManualPort {
  ejecutar(
    tenantId: string,
    trabajo: (repos: RepositoriosArchivadoManual) => Promise<unknown>,
  ): Promise<unknown>;
}

/** Dependencias del caso de uso (puertos inyectados, hexagonal). */
export interface ArchivarReservaManualDeps {
  unidadDeTrabajo: UnidadDeTrabajoArchivadoManualPort;
  cargarReserva(comando: ArchivarReservaManualComando): Promise<ReservaArchivable | null>;
  /**
   * Relectura POST-COMMIT (opcional) de la RESERVA completa para hidratar `allOf(Reserva)` en
   * la respuesta 200. Best-effort: si falta, falla o devuelve `null`, el resultado cae a la
   * proyección mínima (`reservaId`/`estado`) sin tumbar el archivado ya commiteado.
   */
  cargarReservaDetalle?(
    comando: ArchivarReservaManualComando,
  ): Promise<ReservaHidratadaArchivado | null>;
}

// ---------------------------------------------------------------------------
// Errores de dominio de la aplicación
// ---------------------------------------------------------------------------

/** RESERVA inexistente o de otro tenant (invisible bajo RLS) → 404. */
export class ReservaNoEncontradaError extends Error {
  readonly codigo = 'RESERVA_NO_ENCONTRADA' as const;

  constructor(reservaId: string) {
    super(`La reserva ${reservaId} no existe o no es accesible para el tenant`);
    this.name = 'ReservaNoEncontradaError';
  }
}

/**
 * La RESERVA no está en `post_evento` (estado actual distinto o ya `reserva_completada` por
 * una petición concurrente / el cron de US-037 / doble clic) → 409 `code:
 * transicion_no_permitida`. Base de la idempotencia y de la coordinación con el cron.
 */
export class TransicionNoPermitidaError extends Error {
  readonly codigo = 'transicion_no_permitida' as const;

  constructor() {
    super(
      'La reserva no está en post_evento: la transición a reserva_completada no es aplicable',
    );
    this.name = 'TransicionNoPermitidaError';
  }
}

/**
 * La fianza NO está resuelta (`fianza_eur > 0` y `fianza_status ∈ {cobrada, recibo_enviado,
 * pendiente}`) → 422 `code: fianza_no_resuelta` (D-3=3.B): precondición de negocio incumplida,
 * distinta del conflicto de estado (409). El mensaje es el literal de FA-01/FA-02.
 */
export class FianzaNoResueltaError extends Error {
  readonly codigo = 'fianza_no_resuelta' as const;

  constructor() {
    super(MENSAJE_FIANZA_NO_RESUELTA);
    this.name = 'FianzaNoResueltaError';
  }
}

// ---------------------------------------------------------------------------
// Caso de uso
// ---------------------------------------------------------------------------

export class ArchivarReservaManualUseCase {
  constructor(private readonly deps: ArchivarReservaManualDeps) {}

  async ejecutar(
    comando: ArchivarReservaManualComando,
  ): Promise<ArchivarReservaManualResultado> {
    // 0. Cargar la RESERVA bajo RLS del tenant del JWT. `null` → 404 (inexistente / otro tenant).
    const reserva = await this.deps.cargarReserva(comando);
    if (reserva === null) {
      throw new ReservaNoEncontradaError(comando.reservaId);
    }

    // 1. Guarda de ORIGEN previa a la transacción (reutilizada de US-037): solo `post_evento`
    //    (sub_estado NULL) es candidato. Cualquier otro estado (incl. `reserva_completada`) →
    //    409 SIN efectos (sin tx, sin AUDIT_LOG). Base de la idempotencia.
    const destino = resolverArchivadoAutomatico(reserva.estado, reserva.subEstado);
    if (destino === null) {
      throw new TransicionNoPermitidaError();
    }

    // 2. Guarda de FIANZA previa a la transacción (reutilizada de US-037, idéntica al
    //    automático): si NO está resuelta → 422 con el mensaje de FA-01, SIN tx, SIN auditar.
    const fianzaEur = reserva.fianzaEur === null ? null : Number(reserva.fianzaEur);
    const fianza = fianzaResuelta({ fianzaStatus: reserva.fianzaStatus, fianzaEur });
    if (!fianza.resuelta) {
      throw new FianzaNoResueltaError();
    }

    // 3. Paso TRANSACCIONAL (crítico): transición atómica bajo `SELECT … FOR UPDATE`. La
    //    guarda de origen se re-evalúa bajo el lock vía la UPDATE condicional (0 filas ⇒ 409).
    await this.deps.unidadDeTrabajo.ejecutar(comando.tenantId, async (repos) => {
      const { filasAfectadas } = await repos.reservas.archivar({
        reservaId: reserva.idReserva,
        tenantId: comando.tenantId,
        estadoOrigen: reserva.estado,
        estadoDestino: destino.estado,
      });

      // Carrera perdida (doble clic / cron US-037): bajo el lock el estado ya cambió → 0 filas
      // → conflicto, sin auditar (aborta la transacción). Exactamente una transición gana.
      if (filasAfectadas === 0) {
        throw new TransicionNoPermitidaError();
      }

      // AUDIT_LOG de la TRANSICIÓN — origen Gestor (usuarioId poblado, D-5). SIN causa 'T+7d'.
      await repos.auditoria.registrar({
        tenantId: comando.tenantId,
        usuarioId: comando.usuarioId,
        accion: 'transicion',
        entidad: 'RESERVA',
        entidadId: reserva.idReserva,
        datosAnteriores: { estado: reserva.estado },
        datosNuevos: { estado: destino.estado },
      });
    });

    // 4. Relectura POST-COMMIT (best-effort) de la RESERVA completa para hidratar
    //    `allOf(Reserva)` en la respuesta. Si no resuelve, se cae a la proyección mínima.
    const reservaHidratada = await this.hidratarReserva(comando);

    return {
      reservaId: reserva.idReserva,
      estado: destino.estado,
      reserva: reservaHidratada,
    };
  }

  /**
   * Re-lee la RESERVA completa tras el commit para hidratar el `allOf(Reserva)` de la
   * respuesta. Best-effort: una excepción del puerto (o BD no disponible) no debe tumbar el
   * archivado ya commiteado; se devuelve `null` y el controlador cae a la proyección mínima.
   */
  private async hidratarReserva(
    comando: ArchivarReservaManualComando,
  ): Promise<ReservaHidratadaArchivado | null> {
    if (this.deps.cargarReservaDetalle === undefined) {
      return null;
    }
    try {
      return await this.deps.cargarReservaDetalle(comando);
    } catch {
      return null;
    }
  }
}
