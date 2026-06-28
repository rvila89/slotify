# Spec Delta — Capability `consultas`

> US-004 amplía la capability `consultas` (US-003) con el **alta de lead con
> `fecha_evento`**: ramificación del sub-estado de la RESERVA según la
> disponibilidad de la fecha (`2.b` libre / `2.d` cola / `2.a` exploratoria),
> bloqueo blando atómico en `2.b`, entrada en cola en `2.d`, y tarifa estimada en
> E1. Reutiliza el bloqueo atómico de US-040 y el motor de tarifa de US-016 sin
> modificarlos.
> Fuente: US-004, UC-03; A1, A14; `er-diagram.md §3.6, §5.3, §3.16`.

## ADDED Requirements

### Requirement: Alta con fecha disponible crea una RESERVA en 2.b con bloqueo blando atómico

El sistema SHALL (DEBE), cuando el alta incluye `fecha_evento > hoy` (estrictamente
futura) y la fecha **no tiene** una fila activa en `FECHA_BLOQUEADA` para el tenant,
crear una RESERVA con
`estado = 'consulta'`, `sub_estado = '2b'`, `fecha_evento` = la fecha introducida y
`ttl_expiracion = now() + TENANT_SETTINGS.ttl_consulta_dias` (3 por defecto), e
**insertar en la misma transacción** una fila en `FECHA_BLOQUEADA` con `tenant_id`
del tenant activo, `fecha = fecha_evento`, `reserva_id` = id de la nueva RESERVA,
`tipo_bloqueo = 'blando'` y `ttl_expiracion` = el mismo valor que la RESERVA. La
inserción usa la transacción serializada `SELECT … FOR UPDATE` y la restricción
`UNIQUE(tenant_id, fecha)` (US-040) como garantía de no-doble-reserva. La RESERVA y
el bloqueo se crean **all-or-nothing** bajo el contexto RLS del tenant. (Fuente:
`US-004 §Happy Path`, `§Reglas de Validación`; UC-03; A1; `er-diagram.md §5.3`.)

#### Scenario: Fecha libre crea RESERVA en 2.b y bloquea la fecha

- **GIVEN** un gestor autenticado y una `fecha_evento > hoy` (estrictamente futura)
  sin fila activa en `FECHA_BLOQUEADA` para su tenant
- **WHEN** confirma el alta con los campos obligatorios y esa fecha
- **THEN** el sistema crea una RESERVA con `estado = 'consulta'`,
  `sub_estado = '2b'`, `fecha_evento` = la fecha y
  `ttl_expiracion = now() + ttl_consulta_dias`
- **AND** inserta una fila en `FECHA_BLOQUEADA` con `tipo_bloqueo = 'blando'`,
  `reserva_id` de la nueva RESERVA y el mismo `ttl_expiracion`
- **AND** ambas escrituras ocurren en una única transacción (all-or-nothing)

#### Scenario: ttl_expiracion se deriva de TENANT_SETTINGS, no hardcodeado

- **GIVEN** `TENANT_SETTINGS.ttl_consulta_dias = 5` para el tenant
- **WHEN** el sistema crea la RESERVA en `2.b` para una fecha libre
- **THEN** `ttl_expiracion = now() + 5 días` en la RESERVA y en `FECHA_BLOQUEADA`

### Requirement: Alta sobre fecha bloqueada por una consulta en 2.b entra en cola (2.d)

El sistema SHALL (DEBE), cuando la `fecha_evento` ya está bloqueada por una RESERVA
**bloqueante en `sub_estado = '2b'`** para el tenant, crear la nueva RESERVA con
`sub_estado = '2d'`, `posicion_cola = MAX(posicion_cola de esa fecha en ese tenant)
+ 1` y `consulta_bloqueante_id` = id de la RESERVA bloqueante, y **NO** crear fila en
`FECHA_BLOQUEADA` para la nueva consulta (la fecha ya está bloqueada por la
bloqueante). La asignación de `posicion_cola` se serializa mediante `SELECT … FOR
UPDATE` sobre la fila `FECHA_BLOQUEADA` bloqueante (no se usan locks distribuidos).
La gestión posterior de la cola (promoción/vaciado, UC-11/12/13) y los emails de
posición quedan **fuera de alcance**. (Fuente: `US-004 §FA entrada en cola`, A14,
`§Notas de alcance`.)

