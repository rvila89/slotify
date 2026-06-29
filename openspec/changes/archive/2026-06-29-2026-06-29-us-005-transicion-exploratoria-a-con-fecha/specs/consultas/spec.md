# Spec Delta — Capability `consultas`

> US-005 amplía la capability `consultas` con la **transición de una consulta
> exploratoria existente (`2.a`) a consulta con fecha**: el Gestor añade una
> `fecha_evento` a una RESERVA que **ya existe** en `sub_estado = '2a'`, y el sistema
> ramifica el destino según la disponibilidad de la fecha (`2.b` con bloqueo blando /
> `2.d` cola tras aceptación del gestor / permanece en `2.a`). Reutiliza el bloqueo
> atómico de US-040/041, las reglas de estado/cola de US-004 (mismo edge `2.d`) y el
> motor de email de US-045, **sin reinventarlos**.
> Fuente: US-005, UC-04; A1, A4; `er-diagram.md §3.6, §5.3, §3.16`.

## ADDED Requirements

### Requirement: Transición 2.a → 2.b al añadir una fecha disponible a una consulta existente

El sistema SHALL (DEBE), cuando el Gestor añade una `fecha_evento` válida (ver
"Validación de fecha de la transición en servidor") a una RESERVA **existente** en
`estado = 'consulta'` y `sub_estado = '2a'`, y la fecha **no tiene** una fila activa en
`FECHA_BLOQUEADA` para el tenant, **transicionar** la RESERVA a `sub_estado = '2b'`,
almacenar `fecha_evento` = la fecha introducida y fijar
`ttl_expiracion = now() + TENANT_SETTINGS.ttl_consulta_dias` (3 por defecto), e
**insertar en la misma transacción** una fila en `FECHA_BLOQUEADA` con `tenant_id` del
tenant activo, `fecha = fecha_evento`, `reserva_id` = id de la RESERVA,
`tipo_bloqueo = 'blando'` y el mismo `ttl_expiracion`. La inserción reutiliza la
primitiva atómica de US-040 (`SELECT … FOR UPDATE` + `UNIQUE(tenant_id, fecha)`). La
mutación de la RESERVA y el bloqueo ocurren **all-or-nothing** bajo el contexto RLS del
tenant. El sistema **programa el TTL de expiración** (A4) reutilizando la liberación de
US-041. (Fuente: `US-005 §Happy Path`, `§Reglas de Validación`; UC-04; A1, A4;
`er-diagram.md §5.3`.)

#### Scenario: Fecha libre transiciona la consulta de 2.a a 2.b y bloquea la fecha

- **GIVEN** una RESERVA existente en `estado = 'consulta'`, `sub_estado = '2a'` para el
  tenant del gestor autenticado
- **AND** una `fecha_evento` válida sin fila activa en `FECHA_BLOQUEADA` para ese tenant
- **WHEN** el gestor añade esa fecha y confirma la transición
- **THEN** la RESERVA pasa a `sub_estado = '2b'`, almacena `fecha_evento` = la fecha y
  fija `ttl_expiracion = now() + ttl_consulta_dias`
- **AND** inserta una fila en `FECHA_BLOQUEADA` con `tipo_bloqueo = 'blando'`,
  `reserva_id` de la RESERVA y el mismo `ttl_expiracion`
- **AND** ambas escrituras ocurren en una única transacción (all-or-nothing)

#### Scenario: ttl_expiracion se deriva de TENANT_SETTINGS, no hardcodeado

- **GIVEN** `TENANT_SETTINGS.ttl_consulta_dias = 5` para el tenant y una RESERVA en `2a`
- **WHEN** el sistema transiciona la RESERVA a `2.b` para una fecha libre
- **THEN** `ttl_expiracion = now() + 5 días` en la RESERVA y en `FECHA_BLOQUEADA`

### Requirement: Auditoría de la transición 2.a → 2.b en AUDIT_LOG

El sistema SHALL (DEBE) registrar en `AUDIT_LOG`, tras una transición exitosa
`2.a → 2.b`, una fila con `accion = 'transicion'`, `entidad = 'RESERVA'`,
`datos_anteriores.sub_estado = '2a'`, `datos_nuevos.sub_estado = '2b'` y
`datos_nuevos.fecha_evento` = la fecha introducida, en la **misma transacción** que la
mutación de la RESERVA y el bloqueo. (Fuente: `US-005 §Happy Path` 3.er escenario;
`er-diagram.md §3.16`.)

#### Scenario: La transición exitosa escribe un registro de auditoría

