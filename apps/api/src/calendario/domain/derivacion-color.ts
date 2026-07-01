/**
 * Derivación del COLOR del calendario a partir del par `(estado, subEstado)` de la
 * reserva bloqueante — DOMINIO PURO (US-039 / UC-29, design.md §D-2).
 *
 * El color se resuelve mediante una ESTRUCTURA DE DATOS declarativa (skill
 * `state-machine`: NADA de `if/else` dispersos), única fuente de verdad coherente
 * con SlotifyGeneralSpecs §11.3:
 *   - `gris`  → consulta ACTIVA (`subEstado` ∈ {2a, 2b, 2c, 2v}).
 *   - `ambar` → `pre_reserva`.
 *   - `verde` → `reserva_confirmada`, `evento_en_curso`, `post_evento` (herencia).
 *   - `azul`  → `reserva_completada`.
 *   - `rojo`  → `reserva_cancelada`.
 *   - `null`  → sub-estados TERMINALES de consulta (2x/2y/2z): su bloqueo ya fue
 *               liberado, NO ocupan fecha, no son una celda coloreada.
 *
 * Es una función pura y total: solo emite uno de los 5 colores canónicos del
 * contrato (`ColorCalendario`) o `null`. Hexagonal (hook `no-infra-in-domain`):
 * este módulo NO importa `@nestjs/*`, Prisma ni infraestructura.
 */
import type {
  EstadoReserva,
  SubEstadoConsulta,
} from '../../reservas/domain/maquina-estados';

/** Color semántico canónico del calendario (contrato `ColorCalendario`). */
export type ColorCalendario = 'gris' | 'ambar' | 'verde' | 'azul' | 'rojo';

/**
 * Sub-estados de consulta ACTIVA que ocupan fecha y se pintan en gris. Los
 * terminales (`2x`/`2y`/`2z`) y la cola (`2d`, que no es celda propia) quedan fuera.
 */
const SUB_ESTADOS_CONSULTA_GRIS: ReadonlyArray<SubEstadoConsulta> = [
  '2a',
  '2b',
  '2c',
  '2v',
];

/**
 * Tabla declarativa de color por ESTADO (cuando el estado por sí solo determina el
 * color, sin depender del sub-estado). La consulta NO está aquí: su color depende
 * del sub-estado (gris si activa, `null` si terminal) y se resuelve por separado.
 */
const COLOR_POR_ESTADO: Readonly<Partial<Record<EstadoReserva, ColorCalendario>>> = {
  pre_reserva: 'ambar',
  reserva_confirmada: 'verde',
  evento_en_curso: 'verde',
  post_evento: 'verde',
  reserva_completada: 'azul',
  reserva_cancelada: 'rojo',
};

/**
 * Deriva el color del calendario para la reserva bloqueante de una fecha. Devuelve
 * `null` cuando la fecha NO debe pintarse como celda coloreada (consulta terminal
 * 2x/2y/2z o cualquier `(estado, subEstado)` sin color canónico definido).
 */
export const derivarColor = (
  estado: EstadoReserva,
  subEstado: SubEstadoConsulta | null,
): ColorCalendario | null => {
  if (estado === 'consulta') {
    return subEstado !== null && SUB_ESTADOS_CONSULTA_GRIS.includes(subEstado)
      ? 'gris'
      : null;
  }
  return COLOR_POR_ESTADO[estado] ?? null;
};
