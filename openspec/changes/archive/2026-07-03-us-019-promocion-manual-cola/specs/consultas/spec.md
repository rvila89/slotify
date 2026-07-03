# consultas Specification

## ADDED Requirements

### Requirement: Promoción manual de una consulta arbitraria de la cola por el Gestor (UC-12 FA manual)

El sistema SHALL (DEBE) permitir al Gestor autenticado **promover manualmente a bloqueante**
una RESERVA concreta de la cola (`sub_estado = '2d'`, **cualquier `posicion_cola`, no solo la
primera**) para la fecha de una consulta bloqueante. Al promoverla, el sistema DEBE
transicionar la RESERVA elegida `{consulta,2d} → {consulta,2b}` usando la **máquina de estados
declarativa** (`maquina-estados.ts`, tabla de datos, NO `if` dispersos), fijando
`posicion_cola → NULL`, `consulta_bloqueante_id → NULL` y `ttl_expiracion → now() +
tenant_settings.ttl_consulta_dias` (default 3, **derivado del setting, nunca hardcodeado**).
La acción es una **escritura deliberada del Gestor** disparada desde la vista de cola de
US-017, distinta de la promoción automática FIFO de US-018. (Fuente: `US-019 §Historia`,
`§Happy Path`, `§Reglas de negocio`; UC-12 flujo alternativo manual; `CLAUDE.md §Máquina de
estados`; US-018 transición `{consulta,2d}→{consulta,2b}`.)

#### Scenario: El Gestor promueve una consulta de la cola que no es la primera

- **GIVEN** una fecha con R1 como bloqueante (`sub_estado = '2b'`, TTL vigente), R2
  (`posicion_cola = 1`) y R3 (`posicion_cola = 2`) en cola apuntando a R1
- **WHEN** el Gestor selecciona R3, hace clic en "Promover a bloqueante" y confirma la acción
- **THEN** R3 pasa a `sub_estado = '2b'`, `posicion_cola → NULL`,
  `consulta_bloqueante_id → NULL`, `ttl_expiracion → now() + tenant_settings.ttl_consulta_dias`
- **AND** la promoción usa la transición declarativa `{consulta,2d} → {consulta,2b}`

#### Scenario: El Gestor promueve la primera de la cola (posicion_cola = 1)

- **GIVEN** R1 bloqueante, R2 (`posicion_cola = 1`), R3 (`posicion_cola = 2`)
- **WHEN** el Gestor selecciona R2 y confirma la promoción
- **THEN** R2 pasa a `sub_estado = '2b'` (nueva bloqueante, `posicion_cola → NULL`,
  `consulta_bloqueante_id → NULL`)

### Requirement: Expiración forzosa de la bloqueante activa antes de la promoción manual

El sistema SHALL (DEBE), como parte indivisible de la promoción manual, **expirar
forzosamente** la RESERVA que bloquea actualmente la fecha si sigue viva (`sub_estado ∈
{'2b','2c','2v'}`, con TTL vigente **o** ya vencido pero aún no procesado por el barrido
automático): `sub_estado → '2x'`, `ttl_expiracion → NULL`. Esta expiración reutiliza la
semántica terminal `2.x` de US-012 (consulta expirada), aplicada aquí de forma **deliberada
por el Gestor** (acción destructiva). Si la fecha **no** tiene bloqueante viva (ya
expirada/liberada), el sistema procede solo con la promoción sin expirar nada. (Fuente:
`US-019 §Reglas de negocio`, `§Happy Path`, `§FA-02`; US-012 semántica de `2.x`.)

#### Scenario: La bloqueante viva se expira a 2.x antes de promover

- **GIVEN** R1 bloqueante en `sub_estado = '2b'` con TTL vigente y R3 en cola
- **WHEN** el Gestor promueve R3 y confirma
- **THEN** R1 pasa a `sub_estado = '2x'`, `ttl_expiracion → NULL` (expirada forzosamente)
- **AND** la expiración de R1 y la promoción de R3 ocurren en la misma transacción

#### Scenario: Bloqueante con TTL ya vencido pero no barrida — se expira igualmente (FA-02)

- **GIVEN** R1 con `ttl_expiracion < now()` que el barrido automático aún no ha procesado
- **WHEN** el Gestor promueve manualmente una consulta de la cola
- **THEN** el sistema detecta que R1 ya expiró, la marca como `2.x` y ejecuta la promoción
  elegida por el Gestor
- **AND** el `SELECT … FOR UPDATE` sobre `FECHA_BLOQUEADA` evita que el barrido automático
  concurrente duplique la operación

### Requirement: Re-asignación atómica del bloqueo blando a la RESERVA promovida manualmente