- **GIVEN** una transición `2.a → 2.b` que se completa con su bloqueo blando
- **WHEN** el sistema registra la operación
- **THEN** existe una fila en `AUDIT_LOG` con `accion = 'transicion'`,
  `entidad = 'RESERVA'`, `datos_anteriores.sub_estado = '2a'`,
  `datos_nuevos.sub_estado = '2b'` y `datos_nuevos.fecha_evento` = la fecha introducida

### Requirement: Fecha bloqueada por una consulta en 2.b ofrece entrar en cola (2.a → 2.d)

El sistema SHALL (DEBE), cuando la `fecha_evento` que el gestor intenta añadir a una
RESERVA en `2.a` ya está bloqueada por una RESERVA **bloqueante en `sub_estado = '2b'`**
para el tenant, **informar** al gestor de que la fecha está ocupada y **ofrecer** la
entrada en cola. Si el gestor **acepta** la cola, el sistema transiciona la RESERVA a
`sub_estado = '2d'`, asigna `posicion_cola = MAX(posicion_cola de esa fecha en ese
tenant) + 1` y `consulta_bloqueante_id` = id de la RESERVA bloqueante, y **NO** crea
fila en `FECHA_BLOQUEADA` (la fecha ya está bloqueada por la bloqueante). Si el gestor
**rechaza**, la RESERVA **permanece en `2.a`** sin ningún cambio. La asignación de
`posicion_cola` se serializa mediante `SELECT … FOR UPDATE` sobre la fila
`FECHA_BLOQUEADA` bloqueante (no se usan locks distribuidos), reutilizando el mecanismo
de US-004. La gestión posterior de la cola (UC-11/12/13) y los emails de posición quedan
**fuera de alcance**. (Fuente: `US-005 §FA-01`, A14, `§Notas de alcance`.)

#### Scenario: El gestor acepta la cola y la consulta pasa a 2.d

- **GIVEN** una RESERVA propia en `sub_estado = '2a'` y una `fecha_evento` ya bloqueada
  por una RESERVA bloqueante en `sub_estado = '2b'` con fila activa en `FECHA_BLOQUEADA`
- **WHEN** el gestor intenta añadir esa fecha y **acepta** la oferta de entrar en cola
- **THEN** la RESERVA pasa a `sub_estado = '2d'`,
  `posicion_cola = (máx. posición existente para esa fecha) + 1` y
  `consulta_bloqueante_id` apuntando a la RESERVA bloqueante
- **AND** NO crea ninguna fila en `FECHA_BLOQUEADA` para esta consulta

#### Scenario: El gestor rechaza la cola y la consulta permanece en 2.a

- **GIVEN** una RESERVA propia en `sub_estado = '2a'` y una `fecha_evento` bloqueada por
  una consulta en `2.b`
- **WHEN** el sistema ofrece la cola y el gestor **rechaza**
- **THEN** la RESERVA permanece en `sub_estado = '2a'` sin cambios
- **AND** no se crea ninguna fila en `FECHA_BLOQUEADA` ni se asigna posición de cola

#### Scenario: Posiciones de cola consecutivas para varias consultas en la misma fecha

- **GIVEN** una fecha ya bloqueada por una RESERVA en `2.b` y una consulta encolada con
  `posicion_cola = 1`
- **WHEN** otra RESERVA en `2.a` se transiciona a cola sobre la misma fecha
- **THEN** recibe `posicion_cola = 2` (sin colisión)

### Requirement: Fecha bloqueada por estados no encolables no ofrece cola y mantiene 2.a

El sistema SHALL (DEBE), cuando la `fecha_evento` que el gestor intenta añadir a una
RESERVA en `2.a` está bloqueada por una RESERVA en `sub_estado = '2c'` o `'2v'`, o en
`estado = 'pre_reserva'`, `'reserva_confirmada'` o posteriores, **informar** de que la
fecha no está disponible, **no ofrecer** cola y **dejar la RESERVA en `sub_estado =
'2a'` sin ningún cambio**: no muta la RESERVA y no crea fila en `FECHA_BLOQUEADA`.
(Fuente: `US-005 §FA-02`, `§Reglas de Validación`.)

#### Scenario: Fecha bloqueada por pre_reserva mantiene la consulta en 2.a sin cola

- **GIVEN** una RESERVA propia en `sub_estado = '2a'` y una `fecha_evento` bloqueada por
  una RESERVA en `estado = 'pre_reserva'`
- **WHEN** el gestor intenta añadir esa fecha
- **THEN** el sistema informa de que la fecha no está disponible y no ofrece cola
- **AND** la RESERVA permanece en `sub_estado = '2a'` sin cambios y no se crea ninguna
  fila en `FECHA_BLOQUEADA`

