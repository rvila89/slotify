# consultas Specification

## ADDED Requirements

### Requirement: Promoción automática FIFO del primero en cola al liberarse la fecha (A15/UC-12)

El sistema SHALL (DEBE), cuando `liberarFecha()` (US-012/US-041) dispara el seam
`PromocionColaPort.promoverPrimeroEnCola({ tenantId, fecha })` para una `(tenant, fecha)`
con cola activa, ejecutar la **promoción FIFO estricta** del primero en cola: seleccionar
la RESERVA en `sub_estado = '2d'` con `posicion_cola = 1` cuyo `consulta_bloqueante_id`
era la RESERVA cuya fecha se acaba de liberar, y transicionarla a `sub_estado = '2b'`. El
seam DEBE dejar de ser un stub no-op (deuda US-018 de `us-041 §D-2`) y pasar a ejecutar la
mecánica real A15. La transición `{consulta,2d} → {consulta,2b}` DEBE modelarse en la
**máquina de estados declarativa** (`maquina-estados.ts`, tabla de datos, NO `if`
dispersos). (Fuente: `US-018 §Historia`, `§Reglas de negocio`, `§Happy Path`; UC-12; A15;
`us-041 design.md §D-2`; `CLAUDE.md §Máquina de estados`.)

#### Scenario: Liberada la fecha, el primero en cola es promovido a 2.b

- **GIVEN** una RESERVA R1 (bloqueante) cuya `FECHA_BLOQUEADA` se acaba de liberar, y una
  RESERVA R2 en `sub_estado = '2d'`, `posicion_cola = 1`, `consulta_bloqueante_id = R1.id`
- **WHEN** `liberarFecha()` dispara el seam de promoción para esa `(tenant, fecha)`
- **THEN** R2 pasa a `sub_estado = '2b'`, `posicion_cola → NULL`,
  `consulta_bloqueante_id → NULL`, `ttl_expiracion → now() + tenant_settings.ttl_consulta_dias`
- **AND** la promoción usa la transición declarativa `{consulta,2d} → {consulta,2b}` de la
  máquina de estados

### Requirement: Re-creación atómica del bloqueo blando para la RESERVA promovida (bloquearFecha)

El sistema SHALL (DEBE), como parte indivisible de la promoción, **re-crear la fila de
`FECHA_BLOQUEADA`** para la RESERVA promovida reutilizando la primitiva atómica existente
`bloquearFecha()` (US-040): `reserva_id → <promovida>`, `tipo_bloqueo = 'blando'`,
`ttl_expiracion = now() + tenant_settings.ttl_consulta_dias`. La atomicidad y la no-doble-
reserva las provee **exclusivamente PostgreSQL**: `UNIQUE(tenant_id, fecha)` +
`SELECT … FOR UPDATE` vía Prisma `$queryRaw`. El sistema NO DEBE usar Redis, Redlock ni
locks distribuidos (regla crítica del proyecto). El `ttl_expiracion` DEBE calcularse y
compararse como **instante `timestamptz`** (`now() + ttl_consulta_dias`), nunca como fecha
formateada (evita el off-by-one de TZ conocido, deuda ajena). (Fuente: `US-018 §Reglas de
negocio`; `CLAUDE.md §Regla crítica: bloqueo atómico`; `er-diagram.md §5.3`; US-040.)

#### Scenario: La promoción re-bloquea la fecha con la primitiva atómica

- **GIVEN** una promoción en curso de R2 sobre la fecha D de un tenant T
- **WHEN** el sistema materializa el bloqueo de la promovida
- **THEN** se crea (o actualiza vía la primitiva) la fila de `FECHA_BLOQUEADA` de `(T, D)`
  con `reserva_id = R2.id`, `tipo_bloqueo = 'blando'` y
  `ttl_expiracion = now() + tenant_settings.ttl_consulta_dias`
- **AND** la restricción `UNIQUE(tenant_id, fecha)` garantiza que nunca coexisten dos
  bloqueos activos para `(T, D)`

### Requirement: Reordenación FIFO del resto de la cola tras la promoción

