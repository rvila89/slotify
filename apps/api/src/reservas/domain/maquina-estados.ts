/**
 * Máquina de estados de la RESERVA — DOMINIO PURO (US-003 / UC-03).
 *
 * Modela la ENTRADA INICIAL del agregado raíz RESERVA como una ESTRUCTURA DE
 * DATOS declarativa (skill `state-machine`): nada de `if/else` dispersos. El alta
 * de US-003 es la transición de creación `∅ → consulta / 2a` con
 * `ttl_expiracion = NULL`; NO es una transición entre dos estados existentes (esas
 * llegan en US-005+).
 *
 * Esta versión es MÍNIMA a propósito (anti-scope): solo describe las entradas
 * iniciales válidas del agregado. La tabla `ENTRADAS_INICIALES` está pensada para
 * extenderse (p. ej. `consulta`/`2b` en US-004/005) sin reescribir las guardas.
 *
 * Hexagonal (hook `no-infra-in-domain`): este módulo NO importa `@nestjs/*`,
 * Prisma ni infraestructura.
 */

/** Estados principales del ciclo de vida de la RESERVA. */
export type EstadoReserva =
  | 'consulta'
  | 'pre_reserva'
  | 'reserva_confirmada'
  | 'evento_en_curso'
  | 'post_evento'
  | 'reserva_completada'
  | 'reserva_cancelada';

/**
 * Sub-estados de la fase `consulta` en VALOR DE DOMINIO (sin el prefijo `s` del
 * enum Prisma). El mapeo a/desde el literal Prisma `s2a` vive en infraestructura
 * (`sub-estado-consulta.mapper.ts`).
 */
export type SubEstadoConsulta =
  | '2a'
  | '2b'
  | '2c'
  | '2d'
  | '2v'
  | '2x'
  | '2y'
  | '2z';

/** Forma exacta de la entrada inicial de una consulta exploratoria (2.a). */
export interface EstadoConsultaInicial {
  estado: 'consulta';
  subEstado: '2a';
  ttlExpiracion: null;
}

/**
 * Entrada de la tabla declarativa de puntos de entrada válidos del agregado.
 * `subEstado = null` representa una entrada sin sub-estado (no aplicable hoy).
 */
interface EntradaInicial {
  estado: EstadoReserva;
  subEstado: SubEstadoConsulta | null;
  ttlExpiracion: Date | null;
}

/**
 * Tabla declarativa de entradas iniciales VÁLIDAS del agregado RESERVA. Hoy solo
 * la consulta exploratoria (2.a) sin TTL. Ampliable por las US siguientes.
 */
const ENTRADAS_INICIALES: ReadonlyArray<EntradaInicial> = [
  { estado: 'consulta', subEstado: '2a', ttlExpiracion: null },
];

/**
 * Construye la entrada inicial canónica de una consulta exploratoria sin fecha:
 * `consulta` / `2a` / `ttl_expiracion = NULL`.
 */
export const entradaInicialConsultaExploratoria = (): EstadoConsultaInicial => ({
  estado: 'consulta',
  subEstado: '2a',
  ttlExpiracion: null,
});

/**
 * Guarda declarativa: ¿es `(estado, subEstado?)` un punto de entrada válido del
 * agregado? Consulta la tabla `ENTRADAS_INICIALES` (no condicionales dispersos).
 */
export const esEntradaInicialValida = (
  estado: EstadoReserva,
  subEstado?: SubEstadoConsulta,
): boolean =>
  ENTRADAS_INICIALES.some(
    (entrada) =>
      entrada.estado === estado &&
      entrada.subEstado === (subEstado ?? null),
  );
