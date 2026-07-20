/**
 * Operación de dominio PURA de PLANIFICACIÓN de la SALIDA DE COLA por cambio de fecha
 * (change `cambiar-fecha-consulta-en-cola` / design.md §D-3) — DOMINIO PURO.
 *
 * Dado el estado de la cola vieja leído por el puerto (todos los hermanos en `2.d` con el
 * mismo `consulta_bloqueante_id`) y la RESERVA que SALE (`salienteId`, en `posicion_cola =
 * P`), calcula el PLAN declarativo de reordenación SIN efectos: la saliente abandona la
 * cola (`posicion_cola → null`, `consulta_bloqueante_id → null`) y se CIERRA EL HUECO
 * decrementando en 1 la `posicion_cola` de los hermanos con `posicion_cola > P`.
 *
 * DIFERENCIA con la PROMOCIÓN (`planificarPromocionCola`, US-018): aquí NO hay promoción.
 * La saliente NO era bloqueante de nadie, así que el `consulta_bloqueante_id` de los
 * restantes NO cambia (por eso los reordenamientos NO llevan `consultaBloqueanteIdDestino`)
 * y NO se promueve a nadie a `2.b`. La saliente pasa a `2.b` bloqueando su fecha nueva en
 * OTRO seam (el use-case), no aquí.
 *
 * Valida la CONTIGÜIDAD de las posiciones (1..N sin huecos, sin duplicados, arrancando en
 * 1); ante cualquier ANOMALÍA (cola vacía, saliente ausente, saliente no en `2.d`,
 * posiciones no contiguas) marca `anomalia: true` SIN reordenar, para que la aplicación
 * audite + aborte sin corrección silenciosa.
 *
 * Hexagonal (hook `no-infra-in-domain`): este módulo NO importa `@nestjs/*`, Prisma ni
 * infraestructura. No muta la entrada (función pura, determinista).
 */
import type { SubEstadoConsulta } from './maquina-estados';

/**
 * Entrada de la cola vieja tal como la lee el puerto: una RESERVA en `2.d` apuntando a la
 * misma bloqueante, con su posición FIFO.
 */
export interface EntradaColaSalida {
  reservaId: string;
  subEstado: SubEstadoConsulta;
  posicionCola: number;
  consultaBloqueanteId: string;
}

/** Mutación de la RESERVA saliente: abandona la cola (posición y bloqueante a `null`). */
export interface MutacionSaliente {
  reservaId: string;
  posicionColaDestino: null;
  consultaBloqueanteIdDestino: null;
}

/**
 * Reordenamiento de una RESERVA restante: decrementa su posición en 1. A diferencia de la
 * PROMOCIÓN, NO re-apunta `consulta_bloqueante_id` (la bloqueante no cambia): por eso NO
 * lleva `consultaBloqueanteIdDestino`.
 */
export interface ReordenamientoSalida {
  reservaId: string;
  posicionColaDestino: number;
}

/**
 * Plan declarativo de la salida de cola: la saliente + los reordenamientos de los hermanos
 * con `posicion_cola > P`. `anomalia: true` señala una cola inconsistente: no se reordena
 * nada y la aplicación audita + aborta.
 */
export interface PlanSalidaDeCola {
  anomalia: boolean;
  saliente: MutacionSaliente;
  reordenamientos: ReordenamientoSalida[];
}

/** Marca la mutación de la saliente (misma forma en el caso feliz y en la anomalía). */
const mutacionSaliente = (salienteId: string): MutacionSaliente => ({
  reservaId: salienteId,
  posicionColaDestino: null,
  consultaBloqueanteIdDestino: null,
});

/** Plan de anomalía: no reordena a nadie; la aplicación audita + aborta. */
const planAnomalia = (salienteId: string): PlanSalidaDeCola => ({
  anomalia: true,
  saliente: mutacionSaliente(salienteId),
  reordenamientos: [],
});

/**
 * ¿Son las posiciones de la cola contiguas empezando en 1 (1..N sin huecos ni duplicados)?
 * Función pura sobre el conjunto de posiciones.
 */
const posicionesContiguas = (posiciones: ReadonlyArray<number>): boolean => {
  const ordenadas = [...posiciones].sort((a, b) => a - b);
  return ordenadas.every((pos, indice) => pos === indice + 1);
};

/**
 * Planifica la SALIDA DE COLA a partir del estado leído (FUNCIÓN PURA): no muta la entrada,
 * es determinista. La saliente sale de la cola; los hermanos con `posicion_cola > P`
 * decrementan en 1 (orden ascendente por posición original), cerrando el hueco y dejando
 * las posiciones restantes contiguas desde 1. Los hermanos con `posicion_cola < P` NO
 * cambian (no se emiten reordenamientos para ellos).
 *
 * - Cola vacía → anomalía.
 * - Saliente ausente de la cola → anomalía.
 * - Saliente no en `2.d` → anomalía (defensa: no hay salida de cola sin origen válido).
 * - Posiciones no contiguas (hueco / no arranca en 1 / duplicadas) → anomalía.
 */
export const planificarSalidaDeCola = (
  cola: ReadonlyArray<EntradaColaSalida>,
  salienteId: string,
): PlanSalidaDeCola => {
  if (cola.length === 0) {
    return planAnomalia(salienteId);
  }

  if (!posicionesContiguas(cola.map((entrada) => entrada.posicionCola))) {
    return planAnomalia(salienteId);
  }

  const saliente = cola.find((entrada) => entrada.reservaId === salienteId);
  if (saliente === undefined || saliente.subEstado !== '2d') {
    return planAnomalia(salienteId);
  }

  const posicionSaliente = saliente.posicionCola;

  // Solo los hermanos por DETRÁS (posición > P) decrementan en 1; los de delante no cambian.
  const reordenamientos: ReordenamientoSalida[] = cola
    .filter((entrada) => entrada.posicionCola > posicionSaliente)
    .sort((a, b) => a.posicionCola - b.posicionCola)
    .map((entrada) => ({
      reservaId: entrada.reservaId,
      posicionColaDestino: entrada.posicionCola - 1,
    }));

  return {
    anomalia: false,
    saliente: mutacionSaliente(salienteId),
    reordenamientos,
  };
};
