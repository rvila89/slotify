# Spec Delta — Capability `consultas`

> US-007 amplía la capability `consultas` con la **transición de una consulta con
> fecha bloqueada (`2.b`) a "pendiente de número de invitados" (`2.c`)**: el Gestor
> marca un lead maduro como pendiente de aforo; el sistema **extiende el bloqueo de la
> fecha** (RESERVA + `FECHA_BLOQUEADA`) y **vacía atómicamente la cola de espera**
> (`2.d → 2.y`, mecánica A16) en una **única transacción**. Reutiliza el bloqueo
> atómico de US-040/041 (primitiva `fase '2.c' → extend`), el modelo de cola de
> US-004/005 (`posicion_cola`/`consulta_bloqueante_id`) y la máquina de estados
> declarativa, **sin reinventarlos**.
> Fuente: US-007, UC-06; A16; A4; `er-diagram.md §3.4, §3.16, §7.3`.

## ADDED Requirements

### Requirement: Transición 2.b → 2.c marca la consulta como pendiente de invitados y extiende el bloqueo

El sistema SHALL (DEBE), cuando el Gestor marca como "pendiente de número de
invitados" una RESERVA **existente** en `estado = 'consulta'` y `sub_estado = '2b'`
que tiene una **fila activa en `FECHA_BLOQUEADA`** y `ttl_expiracion > ahora`
(bloqueo vigente), **transicionar** la RESERVA a `sub_estado = '2c'` y fijar
`ttl_expiracion = ttl_expiracion_actual + TENANT_SETTINGS.ttl_consulta_dias`
(extensión de +3 días por defecto, **derivada del setting, nunca hardcodeada**), y
**actualizar en la misma transacción** la fila de `FECHA_BLOQUEADA` de esa RESERVA al
mismo nuevo `ttl_expiracion`. La extensión reutiliza la primitiva atómica de US-040
(`resolverPlanBloqueo({ fase: '2.c' }) → extend`) sobre la fila bloqueante mediante
`SELECT … FOR UPDATE` (no se usan locks distribuidos). El sistema **reprograma el TTL
de expiración** (A4) reutilizando la liberación de US-041. (Fuente: `US-007 §Happy
Path — sin cola`, `§Reglas de Validación`; UC-06; `er-diagram.md §3.16`.)

#### Scenario: Consulta en 2.b sin cola se marca pendiente de invitados y extiende el TTL

- **GIVEN** una RESERVA existente en `estado = 'consulta'`, `sub_estado = '2b'`, con
  fila activa en `FECHA_BLOQUEADA` y `ttl_expiracion > ahora`, para el tenant del
  gestor autenticado
- **AND** ninguna RESERVA con `consulta_bloqueante_id = id de esta RESERVA` en
  `sub_estado = '2d'`
- **WHEN** el gestor selecciona "Marcar como pendiente de invitados" y confirma
- **THEN** la RESERVA pasa a `sub_estado = '2c'` y fija
  `ttl_expiracion = ttl_expiracion_actual + ttl_consulta_dias`
- **AND** la fila de `FECHA_BLOQUEADA` de esa RESERVA se actualiza al mismo nuevo
  `ttl_expiracion`
- **AND** la mutación de la RESERVA y la actualización de `FECHA_BLOQUEADA` ocurren en
  una única transacción (all-or-nothing)

#### Scenario: La extensión del TTL se deriva de TENANT_SETTINGS, no hardcodeada

- **GIVEN** `TENANT_SETTINGS.ttl_consulta_dias = 5` y una RESERVA en `2b` con
  `ttl_expiracion = T`
- **WHEN** el sistema transiciona la RESERVA a `2.c`
- **THEN** `ttl_expiracion = T + 5 días` tanto en la RESERVA como en `FECHA_BLOQUEADA`

### Requirement: Vaciado atómico de la cola de espera al transicionar a 2.c (mecánica A16)

El sistema SHALL (DEBE), en la **misma transacción** que la transición `2.b → 2.c`,
actualizar todas las RESERVA con `consulta_bloqueante_id = id de la RESERVA que
transiciona` y `sub_estado = '2d'` para que pasen a `sub_estado = '2y'` (consulta
descartada por cola, **estado terminal**), con `posicion_cola = NULL` y
`consulta_bloqueante_id = NULL`. El vaciado es **irreversible** (`2.y` es terminal) y
se serializa por el `SELECT … FOR UPDATE` sobre la fila bloqueante de
`FECHA_BLOQUEADA`. Los **emails automáticos** a los clientes de la cola (A16) son **📐
solo diseñados en MVP y NO se envían**; solo se implementa la **mecánica** del
vaciado, visible para el gestor en la UI de cola (UC-11). (Fuente: `US-007 §Happy Path
— con cola`, `§Reglas de negocio`, `§Notas de alcance`; A16; `er-diagram.md §7.3`.)

#### Scenario: Transición a 2.c vacía la cola y pasa las consultas en 2.d a 2.y

- **GIVEN** una RESERVA en `2b` que es `consulta_bloqueante` de N RESERVA en
  `sub_estado = '2d'` (con `consulta_bloqueante_id = id de esta RESERVA`)