#### Scenario: Fecha bloqueada por 2.b crea la consulta en cola

- **GIVEN** una RESERVA bloqueante en `sub_estado = '2b'` con fila activa en
  `FECHA_BLOQUEADA` para `(tenant, fecha)`
- **WHEN** el gestor confirma el alta de un nuevo lead con esa misma fecha
- **THEN** el sistema crea la RESERVA con `sub_estado = '2d'`,
  `posicion_cola = (máx. posición existente para esa fecha) + 1` y
  `consulta_bloqueante_id` apuntando a la RESERVA bloqueante
- **AND** NO crea ninguna fila en `FECHA_BLOQUEADA` para esta nueva consulta

#### Scenario: Posiciones de cola consecutivas para varias consultas en la misma fecha

- **GIVEN** una fecha ya bloqueada por una RESERVA en `2.b` y una consulta en cola
  con `posicion_cola = 1`
- **WHEN** se da de alta otra consulta con la misma fecha
- **THEN** la nueva RESERVA recibe `posicion_cola = 2` (sin colisión)

### Requirement: Alta sobre fecha bloqueada por estados no encolables va a 2.a exploratoria

El sistema SHALL (DEBE), cuando la `fecha_evento` está bloqueada por una RESERVA en
`sub_estado = '2c'` o `'2v'`, o en `estado = 'pre_reserva'`, `'reserva_confirmada'` o
posteriores, crear la nueva RESERVA en `sub_estado = '2a'` (exploratoria, **sin**
bloqueo y **sin** cola): `posicion_cola = NULL`, `consulta_bloqueante_id = NULL`, sin
fila en `FECHA_BLOQUEADA`. La UI muestra un aviso informativo de que la fecha no está
disponible. (Fuente: `US-004 §FA va a 2.a`, `§Reglas de Validación`.)

#### Scenario: Fecha bloqueada por pre_reserva crea consulta exploratoria

- **GIVEN** una fecha bloqueada por una RESERVA en `estado = 'pre_reserva'`
- **WHEN** el gestor confirma el alta con esa fecha
- **THEN** el sistema crea la RESERVA en `sub_estado = '2a'` sin bloqueo ni cola
  (`posicion_cola = NULL`, `consulta_bloqueante_id = NULL`)
- **AND** no crea ninguna fila en `FECHA_BLOQUEADA`
- **AND** la UI informa de que la fecha no está disponible

### Requirement: Determinación declarativa del sub-estado de alta según el estado de la fecha

El sistema SHALL (DEBE) determinar el sub-estado del alta con fecha (`2.b` / `2.d` /
`2.a`) mediante una **estructura de datos declarativa** de la máquina de estados (no
condicionales dispersos), que mapea el estado de disponibilidad de la fecha al
sub-estado resultante y a la acción asociada (`bloquear` / `encolar` /
`exploratoria`). La determinación se evalúa **dentro** del cuerpo transaccional que
lee el estado de la fecha, de modo que un reintento (tras colisión) re-evalúe el
resultado con el estado ya actualizado. (Fuente: `US-004 §Reglas de negocio`;
`CLAUDE.md §Máquina de estados`; `design.md §D-3`.)

#### Scenario: La misma tabla resuelve los tres sub-estados

- **GIVEN** el estado de disponibilidad de una fecha para el tenant
- **WHEN** el sistema determina el sub-estado del alta
- **THEN** devuelve `2b` + `bloquear` si la fecha está libre, `2d` + `encolar` si
  está bloqueada por una consulta en `2.b`, y `2a` + `exploratoria` si está bloqueada
  por `2.c`/`2.v`/`pre_reserva`/`reserva_confirmada` o posteriores

