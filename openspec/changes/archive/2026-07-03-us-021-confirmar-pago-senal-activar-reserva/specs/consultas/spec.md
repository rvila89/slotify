# Spec Delta — Capability `consultas`

> US-021 amplía la capability `consultas` con la **transición de una RESERVA en
> `pre_reserva` a `estado = 'reserva_confirmada'`** al confirmar el pago de la señal: el
> sistema **promueve el bloqueo blando de la fecha a `firme` sin TTL** (upgrade de la
> fila existente de `FECHA_BLOQUEADA`), fija `RESERVA.ttl_expiracion = NULL` y registra
> `AUDIT_LOG`, todo en una **única transacción** junto con la creación del DOCUMENTO
> justificante, el congelado de importes, la inicialización de los sub-procesos y la
> creación de la FICHA_OPERATIVA (capability `confirmacion`). Reutiliza el bloqueo atómico
> de US-040/041 (primitiva fase `reserva_confirmada`, upgrade a firme) y la máquina de
> estados declarativa de US-004/005/007/008/010/014, **sin reinventarlas**.
> Fuente: US-021, UC-17; `er-diagram.md §estados de RESERVA`, `§3.16 FECHA_BLOQUEADA mapa
> canónico`, `§chk_firme_sin_ttl`; `CLAUDE.md §Regla crítica: bloqueo atómico`,
> `§Máquina de estados`.

## ADDED Requirements

### Requirement: Transición pre_reserva → reserva_confirmada al confirmar el pago de la señal

El sistema SHALL (DEBE), al confirmar el pago de la señal sobre una RESERVA **existente**
en `estado = 'pre_reserva'`, transicionar la RESERVA a `estado = 'reserva_confirmada'` y
fijar `ttl_expiracion = NULL` (la reserva confirmada no expira por TTL). La guarda de
origen se modela en la **máquina de estados declarativa** (no condicionales dispersos):
solo `pre_reserva → reserva_confirmada` es transición permitida para esta operación. Una
RESERVA en cualquier otro estado —`reserva_confirmada` o posterior, cualquier sub-estado
de `consulta` (`2a`/`2b`/`2c`/`2d`/`2v`/terminales) o `reserva_cancelada`— DEBE
rechazarse con el mensaje **"La reserva no está en estado pre_reserva"** sin crear ningún
DOCUMENTO, sin mutar la RESERVA ni la `FECHA_BLOQUEADA` y sin registrar transición en
`AUDIT_LOG`. La validación del estado de origen es **síncrona y previa** a cualquier
acción. (Fuente: `US-021 §Happy Path`, `§Reglas de negocio`, `§Reserva no está en
pre_reserva`, `§Reglas de Validación`; UC-17; `er-diagram.md §estados de RESERVA`;
`CLAUDE.md §Máquina de estados`.)

#### Scenario: Confirmar desde pre_reserva eleva la RESERVA a reserva_confirmada

- **GIVEN** una RESERVA en `estado = 'pre_reserva'` con `importe_total = 3.000,00 €`,
  `ttl_expiracion` vigente y `FECHA_BLOQUEADA` blando activo para su `fecha_evento`
- **WHEN** el gestor sube un justificante válido y confirma el pago de la señal
- **THEN** la RESERVA pasa a `estado = 'reserva_confirmada'` y `ttl_expiracion = NULL`

#### Scenario: Guarda de origen — confirmar sobre una reserva no en pre_reserva se rechaza sin efectos

- **GIVEN** una RESERVA en `estado = 'reserva_confirmada'` (ya confirmada) o en cualquier
  sub-estado de `consulta`
- **WHEN** llega una petición de "Confirmar pago de señal"
- **THEN** el sistema la rechaza con el mensaje "La reserva no está en estado pre_reserva"
- **AND** no se crea DOCUMENTO, no se modifica la RESERVA ni su `FECHA_BLOQUEADA` y no se
  registra ninguna transición en `AUDIT_LOG`

### Requirement: Upgrade del bloqueo blando a firme sin TTL al confirmar (fase reserva_confirmada)

