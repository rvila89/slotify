# Spec-delta: cambiar-fecha-consulta-en-cola (capability `consultas`)

## MODIFIED Requirements

### Requirement: Cambio atómico de una fecha ya bloqueada

El sistema SHALL (DEBE), cuando el gestor cambia la **fecha del evento** de una RESERVA que
YA tiene una fecha bloqueada (sub-estados `2b`/`2c`/`2v`) **o** de una RESERVA en **cola de
espera** (sub-estado `2d`), ejecutar una **única transacción atómica** bajo el contexto RLS
del `tenant_id` del JWT, con `SELECT … FOR UPDATE` sobre la RESERVA y sobre
`FECHA_BLOQUEADA(tenant_id, fecha_nueva)`, respetando `UNIQUE(tenant_id, fecha)`.

**Orígenes.** El cambio de fecha es válido desde `2b`/`2c`/`2v` (guarda declarativa
`esOrigenValidoParaCambiarFecha` sobre `ORIGENES_CAMBIAR_FECHA_BLOQUEADA`) **y** desde `2d`
(guarda declarativa **separada** `esOrigenCambiarFechaEnCola` sobre
`ORIGENES_CAMBIAR_FECHA_EN_COLA = [{ estado: 'consulta', subEstado: '2d' }]`). Ambas guardas
se modelan como estructura de datos, NO como condicionales dispersos, y se re-evalúan **bajo
el lock** antes de mutar. Cualquier otro `(estado, sub_estado)` se rechaza **sin efectos**
con **422**.

**Rama `2b`/`2c`/`2v` (la RESERVA posee bloqueo propio).** Si la fecha nueva está libre, el
sistema DEBE bloquearla (`bloquearFecha`), actualizar `RESERVA.fecha_evento`, liberar la
fecha antigua (`liberarFecha`) conservando el sub-estado, y, si la fecha antigua tenía cola
de espera, disparar la **promoción FIFO** del primero en cola (mecánica A15). Si la fecha
nueva NO puede bloquearse (ocupada por otra RESERVA), el sistema DEBE rechazar el cambio con
conflicto **sin** tocar la RESERVA ni la fecha antigua (rollback total).

**Rama `2d` (la RESERVA NO posee bloqueo propio).** A diferencia de la rama anterior, una
RESERVA en `2d` **no tiene fila `FECHA_BLOQUEADA`** (está en cola, no bloquea nada). Si la
fecha nueva `F2` está **libre**, el sistema DEBE, en la misma transacción: (1) **INSERTAR un
bloqueo nuevo** de `F2` mediante la primitiva atómica existente (`bloquearEnTx` /
`resolverPlanBloqueo` fase `2.b`, bloqueo **blando con TTL**), fijando `ttl_expiracion`;
(2) actualizar `RESERVA.fecha_evento = F2`; (3) **cambiar `sub_estado` de `2d` a `2b`**;
(4) **sacar la RESERVA de la cola** con `posicion_cola → NULL` y `consulta_bloqueante_id →
NULL`, y **reordenar la cola vieja** decrementando en 1 la `posicion_cola` de los hermanos
con el mismo `consulta_bloqueante_id` y `posicion_cola > P` (mecánica idéntica al requirement
*"Salida de cola con reordenación al descartar desde 2.d"*, US-013), preservando
`UNIQUE(tenant_id, consulta_bloqueante_id, posicion_cola) WHERE posicion_cola IS NOT NULL` y
dejando las posiciones contiguas empezando en 1; (5) crear una `COMUNICACION` **E1** en
estado **`borrador`** (`fecha_envio = NULL`, **no autoenviada**) reutilizando
`plantilla-transicion-fecha.ts` rama `'disponible'`. El sistema **NO DEBE promover** ninguna
cola (la RESERVA en `2d` no libera bloqueo alguno) y **NO DEBE modificar** la RESERVA
bloqueante de su fecha antigua ni su `FECHA_BLOQUEADA`. Si la fecha nueva `F2` está
**ocupada** por otra RESERVA, el sistema DEBE rechazar el cambio con conflicto **terminal**
(**409**) **sin** tocar nada: la RESERVA conserva su `sub_estado = '2d'`, su `posicion_cola`,
su `consulta_bloqueante_id` y la cola no se reordena (**rollback total**); NO se ofrece
re-encolar (el error expone solo `motivo`, **sin** `colaDisponible`).

El sistema NO DEBE usar locks distribuidos (Redis/Redlock): la serialización la da
PostgreSQL. Toda la operación registra `AUDIT_LOG` (`accion='actualizar'`, `entidad='RESERVA'`)
con la fecha anterior y la nueva; en la rama `2d` la salida de cola queda reflejada de forma
coherente (cambio de `sub_estado`, `posicion_cola`, `consulta_bloqueante_id` en
`datos_nuevos`). **Sin migración de BD**: las columnas `posicion_cola`,
`consulta_bloqueante_id`, `ttl_expiracion` y `sub_estado` ya existen. (Fuente: `US-051 §Punto
2` y `§D-2.3` (rama `2d` diferida a este change); UC-05/UC-12/UC-18; requirement vivo
*"Salida de cola con reordenación al descartar desde 2.d"* (US-013); US-004 índice de cola;
change archivado `email-transicion-fecha-borrador`; `er-diagram §FECHA_BLOQUEADA`;
`CLAUDE.md §Regla crítica: bloqueo atómico de fecha`.)

#### Scenario: Cambiar a una fecha libre libera la antigua y bloquea la nueva atómicamente

