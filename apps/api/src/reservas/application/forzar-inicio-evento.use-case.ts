/**
 * Caso de uso de APLICACIÓN `ForzarInicioEventoUseCase` (US-032 / UC-23 FA-01, actor Gestor).
 *
 * Es el FLUJO ALTERNATIVO MANUAL del inicio de evento: cuando el cron de US-031 NO
 * transiciona una RESERVA en `reserva_confirmada` el día T-0 porque alguna precondición
 * está incumplida, el Gestor puede FORZAR `reserva_confirmada → evento_en_curso` asumiendo el
 * riesgo, con trazabilidad completa en `AUDIT_LOG`. Orquesta el dominio puro a través de
 * puertos inyectados (hexagonal, hook `no-infra-in-domain`): NO importa Prisma ni
 * `@nestjs/*`. La ATOMICIDAD REAL (`SELECT … FOR UPDATE`, RLS) vive en el adaptador Prisma de
 * la unidad de trabajo (`UnidadDeTrabajoForzarInicioPort`).
 *
 * Reutiliza SIN redefinir las guardas de dominio de US-031: la guarda de ORIGEN declarativa
 * `resolverInicioEvento` (única arista `reserva_confirmada → evento_en_curso`) y la guarda de
 * PRECONDICIONES `preconditionesEventoCumplidas` (que devuelve `{ cumple, faltantes }`). La
 * ÚNICA diferencia con US-031 es que FUERZA la transición aunque `cumple === false` y persiste
 * `faltantes` en el audit log como evidencia del override. Añade la guarda de FECHA pura
 * `esDiaDelEvento`.
 *
 * Algoritmo (design.md §D-1/§D-3/§D-4/§D-5/§D-7) — ESPEJO de `FinalizarEventoUseCase`:
 *   0. Cargar la RESERVA bajo RLS del tenant del JWT (`cargarReserva`). `null` → 404
 *      (`ReservaNoEncontradaError`): inexistente o de otro tenant.
 *   1. Guarda de ORIGEN previa a la transacción (`resolverInicioEvento`): si el estado NO es
 *      `reserva_confirmada` → `ConflictoEstadoError` (409), SIN efectos (sin tx, sin AUDIT).
 *      Cubre "el cron llegó primero" (ya en `evento_en_curso`) y cualquier otro estado.
 *   2. Guarda de FECHA previa a la transacción (`esDiaDelEvento`): si `fecha_evento != hoy`
 *      → `FechaEventoNoEsHoyError` (422), SIN efectos. El `hoy` se calcula UNA vez aquí.
 *   3. Paso TRANSACCIONAL (crítico, all-or-nothing) vía la unidad de trabajo:
 *      - calcula `faltantes` con `preconditionesEventoCumplidas` (bajo el lock, en el
 *        adaptador; aquí se computa de la proyección leída) para persistirlas en el audit log.
 *      - `reservas.forzarInicioEvento(...)` hace `UPDATE … WHERE estado='reserva_confirmada'`
 *        bajo el `SELECT … FOR UPDATE` de la fila y devuelve `filasAfectadas`. `0` filas
 *        (carrera perdida bajo el lock: cron u otra sesión ganó) → `ConflictoEstadoError`
 *        (409), sin auditoría (no-op idempotente).
 *      - `1` fila ⇒ AUDIT_LOG de la transición (`accion='transicion'`, origen Usuario con
 *        `usuarioId` poblado) con `datos_nuevos = { estado, forzado_por_gestor: true,
 *        precondiciones_incumplidas: [faltantes] }`.
 *   4. Re-lee la RESERVA post-commit y devuelve
 *      `{ reserva, forzadoPorGestor: true, precondicionesIncumplidas: faltantes }`.
 */
import {
  esDiaDelEvento,
  preconditionesEventoCumplidas,
  resolverInicioEvento,
  type EstadoReserva,
  type FianzaStatusDominio,
  type LiquidacionStatusDominio,
  type PreEventoStatusDominio,
  type SubEstadoConsulta,
} from '../domain/maquina-estados';
import type { AuditLogPort } from '../../shared/audit/audit-log.port';
import type { ReservaDetalleLectura } from './obtener-reserva.query';

