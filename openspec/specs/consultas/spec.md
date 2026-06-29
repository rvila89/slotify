# consultas Specification

## Purpose
TBD - created by archiving change us-003-alta-consulta-exploratoria. Update Purpose after archive.
## Requirements
### Requirement: Alta de consulta exploratoria sin fecha crea una RESERVA en 2.a

El sistema SHALL (DEBE) permitir a un gestor autenticado dar de alta un lead **sin
fecha de evento** creando **una única entidad RESERVA** con `estado = 'consulta'`,
`sub_estado = '2a'` y `ttl_expiracion = NULL`, asociada a un CLIENTE del mismo
`tenant_id`. El sistema NO DEBE crear ninguna fila en `FECHA_BLOQUEADA` para el
sub-estado `2.a` (la consulta es una fase de la RESERVA, no una entidad aparte). La
RESERVA, el CLIENTE, la COMUNICACION (E1) y el registro de AUDIT_LOG se crean en una
**única transacción** bajo el contexto RLS del tenant. (Fuente: `US-003 §Happy
Path`, `§Reglas de Validación`; UC-03; `er-diagram.md §3.6`.)

#### Scenario: Alta sin fecha y sin comentarios crea la RESERVA en 2.a

- **GIVEN** un gestor autenticado en su tenant que abre el formulario "Nueva consulta"
- **WHEN** introduce nombre, apellidos, email, teléfono y `canal_entrada` válidos,
  sin fecha de evento y sin comentarios, y confirma el alta
- **THEN** el sistema crea una RESERVA con `estado = 'consulta'`,
  `sub_estado = '2a'` y `ttl_expiracion = NULL`
- **AND** no genera ninguna entrada en `FECHA_BLOQUEADA`
- **AND** la RESERVA queda vinculada a un CLIENTE del mismo `tenant_id`

#### Scenario: La consulta exploratoria no calcula tarifa

- **GIVEN** un alta sin fecha de evento aunque incluya nº de invitados y horas
- **WHEN** el sistema crea la RESERVA en `2.a`
- **THEN** almacena los valores opcionales (invitados, horas, tipo de evento)
- **AND** no calcula ni asigna importe de tarifa (sin fecha no hay temporada, UC-16)

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

### Requirement: Creación idempotente de CLIENTE por tenant y email

El sistema SHALL (DEBE) reutilizar el CLIENTE existente del tenant cuando ya hay uno
con el mismo `email` dentro de `tenant_id`, y crear uno nuevo en caso contrario, de
modo que dos altas con el mismo email en el mismo tenant no dupliquen el CLIENTE. La
resolución del CLIENTE DEBE ocurrir dentro de la misma transacción del alta y bajo
el contexto RLS del tenant. (Fuente: `US-003 §Supuestos`; `er-diagram.md §3.4`.)

#### Scenario: Segunda alta con el mismo email reutiliza el CLIENTE

- **GIVEN** un tenant que ya tiene un CLIENTE con un email dado
- **WHEN** el gestor da de alta otra consulta con ese mismo email
- **THEN** el sistema reutiliza el CLIENTE existente en lugar de crear uno nuevo
- **AND** la nueva RESERVA queda vinculada a ese CLIENTE

### Requirement: Auditoría del alta de consulta en AUDIT_LOG

El sistema SHALL (DEBE) registrar en `AUDIT_LOG`, tras un alta exitosa, una entrada
con `accion = 'crear'`, `entidad = 'RESERVA'`, el `usuario_id` del gestor activo y
los datos de la nueva RESERVA en `datos_nuevos`, a través del puerto de auditoría
compartido. El valor de `entidad` se persiste como `'RESERVA'` (UPPER_SNAKE),
consistente con la convención del módulo `reservas`. (Fuente: `US-003 §Happy Path`
3.er escenario; `er-diagram.md §3.17`; precedente
`reservas/domain/liberar-fecha.service.ts`.)

#### Scenario: Alta exitosa escribe un registro de auditoría

- **GIVEN** un alta de consulta que se completa con éxito
- **WHEN** el sistema finaliza la operación
- **THEN** escribe una entrada en `AUDIT_LOG` con `accion = 'crear'` y
  `entidad = 'RESERVA'`
- **AND** incluye el `usuario_id` del gestor activo y los datos de la RESERVA en
  `datos_nuevos`

### Requirement: Validación de campos y rechazo sin efectos colaterales

El sistema SHALL (DEBE) validar el alta en **cliente y servidor**: `nombre` y
`apellidos` no vacíos (máx. 100), `email` con formato RFC 5322 básico, `telefono` no
vacío y `canal_entrada` dentro del ENUM `{web|email|whatsapp|instagram|telefono}`.
Ante cualquier campo obligatorio incompleto, email inválido o `canal_entrada` fuera
del ENUM, el sistema NO DEBE crear ningún registro (RESERVA, CLIENTE ni
COMUNICACION) y DEBE devolver errores de validación sobre los campos afectados. El
reintento con los mismos datos inválidos es idempotente (sigue sin crear nada).
(Fuente: `US-003 §FA-03`, `§FA Email inválido`, `§FA canal_entrada fuera del ENUM`,
`§Reglas de Validación`.)

#### Scenario: Campos obligatorios incompletos no crean nada

- **GIVEN** un alta con algún campo obligatorio vacío (nombre, apellidos, email,
  teléfono o canal_entrada)
- **WHEN** el gestor intenta confirmar el alta
- **THEN** el sistema no crea ninguna RESERVA, CLIENTE ni COMUNICACION
- **AND** devuelve errores de validación sobre los campos incompletos

#### Scenario: Email con formato inválido se rechaza

- **GIVEN** un alta con un email sin formato válido (sin '@' o sin dominio)
- **WHEN** el gestor intenta confirmar el alta
- **THEN** el sistema rechaza la solicitud con un error en el campo email
- **AND** no crea ningún registro

#### Scenario: canal_entrada fuera del ENUM se rechaza en servidor

- **GIVEN** una petición con un `canal_entrada` no contemplado en el ENUM
- **WHEN** el servidor valida la solicitud
- **THEN** retorna un error de validación
- **AND** no crea ningún registro

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

