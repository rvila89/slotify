/**
 * Caso de uso de APLICACIÓN `DescartarPreReservaUseCase` (change
 * `presupuesto-prereserva-cta-descarte-y-e2`, workstream B).
 *
 * Es el ESPEJO, en la fase `pre_reserva`, del descarte de consulta de US-013: la ACCIÓN MANUAL
 * del Gestor que cierra deliberadamente una pre-reserva que no avanza. Transiciona
 * `{pre_reserva, null} → {reserva_cancelada, null}` (terminal, `ttl_expiracion = NULL`), libera
 * la FECHA_BLOQUEADA por la ÚNICA función canónica `liberarFecha()`, promueve/reordena la cola de
 * esa fecha (misma mecánica de US-018) y audita `AUDIT_LOG` (`accion='transicion'`,
 * `entidad='RESERVA'`, `pre_reserva → reserva_cancelada`) con `motivo` OPCIONAL — todo en UNA
 * transacción atómica bajo el contexto RLS del tenant.
 *
 * Hexagonal (hook `no-infra-in-domain`): NO importa Prisma ni `@nestjs/*`. El caso de uso solo
 * ORQUESTA — recibe `{ tenantId, usuarioId, reservaId, motivo? }`, delega en el puerto
 * `DescartePreReservaUoWPort` (que encapsula toda la TRANSACCIÓN atómica bajo `SELECT … FOR
 * UPDATE` + re-evaluación de la guarda de origen `esOrigenValidoParaDescartarPreReserva` bajo el
 * lock) y PROPAGA su desenlace o su error de dominio. La ATOMICIDAD REAL, el lock y la
 * serialización (C-1/C-2) viven en el adaptador Prisma de la unidad de trabajo — sin locks
 * distribuidos (hook `no-distributed-lock`). El caso de uso NO atrapa los errores: cualquier
 * fallo de un paso de la UoW se propaga para que la transacción haga rollback total.
 */
import type { EstadoReserva } from '../domain/maquina-estados';

// ---------------------------------------------------------------------------
// Comando de entrada + desenlace (tipos de la aplicación)
// ---------------------------------------------------------------------------

/**
 * Comando de entrada del descarte de pre-reserva. `tenantId`/`usuarioId` derivan SIEMPRE del
 * JWT (contexto RLS + origen Gestor del AUDIT_LOG), nunca del path/body. `motivo` es OPCIONAL:
 * si viaja, la UoW lo audita en `AUDIT_LOG` (`datos_nuevos`); su ausencia (`undefined`) NO
 * bloquea la transición.
 */
export interface DescartarPreReservaComando {
  /** Tenant del JWT (nunca del path/body): contexto RLS de toda la operación. */
  tenantId: string;
  /** Gestor autenticado (JWT): origen Gestor del AUDIT_LOG de la transición. */
  usuarioId: string;
  /** RESERVA a descartar (path). */
  reservaId: string;
  /** Motivo OPCIONAL del descarte; se audita en `AUDIT_LOG.datos_nuevos`. */
  motivo?: string;
}

/**
 * Desenlace del descarte de pre-reserva (lo devuelve la UoW). Expone el par (origen → destino)
 * para la auditoría y los flags de efectos que el frontend/QA verifican. `estadoNuevo` es
 * SIEMPRE `reserva_cancelada`.
 */
export interface ResultadoDescartePreReserva {
  /** RESERVA descartada. */
  reservaId: string;
  /** Estado de ORIGEN bajo el lock: siempre `pre_reserva`. */
  estadoAnterior: EstadoReserva;
  /** Estado destino: siempre `reserva_cancelada` (terminal). */
  estadoNuevo: EstadoReserva;
  /** `true` si se liberó la FECHA_BLOQUEADA (la pre_reserva siempre tiene bloqueo activo). */
  fechaLiberada: boolean;
  /** `true` si se disparó la promoción A15 exactamente una vez (había cola en esa fecha). */
  promocionDisparada: boolean;
  /** `true` si se auditó el motivo en `AUDIT_LOG.datos_nuevos`; `false` sin motivo. */
  motivoAuditado: boolean;
}

// ---------------------------------------------------------------------------
// Puerto (interfaz) — implementado en infraestructura (adaptador Prisma)
// ---------------------------------------------------------------------------