// ---------------------------------------------------------------------------
// Tipos del dominio de la aplicación
// ---------------------------------------------------------------------------

/**
 * Proyección mínima de la RESERVA que el forzado necesita (leída bajo RLS del tenant del
 * JWT). Incluye `fechaEvento` (guarda de fecha) y los tres `*_status` (para calcular las
 * `precondiciones_incumplidas` que se persisten en el audit log).
 */
export interface ReservaForzarInicio {
  idReserva: string;
  tenantId: string;
  clienteId: string;
  estado: EstadoReserva;
  subEstado: SubEstadoConsulta | null;
  fechaEvento: Date;
  preEventoStatus: PreEventoStatusDominio;
  liquidacionStatus: LiquidacionStatusDominio;
  fianzaStatus: FianzaStatusDominio;
}

/** Comando de entrada: identidad de la RESERVA + actor (tenant/usuario del JWT). */
export interface ForzarInicioEventoComando {
  /** Tenant del JWT (nunca del path/body): contexto RLS de toda la operación. */
  tenantId: string;
  /** Gestor autenticado (JWT): origen Usuario del AUDIT_LOG de la transición forzada. */
  usuarioId: string;
  /** RESERVA a forzar (path). */
  reservaId: string;
}

/**
 * Read-model de la RESERVA hidratada POST-COMMIT que alimenta el `allOf(Reserva)` del
 * contrato `ForzarInicioEventoResponse`. Reusa la MISMA proyección que `GET /reservas/{id}`
 * (`ReservaDetalleLectura`); el campo `cliente` embebido NO forma parte de `Reserva` (solo de
 * `ReservaDetalle`) y el controlador lo omite al mapear.
 */
export type ReservaHidratadaForzarInicio = ReservaDetalleLectura;

/**
 * Resultado del caso de uso (alimenta `ForzarInicioEventoResponse` = `allOf(Reserva)` +
 * `forzadoPorGestor` + `precondicionesIncumplidas`). `reserva` es la RESERVA COMPLETA re-leída
 * tras el commit (bajo RLS del tenant) para hidratar el objeto del contrato; `null` solo si la
 * relectura no resuelve (borrada en carrera / puerto no disponible), en cuyo caso el
 * controlador cae a la proyección mínima (`reservaId`/`estado`).
 */
export interface ForzarInicioEventoResultado {
  reservaId: string;
  estado: EstadoReserva;
  /** Siempre `true`: fue una acción de OVERRIDE explícita del gestor (distingue del inicio automático US-031). */
  forzadoPorGestor: true;
  /** Lista `faltantes` en el momento del forzado; `[]` si por caso borde las tres estaban cumplidas. */
  precondicionesIncumplidas: string[];
  reserva: ReservaHidratadaForzarInicio | null;
}

// ---------------------------------------------------------------------------
// Puertos (interfaces) — implementados en infraestructura (adaptadores Prisma)
// ---------------------------------------------------------------------------

/** Parámetros de la mutación transaccional de la transición forzada (bajo el lock). */
export interface MutacionForzarInicioParams {
  reservaId: string;
  tenantId: string;
  /** Estado de origen esperado bajo el lock (guarda de la UPDATE condicional). */
  estadoOrigen: EstadoReserva;
  /** Estado destino de la transición. */
  estadoDestino: EstadoReserva;
}

/** Resultado de la mutación: filas afectadas por la UPDATE condicional bajo el lock. */
export interface MutacionForzarInicioResultado {
  /** `1` si la transición ganó; `0` si bajo el lock el estado ya no era `reserva_confirmada`. */
  filasAfectadas: number;
}

/** Registro de auditoría de la transición forzada (origen Usuario). */
export interface RegistroAuditoriaForzarInicio {
  tenantId: string;
  usuarioId?: string;
  accion: 'transicion';
  entidad: 'RESERVA';
  entidadId: string;
  datosAnteriores?: Record<string, unknown>;
  datosNuevos?: Record<string, unknown>;
}