El sistema SHALL (DEBE), en la **misma transacción** que la transición a
`reserva_confirmada`, **promover** la fila existente de `FECHA_BLOQUEADA` para
`(tenant_id, fecha_evento)` a `tipo_bloqueo = 'firme'` y `ttl_expiracion = NULL`,
mediante un **UPDATE** del registro existente (nunca `DELETE + INSERT`) y **sin alterar
`reserva_id`**, reutilizando la primitiva atómica de US-040 (`bloquearFecha(fase =
'reserva_confirmada')`). La operación usa `SELECT … FOR UPDATE` sobre la fila y respeta
`UNIQUE(tenant_id, fecha)` y los constraints `chk_firme_sin_ttl`/`chk_blando_con_ttl` (no
se usan locks distribuidos). Tras el upgrade, el bloqueo es **firme y sin TTL**: la fecha
queda definitivamente asegurada y ya no es candidata al barrido de expiración (D4).
(Fuente: `US-021 §Historia`, `§Happy Path`, `§Reglas de negocio` atomicidad,
`§Impacto de Negocio` D4; `er-diagram.md §3.16` mapa canónico `reserva_confirmada →
firme/NULL/upgrade`, `§upgrade blando→firme`; capability `bloqueo-fecha`; `CLAUDE.md
§Regla crítica`.)

#### Scenario: El bloqueo pasa de blando a firme sin TTL al confirmar

- **GIVEN** una RESERVA en `pre_reserva` con su fila de `FECHA_BLOQUEADA` en
  `tipo_bloqueo = 'blando'` y `ttl_expiracion` vigente para `(tenant_id, 15/09/2026)`
- **WHEN** el gestor confirma el pago de la señal
- **THEN** en la misma transacción la fila se actualiza a `tipo_bloqueo = 'firme'` y
  `ttl_expiracion = NULL`, conservando su `reserva_id`
- **AND** no se crea una segunda fila para esa `(tenant_id, fecha)`

#### Scenario: El upgrade se ejecuta como UPDATE de la fila existente, no delete+insert

- **GIVEN** una RESERVA en `pre_reserva` con bloqueo blando activo
- **WHEN** se ejecuta el upgrade a firme al confirmar
- **THEN** la fila de `FECHA_BLOQUEADA` conserva su identidad y su `reserva_id`, cambiando
  solo `tipo_bloqueo` a `'firme'` y `ttl_expiracion` a `NULL`

### Requirement: Atomicidad all-or-nothing de la confirmación de reserva

El sistema SHALL (DEBE) ejecutar en una **única transacción de BD** bajo el contexto RLS
del tenant, de modo **all-or-nothing**: la creación del DOCUMENTO justificante y de la
FICHA_OPERATIVA (capability `confirmacion`), la mutación de la RESERVA (`estado =
'reserva_confirmada'`, `ttl_expiracion = NULL`, inicialización de los tres sub-procesos y
congelado de importes), el upgrade a firme de su `FECHA_BLOQUEADA` y el registro de
`AUDIT_LOG`. Un fallo parcial DEBE revertir toda la transacción (rollback): el sistema NO
PUEDE quedar en un estado intermedio observable (p. ej. `reserva_confirmada` con bloqueo
todavía blando, o con la FICHA_OPERATIVA sin crear, o con los importes sin congelar). El
registro en `AUDIT_LOG` DEBE incluir `accion = 'transicion'`, `entidad = 'RESERVA'`,
`datos_anteriores.estado = 'pre_reserva'` y `datos_nuevos.estado = 'reserva_confirmada'`,
con el usuario del Gestor. La presentación de la factura de señal en borrador (US-022) es
un efecto **posterior al commit**; su falta o fallo no revierte la confirmación. (Fuente:
`US-021 §Happy Path`, `§Reglas de negocio` transición atómica, `§Reglas de Validación`;
UC-17; `CLAUDE.md §Regla crítica`.)

#### Scenario: La auditoría registra la transición pre_reserva → reserva_confirmada