El sistema SHALL (DEBE), como parte indivisible de la promoción manual, dejar la fila de
`FECHA_BLOQUEADA` de `(tenant, fecha)` apuntando a la RESERVA promovida:
`reserva_id → <promovida>`, `tipo_bloqueo = 'blando'`, `ttl_expiracion = now() +
tenant_settings.ttl_consulta_dias`, manteniendo **una sola fila activa** por `(tenant,
fecha)` en todo momento (nunca hay instante observable con la fecha libre). La atomicidad y la
no-doble-reserva las provee **exclusivamente PostgreSQL**: `UNIQUE(tenant_id, fecha)` +
`SELECT … FOR UPDATE` vía Prisma `$queryRaw`, reutilizando la primitiva `bloquearFecha()`
(US-040). El sistema NO DEBE usar Redis, Redlock ni locks distribuidos. El `ttl_expiracion`
DEBE calcularse/compararse como **instante `timestamptz`**, nunca como fecha formateada.
(Fuente: `US-019 §Reglas de negocio`; `CLAUDE.md §Regla crítica: bloqueo atómico`;
`er-diagram.md §5.3`; US-040.)

#### Scenario: La promoción manual deja la fecha bloqueada por la promovida

- **GIVEN** una promoción manual en curso de R3 sobre la fecha D de un tenant T (R1 bloqueante
  actual)
- **WHEN** el sistema materializa el bloqueo de la promovida
- **THEN** la fila de `FECHA_BLOQUEADA` de `(T, D)` queda con `reserva_id = R3.id`,
  `tipo_bloqueo = 'blando'` y `ttl_expiracion = now() + tenant_settings.ttl_consulta_dias`
- **AND** la restricción `UNIQUE(tenant_id, fecha)` garantiza que nunca coexisten dos bloqueos
  activos para `(T, D)`

### Requirement: Reordenación de la cola por cierre del hueco tras la promoción manual

El sistema SHALL (DEBE), tras promover una RESERVA en `posicion_cola = P`, **reordenar la cola
cerrando el hueco** en la misma transacción: cada RESERVA en `sub_estado = '2d'` restante con
`posicion_cola > P` DEBE decrementar su `posicion_cola` en 1; todas las RESERVA restantes de
la cola (las de posición `< P` no cambian de posición) DEBEN actualizar su
`consulta_bloqueante_id` al id de la nueva bloqueante (la promovida). El sistema DEBE preservar
la unicidad `UNIQUE(tenant_id, consulta_bloqueante_id, posicion_cola) WHERE posicion_cola IS
NOT NULL` (US-004): tras la reordenación las posiciones DEBEN ser contiguas empezando en 1. Si
al leer la cola bajo lock las posiciones no son contiguas (anomalía de datos), el sistema DEBE
registrar la inconsistencia en `AUDIT_LOG` y **abortar sin corrección silenciosa** (mismo
criterio que US-018). (Fuente: `US-019 §Happy Path`, `§FA-01`, `§FA-03`; `er-diagram.md
§Índices de cola`; US-018 reordenación FIFO.)

#### Scenario: Promover una posición intermedia cierra el hueco y re-apunta a la nueva bloqueante

- **GIVEN** R1 bloqueante, R2 (`posicion_cola = 1`) y R3 (`posicion_cola = 2`) apuntando a R1
- **WHEN** el Gestor promueve R3
- **THEN** R3 → `2b` (nueva bloqueante, `posicion_cola → NULL`, `consulta_bloqueante_id → NULL`)
- **AND** R2: `posicion_cola → 1` (cierra el hueco de R3), `consulta_bloqueante_id → R3.id`
- **AND** las posiciones de la cola quedan contiguas empezando en 1

#### Scenario: Cola de un único elemento queda vacía tras la promoción (FA-03)

- **GIVEN** R1 bloqueante y solo R2 en cola (`posicion_cola = 1`, `consulta_bloqueante_id = R1.id`)
- **WHEN** el Gestor promueve R2
- **THEN** R1 → `2x`; R2 → `2b`; `FECHA_BLOQUEADA.reserva_id → R2.id`; la cola queda vacía

### Requirement: Promoción manual atómica all-or-nothing sin estado intermedio observable

El sistema SHALL (DEBE) ejecutar la promoción manual completa —expiración forzosa de la
bloqueante a `2x` + transición de la promovida a `2b` + re-asignación de `FECHA_BLOQUEADA` +
reordenación de la cola + auditoría— como una operación **all-or-nothing** dentro de **una
única transacción** serializada por `SELECT … FOR UPDATE` sobre la fila de `FECHA_BLOQUEADA`,
bajo el contexto RLS del tenant del Gestor. NO DEBE existir ningún instante observable en que
`FECHA_BLOQUEADA` quede sin apuntar a una bloqueante viva ni en que la cola tenga un hueco de
posición. Si cualquier paso falla, la transacción hace rollback completo (la bloqueante sigue
viva, la fecha sigue bloqueada por ella, la cola intacta). (Fuente: `US-019 §Reglas de
negocio`, `§Impacto de Negocio`; `CLAUDE.md §Regla crítica`.)