/**
 * Unidad de trabajo atómica del descarte de pre-reserva (puerto). Encapsula TODA la transacción
 * indivisible bajo el contexto RLS del tenant: `SELECT … FOR UPDATE` (FECHA_BLOQUEADA y/o
 * RESERVA), re-evaluación de la guarda de origen (`esOrigenValidoParaDescartarPreReserva`),
 * transición a `reserva_cancelada` (`ttl_expiracion = NULL`), liberación de la fecha
 * (`liberarFecha()`), promoción/reordenación de la cola y auditoría con `motivo` opcional. Aborta
 * (rollback total) lanzando `DescartePreReservaOrigenInvalidoError` (origen no es `pre_reserva`),
 * `DescartePreReservaEstadoTerminalError` (ya terminal / carrera perdida bajo el lock) o
 * `ReservaNoEncontradaError` (invisible bajo RLS). La implementación (adaptador Prisma) reutiliza
 * `liberarFecha()`/`promoverPrimeroEnCola` — sin locks distribuidos.
 */
export interface DescartePreReservaUoWPort {
  descartar(comando: DescartarPreReservaComando): Promise<ResultadoDescartePreReserva>;
}

/** Dependencias del caso de uso (puerto inyectado, hexagonal). */
export interface DescartarPreReservaDeps {
  uow: DescartePreReservaUoWPort;
}

// ---------------------------------------------------------------------------
// Errores de dominio de la aplicación (clases DISJUNTAS: el controller las mapea
// a códigos HTTP distintos — 422 vs 409 vs 404).
// ---------------------------------------------------------------------------

/**
 * El origen NO es `pre_reserva` (`consulta` y sus sub-estados, `reserva_confirmada` y
 * posteriores): la transición «descartar pre-reserva» no es aplicable → 422
 * `code: origen_invalido` (enum del schema `DescartarReservaOrigenInvalidoError` del contrato;
 * distinto del `transicion_no_permitida` del 409 de estado terminal). Error PROPIO y DISJUNTO de
 * los otros dos.
 */
export class DescartePreReservaOrigenInvalidoError extends Error {
  readonly codigo = 'origen_invalido' as const;

  constructor(
    mensaje = 'Esta reserva no está en pre-reserva y no puede descartarse por esta vía',
  ) {
    super(mensaje);
    this.name = 'DescartePreReservaOrigenInvalidoError';
  }
}

/**
 * La RESERVA ya está en un estado TERMINAL (`reserva_cancelada`/`reserva_completada`) o una
 * petición concurrente ya la descartó bajo el lock (C-1): la transición no es aplicable → 409
 * `code: transicion_no_permitida`. Error PROPIO y DISJUNTO de los otros dos.
 */
export class DescartePreReservaEstadoTerminalError extends Error {
  readonly codigo = 'transicion_no_permitida' as const;

  constructor(
    mensaje = 'Esta reserva ya está en un estado terminal y no puede modificarse',
  ) {
    super(mensaje);
    this.name = 'DescartePreReservaEstadoTerminalError';
  }
}

/**
 * La RESERVA no existe para el tenant (invisible bajo RLS: inexistente o de otro tenant) →
 * 404. Error PROPIO y DISJUNTO de los otros dos.
 */
export class ReservaNoEncontradaError extends Error {
  readonly codigo = 'RESERVA_NO_ENCONTRADA' as const;

  constructor(mensaje = 'La reserva indicada no existe') {
    super(mensaje);
    this.name = 'ReservaNoEncontradaError';
  }
}

// ---------------------------------------------------------------------------
// Caso de uso
// ---------------------------------------------------------------------------

export class DescartarPreReservaUseCase {
  constructor(private readonly deps: DescartarPreReservaDeps) {}

  /**
   * Ejecuta el descarte delegando en la UoW atómica. Solo ORQUESTA: propaga el comando tal
   * cual (tenant/usuario/reserva/motivo, incluido `motivo === undefined`) y devuelve el
   * desenlace. NO atrapa errores: `DescartePreReservaOrigenInvalidoError` (422),
   * `DescartePreReservaEstadoTerminalError` (409), `ReservaNoEncontradaError` (404) y cualquier
   * fallo de un paso (rollback total) se propagan al orquestador/controller.
   */
  async ejecutar(
    comando: DescartarPreReservaComando,
  ): Promise<ResultadoDescartePreReserva> {
    return this.deps.uow.descartar(comando);
  }
}
