/**
 * Caso de uso de APLICACIÓN `CambiarFechaUseCase`
 * (US-051 §Punto 2 / UC-05/UC-12/UC-18, actor Gestor).
 *
 * Operación ATÓMICA «cambiar una fecha YA bloqueada» de una RESERVA (`POST
 * /reservas/{id}/cambiar-fecha`): cambiar de F1 a F2 es, atómicamente, LIBERAR la antigua
 * + BLOQUEAR la nueva en UNA sola transacción con `SELECT … FOR UPDATE` (design.md
 * §D-2.1). A diferencia de la ASIGNACIÓN de la primera fecha (US-005, `2a → 2b/2d`), aquí
 * la RESERVA ya tiene fecha bloqueada (`2b/2c/2v`) y se mueve a otra CONSERVANDO su
 * estado/subEstado.
 *
 * Orden (rechazos SIN efectos ANTES de abrir la transacción):
 *   0. Validación de fecha nueva estrictamente futura (`> hoy`) →
 *      `CambiarFechaValidacionError` (`tipo:'fecha'` → 422). Antes de tocar la BD.
 *   1. (dentro de la UoW = 1 sola tx + RLS, `SELECT … FOR UPDATE` sobre RESERVA y sobre
 *      `FECHA_BLOQUEADA(tenant, F2)`):
 *      - leer la RESERVA; `null` → 404.
 *      - guarda de origen declarativa (`esOrigenValidoParaCambiarFecha`: solo `2b/2c/2v`);
 *        el resto → `CambiarFechaValidacionError` (`tipo:'guarda'` → 422).
 *      - leer el estado de F2:
 *          · LIBRE → `bloquear(F2)` + `RESERVA.fecha_evento=F2` + `liberar(F1)`; si F1
 *            tenía cola, disparar la promoción FIFO (A15) del primero EXACTAMENTE una vez.
 *            AUDIT_LOG `actualizar` (F1→F2).
 *          · OCUPADA por otra RESERVA → `CambiarFechaConflictoError` (409), rollback total.
 *
 * PROHIBIDO Redis/Redlock/locks distribuidos (`CLAUDE.md §Regla crítica`, hook
 * `no-distributed-lock`): la serialización y la atomicidad las da PostgreSQL
 * (`SELECT … FOR UPDATE` + `UNIQUE(tenant_id, fecha)`).
 *
 * Hexagonal (hook `no-infra-in-domain`): depende SOLO de puertos inyectados; no importa
 * Prisma ni `@nestjs/*`. Toda la lectura/escritura vive DENTRO del cuerpo transaccional
 * (la re-evaluación de la guarda de origen bajo el lock la re-verifica el adaptador).
 */
import type { AuditLogPort } from '../../shared/audit/audit-log.port';
import {
  esFechaEstrictamenteFutura,
  type ClockPort,
} from '../domain/bloquear-fecha.service';
import {
  esOrigenValidoParaCambiarFecha,
  type EstadoReserva,
  type SubEstadoConsulta,
} from '../domain/maquina-estados';

export type { ClockPort };

// ---------------------------------------------------------------------------
// Tipos del dominio de la aplicación
// ---------------------------------------------------------------------------

/** Comando de entrada de la operación «cambiar fecha». */
export interface CambiarFechaComando {
  /** Tenant del JWT (nunca del path/body): contexto RLS de toda la operación. */
  tenantId: string;
  /** Gestor autenticado (JWT): origen Usuario del AUDIT_LOG. */
  usuarioId: string;
  /** RESERVA cuya fecha se cambia (debe estar en `2b/2c/2v` con fecha bloqueada). */
  reservaId: string;
  /** Nueva fecha del evento; debe ser estrictamente futura (`> hoy`). */
  fechaEvento: Date;
}

/** Proyección mínima de la RESERVA relevante para el cambio (origen). */
export interface ReservaCambioFecha {
  idReserva: string;
  tenantId: string;
  estado: EstadoReserva;
  subEstado: SubEstadoConsulta | null;
  /** Fecha ANTIGUA (ya bloqueada) que se liberará. */
  fechaEvento: Date | null;
}

/** Resultado del cambio: la RESERVA con su nueva `fechaEvento` (estado/subEstado intactos). */
export interface CambiarFechaResultado {
  reserva: ReservaCambioFecha;
}

// ---------------------------------------------------------------------------
// Puertos (interfaces) — implementados en infraestructura (adaptadores Prisma)
// ---------------------------------------------------------------------------

/**
 * Estado de disponibilidad de la fecha NUEVA leído DENTRO de la transacción bajo el lock
 * (`SELECT … FOR UPDATE`). `bloqueada` identifica la RESERVA dueña del bloqueo (para el
 * conflicto).
 */
export type EstadoFechaDestino =
  | { tipo: 'libre' }
  | {
      tipo: 'bloqueada';
      reservaBloqueanteId: string;
      estadoBloqueante: EstadoReserva;
      subEstadoBloqueante: SubEstadoConsulta | null;
    };

