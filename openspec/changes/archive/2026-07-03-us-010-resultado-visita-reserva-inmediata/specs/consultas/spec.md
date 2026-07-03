# Spec Delta — Capability `consultas`

> US-010 amplía la capability `consultas` con la **transición de salida de "visita
> programada" (`2.v`) directamente a `pre_reserva`** cuando el Gestor registra el
> resultado de visita "reserva inmediata": el sistema valida los **datos obligatorios
> UC-14**, fija `visita_realizada = true`, pasa la RESERVA a `estado = 'pre_reserva'` con
> `sub_estado = NULL` y `ttl_expiracion = now + TENANT_SETTINGS.ttl_prereserva_dias` (7
> días), actualiza el `ttl_expiracion` de la fila existente de `FECHA_BLOQUEADA` al mismo
> valor (manteniendo `tipo_bloqueo = 'blando'`), **vacía atómicamente la cola A16** y
> registra `AUDIT_LOG`, todo en una **única transacción**. US-010 **no dispara ningún
> email** (E2 se delega a UC-14). Reutiliza el bloqueo atómico de US-040/041 (fase
> `pre_reserva`, UPDATE del TTL), el motor atómico y el vaciado de cola A16 de UC-14, la
> validación de datos obligatorios UC-14 (`CampoFiscalFaltante`) y la máquina de estados
> declarativa, **sin reinventarlos**.
> Fuente: US-010, UC-08 FA-08, UC-14; A16; `er-diagram.md §3.6, §RESERVA, §TENANT_SETTINGS,
> §CLIENTE`.

## ADDED Requirements

### Requirement: Transición 2.v → pre_reserva registra "reserva inmediata" y marca la visita como realizada

El sistema SHALL (DEBE), cuando el Gestor registra el resultado de visita **"reserva
inmediata"** sobre una RESERVA **existente** en `estado = 'consulta'` y `sub_estado = '2v'`
con los **datos obligatorios completos** (ver requisito de validación), transicionar la
RESERVA a `estado = 'pre_reserva'` con `sub_estado = NULL` (pre_reserva no tiene sub-estado
de consulta), fijar `visita_realizada = true` y recalcular `ttl_expiracion = now +
TENANT_SETTINGS.ttl_prereserva_dias`. El TTL DEBE ser **fresco**: calculado desde el
instante de la transición (`now`), **no** acumulado sobre el `ttl_expiracion` anterior ni
derivado de `visita_programada_fecha`. El setting `ttl_prereserva_dias` (default 7) DEBE
leerse de `TENANT_SETTINGS`, **nunca hardcodeado** ni confundido con `ttl_consulta_dias`. La
guarda de origen se modela en la **máquina de estados declarativa** (no condicionales
dispersos): solo `{consulta, 2v} → {pre_reserva, NULL}` es una transición permitida para
esta operación. (Fuente: `US-010 §Happy Path`, `§Reglas de negocio`, `§Reglas de
Validación`; UC-08 FA-08; UC-14; `er-diagram.md §RESERVA, §TENANT_SETTINGS`; `CLAUDE.md
§Máquina de estados`.)

#### Scenario: Consulta en 2.v con "reserva inmediata" y datos completos pasa a pre_reserva con TTL de 7 días

- **GIVEN** una RESERVA existente en `estado = 'consulta'`, `sub_estado = '2v'`, con
  `visita_programada_fecha` definida, `visita_realizada = false` y todos los datos
  obligatorios completos en RESERVA (`fecha_evento`, `duracion_horas`, `tipo_evento`,
  `num_adultos_ninos_mayores4`) y CLIENTE (`dni_nif`, `direccion`, `codigo_postal`,
  `poblacion`, `provincia`), para el tenant del gestor autenticado, y
  `TENANT_SETTINGS.ttl_prereserva_dias = 7`
- **WHEN** el gestor selecciona "Registrar resultado de visita" → "Cliente quiere reservar
  ahora" y confirma
- **THEN** la RESERVA pasa a `estado = 'pre_reserva'`, `sub_estado = NULL`, con
  `visita_realizada = true` y `ttl_expiracion = now + 7 días`

#### Scenario: El TTL usa ttl_prereserva_dias, no ttl_consulta_dias, calculado desde now

- **GIVEN** una RESERVA en `2v` cuyo `ttl_expiracion` actual = día posterior a la visita
  (fijado por US-008) y `TENANT_SETTINGS.ttl_prereserva_dias = 7` distinto de
  `ttl_consulta_dias`
- **WHEN** el gestor registra "reserva inmediata"
- **THEN** `ttl_expiracion = now + ttl_prereserva_dias` (7 días, leído de `TENANT_SETTINGS`),
  independiente del `ttl_expiracion` previo y de `visita_programada_fecha`, y **no** se usa
  `ttl_consulta_dias`