- **WHEN** el gestor transiciona la RESERVA a `2.c`
- **THEN** en la misma transacción todas esas N RESERVA pasan a `sub_estado = '2y'`,
  con `posicion_cola = NULL` y `consulta_bloqueante_id = NULL`
- **AND** no se envían emails automáticos a los clientes de la cola en MVP

#### Scenario: La auditoría registra la transición principal y cada consulta descartada

- **GIVEN** una transición `2.b → 2.c` que vacía una cola de N consultas
- **WHEN** el sistema registra la operación
- **THEN** existe una fila en `AUDIT_LOG` con `accion = 'transicion'`,
  `entidad = 'RESERVA'`, `datos_anteriores.sub_estado = '2b'`,
  `datos_nuevos.sub_estado = '2c'` y `datos_nuevos.ttl_expiracion` = nuevo valor para
  la RESERVA principal
- **AND** se registra una entrada de auditoría por cada RESERVA descartada
  (`sub_estado '2d' → '2y'`)

#### Scenario: Cola vacía — la transición se completa igualmente sin error

- **GIVEN** una RESERVA en `2b` sin ninguna RESERVA en `2d` con
  `consulta_bloqueante_id` apuntándola
- **WHEN** el gestor transiciona la RESERVA a `2.c`
- **THEN** la transición se completa correctamente (`sub_estado = '2c'`, TTL extendido
  en RESERVA y `FECHA_BLOQUEADA`)
- **AND** el vaciado de cola afecta a 0 filas y no altera ningún otro registro

### Requirement: Atomicidad de las cuatro operaciones de la transición a 2.c

El sistema SHALL (DEBE) ejecutar las cuatro operaciones de la transición a `2.c`
—actualizar `sub_estado` de la RESERVA, extender su `ttl_expiracion`, extender el
`ttl_expiracion` de su fila en `FECHA_BLOQUEADA` y vaciar la cola (`2.d → 2.y`)— en
una **única transacción de BD** bajo el contexto RLS del tenant, de modo
**all-or-nothing**. Un fallo parcial DEBE revertir toda la transacción (rollback): el
sistema NO PUEDE quedar en un estado intermedio observable (p. ej. `sub_estado = '2c'`
con la cola sin vaciar, o la cola vaciada sin la extensión del TTL). (Fuente: `US-007
§Reglas de negocio`, `§Concurrencia`, `§Reglas de Validación`; `CLAUDE.md §Regla
crítica: bloqueo atómico`.)

#### Scenario: Un fallo parcial revierte toda la transición

- **GIVEN** una transición `2.b → 2.c` con cola activa en curso
- **WHEN** una de las cuatro operaciones falla antes del commit
- **THEN** la transacción hace rollback completo: la RESERVA permanece en `2.b`, el
  TTL de RESERVA y `FECHA_BLOQUEADA` sin extender y la cola intacta en `2.d`

### Requirement: Concurrencia — la transición a 2.c y el vaciado de cola se serializan sin estado intermedio (D13/D4)

El sistema SHALL (DEBE) garantizar que, ante la transición a `2.c` ejecutada **bajo
carga concurrente** con otra operación sobre la cola o el bloqueo de la misma fecha
(por ejemplo una promoción o salida de cola UC-12/UC-13, o una segunda transición),
todas las operaciones se completen dentro de una única transacción serializada por
`SELECT … FOR UPDATE` sobre la fila bloqueante de `FECHA_BLOQUEADA`, de modo que el
sistema **no pueda quedar** en un estado donde `sub_estado = '2c'` pero la cola no se
haya vaciado, o viceversa. La garantía es determinista y reside en el motor de
PostgreSQL (no en lógica aplicativa ni locks distribuidos). Esta zona crítica se cubre
con **TDD primero** mediante tests de concurrencia reales (skill
`concurrency-locking`). (Fuente: `US-007 §Concurrencia / Race Conditions`;
`CLAUDE.md §Testing`, `§Regla crítica`; `design.md §D-5b`.)

#### Scenario: Transición a 2.c concurrente con operación de cola sobre la misma fecha

- **GIVEN** una RESERVA en `2b` bloqueante de varias consultas en `2d` para una fecha
- **WHEN** la transición a `2.c` se ejecuta concurrentemente con otra operación sobre
  la cola o el bloqueo de esa misma fecha
- **THEN** ambas operaciones se serializan por el lock sobre la fila bloqueante de
  `FECHA_BLOQUEADA`
- **AND** el estado final es coherente: la RESERVA en `2.c` con TTL extendido en
  RESERVA y `FECHA_BLOQUEADA`, y **0** consultas en `2.d` apuntando a esta RESERVA
  (todas en `2.y`), sin estados intermedios observables

#### Scenario: Dos transiciones simultáneas a 2.c sobre la misma RESERVA aplican una sola vez

