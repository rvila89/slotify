/**
 * Caso de uso de APLICACIÓN: PROMOCIÓN automática del primero en cola (US-018 /
 * UC-12, A15, actor Sistema). Es el DESTINATARIO real del seam
 * `PromocionColaPort.promoverPrimeroEnCola({ tenantId, fecha })` que US-041 cableó y
 * US-012 dejó como stub no-op (D-1: el disparo post-commit está CONGELADO; aquí solo
 * se implementa el EFECTO).
 *
 * Orquesta la promoción a través de UN puerto inyectado (hexagonal): la UNIDAD DE
 * TRABAJO atómica `PromocionColaUoWPort`, que encapsula la transacción indivisible:
 *   1. `SELECT … FOR UPDATE` sobre las RESERVA en `s2d` de `(tenant, fecha)` — punto de
 *      serialización (RC-1/RC-2/RC-3). NO se bloquea sobre `FECHA_BLOQUEADA`: tras la
 *      liberación post-commit esa fila NO existe, así que un `FOR UPDATE` sobre 0 filas
 *      no serializaría; el cerrojo efectivo son las filas de cola pendientes.
 *   2. Guarda "ya promovida" (D-3): re-verifica bajo el lock que sigue habiendo un
 *      candidato `posicion_cola = 1` pendiente y que la fecha no apunta ya a una
 *      bloqueante viva promovida. Si otra ruta ya promovió → no-op silencioso.
 *   3. Leer la cola bajo lock, calcular el plan de dominio (`planificarPromocionCola`)
 *      y aplicarlo: mutar la promovida a `2.b`, re-bloquear vía `bloquearFecha()`,
 *      reordenar el resto FIFO, auditar por RESERVA y dejar la alerta interna al
 *      gestor (D-5, sin email al cliente / sin US-045).
 * Todo en UNA transacción bajo el contexto RLS del tenant de la fecha (D-7). La
 * exclusión mutua vive SOLO en PostgreSQL (atomic-date-lock); nunca locks distribuidos.
 *
 * Hexagonal: depende SOLO del puerto; no importa Prisma ni `@nestjs/*`.
 */

/**
 * Comando de entrada de la promoción. Coincide con la firma del seam heredado
 * (`{ tenantId, fecha }`); el `tenantId` viaja con el disparo (nunca de input externo,
 * D-7) y se usa para el contexto RLS de la transacción.
 */
export interface PromoverPrimeroEnColaComando {
  tenantId: string;
  fecha: Date;
}

/**
 * Desenlace de la promoción (lo devuelve la UoW). `promovida = false` cubre tanto el
 * no-op por ausencia de cola (FA-02) como el no-op por la guarda "ya promovida"
 * (FA-04 / RC-1 / RC-3) y la anomalía (que además marca `anomalia = true`).
 */
export interface ResultadoPromocion {
  /** `true` si esta ejecución aplicó efectivamente la promoción de la primera en cola. */
  promovida: boolean;
  /** Id de la RESERVA promovida a `2.b` (o `null` si no se promovió). */
  reservaPromovidaId: string | null;
  /** `true` si se re-creó la fila de `FECHA_BLOQUEADA` (blando) para la promovida. */
  fechaReBloqueada: boolean;
  /** Número de RESERVA restantes reordenadas (decremento FIFO). */
  reordenadas: number;
  /** `true` si se dejó constancia de la alerta interna al gestor (D-5). */
  alertaInternaRegistrada: boolean;
  /** `true` si la cola presentaba posiciones no contiguas: se auditó y abortó. */
  anomalia: boolean;
}

/**
 * Unidad de trabajo atómica de la promoción (puerto). Encapsula toda la transacción
 * (lock + guarda + plan + re-bloqueo + reordenación + auditoría + alerta interna) y
 * devuelve el desenlace. La implementación (adaptador Prisma) reutiliza
 * `bloquearFecha()` para el re-bloqueo y `SET LOCAL app.tenant_id` para RLS.
 */
export interface PromocionColaUoWPort {
  promover(comando: PromoverPrimeroEnColaComando): Promise<ResultadoPromocion>;
}

/** Dependencias del caso de uso (puerto inyectado, hexagonal). */
export interface PromoverPrimeroEnColaDeps {
  uow: PromocionColaUoWPort;
}

export class PromoverPrimeroEnColaService {
  constructor(private readonly deps: PromoverPrimeroEnColaDeps) {}

  /**
   * Ejecuta la promoción delegando en la UoW atómica. El caso de uso solo ORQUESTA:
   * propaga SIEMPRE el tenant del comando (D-7) y devuelve el desenlace tal cual (no
   * lanza en los no-op idempotentes: la UoW resuelve la guarda "ya promovida").
   */
  async ejecutar(comando: PromoverPrimeroEnColaComando): Promise<ResultadoPromocion> {
    return this.deps.uow.promover(comando);
  }

  /**
   * Firma del seam heredado (`PromocionColaPort`, que devuelve `void`): el adaptador de
   * promoción la invoca post-commit de `liberarFecha()` sin re-cablear el disparo (D-1).
   * Delega en `ejecutar` y DEVUELVE el desenlace (compatible con `Promise<void>`: un
   * método que retorna valor es asignable a un puerto que lo ignora), lo que permite a
   * los tests de integración/manuales inspeccionar el resultado sin tocar el contrato.
   */
  async promoverPrimeroEnCola(params: {
    tenantId: string;
    fecha: Date;
  }): Promise<ResultadoPromocion> {
    return this.ejecutar({ tenantId: params.tenantId, fecha: params.fecha });
  }
}
