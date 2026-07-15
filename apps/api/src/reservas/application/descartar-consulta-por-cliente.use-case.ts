/**
 * Caso de uso de APLICACIÓN `DescartarConsultaPorClienteUseCase` (US-013 / UC-10 / A17,
 * actor Gestor "en nombre del cliente").
 *
 * Es la ACCIÓN MANUAL que descarta una consulta activa desde la ficha: transiciona
 * `{consulta, 2a|2b|2c|2d|2v} → {consulta, 2z}` (terminal e inmutable) y, SEGÚN EL ORIGEN
 * (tabla design.md §D-1), libera la FECHA_BLOQUEADA (`liberarFecha()`, 2b/2c/2v), dispara la
 * promoción FIFO A15 una vez (`promoverPrimeroEnCola`, 2b/2v con cola) o decrementa la cola
 * (2d), anexa el motivo opcional a `RESERVA.notas` y audita — todo en UNA transacción atómica
 * bajo el contexto RLS del tenant.
 *
 * Hexagonal (hook `no-infra-in-domain`): NO importa Prisma ni `@nestjs/*`. El caso de uso solo
 * ORQUESTA — recibe `{ tenantId, usuarioId, reservaId, motivo? }`, delega en el puerto
 * `DescarteConsultaUoWPort` (que encapsula toda la TRANSACCIÓN atómica bajo `SELECT … FOR
 * UPDATE` + re-evaluación de la guarda de origen `resolverDescarteCliente` bajo el lock) y
 * PROPAGA su desenlace o su error de dominio. La ATOMICIDAD REAL, el lock y la serialización
 * (RC-1/RC-2/RC-3) viven en el adaptador Prisma de la unidad de trabajo — sin locks
 * distribuidos (hook `no-distributed-lock`). El caso de uso NO atrapa los errores: cualquier
 * fallo de un paso de la UoW se propaga para que la transacción haga rollback total.
 */

// ---------------------------------------------------------------------------
// Comando de entrada + desenlace por rama (tipos de la aplicación)
// ---------------------------------------------------------------------------

/**
 * Comando de entrada del descarte. `tenantId`/`usuarioId` derivan SIEMPRE del JWT (contexto
 * RLS + origen Gestor del AUDIT_LOG), nunca del path/body. `motivo` es OPCIONAL: si viaja, la
 * UoW lo anexa a `RESERVA.notas`; su ausencia (`undefined`) NO bloquea la transición.
 */
export interface DescartarConsultaComando {
  /** Tenant del JWT (nunca del path/body): contexto RLS de toda la operación. */
  tenantId: string;
  /** Gestor autenticado (JWT): origen Gestor del AUDIT_LOG de la transición. */
  usuarioId: string;
  /** RESERVA a descartar (path). */
  reservaId: string;
  /** Motivo OPCIONAL comunicado por el cliente; se anexa a `RESERVA.notas`. */
  motivo?: string;
}

/**
 * Desenlace del descarte (lo devuelve la UoW). Expone el par (origen → destino) para la
 * auditoría y los flags de efectos por rama (tabla design.md §D-1) que el frontend/QA
 * verifican. `subEstadoNuevo` es SIEMPRE `2z`.
 */
export interface ResultadoDescarteConsulta {
  /** RESERVA descartada. */
  reservaId: string;
  /** Sub_estado de ORIGEN bajo el lock (2a/2b/2c/2d/2v) — alimenta el AUDIT_LOG. */
  subEstadoAnterior: string;
  /** Sub_estado destino: siempre `2z` (terminal). */
  subEstadoNuevo: string;
  /** `true` si se liberó la FECHA_BLOQUEADA (2b/2c/2v); `false` en 2a/2d. */
  fechaLiberada: boolean;
  /** `true` si se disparó la promoción A15 exactamente una vez (2b/2v con cola). */
  promocionDisparada: boolean;
  /** Nº de RESERVA de cola reordenadas por decremento (solo rama 2d). */
  reordenadas: number;
  /** `true` si se anexó el motivo a `RESERVA.notas`; `false` sin motivo. */
  notasActualizadas: boolean;
}