### Requirement: La transición a pre_reserva exige datos obligatorios completos (validación UC-14)

El sistema SHALL (DEBE) validar, **antes** de cualquier mutación, que la RESERVA y su
CLIENTE tienen los **datos obligatorios completos** requeridos por UC-14: en RESERVA
(`fecha_evento`, `duracion_horas`, `tipo_evento`, `num_adultos_ninos_mayores4`) y datos
fiscales del CLIENTE (`dni_nif`, `direccion`, `codigo_postal`, `poblacion`, `provincia`). Si
falta cualquiera de ellos, el sistema DEBE **bloquear la transición** devolviendo la lista de
**campos faltantes** y la RESERVA DEBE **permanecer en `sub_estado = '2v'` sin ningún
cambio** (ni `estado`, ni `ttl_expiracion`, ni `FECHA_BLOQUEADA`, ni cola). Es la misma
validación que UC-14 FA-01 y reutiliza su enumeración de campos faltantes. El formulario del
frontend puede permitir completar los datos en el mismo paso antes de reintentar. (Fuente:
`US-010 §FA Datos obligatorios incompletos — transición bloqueada`, `§Reglas de
Validación`; UC-14 FA-01.)

#### Scenario: Falta un dato obligatorio del CLIENTE — transición bloqueada sin efectos

- **GIVEN** una RESERVA en `2v` con `dni_nif` del CLIENTE ausente (resto de datos completos)
- **WHEN** el gestor intenta la transición a `pre_reserva`
- **THEN** el sistema rechaza la transición e informa de los campos faltantes (incluye
  `dni_nif`)
- **AND** la RESERVA permanece en `estado = 'consulta'`, `sub_estado = '2v'` sin cambios, y
  ni la fila de `FECHA_BLOQUEADA` ni la cola se modifican

#### Scenario: Falta un dato obligatorio de la RESERVA — transición bloqueada sin efectos

- **GIVEN** una RESERVA en `2v` con `tipo_evento` ausente (resto de datos completos)
- **WHEN** el gestor intenta la transición a `pre_reserva`
- **THEN** el sistema rechaza la transición e informa de los campos faltantes (incluye
  `tipo_evento`)
- **AND** la RESERVA permanece en `2v` sin cambios

### Requirement: El bloqueo de fecha actualiza su TTL a 7 días (fase pre_reserva) y conserva tipo_bloqueo blando

El sistema SHALL (DEBE), en la **misma transacción** que la transición `2v → pre_reserva`,
actualizar (**UPDATE**, no INSERT ni DELETE) el `ttl_expiracion` de la fila **existente** de
`FECHA_BLOQUEADA` cuyo `reserva_id` = esta RESERVA, fijándolo al **mismo valor** que
`RESERVA.ttl_expiracion` (`now + ttl_prereserva_dias`, 7 días). El `tipo_bloqueo` DEBE
**permanecer** `'blando'` (no se promociona a firme; la señal de reserva es posterior,
UC-15). La operación reutiliza la primitiva atómica de US-040 (fase `pre_reserva`, patrón
`now + ttl_prereserva_dias`) y usa `SELECT … FOR UPDATE` sobre la fila bloqueante (no se usan
locks distribuidos). Dado que la RESERVA proviene de `2.v`, la fila de `FECHA_BLOQUEADA`
**siempre existe**: no hay rama de INSERT en esta transición. (Fuente: `US-010 §Happy Path`,
`§Reglas de negocio`; UC-14 fase `pre_reserva`; `er-diagram.md §3.6`; `CLAUDE.md §Regla
crítica: bloqueo atómico`.)

#### Scenario: La fila de FECHA_BLOQUEADA se actualiza al mismo TTL de 7 días que la RESERVA

- **GIVEN** una RESERVA en `2v` con una fila activa en `FECHA_BLOQUEADA` (`tipo_bloqueo =
  'blando'`, `ttl_expiracion` = día post-visita)
- **WHEN** el gestor registra "reserva inmediata" con datos completos
- **THEN** la fila de `FECHA_BLOQUEADA` actualiza `ttl_expiracion = RESERVA.ttl_expiracion`
  (`now + ttl_prereserva_dias`, 7 días)
- **AND** `tipo_bloqueo` permanece `'blando'` y no se crea ni elimina ninguna fila para esa
  `(tenant_id, fecha)`

### Requirement: Vaciado atómico de la cola de espera al transicionar a pre_reserva (mecánica A16)