- **GIVEN** una confirmación de señal exitosa desde `pre_reserva`
- **WHEN** el sistema completa la operación
- **THEN** existe una fila en `AUDIT_LOG` con `accion = 'transicion'`, `entidad =
  'RESERVA'`, `datos_anteriores.estado = 'pre_reserva'` y `datos_nuevos.estado =
  'reserva_confirmada'`

#### Scenario: Un fallo parcial revierte toda la confirmación

- **GIVEN** una confirmación de señal en curso desde `pre_reserva`
- **WHEN** una de las operaciones (DOCUMENTO, RESERVA, `FECHA_BLOQUEADA`, FICHA_OPERATIVA
  o `AUDIT_LOG`) falla antes del commit
- **THEN** la transacción hace rollback completo: no existe DOCUMENTO justificante, la
  RESERVA permanece en `pre_reserva`, la `FECHA_BLOQUEADA` sigue en `blando` con su TTL y
  no se crea FICHA_OPERATIVA

### Requirement: Concurrencia anti-doble-reserva (D4) al confirmar la señal

El sistema SHALL (DEBE) garantizar que, ante dos confirmaciones concurrentes de la
**misma RESERVA** en `pre_reserva` (doble clic del gestor o dos sesiones), la
serialización por `SELECT … FOR UPDATE` sobre la fila de `FECHA_BLOQUEADA(tenant_id,
fecha)` haga que **exactamente una** transacción adquiera el lock y complete el upgrade a
firme + la transición; la segunda, al obtener el lock, DEBE observar que la RESERVA ya
está en `reserva_confirmada` y devolver el error **"La reserva ya ha sido confirmada"**
sin crear un segundo DOCUMENTO, sin duplicar FICHA_OPERATIVA y sin registrar una segunda
transición. Cuando la confirmación afecta a una `(tenant_id, fecha)` cuya fila ya está en
bloqueo **firme vinculado a otra RESERVA distinta**, la transacción DEBE fallar por la
violación de `UNIQUE(tenant_id, fecha)` (`P2002`) **antes** de mutar el estado de la
segunda RESERVA, devolviendo **"Fecha no disponible"**; **nunca** se produce doble reserva
confirmada. La garantía es determinista y reside en el motor de PostgreSQL (no en lógica
aplicativa ni locks distribuidos). Esta zona crítica se cubre con **TDD primero** mediante
tests de concurrencia reales (skill `concurrency-locking`). (Fuente: `US-021 §Concurrencia
/ Race Conditions`, `§Double-click / confirmación simultánea`, `§Confirmación concurrente
sobre fecha ya en bloqueo firme`; `er-diagram.md §chk_firme_sin_ttl`, `§upgrade
blando→firme`; `CLAUDE.md §Testing`, `§Regla crítica`.)

#### Scenario: Doble clic sobre la misma reserva confirma una sola vez

- **GIVEN** una RESERVA en `pre_reserva` y dos confirmaciones simultáneas de la señal
  (doble clic o dos sesiones), ambas intentando actualizar la misma fila de
  `FECHA_BLOQUEADA(tenant_id, fecha)`
- **WHEN** ambas transacciones ejecutan `SELECT … FOR UPDATE` sobre esa fila
- **THEN** exactamente una adquiere el lock y completa el upgrade a firme + la transición a
  `reserva_confirmada`
- **AND** la segunda, tras obtener el lock, observa que la RESERVA ya está en
  `reserva_confirmada` y devuelve "La reserva ya ha sido confirmada", sin crear un segundo
  DOCUMENTO ni una segunda FICHA_OPERATIVA

#### Scenario: Confirmar sobre una fecha ya en firme de otra reserva devuelve "Fecha no disponible"

- **GIVEN** que `FECHA_BLOQUEADA(tenant_id, 15/09/2026)` ya está en `tipo_bloqueo =
  'firme'` vinculada a una RESERVA distinta (escenario de fallo de integridad)
- **WHEN** se intenta confirmar una segunda RESERVA para la misma `(tenant_id, fecha)`
- **THEN** la transacción falla con la violación de `UNIQUE(tenant_id, fecha)` (`P2002`)
  antes de mutar el estado de la segunda RESERVA
- **AND** el gestor recibe el error "Fecha no disponible" y no se produce doble reserva
  confirmada