El sistema SHALL (DEBE), tras promover a `posicion_cola = 1`, **reordenar el resto de la
cola** en la misma transacción: cada RESERVA en `sub_estado = '2d'` restante DEBE
decrementar su `posicion_cola` en 1 y actualizar su `consulta_bloqueante_id` al id de la
nueva bloqueante (la RESERVA promovida). El sistema DEBE preservar la unicidad
`UNIQUE(tenant_id, consulta_bloqueante_id, posicion_cola) WHERE posicion_cola IS NOT NULL`
(US-004): tras la reordenación las posiciones DEBEN ser contiguas empezando en 1. (Fuente:
`US-018 §Happy Path`, `§FA-03`; `er-diagram.md §Índices de cola`, `§decisión #16`.)

#### Scenario: Cola de más de dos elementos reordena y re-apunta a la nueva bloqueante

- **GIVEN** R1 liberada y R2 (`posicion_cola = 1`), R3 (`posicion_cola = 2`), R4
  (`posicion_cola = 3`) apuntando a R1
- **WHEN** se ejecuta la promoción
- **THEN** R2 → `2b` (nueva bloqueante, `posicion_cola → NULL`,
  `consulta_bloqueante_id → NULL`)
- **AND** R3: `posicion_cola → 1`, `consulta_bloqueante_id → R2.id`
- **AND** R4: `posicion_cola → 2`, `consulta_bloqueante_id → R2.id`
- **AND** `FECHA_BLOQUEADA.reserva_id → R2.id`

### Requirement: Promoción atómica all-or-nothing sin estado intermedio observable

El sistema SHALL (DEBE) ejecutar la promoción completa —transición de la promovida a `2b`
+ re-bloqueo de `FECHA_BLOQUEADA` + reordenación del resto de la cola + auditoría— como una
operación **all-or-nothing** dentro de **una única transacción** serializada por
`SELECT … FOR UPDATE` sobre la fila de `FECHA_BLOQUEADA` (y las RESERVA de cola), bajo el
contexto RLS del tenant de la fecha. NO DEBE existir ningún instante observable en que
`FECHA_BLOQUEADA` quede sin apuntar a una bloqueante viva ni en que la cola tenga un hueco
de posición. Si cualquier paso falla, la transacción hace rollback completo. (Fuente:
`US-018 §Reglas de Validación`, `§Happy Path` — atomicidad; `CLAUDE.md §Regla crítica`.)

#### Scenario: No hay ventana en que la fecha quede sin bloqueante viva

- **GIVEN** una promoción en curso de R2 sobre la fecha liberada de R1
- **WHEN** la transacción de promoción se ejecuta
- **THEN** en ningún instante observable `FECHA_BLOQUEADA.reserva_id` apunta a R1 (ya
  liberada/expirada) sin apuntar a la nueva bloqueante R2
- **AND** si algún paso falla antes del commit, todo se revierte (R2 sigue en `2d`, la
  cola conserva su orden, no hay fila de `FECHA_BLOQUEADA` a medio crear)

### Requirement: Cola de un único elemento — promoción deja la cola vacía

El sistema SHALL (DEBE), cuando la cola de la fecha liberada tiene un **único** elemento
(R2 en `posicion_cola = 1`), promover R2 a `2b` (`posicion_cola → NULL`,
`consulta_bloqueante_id → NULL`), re-crear `FECHA_BLOQUEADA` con `reserva_id = R2.id`, y
dejar la cola **vacía** sin ejecutar reordenación de restantes (no los hay). (Fuente:
`US-018 §FA-01`.)

#### Scenario: Cola de un elemento se vacía tras promover

- **GIVEN** R1 liberada y solo R2 en cola (`posicion_cola = 1`, `consulta_bloqueante_id = R1.id`)
- **WHEN** el seam ejecuta la promoción
- **THEN** R2 → `2b`, `posicion_cola → NULL`, `consulta_bloqueante_id → NULL`
- **AND** `FECHA_BLOQUEADA.reserva_id → R2.id`, la cola queda vacía
- **AND** `AUDIT_LOG` registra la transición de R2

