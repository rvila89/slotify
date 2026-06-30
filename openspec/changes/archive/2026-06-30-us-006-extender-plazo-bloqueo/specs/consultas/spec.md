# Spec Delta — Capability `consultas`

> US-006 amplía la capability `consultas` con el **override manual del Gestor para
> extender el plazo (TTL) del bloqueo blando activo** de una RESERVA antes de que
> expire (`sub_estado ∈ {2b, 2c, 2v}` O `estado = 'pre_reserva'`, con
> `ttl_expiracion > ahora`). El sistema **prorroga** `RESERVA.ttl_expiracion` en N
> días enteros y, en la **misma transacción**, actualiza el `ttl_expiracion` de la
> fila blanda en `FECHA_BLOQUEADA`; registra la acción en `AUDIT_LOG`
> (`accion = 'actualizar'`). **No** cambia estado/sub_estado/tipo_bloqueo/fecha. Los
> recordatorios automáticos (A3/A4/A5) se **reprograman implícitamente** porque se
> derivan del `ttl_expiracion` y los dispara el barrido periódico (US-012). Reutiliza
> el bloqueo atómico de US-040/041 (`SELECT … FOR UPDATE` + `UNIQUE(tenant_id,
> fecha)`) sin reinventarlo. Fuente: US-006, UC-05; `architecture.md §2.4, §2.5`;
> `er-diagram.md §3.5, §3.6`.

## ADDED Requirements

### Requirement: Extensión manual del TTL del bloqueo activo prorroga RESERVA y FECHA_BLOQUEADA

El sistema SHALL (DEBE), cuando el Gestor solicita "Extender bloqueo" sobre una
RESERVA **existente** con **bloqueo blando vigente** —`sub_estado ∈ {'2b', '2c',
'2v'}` O `estado = 'pre_reserva'`, con `ttl_expiracion > ahora` y **fila activa en
`FECHA_BLOQUEADA`** (`tipo_bloqueo = 'blando'`)— indicando un número entero de días
`N ≥ 1`, fijar
`RESERVA.ttl_expiracion = ttl_expiracion_actual + N días` (la base es el
`ttl_expiracion` **actual**, no `now()`) y **actualizar en la misma transacción** la
fila de `FECHA_BLOQUEADA` de esa RESERVA al **mismo nuevo valor**. La operación se
serializa mediante `SELECT … FOR UPDATE` sobre la fila bloqueante (no se usan locks
distribuidos). La extensión es una **prórroga pura del TTL**: NO cambia `estado`,
`sub_estado`, `tipo_bloqueo` ni `fecha`. (Fuente: `US-006 §Happy Path`, `§Reglas de
Validación`; UC-05; `er-diagram.md §3.5, §3.6`.)

#### Scenario: Consulta en 2.b con TTL vigente extiende el bloqueo N días

- **GIVEN** una RESERVA en `estado = 'consulta'`, `sub_estado = '2b'`, con fila
  activa en `FECHA_BLOQUEADA` (`tipo_bloqueo = 'blando'`) y `ttl_expiracion = T > ahora`,
  para el tenant del gestor autenticado
- **WHEN** el gestor selecciona "Extender bloqueo", introduce `N` días (entero ≥ 1)
  y confirma
- **THEN** `RESERVA.ttl_expiracion = T + N días`
- **AND** la fila de `FECHA_BLOQUEADA` de esa RESERVA se actualiza al mismo nuevo
  `ttl_expiracion`
- **AND** `estado`, `sub_estado`, `tipo_bloqueo` y `fecha` permanecen sin cambios

#### Scenario: Extensión válida desde 2.c, 2.v y pre_reserva

- **GIVEN** una RESERVA con bloqueo blando vigente en `sub_estado = '2c'`, en
  `sub_estado = '2v'`, o en `estado = 'pre_reserva'` (con `ttl_expiracion > ahora`)
- **WHEN** el gestor extiende `N` días (entero ≥ 1)
- **THEN** se aplica la misma regla: `ttl_expiracion += N días` en RESERVA y en su
  fila de `FECHA_BLOQUEADA`, sin cambiar estado/sub_estado/tipo_bloqueo/fecha

#### Scenario: pre_reserva — la extensión prorroga el TTL de la pre-reserva

- **GIVEN** una RESERVA en `estado = 'pre_reserva'` con `ttl_expiracion` vigente y
  `FECHA_BLOQUEADA.tipo_bloqueo = 'blando'`
- **WHEN** el gestor extiende `N` días
- **THEN** el sistema actualiza `RESERVA.ttl_expiracion` y
  `FECHA_BLOQUEADA.ttl_expiracion` con las mismas reglas que en `2b`/`2c`/`2v`

### Requirement: La extensión reprograma implícitamente los recordatorios A3/A4/A5