### Requirement: Guarda de origen — la transición solo es válida desde sub_estado 2.a

El sistema SHALL (DEBE) validar en el servidor, **antes** de cualquier mutación, que la
RESERVA destino de la transición está en `sub_estado = '2a'`. Si la RESERVA está en
cualquier otro sub-estado/estado — incluidos `2.b`, `2.c`, `2.v`, los terminales `2.x`,
`2.y`, `2.z`, o `reserva_cancelada`/`reserva_completada` (inmutables) — el sistema DEBE
rechazar la petición con error de validación y **no modificar** la RESERVA ni crear
`FECHA_BLOQUEADA`. La guarda se modela en la **máquina de estados declarativa** (no
condicionales dispersos): solo `{consulta, 2a} → {consulta, 2b}` y `{consulta, 2a} →
{consulta, 2d}` son transiciones permitidas para esta operación. (Fuente: `US-005 §FA
RESERVA no está en 2.a`, `§Reglas de Validación`, `§Notas de alcance — Transiciones
terminales`; `CLAUDE.md §Máquina de estados`.)

#### Scenario: Transición sobre una RESERVA que no está en 2.a se rechaza sin efectos

- **GIVEN** una RESERVA en `sub_estado = '2b'` (o `2c`, o un estado terminal)
- **WHEN** llega una petición para añadirle una `fecha_evento` (transición 2.a → 2.b)
- **THEN** el sistema retorna un error de validación indicando que la transición solo es
  válida desde `sub_estado = '2a'`
- **AND** la RESERVA no se modifica y no se crea ninguna fila en `FECHA_BLOQUEADA`

#### Scenario: Estados terminales no pueden ser origen de la transición

- **GIVEN** una RESERVA en un estado terminal (`2x`, `2y`, `2z`, `reserva_cancelada` o
  `reserva_completada`)
- **WHEN** llega una petición de transición 2.a → 2.b sobre ella
- **THEN** el sistema la rechaza con error de validación sin mutar nada

### Requirement: Validación de fecha de la transición en servidor

El sistema SHALL (DEBE) validar en el servidor que la `fecha_evento` de la transición es
una fecha futura válida según la **regla de fecha unificada del proyecto**
(`validarFechaFutura` de US-040, `fecha_evento > hoy`, estrictamente futura, día
natural), reutilizada por el bloqueo (US-040) y la tarifa (US-016) y ya aplicada por
US-004. El sistema DEBE rechazar con error de validación (HTTP 4xx) **sin modificar** la
RESERVA ni crear `FECHA_BLOQUEADA` cualquier petición cuya `fecha_evento` llegue por
bypass de la UI con un valor no válido. El selector de fecha de la UI no permite
seleccionar fechas no válidas.

> **Nota de divergencia (PENDIENTE de aprobación en el Gate SDD)**: la ficha US-005
> indica `fecha_evento ≥ hoy` (admitiría **hoy**). Se **recomienda** implementar
> `> hoy` (estrictamente futura), igual que la decisión A aprobada en el Gate 1 de
> US-004, para mantener **una sola regla de "fecha válida"** en todo el código,
> coherente con la primitiva de bloqueo de US-040 que esta US reutiliza. La resolución
> definitiva (`≥ hoy` vs `> hoy`) queda **abierta al Gate SDD** (ver `design.md §D-1`).

(Fuente: `US-005 §FA Fecha pasada vía servidor`, `§Reglas de Validación`;
`design.md §D-1`; US-040 `validarFechaFutura`.)

#### Scenario: Fecha pasada por bypass de la UI se rechaza sin efectos

- **GIVEN** una petición de transición con `fecha_evento` anterior a hoy
- **WHEN** el servidor valida la solicitud
- **THEN** retorna un error de validación
- **AND** no modifica la RESERVA ni crea fila en `FECHA_BLOQUEADA`

#### Scenario: Fecha futura válida permite continuar la transición

- **GIVEN** una petición con `fecha_evento` futura válida sobre una RESERVA en `2a`
- **WHEN** el servidor valida la solicitud
- **THEN** la validación de fecha pasa y la transición continúa según el estado de la
  fecha (`2.b` / oferta de `2.d` / permanece `2.a`)

### Requirement: Determinación declarativa del sub-estado destino de la transición