/** Repositorio de RESERVA tx-bound: lee el origen (bajo lock) y actualiza la fecha. */
export interface ReservaCambioFechaRepositoryPort {
  /** `SELECT … FOR UPDATE` de la RESERVA por id bajo RLS; `null` si no existe. */
  buscarPorId(params: {
    tenantId: string;
    reservaId: string;
  }): Promise<ReservaCambioFecha | null>;
  /** `UPDATE reserva SET fecha_evento=? WHERE id=?` (NO toca estado/subEstado). */
  actualizarFecha(params: {
    idReserva: string;
    fechaEvento: Date;
  }): Promise<ReservaCambioFecha>;
}

/**
 * Repositorio tx-bound del bloqueo de FECHA_BLOQUEADA para el cambio. Vive dentro de la
 * MISMA transacción (atomicidad liberar-antigua + bloquear-nueva), reutilizando las
 * primitivas `bloquearEnTx`/`liberar` (US-040/US-041).
 */
export interface FechaBloqueadaCambioRepositoryPort {
  /** Lee el estado de la fecha NUEVA (libre / bloqueada por X) bajo el lock. */
  leerEstadoFecha(params: {
    tenantId: string;
    fecha: Date;
  }): Promise<EstadoFechaDestino>;
  /** Bloquea la fecha NUEVA para esta RESERVA (blando). `P2002` → conflicto/rollback. */
  bloquear(params: {
    tenantId: string;
    fecha: Date;
    reservaId: string;
  }): Promise<void>;
  /** Libera la fecha ANTIGUA de esta RESERVA (DELETE serializado). */
  liberar(params: {
    tenantId: string;
    fecha: Date;
    reservaId: string;
  }): Promise<void>;
  /** ¿La fecha ANTIGUA tenía una cola activa apuntando a la reserva liberada? */
  tieneCola(params: {
    tenantId: string;
    fecha: Date;
    reservaId: string;
  }): Promise<boolean>;
}

/** Promoción FIFO (A15) del primero en cola de la fecha ANTIGUA liberada (US-018). */
export interface PromocionColaCambioPort {
  promoverPrimeroEnCola(params: { tenantId: string; fecha: Date }): Promise<void>;
}

/** Registro de auditoría del cambio de fecha (origen Usuario, entidad RESERVA). */
export interface RegistroAuditoriaCambiarFecha {
  tenantId: string;
  usuarioId?: string;
  accion: 'actualizar';
  entidad: 'RESERVA';
  entidadId: string;
  datosAnteriores?: Record<string, unknown>;
  datosNuevos?: Record<string, unknown>;
}

/** Conjunto de repositorios disponibles dentro de la unidad de trabajo del cambio. */
export interface RepositoriosCambiarFecha {
  reservas: ReservaCambioFechaRepositoryPort;
  fechaBloqueada: FechaBloqueadaCambioRepositoryPort;
  promocionCola: PromocionColaCambioPort;
  auditoria: AuditLogPort<RegistroAuditoriaCambiarFecha>;
}

/**
 * Unidad de trabajo transaccional del cambio: abre UNA `$transaction` bajo el contexto
 * RLS del tenant y expone los repos tx-bound. Si el `trabajo` rechaza, la transacción
 * revierte por completo (rollback total, all-or-nothing).
 */
export interface UnidadDeTrabajoCambiarFechaPort {
  ejecutar(
    tenantId: string,
    trabajo: (repos: RepositoriosCambiarFecha) => Promise<unknown>,
  ): Promise<unknown>;
}

/** Dependencias del caso de uso (puertos inyectados, hexagonal). */
export interface CambiarFechaDeps {
  unidadDeTrabajo: UnidadDeTrabajoCambiarFechaPort;
  clock: ClockPort;
}

// ---------------------------------------------------------------------------
// Errores de dominio tipados, en español
// ---------------------------------------------------------------------------

/** La RESERVA no existe para el tenant (RLS): cross-tenant es invisible → 404. */
export class ReservaNoEncontradaError extends Error {
  readonly codigo = 'RESERVA_NO_ENCONTRADA' as const;
  readonly reservaId: string;

  constructor(reservaId: string) {
    super('La reserva no existe para el tenant');
    this.name = 'ReservaNoEncontradaError';
    this.reservaId = reservaId;
  }
}

/**
 * El cambio no supera una validación previa (fecha no futura o guarda de origen): se
 * rechaza SIN efectos. `tipo` discrimina el mapeo HTTP (ambos → 422 en esta operación,
 * F5-02): `fecha` (fecha no estrictamente futura) vs `guarda` (origen no `2b/2c/2v`).
 */
export class CambiarFechaValidacionError extends Error {
  readonly codigo = 'CAMBIAR_FECHA_VALIDACION' as const;
  readonly tipo: 'fecha' | 'guarda';

  constructor(mensaje: string, tipo: 'fecha' | 'guarda') {
    super(mensaje);
    this.name = 'CambiarFechaValidacionError';
    this.tipo = tipo;
  }
}

