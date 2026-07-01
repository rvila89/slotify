/**
 * Operación de dominio PURA de PLANIFICACIÓN de la promoción de cola (US-018 /
 * UC-12, A15) — DOMINIO PURO.
 *
 * Dado el estado de la cola leído por el puerto (candidato `posicion_cola = 1` +
 * restantes en `2.d` apuntando a la misma bloqueante liberada), calcula el PLAN
 * declarativo de promoción SIN efectos: la mutación de la promovida (2d→2b,
 * `posicion_cola`/`consulta_bloqueante_id → null`), el decremento FIFO del resto y
 * su re-apuntado a la nueva bloqueante (la promovida). Valida la CONTIGÜIDAD de las
 * posiciones (1..N sin huecos, sin duplicados, arrancando en 1); si hay anomalía la
 * marca (`anomalia: true`) SIN promover, para que la aplicación audite + aborte sin
 * corrección silenciosa (§D-8, spec "Anomalía de posiciones no contiguas").
 *
 * Hexagonal (hook `no-infra-in-domain`): este módulo NO importa `@nestjs/*`, Prisma
 * ni infraestructura. Reutiliza la guarda declarativa `resolverPromocionCola` de la
 * máquina de estados. No muta la entrada (función pura, determinista).
 */
import {
  resolverPromocionCola,
  type EstadoReserva,
  type SubEstadoConsulta,
} from './maquina-estados';

/**
 * Entrada de la cola tal como la lee el puerto: una RESERVA en `2.d` apuntando a la
 * bloqueante liberada, con su posición FIFO.
 */
export interface EntradaCola {
  reservaId: string;
  subEstado: SubEstadoConsulta;
  posicionCola: number;
  consultaBloqueanteId: string;
}

/** Mutación de la RESERVA promovida (2d→2b): sale de la cola y pasa a bloquear. */
export interface MutacionPromovida {
  reservaId: string;
  estadoDestino: EstadoReserva;
  subEstadoDestino: SubEstadoConsulta;
  posicionColaDestino: null;
  consultaBloqueanteIdDestino: null;
}

/**
 * Reordenamiento de una RESERVA restante: decrementa su posición en 1 y re-apunta su
 * `consulta_bloqueante_id` a la nueva bloqueante (la promovida).
 */
export interface Reordenamiento {
  reservaId: string;
  posicionColaDestino: number;
  consultaBloqueanteIdDestino: string;
}

/**
 * Plan declarativo de la promoción: la promovida (o `null` si no hay candidato) +
 * los reordenamientos del resto. `anomalia: true` señala posiciones no contiguas: no
 * se promueve nada y la aplicación audita + aborta.
 */
export interface PlanPromocionCola {
  anomalia: boolean;
  promovida: MutacionPromovida | null;
  reordenamientos: Reordenamiento[];
}

const planNoOp = (): PlanPromocionCola => ({
  anomalia: false,
  promovida: null,
  reordenamientos: [],
});

const planAnomalia = (): PlanPromocionCola => ({
  anomalia: true,
  promovida: null,
  reordenamientos: [],
});

/**
 * ¿Son las posiciones de la cola contiguas empezando en 1 (1..N sin huecos ni
 * duplicados)? Función pura sobre el conjunto de posiciones.
 */
const posicionesContiguas = (posiciones: ReadonlyArray<number>): boolean => {
  const ordenadas = [...posiciones].sort((a, b) => a - b);
  return ordenadas.every((pos, indice) => pos === indice + 1);
};

/**
 * Planifica la promoción de cola a partir del estado leído (FUNCIÓN PURA): no muta la
 * entrada, es determinista. Selecciona el candidato por `posicion_cola = 1` (FIFO
 * estricto, no por orden del array), valida la contigüidad y calcula la mutación de
 * la promovida + los decrementos del resto re-apuntando a la nueva bloqueante.
 *
 * - Cola vacía → no-op explícito (sin promovida, sin anomalía).
 * - Posiciones no contiguas (hueco / no arranca en 1 / duplicadas) → anomalía.
 * - Origen no promovible (defensa: la cola no está en `2.d`) → anomalía (no se
 *   promueve sin transición válida en la máquina de estados).
 */
export const planificarPromocionCola = (
  cola: ReadonlyArray<EntradaCola>,
): PlanPromocionCola => {
  if (cola.length === 0) {
    return planNoOp();
  }

  if (!posicionesContiguas(cola.map((entrada) => entrada.posicionCola))) {
    return planAnomalia();
  }

  const candidato = cola.find((entrada) => entrada.posicionCola === 1);
  if (candidato === undefined) {
    // Con posiciones contiguas siempre debe existir la posición 1; defensa.
    return planAnomalia();
  }

  // Guarda de origen declarativa (máquina de estados): solo `2.d` se promueve a `2.b`.
  const destino = resolverPromocionCola('consulta', candidato.subEstado);
  if (destino === null) {
    return planAnomalia();
  }

  const promovida: MutacionPromovida = {
    reservaId: candidato.reservaId,
    estadoDestino: destino.estado,
    subEstadoDestino: destino.subEstado,
    posicionColaDestino: null,
    consultaBloqueanteIdDestino: null,
  };

  // El resto (posición > 1) decrementa en 1 y re-apunta a la nueva bloqueante,
  // preservando el orden FIFO ascendente por posición original.
  const reordenamientos: Reordenamiento[] = cola
    .filter((entrada) => entrada.posicionCola !== 1)
    .sort((a, b) => a.posicionCola - b.posicionCola)
    .map((entrada) => ({
      reservaId: entrada.reservaId,
      posicionColaDestino: entrada.posicionCola - 1,
      consultaBloqueanteIdDestino: candidato.reservaId,
    }));

  return { anomalia: false, promovida, reordenamientos };
};