El sistema SHALL (DEBE) determinar el destino de la transición (`2.b` con bloqueo /
oferta de `2.d` / permanece `2.a`) reutilizando la **estructura de datos declarativa**
de la máquina de estados de US-004 (`determinarAltaConFecha` + tabla de reglas que mapea
el estado de disponibilidad de la fecha a sub-estado + acción `bloquear` / `encolar` /
`sin-cambios`), no mediante condicionales dispersos. La determinación se evalúa
**dentro** del cuerpo transaccional que lee el estado de la fecha, de modo que un
reintento tras colisión re-evalúe el resultado con el estado ya actualizado. (Fuente:
`US-005 §Reglas de negocio`; `CLAUDE.md §Máquina de estados`; US-004 `design.md §D-3`;
`design.md §D-3`.)

#### Scenario: La misma tabla resuelve los tres destinos de la transición

- **GIVEN** el estado de disponibilidad de una fecha para el tenant y una RESERVA en
  `2.a`
- **WHEN** el sistema determina el destino de la transición
- **THEN** devuelve `2b` + `bloquear` si la fecha está libre, oferta de `2d` + `encolar`
  si está bloqueada por una consulta en `2.b`, y permanece `2a` + `sin-cambios` si está
  bloqueada por `2.c`/`2.v`/`pre_reserva`/`reserva_confirmada` o posteriores

### Requirement: Concurrencia anti-doble-reserva (D4) en la transición a 2.b

El sistema SHALL (DEBE) garantizar que, ante dos transiciones concurrentes de **dos
RESERVA distintas** (ambas en `2.a`, mismo tenant) hacia la **misma `fecha_evento`**
libre, **exactamente una** confirme la transición a `2.b` + la fila en `FECHA_BLOQUEADA`,
y la otra reciba la violación de `UNIQUE(tenant_id, fecha)` (`P2002`); el sistema
maneja el error **ofreciendo a la segunda consulta entrar en cola (`2.d`)** —
re-derivando el destino con la fecha ya bloqueada y apuntando `consulta_bloqueante_id` a
la ganadora — **sin posibilidad de doble bloqueo**. La garantía es determinista y reside
en el motor de PostgreSQL, no en lógica aplicativa. Esta zona crítica se cubre con **TDD
primero** mediante tests de concurrencia reales (skill `concurrency-locking`). (Fuente:
`US-005 §Concurrencia`; `er-diagram.md §5.3`; `CLAUDE.md §Testing`; `design.md §D-5`.)

#### Scenario: Dos transiciones simultáneas sobre fecha libre — una 2.b, la otra cola

- **GIVEN** dos RESERVA distintas en `2.a` (mismo tenant) y una transición concurrente
  de cada una hacia la misma `fecha_evento` libre
- **WHEN** ambas intentan insertar en `FECHA_BLOQUEADA` la misma `(tenant_id, fecha)` con
  `SELECT … FOR UPDATE`
- **THEN** exactamente una transición confirma su RESERVA en `2.b` + la fila de
  `FECHA_BLOQUEADA`
- **AND** la otra recibe la violación de `UNIQUE(tenant_id, fecha)` y el sistema le
  ofrece entrar en cola (`2.d`) con `consulta_bloqueante_id` = la ganadora, sin doble
  bloqueo
- **AND** el estado final contiene exactamente una fila de `FECHA_BLOQUEADA` para
  `(tenant, fecha)`

### Requirement: Email de confirmación de bloqueo provisional vía el motor de US-045

El sistema SHALL (DEBE), tras una transición exitosa `2.a → 2.b`, registrar una
`COMUNICACION` de confirmación de bloqueo provisional dirigida al cliente y enviarla
**reutilizando el motor de email real de US-045**. Este email es una **extensión de E1**
para el caso de actualización de fecha y **no tiene un código `E` propio** en el catálogo
§9.3 (E1–E8). El fallo de envío del email **no revierte** la transición ni el bloqueo ya
comprometidos (el email es posterior al commit de la transición). (Fuente: `US-005
§Email relacionado`, `§Notas de alcance — Email de confirmación de bloqueo
provisional`; UC-04 paso 8; motor US-045.)

#### Scenario: Transición a 2.b dispara el email de confirmación de bloqueo provisional

- **GIVEN** una transición `2.a → 2.b` que se completa con su bloqueo blando
- **WHEN** el sistema registra la comunicación de confirmación
- **THEN** crea una `COMUNICACION` de confirmación de bloqueo provisional para el cliente
- **AND** la envía a través del motor de email de US-045

#### Scenario: Un fallo de envío del email no revierte la transición

- **GIVEN** una transición `2.a → 2.b` ya confirmada (RESERVA en `2.b` + `FECHA_BLOQUEADA`)
- **WHEN** el envío del email de confirmación falla
- **THEN** la RESERVA permanece en `2.b` y la fila de `FECHA_BLOQUEADA` se conserva
- **AND** el fallo de email se gestiona sin revertir la transición
