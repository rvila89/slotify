# Spec Delta — Capability `consultas`

> US-014 amplía la capability `consultas` con la **transición de una consulta activa
> (`2.a`/`2.b`/`2.c`/`2.v`) a `estado = 'pre_reserva'`** al confirmar el presupuesto: el
> sistema eleva el bloqueo de la fecha a **7 días** (`FECHA_BLOQUEADA` con
> `ttl_expiracion = now() + TENANT_SETTINGS.ttl_prereserva_dias`, **insert-o-update** según
> origen), **vacía la cola de espera** (A16: `2.d → 2.y`) y registra `AUDIT_LOG`, todo en
> una **única transacción** junto con la creación del PRESUPUESTO (capability
> `presupuestos`). El envío del email E2 con el PDF se especifica en el delta de la
> capability `comunicaciones`. Reutiliza el bloqueo atómico de US-040/041 (primitiva fase
> `pre_reserva`), la máquina de estados declarativa de US-004/005/007/008 y la mecánica de
> vaciado de cola A16 de US-007, **sin reinventarlas**.
> Fuente: US-014, UC-14; A16; `er-diagram.md §3.16, §RESERVA, §TENANT_SETTINGS §3.11`;
> `CLAUDE.md §Regla crítica: bloqueo atómico`, `§Máquina de estados`.

## ADDED Requirements

### Requirement: Transición {2a,2b,2c,2v} → pre_reserva al confirmar el presupuesto

El sistema SHALL (DEBE), al confirmar el borrador del presupuesto sobre una RESERVA
**existente** en `estado = 'consulta'` y `sub_estado ∈ {'2a','2b','2c','2v'}`, transicionar
la RESERVA a `estado = 'pre_reserva'` y fijar `ttl_expiracion = now() +
TENANT_SETTINGS.ttl_prereserva_dias` (7 días por defecto, **derivado del setting, nunca
hardcodeado**). La guarda de origen se modela en la **máquina de estados declarativa** (no
condicionales dispersos): solo `{consulta, 2a|2b|2c|2v} → {pre_reserva}` son transiciones
permitidas para esta operación; una RESERVA en `2.d` (cola), en un sub-estado terminal
(`2.x`/`2.y`/`2.z`) o ya en `pre_reserva`/posterior DEBE rechazarse sin mutar nada. (Fuente:
`US-014 §Happy Path`, `§Reglas de negocio`, `§Reglas de Validación`, `§Consulta en
sub-estado terminal`; UC-14; `er-diagram.md §RESERVA, §TENANT_SETTINGS`; `CLAUDE.md
§Máquina de estados`.)

#### Scenario: Confirmar desde 2.b eleva la RESERVA a pre_reserva con TTL de 7 días

- **GIVEN** una RESERVA en `estado = 'consulta'`, `sub_estado = '2b'` (bloqueo blando activo
  3 días), con datos completos y CLIENTE con datos fiscales, para el tenant del gestor
- **WHEN** el gestor confirma el borrador del presupuesto
- **THEN** la RESERVA pasa a `estado = 'pre_reserva'` y
  `ttl_expiracion = now() + ttl_prereserva_dias`

#### Scenario: El TTL de la pre-reserva se deriva de TENANT_SETTINGS, no hardcodeado

- **GIVEN** `TENANT_SETTINGS.ttl_prereserva_dias = 10` para el tenant y una RESERVA en `2b`
- **WHEN** el sistema activa la pre-reserva al confirmar el presupuesto
- **THEN** `ttl_expiracion = now() + 10 días` en la RESERVA y en su fila de `FECHA_BLOQUEADA`

#### Scenario: Guarda de origen — confirmar sobre 2.d o terminal se rechaza sin efectos

- **GIVEN** una RESERVA en `sub_estado = '2d'` (cola) o en un estado terminal
- **WHEN** llega una petición de confirmación de presupuesto (transición a `pre_reserva`)
- **THEN** el sistema la rechaza con error de validación
- **AND** la RESERVA no se modifica, ni su `FECHA_BLOQUEADA`, ni ninguna consulta de cola

### Requirement: Bloqueo de fecha insert-o-update a 7 días al activar pre_reserva (fase pre_reserva)

El sistema SHALL (DEBE), en la **misma transacción** que la transición a `pre_reserva`,
fijar el bloqueo de `FECHA_BLOQUEADA` para `(tenant_id, fecha_evento)` con
`ttl_expiracion = now() + TENANT_SETTINGS.ttl_prereserva_dias` (7 por defecto) y
`tipo_bloqueo = 'blando'`, reutilizando la primitiva atómica de US-040
(`bloquearFecha(fase = 'pre_reserva')`). Si la RESERVA venía de `2.b`/`2.c`/`2.v` (ya tenía
fila activa en `FECHA_BLOQUEADA`), el sistema DEBE **actualizar** el `ttl_expiracion` de la
fila existente al nuevo valor de 7 días (no crear una nueva). Si venía de `2.a` sin bloqueo,
el sistema DEBE **insertar** una nueva fila con `(tenant_id, fecha)` único,
`tipo_bloqueo = 'blando'` y `reserva_id` apuntando a la RESERVA. La operación usa
`SELECT … FOR UPDATE` / `UNIQUE(tenant_id, fecha)` (no se usan locks distribuidos). El
bloqueo permanece **blando** (la pre-reserva no es firme). (Fuente: `US-014 §Reglas de
negocio` bloqueo 7 días, `§Consulta en 2.a sin bloqueo previo`, `§Happy Path`; `er-diagram.md
§3.16` fase `pre_reserva`; `CLAUDE.md §Regla crítica`.)

