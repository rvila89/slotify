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
 * Tabla declarativa de entradas iniciales VÁLIDAS del agregado RESERVA. Además de
 * la consulta exploratoria (2.a) sin TTL (US-003), el alta CON FECHA (US-004) añade
 * dos entradas iniciales: la consulta con fecha que bloquea (2.b) y la que entra en
 * cola (2.d). El TTL concreto de 2.b lo calcula la aplicación (now()+ttl_consulta);
 * aquí solo se declara la VALIDEZ del punto de entrada.
 */
const ENTRADAS_INICIALES: ReadonlyArray<EntradaInicial> = [
  { estado: 'consulta', subEstado: '2a', ttlExpiracion: null },
  { estado: 'consulta', subEstado: '2b', ttlExpiracion: null },
  { estado: 'consulta', subEstado: '2d', ttlExpiracion: null },
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

// ---------------------------------------------------------------------------
// Determinación declarativa del sub-estado del ALTA CON FECHA (US-004 / §D-3)
// ---------------------------------------------------------------------------

/** Acción asociada al sub-estado resultante del alta con fecha. */
export type AccionAlta = 'bloquear' | 'encolar' | 'exploratoria';

/** Resultado de la determinación del alta: sub-estado destino + acción. */
export interface ResultadoAlta {
  subEstado: '2b' | '2d' | '2a';
  accion: AccionAlta;
}

/**
 * Estado de disponibilidad de la fecha visto por el alta. `libre` = no hay fila
 * activa en `FECHA_BLOQUEADA` para `(tenant, fecha)`; `bloqueada` = la hay, con el
 * sub-estado/estado de la RESERVA bloqueante.
 */
export type EstadoFecha =
  | { tipo: 'libre' }
  | {
      tipo: 'bloqueada';
      subEstadoBloqueante: SubEstadoConsulta | null;
      estadoBloqueante: EstadoReserva;
    };

/**
 * Clave de regla del alta con fecha. Clasifica el `EstadoFecha` en uno de los tres
 * casos canónicos para hacer un lookup en la tabla `REGLAS_ALTA_CON_FECHA`.
 */
type ClaveReglaAlta = 'libre' | 'bloqueada-por-2b' | 'bloqueada-no-encolable';

/**
 * Tabla declarativa estado-de-la-fecha → resultado del alta (datos, NO `if/else`
 * disperso; skill `state-machine`). Una sola fuente de verdad reutilizada también
 * por la re-derivación tras la colisión D4 (US-004 §D-6): tras un `P2002` en el
 * INSERT de 2.b, al reabrir la transacción la fecha pasa a `bloqueada-por-2b` y la
 * tabla devuelve `2.d`.
 */
const REGLAS_ALTA_CON_FECHA: Readonly<Record<ClaveReglaAlta, ResultadoAlta>> = {
  libre: { subEstado: '2b', accion: 'bloquear' },
  'bloqueada-por-2b': { subEstado: '2d', accion: 'encolar' },
  'bloqueada-no-encolable': { subEstado: '2a', accion: 'exploratoria' },
};

/**
 * Clasifica el estado de la fecha. Solo la fecha bloqueada por una consulta en
 * `2.b` es encolable (2.d); el resto de bloqueos (`2.c`, `2.v`, `pre_reserva`,
 * `reserva_confirmada` o posteriores) degradan el alta a `2.a` exploratoria.
 */
const clasificarEstadoFecha = (estado: EstadoFecha): ClaveReglaAlta => {
  if (estado.tipo === 'libre') {
    return 'libre';
  }
  return estado.estadoBloqueante === 'consulta' && estado.subEstadoBloqueante === '2b'
    ? 'bloqueada-por-2b'
    : 'bloqueada-no-encolable';
};

/**
 * Determina el sub-estado y la acción del alta con fecha a partir del estado de la
 * fecha, consultando la tabla declarativa `REGLAS_ALTA_CON_FECHA`.
 */
export const determinarAltaConFecha = (estado: EstadoFecha): ResultadoAlta =>
  REGLAS_ALTA_CON_FECHA[clasificarEstadoFecha(estado)];

// ---------------------------------------------------------------------------
// Guarda de ORIGEN de la transición «añadir fecha» (US-005 / UC-04 / §D-3)
// ---------------------------------------------------------------------------

/**
 * Forma declarativa de un origen de transición: `(estado, subEstado)` desde el que
 * la operación «añadir fecha» es legal. A diferencia de las ENTRADAS_INICIALES (que
 * describen la creación del agregado), aquí se describe el ÚNICO punto de partida
 * VÁLIDO para mutar un agregado que YA existe hacia `2.b`/`2.d`.
 */
interface OrigenTransicion {
  estado: EstadoReserva;
  subEstado: SubEstadoConsulta | null;
}

/**
 * Tabla declarativa de ORÍGENES válidos de la transición «añadir fecha» (US-005,
 * skill `state-machine`, NO condicionales dispersos). Solo la consulta exploratoria
 * `consulta/2a` puede recibir una `fecha_evento`; el destino concreto (`2b`/`2d`/
 * permanece) lo resuelve `determinarAltaConFecha` según la disponibilidad de la
 * fecha. El resto de sub-estados de consulta (`2b/2c/2d/2v`), los terminales
 * (`2x/2y/2z`) y cualquier estado distinto de `consulta` (incluidos
 * `reserva_cancelada`/`reserva_completada`, inmutables) NO son orígenes legales.
 */
const ORIGENES_TRANSICION_ANADIR_FECHA: ReadonlyArray<OrigenTransicion> = [
  { estado: 'consulta', subEstado: '2a' },
];

/**
 * Guarda declarativa: ¿es `(estado, subEstado)` un ORIGEN legal de la transición
 * «añadir fecha» (US-005)? Consulta la tabla `ORIGENES_TRANSICION_ANADIR_FECHA`:
 * solo `consulta/2a` lo es. Se evalúa ANTES de abrir la transacción para rechazar
 * sin efectos las transiciones desde sub-estados/estados no permitidos.
 */
export const esOrigenValidoParaAnadirFecha = (
  estado: EstadoReserva,
  subEstado: SubEstadoConsulta | null,
): boolean =>
  ORIGENES_TRANSICION_ANADIR_FECHA.some(
    (origen) => origen.estado === estado && origen.subEstado === subEstado,
  );

// ---------------------------------------------------------------------------
// Guarda de ORIGEN de la transición «pendiente de invitados» (US-007 / UC-06 / §D-3)
// ---------------------------------------------------------------------------

/**
 * Tabla declarativa de ORÍGENES válidos de la transición «marcar como pendiente de
 * invitados» (`2.b → 2.c`, US-007, skill `state-machine`, NO condicionales
 * dispersos). Origen ESTRICTO `consulta/2b` (D-1 aprobado): "2.a con bloqueo" ≡ 2.b
 * en el modelo del proyecto, así que NO se admite `2.a` como origen para evitar un
 * estado fantasma. El resto de sub-estados de consulta (`2a/2c/2d/2v`), los
 * terminales (`2x/2y/2z`) y cualquier estado distinto de `consulta` (incluidos
 * `reserva_cancelada`/`reserva_completada`, inmutables) NO son orígenes legales.
 * Una sola transición permitida: `{consulta, 2b} → {consulta, 2c}`.
 */
const ORIGENES_TRANSICION_PENDIENTE_INVITADOS: ReadonlyArray<OrigenTransicion> = [
  { estado: 'consulta', subEstado: '2b' },
];

/**
 * Guarda declarativa: ¿es `(estado, subEstado)` un ORIGEN legal de la transición
 * «pendiente de invitados» (US-007)? Consulta la tabla
 * `ORIGENES_TRANSICION_PENDIENTE_INVITADOS`: solo `consulta/2b` lo es. Se evalúa
 * ANTES de mutar para rechazar sin efectos cualquier otro sub-estado/estado (422).
 */
export const esOrigenValidoParaPendienteInvitados = (
  estado: EstadoReserva,
  subEstado: SubEstadoConsulta | null,
): boolean =>
  ORIGENES_TRANSICION_PENDIENTE_INVITADOS.some(
    (origen) => origen.estado === estado && origen.subEstado === subEstado,
  );

// ---------------------------------------------------------------------------
// Guarda de ORIGEN de la transición «programar visita» (US-008 / UC-07 / §D-1)
// ---------------------------------------------------------------------------

/**
 * Conjunto declarativo de ORÍGENES válidos de la transición «programar visita al
 * espacio» (`{2a,2b,2c} → 2v`, US-008, skill `state-machine`, NO condicionales
 * dispersos). A diferencia de US-005 (origen estricto `2.a`) y US-007 (origen
 * estricto `2.b`), esta transición admite TRES orígenes de consulta ACTIVA
 * (`2a/2b/2c`): la consulta exploratoria, la consulta con fecha bloqueada y la
 * pendiente de invitados. La cola `2.d` NO es origen (debe promoverse primero,
 * UC-12; se rechaza con un mensaje específico en la aplicación); el propio destino
 * `2.v` (ya programada) tampoco; los terminales (`2x/2y/2z`) y cualquier estado
 * distinto de `consulta` (incluidos `reserva_cancelada`/`reserva_completada`,
 * inmutables) son orígenes inválidos. Tres transiciones permitidas:
 * `{consulta,2a}`, `{consulta,2b}`, `{consulta,2c}` → `{consulta,2v}`.
 */
export const ORIGENES_TRANSICION_PROGRAMAR_VISITA: ReadonlyArray<OrigenTransicion> = [
  { estado: 'consulta', subEstado: '2a' },
  { estado: 'consulta', subEstado: '2b' },
  { estado: 'consulta', subEstado: '2c' },
];

/**
 * Guarda declarativa: ¿es `(estado, subEstado)` un ORIGEN legal de la transición
 * «programar visita» (US-008)? Consulta la tabla
 * `ORIGENES_TRANSICION_PROGRAMAR_VISITA`: solo `consulta/{2a,2b,2c}` lo es. Se
 * evalúa ANTES de mutar para rechazar sin efectos cualquier otro sub-estado/estado.
 * El caso `2.d` (cola) se distingue en la aplicación para devolver 409 (UC-12); el
 * resto de no-orígenes mapea a 422.
 */
export const esOrigenValidoParaProgramarVisita = (
  estado: EstadoReserva,
  subEstado: SubEstadoConsulta | null,
): boolean =>
  ORIGENES_TRANSICION_PROGRAMAR_VISITA.some(
    (origen) => origen.estado === estado && origen.subEstado === subEstado,
  );

// ---------------------------------------------------------------------------
// Guarda de PRECONDICIÓN «bloqueo blando extensible» (US-006 / UC-05 / §D-1)
// ---------------------------------------------------------------------------

/**
 * Forma declarativa de un estado con bloqueo blando EXTENSIBLE. A diferencia de los
 * `OrigenTransicion` (orígenes de una transición origen→destino), aquí cada entrada
 * describe una PRECONDICIÓN sobre el estado actual del agregado: el conjunto de
 * `(estado, subEstado)` en los que existe —por modelo— un bloqueo blando con TTL
 * susceptible de prórroga. La vigencia real del TTL (`ttl_expiracion > ahora`) y la
 * presencia de la fila blanda en `FECHA_BLOQUEADA` se comprueban en el use-case bajo
 * el lock; esta tabla es la defensa rápida de estado previa a la BD.
 */
interface EstadoBloqueoExtensible {
  estado: EstadoReserva;
  subEstado: SubEstadoConsulta | null;
}

/**
 * Tabla declarativa de ESTADOS con bloqueo blando extensible (US-006, skill
 * `state-machine`, NO condicionales dispersos). Regla multi-estado del Gate (§D-1):
 * extensible ⇔ `subEstado ∈ {2b, 2c, 2v}` (consulta con fecha bloqueada, pendiente de
 * invitados o visita programada) O `estado = 'pre_reserva'` (sin sub-estado). NO son
 * extensibles: `2a` (exploratoria, sin fecha), la cola `2d` (sin bloqueo blando
 * propio), los terminales (`2x/2y/2z`/`reserva_cancelada`/`reserva_completada`,
 * inmutables) y `reserva_confirmada` (bloqueo FIRME, sin TTL que extender). Una sola
 * fuente de verdad sobre qué significa "tener bloqueo blando vigente extensible".
 */
const ESTADOS_BLOQUEO_BLANDO_EXTENSIBLE: ReadonlyArray<EstadoBloqueoExtensible> = [
  { estado: 'consulta', subEstado: '2b' },
  { estado: 'consulta', subEstado: '2c' },
  { estado: 'consulta', subEstado: '2v' },
  { estado: 'pre_reserva', subEstado: null },
];

/**
 * Guarda declarativa de PRECONDICIÓN: ¿tiene `(estado, subEstado)` un bloqueo blando
 * extensible (US-006)? Consulta la tabla `ESTADOS_BLOQUEO_BLANDO_EXTENSIBLE`:
 * `consulta/{2b,2c,2v}` O `pre_reserva` lo son. Se evalúa ANTES de tocar la BD para
 * rechazar con 422 los estados sin bloqueo activo extensible (`2a`/cola/terminales/
 * `reserva_confirmada`); la vigencia del TTL y la fila blanda se validan bajo el lock.
 */
export const esEstadoConBloqueoBlandoExtensible = (
  estado: EstadoReserva,
  subEstado: SubEstadoConsulta | null,
): boolean =>
  ESTADOS_BLOQUEO_BLANDO_EXTENSIBLE.some(
    (entrada) => entrada.estado === estado && entrada.subEstado === subEstado,
  );