#### Scenario: Un fallo parcial revierte toda la promoción manual

- **GIVEN** una promoción manual de R3 en curso (expiración de R1 + re-bloqueo + reordenación)
- **WHEN** una de las operaciones falla antes del commit
- **THEN** la transacción hace rollback completo: R1 permanece como bloqueante viva, R3 sigue
  en `2d` con su posición, la fila de `FECHA_BLOQUEADA` sigue apuntando a R1 y la cola queda
  intacta

### Requirement: Guarda de validación — solo se promueve una RESERVA en sub_estado 2.d

El sistema SHALL (DEBE) validar en el servidor, **antes** de cualquier mutación, que la RESERVA
que el Gestor intenta promover está en `sub_estado = '2d'` y pertenece a la cola de la fecha
indicada. Si la RESERVA está en cualquier otro sub-estado (terminales `2x`/`2y`/`2z`, la propia
bloqueante, etc.) —por ejemplo porque expiró o fue actualizada entre la carga de la vista y la
confirmación—, el sistema DEBE **rechazar la operación** con un mensaje de error ("La consulta
seleccionada ya no está en cola") y **no realizar ningún cambio**. La guarda de origen reutiliza
la máquina de estados declarativa (solo `{consulta,2d}` es promovible). (Fuente: `US-019 §FA-05`,
`§Reglas de Validación`; `CLAUDE.md §Máquina de estados`.)

#### Scenario: Promover una consulta que ya no está en 2.d se rechaza sin efectos (FA-05)

- **GIVEN** una consulta que el Gestor eligió pero que transitó a un estado terminal
  (`2x`/`2y`/`2z`) antes de que confirmara
- **WHEN** el Gestor confirma la promoción
- **THEN** el sistema detecta que `sub_estado ≠ '2d'`, rechaza la operación con "La consulta
  seleccionada ya no está en cola" y no realiza ningún cambio

### Requirement: Guarda de validación — la promoción exige FECHA_BLOQUEADA activa para la fecha

El sistema SHALL (DEBE) rechazar la promoción manual cuando **no existe** una fila activa en
`FECHA_BLOQUEADA` para la `(tenant, fecha)` de la consulta elegida (inconsistencia de datos:
una consulta en `2.d` sin fecha bloqueada), sin modificar ninguna RESERVA ni registro
relacionado. (Fuente: `US-019 §Reglas de Validación`.)

#### Scenario: Sin FECHA_BLOQUEADA para la fecha — la promoción se rechaza

- **GIVEN** una consulta en `2d` cuya fecha no tiene fila activa en `FECHA_BLOQUEADA`
  (inconsistencia)
- **WHEN** el Gestor intenta promoverla
- **THEN** el sistema responde con un error de inconsistencia de datos y no modifica nada

### Requirement: Confirmación explícita del Gestor para la acción destructiva de promoción manual

El sistema SHALL (DEBE) exigir que el Gestor **confirme explícitamente** la promoción manual
antes de ejecutarla, dado que expira irreversiblemente la bloqueante activa (`2.x` terminal).
La confirmación se materializa en un **diálogo de confirmación** en la UI de la vista de cola
(US-017); si el Gestor **cancela**, no se realiza ningún cambio de estado (la bloqueante sigue
activa, la cola inalterada). El endpoint de escritura solo actúa ante una petición explícita del
Gestor. (Fuente: `US-019 §Reglas de negocio`, `§FA-04`, `§Reglas de Validación`.)

#### Scenario: El Gestor cancela el diálogo de confirmación (FA-04)

- **GIVEN** que el Gestor ha seleccionado una consulta y el sistema muestra el diálogo de
  confirmación
- **WHEN** el Gestor hace clic en "Cancelar"
- **THEN** no se realiza ningún cambio de estado; la bloqueante sigue activa; la cola permanece
  inalterada; la vista vuelve a su estado anterior

### Requirement: AUDIT_LOG de la promoción manual por cada RESERVA modificada, con el usuario del Gestor

El sistema SHALL (DEBE) registrar en `AUDIT_LOG`, dentro de la misma transacción de la
promoción manual, una entrada `accion = 'transicion'`, `entidad = 'RESERVA'` **por cada RESERVA
modificada**, incluyendo el `usuario_id` del Gestor que ejecuta la acción: para la bloqueante
expirada forzosamente (`datos_anteriores.sub_estado ∈ {2b,2c,2v}`, `datos_nuevos.sub_estado =
'2x'`); para la promovida (`datos_anteriores.sub_estado = '2d'`, `datos_nuevos = {sub_estado:
'2b', origen: 'promocion_manual'}`); y para cada RESERVA reordenada con su cambio de
`posicion_cola`/`consulta_bloqueante_id`. El `origen: 'promocion_manual'` distingue esta acción
de la automática de US-018 (`origen: 'promocion_automatica'`). (Fuente: `US-019 §Happy Path`,
`§Reglas de negocio`; US-018 auditoría de promoción.)

#### Scenario: Cada RESERVA modificada por la promoción manual deja su registro con el Gestor

- **GIVEN** una promoción manual que expira R1, promueve R3 y reordena R2
- **WHEN** la transacción de promoción confirma
- **THEN** `AUDIT_LOG` contiene una entrada `accion='transicion'`, `entidad='RESERVA'` con el
  `usuario_id` del Gestor para R1 (`sub_estado 2b→2x`), para R3
  (`datos_nuevos = {sub_estado: '2b', origen: 'promocion_manual'}`) y para R2 (nuevo
  `posicion_cola`/`consulta_bloqueante_id`)

### Requirement: Coordinación anti-doble-promoción — promoción manual vs promoción automática (RC-A)

El sistema SHALL (DEBE) coordinar la promoción manual con la **promoción automática** de US-018
de modo que **nunca** se produzca doble promoción sobre la misma `(tenant, fecha)`: ambas rutas
DEBEN contender por el `SELECT … FOR UPDATE` sobre la fila de `FECHA_BLOQUEADA` de la fecha
(la ruta automática la toma en `liberarFecha()` antes de eliminarla; la manual la toma antes de
expirar la bloqueante) y re-evaluar la **guarda "ya promovida"** de US-018 dentro de la
transacción. La primera ruta que adquiere el lock completa su operación; la segunda, al obtener
el lock, detecta que el estado ya cambió (la consulta elegida ya no está en `2.d`, o la
bloqueante esperada ya está en estado terminal, o la fecha ya está bloqueada por otra
promovida) y **aborta sin inconsistencia**. Rige **FIFO estricto + "gana quien toma el lock
primero"** (decisión de US-018 §D-6): NO hay cesión de prioridad a la acción manual. Cuando la
que falla es la acción del Gestor, el sistema DEBE devolverle el mensaje "La cola ya fue
actualizada automáticamente, por favor recarga la vista". La garantía reside **exclusivamente
en PostgreSQL**, NUNCA en locks distribuidos. Zona crítica cubierta con **TDD primero** (skill
`concurrency-locking`). (Fuente: `US-019 §Race condition: promoción manual vs. barrido
automático`; US-018 requisito RC-3, `§D-3`, `§D-6`; `CLAUDE.md §Regla crítica`, `§Testing`.)

#### Scenario: Manual y automática compiten — una promueve, la otra aborta limpio

- **GIVEN** el Gestor inicia una promoción manual y, a la vez, el barrido de TTL (US-018) intenta
  promover la primera de la cola para la misma fecha
- **WHEN** ambas transacciones contienden por el `SELECT … FOR UPDATE` sobre la fila de
  `FECHA_BLOQUEADA`
- **THEN** la primera en adquirir el lock completa su promoción (manual o automática)
- **AND** la segunda, al obtener el lock, detecta que el estado ya cambió y aborta sin
  inconsistencia
- **AND** si la que falla es la acción del Gestor, este recibe "La cola ya fue actualizada
  automáticamente, por favor recarga la vista"

### Requirement: Coordinación — dos Gestores promueven simultáneamente en la misma cola (RC-B)

El sistema SHALL (DEBE) garantizar que, ante dos Gestores (sesiones distintas del mismo tenant)
que inician simultáneamente la promoción de consultas **distintas** de la misma cola, ambas
transacciones contiendan por el `SELECT … FOR UPDATE` sobre la fila de `FECHA_BLOQUEADA` y
**exactamente una** complete la promoción (expira bloqueante, promueve su elegida, reordena). La
segunda, al obtener el lock, detecta el estado inconsistente (la bloqueante que esperaba ya está
en `2.x`, o su consulta elegida ya no tiene `posicion_cola` válida / ya no está en `2.d`) y
**aborta** mostrando el error al Gestor correspondiente. La garantía reside en PostgreSQL, no en
locks distribuidos. Zona crítica cubierta con **TDD primero**. (Fuente: `US-019 §Race condition:
dos Gestores promueven simultáneamente`; `CLAUDE.md §Testing`.)

#### Scenario: Dos Gestores, una sola promoción efectiva

- **GIVEN** dos Gestores del mismo tenant inician a la vez la promoción de dos consultas
  distintas de la misma cola
- **WHEN** ambas transacciones intentan adquirir `SELECT … FOR UPDATE` sobre `FECHA_BLOQUEADA`
- **THEN** exactamente una transacción completa la promoción
- **AND** la otra, al obtener el lock, detecta el estado ya cambiado y aborta mostrando el error
  al Gestor correspondiente