#### Scenario: Desde 2.b — se actualiza el ttl_expiracion de la fila existente a 7 días

- **GIVEN** una RESERVA en `2.b` con fila activa en `FECHA_BLOQUEADA` para su `fecha_evento`
  (`ttl_expiracion = now() + 3 días`)
- **WHEN** el gestor confirma el presupuesto y la RESERVA pasa a `pre_reserva`
- **THEN** la fila existente de `FECHA_BLOQUEADA` se actualiza a
  `ttl_expiracion = now() + ttl_prereserva_dias` con `tipo_bloqueo = 'blando'`
- **AND** no se crea una segunda fila para esa `(tenant_id, fecha)`

#### Scenario: Desde 2.a sin bloqueo — se inserta una fila nueva a 7 días

- **GIVEN** una RESERVA en `sub_estado = '2a'` **sin** fila previa en `FECHA_BLOQUEADA`, con
  `fecha_evento` y datos completos
- **WHEN** el gestor confirma el borrador del presupuesto
- **THEN** se inserta una nueva fila en `FECHA_BLOQUEADA` con `(tenant_id, fecha)` único,
  `tipo_bloqueo = 'blando'`, `ttl_expiracion = now() + ttl_prereserva_dias` y `reserva_id`
  apuntando a la RESERVA

### Requirement: Vaciado atómico de la cola de espera al activar pre_reserva (mecánica A16)

El sistema SHALL (DEBE), en la **misma transacción** que la transición a `pre_reserva`,
actualizar todas las RESERVA con `consulta_bloqueante_id = id de la RESERVA que transiciona`
y `sub_estado = '2d'` para que pasen a `sub_estado = '2y'` (consulta descartada por cola,
**estado terminal**), con `posicion_cola = NULL` y `consulta_bloqueante_id = NULL`. El
vaciado es **irreversible** (`2.y` es terminal) y se serializa por el `SELECT … FOR UPDATE`
sobre la fila bloqueante de `FECHA_BLOQUEADA`, reutilizando la mecánica de US-007. Los
**emails automáticos** a los clientes de la cola (A16, parte "email a cada uno") son **solo
diseñados en MVP y NO se envían**; solo se implementa la **mecánica** del vaciado. (Fuente:
`US-014 §Automatización A16`, `§Vaciado de cola al activar pre_reserva`, `§Notas de
alcance`; A16; `er-diagram.md §7.3`.)

#### Scenario: Activar pre_reserva vacía la cola y pasa las consultas en 2.d a 2.y

- **GIVEN** una RESERVA bloqueante en `sub_estado = '2b'` y 3 RESERVA en `sub_estado = '2d'`
  con `consulta_bloqueante_id` apuntando a ella
- **WHEN** el gestor confirma el presupuesto y la RESERVA transiciona a `pre_reserva`
- **THEN** en la misma transacción las 3 RESERVA pasan a `sub_estado = '2y'`, con
  `posicion_cola = NULL` y `consulta_bloqueante_id = NULL`
- **AND** no se envía ningún email automático a los clientes de la cola en MVP

#### Scenario: Cola vacía — la activación de pre_reserva se completa igualmente

- **GIVEN** una RESERVA en `2.b` sin ninguna RESERVA en `2.d` apuntándola
- **WHEN** el gestor confirma el presupuesto
- **THEN** la transición a `pre_reserva` se completa (con su bloqueo a 7 días) y el vaciado
  de cola afecta a 0 filas sin alterar ningún otro registro

### Requirement: Atomicidad de las operaciones de la activación de pre_reserva

