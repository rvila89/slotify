/**
 * Caso de uso de APLICACIÓN: PROMOCIÓN MANUAL de una consulta arbitraria de la cola por
 * el Gestor (US-019 / UC-12 FA manual, actor Gestor).
 *
 * Orquesta la promoción a través de UN puerto inyectado (hexagonal): la UNIDAD DE
 * TRABAJO atómica `PromocionManualColaUoWPort`, que encapsula la transacción indivisible
 * (§D-2/§D-3/§D-4):
 *   1. `SELECT … FOR UPDATE` sobre la fila de `FECHA_BLOQUEADA` de `(tenant, fecha)` —
 *      punto de SERIALIZACIÓN (RC-A/RC-B); a diferencia de US-018, aquí la fila SÍ existe
 *      porque la bloqueante aún no se ha liberado.
 *   2. Guarda de origen (FA-05): la elegida sigue en `2.d` y pertenece a la cola.
 *   3. Guarda "exige FECHA_BLOQUEADA activa" (inconsistencia si no).
 *   4. Guarda "ya promovida" (D-4): re-evalúa bajo el lock; si el barrido automático
 *      (US-018) u otro Gestor ya actualizó la cola, ABORTA con error de carrera → 409.
 *   5. Aplica el plan de dominio: expira la bloqueante viva a `2.x`, promueve la elegida a
 *      `2.b`, re-asigna `FECHA_BLOQUEADA` a la promovida, reordena por cierre de hueco,
 *      audita por RESERVA con `origen: 'promocion_manual'` + el `usuario_id` del Gestor.
 * Todo all-or-nothing bajo el contexto RLS del tenant del Gestor (D-7). La exclusión
 * mutua vive SOLO en PostgreSQL (atomic-date-lock); NUNCA locks distribuidos.
 *
 * El caso de uso ORQUESTA: aplica la guarda de CONFIRMACIÓN explícita ANTES de abrir la
 * transacción (defensa en servidor, D-1), propaga SIEMPRE el tenant/usuario del comando
 * (derivados del JWT, D-7) y traduce el desenlace de la UoW a resultado/errores de
 * dominio. Hexagonal: depende SOLO del puerto; no importa Prisma ni `@nestjs/*`.
 */

/**
 * Comando de entrada de la promoción manual. El `tenantId` y el `usuarioId` viajan
 * SIEMPRE derivados del JWT del Gestor (nunca de input externo, D-7); `reservaId` es la
 * RESERVA en `2.d` que el Gestor elige (cualquier posición); `confirmado` es la defensa
 * en servidor de la acción destructiva (D-1).
 */
export interface PromoverManualComando {
  tenantId: string;
  usuarioId: string;
  reservaId: string;
  confirmado: boolean;
}

/**
 * Resultado de la promoción manual (lo devuelve la UoW): la promovida, la bloqueante
 * expirada, si se re-asignó la fila de `FECHA_BLOQUEADA`, cuántas se reordenaron y
 * cuántas RESERVA se auditaron.
 */
export interface ResultadoPromocionManual {
  reservaPromovidaId: string;
  bloqueanteExpiradaId: string | null;
  fechaReAsignada: boolean;
  reordenadas: number;
  auditadas: number;
}

/**
 * Unidad de trabajo atómica de la promoción manual (puerto). Encapsula toda la
 * transacción (lock sobre `FECHA_BLOQUEADA` + guardas + expiración forzosa + promoción +
 * re-asignación de `FECHA_BLOQUEADA` + reordenación por cierre de hueco + auditoría) y
 * devuelve el desenlace. Lanza los errores de dominio cuando una guarda aborta.
 */
export interface PromocionManualColaUoWPort {
  promover(comando: PromoverManualComando): Promise<ResultadoPromocionManual>;
}

/** Dependencias del caso de uso (puerto inyectado, hexagonal). */
export interface PromoverManualEnColaDeps {
  uow: PromocionManualColaUoWPort;
}

/**
 * Error de dominio: la promoción manual llegó SIN confirmación explícita
 * (`confirmado !== true`). Se rechaza ANTES de abrir la transacción (defensa en
 * servidor, D-1); el controller lo mapea a 422.
 */