El sistema SHALL (DEBE), en la **misma transacción** que la transición `2v → pre_reserva`,
vaciar la cola de espera de la fecha: todas las RESERVA con `consulta_bloqueante_id` = esta
RESERVA y `sub_estado = '2d'` DEBEN pasar a `sub_estado = '2y'`, `posicion_cola = NULL` y
`consulta_bloqueante_id = NULL`. La operación DEBE ser válida **aunque haya 0 consultas en
cola** (operación vacía, 0 filas afectadas, sin error). El vaciado se serializa con `SELECT …
FOR UPDATE` sobre la fila bloqueante y es la misma mecánica A16 de US-007 (`2.c`) y de UC-14.
El sistema DEBE registrar en `AUDIT_LOG` un `accion = 'transicion'` por cada consulta
vaciada. **No** se envía ningún email a las consultas de la cola (emails de cola solo
diseñados en MVP). (Fuente: `US-010 §Happy Path con cola activa`, `§FA Cola vacía —
transición igualmente válida`, `§Reglas de Validación`; UC-14 A16; US-007.)

#### Scenario: Con cola activa, todas las consultas en 2.d pasan a 2.y atómicamente

- **GIVEN** una RESERVA en `2v` que es `consulta_bloqueante` de N consultas en `sub_estado =
  '2d'` (con `consulta_bloqueante_id` = id de esta reserva) y datos obligatorios completos
- **WHEN** el gestor transiciona a `pre_reserva`
- **THEN** en la misma transacción atómica, todas las RESERVA con `consulta_bloqueante_id` =
  esta reserva y `sub_estado = '2d'` pasan a `sub_estado = '2y'`, `posicion_cola = NULL` y
  `consulta_bloqueante_id = NULL`
- **AND** no queda ninguna RESERVA en `sub_estado = '2d'` con `consulta_bloqueante_id`
  apuntando a la reserva transitada, y el `AUDIT_LOG` registra cada consulta vaciada

#### Scenario: Cola vacía — la transición procede sin error

- **GIVEN** una RESERVA en `2v` sin consultas en `2.d` apuntando a ella y datos completos
- **WHEN** el gestor transiciona a `pre_reserva`
- **THEN** la transición se completa correctamente; el vaciado de cola es una operación vacía
  (0 filas afectadas) y no genera error

### Requirement: Guarda de origen — el registro del resultado "reserva inmediata" solo es válido desde 2.v

El sistema SHALL (DEBE) validar en el servidor, **antes** de cualquier mutación, que la
RESERVA está en `sub_estado = '2v'`. Si la RESERVA está en cualquier otro sub-estado (`2a`,
`2b`, `2c`, `2d`) o en un sub-estado terminal (`2x`, `2y`, `2z`) o estado no aplicable
(`pre_reserva`, `reserva_confirmada`, `reserva_cancelada`, `reserva_completada`,
`evento_en_curso`, `post_evento`), el sistema DEBE **rechazar** la acción con error de
validación **sin modificar** la RESERVA, su `FECHA_BLOQUEADA` ni la cola. Los estados
terminales y ya avanzados son inmutables para esta operación. La opción "Cliente quiere
reservar ahora" DEBE estar visible en la UI **solo** en `2.v`; la validación es también
**defensiva en servidor**. (Fuente: `US-010 §FA RESERVA no en 2.v`, `§Reglas de
Validación`; UC-08.)

#### Scenario: RESERVA no en 2.v — transición inválida sin efectos

- **GIVEN** una RESERVA en `sub_estado ∈ {2a, 2b, 2c, 2d}` (no en `2v`)
- **WHEN** el gestor intenta registrar "reserva inmediata"
- **THEN** el sistema responde con error de validación
- **AND** la RESERVA no se modifica

#### Scenario: Estado terminal o ya avanzado — registro rechazado sin efectos

- **GIVEN** una RESERVA en un sub-estado o estado terminal (`2x`, `2y`, `2z`,
  `reserva_cancelada`, `reserva_completada`) o ya en `pre_reserva`/`reserva_confirmada`
- **WHEN** el gestor intenta registrar "reserva inmediata"
- **THEN** el sistema la rechaza sin mutar nada (los estados terminales y avanzados son
  inmutables para esta operación)

### Requirement: Atomicidad de la transición 2.v → pre_reserva (RESERVA + FECHA_BLOQUEADA + cola + AUDIT_LOG)

El sistema SHALL (DEBE) ejecutar la mutación de la RESERVA (`estado = 'pre_reserva'`,
`sub_estado = NULL`, `visita_realizada = true`, `ttl_expiracion = now + ttl_prereserva_dias`),
el UPDATE del `ttl_expiracion` de su fila en `FECHA_BLOQUEADA` (al mismo valor), el vaciado
de la cola A16 (`2.d → 2.y`) y el registro en `AUDIT_LOG` en una **única transacción de BD**
bajo el contexto RLS del tenant, de modo **all-or-nothing**. Un fallo parcial DEBE revertir
toda la transacción (rollback): el sistema NO PUEDE quedar en un estado intermedio observable
(p. ej. `pre_reserva` sin la fila de `FECHA_BLOQUEADA` actualizada, o con la cola
parcialmente vaciada). El registro en `AUDIT_LOG` de la RESERVA principal DEBE incluir
`accion = 'transicion'`, `entidad = 'RESERVA'`, `datos_anteriores.sub_estado = '2v'`,
`datos_nuevos.estado = 'pre_reserva'`, `datos_nuevos.sub_estado = NULL` y
`datos_nuevos.visita_realizada = true`. (Fuente: `US-010 §Happy Path`, `§Reglas de negocio`,
`§Reglas de Validación`; `CLAUDE.md §Regla crítica`.)