### Requirement: Sin cola tras liberar — no se ejecuta promoción y la fecha queda libre

El sistema SHALL (DEBE), cuando `liberarFecha()` libera una fecha sin ninguna RESERVA en
`sub_estado = '2d'` apuntando a la bloqueante liberada, **NO** invocar la promoción: el
seam no se dispara (lo garantiza `hayColaActiva` en `liberarFecha()`, contrato heredado de
US-012/US-041 que US-018 NO modifica) y la fecha queda disponible. Si por cualquier motivo
el adaptador de promoción se invocara sin candidato en cola, DEBE ser un **no-op sin
error** (idempotencia defensiva). (Fuente: `US-018 §FA-02`; `us-041 §Seam de promoción`.)

#### Scenario: Liberación sin cola no promueve y no da error

- **GIVEN** R1 liberada sin ninguna RESERVA con `consulta_bloqueante_id = R1.id`
- **WHEN** el sistema completa la liberación
- **THEN** la promoción no se ejecuta (el seam no se dispara por ausencia de cola activa)
- **AND** `FECHA_BLOQUEADA` queda eliminada (fecha disponible), sin error del sistema

### Requirement: Idempotencia — guarda "ya promovida" evita doble promoción

El sistema SHALL (DEBE) ser idempotente frente a re-ejecuciones: dentro de la transacción,
tras adquirir el `SELECT … FOR UPDATE`, DEBE **re-verificar** que sigue existiendo un
candidato `posicion_cola = 1` pendiente de promover para esa `(tenant, fecha)` y que la
`FECHA_BLOQUEADA` no está ya apuntando a una bloqueante viva promovida. Si otra ejecución
ya promovió (segunda instancia del job, o promoción manual US-019), la transacción DEBE
**abortar sin cambios** (no-op silencioso), sin duplicar la promoción, sin decrementar dos
veces `posicion_cola` ni duplicar `AUDIT_LOG`. (Fuente: `US-018 §FA-04`, `§Supuestos`,
`§Reglas de Validación`.)

#### Scenario: Segunda ejecución del job sobre una fecha ya promovida no hace nada

- **GIVEN** una instancia del job ya promovió R2 y `FECHA_BLOQUEADA.reserva_id` ya es R2.id
- **WHEN** una segunda instancia intenta procesar el mismo tenant/fecha
- **THEN** la guarda "ya promovida" detecta que no hay bloqueante liberada pendiente ni un
  nuevo `posicion_cola = 1` que promover
- **AND** no realiza ningún cambio, sin error y sin duplicación en `AUDIT_LOG`

### Requirement: Anomalía de posiciones no contiguas — abortar y auditar sin corrección silenciosa

El sistema SHALL (DEBE), si al leer la cola bajo lock detecta que las `posicion_cola` del
conjunto no son **contiguas empezando en 1** (anomalía de datos), **registrar la
inconsistencia en `AUDIT_LOG`** y **abortar la transacción sin promover**. El sistema NO
DEBE aplicar corrección silenciosa de posiciones. (Fuente: `US-018 §Reglas de Validación`.)

#### Scenario: Cola con posiciones no contiguas aborta la promoción

- **GIVEN** una cola cuyas `posicion_cola` presentan un hueco (p. ej. 1, 3 sin 2)
- **WHEN** el sistema evalúa la cola bajo lock durante la promoción
- **THEN** registra la anomalía en `AUDIT_LOG` y aborta la transacción sin promover
- **AND** no corrige silenciosamente las posiciones

### Requirement: AUDIT_LOG de la promoción por cada RESERVA modificada

El sistema SHALL (DEBE) registrar en `AUDIT_LOG`, dentro de la misma transacción de la
promoción, una entrada `accion = 'transicion'`, `entidad = 'RESERVA'` **por cada RESERVA
modificada**: para la promovida con `datos_anteriores = {sub_estado: '2d'}` y
`datos_nuevos = {sub_estado: '2b', origen: 'promocion_automatica'}`; y para cada RESERVA
reordenada con su cambio de `posicion_cola`/`consulta_bloqueante_id`. NO DEBE duplicar la
auditoría de la liberación de la fecha bloqueante (esa la registra `liberarFecha()`,
`entidad = 'FECHA_BLOQUEADA'`, causa `TTL`/`descarte`/`cancelacion`). (Fuente: `US-018
§Reglas de negocio`, `§Happy Path`; US-041 auditoría de liberación.)

