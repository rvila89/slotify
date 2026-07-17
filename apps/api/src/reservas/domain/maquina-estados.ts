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
// Guarda de ORIGEN de la transición «resultado de visita — cliente interesado»
// (US-009 / UC-08 / §D-1)
// ---------------------------------------------------------------------------

/**
 * Conjunto declarativo de ORÍGENES válidos de la transición «registrar resultado de
 * visita — cliente interesado» (`2v → 2b`, US-009, skill `state-machine`, NO
 * condicionales dispersos). A diferencia de US-008 (origen multi-estado
 * `{2a,2b,2c}`), esta transición es MONO-estado: SOLO la consulta con visita
 * programada (`consulta/2v`) es origen válido. Una consulta en cola `2.d` nunca
 * tuvo visita programada, así que es un origen inválido más (sin mensaje UC-12
 * dedicado). El resto de sub-estados de consulta (`2a/2b/2c/2d`), los terminales
 * (`2x/2y/2z`), el propio destino `2b` (idempotencia) y cualquier estado principal
 * distinto de `consulta` (incluidos `reserva_cancelada`/`reserva_completada`,
 * inmutables) son orígenes inválidos. Una sola transición permitida:
 * `{consulta,2v} → {consulta,2b}`.
 */
export const ORIGENES_TRANSICION_RESULTADO_VISITA_INTERESADO: ReadonlyArray<OrigenTransicion> =
  [{ estado: 'consulta', subEstado: '2v' }];

/**
 * Guarda declarativa: ¿es `(estado, subEstado)` un ORIGEN legal de la transición
 * «resultado de visita — cliente interesado» (US-009)? Consulta la tabla
 * `ORIGENES_TRANSICION_RESULTADO_VISITA_INTERESADO`: solo `consulta/2v` lo es. Se
 * evalúa (y se re-evalúa bajo el lock) ANTES de mutar para rechazar sin efectos
 * cualquier otro sub-estado/estado (422).
 */
export const esOrigenValidoParaResultadoVisitaInteresado = (
  estado: EstadoReserva,
  subEstado: SubEstadoConsulta | null,
): boolean =>
  ORIGENES_TRANSICION_RESULTADO_VISITA_INTERESADO.some(
    (origen) => origen.estado === estado && origen.subEstado === subEstado,
  );

// ---------------------------------------------------------------------------
// Guarda de ORIGEN de la transición «resultado de visita — reserva inmediata»
// (US-010 / UC-08 FA-08 / UC-14 / §D-1)
// ---------------------------------------------------------------------------

/**
 * Conjunto declarativo de ORÍGENES válidos de la transición «registrar resultado de
 * visita — reserva inmediata» (`2v → pre_reserva`, US-010, skill `state-machine`, NO
 * condicionales dispersos). Como US-009 (interesado), esta transición es MONO-estado:
 * SOLO la consulta con visita programada (`consulta/2v`) es origen válido. A diferencia
 * de US-014 (activar pre_reserva por confirmación de presupuesto, origen multi-estado
 * `{2a,2b,2c,2v}`), US-010 es un RESULTADO DE VISITA: una consulta sin visita programada
 * no puede "registrar el resultado de una visita", así que `2a/2b/2c/2d` son orígenes
 * inválidos. El resto de sub-estados de consulta, los terminales (`2x/2y/2z`), el propio
 * destino `pre_reserva` (idempotencia: ya avanzada) y cualquier estado principal distinto
 * de `consulta` (incluidos `reserva_cancelada`/`reserva_completada`, inmutables) son
 * orígenes inválidos. Una sola transición permitida: `{consulta,2v} → {pre_reserva, NULL}`.
 */
export const ORIGENES_TRANSICION_RESULTADO_VISITA_RESERVA_INMEDIATA: ReadonlyArray<OrigenTransicion> =
  [{ estado: 'consulta', subEstado: '2v' }];

/**
 * Guarda declarativa: ¿es `(estado, subEstado)` un ORIGEN legal de la transición
 * «resultado de visita — reserva inmediata» (US-010)? Consulta la tabla
 * `ORIGENES_TRANSICION_RESULTADO_VISITA_RESERVA_INMEDIATA`: solo `consulta/2v` lo es. Se
 * evalúa (y se re-evalúa bajo el lock) ANTES de mutar para rechazar sin efectos
 * cualquier otro sub-estado/estado (422).
 */
export const esOrigenValidoParaResultadoVisitaReservaInmediata = (
  estado: EstadoReserva,
  subEstado: SubEstadoConsulta | null,
): boolean =>
  ORIGENES_TRANSICION_RESULTADO_VISITA_RESERVA_INMEDIATA.some(
    (origen) => origen.estado === estado && origen.subEstado === subEstado,
  );

// ---------------------------------------------------------------------------
// Guarda de ORIGEN de la transición «activar pre_reserva» (US-014 / UC-14 / §D-2)
// ---------------------------------------------------------------------------

/**
 * Conjunto declarativo de ORÍGENES válidos de la transición «activar pre_reserva»
 * al confirmar el presupuesto (`{2a,2b,2c,2v} → pre_reserva`, US-014, skill
 * `state-machine`, NO condicionales dispersos). A diferencia de US-005 (origen
 * estricto `2.a`) y US-007 (origen estricto `2.b`), esta transición admite CUATRO
 * orígenes de consulta ACTIVA (`2a/2b/2c/2v`): la exploratoria, la consulta con fecha
 * bloqueada, la pendiente de invitados y la visita programada. La cola `2.d` NO es
 * origen (debe promoverse primero, UC-12; se rechaza con 409 en la aplicación); los
 * terminales (`2x/2y/2z`), el propio destino `pre_reserva` (ya confirmada) y cualquier
 * otro estado principal distinto de `consulta` (incluidos `reserva_cancelada`/
 * `reserva_completada`, inmutables) son orígenes inválidos. Mismo patrón que
 * `ORIGENES_TRANSICION_PROGRAMAR_VISITA` (US-008).
 */
export const ORIGENES_TRANSICION_ACTIVAR_PRERESERVA: ReadonlyArray<OrigenTransicion> = [
  { estado: 'consulta', subEstado: '2a' },
  { estado: 'consulta', subEstado: '2b' },
  { estado: 'consulta', subEstado: '2c' },
  { estado: 'consulta', subEstado: '2v' },
];