### Requirement: Concurrencia anti-doble-reserva (D4) en el alta con fecha

El sistema SHALL (DEBE) garantizar que, ante dos altas concurrentes con la misma
`(tenant_id, fecha_evento)` sobre una fecha libre, **exactamente una** confirme la
RESERVA en `2.b` + la fila en `FECHA_BLOQUEADA`, y la otra reciba la violación de
`UNIQUE(tenant_id, fecha)` (`P2002`); el sistema **recrea** esa segunda alta como
`2.d` (reabriendo la transacción y **re-derivando** el sub-estado con la fecha ya
bloqueada), asignándole `posicion_cola` y `consulta_bloqueante_id` apuntando a la
ganadora, sin posibilidad de doble bloqueo. La garantía es determinista y reside en
el motor de PostgreSQL, no en lógica aplicativa. Esta zona crítica se cubre con
**TDD primero** mediante tests de concurrencia reales. (Fuente: `US-004
§Concurrencia`; `er-diagram.md §5.3`; `CLAUDE.md §Testing`; `design.md §D-6`.)

#### Scenario: Dos altas simultáneas sobre fecha libre — una 2.b, otra 2.d

- **GIVEN** dos altas concurrentes con la misma `(tenant_id, fecha_evento)` sobre una
  fecha libre
- **WHEN** ambas intentan insertar en `FECHA_BLOQUEADA` en la misma ventana temporal
- **THEN** exactamente una confirma la RESERVA en `2.b` + la fila de `FECHA_BLOQUEADA`
- **AND** la otra recibe la violación de `UNIQUE(tenant_id, fecha)` y se recrea como
  RESERVA en `2.d` con `posicion_cola = 1` y `consulta_bloqueante_id` = la ganadora
- **AND** el estado final contiene exactamente una fila de `FECHA_BLOQUEADA` para
  `(tenant, fecha)`

#### Scenario: N altas simultáneas producen 1 bloqueo y N-1 posiciones de cola únicas

- **GIVEN** N altas concurrentes con la misma `(tenant_id, fecha_evento)` libre
- **WHEN** todas se procesan en una ventana solapada
- **THEN** exactamente una queda en `2.b` con `FECHA_BLOQUEADA`
- **AND** las otras `N-1` quedan en `2.d` con `posicion_cola` únicas y contiguas

### Requirement: Validación de fecha_evento estrictamente futura en servidor

El sistema SHALL (DEBE) validar en el servidor que `fecha_evento > hoy`
(estrictamente futura, día natural) reutilizando la regla de fecha futura existente
(`validarFechaFutura`, US-040) y rechazar con error de validación **400**, **sin
crear** RESERVA ni `FECHA_BLOQUEADA`, cualquier petición cuya `fecha_evento` sea
**anterior a hoy** o **igual a hoy** que llegue por bypass de la UI. El selector de
fecha de la UI no permite seleccionar fechas anteriores a hoy ni el día de hoy.

> **Nota de divergencia intencional (Gate 1 — decisión A)**: la ficha US-004 indicaba
> `fecha_evento ≥ hoy` (admitía hoy). Por decisión humana aprobada en el Gate 1 se
> implementa `> hoy` (estrictamente futura) para mantener **una sola regla de "fecha
> válida"** en todo el código, alineada con el bloqueo de US-040
> (`validarFechaFutura`) y el motor de tarifa de US-016, que ya rechazan el mismo día.

(Fuente: `US-004 §FA-01`, `§Reglas de Validación`; `design.md §D-1`/`§D-2`;
US-040 `validarFechaFutura`.)

#### Scenario: Fecha futura válida da de alta la consulta