#### Scenario: La auditoría registra la transición 2.v → pre_reserva con los datos antes/después

- **GIVEN** una transición exitosa de `2v` a `pre_reserva` por resultado "reserva inmediata"
- **WHEN** el sistema registra la operación
- **THEN** existe una fila en `AUDIT_LOG` con `accion = 'transicion'`, `entidad = 'RESERVA'`,
  `datos_anteriores.sub_estado = '2v'`, `datos_nuevos.estado = 'pre_reserva'`,
  `datos_nuevos.sub_estado = NULL` y `datos_nuevos.visita_realizada = true`

#### Scenario: Un fallo parcial revierte toda la transición 2.v → pre_reserva

- **GIVEN** una transición `2v → pre_reserva` en curso (RESERVA + FECHA_BLOQUEADA + cola +
  AUDIT_LOG)
- **WHEN** una de las operaciones falla antes del commit
- **THEN** la transacción hace rollback completo: la RESERVA permanece en `estado =
  'consulta'`, `sub_estado = '2v'` con `visita_realizada = false` y su `ttl_expiracion`
  previo, la fila de `FECHA_BLOQUEADA` no se modifica y ninguna consulta de la cola cambia
  de sub-estado

### Requirement: Concurrencia — la transición 2.v → pre_reserva es atómica frente a doble bloqueo (D4) y a mutaciones de la cola

El sistema SHALL (DEBE) garantizar que la transición `2v → pre_reserva` (que muta RESERVA +
actualiza `FECHA_BLOQUEADA` + vacía la cola en una transacción) se serialice con operaciones
concurrentes mediante `SELECT … FOR UPDATE` sobre la fila bloqueante de `FECHA_BLOQUEADA` y
el `UNIQUE(tenant_id, fecha)` del motor. Si otra transacción concurrente intenta **insertar**
un nuevo bloqueo para la misma `(tenant_id, fecha_evento)` (un nuevo lead solicitando la
misma fecha), la restricción `UNIQUE(tenant_id, fecha)` garantiza que solo una fila puede
existir para esa combinación: la insertadora recibe violación de unicidad — **no puede haber
doble bloqueo** (D4). Si otra transacción concurrente intenta modificar el `posicion_cola` de
una consulta en `2.d` de esa misma cola, el bloqueo de fila (`FOR UPDATE`) garantiza que el
vaciado y la modificación concurrente **no** producen un estado inconsistente: una de las dos
espera o falla controladamente. La garantía es determinista y reside en el motor de
PostgreSQL (no en lógica aplicativa ni locks distribuidos). Esta zona crítica se cubre con
**TDD primero** mediante tests de concurrencia reales (skill `concurrency-locking`). (Fuente:
`US-010 §Concurrencia / Race Conditions`; `CLAUDE.md §Testing`, `§Regla crítica`; `design.md
§D-3, §D-5`.)

#### Scenario: Doble bloqueo de la misma fecha (D4) — solo una fila sobrevive

- **GIVEN** una RESERVA en `2v` en transición a `pre_reserva` sobre `(tenant_id,
  fecha_evento)` y otra transacción concurrente que intenta insertar un bloqueo nuevo para la
  misma `(tenant_id, fecha_evento)`
- **WHEN** ambas se ejecutan concurrentemente
- **THEN** la restricción `UNIQUE(tenant_id, fecha)` permite una sola fila para esa
  combinación; la transacción que intenta insertar el segundo bloqueo recibe violación de
  unicidad y revierte — no hay doble bloqueo

#### Scenario: Vaciado de cola concurrente con mutación de posicion_cola — sin estado inconsistente

- **GIVEN** una RESERVA en `2v` con cola activa en transición a `pre_reserva`, y otra
  transacción concurrente que intenta modificar el `posicion_cola` de una consulta en `2.d`
  de esa misma cola
- **WHEN** ambas se ejecutan concurrentemente
- **THEN** el `SELECT … FOR UPDATE` sobre la fila bloqueante serializa ambas: una espera o
  falla controladamente
- **AND** el estado final es coherente: ninguna RESERVA queda en `sub_estado = '2d'` con
  `consulta_bloqueante_id` apuntando a una RESERVA ya en `pre_reserva`
