# Spec Delta — Capability `consultas`

> US-009 amplía la capability `consultas` con la **transición de salida de "visita
> programada" (`2.v`) a "consulta con fecha" (`2.b`)** cuando el Gestor registra el
> resultado de visita "cliente interesado": el sistema fija `visita_realizada = true`,
> devuelve la RESERVA a `2.b` con un **TTL fresco** (`now + TENANT_SETTINGS.ttl_consulta_dias`),
> actualiza el `ttl_expiracion` de la fila existente de `FECHA_BLOQUEADA` al mismo valor
> (manteniendo `tipo_bloqueo = 'blando'`) y registra `AUDIT_LOG`, todo en una **única
> transacción**. El disparo del email E7 y su registro en `COMUNICACION` se especifican en
> el delta de la capability `comunicaciones`. Reutiliza el bloqueo atómico de US-040/041
> (primitiva `fase '2.b'`, UPDATE del TTL sobre la fila bloqueante) y la máquina de estados
> declarativa de US-004/005/007/008, **sin reinventarlos**.
> Fuente: US-009, UC-08; E7; A21 (US-012); `er-diagram.md §3.6, §RESERVA, §TENANT_SETTINGS`.

## ADDED Requirements

### Requirement: Transición 2.v → 2.b registra "cliente interesado" y marca la visita como realizada

El sistema SHALL (DEBE), cuando el Gestor registra el resultado de visita **"cliente
interesado"** sobre una RESERVA **existente** en `estado = 'consulta'` y `sub_estado = '2v'`,
transicionar la RESERVA a `sub_estado = '2b'`, fijar `visita_realizada = true` y recalcular
`ttl_expiracion = now + TENANT_SETTINGS.ttl_consulta_dias`. El TTL DEBE ser **fresco**:
calculado desde el instante de la transición (`now`), **no** acumulado sobre el
`ttl_expiracion` anterior ni derivado de `visita_programada_fecha`. El setting
`ttl_consulta_dias` (default 3) DEBE leerse de `TENANT_SETTINGS`, **nunca hardcodeado**. La
guarda de origen se modela en la **máquina de estados declarativa** (no condicionales
dispersos): solo `{consulta, 2v} → {consulta, 2b}` es una transición permitida para esta
operación. (Fuente: `US-009 §Happy Path`, `§Reglas de negocio`, `§Reglas de Validación`;
UC-08; `er-diagram.md §RESERVA, §TENANT_SETTINGS`; `CLAUDE.md §Máquina de estados`.)

#### Scenario: Consulta en 2.v con "cliente interesado" vuelve a 2.b con TTL fresco

- **GIVEN** una RESERVA existente en `estado = 'consulta'`, `sub_estado = '2v'`, con
  `visita_programada_fecha` definida y `visita_realizada = false`, para el tenant del gestor
  autenticado, y `TENANT_SETTINGS.ttl_consulta_dias = 3`
- **WHEN** el gestor selecciona "Registrar resultado de visita" → "Cliente interesado" y confirma
- **THEN** la RESERVA pasa a `sub_estado = '2b'`, con `visita_realizada = true` y
  `ttl_expiracion = now + 3 días`

#### Scenario: El TTL es fresco desde now, no acumulado ni derivado de la fecha de visita

- **GIVEN** una RESERVA en `2v` cuyo `ttl_expiracion` actual = día posterior a la visita
  (fijado por US-008) y `visita_programada_fecha` en el futuro
- **WHEN** el gestor registra "cliente interesado"
- **THEN** `ttl_expiracion = now + ttl_consulta_dias` (recalculado desde el instante de la
  transición), independiente del `ttl_expiracion` previo y de `visita_programada_fecha`

### Requirement: El bloqueo de fecha actualiza su TTL al mismo valor fresco y conserva tipo_bloqueo blando

El sistema SHALL (DEBE), en la **misma transacción** que la transición `2v → 2b`, actualizar
(**UPDATE**, no INSERT ni DELETE) el `ttl_expiracion` de la fila **existente** de
`FECHA_BLOQUEADA` cuyo `reserva_id` = esta RESERVA, fijándolo al **mismo valor** que
`RESERVA.ttl_expiracion` (`now + ttl_consulta_dias`). El `tipo_bloqueo` DEBE **permanecer**
`'blando'` (no se promociona ni degrada). La operación reutiliza la primitiva atómica de
US-040 (`resolverPlanBloqueo({ fase: '2.b' })`, patrón `now + ttl_consulta_dias`) y usa
`SELECT … FOR UPDATE` sobre la fila bloqueante (no se usan locks distribuidos). Dado que la
RESERVA proviene de `2.v`, la fila de `FECHA_BLOQUEADA` **siempre existe**: no hay rama de
INSERT en esta transición. (Fuente: `US-009 §Happy Path`, `§Reglas de negocio`;
`er-diagram.md §3.6` `fase '2.b'`; `CLAUDE.md §Regla crítica: bloqueo atómico`.)