/**
 * Repositorios tx-bound disponibles DENTRO de la unidad de trabajo de la transición. El
 * adaptador real (Prisma) los liga a la MISMA transacción (bajo el `SELECT … FOR UPDATE`).
 */
export interface RepositoriosForzarInicio {
  reservas: {
    /**
     * UPDATE condicional de la transición forzada bajo el lock: `UPDATE reserva SET
     * estado=estadoDestino WHERE id=reservaId AND estado=estadoOrigen`. Devuelve las filas
     * afectadas (`0` ⇒ la guarda ya no se cumple bajo el lock: carrera perdida). Muta
     * EXCLUSIVAMENTE `estado` (D-5): NO toca `pre_evento_status`/`liquidacion_status`/`fianza_status`.
     */
    forzarInicioEvento(
      params: MutacionForzarInicioParams,
    ): Promise<MutacionForzarInicioResultado>;
  };
  auditoria: AuditLogPort<RegistroAuditoriaForzarInicio>;
}

/**
 * Unidad de trabajo de la transición: abre UNA transacción bajo el contexto RLS del tenant,
 * toma el `SELECT … FOR UPDATE` de la fila RESERVA y ejecuta `trabajo` con los repos ligados a
 * esa transacción. La atomicidad y el lock viven en el adaptador (sin locks distribuidos).
 */
export interface UnidadDeTrabajoForzarInicioPort {
  ejecutar(
    tenantId: string,
    trabajo: (repos: RepositoriosForzarInicio) => Promise<unknown>,
  ): Promise<unknown>;
}

/** Dependencias del caso de uso (puertos inyectados, hexagonal). */
export interface ForzarInicioEventoDeps {
  unidadDeTrabajo: UnidadDeTrabajoForzarInicioPort;
  cargarReserva(comando: ForzarInicioEventoComando): Promise<ReservaForzarInicio | null>;
  /**
   * Relectura POST-COMMIT de la RESERVA completa para hidratar `allOf(Reserva)` en la
   * respuesta 200. Best-effort: si falla o devuelve `null`, el resultado cae a la proyección
   * mínima (`reservaId`/`estado`) sin tumbar el forzado ya commiteado.
   */
  cargarReservaDetalle(
    comando: ForzarInicioEventoComando,
  ): Promise<ReservaHidratadaForzarInicio | null>;
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
 * La RESERVA no está en `reserva_confirmada` (estado actual distinto, ya iniciada por el cron
 * de US-031 u otra sesión, o carrera perdida bajo el lock) → 409 `code: conflicto_estado`.
 */
export class ConflictoEstadoError extends Error {
  readonly codigo = 'conflicto_estado' as const;

  constructor() {
    super(
      'El evento ya está en curso (iniciado automáticamente o por otro usuario). No es necesaria ninguna acción.',
    );
    this.name = 'ConflictoEstadoError';
  }
}

/**
 * La RESERVA está en `reserva_confirmada` pero `date(fecha_evento) != date(hoy)`: el forzado
 * solo está disponible el día del evento (guardarraíl de servidor) → 422
 * `code: fecha_evento_no_es_hoy`.
 */
export class FechaEventoNoEsHoyError extends Error {
  readonly codigo = 'fecha_evento_no_es_hoy' as const;

  constructor() {
    super('El forzado del inicio de evento solo está disponible el día del evento');
    this.name = 'FechaEventoNoEsHoyError';
  }
}

// ---------------------------------------------------------------------------
// Caso de uso
// ---------------------------------------------------------------------------

export class ForzarInicioEventoUseCase {
  constructor(private readonly deps: ForzarInicioEventoDeps) {}