- **GIVEN** una petición con `fecha_evento` estrictamente posterior a hoy (`> hoy`)
- **WHEN** el servidor valida la solicitud
- **THEN** la validación de fecha pasa y el alta continúa según el estado de la fecha
  (`2.b` / `2.d` / `2.a`)

#### Scenario: Fecha igual a hoy se rechaza con 400 sin efectos

- **GIVEN** una petición con `fecha_evento` igual al día de hoy
- **WHEN** el servidor valida la solicitud
- **THEN** retorna un error de validación 400
- **AND** no crea ninguna RESERVA ni fila en `FECHA_BLOQUEADA`

#### Scenario: Fecha pasada por bypass de la UI se rechaza con 400 sin efectos

- **GIVEN** una petición con `fecha_evento` anterior a hoy
- **WHEN** el servidor valida la solicitud
- **THEN** retorna un error de validación 400
- **AND** no crea ninguna RESERVA ni fila en `FECHA_BLOQUEADA`

## MODIFIED Requirements

### Requirement: Respuesta inicial automática E1 según el campo comentarios

El sistema SHALL (DEBE) registrar una fila en `COMUNICACION` con
`codigo_email = 'E1'` para toda alta de consulta. Si el alta **no** incluye
`comentarios`, el sistema DEBE crear la COMUNICACION con `estado = 'enviado'` y
disparar el envío al email del cliente **sin intervención adicional** del gestor. Si
el alta **incluye** `comentarios`, el sistema DEBE crear la COMUNICACION con
`estado = 'borrador'`, **sin enviarla**, y la UI DEBE alertar al gestor de que tiene
un borrador pendiente de revisar y confirmar. Cuando el alta incluye `fecha_evento`
**y** nº de invitados **y** horas, E1 DEBE incluir la **tarifa estimada** calculada
vía el motor UC-16; si falta alguno de esos datos (o el cálculo no es posible para la
fecha/temporada), E1 DEBE enviarse con el **dossier de tarifas general sin precio
exacto**, sin que la imposibilidad de calcular la tarifa bloquee el alta. El
**transporte real** del email se realiza a través de un **puerto de email** del
dominio cuyo adaptador de transporte queda diferido a US-045. (Fuente: `US-003 §Happy
Path` 2.º escenario, `§FA Lead con comentarios`; `US-004 §Email relacionado`, `§FA
solo fecha sin datos de tarifa`.)

#### Scenario: Alta sin comentarios auto-envía E1

- **GIVEN** un alta de consulta válida sin el campo `comentarios`
- **WHEN** el sistema procesa el alta
- **THEN** crea una COMUNICACION con `codigo_email = 'E1'` y `estado = 'enviado'`
- **AND** dispara el envío del email al cliente sin acción adicional del gestor

#### Scenario: Alta con comentarios deja E1 en borrador

- **GIVEN** un alta de consulta válida con el campo `comentarios` relleno
- **WHEN** el gestor confirma el alta
- **THEN** crea una COMUNICACION con `codigo_email = 'E1'` y `estado = 'borrador'`
- **AND** no envía el email al cliente
- **AND** la UI alerta al gestor de un borrador E1 pendiente de revisar

#### Scenario: E1 con fecha, invitados y horas incluye la tarifa estimada

- **GIVEN** un alta con `fecha_evento`, nº de invitados y horas presentes, sin
  comentarios
- **WHEN** el sistema envía E1
- **THEN** E1 se envía automáticamente incluyendo la tarifa estimada calculada vía
  UC-16

#### Scenario: E1 sin datos de tarifa completos sale con el dossier general sin precio

- **GIVEN** un alta con `fecha_evento` pero sin nº de invitados o sin horas, sin
  comentarios
- **WHEN** el sistema crea la RESERVA en `2.b` con su bloqueo y envía E1
- **THEN** E1 se envía con el dossier de tarifas general, sin precio exacto calculado
- **AND** la imposibilidad de calcular la tarifa no impide el alta ni el bloqueo
