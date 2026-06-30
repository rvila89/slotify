# Spec Delta — Capability `consultas`

> US-008 amplía la capability `consultas` con la **transición de una consulta activa
> (`2.a`/`2.b`/`2.c`) a "visita programada" (`2.v`)**: el Gestor programa una visita
> presencial; el sistema fija los campos de visita en la RESERVA, **bloquea la fecha del
> evento hasta el día posterior a la visita** (`FECHA_BLOQUEADA` con
> `ttl_expiracion = visita_programada_fecha + 1 día 23:59:59`, insert-o-update según
> origen) y registra `AUDIT_LOG`, todo en una **única transacción**. El disparo del email
> E6 y su registro en `COMUNICACION` se especifican en el delta de la capability
> `comunicaciones`. Reutiliza el bloqueo atómico de US-040/041 (primitiva `fase '2.v'`) y
> la máquina de estados declarativa de US-004/005/007, **sin reinventarlos**.
> Fuente: US-008, UC-07; A18; A4 (US-012); `er-diagram.md §3.16, §RESERVA, §TENANT_SETTINGS`.

## ADDED Requirements

### Requirement: Transición {2a,2b,2c} → 2.v programa la visita y fija los campos de visita en la RESERVA

El sistema SHALL (DEBE), cuando el Gestor programa una visita sobre una RESERVA
**existente** en `estado = 'consulta'` y `sub_estado ∈ {'2a','2b','2c'}`, transicionar la
RESERVA a `sub_estado = '2v'` y fijar `visita_programada_fecha = fecha_visita`,
`visita_programada_hora = hora_visita` y `visita_realizada = false`. El campo
`visita_realizada` DEBE inicializarse a `false` y permanecer así hasta que el gestor
registre el resultado de la visita (US-009/US-010/US-011). La guarda de origen se modela
en la **máquina de estados declarativa** (no condicionales dispersos): solo
`{consulta, 2a|2b|2c} → {consulta, 2v}` son transiciones permitidas para esta operación.
(Fuente: `US-008 §Happy Path — 2.a/2.b/2.c`, `§Reglas de negocio`, `§Reglas de Validación`;
UC-07; `er-diagram.md §RESERVA`; `CLAUDE.md §Máquina de estados`.)

#### Scenario: Consulta en 2.b se programa para visita y queda en 2.v

- **GIVEN** una RESERVA existente en `estado = 'consulta'`, `sub_estado = '2b'`, con
  `ttl_expiracion > ahora` y `fecha_evento` definida, para el tenant del gestor autenticado
- **WHEN** el gestor selecciona "Programar visita", introduce `fecha_visita = hoy + 3 días`
  y una hora, y confirma
- **THEN** la RESERVA pasa a `sub_estado = '2v'`, con `visita_programada_fecha = hoy + 3 días`,
  `visita_programada_hora` = hora introducida y `visita_realizada = false`

#### Scenario: visita_realizada se inicializa a false y no cambia en la transición

- **GIVEN** una transición exitosa a `2.v` desde `2.a`, `2.b` o `2.c`
- **WHEN** el sistema completa la operación
- **THEN** `visita_realizada = false` en la RESERVA
- **AND** ningún otro paso de esta US modifica `visita_realizada` (su cambio corresponde a
  US-009/US-010/US-011)

### Requirement: El bloqueo de fecha se crea o actualiza hasta el día posterior a la visita (fase 2.v)