#### Scenario: La fila de FECHA_BLOQUEADA se actualiza al mismo TTL que la RESERVA

- **GIVEN** una RESERVA en `2v` con una fila activa en `FECHA_BLOQUEADA` (`tipo_bloqueo='blando'`,
  `ttl_expiracion` = día post-visita)
- **WHEN** el gestor registra "cliente interesado"
- **THEN** la fila de `FECHA_BLOQUEADA` actualiza `ttl_expiracion = RESERVA.ttl_expiracion`
  (`now + ttl_consulta_dias`)
- **AND** `tipo_bloqueo` permanece `'blando'` y no se crea ni elimina ninguna fila para esa
  `(tenant_id, fecha)`

### Requirement: Guarda de origen — el registro del resultado "interesado" solo es válido desde 2.v

El sistema SHALL (DEBE) validar en el servidor, **antes** de cualquier mutación, que la
RESERVA está en `sub_estado = '2v'`. Si la RESERVA está en cualquier otro sub-estado
(`2a`, `2b`, `2c`, `2d`) o en un sub-estado terminal (`2x`, `2y`, `2z`) o estado terminal
(`reserva_cancelada`, `reserva_completada`, `pre_reserva`, `reserva_confirmada`, …), el
sistema DEBE **rechazar** la acción con error de validación **sin modificar** la RESERVA ni
su `FECHA_BLOQUEADA`. Los estados terminales son inmutables. La opción "Cliente interesado"
DEBE estar visible en la UI **solo** en `2.v`; la validación es también **defensiva en
servidor**. (Fuente: `US-009 §FA RESERVA no en 2.v — transición inválida`, `§FA RESERVA en
estado terminal`, `§Reglas de Validación`; UC-08.)

#### Scenario: RESERVA no en 2.v — transición inválida sin efectos

- **GIVEN** una RESERVA en `sub_estado ∈ {2a, 2b, 2c, 2d}` (no en `2v`)
- **WHEN** el gestor intenta registrar "cliente interesado"
- **THEN** el sistema responde con error de validación
- **AND** la RESERVA no se modifica

#### Scenario: Estado terminal — registro de resultado rechazado sin efectos

- **GIVEN** una RESERVA en un sub-estado o estado terminal (`2x`, `2y`, `2z`,
  `reserva_cancelada` o `reserva_completada`)
- **WHEN** el gestor intenta registrar el resultado de visita
- **THEN** el sistema la rechaza sin mutar nada (los terminales son inmutables)

### Requirement: El registro del resultado no depende de que haya llegado la fecha de visita

El sistema SHALL (DEBE) permitir el registro del resultado "cliente interesado" **aunque**
`visita_programada_fecha > hoy` (la visita aún no ha llegado en el calendario):
`visita_programada_fecha` es **informativa**, no una precondición estricta de validación de
la transición. El TTL fresco se calcula desde `now` (`now + ttl_consulta_dias`), **no** desde
`visita_programada_fecha`. La fecha de visita sigue usándose para el TTL del bloqueo de la
fase `2.v` (US-008) y para los recordatorios A19/A20, pero no bloquea el registro del
resultado. (Fuente: `US-009 §FA Gestor registra resultado antes de la fecha de visita`,
`§Reglas de Validación`.)

#### Scenario: Registro antes de la fecha de visita — la transición procede normalmente

- **GIVEN** una RESERVA en `2v` con `visita_programada_fecha = hoy + 2 días` (aún no llegada)
- **WHEN** el gestor registra "cliente interesado"
- **THEN** el sistema ejecuta la transición a `2b` con `visita_realizada = true` y
  `ttl_expiracion = now + ttl_consulta_dias` (calculado desde `now`, no desde
  `visita_programada_fecha`)

### Requirement: Atomicidad de la transición 2.v → 2.b (RESERVA + FECHA_BLOQUEADA + AUDIT_LOG)