El sistema SHALL (DEBE) garantizar que, al extender el `ttl_expiracion`, los
recordatorios automáticos (A3, y la expiración A4/A5 según el estado) queden
**reprogramados a la nueva fecha de vencimiento sin acción adicional**: los
recordatorios **no son timers exactos ni una tabla de jobs**, sino que se **derivan
del `ttl_expiracion`** y los dispara el **barrido periódico** (patrón estado-en-fila +
barrido, `architecture.md §2.5`; barrido US-012, pendiente). Al cambiar
`ttl_expiracion`, el barrido los reevalúa contra el nuevo valor: A3 (recordatorio a
día+2 desde la nueva base, si aplica al estado) y A4/A5 (al día del nuevo
vencimiento). El sistema NO introduce ni modifica un scheduler propio. (Fuente:
`US-006 §Happy Path`, `§Automatización relacionada`, `§Contexto de Negocio (D11)`;
`architecture.md §2.5`.)

#### Scenario: Tras extender el TTL, los recordatorios se evalúan contra la nueva fecha

- **GIVEN** una RESERVA con bloqueo vigente y recordatorios A3/A4/A5 derivados de
  `ttl_expiracion = T`
- **WHEN** el gestor extiende `N` días y el `ttl_expiracion` pasa a `T + N días`
- **THEN** el barrido periódico reevalúa A3/A4/A5 contra `T + N días` (no contra `T`),
  de modo que no se disparan notificaciones prematuras de expiración
- **AND** el sistema no programa ni cancela ningún job adicional (no hay scheduler)

### Requirement: Auditoría de la extensión en AUDIT_LOG con accion='actualizar'

El sistema SHALL (DEBE) registrar la extensión del TTL en `AUDIT_LOG`, en la **misma
transacción** que la mutación, con `accion = 'actualizar'`, `entidad = 'RESERVA'`,
`datos_anteriores.ttl_expiracion` = valor previo y `datos_nuevos.ttl_expiracion` =
nuevo valor, bajo el contexto RLS del tenant. (Fuente: `US-006 §Happy Path`,
`§Reglas de Validación`; `er-diagram.md §AUDIT_LOG`.)

#### Scenario: La extensión registra una entrada de auditoría actualizar

- **GIVEN** una extensión de TTL exitosa de `T` a `T + N días`
- **WHEN** el sistema registra la operación
- **THEN** existe una fila en `AUDIT_LOG` con `accion = 'actualizar'`,
  `entidad = 'RESERVA'`, `datos_anteriores.ttl_expiracion = T` y
  `datos_nuevos.ttl_expiracion = T + N días`

### Requirement: Atomicidad de las tres operaciones de la extensión

El sistema SHALL (DEBE) ejecutar las tres operaciones de la extensión —actualizar
`ttl_expiracion` de la RESERVA, actualizar `ttl_expiracion` de su fila en
`FECHA_BLOQUEADA` y escribir el `AUDIT_LOG`— en una **única transacción de BD** bajo
el contexto RLS del tenant, de modo **all-or-nothing**. Un fallo parcial DEBE
revertir toda la transacción (rollback): el sistema NO PUEDE quedar con el TTL de la
RESERVA extendido y el de `FECHA_BLOQUEADA` sin extender, ni viceversa. (Fuente:
`US-006 §Reglas de Validación`; `CLAUDE.md §Regla crítica: bloqueo atómico`.)

#### Scenario: Un fallo parcial revierte toda la extensión

- **GIVEN** una extensión de TTL en curso sobre una RESERVA con bloqueo vigente
- **WHEN** una de las tres operaciones falla antes del commit
- **THEN** la transacción hace rollback completo: `RESERVA.ttl_expiracion` y
  `FECHA_BLOQUEADA.ttl_expiracion` permanecen en su valor previo y no se registra
  ninguna entrada en `AUDIT_LOG`

### Requirement: Concurrencia — la extensión se serializa con el barrido de expiración sin estado intermedio

El sistema SHALL (DEBE) garantizar que, ante la extensión del TTL ejecutada **bajo
carga concurrente** con el barrido de expiración de TTLs (A4/A5, US-012) sobre la
misma fecha, ambas operaciones se serialicen mediante `SELECT … FOR UPDATE` sobre la
fila bloqueante de `FECHA_BLOQUEADA`, de modo que el sistema **no pueda** dejar el
bloqueo medio extendido, ni una extensión **resucitar** un bloqueo ya
expirado-y-procesado por el barrido. La garantía es determinista y reside en el motor
de PostgreSQL (no en lógica aplicativa ni locks distribuidos). Esta zona crítica se
cubre con **TDD primero** mediante tests de concurrencia reales (skill
`concurrency-locking`). (Fuente: `US-006 §concurrencia_critica`, `§Notas`;
`CLAUDE.md §Testing`, `§Regla crítica`; `architecture.md §2.4, §2.5`.)

#### Scenario: Extensión concurrente con el barrido de expiración sobre la misma fecha

- **GIVEN** una RESERVA con bloqueo blando vigente cuyo `ttl_expiracion` está a punto
  de vencer
- **WHEN** la extensión del TTL se ejecuta concurrentemente con el barrido de
  expiración (A4/A5) sobre la misma fila bloqueante
- **THEN** ambas operaciones se serializan por el lock sobre la fila bloqueante de
  `FECHA_BLOQUEADA`