- **GIVEN** una RESERVA en `2b` con la fecha `F1` bloqueada y la fecha `F2` libre
- **WHEN** el gestor cambia la fecha del evento de `F1` a `F2`
- **THEN** en una única transacción el sistema bloquea `F2`, actualiza
  `RESERVA.fecha_evento = F2` y libera `F1`
- **AND** la RESERVA permanece en `estado='consulta'`, `subEstado='2b'`
- **AND** registra `AUDIT_LOG` `accion='actualizar'` con `F1` (anterior) y `F2` (nueva)

#### Scenario: Dos cambios concurrentes a la misma fecha nueva solo dejan pasar a uno

- **GIVEN** dos RESERVAS del mismo tenant, cada una con su fecha bloqueada, que solicitan a
  la vez cambiar a la **misma** fecha nueva `F2` (libre)
- **WHEN** ambas transacciones se ejecutan concurrentemente
- **THEN** exactamente una bloquea `F2` (respetando `UNIQUE(tenant_id, fecha)`) y completa
  el cambio
- **AND** la otra recibe conflicto y su RESERVA y su fecha antigua quedan intactas

#### Scenario: Liberar una fecha con cola promueve al primero en cola

- **GIVEN** una RESERVA en `2b` con la fecha `F1` bloqueada y **una consulta en cola** sobre
  `F1`, y una fecha `F2` libre
- **WHEN** el gestor cambia la fecha del evento de `F1` a `F2`
- **THEN** al liberar `F1` el sistema promueve (FIFO, A15) al primero en cola de `F1`
  exactamente una vez, sin estado intermedio observable

#### Scenario: La fecha nueva ocupada aborta el cambio sin efectos

- **GIVEN** una RESERVA en `2b` con la fecha `F1` bloqueada y una fecha `F2` **ya
  bloqueada** por otra RESERVA
- **WHEN** el gestor intenta cambiar la fecha del evento de `F1` a `F2`
- **THEN** el sistema rechaza el cambio con conflicto
- **AND** la RESERVA conserva `fecha_evento = F1` y `F1` sigue bloqueada (rollback total)

#### Scenario: Cambiar una consulta en cola (2d) a una fecha libre la saca de la cola y pasa a 2.b

- **GIVEN** una RESERVA en `estado='consulta'`, `subEstado='2d'` con
  `posicion_cola = P`, `consulta_bloqueante_id = B` y su fecha antigua bloqueada por `B`, y
  una fecha `F2` **libre**
- **WHEN** el gestor cambia la fecha del evento a `F2`
- **THEN** en una única transacción el sistema INSERTA el bloqueo blando de `F2` (fijando
  `ttl_expiracion`), actualiza `RESERVA.fecha_evento = F2` y cambia `subEstado` de `2d` a
  `2b`
- **AND** la RESERVA sale de la cola: `posicion_cola → NULL` y `consulta_bloqueante_id →
  NULL`
- **AND** la cola vieja se reordena decrementando en 1 la `posicion_cola` de los hermanos
  con el mismo `consulta_bloqueante_id = B` y `posicion_cola > P`
- **AND** el sistema crea una `COMUNICACION` E1 en `borrador` (`fecha_envio = NULL`, no
  autoenviada) con la plantilla de transición de fecha rama `'disponible'`
- **AND** registra `AUDIT_LOG` `accion='actualizar'`, `entidad='RESERVA'`
- **AND** el sistema NO promueve ninguna cola y NO modifica la RESERVA bloqueante `B` ni su
  `FECHA_BLOQUEADA`

#### Scenario: Cambiar una consulta en cola (2d) a una fecha ocupada aborta con conflicto (409) sin efectos

- **GIVEN** una RESERVA en `subEstado='2d'` con `posicion_cola = P` y
  `consulta_bloqueante_id = B`, y una fecha `F2` **ya bloqueada** por otra RESERVA
- **WHEN** el gestor intenta cambiar la fecha del evento a `F2`
- **THEN** el sistema rechaza el cambio con conflicto **terminal (409)** exponiendo solo
  `motivo` (sin `colaDisponible`)
- **AND** la RESERVA conserva `subEstado='2d'`, su `posicion_cola = P` y su
  `consulta_bloqueante_id = B`; ninguna cola se reordena ni se muta nada (rollback total)

#### Scenario: Al salir de la cola por cambio de fecha, la cola vieja se reordena contigua desde 1

- **GIVEN** R1 bloqueante y R2 (`posicion_cola = 1`), R3 (`posicion_cola = 2`), R4
  (`posicion_cola = 3`) en `subEstado='2d'` con `consulta_bloqueante_id = R1.id`, y una
  fecha `F2` libre
- **WHEN** el gestor cambia la fecha de R3 a `F2` (fecha libre)
- **THEN** R3 sale de la cola (`posicion_cola → NULL`, `consulta_bloqueante_id → NULL`) y
  pasa a `2b` bloqueando `F2`
- **AND** R4 decrementa a `posicion_cola → 2`; R2 permanece en `posicion_cola = 1`
- **AND** las posiciones de la cola quedan contiguas empezando en 1, preservando
  `UNIQUE(tenant_id, consulta_bloqueante_id, posicion_cola)`
- **AND** R1 (bloqueante) no se modifica y no se libera ninguna `FECHA_BLOQUEADA`

#### Scenario: Guarda de origen — el cambio de fecha es válido desde 2d además de 2b/2c/2v

- **GIVEN** una RESERVA en `subEstado='2d'`
- **WHEN** el gestor solicita cambiar la fecha del evento
- **THEN** la guarda de origen acepta la operación (además de `2b`/`2c`/`2v`)
- **AND** cualquier otro `(estado, sub_estado)` distinto de `2b`/`2c`/`2v`/`2d` se rechaza
  con **422** sin efectos