El sistema SHALL (DEBE) ejecutar la mutación de la RESERVA (`sub_estado = '2b'`,
`visita_realizada = true`, `ttl_expiracion = now + ttl_consulta_dias`), el UPDATE del
`ttl_expiracion` de su fila en `FECHA_BLOQUEADA` (al mismo valor) y el registro en `AUDIT_LOG`
en una **única transacción de BD** bajo el contexto RLS del tenant, de modo **all-or-nothing**.
Un fallo parcial DEBE revertir toda la transacción (rollback): el sistema NO PUEDE quedar en
un estado intermedio observable (p. ej. `sub_estado = '2b'` sin la fila de `FECHA_BLOQUEADA`
actualizada, o viceversa). El registro en `AUDIT_LOG` DEBE incluir `accion = 'transicion'`,
`entidad = 'RESERVA'`, `datos_anteriores.sub_estado = '2v'`,
`datos_anteriores.visita_realizada = false`, `datos_nuevos.sub_estado = '2b'` y
`datos_nuevos.visita_realizada = true`. (Fuente: `US-009 §Happy Path`, `§Reglas de negocio`,
`§Reglas de Validación`; `CLAUDE.md §Regla crítica`.)

#### Scenario: La auditoría registra la transición 2.v → 2.b con los datos antes/después

- **GIVEN** una transición exitosa de `2v` a `2b` por resultado "cliente interesado"
- **WHEN** el sistema registra la operación
- **THEN** existe una fila en `AUDIT_LOG` con `accion = 'transicion'`, `entidad = 'RESERVA'`,
  `datos_anteriores.sub_estado = '2v'`, `datos_anteriores.visita_realizada = false`,
  `datos_nuevos.sub_estado = '2b'` y `datos_nuevos.visita_realizada = true`

#### Scenario: Un fallo parcial revierte toda la transición 2.v → 2.b

- **GIVEN** una transición `2v → 2b` en curso
- **WHEN** una de las operaciones (RESERVA, `FECHA_BLOQUEADA` o `AUDIT_LOG`) falla antes del
  commit
- **THEN** la transacción hace rollback completo: la RESERVA permanece en `2v` con
  `visita_realizada = false` y su `ttl_expiracion` previo, y la fila de `FECHA_BLOQUEADA` no
  se modifica

### Requirement: Concurrencia — la transición 2.v → 2.b se serializa con el barrido de TTLs (A21/US-012) commit-first, sin estado intermedio

El sistema SHALL (DEBE) garantizar que, ante la transición `2v → 2b` ejecutada **bajo carga
concurrente** con el barrido periódico de expiración de TTLs (A21 / US-012) sobre la misma
RESERVA, ambas operaciones se serialicen mediante `SELECT … FOR UPDATE` sobre la fila
bloqueante de `FECHA_BLOQUEADA`, de modo que la transacción que **commitea primero gane** y el
sistema **no pueda quedar** en un estado donde `sub_estado = '2b'` sin `FECHA_BLOQUEADA`
actualizada, ni viceversa. Si el barrido US-012 commitea primero (el TTL de `2.v` = día
post-visita ha vencido), la RESERVA pasa a `2x` y el registro del resultado **falla
controladamente** por la guarda de origen (ya no está en `2.v`). Si el registro del resultado
commitea primero, US-012 **no encuentra** la RESERVA candidata en `2.v` (ahora está en `2.b`
con TTL fresco) y **no actúa** sobre ella. La garantía es determinista y reside en el motor de
PostgreSQL (no en lógica aplicativa ni locks distribuidos). Esta zona crítica se cubre con
**TDD primero** mediante tests de concurrencia reales (skill `concurrency-locking`). (Fuente:
`US-009 §Concurrencia / Race Conditions`; `CLAUDE.md §Testing`, `§Regla crítica`; `design.md
§D-3`.)

#### Scenario: Registro de resultado concurrente con el barrido A21 sobre la misma RESERVA

- **GIVEN** una RESERVA en `2v` cuyo `ttl_expiracion` (día post-visita) acaba de vencer y el
  barrido A21/US-012 intenta expirarla al tiempo que el gestor registra "cliente interesado"
- **WHEN** ambas operaciones se ejecutan concurrentemente
- **THEN** se serializan por el lock sobre la fila bloqueante de `FECHA_BLOQUEADA`
- **AND** el estado final es coherente: o bien la RESERVA queda en `2b` con `FECHA_BLOQUEADA`
  actualizada al TTL fresco y el barrido no la expira (su TTL ya es futuro), o bien el barrido
  la expira a `2x` y el registro del resultado recibe la guarda de origen (rechazo); **nunca**
  un estado intermedio observable (`2b` sin `FECHA_BLOQUEADA` actualizada)

#### Scenario: Dos registros simultáneos de resultado sobre la misma RESERVA aplican una sola vez

- **GIVEN** una RESERVA en `2v` y dos peticiones simultáneas de "cliente interesado"
- **WHEN** ambas se procesan
- **THEN** exactamente una aplica la transición (`2b` + `visita_realizada=true` + TTL fresco +
  UPDATE de `FECHA_BLOQUEADA`)
- **AND** la otra observa que la RESERVA ya no está en `2v` y recibe la guarda de origen, sin
  doble actualización del bloqueo