/**
 * Guarda declarativa: ¿es `(estado, subEstado)` un ORIGEN legal de la transición
 * «activar pre_reserva» (US-014)? Consulta la tabla
 * `ORIGENES_TRANSICION_ACTIVAR_PRERESERVA`: solo `consulta/{2a,2b,2c,2v}` lo es. Se
 * evalúa ANTES de invocar el motor de tarifa y de abrir la transacción para rechazar
 * sin efectos cualquier otro sub-estado/estado. El caso `2.d` (cola) se distingue en
 * la aplicación para devolver 409 (remite a UC-12); el resto de no-orígenes también
 * mapea a 409 (conflicto de estado, F5-02).
 */
export const esOrigenValidoParaActivarPrereserva = (
  estado: EstadoReserva,
  subEstado: SubEstadoConsulta | null,
): boolean =>
  ORIGENES_TRANSICION_ACTIVAR_PRERESERVA.some(
    (origen) => origen.estado === estado && origen.subEstado === subEstado,
  );

// ---------------------------------------------------------------------------
// Guarda de ORIGEN de la transición «confirmar pago de señal» (US-021 / UC-17 / §D-8)
// ---------------------------------------------------------------------------

/**
 * Conjunto declarativo de ORÍGENES válidos de la transición «confirmar el pago de la
 * señal» (`pre_reserva → reserva_confirmada`, US-021, skill `state-machine`, NO
 * condicionales dispersos). A diferencia de US-014 (activar pre_reserva, origen
 * multi-estado `{2a,2b,2c,2v}` de `consulta`), esta transición es MONO-estado y desde
 * un estado PRINCIPAL: SOLO `pre_reserva` (sub_estado NULL) es origen válido; su destino
 * único es `reserva_confirmada`. Cualquier sub-estado de `consulta` (`2a/2b/2c/2d/2v/
 * 2x/2y/2z`) —una consulta aún no es pre-reserva—, el propio destino `reserva_confirmada`
 * (ya confirmada) y posteriores (`evento_en_curso`/`post_evento`/`reserva_completada`) y
 * `reserva_cancelada` (inmutable) NO son orígenes legales. Una sola transición permitida:
 * `{pre_reserva, NULL} → {reserva_confirmada, NULL}`.
 */
export const ORIGENES_TRANSICION_CONFIRMAR_SENAL: ReadonlyArray<OrigenTransicion> = [
  { estado: 'pre_reserva', subEstado: null },
];

/**
 * Guarda declarativa: ¿es `(estado, subEstado)` un ORIGEN legal de la transición
 * «confirmar pago de señal» (US-021)? Consulta la tabla
 * `ORIGENES_TRANSICION_CONFIRMAR_SENAL`: solo `pre_reserva` (sub_estado NULL) lo es. Se
 * evalúa ANTES de la tx y se re-evalúa DENTRO de la tx bajo el lock de FECHA_BLOQUEADA
 * para rechazar sin efectos cualquier otro estado/sub-estado y para detectar el doble
 * clic (la segunda confirmación observa `reserva_confirmada` y aborta con 409).
 */