export class PromocionManualConfirmacionError extends Error {
  readonly codigo = 'PROMOCION_MANUAL_CONFIRMACION' as const;

  constructor(
    mensaje = 'La promoción manual requiere confirmación explícita (confirmado: true)',
  ) {
    super(mensaje);
    this.name = 'PromocionManualConfirmacionError';
  }
}

/**
 * Error de dominio: la RESERVA elegida ya NO está en `2.d` (FA-05): expiró, es terminal
 * o es la propia bloqueante; o no pertenece a la cola del tenant del JWT (RLS). El
 * controller lo mapea a 422 con "La consulta seleccionada ya no está en cola".
 */
export class PromocionManualConsultaNoEnColaError extends Error {
  readonly codigo = 'PROMOCION_MANUAL_CONSULTA_NO_EN_COLA' as const;

  constructor(mensaje = 'La consulta seleccionada ya no está en cola') {
    super(mensaje);
    this.name = 'PromocionManualConsultaNoEnColaError';
  }
}

/**
 * Error de dominio: la RESERVA `{id}` indicada no es RESOLUBLE bajo el contexto RLS del
 * tenant del JWT — no existe o pertenece a OTRO tenant (invisible por RLS). Es un error
 * DISTINTO de `PromocionManualConsultaNoEnColaError` (FA-05, "existe pero ya no en 2.d"):
 * NO hereda de él para que la jerarquía no colapse y el controller pueda mapearlos a
 * códigos separados. El controller lo mapea a 404 (H-1, code-review US-019; contrato op
 * `promoverConsultaCola` "Reserva {id} inexistente o de otro tenant (RLS)").
 */
export class PromocionManualReservaNoEncontradaError extends Error {
  readonly codigo = 'PROMOCION_MANUAL_RESERVA_NO_ENCONTRADA' as const;

  constructor(mensaje = 'La reserva indicada no existe') {
    super(mensaje);
    this.name = 'PromocionManualReservaNoEncontradaError';
  }
}

/**
 * Error de dominio: no existe una fila activa de `FECHA_BLOQUEADA` para la fecha de la
 * consulta elegida (inconsistencia: una consulta en `2.d` sin fecha bloqueada). El
 * controller lo mapea a 409.
 */
export class PromocionManualSinBloqueoError extends Error {
  readonly codigo = 'PROMOCION_MANUAL_SIN_BLOQUEO' as const;

  constructor(mensaje = 'No existe FECHA_BLOQUEADA activa para la fecha') {
    super(mensaje);
    this.name = 'PromocionManualSinBloqueoError';
  }
}

/**
 * Error de dominio: la guarda "ya promovida" detectó bajo el lock que el barrido
 * automático (US-018) u otro Gestor ya actualizó la cola (carrera perdida, D-4). El
 * controller lo mapea a 409 con el mensaje de recarga.
 */
export class PromocionManualCarreraPerdidaError extends Error {
  readonly codigo = 'PROMOCION_MANUAL_CARRERA_PERDIDA' as const;

  constructor(
    mensaje = 'La cola ya fue actualizada automáticamente, por favor recarga la vista',
  ) {
    super(mensaje);
    this.name = 'PromocionManualCarreraPerdidaError';
  }
}

export class PromoverManualEnColaService {
  constructor(private readonly deps: PromoverManualEnColaDeps) {}

  /**
   * Ejecuta la promoción manual. Aplica primero la guarda de CONFIRMACIÓN explícita
   * (defensa en servidor, D-1): sin `confirmado === true` rechaza SIN tocar la UoW (no
   * abre transacción). Si está confirmada, delega en la UoW atómica propagando SIEMPRE el
   * tenant/usuario del comando (D-7) y devuelve/propaga su desenlace tal cual (los
   * errores de dominio de las guardas bajo lock se propagan para que el controller los
   * mapee a su código HTTP).
   */
  async ejecutar(comando: PromoverManualComando): Promise<ResultadoPromocionManual> {
    if (comando.confirmado !== true) {
      throw new PromocionManualConfirmacionError();
    }
    return this.deps.uow.promover(comando);
  }
}