/**
 * La fecha NUEVA está ocupada por otra RESERVA: el cambio se rechaza con conflicto y
 * rollback total (la RESERVA conserva su fecha antigua y su bloqueo). Mapea a HTTP 409.
 * A diferencia de la asignación (US-005), aquí NO se ofrece cola: el conflicto es
 * terminal (por eso NO expone `colaDisponible`), solo un `motivo`.
 */
export class CambiarFechaConflictoError extends Error {
  readonly codigo = 'CAMBIAR_FECHA_CONFLICTO' as const;
  readonly motivo: string;

  constructor(motivo: string) {
    super(motivo);
    this.name = 'CambiarFechaConflictoError';
    this.motivo = motivo;
  }
}

// ---------------------------------------------------------------------------
// Mensajes de dominio
// ---------------------------------------------------------------------------

const MOTIVO_CONFLICTO =
  'La fecha destino no está disponible: ya está bloqueada por otra reserva.';

// ---------------------------------------------------------------------------
// Caso de uso
// ---------------------------------------------------------------------------

export class CambiarFechaUseCase {
  constructor(private readonly deps: CambiarFechaDeps) {}

  async ejecutar(comando: CambiarFechaComando): Promise<CambiarFechaResultado> {
    const ahora = this.deps.clock.ahora();

    // 0. Fecha nueva estrictamente futura (`> hoy`): rechaza hoy y pasado ANTES de abrir
    //    la transacción (sin efectos).
    if (!esFechaEstrictamenteFutura(comando.fechaEvento, ahora)) {
      throw new CambiarFechaValidacionError(
        'La fecha del evento debe ser estrictamente futura (posterior a hoy)',
        'fecha',
      );
    }

    // 1. Toda la lectura/escritura, dentro de UNA unidad de trabajo (tx + RLS).
    const resultado = (await this.deps.unidadDeTrabajo.ejecutar(
      comando.tenantId,
      async (repos): Promise<ReservaCambioFecha> => {
        // Lectura + existencia bajo lock (RLS: cross-tenant → null → 404).
        const reserva = await repos.reservas.buscarPorId({
          tenantId: comando.tenantId,
          reservaId: comando.reservaId,
        });
        if (reserva === null) {
          throw new ReservaNoEncontradaError(comando.reservaId);
        }

        // Guarda de origen declarativa: solo `consulta/{2b,2c,2v}` (§D-2.1).
        if (!esOrigenValidoParaCambiarFecha(reserva.estado, reserva.subEstado)) {
          throw new CambiarFechaValidacionError(
            'Solo se puede cambiar la fecha de una consulta con fecha bloqueada (sub-estado 2b/2c/2v)',
            'guarda',
          );
        }

        const fechaAntigua = reserva.fechaEvento;

        // Estado de la fecha NUEVA bajo el lock (`SELECT … FOR UPDATE`).
        const estadoDestino = await repos.fechaBloqueada.leerEstadoFecha({
          tenantId: comando.tenantId,
          fecha: comando.fechaEvento,
        });

        // Fecha nueva OCUPADA por otra RESERVA → conflicto, rollback total (no se muta nada).
        if (estadoDestino.tipo === 'bloqueada') {
          throw new CambiarFechaConflictoError(MOTIVO_CONFLICTO);
        }

        // Fecha nueva LIBRE: bloquear F2 + mover la RESERVA + liberar F1 (atómico).
        await repos.fechaBloqueada.bloquear({
          tenantId: comando.tenantId,
          fecha: comando.fechaEvento,
          reservaId: reserva.idReserva,
        });

        const actualizada = await repos.reservas.actualizarFecha({
          idReserva: reserva.idReserva,
          fechaEvento: comando.fechaEvento,
        });

        // ¿La fecha antigua tenía cola? (se resuelve antes de liberar, para disparar la
        // promoción tras la liberación, exactamente una vez).
        const antiguaTeniaCola =
          fechaAntigua !== null &&
          (await repos.fechaBloqueada.tieneCola({
            tenantId: comando.tenantId,
            fecha: fechaAntigua,
            reservaId: reserva.idReserva,
          }));

        if (fechaAntigua !== null) {
          await repos.fechaBloqueada.liberar({
            tenantId: comando.tenantId,
            fecha: fechaAntigua,
            reservaId: reserva.idReserva,
          });
        }

        // Promoción FIFO (A15) del primero en cola de F1, exactamente una vez.
        if (antiguaTeniaCola && fechaAntigua !== null) {
          await repos.promocionCola.promoverPrimeroEnCola({
            tenantId: comando.tenantId,
            fecha: fechaAntigua,
          });
        }

        // AUDIT_LOG `actualizar` (F1 → F2), en la misma transacción.
        await repos.auditoria.registrar({
          tenantId: comando.tenantId,
          usuarioId: comando.usuarioId,
          accion: 'actualizar',
          entidad: 'RESERVA',
          entidadId: reserva.idReserva,
          datosAnteriores: { fecha_evento: fechaAntigua },
          datosNuevos: { fecha_evento: comando.fechaEvento },
        });

        return actualizada;
      },
    )) as ReservaCambioFecha;

    return { reserva: resultado };
  }
}