export const esOrigenValidoParaConfirmarSenal = (
  estado: EstadoReserva,
  subEstado: SubEstadoConsulta | null,
): boolean =>
  ORIGENES_TRANSICION_CONFIRMAR_SENAL.some(
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

// ---------------------------------------------------------------------------
// Guarda de PRECONDICIÓN «registrar firma de condiciones particulares»
// (US-024 / UC-19 segundo flujo / §D-no-transicion)
// ---------------------------------------------------------------------------

/**
 * Tabla declarativa de ESTADOS válidos para REGISTRAR la firma de las condiciones
 * particulares (US-024, skill `state-machine`, NO condicionales dispersos). A
 * diferencia de las tablas `OrigenTransicion`/`MAPA_*` (orígenes/aristas de una
 * transición origen→destino), esta es una PRECONDICIÓN sobre el estado ACTUAL del
 * agregado —análoga a `ESTADOS_BLOQUEO_BLANDO_EXTENSIBLE` de US-006—: la firma
 * ACTUALIZA campos (`cond_part_firmadas`/`cond_part_firmadas_fecha`) y NO transiciona
 * la máquina de estados (§D-no-transicion), por eso NO se añade ninguna transición al
 * grafo. Regla firme del Gate 1: válido ⇔ `estado ∈ {reserva_confirmada,
 * evento_en_curso, post_evento}` (la firma exige el E3 ya enviado, lo que ocurre a
 * partir de `reserva_confirmada`, y hasta el cierre del post-evento). NO son válidos
 * `consulta` (todos sus sub-estados) ni `pre_reserva` (previos al envío de E3), ni los
 * terminales `reserva_completada`/`reserva_cancelada` (inmutables) → 422 sin efectos.
 */
const ESTADOS_VALIDOS_REGISTRAR_FIRMA_CONDICIONES: ReadonlyArray<EstadoReserva> = [
  'reserva_confirmada',
  'evento_en_curso',
  'post_evento',
];

/**
 * Guarda declarativa de PRECONDICIÓN: ¿es `estado` un estado VÁLIDO para registrar la
 * firma de las condiciones particulares (US-024)? Consulta la tabla
 * `ESTADOS_VALIDOS_REGISTRAR_FIRMA_CONDICIONES`: `reserva_confirmada`,
 * `evento_en_curso` y `post_evento` lo son; el resto (incluidos los terminales) no. Se
 * evalúa ANTES de tocar la BD para rechazar sin efectos con 422 (`ESTADO_INVALIDO`).
 */
export const esEstadoValidoParaRegistrarFirmaCondiciones = (
  estado: EstadoReserva,
): boolean => ESTADOS_VALIDOS_REGISTRAR_FIRMA_CONDICIONES.includes(estado);

// ---------------------------------------------------------------------------
// Guarda de PRECONDICIÓN «editar/reenviar presupuesto en pre_reserva»
// (US-015 / UC-15 / design.md §D5 §D-no-transicion)
// ---------------------------------------------------------------------------

/**
 * Tabla declarativa de ESTADOS válidos para EDITAR/REENVIAR el presupuesto de una
 * RESERVA (US-015, skill `state-machine`, NO condicionales dispersos). Como
 * `ESTADOS_VALIDOS_REGISTRAR_FIRMA_CONDICIONES` (US-024) y
 * `ESTADOS_BLOQUEO_BLANDO_EXTENSIBLE` (US-006), es una PRECONDICIÓN sobre el estado
 * ACTUAL del agregado —NO una transición origen→destino—: la edición ACTUALIZA la
 * oferta económica (crea una nueva versión de PRESUPUESTO) pero la RESERVA NO
 * transiciona (permanece `pre_reserva`, `ttl_expiracion` intacto), por eso NO se
 * añade ninguna arista al grafo (design.md §D5). Regla firme del Gate (§D2/§D5):
 * válido ⇔ `estado = 'pre_reserva'` (único estado). NO son válidos `consulta` (todos
 * sus sub-estados; una consulta aún no tiene presupuesto en pre_reserva),
 * `reserva_confirmada` (señal ya confirmada, oferta cerrada) ni los posteriores/
 * terminales (`evento_en_curso`/`post_evento`/`reserva_completada`/
 * `reserva_cancelada`, inmutables) → 409 sin efectos. La SEGUNDA vertiente de la
 * precondición —que el ÚLTIMO PRESUPUESTO esté en `{borrador, enviado}` y NO en
 * `aceptado`/`rechazado`— NO es un estado de la máquina de la RESERVA: se valida
 * sobre el PRESUPUESTO en el use-case.
 */
const ESTADOS_VALIDOS_EDITAR_PRESUPUESTO: ReadonlyArray<EstadoReserva> = [
  'pre_reserva',
];

/**
 * Guarda declarativa de PRECONDICIÓN: ¿es `estado` un estado VÁLIDO para editar/
 * reenviar el presupuesto (US-015)? Consulta la tabla
 * `ESTADOS_VALIDOS_EDITAR_PRESUPUESTO`: solo `pre_reserva` lo es. Se evalúa ANTES de
 * invocar el motor de tarifa y de abrir la transacción para rechazar sin efectos con
 * 409 (`RESERVA_FUERA_DE_PRERESERVA`) cualquier otro estado.
 */
export const esEstadoValidoParaEditarPresupuesto = (
  estado: EstadoReserva,
): boolean => ESTADOS_VALIDOS_EDITAR_PRESUPUESTO.includes(estado);

// ---------------------------------------------------------------------------
// Guarda de PRECONDICIÓN «capturar documentación obligatoria del evento»
// (US-033 / UC-24 / design.md §D-no-transicion)
// ---------------------------------------------------------------------------

/**
 * Tabla declarativa de ESTADOS válidos para CAPTURAR (escribir) la documentación
 * obligatoria del evento (US-033, skill `state-machine`, NO condicionales dispersos).
 * Como `ESTADOS_VALIDOS_REGISTRAR_FIRMA_CONDICIONES` (US-024) y
 * `ESTADOS_BLOQUEO_BLANDO_EXTENSIBLE` (US-006), es una PRECONDICIÓN sobre el estado
 * ACTUAL del agregado —NO una transición origen→destino—: la subida CREA una fila
 * DOCUMENTO pero la RESERVA NO transiciona (§D-no-transicion), por eso NO se añade
 * ninguna arista al grafo. Regla ESTRICTA MONO-estado del Gate 1: válido ⇔ `estado =
 * 'evento_en_curso'` (a diferencia de US-024, multi-estado `{reserva_confirmada,
 * evento_en_curso, post_evento}`). NO son válidos `consulta` (todos sus sub-estados),
 * `pre_reserva`, `reserva_confirmada` (aún no ha empezado el evento), `post_evento`
 * (evento ya finalizado — la ESCRITURA se cierra; el checklist GET sí es consultable,
 * pero eso lo decide la query, no esta guarda) ni los terminales
 * `reserva_completada`/`reserva_cancelada` (inmutables) → 422 sin efectos.
 */
const ESTADOS_VALIDOS_DOCUMENTACION_EVENTO: ReadonlyArray<EstadoReserva> = [
  'evento_en_curso',
];

/**
 * Guarda declarativa de PRECONDICIÓN: ¿es `estado` un estado VÁLIDO para capturar
 * (escribir) la documentación obligatoria del evento (US-033)? Consulta la tabla
 * `ESTADOS_VALIDOS_DOCUMENTACION_EVENTO`: solo `evento_en_curso` lo es. Se evalúa ANTES
 * de subir al almacén y de abrir la transacción para rechazar sin efectos con 422
 * (`ESTADO_NO_PERMITE_DOCUMENTACION`) cualquier otro estado. El checklist GET es más
 * permisivo (consultable también en `post_evento`, FA-01): esa permisividad la decide la
 * query de checklist, NO esta guarda de escritura.
 */
export const esEstadoQuePermiteDocumentacionEvento = (
  estado: EstadoReserva,
): boolean => ESTADOS_VALIDOS_DOCUMENTACION_EVENTO.includes(estado);

// ---------------------------------------------------------------------------
// Transición TERMINAL por EXPIRACIÓN de TTL (US-012 / UC-09 / §D-3)
// ---------------------------------------------------------------------------

/**
 * Destino terminal resuelto de una expiración por TTL: el `(estado, subEstado)` al
 * que transiciona una RESERVA candidata cuando su `ttl_expiracion` vence. Es el
 * resultado puro de `resolverExpiracionTtl`; `null` (no representado aquí) indica
 * que el origen NO es candidato (guarda de origen), de modo que no se expira.
 */
export interface ResultadoExpiracionTtl {
  estado: EstadoReserva;
  subEstado: SubEstadoConsulta | null;
}

/**
 * Entrada de la tabla declarativa de expiración por TTL: `origen` candidato →
 * `destino` terminal. Modela la transición como ESTRUCTURA DE DATOS (skill
 * `state-machine`, NO condicionales dispersos).
 */
interface TransicionExpiracionTtl {
  origen: { estado: EstadoReserva; subEstado: SubEstadoConsulta | null };
  destino: ResultadoExpiracionTtl;
}

/**
 * Tabla declarativa `MAPA_EXPIRACION_TTL` (US-012, §D-3): mapea cada origen CANDIDATO
 * a su destino terminal por expiración de TTL. Es la ÚNICA fuente de verdad de qué
 * expira y a dónde (no `if` dispersos):
 *   { consulta, 2b } → { consulta, 2x }
 *   { consulta, 2c } → { consulta, 2x }
 *   { consulta, 2v } → { consulta, 2x }
 *   { pre_reserva, null } → { reserva_cancelada, null }
 *
 * El destino de expiración por TTL es SIEMPRE `2x` para las consultas con fecha
 * (`2b/2c/2v`) — NUNCA `2y` (descarte por cola, US-007) ni `2z` (descarte por
 * cliente, US-013) — y `reserva_cancelada` (sub_estado NULL) para `pre_reserva`
 * (A5). Cualquier origen ausente de esta tabla —terminales `2x/2y/2z/
 * reserva_cancelada/reserva_completada`, no-candidatos `2a`/`2d`, y el resto de
 * estados activos— NO es candidato: `resolverExpiracionTtl` devuelve `null` y la
 * RESERVA no se expira aunque su TTL esté vencido.
 */
export const MAPA_EXPIRACION_TTL: ReadonlyArray<TransicionExpiracionTtl> = [
  {
    origen: { estado: 'consulta', subEstado: '2b' },
    destino: { estado: 'consulta', subEstado: '2x' },
  },
  {
    origen: { estado: 'consulta', subEstado: '2c' },
    destino: { estado: 'consulta', subEstado: '2x' },
  },
  {
    origen: { estado: 'consulta', subEstado: '2v' },
    destino: { estado: 'consulta', subEstado: '2x' },
  },
  {
    origen: { estado: 'pre_reserva', subEstado: null },
    destino: { estado: 'reserva_cancelada', subEstado: null },
  },
];

/**
 * Guarda + resolución declarativa de la expiración por TTL (US-012, §D-3): función
 * PURA que consulta `MAPA_EXPIRACION_TTL` y devuelve el destino terminal del origen
 * `(estado, subEstado)`, o `null` si NO es un origen candidato (los terminales y
 * cualquier otro estado activo se excluyen devolviendo `null`, quedando inmutables
 * aunque su TTL esté vencido). Al ser pura y re-evaluable, se invoca DENTRO de la
 * transacción de cada RESERVA (base de la idempotencia y de RC-1).
 */
export const resolverExpiracionTtl = (
  estado: EstadoReserva,
  subEstado: SubEstadoConsulta | null,
): ResultadoExpiracionTtl | null => {
  const transicion = MAPA_EXPIRACION_TTL.find(
    (t) => t.origen.estado === estado && t.origen.subEstado === subEstado,
  );
  return transicion ? transicion.destino : null;
};

// ---------------------------------------------------------------------------
// Transición de PROMOCIÓN de cola (US-018 / UC-12 / §D-2)
// ---------------------------------------------------------------------------

/**
 * Destino resuelto de una promoción de cola: el `(estado, subEstado)` al que
 * transiciona la RESERVA que estaba primera en cola (`posicion_cola = 1`) cuando la
 * fecha se libera. Es el resultado puro de `resolverPromocionCola`; `null` (no
 * representado aquí) indica que el origen NO es promovible (guarda de origen).
 */
export interface ResultadoPromocionCola {
  estado: EstadoReserva;
  subEstado: SubEstadoConsulta;
}

/**
 * Entrada de la tabla declarativa de promoción de cola: `origen` candidato →
 * `destino` promovido. Modela la transición como ESTRUCTURA DE DATOS (skill
 * `state-machine`, NO condicionales dispersos).
 */
interface TransicionPromocionCola {
  origen: { estado: EstadoReserva; subEstado: SubEstadoConsulta | null };
  destino: ResultadoPromocionCola;
}

/**
 * Tabla declarativa `MAPA_PROMOCION_COLA` (US-018, §D-2): mapea el ÚNICO origen
 * promovible de la promoción automática de cola a su destino. Es la única fuente de
 * verdad de qué se promueve y a dónde (no `if` dispersos):
 *   { consulta, 2d } → { consulta, 2b }
 *
 * Solo el primero en cola (`2.d`) es promovible a la consulta con fecha bloqueada
 * (`2.b`). Cualquier otro origen —el resto de sub-estados de consulta (`2a/2b/2c/2v`),
 * los terminales (`2x/2y/2z`), y cualquier estado principal distinto de `consulta`—
 * NO es promovible: `resolverPromocionCola` devuelve `null`. Mismo patrón que
 * `MAPA_EXPIRACION_TTL` (US-012 §D-3).
 */
export const MAPA_PROMOCION_COLA: ReadonlyArray<TransicionPromocionCola> = [
  {
    origen: { estado: 'consulta', subEstado: '2d' },
    destino: { estado: 'consulta', subEstado: '2b' },
  },
];

/**
 * Guarda + resolución declarativa de la promoción de cola (US-018, §D-2): función
 * PURA que consulta `MAPA_PROMOCION_COLA` y devuelve el destino promovido del origen
 * `(estado, subEstado)`, o `null` si NO es un origen promovible (guarda de origen
 * ESTRICTA: solo `consulta/2d`). Al ser pura y re-evaluable, se invoca DENTRO de la
 * transacción de la promoción (base de la idempotencia y de RC-1).
 */
export const resolverPromocionCola = (
  estado: EstadoReserva,
  subEstado: SubEstadoConsulta | null,
): ResultadoPromocionCola | null => {
  const transicion = MAPA_PROMOCION_COLA.find(
    (t) => t.origen.estado === estado && t.origen.subEstado === subEstado,
  );
  return transicion ? transicion.destino : null;
};

// ---------------------------------------------------------------------------
// Transición de EXPIRACIÓN FORZOSA de la bloqueante viva (US-019 / UC-12 FA manual)
// ---------------------------------------------------------------------------

/**
 * Destino resuelto de la expiración FORZOSA de la bloqueante viva por la promoción
 * MANUAL del Gestor (US-019): el `(estado, subEstado)` terminal al que transiciona la
 * RESERVA que bloqueaba actualmente la fecha cuando el Gestor promueve otra consulta de
 * la cola. Es el resultado puro de `resolverExpiracionForzosaBloqueante`; `null` (no
 * representado aquí) indica que el origen NO es una bloqueante viva (guarda de origen).
 */
export interface ResultadoExpiracionForzosa {
  estado: EstadoReserva;
  subEstado: SubEstadoConsulta;
}

/**
 * Entrada de la tabla declarativa de expiración forzosa: `origen` (bloqueante viva) →
 * `destino` terminal. Modela la transición como ESTRUCTURA DE DATOS (skill
 * `state-machine`, NO condicionales dispersos).
 */
interface TransicionExpiracionForzosa {
  origen: { estado: EstadoReserva; subEstado: SubEstadoConsulta | null };
  destino: ResultadoExpiracionForzosa;
}

/**
 * Tabla declarativa `MAPA_EXPIRACION_FORZOSA_BLOQUEANTE` (US-019, §D-2): mapea cada
 * origen de BLOQUEANTE VIVA a su destino terminal `2.x` por la expiración forzosa
 * deliberada del Gestor durante la promoción manual. Es la ÚNICA fuente de verdad de
 * qué bloqueante se expira y a dónde (no `if` dispersos):
 *   { consulta, 2b } → { consulta, 2x }
 *   { consulta, 2c } → { consulta, 2x }
 *   { consulta, 2v } → { consulta, 2x }
 *
 * Reutiliza la semántica terminal `2.x` de US-012 (consulta expirada) pero aplicada
 * DELIBERADAMENTE por el Gestor (acción destructiva). DIFERENCIA CLAVE con
 * `MAPA_EXPIRACION_TTL` (US-012): la expiración forzosa NO aplica a `pre_reserva` —una
 * bloqueante de cola SIEMPRE es una consulta con fecha `2b/2c/2v`, nunca una pre-reserva
 * (cuyo destino de expiración TTL sería `reserva_cancelada`, que NO es una bloqueante de
 * cola promovible). Cualquier origen ausente de esta tabla —la cola `2d`, la
 * exploratoria `2a`, los terminales `2x/2y/2z`, y todo estado principal distinto de
 * `consulta`— NO es una bloqueante viva: `resolverExpiracionForzosaBloqueante` devuelve
 * `null` y no hay nada que expirar.
 */
export const MAPA_EXPIRACION_FORZOSA_BLOQUEANTE: ReadonlyArray<TransicionExpiracionForzosa> =
  [
    {
      origen: { estado: 'consulta', subEstado: '2b' },
      destino: { estado: 'consulta', subEstado: '2x' },
    },
    {
      origen: { estado: 'consulta', subEstado: '2c' },
      destino: { estado: 'consulta', subEstado: '2x' },
    },
    {
      origen: { estado: 'consulta', subEstado: '2v' },
      destino: { estado: 'consulta', subEstado: '2x' },
    },
  ];

/**
 * Guarda + resolución declarativa de la expiración forzosa de la bloqueante viva
 * (US-019, §D-2): función PURA que consulta `MAPA_EXPIRACION_FORZOSA_BLOQUEANTE` y
 * devuelve el destino terminal (`2.x`) del origen `(estado, subEstado)`, o `null` si NO
 * es una bloqueante viva (guarda de origen ESTRICTA: solo `consulta/{2b,2c,2v}`). Admite
 * la bloqueante con TTL vigente O ya vencido pero no barrido (la vigencia del TTL se
 * decide fuera; aquí solo se resuelve el sub-estado de origen). Al ser pura y
 * re-evaluable, se invoca DENTRO de la transacción bajo el lock (base de RC-A/RC-B).
 */
export const resolverExpiracionForzosaBloqueante = (
  estado: EstadoReserva,
  subEstado: SubEstadoConsulta | null,
): ResultadoExpiracionForzosa | null => {
  const transicion = MAPA_EXPIRACION_FORZOSA_BLOQUEANTE.find(
    (t) => t.origen.estado === estado && t.origen.subEstado === subEstado,
  );
  return transicion ? transicion.destino : null;
};

// ---------------------------------------------------------------------------
// Transición de INICIO AUTOMÁTICO de EVENTO en T-0 (US-031 / UC-23 / §D-3)
// ---------------------------------------------------------------------------

/**
 * Destino resuelto del inicio automático de evento: el `(estado, subEstado)` al que
 * transiciona una RESERVA candidata (`reserva_confirmada`) el día del evento (T-0)
 * cuando cumple las tres precondiciones. Es el resultado puro de `resolverInicioEvento`;
 * `null` (no representado aquí) indica que el origen NO es candidato (guarda de origen).
 */
export interface ResultadoInicioEvento {
  estado: EstadoReserva;
  subEstado: SubEstadoConsulta | null;
}

/**
 * Entrada de la tabla declarativa de inicio de evento: `origen` candidato → `destino`.
 * Modela la transición como ESTRUCTURA DE DATOS (skill `state-machine`, NO condicionales
 * dispersos), en paralelo estricto a `MAPA_EXPIRACION_TTL`/`MAPA_PROMOCION_COLA`.
 */
interface TransicionInicioEvento {
  origen: { estado: EstadoReserva; subEstado: SubEstadoConsulta | null };
  destino: ResultadoInicioEvento;
}

/**
 * Tabla declarativa `MAPA_INICIO_EVENTO` (US-031, §D-3): mapea el ÚNICO origen candidato
 * del inicio automático de evento a su destino. Es la única fuente de verdad de qué se
 * inicia y a dónde (no `if` dispersos):
 *   { reserva_confirmada, null } → { evento_en_curso, null }
 *
 * Guarda de ORIGEN ESTRICTA: solo `reserva_confirmada` con sub_estado NULL es candidato.
 * Cualquier otro estado principal (`consulta`/`pre_reserva`/`evento_en_curso`/`post_evento`/
 * `reserva_completada`/`reserva_cancelada`), los sub-estados de consulta y hasta un
 * `reserva_confirmada` con un sub-estado espurio (dato inconsistente) NO son candidatos:
 * `resolverInicioEvento` devuelve `null`. Las TRES precondiciones se evalúan aparte
 * (`preconditionesEventoCumplidas`). Al ser pura y re-evaluable, la guarda se invoca DENTRO
 * de la transacción de cada RESERVA (base de la idempotencia y de RC-1/RC-2).
 */
export const MAPA_INICIO_EVENTO: ReadonlyArray<TransicionInicioEvento> = [
  {
    origen: { estado: 'reserva_confirmada', subEstado: null },
    destino: { estado: 'evento_en_curso', subEstado: null },
  },
];

/**
 * Guarda + resolución declarativa del inicio automático de evento (US-031, §D-3): función
 * PURA que consulta `MAPA_INICIO_EVENTO` y devuelve el destino (`evento_en_curso`) del
 * origen `(estado, subEstado)`, o `null` si NO es un origen candidato. Es la guarda de
 * ORIGEN; se re-evalúa bajo el `SELECT … FOR UPDATE` de la fila RESERVA para garantizar
 * idempotencia y la coordinación cron↔gestor (US-032) sin locks distribuidos.
 */
export const resolverInicioEvento = (
  estado: EstadoReserva,
  subEstado: SubEstadoConsulta | null,
): ResultadoInicioEvento | null => {
  const transicion = MAPA_INICIO_EVENTO.find(
    (t) => t.origen.estado === estado && t.origen.subEstado === subEstado,
  );
  return transicion ? transicion.destino : null;
};

// ---------------------------------------------------------------------------
// Guarda PURA de las TRES PRECONDICIONES del inicio de evento (US-031 / §D-3)
// ---------------------------------------------------------------------------

/** Estado del cierre de la ficha pre-evento (valor de dominio; espejo del enum Prisma). */
export type PreEventoStatusDominio = 'pendiente' | 'en_curso' | 'cerrado';

/** Estado de cobro de la liquidación (valor de dominio; espejo del enum Prisma). */
export type LiquidacionStatusDominio = 'pendiente' | 'facturada' | 'cobrada';

/** Estado de cobro de la fianza (valor de dominio; espejo del enum Prisma). */
export type FianzaStatusDominio =
  | 'pendiente'
  | 'recibo_enviado'
  | 'cobrada'
  | 'devuelta'
  | 'retenida_parcial';

/**
 * Lectura ÚNICA de los tres `*_status` de una RESERVA candidata (D-3): la guarda las
 * evalúa juntas en una sola llamada, tal como se leen de la fila bajo el lock.
 */
export interface PrecondicionesEvento {
  preEventoStatus: PreEventoStatusDominio;
  liquidacionStatus: LiquidacionStatusDominio;
  fianzaStatus: FianzaStatusDominio;
}

/**
 * Resultado de la guarda de precondiciones: `cumple = true` solo con las tres a su valor
 * requerido; en los casos negativos, `faltantes` enumera —por su nombre de dominio— las
 * precondiciones incumplidas, para alimentar la alerta crítica al gestor (D-8) sin lógica
 * dispersa.
 */
export interface ResultadoPrecondicionesEvento {
  cumple: boolean;
  faltantes: string[];
}

/**
 * Tabla declarativa de las tres precondiciones del inicio de evento (US-031, §D-3): cada
 * entrada nombra la precondición (para la alerta) y su valor requerido. Una sola fuente de
 * verdad del AND estricto `pre_evento_status = 'cerrado'` AND `liquidacion_status =
 * 'cobrada'` AND `fianza_status = 'cobrada'` (no `if` dispersos).
 */
const PRECONDICIONES_INICIO_EVENTO: ReadonlyArray<{
  nombre: string;
  cumplida: (p: PrecondicionesEvento) => boolean;
}> = [
  { nombre: 'pre_evento_status', cumplida: (p) => p.preEventoStatus === 'cerrado' },
  { nombre: 'liquidacion_status', cumplida: (p) => p.liquidacionStatus === 'cobrada' },
  { nombre: 'fianza_status', cumplida: (p) => p.fianzaStatus === 'cobrada' },
];

/**
 * Guarda PURA de las tres precondiciones (US-031, §D-3): evalúa `pre_evento_status =
 * 'cerrado'` AND `liquidacion_status = 'cobrada'` AND `fianza_status = 'cobrada'` en una
 * única lectura de la fila y devuelve `{ cumple, faltantes }`. `cumple = true` solo si las
 * tres se satisfacen; si no, `faltantes` enumera todas las incumplidas (para la alerta
 * crítica). Función determinista y sin efectos; se invoca bajo el lock junto a la guarda
 * de origen (`resolverInicioEvento`).
 */
export const preconditionesEventoCumplidas = (
  precondiciones: PrecondicionesEvento,
): ResultadoPrecondicionesEvento => {
  const faltantes = PRECONDICIONES_INICIO_EVENTO.filter(
    (p) => !p.cumplida(precondiciones),
  ).map((p) => p.nombre);
  return { cumple: faltantes.length === 0, faltantes };
};

// ---------------------------------------------------------------------------
// Guarda PURA de FECHA del FORZADO MANUAL del inicio de evento (US-032 / §D-2)
// ---------------------------------------------------------------------------

/**
 * Guarda de PRECONDICIÓN pura del FORZADO MANUAL del inicio de evento (US-032, §D-2):
 * ¿coincide `fechaEvento` con `hoy` por FECHA DE CALENDARIO (año-mes-día), NO por
 * instante? El forzado por el Gestor solo está disponible el DÍA del evento
 * (`date(fecha_evento) = date(hoy)`); fuera de él el use-case rechaza con 422
 * (`fecha_evento_no_es_hoy`).
 *
 * Es una guarda de precondición sobre el estado actual del agregado (como
 * `esEstadoValidoParaEditarPresupuesto`), NO una arista de la máquina de estados: no se
 * añade tabla ni transición. Compara por año-mes-día para blindar el off-by-one horario:
 * un evento de hoy a las 23:59 (o a las 00:00) sigue siendo "hoy"; el cambio de día de
 * calendario (ayer/mañana) da `false` con independencia de la hora. Función determinista y
 * sin efectos; el `hoy` lo calcula UNA vez el use-case y se pasa como argumento.
 */
export const esDiaDelEvento = (fechaEvento: Date, hoy: Date): boolean =>
  fechaEvento.getFullYear() === hoy.getFullYear() &&
  fechaEvento.getMonth() === hoy.getMonth() &&
  fechaEvento.getDate() === hoy.getDate();

// ---------------------------------------------------------------------------
// Transición de FINALIZACIÓN MANUAL de EVENTO (US-034 / UC-25 / §D-2/§D-9)
// ---------------------------------------------------------------------------

/**
 * Destino resuelto de la finalización manual del evento: el `(estado, subEstado)` al que
 * transiciona una RESERVA en ejecución (`evento_en_curso`) cuando el Gestor la marca como
 * finalizada. Es el resultado puro de `resolverFinalizacionEvento`; `null` (no representado
 * aquí) indica que el origen NO es candidato (guarda de origen: conflicto de estado).
 */
export interface ResultadoFinalizacionEvento {
  estado: EstadoReserva;
  subEstado: SubEstadoConsulta | null;
}

/**
 * Entrada de la tabla declarativa de finalización de evento: `origen` candidato →
 * `destino`. Modela la transición como ESTRUCTURA DE DATOS (skill `state-machine`, NO
 * condicionales dispersos), en paralelo estricto a `MAPA_INICIO_EVENTO` (US-031).
 */
interface TransicionFinalizacionEvento {
  origen: { estado: EstadoReserva; subEstado: SubEstadoConsulta | null };
  destino: ResultadoFinalizacionEvento;
}

/**
 * Tabla declarativa `MAPA_FINALIZACION_EVENTO` (US-034, §D-2): mapea el ÚNICO origen
 * candidato de la finalización manual del evento a su destino. Es la única fuente de
 * verdad de qué se finaliza y a dónde (no `if` dispersos):
 *   { evento_en_curso, null } → { post_evento, null }
 *
 * Guarda de ORIGEN ESTRICTA: solo `evento_en_curso` con sub_estado NULL es candidato.
 * IRREVERSIBILIDAD (spec-delta `consultas`): NO existe arista de retorno `post_evento →
 * evento_en_curso` en la tabla — `post_evento` (segunda finalización), `reserva_confirmada`
 * (estado previo), el resto de estados principales, los sub-estados de consulta y hasta un
 * `evento_en_curso` con sub-estado espurio (dato inconsistente) NO son candidatos:
 * `resolverFinalizacionEvento` devuelve `null` (conflicto de estado → 409). La transición
 * es INCONDICIONAL respecto a la fianza y al email (el disparo de E5 lo decide aparte
 * `debeEnviarseE5`). Al ser pura y re-evaluable, la guarda se invoca DENTRO de la
 * transacción bajo el `SELECT … FOR UPDATE` de la fila RESERVA (base de la idempotencia y
 * de la concurrencia de doble finalización, D-8) — sin locks distribuidos.
 */
export const MAPA_FINALIZACION_EVENTO: ReadonlyArray<TransicionFinalizacionEvento> = [
  {
    origen: { estado: 'evento_en_curso', subEstado: null },
    destino: { estado: 'post_evento', subEstado: null },
  },
];

/**
 * Guarda + resolución declarativa de la finalización manual del evento (US-034, §D-2):
 * función PURA que consulta `MAPA_FINALIZACION_EVENTO` y devuelve el destino
 * (`post_evento`) del origen `(estado, subEstado)`, o `null` si NO es un origen candidato
 * (conflicto de estado). Es la guarda de ORIGEN; se re-evalúa bajo el `SELECT … FOR UPDATE`
 * de la fila RESERVA para garantizar la idempotencia y que la doble finalización
 * concurrente termine con exactamente una transición ganadora (D-8).
 */
export const resolverFinalizacionEvento = (
  estado: EstadoReserva,
  subEstado: SubEstadoConsulta | null,
): ResultadoFinalizacionEvento | null => {
  const transicion = MAPA_FINALIZACION_EVENTO.find(
    (t) => t.origen.estado === estado && t.origen.subEstado === subEstado,
  );
  return transicion ? transicion.destino : null;
};

// ---------------------------------------------------------------------------
// Guarda PURA de la fianza para el disparo de E5 (US-034 / §D-4)
// ---------------------------------------------------------------------------

/**
 * Guarda PURA de la fianza (US-034, §D-4): ¿corresponde disparar el email E5 (solicitud de
 * IBAN) al finalizar el evento? `true` SOLO si `fianzaEur != null && fianzaEur > 0`. `NULL`
 * y `0` colapsan a `false` (sin E5); un negativo (defensivo) también es `false`.
 *
 * Es la ÚNICA fuente de verdad de la condición del envío: la transición a `post_evento` es
 * incondicional, pero E5 está condicionado a esta guarda. `fianza_eur` MANDA sobre
 * `fianza_status` (nunca se envía IBAN sin importe): si `fianza_status='cobrada'` pero
 * `fianza_eur IS NULL` (dato anómalo), esta guarda devuelve `false` y la inconsistencia se
 * audita aparte. Función determinista y sin efectos (dominio puro).
 */
export const debeEnviarseE5 = (fianzaEur: number | null): boolean =>
  fianzaEur !== null && fianzaEur > 0;

// ---------------------------------------------------------------------------
// Transición de ARCHIVADO AUTOMÁTICO en T+7d (US-037 / UC-28 / §D-6)
// ---------------------------------------------------------------------------

/**
 * Destino resuelto del archivado automático: el `(estado, subEstado)` al que transiciona
 * una RESERVA en `post_evento` (sub_estado NULL) cuando el barrido la archiva en T+7d con
 * la fianza resuelta. Es el resultado puro de `resolverArchivadoAutomatico`; `null` (no
 * representado aquí) indica que el origen NO es candidato (guarda de origen).
 */
export interface ResultadoArchivadoAutomatico {
  estado: EstadoReserva;
  subEstado: SubEstadoConsulta | null;
}

/**
 * Entrada de la tabla declarativa del archivado automático: `origen` candidato →
 * `destino`. Modela la transición como ESTRUCTURA DE DATOS (skill `state-machine`, NO
 * condicionales dispersos), en paralelo estricto a `MAPA_FINALIZACION_EVENTO` (US-034) y
 * `MAPA_INICIO_EVENTO` (US-031).
 */
interface TransicionArchivadoAutomatico {
  origen: { estado: EstadoReserva; subEstado: SubEstadoConsulta | null };
  destino: ResultadoArchivadoAutomatico;
}

/**
 * Tabla declarativa `MAPA_ARCHIVADO_AUTOMATICO` (US-037, §D-6): mapea el ÚNICO origen
 * candidato del archivado automático a su destino. Es la única fuente de verdad de qué se
 * archiva y a dónde (no `if` dispersos):
 *   { post_evento, null } → { reserva_completada, null }
 *
 * Guarda de ORIGEN ESTRICTA: solo `post_evento` con sub_estado NULL es candidato.
 * TERMINALIDAD: `reserva_completada` es TERMINAL e INMUTABLE — NO existe NINGUNA arista de
 * salida en la tabla (nunca aparece como `origen`), de modo que resolver desde
 * `reserva_completada` devuelve `null` (base de la idempotencia bajo el lock: un segundo
 * pase la ve ya `reserva_completada` y no muta). Cualquier otro estado principal
 * (`consulta`/`pre_reserva`/`reserva_confirmada`/`evento_en_curso`/`reserva_cancelada`),
 * los sub-estados de consulta y hasta un `post_evento` con un sub-estado espurio (dato
 * inconsistente) NO son candidatos: `resolverArchivadoAutomatico` devuelve `null`. La
 * guarda de fianza se evalúa aparte (`fianzaResuelta`). Al ser pura y re-evaluable, la
 * guarda se invoca DENTRO de la transacción de cada RESERVA (base de la idempotencia y de
 * la concurrencia cron↔US-038, RC-1/RC-2).
 */
export const MAPA_ARCHIVADO_AUTOMATICO: ReadonlyArray<TransicionArchivadoAutomatico> = [
  {
    origen: { estado: 'post_evento', subEstado: null },
    destino: { estado: 'reserva_completada', subEstado: null },
  },
];

/**
 * Guarda + resolución declarativa del archivado automático (US-037, §D-6): función PURA
 * que consulta `MAPA_ARCHIVADO_AUTOMATICO` y devuelve el destino (`reserva_completada`) del
 * origen `(estado, subEstado)`, o `null` si NO es un origen candidato (terminal / conflicto
 * de estado). Es la guarda de ORIGEN; se re-evalúa bajo el `SELECT … FOR UPDATE` de la fila
 * RESERVA para garantizar la idempotencia y que la concurrencia cron↔gestor (US-038)
 * termine con exactamente una transición ganadora (D-7) — sin locks distribuidos.
 */
export const resolverArchivadoAutomatico = (
  estado: EstadoReserva,
  subEstado: SubEstadoConsulta | null,
): ResultadoArchivadoAutomatico | null => {
  const transicion = MAPA_ARCHIVADO_AUTOMATICO.find(
    (t) => t.origen.estado === estado && t.origen.subEstado === subEstado,
  );
  return transicion ? transicion.destino : null;
};

// ---------------------------------------------------------------------------
// Transición de DESCARTE POR CLIENTE → 2.z (US-013 / UC-10 / A17 / §D-1/§D-4)
// ---------------------------------------------------------------------------

/**
 * Destino resuelto de un descarte por cliente: el `(estado, subEstado)` terminal al que
 * transiciona una RESERVA de consulta activa cuando el Gestor la marca como descartada por
 * el cliente. Es el resultado puro de `resolverDescarteCliente`; `null` (no representado
 * aquí) indica que el origen NO es un sub_estado no terminal de consulta (guarda de origen).
 */
export interface ResultadoDescarteCliente {
  estado: EstadoReserva;
  subEstado: SubEstadoConsulta;
}

/**
 * Entrada de la tabla declarativa de descarte por cliente: `origen` (consulta no terminal) →
 * `destino` terminal `2.z`. Modela la transición como ESTRUCTURA DE DATOS (skill
 * `state-machine`, NO condicionales dispersos), en paralelo estricto a `MAPA_EXPIRACION_TTL`
 * (US-012) y `MAPA_PROMOCION_COLA` (US-018).
 */
interface TransicionDescarteCliente {
  origen: { estado: EstadoReserva; subEstado: SubEstadoConsulta | null };
  destino: ResultadoDescarteCliente;
}

/**
 * Tabla declarativa `MAPA_DESCARTE_CLIENTE` (US-013, §D-1): mapea cada sub_estado NO TERMINAL
 * de la fase `consulta` a su destino terminal `2.z` por el descarte manual del Gestor en
 * nombre del cliente (A17). Es la ÚNICA fuente de verdad de qué se descarta y a dónde (no `if`
 * dispersos):
 *   { consulta, 2a } → { consulta, 2z }
 *   { consulta, 2b } → { consulta, 2z }
 *   { consulta, 2c } → { consulta, 2z }
 *   { consulta, 2d } → { consulta, 2z }
 *   { consulta, 2v } → { consulta, 2z }
 *
 * El destino del descarte por CLIENTE es SIEMPRE `2.z` (§D-4) — NUNCA `2.x` (expiración por
 * TTL, US-012) ni `2.y` (vaciado de cola al activar pre-reserva, US-014): `2.z` es un terminal
 * SEMÁNTICAMENTE DISTINTO. Cualquier origen ausente de esta tabla —los terminales
 * `2x/2y/2z`, la consulta sin sub_estado (defensivo), y todo estado principal distinto de
 * `consulta` (incluidos `reserva_cancelada`/`reserva_completada`, inmutables)— NO es un origen
 * válido: `resolverDescarteCliente` devuelve `null` y el descarte se rechaza sin efectos
 * (guarda de origen). Al ser pura y re-evaluable, la guarda se invoca DENTRO de la transacción
 * bajo el `SELECT … FOR UPDATE` (base de RC-1/RC-3) — sin locks distribuidos.
 */
export const MAPA_DESCARTE_CLIENTE: ReadonlyArray<TransicionDescarteCliente> = [
  {
    origen: { estado: 'consulta', subEstado: '2a' },
    destino: { estado: 'consulta', subEstado: '2z' },
  },
  {
    origen: { estado: 'consulta', subEstado: '2b' },
    destino: { estado: 'consulta', subEstado: '2z' },
  },
  {
    origen: { estado: 'consulta', subEstado: '2c' },
    destino: { estado: 'consulta', subEstado: '2z' },
  },
  {
    origen: { estado: 'consulta', subEstado: '2d' },
    destino: { estado: 'consulta', subEstado: '2z' },
  },
  {
    origen: { estado: 'consulta', subEstado: '2v' },
    destino: { estado: 'consulta', subEstado: '2z' },
  },
];

/**
 * Guarda + resolución declarativa del descarte por cliente (US-013, §D-1/§D-4): función PURA
 * que consulta `MAPA_DESCARTE_CLIENTE` y devuelve el destino terminal (`2.z`) del origen
 * `(estado, subEstado)`, o `null` si NO es un sub_estado no terminal de consulta (guarda de
 * origen: terminales y no-orígenes → `null`, se rechaza sin efectos). Al ser pura y
 * re-evaluable, se invoca DENTRO de la transacción bajo el lock (base de RC-1/RC-3).
 */
export const resolverDescarteCliente = (
  estado: EstadoReserva,
  subEstado: SubEstadoConsulta | null,
): ResultadoDescarteCliente | null => {
  const transicion = MAPA_DESCARTE_CLIENTE.find(
    (t) => t.origen.estado === estado && t.origen.subEstado === subEstado,
  );
  return transicion ? transicion.destino : null;
};

// ---------------------------------------------------------------------------
// Guarda PURA de la FIANZA RESUELTA del archivado automático (US-037 / §D-6)
// ---------------------------------------------------------------------------

/** Entrada de la guarda de fianza: el `fianza_status` y el importe de la RESERVA. */
export interface EntradaFianzaResuelta {
  fianzaStatus: FianzaStatusDominio;
  fianzaEur: number | null;
}

/**
 * Resultado de la guarda de fianza (US-037, §D-6): `resuelta = true` habilita el archivado;
 * `pendiente = !resuelta` alimenta la alerta interna de FA-01 (fianza_pendiente_t7d) sin
 * lógica dispersa. Ambos campos son complementarios por construcción.
 */
export interface ResultadoFianzaResuelta {
  resuelta: boolean;
  pendiente: boolean;
}

/**
 * Guarda PURA de la fianza resuelta (US-037, §D-6): la fianza está RESUELTA si
 * `fianzaStatus ∈ {devuelta, retenida_parcial}` O `fianzaEur <= 0` O `fianzaEur == null`.
 * La AUSENCIA de fianza (`fianzaEur <= 0` o `null`) satisface la guarda con INDEPENDENCIA
 * del `fianzaStatus` (no se evalúa). `retenida_parcial` (incluida la retención del 100 %
 * con `fianza_devuelta_eur = 0`) es un estado resuelto: la guarda NO mira el importe
 * devuelto. Un `fianzaEur` negativo (dato anómalo) colapsa a "sin fianza" → resuelta.
 * Cuando la fianza NO está resuelta (`{cobrada, pendiente, recibo_enviado}` con
 * `fianzaEur > 0`), devuelve `pendiente = true` para disparar FA-01. Función determinista
 * y sin efectos (dominio puro).
 */
export const fianzaResuelta = (
  entrada: EntradaFianzaResuelta,
): ResultadoFianzaResuelta => {
  const sinFianza = entrada.fianzaEur === null || entrada.fianzaEur <= 0;
  const statusResolutivo =
    entrada.fianzaStatus === 'devuelta' || entrada.fianzaStatus === 'retenida_parcial';
  const resuelta = sinFianza || statusResolutivo;
  return { resuelta, pendiente: !resuelta };
};