El sistema SHALL (DEBE), en la **misma transacción** que la transición a `2.v`, fijar el
bloqueo de `FECHA_BLOQUEADA` para `(tenant_id, fecha_evento)` con
`ttl_expiracion = visita_programada_fecha + 1 día (23:59:59)` y `tipo_bloqueo = 'blando'`,
reutilizando la primitiva atómica de US-040 (`resolverPlanBloqueo({ fase: '2.v' })`). Si la
RESERVA venía de `2.b`/`2.c` (ya tenía fila activa en `FECHA_BLOQUEADA`), el sistema DEBE
**actualizar** el `ttl_expiracion` de la fila existente (no crear una nueva). Si venía de
`2.a` sin bloqueo, el sistema DEBE **crear** una nueva fila con `tipo_bloqueo = 'blando'`.
El TTL deriva de la **fecha de la visita** (no de `ttl_consulta_dias`). La operación usa
`SELECT … FOR UPDATE` / `UNIQUE(tenant_id, fecha)` (no se usan locks distribuidos).
(Fuente: `US-008 §Happy Path — 2.a/2.b/2.c`, `§Reglas de negocio`; `er-diagram.md §3.16`
`fase '2.v'`; `CLAUDE.md §Regla crítica: bloqueo atómico`.)

#### Scenario: Desde 2.b — se actualiza el ttl_expiracion de la fila existente

- **GIVEN** una RESERVA en `2b` con fila activa en `FECHA_BLOQUEADA` para su `fecha_evento`
- **WHEN** el gestor programa la visita para `fecha_visita`
- **THEN** la fila existente de `FECHA_BLOQUEADA` se actualiza a
  `ttl_expiracion = fecha_visita + 1 día (23:59:59)`; `tipo_bloqueo` permanece `'blando'`
- **AND** no se crea una segunda fila para esa `(tenant_id, fecha)`

#### Scenario: Desde 2.a sin bloqueo — se crea una nueva fila blanda

- **GIVEN** una RESERVA en `2a` con `fecha_evento` definida y **sin** fila en `FECHA_BLOQUEADA`
- **WHEN** el gestor programa la visita para `fecha_visita = hoy + 2 días`
- **THEN** se crea una nueva fila en `FECHA_BLOQUEADA` con `tipo_bloqueo = 'blando'` y
  `ttl_expiracion = fecha_visita + 1 día (23:59:59)`

#### Scenario: Desde 2.c — el bloqueo previo se extiende al día post-visita

- **GIVEN** una RESERVA en `2c` con bloqueo activo en `FECHA_BLOQUEADA`
- **WHEN** el gestor programa la visita dentro de la ventana permitida
- **THEN** el sistema transiciona a `2v` y actualiza la fila de `FECHA_BLOQUEADA` con
  `ttl_expiracion = fecha_visita + 1 día (23:59:59)` (el bloqueo previo de `2.c` se
  extiende, no se duplica)

### Requirement: La fecha de visita debe ser futura y dentro de la ventana max_dias_programar_visita

El sistema SHALL (DEBE) validar, **antes** de cualquier mutación, que
`fecha_visita ∈ [hoy + 1 día, hoy + TENANT_SETTINGS.max_dias_programar_visita]` (ventana
por defecto de 7 días, **derivada del setting, nunca hardcodeada**). Si `fecha_visita ≤ hoy`,
el sistema DEBE rechazar con error "La fecha de visita debe ser un día futuro". Si
`fecha_visita > hoy + max_dias_programar_visita`, el sistema DEBE rechazar con error "La
visita debe programarse dentro de los próximos {N} días". En ambos casos la RESERVA **no se
modifica**. La UI limita el selector de fecha a la ventana; la validación es también
**defensiva en servidor**. (Fuente: `US-008 §FA Fecha superior al límite`, `§FA Fecha igual
a hoy o pasado`, `§Reglas de Validación`; `er-diagram.md §TENANT_SETTINGS`.)

#### Scenario: Fecha de visita en el pasado o igual a hoy se rechaza

- **GIVEN** una RESERVA en `2a`/`2b`/`2c` válida para programar visita
- **WHEN** el gestor introduce `fecha_visita ≤ hoy` y confirma
- **THEN** el sistema responde con error de validación "La fecha de visita debe ser un día
  futuro"
- **AND** la RESERVA no se modifica

#### Scenario: Fecha de visita más allá de la ventana configurada se rechaza

