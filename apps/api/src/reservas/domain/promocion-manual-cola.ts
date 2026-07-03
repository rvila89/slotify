/**
 * Operación de dominio PURA de PLANIFICACIÓN de la promoción MANUAL de cola (US-019 /
 * UC-12 FA manual, actor Gestor) — DOMINIO PURO.
 *
 * Dado el conjunto de la cola leído por el puerto (RESERVA en `2.d` apuntando a la
 * bloqueante viva) y el id de la RESERVA ELEGIDA por el Gestor en `posicion_cola = P`
 * ARBITRARIA, calcula el PLAN declarativo de promoción SIN efectos: la mutación de la
 * promovida (2d→2b, `posicion_cola`/`consulta_bloqueante_id → null`) + los
 * reordenamientos por CIERRE DE HUECO: las de posición `> P` decrementan 1, las de `< P`
 * conservan su posición; TODAS re-apuntan su `consulta_bloqueante_id` a la nueva
 * bloqueante (la promovida). Valida la CONTIGÜIDAD de las posiciones (1..N sin huecos,
 * sin duplicados, arrancando en 1); si hay anomalía la marca (`anomalia: true`) SIN
 * promover, para que la aplicación audite + aborte sin corrección silenciosa (mismo
 * criterio que US-018).
 *
 * DIFERENCIA con `planificarPromocionCola` de US-018: US-018 promueve SIEMPRE la
 * posición 1 (FIFO); US-019 promueve la posición P ARBITRARIA elegida por el Gestor y
 * cierra el hueco. Cuando `P = 1` el plan coincide con el decremento uniforme de US-018.
 *
 * Hexagonal (hook `no-infra-in-domain`): este módulo NO importa `@nestjs/*`, Prisma ni
 * infraestructura. Reutiliza la guarda declarativa `resolverPromocionCola` de la máquina
 * de estados. No muta la entrada (función pura, determinista).
 */
import {
  resolverPromocionCola,
  type EstadoReserva,
  type SubEstadoConsulta,
} from './maquina-estados';

/**
 * Entrada de la cola tal como la lee el puerto para la promoción manual: una RESERVA en
 * `2.d` apuntando a la bloqueante viva, con su posición FIFO.
 */
export interface EntradaColaManual {
  reservaId: string;
  subEstado: SubEstadoConsulta;
  posicionCola: number;
  consultaBloqueanteId: string;
}

/** Mutación de la RESERVA promovida (2d→2b): sale de la cola y pasa a bloquear. */
export interface MutacionPromovidaManual {
  reservaId: string;
  estadoDestino: EstadoReserva;
  subEstadoDestino: SubEstadoConsulta;
  posicionColaDestino: null;
  consultaBloqueanteIdDestino: null;
}

/**
 * Reordenamiento de una RESERVA restante por cierre de hueco: su posición destino (igual
 * si estaba `< P`, decrementada en 1 si estaba `> P`) y su `consulta_bloqueante_id`
 * re-apuntado a la nueva bloqueante (la promovida).
 */
export interface ReordenamientoManual {
  reservaId: string;
  posicionColaDestino: number;
  consultaBloqueanteIdDestino: string;
}

/**
 * Plan declarativo de la promoción manual: la promovida (o `null` si no hay candidato
 * válido) + los reordenamientos del resto por cierre de hueco. `anomalia: true` señala
 * que no se puede promover (elegida ausente/no en `2.d`, cola vacía o posiciones no
 * contiguas): no se promueve nada y la aplicación audita + aborta.
 */
export interface PlanPromocionManualCola {
  anomalia: boolean;
  promovida: MutacionPromovidaManual | null;
  reordenamientos: ReordenamientoManual[];
}

const planAnomalia = (): PlanPromocionManualCola => ({
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
 * Planifica la promoción MANUAL de una posición P arbitraria (FUNCIÓN PURA): no muta la
 * entrada, es determinista. Selecciona la RESERVA elegida por `reservaId`, valida que
 * pertenece a la cola y sigue en `2.d` (guarda declarativa de origen), valida la
 * contigüidad de posiciones y calcula la mutación de la promovida + los reordenamientos
 * por cierre de hueco (`> P` decrementa, `< P` conserva, todos re-apuntan a la nueva
 * bloqueante).
 *
 * - Cola vacía → anomalía (no hay nada que promover).
 * - Elegida ausente de la cola o no en `2.d` → anomalía (guarda de origen, FA-05).
 * - Posiciones no contiguas (hueco / no arranca en 1 / duplicadas) → anomalía.
 */
export const planificarPromocionManualCola = (
  cola: ReadonlyArray<EntradaColaManual>,
  reservaElegidaId: string,
): PlanPromocionManualCola => {
  if (cola.length === 0) {
    return planAnomalia();
  }

  const elegida = cola.find((entrada) => entrada.reservaId === reservaElegidaId);
  if (elegida === undefined) {
    // La elegida por el Gestor no está en la cola leída bajo lock (FA-05).
    return planAnomalia();
  }

  // Guarda de origen declarativa (máquina de estados): solo `2.d` se promueve a `2.b`.
  const destino = resolverPromocionCola('consulta', elegida.subEstado);
  if (destino === null) {
    return planAnomalia();
  }

  if (!posicionesContiguas(cola.map((entrada) => entrada.posicionCola))) {
    return planAnomalia();
  }

  const posicionElegida = elegida.posicionCola;

  const promovida: MutacionPromovidaManual = {
    reservaId: elegida.reservaId,
    estadoDestino: destino.estado,
    subEstadoDestino: destino.subEstado,
    posicionColaDestino: null,
    consultaBloqueanteIdDestino: null,
  };

  // Cierre de hueco: las de posición `> P` decrementan 1, las de `< P` conservan su
  // posición; todas re-apuntan a la nueva bloqueante. Se ordena por posición ascendente
  // original para preservar el orden FIFO y no violar el índice UNIQUE parcial de cola.
  const reordenamientos: ReordenamientoManual[] = cola
    .filter((entrada) => entrada.reservaId !== elegida.reservaId)
    .sort((a, b) => a.posicionCola - b.posicionCola)
    .map((entrada) => ({
      reservaId: entrada.reservaId,
      posicionColaDestino:
        entrada.posicionCola > posicionElegida
          ? entrada.posicionCola - 1
          : entrada.posicionCola,
      consultaBloqueanteIdDestino: elegida.reservaId,
    }));

  return { anomalia: false, promovida, reordenamientos };
};