#### Scenario: Cada RESERVA modificada por la promoción deja su registro de auditoría

- **GIVEN** una promoción que mueve R2 a `2b` y reordena R3, R4
- **WHEN** la transacción de promoción confirma
- **THEN** `AUDIT_LOG` contiene una entrada `accion='transicion'`, `entidad='RESERVA'` para
  R2 con `datos_nuevos = {sub_estado: '2b', origen: 'promocion_automatica'}`
- **AND** una entrada por R3 y por R4 reflejando su nuevo `posicion_cola`/`consulta_bloqueante_id`
- **AND** no se duplica la entrada de liberación de `FECHA_BLOQUEADA` (la registró `liberarFecha()`)

### Requirement: Notificación de la promoción — alerta interna al gestor, sin email al cliente

El sistema SHALL (DEBE), al completar la promoción, dejar constancia de una **alerta interna
dirigida al gestor** ("Consulta [código] promovida al bloqueo de la fecha [fecha]; contactar
al cliente") para que el gestor proceda a comunicarse con la reserva promovida. El sistema
NO DEBE enviar email automático al cliente en MVP (el email "¡La fecha está disponible!" de
UC-12 paso 8 es `📐 Solo diseñado`, fuera de alcance); el adaptador de promoción NO DEBE
tocar el puerto de comunicaciones/email (US-045). Aplica el mismo patrón de **alerta interna
mínima** que la expiración (US-012 §D-10); la superficie de notificaciones/dashboard es de
**US-044**. El registro de la alerta DEBE ir **dentro de la misma transacción** de la
promoción y por tanto ser **idempotente** respecto a la guarda "ya promovida": una promoción
abortada por la guarda (re-ejecución o carrera) NO DEBE registrar alerta; N ejecuciones = 1
sola alerta. (Fuente: `US-018 §Email relacionado`, `§Notas de alcance`; gate SDD 01/07/2026
D-5; patrón `us-012 design.md §D-10`.)

#### Scenario: La promoción deja alerta interna al gestor y no envía email al cliente

- **GIVEN** una promoción efectiva de R2 a `2b`
- **WHEN** la transacción de promoción confirma
- **THEN** el sistema deja constancia de una alerta interna al gestor para contactar al
  cliente de R2
- **AND** NO se envía ningún email automático al cliente ni se invoca el puerto de
  comunicaciones/email (US-045)

#### Scenario: Una re-ejecución abortada por la guarda no duplica la alerta

- **GIVEN** una `(tenant, fecha)` ya promovida en una ejecución anterior
- **WHEN** una segunda ejecución intenta promover y aborta por la guarda "ya promovida"
- **THEN** no se registra ninguna alerta interna adicional (el registro es idempotente,
  ligado a la transacción de la promoción efectiva)

### Requirement: Concurrencia — dos instancias del job promueven exactamente una vez (RC-1)

El sistema SHALL (DEBE) garantizar que, ante dos ejecuciones concurrentes del barrido/job
sobre la misma `(tenant, fecha)` con la bloqueante liberada, **exactamente una** transacción
adquiera el `SELECT … FOR UPDATE` sobre la fila de `FECHA_BLOQUEADA` y complete la promoción
de R2 a `2b`; la segunda queda bloqueada hasta el `COMMIT` de la primera y entonces, al
re-evaluar bajo la guarda "ya promovida", detecta que `FECHA_BLOQUEADA` ya apunta a la nueva
bloqueante y **aborta sin cambios**. El resultado final es **exactamente una** promoción, sin
doble bloqueo ni doble decremento de `posicion_cola`. La garantía reside en PostgreSQL, no en
locks distribuidos. Zona crítica cubierta con **TDD primero** (skill `concurrency-locking`).
(Fuente: `US-018 §Race condition: dos instancias del job`; `CLAUDE.md §Testing`, `§Regla
crítica`.)

#### Scenario: Doble job concurrente — una promoción, cero duplicados

- **GIVEN** dos instancias del job sobre el mismo tenant/fecha con R1 liberada y R2 en
  `posicion_cola = 1`
- **WHEN** ambas intentan adquirir `SELECT … FOR UPDATE` sobre la fila de `FECHA_BLOQUEADA`
- **THEN** exactamente una adquiere el lock y completa la promoción de R2 a `2b`
- **AND** la segunda, tras el commit de la primera, re-evalúa, detecta el estado ya
  promovido y aborta sin cambios (sin doble bloqueo ni doble decremento)

### Requirement: Concurrencia — barrido TTL (US-012) vs promoción sobre la misma fecha (RC-2)

El sistema SHALL (DEBE) garantizar que el barrido de expiración de TTL (US-012), que libera
la fecha y dispara el seam, y la promoción que ese seam ejecuta se serialicen sobre la fila
de `FECHA_BLOQUEADA`: como la promoción se dispara **post-commit** de la liberación (contrato
heredado de US-012/US-041, exactamente-una-vez cuando el DELETE afectó 1 fila), NO existe
condición de carrera en que la promoción re-cree el bloqueo antes de que la liberación lo
elimine. Si un segundo barrido concurrente intenta expirar/promover la misma fecha, la
serialización por `SELECT … FOR UPDATE` + la guarda "ya promovida" garantizan que la fecha
nunca queda con doble bloqueo ni con la cola avanzada dos veces. Zona crítica cubierta con
**TDD primero**. (Fuente: `US-018 §Race condition` (implícita en encadenado UC-09→UC-12);
`us-012 §D-4`, `§D-5`; `CLAUDE.md §Testing`.)

#### Scenario: Liberación y promoción encadenadas no producen doble bloqueo

- **GIVEN** el barrido de TTL libera la fecha de R1 (DELETE afecta 1 fila) y dispara el seam
- **WHEN** la promoción re-crea `FECHA_BLOQUEADA` para R2 post-commit de la liberación
- **THEN** la secuencia liberar→promover es serializada: en ningún instante coexisten la fila
  de R1 y la de R2 para la misma `(tenant, fecha)`
- **AND** un segundo barrido concurrente sobre la misma fecha aborta por la guarda "ya
  promovida" sin re-promover

### Requirement: Concurrencia — coordinación con la promoción manual del Gestor (US-019, RC-3)

El sistema SHALL (DEBE) coordinar la promoción automática con la **futura promoción manual**
del Gestor (US-019) de modo que **nunca** se produzca doble promoción sobre la misma
`(tenant, fecha)`: ambas rutas DEBEN adquirir el `SELECT … FOR UPDATE` sobre la fila de
`FECHA_BLOQUEADA` y re-evaluar la guarda "ya promovida" dentro de la transacción. La primera
en adquirir el lock completa la promoción; la segunda, al obtener el lock, detecta el estado
ya actualizado y **aborta sin inconsistencia**. Cuando la que falla es la acción del Gestor
(US-019), el sistema DEBE poder devolverle un mensaje de error ("La cola ya fue actualizada
automáticamente"). US-018 **define y respeta la guarda de coordinación**; la superficie de la
acción manual y su mensaje son de US-019. Zona crítica cubierta con **TDD primero**. (Fuente:
`US-018 §Race condition: barrido automático vs. promoción manual`.)

#### Scenario: Job automático y Gestor compiten — una promoción, la otra ruta aborta limpio

- **GIVEN** el barrido automático y la acción del Gestor (US-019) inician a la vez una
  promoción sobre la misma fecha con R1 liberada
- **WHEN** ambas intentan adquirir `SELECT … FOR UPDATE` sobre `FECHA_BLOQUEADA`
- **THEN** la primera en adquirir el lock completa la promoción de R2
- **AND** la segunda, al obtener el lock, detecta la guarda "ya promovida" y aborta sin
  inconsistencia; si es el Gestor quien falla, la superficie de US-019 puede informar "La cola
  ya fue actualizada automáticamente"