- **GIVEN** `TENANT_SETTINGS.max_dias_programar_visita = 7` y una RESERVA válida
- **WHEN** el gestor introduce `fecha_visita = hoy + 10 días` y confirma
- **THEN** el sistema responde con error de validación "La visita debe programarse dentro
  de los próximos 7 días"
- **AND** la RESERVA no se modifica

### Requirement: Guarda de origen — la transición a 2.v solo es válida desde 2.a, 2.b o 2.c

El sistema SHALL (DEBE) validar en el servidor, **antes** de cualquier mutación, que la
RESERVA está en `sub_estado ∈ {'2a','2b','2c'}`. Una RESERVA en cola (`sub_estado = '2d'`)
NO PUEDE transicionar directamente a `2.v`: el sistema DEBE rechazar con un mensaje
específico indicando que la consulta debe ser promovida primero (UC-12). Una RESERVA en
sub-estado terminal (`2.x`, `2.y`, `2.z`) o estado terminal (`reserva_cancelada`,
`reserva_completada`) DEBE rechazarse (los terminales son inmutables). En todos estos casos
el sistema **no modifica** la RESERVA ni su `FECHA_BLOQUEADA`. La acción "Programar visita"
DEBE estar deshabilitada/oculta en la UI para `2.d` y terminales; la validación es también
**defensiva en servidor**. (Fuente: `US-008 §FA-01`, `§FA Estado terminal`, `§Reglas de
Validación`; UC-07 FA-01.)

#### Scenario: Consulta en cola (2.d) — transición no permitida (FA-01)

- **GIVEN** una RESERVA en `sub_estado = '2d'` (en cola)
- **WHEN** el gestor intenta programar una visita
- **THEN** el sistema responde con error "No es posible programar una visita para una
  consulta en cola. La consulta debe ser promovida primero (UC-12)"
- **AND** la RESERVA no se modifica

#### Scenario: Estado terminal — transición a 2.v rechazada sin efectos

- **GIVEN** una RESERVA en un estado terminal (`2x`, `2y`, `2z`, `reserva_cancelada` o
  `reserva_completada`)
- **WHEN** el gestor intenta programar una visita
- **THEN** el sistema la rechaza con error de validación sin mutar nada (los terminales son
  inmutables)

### Requirement: Programar visita desde 2.a exige fecha_evento definida

El sistema SHALL (DEBE), cuando el origen de la transición a `2.v` es `sub_estado = '2a'`,
exigir que `fecha_evento` esté definida (NOT NULL) en la RESERVA **antes** de programar la
visita. Si `fecha_evento` es NULL, el sistema DEBE informar de que debe introducirse primero
la fecha del evento y **no** ejecutar la transición; la acción de visita queda bloqueada
hasta que `fecha_evento` esté definida. Para orígenes `2.b`/`2.c` la fecha del evento ya
está fijada por definición. (Fuente: `US-008 §FA RESERVA en 2.a sin fecha_evento`,
`§Reglas de Validación`; UC-07.)

#### Scenario: RESERVA en 2.a sin fecha_evento — la acción de visita queda bloqueada

- **GIVEN** una RESERVA en `sub_estado = '2a'` con `fecha_evento` = NULL
- **WHEN** el gestor intenta programar la visita
- **THEN** el sistema informa de que debe introducirse primero la fecha del evento
- **AND** la transición no se ejecuta y la RESERVA no se modifica

### Requirement: Atomicidad de la transición a 2.v (RESERVA + FECHA_BLOQUEADA + AUDIT_LOG)

El sistema SHALL (DEBE) ejecutar la mutación de la RESERVA (`sub_estado` + campos de visita),
el insert-o-update de su fila en `FECHA_BLOQUEADA` (TTL = visita +1 día) y el registro en
`AUDIT_LOG` en una **única transacción de BD** bajo el contexto RLS del tenant, de modo
**all-or-nothing**. Un fallo parcial DEBE revertir toda la transacción (rollback): el sistema
NO PUEDE quedar en un estado intermedio observable (p. ej. `sub_estado = '2v'` sin la fila
de `FECHA_BLOQUEADA` actualizada/creada, o viceversa). El registro en `AUDIT_LOG` DEBE
incluir `accion = 'transicion'`, `entidad = 'RESERVA'`, `datos_anteriores.sub_estado` (origen),
`datos_nuevos.sub_estado = '2v'` y `datos_nuevos.visita_programada_fecha`. (Fuente: `US-008
§Happy Path`, `§Reglas de negocio`, `§Reglas de Validación`; `CLAUDE.md §Regla crítica`.)