El sistema SHALL (DEBE) ejecutar en una **única transacción de BD** bajo el contexto RLS del
tenant, de modo **all-or-nothing**: la creación del PRESUPUESTO (capability `presupuestos`),
la mutación de la RESERVA (`estado = 'pre_reserva'` + `ttl_expiracion` a 7 días), el
insert-o-update de su `FECHA_BLOQUEADA`, el vaciado de la cola (`2.d → 2.y`) y los registros
de `AUDIT_LOG`. Un fallo parcial DEBE revertir toda la transacción (rollback): el sistema NO
PUEDE quedar en un estado intermedio observable (p. ej. `pre_reserva` sin PRESUPUESTO, o con
la cola sin vaciar, o con `FECHA_BLOQUEADA` sin actualizar). El **envío de E2** se trata como
efecto **posterior al commit** (ver capability `comunicaciones`), de modo que su fallo no
revierte la pre-reserva. El registro en `AUDIT_LOG` DEBE incluir, para la RESERVA principal,
`accion = 'transicion'`, `entidad = 'RESERVA'`, `datos_anteriores.estado = '<sub_estado
origen>'` (p. ej. `'2b'`) y `datos_nuevos.estado = 'pre_reserva'`; y **una entrada por cada
consulta descartada** de la cola (`2.d → 2.y`). (Fuente: `US-014 §Happy Path`, `§Reglas de
negocio`, `§Vaciado de cola`; `CLAUDE.md §Regla crítica`.)

#### Scenario: La auditoría registra la transición principal y cada consulta descartada

- **GIVEN** una activación de `pre_reserva` desde `2.b` que vacía una cola de N consultas
- **WHEN** el sistema completa la operación
- **THEN** existe una fila en `AUDIT_LOG` con `accion = 'transicion'`, `entidad = 'RESERVA'`,
  `datos_anteriores.estado = '2b'` (sub_estado) y `datos_nuevos.estado = 'pre_reserva'` para
  la RESERVA principal
- **AND** se registra una entrada de auditoría por cada RESERVA descartada
  (`sub_estado '2d' → '2y'`)

#### Scenario: Un fallo parcial revierte toda la activación de pre_reserva

- **GIVEN** una activación de `pre_reserva` con cola activa en curso
- **WHEN** una de las operaciones (PRESUPUESTO, RESERVA, `FECHA_BLOQUEADA`, vaciado de cola o
  `AUDIT_LOG`) falla antes del commit
- **THEN** la transacción hace rollback completo: no existe PRESUPUESTO, la RESERVA
  permanece en su sub-estado origen, `FECHA_BLOQUEADA` sin actualizar/crear y la cola intacta
  en `2.d`

### Requirement: Concurrencia anti-doble-reserva (D4) al activar pre_reserva

El sistema SHALL (DEBE) garantizar que, ante dos confirmaciones concurrentes que intentan
insertar o actualizar la **misma fila** de `FECHA_BLOQUEADA(tenant_id, fecha)` —dos RESERVA
distintas para la misma `(tenant_id, fecha)`, una en `2.a` (INSERT) y otra en `2.b` (UPDATE),
o dos confirmaciones simultáneas del **mismo** presupuesto por doble clic—, **exactamente
una** transacción tenga éxito y la otra reciba la violación de `UNIQUE(tenant_id, fecha)`
(`P2002`) o falle al adquirir el `SELECT … FOR UPDATE`, devolviendo error "Fecha no
disponible" al gestor; **nunca** se produce doble bloqueo ni incoherencia entre
`RESERVA.estado` y `FECHA_BLOQUEADA`. La garantía es determinista y reside en el motor de
PostgreSQL (no en lógica aplicativa ni locks distribuidos). Esta zona crítica se cubre con
**TDD primero** mediante tests de concurrencia reales (skill `concurrency-locking`). (Fuente:
`US-014 §Concurrencia / Race Conditions`; `er-diagram.md §5.3`; `CLAUDE.md §Testing`,
`§Regla crítica`.)

#### Scenario: Dos confirmaciones sobre la misma fecha — una gana, la otra "Fecha no disponible"

- **GIVEN** dos RESERVA distintas para la misma `(tenant_id, fecha)` —una en `2.a` sin
  bloqueo, otra en `2.b` con bloqueo— y una confirmación concurrente de cada una
- **WHEN** ambas transacciones intentan insertar/actualizar la misma fila de
  `FECHA_BLOQUEADA(tenant_id, fecha)` en la misma ventana temporal
- **THEN** exactamente una transacción confirma su PRESUPUESTO + `pre_reserva` +
  `FECHA_BLOQUEADA`
- **AND** la otra recibe la violación de `UNIQUE(tenant_id, fecha)` (o falla al adquirir el
  lock) y el sistema devuelve "Fecha no disponible", sin doble bloqueo ni incoherencia
- **AND** el estado final contiene exactamente una fila de `FECHA_BLOQUEADA` para
  `(tenant, fecha)`

#### Scenario: Doble clic sobre el mismo presupuesto aplica la transición una sola vez

- **GIVEN** una RESERVA en `2.b` y dos confirmaciones simultáneas del **mismo** presupuesto
- **WHEN** ambas se procesan
- **THEN** exactamente una aplica la transición a `pre_reserva` (PRESUPUESTO + TTL 7d +
  bloqueo actualizado + cola vaciada)
- **AND** la otra observa que la RESERVA ya no está en `{2a,2b,2c,2v}` (o choca con la
  unicidad) y recibe la guarda de origen / "Fecha no disponible", sin doble PRESUPUESTO ni
  doble bloqueo