- **GIVEN** una RESERVA en `2b` y dos peticiones simultáneas de transición a `2.c`
- **WHEN** ambas se procesan
- **THEN** exactamente una aplica la transición (`2c` + TTL extendido + cola vaciada)
- **AND** la otra observa que la RESERVA ya no está en `2b` y recibe la guarda de
  origen, sin doble extensión de TTL ni doble vaciado de cola

### Requirement: Guarda de origen — la transición a 2.c solo es válida desde sub_estado 2.b

El sistema SHALL (DEBE) validar en el servidor, **antes** de cualquier mutación, que
la RESERVA destino de la transición está en `sub_estado = '2b'`. Si la RESERVA está en
cualquier otro sub-estado/estado —incluidos `2.a`, `2.c`, `2.v`, los terminales
`2.x`, `2.y`, `2.z`, o `reserva_cancelada`/`reserva_completada` (inmutables)— el
sistema DEBE rechazar la petición con error de validación y **no modificar** la
RESERVA, ni su `FECHA_BLOQUEADA`, ni ninguna RESERVA de cola. La guarda se modela en
la **máquina de estados declarativa** (no condicionales dispersos): solo `{consulta,
2b} → {consulta, 2c}` es transición permitida para esta operación. (Fuente: `US-007
§FA Estado terminal`, `§Reglas de Validación`; `CLAUDE.md §Máquina de estados`.)

#### Scenario: Transición sobre una RESERVA que no está en 2.b se rechaza sin efectos

- **GIVEN** una RESERVA en `sub_estado = '2a'`, `'2c'`, `'2v'` o un estado terminal
- **WHEN** llega una petición para marcarla como "pendiente de invitados" (transición
  2.b → 2.c)
- **THEN** el sistema retorna un error de validación indicando que la transición solo
  es válida desde `sub_estado = '2b'`
- **AND** la RESERVA no se modifica, ni su `FECHA_BLOQUEADA`, ni ninguna consulta de
  cola

#### Scenario: Estados terminales no pueden ser origen de la transición a 2.c

- **GIVEN** una RESERVA en un estado terminal (`2x`, `2y`, `2z`, `reserva_cancelada` o
  `reserva_completada`)
- **WHEN** llega una petición de transición a `2.c` sobre ella
- **THEN** el sistema la rechaza con error de validación sin mutar nada (los
  terminales son inmutables)

### Requirement: Precondición de bloqueo — la transición a 2.c exige fecha bloqueada vigente

El sistema SHALL (DEBE) rechazar la transición a `2.c` cuando la RESERVA **no** tiene
una fila activa en `FECHA_BLOQUEADA` para `(tenant_id, fecha_evento)`, o cuando su
`ttl_expiracion < ahora` (bloqueo expirado). En ambos casos el sistema informa del
motivo (sin fecha bloqueada / bloqueo expirado) y **no modifica** la RESERVA ni
ningún registro relacionado. La UI puede deshabilitar la acción "Marcar como pendiente
de invitados" cuando no hay bloqueo activo; la validación es también **defensiva en
servidor**. (Fuente: `US-007 §FA-01`, `§FA TTL expirado`, `§Reglas de Validación`;
UC-06 FA-01.)

#### Scenario: RESERVA sin fecha bloqueada — transición no permitida (FA-01)

- **GIVEN** una RESERVA sin fila activa en `FECHA_BLOQUEADA` (p. ej. un `2.a` sin
  bloqueo)
- **WHEN** el gestor intenta marcarla como "pendiente de invitados"
- **THEN** el sistema responde con error indicando que la transición a `2.c` requiere
  una fecha bloqueada activa
- **AND** la RESERVA permanece sin ningún cambio

#### Scenario: TTL expirado — el bloqueo ya caducó, transición no permitida

- **GIVEN** una RESERVA en `2b` con `ttl_expiracion < ahora` (el bloqueo ya expiró)
- **WHEN** el gestor intenta la transición a `2.c`
- **THEN** el sistema informa de que el bloqueo ha expirado y no permite la transición
- **AND** la RESERVA no se modifica

### Requirement: El email de solicitud de número de invitados (UC-06 paso 7) queda fuera de alcance en MVP

El sistema SHALL NOT (NO DEBE), en este change, enviar el email al cliente solicitando
el número de invitados que UC-06 paso 7 describe: §9.3 **no le asigna un código `E`
(E1–E8)** y la regla del proyecto prohíbe referenciar emails fuera de ese catálogo. Este email se
documenta como **gap de spec** pendiente de decisión del product owner (catalogar un
nuevo E-code o gestionarlo manualmente desde el log de comunicaciones en MVP). La
**mecánica** de la transición (estado, TTL, vaciado de cola, auditoría) es completa y
entregable sin este email. (Fuente: `US-007 §Email relacionado`, `§Notas de alcance`;
`design.md §D-7`.)

#### Scenario: La transición a 2.c no dispara ningún email no catalogado

- **GIVEN** una transición `2.b → 2.c` exitosa
- **WHEN** el sistema completa la operación
- **THEN** no se envía ningún email fuera del catálogo §9.3 (E1–E8)
- **AND** el email de solicitud de invitados de UC-06 paso 7 queda registrado como gap
  de spec, sin envío automático en MVP