#### Scenario: La auditoría registra la transición a 2.v

- **GIVEN** una transición exitosa de `2.b` a `2.v`
- **WHEN** el sistema registra la operación
- **THEN** existe una fila en `AUDIT_LOG` con `accion = 'transicion'`, `entidad = 'RESERVA'`,
  `datos_anteriores.sub_estado = '2b'`, `datos_nuevos.sub_estado = '2v'` y
  `datos_nuevos.visita_programada_fecha` = la fecha introducida

#### Scenario: Un fallo parcial revierte toda la transición a 2.v

- **GIVEN** una transición a `2.v` en curso
- **WHEN** una de las operaciones (RESERVA, `FECHA_BLOQUEADA` o `AUDIT_LOG`) falla antes del
  commit
- **THEN** la transacción hace rollback completo: la RESERVA permanece en su sub-estado
  origen, sin campos de visita y sin `FECHA_BLOQUEADA` creada/actualizada

### Requirement: Concurrencia — la transición a 2.v se serializa con el barrido de TTLs (A4/US-012) sin estado intermedio

El sistema SHALL (DEBE) garantizar que, ante la transición a `2.v` ejecutada **bajo carga
concurrente** con el barrido periódico de expiración de TTLs (A4 / US-012) o con otra
operación sobre el bloqueo de la misma fecha, todas las operaciones se serialicen mediante
`SELECT … FOR UPDATE` sobre la fila bloqueante de `FECHA_BLOQUEADA` (y `UNIQUE(tenant_id,
fecha)` en el caso del INSERT desde `2.a`), de modo que la transacción que commitea primero
tenga éxito y el sistema **no pueda quedar** en un estado donde `sub_estado = '2v'` sin
`FECHA_BLOQUEADA` actualizada, ni viceversa. La garantía es determinista y reside en el motor
de PostgreSQL (no en lógica aplicativa ni locks distribuidos). Esta zona crítica se cubre con
**TDD primero** mediante tests de concurrencia reales (skill `concurrency-locking`). (Fuente:
`US-008 §Concurrencia / Race Conditions`; `CLAUDE.md §Testing`, `§Regla crítica`; `design.md
§D-9`.)

#### Scenario: Transición a 2.v concurrente con el barrido A4 sobre la misma RESERVA

- **GIVEN** una RESERVA en `2b`/`2c` cuyo `ttl_expiracion` acaba de vencer y el barrido A4
  intenta expirarla al tiempo que el gestor la transiciona a `2.v`
- **WHEN** ambas operaciones se ejecutan concurrentemente
- **THEN** se serializan por el lock sobre la fila bloqueante de `FECHA_BLOQUEADA`
- **AND** el estado final es coherente: o bien la RESERVA queda en `2.v` con
  `FECHA_BLOQUEADA` actualizada a la fecha post-visita, o bien el barrido la expira a su
  terminal y la transición a `2.v` recibe la guarda de origen (rechazo); nunca un estado
  intermedio observable

#### Scenario: Dos transiciones simultáneas a 2.v sobre la misma RESERVA aplican una sola vez

- **GIVEN** una RESERVA en `2a`/`2b`/`2c` y dos peticiones simultáneas de transición a `2.v`
- **WHEN** ambas se procesan
- **THEN** exactamente una aplica la transición (`2v` + campos de visita + `FECHA_BLOQUEADA`)
- **AND** la otra observa que la RESERVA ya no está en `{2a,2b,2c}` y recibe la guarda de
  origen, sin doble creación/actualización del bloqueo