- **AND** el estado final es coherente: o bien la extensión gana (TTL extendido en
  ambas tablas, bloqueo vigente) o bien el barrido ya había expirado el bloqueo y la
  extensión observa el TTL como expirado y se rechaza, sin estados intermedios
  observables

#### Scenario: Dos extensiones simultáneas sobre la misma RESERVA se serializan

- **GIVEN** una RESERVA con bloqueo vigente `ttl_expiracion = T` y dos peticiones
  simultáneas de extensión de `N1` y `N2` días
- **WHEN** ambas se procesan
- **THEN** se serializan por el lock sobre la fila bloqueante y el resultado es
  determinista (`T + N1` y luego `+ N2`, o el orden inverso), sin pérdida de
  actualizaciones ni estado intermedio observable

### Requirement: TTL ya expirado — la extensión no está permitida

El sistema SHALL (DEBE) rechazar la extensión cuando `RESERVA.ttl_expiracion < ahora`
(bloqueo ya expirado), informando de que el bloqueo ha expirado, y **no modificar** la
RESERVA ni su `FECHA_BLOQUEADA`. Una extensión **no puede "deshacer"** una expiración
ya ejecutada por el barrido (A4/A5 ya habrían transicionado la RESERVA a `2.x` o a
`reserva_cancelada`). (Fuente: `US-006 §FA TTL ya expirado`, `§Reglas de Validación`.)

#### Scenario: TTL expirado — el bloqueo ya caducó, extensión no permitida

- **GIVEN** una RESERVA con `ttl_expiracion < ahora` (el bloqueo ya expiró)
- **WHEN** el gestor intenta extender el bloqueo
- **THEN** el sistema responde con error indicando que el bloqueo ha expirado y no
  permite la extensión
- **AND** la RESERVA y su `FECHA_BLOQUEADA` no se modifican

### Requirement: Estado sin bloqueo activo extensible — la extensión no está permitida

El sistema SHALL (DEBE) rechazar la extensión cuando la RESERVA **no** tiene un
bloqueo blando activo extensible: en `sub_estado = '2a'` (sin fecha bloqueada), en un
estado terminal (`2.x`, `2.y`, `2.z`, `reserva_completada`, `reserva_cancelada`) o en
`estado = 'reserva_confirmada'` (bloqueo **firme**, `tipo_bloqueo = 'firme'`, **sin
TTL**). En `reserva_confirmada` la extensión **no aplica** porque no hay TTL que
extender. La opción "Extender bloqueo" **no aparece** en la UI para estos estados; si
la petición llega al servidor por cualquier otro medio, retorna error de validación
indicando que no hay bloqueo activo extensible, **sin mutar** nada. La precondición se
modela como **dato declarativo** ("bloqueo activo extensible" =
`sub_estado ∈ {2b,2c,2v}` O `estado = 'pre_reserva'`, no condicionales dispersos).
(Fuente: `US-006 §FA estado sin bloqueo activo`, `§Reglas de Validación`,
`§Notas de alcance`; `CLAUDE.md §Máquina de estados`.)

#### Scenario: Estado terminal o 2.a — sin bloqueo activo, extensión rechazada

- **GIVEN** una RESERVA en `sub_estado = '2a'` (sin fecha bloqueada) o en un estado
  terminal (`2x`, `2y`, `2z`, `reserva_cancelada`, `reserva_completada`)
- **WHEN** llega una petición de extensión de bloqueo sobre ella
- **THEN** el sistema retorna error de validación indicando que no hay bloqueo activo
  extensible
- **AND** la RESERVA no se modifica

#### Scenario: reserva_confirmada — bloqueo firme sin TTL, extensión no aplica

- **GIVEN** una RESERVA en `estado = 'reserva_confirmada'` con `FECHA_BLOQUEADA.tipo_bloqueo = 'firme'` (sin `ttl_expiracion`)
- **WHEN** llega una petición de extensión de bloqueo
- **THEN** el sistema la rechaza indicando que el bloqueo firme no tiene TTL que
  extender
- **AND** la `FECHA_BLOQUEADA` y la RESERVA no se modifican

### Requirement: Valor de extensión inválido — la extensión se rechaza sin efectos

El sistema SHALL (DEBE) rechazar la petición cuando el número de días de extensión es
`0`, negativo o no entero, con error de validación ("El número de días de extensión
debe ser un entero positivo (≥ 1)"), **sin modificar** ningún registro. La validación
es **defensiva en servidor** (además de la del formulario en la UI). (Fuente:
`US-006 §FA valor de extensión inválido`, `§Reglas de Validación`.)

#### Scenario: Días = 0, negativo o no entero — rechazo sin mutación

- **GIVEN** una RESERVA con bloqueo vigente
- **WHEN** el gestor envía `0`, un número negativo o un valor no entero como días de
  extensión
- **THEN** el sistema rechaza la entrada con error de validación ("El número de días
  de extensión debe ser un entero positivo (≥ 1)")
- **AND** no se modifica ningún registro (RESERVA, FECHA_BLOQUEADA ni AUDIT_LOG)