  async ejecutar(
    comando: ForzarInicioEventoComando,
  ): Promise<ForzarInicioEventoResultado> {
    // 0. Cargar la RESERVA bajo RLS del tenant del JWT. `null` → 404 (inexistente / otro tenant).
    const reserva = await this.deps.cargarReserva(comando);
    if (reserva === null) {
      throw new ReservaNoEncontradaError(comando.reservaId);
    }

    // 1. Guarda de ORIGEN previa a la transacción (reutiliza US-031): solo `reserva_confirmada`
    //    es candidato. Cualquier otro estado (incluido `evento_en_curso`: "cron llegó primero")
    //    → 409 SIN efectos (sin tx, sin AUDIT_LOG). Se evalúa ANTES que la guarda de fecha.
    const destino = resolverInicioEvento(reserva.estado, reserva.subEstado);
    if (destino === null) {
      throw new ConflictoEstadoError();
    }

    // 2. Guarda de FECHA previa a la transacción (D-2): el forzado solo el día del evento.
    //    `hoy` se calcula UNA vez y se compara por fecha de calendario. → 422 SIN efectos.
    const hoy = new Date();
    if (!esDiaDelEvento(reserva.fechaEvento, hoy)) {
      throw new FechaEventoNoEsHoyError();
    }

    // Precondiciones incumplidas (evidencia del override): se persisten en el audit log y se
    // devuelven en la respuesta. FUERZA la transición aunque `cumple === false` (a diferencia
    // de US-031, que vetaría). Caso borde: si las tres se cumplen, `faltantes = []` pero el
    // forzado sigue siendo `true`.
    const { faltantes } = preconditionesEventoCumplidas({
      preEventoStatus: reserva.preEventoStatus,
      liquidacionStatus: reserva.liquidacionStatus,
      fianzaStatus: reserva.fianzaStatus,
    });

    // 3. Paso TRANSACCIONAL (crítico): transición forzada atómica bajo `SELECT … FOR UPDATE`.
    await this.deps.unidadDeTrabajo.ejecutar(comando.tenantId, async (repos) => {
      const { filasAfectadas } = await repos.reservas.forzarInicioEvento({
        reservaId: reserva.idReserva,
        tenantId: comando.tenantId,
        estadoOrigen: reserva.estado,
        estadoDestino: destino.estado,
      });

      // Carrera perdida bajo el lock (cron de US-031 u otra sesión ganó): 0 filas → conflicto,
      // sin auditar (no-op idempotente, aborta la transacción).
      if (filasAfectadas === 0) {
        throw new ConflictoEstadoError();
      }

      // AUDIT_LOG de la TRANSICIÓN forzada — origen Usuario (usuarioId poblado, D-4) con la
      // evidencia del override (forzado_por_gestor + precondiciones_incumplidas).
      await repos.auditoria.registrar({
        tenantId: comando.tenantId,
        usuarioId: comando.usuarioId,
        accion: 'transicion',
        entidad: 'RESERVA',
        entidadId: reserva.idReserva,
        datosAnteriores: { estado: reserva.estado },
        datosNuevos: {
          estado: destino.estado,
          forzado_por_gestor: true,
          precondiciones_incumplidas: faltantes,
        },
      });
    });

    // 4. Relectura POST-COMMIT de la RESERVA completa para hidratar `allOf(Reserva)` (contrato).
    //    Best-effort: si no resuelve, se cae a la proyección mínima (`reservaId`/`estado`).
    const reservaHidratada = await this.hidratarReserva(comando);

    return {
      reservaId: reserva.idReserva,
      estado: destino.estado,
      forzadoPorGestor: true,
      precondicionesIncumplidas: faltantes,
      reserva: reservaHidratada,
    };
  }

  /**
   * Re-lee la RESERVA completa tras el commit para hidratar el `allOf(Reserva)` de la
   * respuesta. Best-effort: una excepción del puerto (o BD no disponible) no debe tumbar el
   * forzado ya commiteado; se devuelve `null` y el controlador cae a la proyección mínima.
   */
  private async hidratarReserva(
    comando: ForzarInicioEventoComando,
  ): Promise<ReservaHidratadaForzarInicio | null> {
    try {
      return await this.deps.cargarReservaDetalle(comando);
    } catch {
      return null;
    }
  }
}