// ---------------------------------------------------------------------------
// Puerto (interfaz) — implementado en infraestructura (adaptador Prisma)
// ---------------------------------------------------------------------------

/**
 * Unidad de trabajo atómica del descarte por cliente (puerto). Encapsula TODA la transacción
 * indivisible bajo el contexto RLS del tenant: `SELECT … FOR UPDATE` (FECHA_BLOQUEADA y/o
 * RESERVA), re-evaluación de la guarda de origen (`resolverDescarteCliente`), transición a
 * `2z`, liberación de fecha / promoción / decremento de cola SEGÚN EL ORIGEN, anexado opcional
 * del motivo a `notas` y auditoría. Aborta (rollback total) lanzando `DescarteEstadoTerminalError`
 * (origen terminal / carrera perdida) o `ReservaNoEncontradaDescarteError` (invisible bajo RLS).
 * La implementación (adaptador Prisma) reutiliza `liberarFecha()`/`bloquearFecha()` y el seam
 * `promoverPrimeroEnCola` — sin locks distribuidos.
 */
export interface DescarteConsultaUoWPort {
  descartar(comando: DescartarConsultaComando): Promise<ResultadoDescarteConsulta>;
}

/** Dependencias del caso de uso (puerto inyectado, hexagonal). */
export interface DescartarConsultaPorClienteDeps {
  uow: DescarteConsultaUoWPort;
}

// ---------------------------------------------------------------------------
// Errores de dominio de la aplicación (clases DISJUNTAS: el controller las mapea
// a códigos HTTP distintos — 409 vs 404).
// ---------------------------------------------------------------------------

/**
 * La RESERVA está en un sub_estado/estado TERMINAL (`2x/2y/2z`/`reserva_cancelada`/
 * `reserva_completada`) o una petición concurrente ya la descartó / expiró bajo el lock
 * (RC-1/RC-3): la transición a `2z` no es aplicable → 409 `code: transicion_no_permitida`. El
 * mensaje es el literal EXACTO del contrato. NO extiende `ReservaNoEncontradaDescarteError`.
 */
export class DescarteEstadoTerminalError extends Error {
  readonly codigo = 'transicion_no_permitida' as const;

  constructor(
    mensaje = 'Esta consulta ya está en un estado terminal y no puede modificarse',
  ) {
    super(mensaje);
    this.name = 'DescarteEstadoTerminalError';
  }
}

/**
 * La RESERVA no existe para el tenant (invisible bajo RLS: inexistente o de otro tenant) →
 * 404. Error PROPIO y DISJUNTO de `DescarteEstadoTerminalError` (el controller los mapea a
 * códigos HTTP distintos).
 */
export class ReservaNoEncontradaDescarteError extends Error {
  readonly codigo = 'RESERVA_NO_ENCONTRADA' as const;

  constructor(mensaje = 'La reserva indicada no existe') {
    super(mensaje);
    this.name = 'ReservaNoEncontradaDescarteError';
  }
}

// ---------------------------------------------------------------------------
// Caso de uso
// ---------------------------------------------------------------------------

export class DescartarConsultaPorClienteUseCase {
  constructor(private readonly deps: DescartarConsultaPorClienteDeps) {}

  /**
   * Ejecuta el descarte delegando en la UoW atómica. Solo ORQUESTA: propaga el comando tal
   * cual (tenant/usuario/reserva/motivo, incluido `motivo === undefined`) y devuelve el
   * desenlace. NO atrapa errores: `DescarteEstadoTerminalError` (409),
   * `ReservaNoEncontradaDescarteError` (404) y cualquier fallo de un paso (rollback total) se
   * propagan al controller.
   */
  async ejecutar(
    comando: DescartarConsultaComando,
  ): Promise<ResultadoDescarteConsulta> {
    return this.deps.uow.descartar(comando);
  }
}
