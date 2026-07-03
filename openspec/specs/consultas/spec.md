# consultas Specification

## Purpose
La capability `consultas` cubre la **gestión del ciclo de vida de un lead desde su captación hasta su resolución**: alta de consultas (exploratorias `2.a`, con fecha bloqueada `2.b`, en cola `2.d`), y las transiciones de estado que el Gestor aplica sobre ellas (`2.a → 2.b`, `2.b → 2.c`, etc.). Modela el agregado RESERVA en sus sub-estados de consulta, el bloqueo blando de fecha, la mecánica de cola de espera y el vaciado atómico de la misma. Es la capability central del pipeline de leads: las entidades RESERVA, FECHA_BLOQUEADA y AUDIT_LOG se crean o mutan siempre bajo el contexto RLS del tenant, con garantías de atomicidad y serialización dadas por PostgreSQL (`SELECT … FOR UPDATE` + `UNIQUE(tenant_id, fecha)`). Las automatizaciones A4 (barrido de TTL) y A16 (vaciado de cola al transicionar a `2.c`) se modelan como efectos de las transiciones, no como procesos independientes.
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

---

<!-- US-007 — 2026-06-30 -->

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
`FECHA_BLOQUEADA`. Los **emails automáticos** a los clientes de la cola (A16) son
**solo diseñados en MVP y NO se envían**; solo se implementa la **mecánica** del
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
PostgreSQL (no en lógica aplicativa ni locks distribuidos). (Fuente: `US-007
§Concurrencia / Race Conditions`; `CLAUDE.md §Testing`, `§Regla crítica`.)

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

### Requirement: Barrido periódico protegido de expiración por TTL agotado (A4/A5/A21/A21b)

El sistema SHALL (DEBE) exponer un **endpoint interno protegido de barrido** que, al
ser invocado, seleccione todas las RESERVA con `ttl_expiracion < now()` **AND**
(`sub_estado ∈ {'2b','2c','2v'}` **OR** `estado = 'pre_reserva'`) y procese la
expiración de cada una. El endpoint SHALL (DEBE) autenticarse **service-to-service**
mediante la cabecera `X-Cron-Token` (comparada con `CRON_TOKEN` del entorno); NO DEBE
ser accesible con JWT de usuario ni desde el exterior. Un **cron scheduler**
(`@nestjs/schedule`) lo invoca periódicamente siguiendo el patrón obligatorio "estado
en fila + barrido periódico" (nunca Lambda/EventBridge ni timers exactos). La
selección de candidatas SHALL (DEBE) comparar **instantes** (`timestamptz`), nunca
fechas formateadas. El endpoint DEBE devolver un **resumen** del barrido (candidatas,
expiradas, promociones disparadas, fallos aislados). (Fuente: `US-012 §Trigger`,
`§Reglas de negocio`, `§Reglas de Validación`; `CLAUDE.md §Jobs asíncronos`; skill
`async-jobs`; `us-041 design.md §D-9`.)

#### Scenario: El cron invoca el endpoint con token válido y barre las candidatas

- **GIVEN** una o más RESERVA con `ttl_expiracion < now()` en `sub_estado ∈
  {'2b','2c','2v'}` o `estado = 'pre_reserva'` para uno o varios tenants
- **WHEN** el cron invoca el endpoint de barrido con la cabecera `X-Cron-Token` válida
- **THEN** el sistema procesa la expiración de cada candidata bajo el contexto RLS de
  su tenant
- **AND** devuelve un resumen con el nº de candidatas, expiradas, promociones
  disparadas y fallos aislados

#### Scenario: Llamada sin token o con token inválido se rechaza

- **GIVEN** una petición al endpoint de barrido sin `X-Cron-Token` o con un valor que
  no coincide con `CRON_TOKEN`
- **WHEN** el sistema recibe la petición
- **THEN** la rechaza con error de autorización (401)
- **AND** no procesa ninguna expiración

#### Scenario: La selección compara instantes, no fechas formateadas

- **GIVEN** una RESERVA cuyo `ttl_expiracion` es un instante anterior a `now()` pero
  cuya fecha formateada podría diferir por zona horaria
- **WHEN** el barrido evalúa las candidatas
- **THEN** la inclusión se decide por el instante `ttl_expiracion < now()`
  (`timestamptz`), sin depender de ningún formateo de fecha

### Requirement: Expiración en 2.b sin cola transiciona a 2.x y libera la fecha (A4)

El sistema SHALL (DEBE), por cada RESERVA candidata en `sub_estado = '2b'` sin ninguna
RESERVA en `sub_estado = '2d'` apuntándola, ejecutar en una **transacción atómica**:
transicionar la RESERVA a `sub_estado = '2x'`, **liberar** la fila de `FECHA_BLOQUEADA`
de esa RESERVA reutilizando `liberarFecha()` (US-041) con causa `TTL`, y registrar en
`AUDIT_LOG` una entrada con `accion = 'transicion'`, `entidad = 'RESERVA'`,
`datos_anteriores.sub_estado = '2b'` y `datos_nuevos.sub_estado = '2x'`. La transición
se modela en la **máquina de estados declarativa** (no `if` dispersos). Tras la
expiración, el sistema DEBE dejar constancia para una **alerta interna** al gestor
("Consulta [código] expirada. Fecha [fecha] liberada."), sin enviar email al cliente
(fuera de MVP). (Fuente: `US-012 §Happy Path — 2.b sin cola`, `§Email relacionado`;
UC-09; A4.)

#### Scenario: Consulta en 2.b sin cola expira a 2.x y libera la fecha

- **GIVEN** una RESERVA en `sub_estado = '2b'`, `ttl_expiracion < now()`, sin ninguna
  RESERVA en `sub_estado = '2d'` apuntándola
- **WHEN** el barrido procesa la expiración de esa RESERVA
- **THEN** en una transacción atómica la RESERVA pasa a `sub_estado = '2x'` y la fila
  de `FECHA_BLOQUEADA` con `reserva_id` de esa RESERVA se elimina
- **AND** se registra en `AUDIT_LOG` `accion = 'transicion'`, `entidad = 'RESERVA'`,
  `datos_anteriores.sub_estado = '2b'`, `datos_nuevos.sub_estado = '2x'`
- **AND** el sistema deja constancia para la alerta interna al gestor, sin email al
  cliente

### Requirement: Expiración en 2.b con cola transiciona a 2.x y dispara la promoción (A4 + A15/US-018)

El sistema SHALL (DEBE), por cada RESERVA candidata en `sub_estado = '2b'` que es
`consulta_bloqueante` de una o más RESERVA en `sub_estado = '2d'`, ejecutar la misma
expiración atómica (RESERVA → `2x`, `FECHA_BLOQUEADA` liberada, auditoría) y, tras
liberar, **disparar exactamente una vez** el seam de promoción de cola
(`PromocionColaPort.promoverPrimeroEnCola()`, US-041) para esa `(tenant, fecha)`. La
**reordenación FIFO de la cola, el re-bloqueo de la promovida (nueva fila en
`FECHA_BLOQUEADA` con `tipo_bloqueo = 'blando'` y su TTL) y el decremento de
`posicion_cola` (mecánica A15/UC-12) son responsabilidad de US-018** y quedan **fuera
de alcance** de este change; hasta que US-018 se implemente, el seam es un stub no-op
documentado que deja la cola intacta en `2.d` (deuda técnica ligada a US-018). US-012
solo **garantiza el trigger** exactamente-una-vez. (Fuente: `US-012 §Happy Path — 2.b
con cola`, `§Notas`; A4, A15; `us-041 design.md §D-2`.)

#### Scenario: Expiración en 2.b con cola libera la fecha y dispara la promoción una vez

- **GIVEN** una RESERVA en `sub_estado = '2b'`, `ttl_expiracion < now()`, que es
  `consulta_bloqueante` de N RESERVA en `sub_estado = '2d'`
- **WHEN** el barrido procesa la expiración de esa RESERVA
- **THEN** la RESERVA pasa a `sub_estado = '2x'` y su fila de `FECHA_BLOQUEADA` se
  elimina en la misma transacción
- **AND** el seam `PromocionColaPort.promoverPrimeroEnCola()` se invoca exactamente una
  vez para esa `(tenant, fecha)`
- **AND** la reordenación real de la cola y el re-bloqueo de la promovida quedan
  delegados a US-018 (no los ejecuta este change)

### Requirement: Expiración en 2.c transiciona a 2.x y libera la fecha (A4, sin cola posible)

El sistema SHALL (DEBE), por cada RESERVA candidata en `sub_estado = '2c'`, ejecutar la
expiración atómica: RESERVA → `sub_estado = '2x'`, `FECHA_BLOQUEADA` liberada (causa
`TTL`) y auditoría. El sistema NO DEBE disparar promoción de cola para `2.c`: la cola
se vació de forma irreversible al transicionar a `2.c` (mecánica A16/US-007), por lo
que no puede existir cola activa. (Fuente: `US-012 §Happy Path — 2.c`; US-007 vaciado
A16.)

#### Scenario: Consulta en 2.c expira a 2.x sin promoción de cola

- **GIVEN** una RESERVA en `sub_estado = '2c'` con `ttl_expiracion < now()`
- **WHEN** el barrido procesa su expiración
- **THEN** la RESERVA pasa a `sub_estado = '2x'`, su fila de `FECHA_BLOQUEADA` se
  elimina y se registra la auditoría de la transición
- **AND** el seam de promoción de cola NO se invoca (no hay cola posible en `2.c`)

### Requirement: Expiración en 2.v transiciona a 2.x y libera la fecha, con promoción si hereda cola (A21)

El sistema SHALL (DEBE), por cada RESERVA candidata en `sub_estado = '2v'` (bloqueo
hasta el día post-visita agotado), ejecutar la expiración atómica: RESERVA →
`sub_estado = '2x'`, `FECHA_BLOQUEADA` liberada (causa `TTL`) y auditoría. Si la
RESERVA **heredó cola** desde `2.b` (posible cuando llegó a `2.v` sin vaciarla) —esto
es, existe una o más RESERVA en `sub_estado = '2d'` apuntándola—, el sistema DEBE
disparar el seam de promoción (US-018) exactamente una vez; en caso contrario NO lo
dispara. (Fuente: `US-012 §Happy Path — 2.v`; A21.)

#### Scenario: Consulta en 2.v sin cola heredada expira a 2.x sin promoción

- **GIVEN** una RESERVA en `sub_estado = '2v'` con `ttl_expiracion < now()` sin ninguna
  RESERVA en `2.d` apuntándola
- **WHEN** el barrido procesa su expiración
- **THEN** la RESERVA pasa a `sub_estado = '2x'`, la fila de `FECHA_BLOQUEADA` se
  elimina y no se dispara promoción

#### Scenario: Consulta en 2.v con cola heredada expira a 2.x y dispara la promoción

- **GIVEN** una RESERVA en `sub_estado = '2v'` con `ttl_expiracion < now()` que es
  `consulta_bloqueante` de al menos una RESERVA en `2.d`
- **WHEN** el barrido procesa su expiración
- **THEN** la RESERVA pasa a `sub_estado = '2x'`, la fila de `FECHA_BLOQUEADA` se
  elimina y el seam de promoción se invoca exactamente una vez

### Requirement: Expiración en pre_reserva cancela la reserva y libera la fecha (A5)

El sistema SHALL (DEBE), por cada RESERVA candidata en `estado = 'pre_reserva'` (p. ej.
7 días sin justificante de señal), ejecutar en una **transacción atómica**: actualizar
`estado = 'reserva_cancelada'` y `sub_estado = NULL`, **liberar** la fila de
`FECHA_BLOQUEADA` de esa RESERVA (causa `TTL`) y registrar en `AUDIT_LOG` `accion =
'transicion'`, `datos_anteriores.estado = 'pre_reserva'`, `datos_nuevos.estado =
'reserva_cancelada'`. El sistema NO DEBE disparar promoción de cola: al pasar a
`pre_reserva` la cola se vació (A16/US-007 o UC-14), por lo que es imposible tener cola
activa. (Fuente: `US-012 §Happy Path — pre_reserva`, `§FA pre_reserva expirada sin
cola`; A5.)

#### Scenario: Pre-reserva expira a reserva_cancelada y libera la fecha sin promoción

- **GIVEN** una RESERVA en `estado = 'pre_reserva'` con `ttl_expiracion < now()`
- **WHEN** el barrido procesa su expiración
- **THEN** en una transacción atómica la RESERVA pasa a `estado = 'reserva_cancelada'`,
  `sub_estado = NULL`, y su fila de `FECHA_BLOQUEADA` se elimina
- **AND** se registra en `AUDIT_LOG` `accion = 'transicion'`,
  `datos_anteriores.estado = 'pre_reserva'`, `datos_nuevos.estado = 'reserva_cancelada'`
- **AND** el seam de promoción de cola NO se invoca (imposible tener cola en
  `pre_reserva`)

### Requirement: Guarda de origen declarativa — solo estados candidatos expiran; los terminales son inmutables

El sistema SHALL (DEBE) determinar el estado terminal de cada expiración mediante una
**estructura de datos declarativa** (mapa de transiciones por TTL, no condicionales
dispersos): `{consulta, 2b} → {consulta, 2x}`, `{consulta, 2c} → {consulta, 2x}`,
`{consulta, 2v} → {consulta, 2x}`, `{pre_reserva} → {reserva_cancelada, NULL}`.
Cualquier RESERVA que **no** esté en un estado candidato —incluidos los terminales
`2x`, `2y`, `2z`, `reserva_cancelada`, `reserva_completada` (inmutables), o cualquier
otro estado activo— NO DEBE ser expirada aunque su `ttl_expiracion < now()`. La guarda
de origen se evalúa **dentro** de la transacción de cada RESERVA para que un reintento
re-evalúe con el estado ya actualizado. (Fuente: `US-012 §Reglas de negocio`, `§Reglas
de Validación`; `CLAUDE.md §Máquina de estados`; skill `state-machine`.)

#### Scenario: El mapa declarativo resuelve el estado terminal de cada origen

- **GIVEN** una RESERVA candidata en `2b`, `2c`, `2v` o `pre_reserva`
- **WHEN** el barrido determina su estado terminal
- **THEN** devuelve `2x` para `2b`/`2c`/`2v` y `reserva_cancelada` (sub_estado NULL)
  para `pre_reserva`, consultando la tabla declarativa (no `if` dispersos)

#### Scenario: Una RESERVA en estado terminal no se expira aunque su TTL esté vencido

- **GIVEN** una RESERVA en un estado terminal (`2x`, `2y`, `2z`, `reserva_cancelada` o
  `reserva_completada`) con `ttl_expiracion < now()`
- **WHEN** el barrido evalúa las candidatas
- **THEN** la RESERVA no es seleccionada ni modificada (la guarda de origen la excluye)

### Requirement: Atomicidad por RESERVA y aislamiento de fallos en el lote

El sistema SHALL (DEBE) ejecutar, por cada RESERVA procesada, la transición de estado +
la liberación de `FECHA_BLOQUEADA` + (si aplica) el disparo de promoción como una
operación **all-or-nothing** dentro de una transacción serializada por `SELECT … FOR
UPDATE` sobre la fila bloqueante, bajo el contexto RLS del tenant. El barrido SHALL
(DEBE) procesar **cada RESERVA en su propia transacción independiente**: el fallo de
una expiración (excepción, guarda, conflicto) NO DEBE abortar ni revertir las demás; el
resumen del barrido registra los fallos aislados. Reutiliza la semántica de lote de
`LiberarFechasEnLoteService` (US-041). (Fuente: `US-012 §Reglas de negocio`, `§FA doble
expiración parcial`; `CLAUDE.md §Regla crítica`; `us-041 §Barrido en lote`.)

#### Scenario: Un fallo parcial en una candidata no revierte las demás

- **GIVEN** un barrido con N candidatas donde la expiración de una falla
- **WHEN** el sistema procesa el lote
- **THEN** cada candidata se procesa en su propia transacción independiente
- **AND** el fallo de una no revierte ni impide la expiración de las demás
- **AND** el resumen del barrido refleja la candidata fallida como fallo aislado

#### Scenario: Un fallo dentro de la transacción de una RESERVA revierte solo esa

- **GIVEN** una candidata cuya liberación de `FECHA_BLOQUEADA` falla tras actualizar el
  sub_estado en la misma transacción
- **WHEN** ocurre el fallo antes del commit
- **THEN** la transacción de esa RESERVA hace rollback completo (sub_estado y
  `FECHA_BLOQUEADA` sin cambios)
- **AND** las demás candidatas del lote no se ven afectadas

### Requirement: Idempotencia del barrido — N ejecuciones = 1 sola transición

El sistema SHALL (DEBE) ser idempotente: si el barrido se ejecuta varias veces sobre la
misma RESERVA, solo la primera la transiciona (mientras es candidata); las siguientes
no la encuentran en un estado candidato (ya está en el terminal) y NO producen ninguna
modificación ni entradas duplicadas en `AUDIT_LOG`. El `DELETE` de `FECHA_BLOQUEADA`
con 0 filas afectadas es **éxito silencioso** (US-041), de modo que la ausencia de la
fila no genera error. (Fuente: `US-012 §FA Idempotencia`, `§FA doble expiración
parcial`, `§Reglas de Validación`; US-041 idempotencia.)

#### Scenario: Segunda ejecución del barrido sobre una RESERVA ya expirada no hace nada

- **GIVEN** una RESERVA que ya fue expirada a `2x` en una ejecución anterior del barrido
- **WHEN** el barrido se ejecuta de nuevo y la evalúa
- **THEN** la RESERVA no está en un estado candidato y no se modifica
- **AND** no se generan registros duplicados en `AUDIT_LOG`

#### Scenario: RESERVA candidata con FECHA_BLOQUEADA ya eliminada se expira sin error

- **GIVEN** una RESERVA todavía en `sub_estado = '2b'` con `ttl_expiracion < now()`
  cuya fila de `FECHA_BLOQUEADA` fue eliminada por un fallo previo (expiración parcial)
- **WHEN** el barrido procesa su expiración
- **THEN** la RESERVA pasa a `sub_estado = '2x'`
- **AND** el `DELETE` de `FECHA_BLOQUEADA` afecta a 0 filas y es éxito silencioso, sin
  lanzar error (operación idempotente respecto a la ausencia de la fila)

### Requirement: El TTL extendido manualmente antes del barrido prevalece sobre la expiración

El sistema SHALL (DEBE), cuando el gestor ha extendido el `ttl_expiracion` de una
RESERVA (US-006) antes de que el barrido la evalúe, **no** expirarla si tras la
extensión `ttl_expiracion` ya no es `< now()`: la RESERVA deja de ser candidata y no se
modifica. La extensión manual prevalece sobre la expiración automática. (Fuente:
`US-012 §FA TTL extendido manualmente antes del barrido`, `§RC-2`; US-006.)

#### Scenario: TTL extendido saca la RESERVA del conjunto de candidatas

- **GIVEN** una RESERVA cuyo `ttl_expiracion` fue extendido por el gestor de modo que
  ahora es `> now()`
- **WHEN** el barrido evalúa las candidatas
- **THEN** la RESERVA no es seleccionada y no se modifica (la extensión prevalece)

### Requirement: Concurrencia — doble ejecución del cron sobre la misma RESERVA (RC-1)

El sistema SHALL (DEBE) garantizar que, ante dos ejecuciones concurrentes del barrido
que intentan expirar simultáneamente la misma RESERVA (p. ej. por reinicio del
proceso), **exactamente una** aplique la transición: la primera transacción actualiza
`sub_estado = '2x'` (o `estado = 'reserva_cancelada'`); la segunda, dentro de su propia
transacción, no encuentra la RESERVA en un estado candidato y **no actúa**, sin efectos
duplicados. La garantía es determinista y reside en el motor de PostgreSQL (`SELECT …
FOR UPDATE` + re-evaluación de la guarda dentro de la transacción), no en lógica
aplicativa ni locks distribuidos. Esta zona crítica se cubre con **TDD primero** (skill
`concurrency-locking`). (Fuente: `US-012 §RC-1`; `CLAUDE.md §Testing`, `§Regla
crítica`.)

#### Scenario: Dos barridos simultáneos — una transición, cero duplicados

- **GIVEN** dos ejecuciones concurrentes del barrido sobre la misma RESERVA en `2b` con
  `ttl_expiracion < now()`
- **WHEN** ambas intentan actualizar su `sub_estado` de `2b` a `2x` en la misma ventana
- **THEN** exactamente una transacción tiene éxito y deja la RESERVA en `2x`
- **AND** la otra, al re-evaluar la guarda de origen dentro de su transacción, no
  encuentra la RESERVA en `2b` y no realiza ninguna modificación ni auditoría duplicada

### Requirement: Concurrencia — expiración vs extensión manual concurrente (RC-2)

El sistema SHALL (DEBE) garantizar que, ante una expiración del barrido y una extensión
manual del TTL (US-006) sobre la misma RESERVA ejecutándose al mismo instante,
**exactamente una** tenga éxito y **nunca** quede un estado intermedio inconsistente: si
la expiración commitea primero, la extensión falla de forma controlada (la RESERVA ya
está en `2x`/`reserva_cancelada`, inmutable); si la extensión commitea primero, la
expiración no encuentra la RESERVA como candidata (`ttl_expiracion` ya no `< now()`) y
no actúa. La serialización la provee `SELECT … FOR UPDATE` sobre la fila bloqueante.
Zona crítica cubierta con **TDD primero**. (Fuente: `US-012 §RC-2`; US-006
concurrencia; `CLAUDE.md §Testing`.)

#### Scenario: Expiración y extensión compiten — resultado coherente sin estado intermedio

- **GIVEN** una RESERVA en `2b` en el límite de su vencimiento, con una expiración del
  barrido y una extensión manual (US-006) compitiendo por la misma fila bloqueante
- **WHEN** ambas transacciones se ejecutan concurrentemente
- **THEN** o bien la expiración gana (RESERVA en `2x`, fecha liberada) y la extensión se
  rechaza porque la RESERVA ya no está en un estado extensible
- **AND** o bien la extensión gana (TTL extendido, bloqueo vigente) y la expiración no
  selecciona la RESERVA porque `ttl_expiracion` ya no es `< now()`
- **AND** en ningún caso queda un estado intermedio observable

### Requirement: Concurrencia — expiración vs nuevo bloqueo de la misma fecha (RC-3)

El sistema SHALL (DEBE) garantizar que, cuando la expiración elimina la fila de
`FECHA_BLOQUEADA` liberando una fecha y, concurrentemente, un nuevo lead solicita
bloquear esa misma `(tenant_id, fecha)`, ambas operaciones sean correctas y **nunca**
coexistan dos bloqueos activos: o la expiración commitea primero (la fecha queda libre
y el nuevo lead puede bloquearla), o el nuevo bloqueo no puede insertar hasta que la
expiración commitea. La restricción `UNIQUE(tenant_id, fecha)` (US-040) previene
duplicados y la serialización la provee el motor de PostgreSQL. Zona crítica cubierta
con **TDD primero**. (Fuente: `US-012 §RC-3`; US-040 `UNIQUE(tenant_id, fecha)`;
`er-diagram.md §5.3`.)

#### Scenario: Liberación por expiración y nuevo bloqueo no producen doble bloqueo

- **GIVEN** una expiración que libera la fila de `FECHA_BLOQUEADA` de `(T, D)` y,
  simultáneamente, un nuevo lead que solicita bloquear `(T, D)`
- **WHEN** ambas operaciones ocurren en una ventana solapada
- **THEN** o la expiración completa primero y el nuevo bloqueo hace INSERT exitoso, o el
  nuevo bloqueo espera hasta que la expiración commitea
- **AND** en ningún momento existen dos bloqueos activos para `(T, D)` (lo previene
  `UNIQUE(tenant_id, fecha)`)

### Requirement: Promoción automática FIFO del primero en cola al liberarse la fecha (A15/UC-12)

El sistema SHALL (DEBE), cuando `liberarFecha()` (US-012/US-041) dispara el seam
`PromocionColaPort.promoverPrimeroEnCola({ tenantId, fecha })` para una `(tenant, fecha)`
con cola activa, ejecutar la **promoción FIFO estricta** del primero en cola: seleccionar
la RESERVA en `sub_estado = '2d'` con `posicion_cola = 1` cuyo `consulta_bloqueante_id`
era la RESERVA cuya fecha se acaba de liberar, y transicionarla a `sub_estado = '2b'`. El
seam DEBE dejar de ser un stub no-op (deuda US-018 de `us-041 §D-2`) y pasar a ejecutar la
mecánica real A15. La transición `{consulta,2d} → {consulta,2b}` DEBE modelarse en la
**máquina de estados declarativa** (`maquina-estados.ts`, tabla de datos, NO `if`
dispersos). (Fuente: `US-018 §Historia`, `§Reglas de negocio`, `§Happy Path`; UC-12; A15;
`us-041 design.md §D-2`; `CLAUDE.md §Máquina de estados`.)

#### Scenario: Liberada la fecha, el primero en cola es promovido a 2.b

- **GIVEN** una RESERVA R1 (bloqueante) cuya `FECHA_BLOQUEADA` se acaba de liberar, y una
  RESERVA R2 en `sub_estado = '2d'`, `posicion_cola = 1`, `consulta_bloqueante_id = R1.id`
- **WHEN** `liberarFecha()` dispara el seam de promoción para esa `(tenant, fecha)`
- **THEN** R2 pasa a `sub_estado = '2b'`, `posicion_cola → NULL`,
  `consulta_bloqueante_id → NULL`, `ttl_expiracion → now() + tenant_settings.ttl_consulta_dias`
- **AND** la promoción usa la transición declarativa `{consulta,2d} → {consulta,2b}` de la
  máquina de estados

### Requirement: Re-creación atómica del bloqueo blando para la RESERVA promovida (bloquearFecha)

El sistema SHALL (DEBE), como parte indivisible de la promoción, **re-crear la fila de
`FECHA_BLOQUEADA`** para la RESERVA promovida reutilizando la primitiva atómica existente
`bloquearFecha()` (US-040): `reserva_id → <promovida>`, `tipo_bloqueo = 'blando'`,
`ttl_expiracion = now() + tenant_settings.ttl_consulta_dias`. La atomicidad y la no-doble-
reserva las provee **exclusivamente PostgreSQL**: `UNIQUE(tenant_id, fecha)` +
`SELECT … FOR UPDATE` vía Prisma `$queryRaw`. El sistema NO DEBE usar Redis, Redlock ni
locks distribuidos (regla crítica del proyecto). El `ttl_expiracion` DEBE calcularse y
compararse como **instante `timestamptz`** (`now() + ttl_consulta_dias`), nunca como fecha
formateada (evita el off-by-one de TZ conocido, deuda ajena). (Fuente: `US-018 §Reglas de
negocio`; `CLAUDE.md §Regla crítica: bloqueo atómico`; `er-diagram.md §5.3`; US-040.)

#### Scenario: La promoción re-bloquea la fecha con la primitiva atómica

- **GIVEN** una promoción en curso de R2 sobre la fecha D de un tenant T
- **WHEN** el sistema materializa el bloqueo de la promovida
- **THEN** se crea (o actualiza vía la primitiva) la fila de `FECHA_BLOQUEADA` de `(T, D)`
  con `reserva_id = R2.id`, `tipo_bloqueo = 'blando'` y
  `ttl_expiracion = now() + tenant_settings.ttl_consulta_dias`
- **AND** la restricción `UNIQUE(tenant_id, fecha)` garantiza que nunca coexisten dos
  bloqueos activos para `(T, D)`

### Requirement: Reordenación FIFO del resto de la cola tras la promoción

El sistema SHALL (DEBE), tras promover a `posicion_cola = 1`, **reordenar el resto de la
cola** en la misma transacción: cada RESERVA en `sub_estado = '2d'` restante DEBE
decrementar su `posicion_cola` en 1 y actualizar su `consulta_bloqueante_id` al id de la
nueva bloqueante (la RESERVA promovida). El sistema DEBE preservar la unicidad
`UNIQUE(tenant_id, consulta_bloqueante_id, posicion_cola) WHERE posicion_cola IS NOT NULL`
(US-004): tras la reordenación las posiciones DEBEN ser contiguas empezando en 1. (Fuente:
`US-018 §Happy Path`, `§FA-03`; `er-diagram.md §Índices de cola`, `§decisión #16`.)

#### Scenario: Cola de más de dos elementos reordena y re-apunta a la nueva bloqueante

- **GIVEN** R1 liberada y R2 (`posicion_cola = 1`), R3 (`posicion_cola = 2`), R4
  (`posicion_cola = 3`) apuntando a R1
- **WHEN** se ejecuta la promoción
- **THEN** R2 → `2b` (nueva bloqueante, `posicion_cola → NULL`,
  `consulta_bloqueante_id → NULL`)
- **AND** R3: `posicion_cola → 1`, `consulta_bloqueante_id → R2.id`
- **AND** R4: `posicion_cola → 2`, `consulta_bloqueante_id → R2.id`
- **AND** `FECHA_BLOQUEADA.reserva_id → R2.id`

### Requirement: Promoción atómica all-or-nothing sin estado intermedio observable

El sistema SHALL (DEBE) ejecutar la promoción completa —transición de la promovida a `2b`
+ re-bloqueo de `FECHA_BLOQUEADA` + reordenación del resto de la cola + auditoría— como una
operación **all-or-nothing** dentro de **una única transacción** serializada por
`SELECT … FOR UPDATE` sobre la fila de `FECHA_BLOQUEADA` (y las RESERVA de cola), bajo el
contexto RLS del tenant de la fecha. NO DEBE existir ningún instante observable en que
`FECHA_BLOQUEADA` quede sin apuntar a una bloqueante viva ni en que la cola tenga un hueco
de posición. Si cualquier paso falla, la transacción hace rollback completo. (Fuente:
`US-018 §Reglas de Validación`, `§Happy Path` — atomicidad; `CLAUDE.md §Regla crítica`.)

#### Scenario: No hay ventana en que la fecha quede sin bloqueante viva

- **GIVEN** una promoción en curso de R2 sobre la fecha liberada de R1
- **WHEN** la transacción de promoción se ejecuta
- **THEN** en ningún instante observable `FECHA_BLOQUEADA.reserva_id` apunta a R1 (ya
  liberada/expirada) sin apuntar a la nueva bloqueante R2
- **AND** si algún paso falla antes del commit, todo se revierte (R2 sigue en `2d`, la
  cola conserva su orden, no hay fila de `FECHA_BLOQUEADA` a medio crear)

### Requirement: Cola de un único elemento — promoción deja la cola vacía

El sistema SHALL (DEBE), cuando la cola de la fecha liberada tiene un **único** elemento
(R2 en `posicion_cola = 1`), promover R2 a `2b` (`posicion_cola → NULL`,
`consulta_bloqueante_id → NULL`), re-crear `FECHA_BLOQUEADA` con `reserva_id = R2.id`, y
dejar la cola **vacía** sin ejecutar reordenación de restantes (no los hay). (Fuente:
`US-018 §FA-01`.)

#### Scenario: Cola de un elemento se vacía tras promover

- **GIVEN** R1 liberada y solo R2 en cola (`posicion_cola = 1`, `consulta_bloqueante_id = R1.id`)
- **WHEN** el seam ejecuta la promoción
- **THEN** R2 → `2b`, `posicion_cola → NULL`, `consulta_bloqueante_id → NULL`
- **AND** `FECHA_BLOQUEADA.reserva_id → R2.id`, la cola queda vacía
- **AND** `AUDIT_LOG` registra la transición de R2

### Requirement: Sin cola tras liberar — no se ejecuta promoción y la fecha queda libre

El sistema SHALL (DEBE), cuando `liberarFecha()` libera una fecha sin ninguna RESERVA en
`sub_estado = '2d'` apuntando a la bloqueante liberada, **NO** invocar la promoción: el
seam no se dispara (lo garantiza `hayColaActiva` en `liberarFecha()`, contrato heredado de
US-012/US-041 que US-018 NO modifica) y la fecha queda disponible. Si por cualquier motivo
el adaptador de promoción se invocara sin candidato en cola, DEBE ser un **no-op sin
error** (idempotencia defensiva). (Fuente: `US-018 §FA-02`; `us-041 §Seam de promoción`.)

#### Scenario: Liberación sin cola no promueve y no da error

- **GIVEN** R1 liberada sin ninguna RESERVA con `consulta_bloqueante_id = R1.id`
- **WHEN** el sistema completa la liberación
- **THEN** la promoción no se ejecuta (el seam no se dispara por ausencia de cola activa)
- **AND** `FECHA_BLOQUEADA` queda eliminada (fecha disponible), sin error del sistema

### Requirement: Idempotencia — guarda "ya promovida" evita doble promoción

El sistema SHALL (DEBE) ser idempotente frente a re-ejecuciones: dentro de la transacción,
tras adquirir el `SELECT … FOR UPDATE`, DEBE **re-verificar** que sigue existiendo un
candidato `posicion_cola = 1` pendiente de promover para esa `(tenant, fecha)` y que la
`FECHA_BLOQUEADA` no está ya apuntando a una bloqueante viva promovida. Si otra ejecución
ya promovió (segunda instancia del job, o promoción manual US-019), la transacción DEBE
**abortar sin cambios** (no-op silencioso), sin duplicar la promoción, sin decrementar dos
veces `posicion_cola` ni duplicar `AUDIT_LOG`. (Fuente: `US-018 §FA-04`, `§Supuestos`,
`§Reglas de Validación`.)

#### Scenario: Segunda ejecución del job sobre una fecha ya promovida no hace nada

- **GIVEN** una instancia del job ya promovió R2 y `FECHA_BLOQUEADA.reserva_id` ya es R2.id
- **WHEN** una segunda instancia intenta procesar el mismo tenant/fecha
- **THEN** la guarda "ya promovida" detecta que no hay bloqueante liberada pendiente ni un
  nuevo `posicion_cola = 1` que promover
- **AND** no realiza ningún cambio, sin error y sin duplicación en `AUDIT_LOG`

### Requirement: Anomalía de posiciones no contiguas — abortar y auditar sin corrección silenciosa

El sistema SHALL (DEBE), si al leer la cola bajo lock detecta que las `posicion_cola` del
conjunto no son **contiguas empezando en 1** (anomalía de datos), **registrar la
inconsistencia en `AUDIT_LOG`** y **abortar la transacción sin promover**. El sistema NO
DEBE aplicar corrección silenciosa de posiciones. (Fuente: `US-018 §Reglas de Validación`.)

#### Scenario: Cola con posiciones no contiguas aborta la promoción

- **GIVEN** una cola cuyas `posicion_cola` presentan un hueco (p. ej. 1, 3 sin 2)
- **WHEN** el sistema evalúa la cola bajo lock durante la promoción
- **THEN** registra la anomalía en `AUDIT_LOG` y aborta la transacción sin promover
- **AND** no corrige silenciosamente las posiciones

### Requirement: AUDIT_LOG de la promoción por cada RESERVA modificada

El sistema SHALL (DEBE) registrar en `AUDIT_LOG`, dentro de la misma transacción de la
promoción, una entrada `accion = 'transicion'`, `entidad = 'RESERVA'` **por cada RESERVA
modificada**: para la promovida con `datos_anteriores = {sub_estado: '2d'}` y
`datos_nuevos = {sub_estado: '2b', origen: 'promocion_automatica'}`; y para cada RESERVA
reordenada con su cambio de `posicion_cola`/`consulta_bloqueante_id`. NO DEBE duplicar la
auditoría de la liberación de la fecha bloqueante (esa la registra `liberarFecha()`,
`entidad = 'FECHA_BLOQUEADA'`, causa `TTL`/`descarte`/`cancelacion`). (Fuente: `US-018
§Reglas de negocio`, `§Happy Path`; US-041 auditoría de liberación.)

#### Scenario: Cada RESERVA modificada por la promoción deja su registro de auditoría

- **GIVEN** una promoción que mueve R2 a `2b` y reordena R3, R4
- **WHEN** la transacción de promoción confirma
- **THEN** `AUDIT_LOG` contiene una entrada `accion='transicion'`, `entidad='RESERVA'` para
  R2 con `datos_nuevos = {sub_estado: '2b', origen: 'promocion_automatica'}`
- **AND** una entrada por R3 y por R4 reflejando su nuevo `posicion_cola`/`consulta_bloqueante_id`
- **AND** no se duplica la entrada de liberación de `FECHA_BLOQUEADA` (la registró `liberarFecha()`)

### Requirement: Notificación de la promoción — alerta interna al gestor, sin email al cliente

El sistema SHALL (DEBE), al completar la promoción, dejar constancia de una **alerta interna
dirigida al gestor** ("Consulta [código] promovida al bloqueo de la fecha [fecha]; contactar
al cliente") para que el gestor proceda a comunicarse con la reserva promovida. El sistema
NO DEBE enviar email automático al cliente en MVP (el email "¡La fecha está disponible!" de
UC-12 paso 8 es `📐 Solo diseñado`, fuera de alcance); el adaptador de promoción NO DEBE
tocar el puerto de comunicaciones/email (US-045). Aplica el mismo patrón de **alerta interna
mínima** que la expiración (US-012 §D-10); la superficie de notificaciones/dashboard es de
**US-044**. El registro de la alerta DEBE ir **dentro de la misma transacción** de la
promoción y por tanto ser **idempotente** respecto a la guarda "ya promovida": una promoción
abortada por la guarda (re-ejecución o carrera) NO DEBE registrar alerta; N ejecuciones = 1
sola alerta. (Fuente: `US-018 §Email relacionado`, `§Notas de alcance`; gate SDD 01/07/2026
D-5; patrón `us-012 design.md §D-10`.)

#### Scenario: La promoción deja alerta interna al gestor y no envía email al cliente

- **GIVEN** una promoción efectiva de R2 a `2b`
- **WHEN** la transacción de promoción confirma
- **THEN** el sistema deja constancia de una alerta interna al gestor para contactar al
  cliente de R2
- **AND** NO se envía ningún email automático al cliente ni se invoca el puerto de
  comunicaciones/email (US-045)

#### Scenario: Una re-ejecución abortada por la guarda no duplica la alerta

- **GIVEN** una `(tenant, fecha)` ya promovida en una ejecución anterior
- **WHEN** una segunda ejecución intenta promover y aborta por la guarda "ya promovida"
- **THEN** no se registra ninguna alerta interna adicional (el registro es idempotente,
  ligado a la transacción de la promoción efectiva)

### Requirement: Concurrencia — dos instancias del job promueven exactamente una vez (RC-1)

El sistema SHALL (DEBE) garantizar que, ante dos ejecuciones concurrentes del barrido/job
sobre la misma `(tenant, fecha)` con la bloqueante liberada, **exactamente una** transacción
adquiera el `SELECT … FOR UPDATE` sobre la fila de `FECHA_BLOQUEADA` y complete la promoción
de R2 a `2b`; la segunda queda bloqueada hasta el `COMMIT` de la primera y entonces, al
re-evaluar bajo la guarda "ya promovida", detecta que `FECHA_BLOQUEADA` ya apunta a la nueva
bloqueante y **aborta sin cambios**. El resultado final es **exactamente una** promoción, sin
doble bloqueo ni doble decremento de `posicion_cola`. La garantía reside en PostgreSQL, no en
locks distribuidos. Zona crítica cubierta con **TDD primero** (skill `concurrency-locking`).
(Fuente: `US-018 §Race condition: dos instancias del job`; `CLAUDE.md §Testing`, `§Regla
crítica`.)

#### Scenario: Doble job concurrente — una promoción, cero duplicados

- **GIVEN** dos instancias del job sobre el mismo tenant/fecha con R1 liberada y R2 en
  `posicion_cola = 1`
- **WHEN** ambas intentan adquirir `SELECT … FOR UPDATE` sobre la fila de `FECHA_BLOQUEADA`
- **THEN** exactamente una adquiere el lock y completa la promoción de R2 a `2b`
- **AND** la segunda, tras el commit de la primera, re-evalúa, detecta el estado ya
  promovido y aborta sin cambios (sin doble bloqueo ni doble decremento)

### Requirement: Concurrencia — barrido TTL (US-012) vs promoción sobre la misma fecha (RC-2)

El sistema SHALL (DEBE) garantizar que el barrido de expiración de TTL (US-012), que libera
la fecha y dispara el seam, y la promoción que ese seam ejecuta se serialicen sobre la fila
de `FECHA_BLOQUEADA`: como la promoción se dispara **post-commit** de la liberación (contrato
heredado de US-012/US-041, exactamente-una-vez cuando el DELETE afectó 1 fila), NO existe
condición de carrera en que la promoción re-cree el bloqueo antes de que la liberación lo
elimine. Si un segundo barrido concurrente intenta expirar/promover la misma fecha, la
serialización por `SELECT … FOR UPDATE` + la guarda "ya promovida" garantizan que la fecha
nunca queda con doble bloqueo ni con la cola avanzada dos veces. Zona crítica cubierta con
**TDD primero**. (Fuente: `US-018 §Race condition` (implícita en encadenado UC-09→UC-12);
`us-012 §D-4`, `§D-5`; `CLAUDE.md §Testing`.)

#### Scenario: Liberación y promoción encadenadas no producen doble bloqueo

- **GIVEN** el barrido de TTL libera la fecha de R1 (DELETE afecta 1 fila) y dispara el seam
- **WHEN** la promoción re-crea `FECHA_BLOQUEADA` para R2 post-commit de la liberación
- **THEN** la secuencia liberar→promover es serializada: en ningún instante coexisten la fila
  de R1 y la de R2 para la misma `(tenant, fecha)`
- **AND** un segundo barrido concurrente sobre la misma fecha aborta por la guarda "ya
  promovida" sin re-promover

### Requirement: Concurrencia — coordinación con la promoción manual del Gestor (US-019, RC-3)

El sistema SHALL (DEBE) coordinar la promoción automática con la **futura promoción manual**
del Gestor (US-019) de modo que **nunca** se produzca doble promoción sobre la misma
`(tenant, fecha)`: ambas rutas DEBEN adquirir el `SELECT … FOR UPDATE` sobre la fila de
`FECHA_BLOQUEADA` y re-evaluar la guarda "ya promovida" dentro de la transacción. La primera
en adquirir el lock completa la promoción; la segunda, al obtener el lock, detecta el estado
ya actualizado y **aborta sin inconsistencia**. Cuando la que falla es la acción del Gestor
(US-019), el sistema DEBE poder devolverle un mensaje de error ("La cola ya fue actualizada
automáticamente"). US-018 **define y respeta la guarda de coordinación**; la superficie de la
acción manual y su mensaje son de US-019. Zona crítica cubierta con **TDD primero**. (Fuente:
`US-018 §Race condition: barrido automático vs. promoción manual`.)

#### Scenario: Job automático y Gestor compiten — una promoción, la otra ruta aborta limpio

- **GIVEN** el barrido automático y la acción del Gestor (US-019) inician a la vez una
  promoción sobre la misma fecha con R1 liberada
- **WHEN** ambas intentan adquirir `SELECT … FOR UPDATE` sobre `FECHA_BLOQUEADA`
- **THEN** la primera en adquirir el lock completa la promoción de R2
- **AND** la segunda, al obtener el lock, detecta la guarda "ya promovida" y aborta sin
  inconsistencia; si es el Gestor quien falla, la superficie de US-019 puede informar "La cola
  ya fue actualizada automáticamente"

### Requirement: Visualización de la cola de espera de una fecha (bloqueante + cola FIFO, UC-11)

El sistema SHALL (DEBE) ofrecer al Gestor autenticado una vista de **solo lectura** que,
dada la RESERVA **bloqueante** de una fecha (la que posee la `FECHA_BLOQUEADA` activa),
proyecte en una sola respuesta: (a) la **sección bloqueante** con su cliente, `sub_estado`
(uno de `2b`, `2c`, `2v`), TTL restante y código; y (b) la **cola de espera**: las RESERVA
en `sub_estado = '2d'` cuyo `consulta_bloqueante_id` apunta a la bloqueante, con su cliente,
código, posición y tiempo en cola. La vista NO muta estado (no promueve, no saca de cola,
no registra AUDIT_LOG). La lectura SHALL (DEBE) exponerse como `GET /reservas/{id}/cola`,
donde `{id}` es el `reservaId` de la bloqueante. (Fuente: `US-017 §Historia`, `§Happy Path`;
`use-cases.md` UC-11; `docs/api-spec.yml` `GET /reservas/{id}/cola`.)

#### Scenario: Fecha con bloqueante en 2.b y dos consultas en cola

- **GIVEN** una `FECHA_BLOQUEADA` para `2026-09-12` con bloqueante R1 en `sub_estado = '2b'`
  y `ttl_expiracion` mañana a las 10:00, y dos RESERVA en `sub_estado = '2d'`: R2
  (`posicion_cola = 1`, `consulta_bloqueante_id = R1.id`, creada hace 2 h) y R3
  (`posicion_cola = 2`, `consulta_bloqueante_id = R1.id`, creada hace 30 min)
- **WHEN** el Gestor solicita la cola de la fecha (a través de R1)
- **THEN** la respuesta incluye la sección bloqueante con el cliente de R1, `subEstado = '2b'`,
  el TTL restante (≈ 22 h) y el código de R1
- **AND** incluye la cola con R2 en posición 1 (tiempo en cola ≈ 2 h) y R3 en posición 2
  (tiempo en cola ≈ 30 min), cada una con nombre de cliente y código
- **AND** no se produce ninguna mutación de estado ni registro en AUDIT_LOG

### Requirement: Ordenación FIFO estricta y filtrado de la cola

El sistema SHALL (DEBE) devolver la cola **ordenada ascendentemente por `posicion_cola`**
(orden FIFO), NO por `fecha_creacion`. SHALL (DEBE) incluir en la cola **únicamente** las
RESERVA con `sub_estado = '2d'` **y** `consulta_bloqueante_id` igual al id de la bloqueante
activa de esa fecha; cualquier otro sub_estado (la propia bloqueante, terminales
`2x`/`2y`/`2z`, o consultas de otras fechas) SHALL (DEBE) quedar **excluido** de la lista.
(Fuente: `US-017 §Reglas de negocio`, `§Reglas de Validación`.)

#### Scenario: Solo se listan RESERVA en 2.d apuntando a la bloqueante, ordenadas por posición

- **GIVEN** una bloqueante R1 con RESERVA R2 (`2d`, `posicion_cola = 2`) y R3 (`2d`,
  `posicion_cola = 1`) apuntando a R1, más una RESERVA R4 en sub_estado terminal `2y`
  que antes estuvo en la cola
- **WHEN** el Gestor solicita la cola
- **THEN** la lista contiene exactamente R3 (posición 1) y luego R2 (posición 2), en ese
  orden ascendente
- **AND** R4 (sub_estado `2y`) NO aparece en la lista

### Requirement: Cálculo de TTL restante y tiempo en cola como instantes

El sistema SHALL (DEBE) calcular el **TTL restante** de la bloqueante como
`ttl_expiracion − now()` y el **tiempo en cola** de cada RESERVA en `2d` como
`now() − fecha_creacion`, operando sobre instantes `timestamptz` en el backend, NUNCA sobre
fechas formateadas (para no arrastrar el off-by-one de zona horaria conocido). El TTL restante
SHALL (DEBE) ser `null` cuando la bloqueante no tiene `ttl_expiracion`. (Fuente:
`US-017 §Reglas de negocio`, `§Reglas de Validación`; deuda TZ documentada.)

#### Scenario: El TTL restante y el tiempo en cola se derivan de instantes vigentes

- **GIVEN** una bloqueante con `ttl_expiracion` dentro de 22 h y una RESERVA en cola creada
  hace 30 min
- **WHEN** el Gestor solicita la cola
- **THEN** el TTL restante refleja ≈ 22 h calculado como `ttl_expiracion − now()`
- **AND** el tiempo en cola de esa RESERVA refleja ≈ 30 min calculado como
  `now() − fecha_creacion`

### Requirement: Fecha con bloqueante sin consultas en cola

El sistema SHALL (DEBE), cuando existe una bloqueante activa pero **ninguna** RESERVA en
`sub_estado = '2d'` apunta a ella, devolver la sección bloqueante y una cola **vacía**, de
modo que la vista muestre "Sin consultas en espera para esta fecha". (Fuente: `US-017 FA-01`.)

#### Scenario: FA-01 — bloqueante sin cola

- **GIVEN** una `FECHA_BLOQUEADA` con bloqueante R1 y ninguna RESERVA con
  `consulta_bloqueante_id = R1.id` en `sub_estado = '2d'`
- **WHEN** el Gestor solicita la cola
- **THEN** la respuesta incluye la sección bloqueante con los datos de R1
- **AND** la cola está vacía (la vista muestra "Sin consultas en espera para esta fecha")

### Requirement: Bloqueante en sub_estado 2.c o 2.v se proyecta correctamente

El sistema SHALL (DEBE) proyectar la sección bloqueante cuando esté en `sub_estado = '2c'`
(pendiente de invitados) o `sub_estado = '2v'` (visita programada), mostrando su
`sub_estado` real y su TTL vigente. Cuando la bloqueante está en `2v`, la respuesta SHALL
(DEBE) incluir además la `visita_programada_fecha`. La cola asociada se proyecta con el
mismo formato en todos los sub_estados de bloqueante. (Fuente: `US-017 FA-02`, `FA-03`,
`§Reglas de negocio`.)

#### Scenario: FA-02 — bloqueante en 2.c con una consulta en cola

- **GIVEN** una bloqueante R1 en `sub_estado = '2c'` con una RESERVA en cola
- **WHEN** el Gestor solicita la cola
- **THEN** la sección bloqueante muestra `subEstado = '2c'` y el TTL correcto
- **AND** la consulta en cola se muestra con el mismo formato (cliente, código, posición,
  tiempo en cola)

#### Scenario: FA-03 — bloqueante en 2.v con visita programada

- **GIVEN** una bloqueante R1 en `sub_estado = '2v'` con `visita_programada_fecha` definida
  y una consulta en cola
- **WHEN** el Gestor solicita la cola
- **THEN** la sección bloqueante muestra `subEstado = '2v'`, la `visitaProgramadaFecha` y el
  TTL vigente
- **AND** las consultas en cola se muestran ordenadas por posición igualmente

### Requirement: Fecha sin FECHA_BLOQUEADA activa (fecha disponible)

El sistema SHALL (DEBE), cuando la reserva `{id}` **no** posee una `FECHA_BLOQUEADA` activa
(no es bloqueante de ninguna fecha), responder de modo que la vista muestre "Fecha
disponible" sin sección de cola ni de bloqueante. La forma concreta de respuesta (200 con
indicador de "no bloqueada" vs. 404) la fija el contrato OpenAPI (ver `design.md D-3`);
en cualquier caso NO se muta estado. (Fuente: `US-017 FA-04`.)

#### Scenario: FA-04 — la reserva no bloquea ninguna fecha activa

- **GIVEN** una reserva cuya fecha no tiene registro activo en `FECHA_BLOQUEADA`
- **WHEN** el Gestor solicita la cola de esa fecha/reserva
- **THEN** la respuesta indica "Fecha disponible" (sin sección de cola ni de bloqueante),
  conforme al shape definido por el contrato
- **AND** no se produce ninguna mutación de estado

### Requirement: Cola con un único elemento

El sistema SHALL (DEBE) proyectar correctamente el caso de una cola con **un solo**
elemento: la bloqueante R1 y una única RESERVA en `2d` con `posicion_cola = 1`. (Fuente:
`US-017 FA-05`.)

#### Scenario: FA-05 — cola de un único elemento

- **GIVEN** una bloqueante R1 y una única RESERVA R2 en `sub_estado = '2d'`,
  `posicion_cola = 1`, `consulta_bloqueante_id = R1.id`
- **WHEN** el Gestor solicita la cola
- **THEN** la sección bloqueante muestra R1
- **AND** la cola contiene exactamente R2 en posición 1

### Requirement: Aislamiento multi-tenant en la lectura de la cola

La lectura de la cola SHALL (DEBE) filtrar **siempre** por el `tenant_id` del JWT activo,
reforzada por Row-Level Security (RLS). Una RESERVA bloqueante o una consulta en cola de otro
tenant SHALL (DEBE) ser **invisible** (la reserva `{id}` de otro tenant no se resuelve →
tratada como no encontrada). (Fuente: `US-017 §Contexto`; `CLAUDE.md` Multi-tenancy/RLS;
patrón de `ColaQueryPrismaAdapter` y `ReservaDetalleQueryPort`.)

#### Scenario: La cola de otro tenant no es alcanzable

- **GIVEN** una bloqueante y su cola pertenecientes al tenant "T-002"
- **WHEN** un Gestor con JWT del tenant "T-001" solicita esa cola
- **THEN** el sistema no expone ningún dato de "T-002" (la reserva se trata como no
  encontrada bajo RLS)

### Requirement: Acceso a la ficha de cada RESERVA de la cola

La vista de cola SHALL (DEBE) permitir al Gestor **acceder a la ficha completa** de la
bloqueante y de cualquier RESERVA de la cola, reutilizando la ficha existente
(`GET /reservas/{id}`, US-005). La respuesta de la cola SHALL (DEBE) incluir el `idReserva`
de cada elemento para habilitar ese enlace. (Fuente: `US-017 §Happy Path`.)

#### Scenario: Cada elemento de la cola enlaza a su ficha

- **GIVEN** una cola con R2 y R3
- **WHEN** el Gestor visualiza la cola
- **THEN** dispone del `idReserva` de R1, R2 y R3 para navegar a la ficha de cada una

### Requirement: Promoción manual de una consulta arbitraria de la cola por el Gestor (UC-12 FA manual)

El sistema SHALL (DEBE) permitir al Gestor autenticado **promover manualmente a bloqueante**
una RESERVA concreta de la cola (`sub_estado = '2d'`, **cualquier `posicion_cola`, no solo la
primera**) para la fecha de una consulta bloqueante. Al promoverla, el sistema DEBE
transicionar la RESERVA elegida `{consulta,2d} → {consulta,2b}` usando la **máquina de estados
declarativa** (`maquina-estados.ts`, tabla de datos, NO `if` dispersos), fijando
`posicion_cola → NULL`, `consulta_bloqueante_id → NULL` y `ttl_expiracion → now() +
tenant_settings.ttl_consulta_dias` (default 3, **derivado del setting, nunca hardcodeado**).
La acción es una **escritura deliberada del Gestor** disparada desde la vista de cola de
US-017, distinta de la promoción automática FIFO de US-018. (Fuente: `US-019 §Historia`,
`§Happy Path`, `§Reglas de negocio`; UC-12 flujo alternativo manual; `CLAUDE.md §Máquina de
estados`; US-018 transición `{consulta,2d}→{consulta,2b}`.)

#### Scenario: El Gestor promueve una consulta de la cola que no es la primera

- **GIVEN** una fecha con R1 como bloqueante (`sub_estado = '2b'`, TTL vigente), R2
  (`posicion_cola = 1`) y R3 (`posicion_cola = 2`) en cola apuntando a R1
- **WHEN** el Gestor selecciona R3, hace clic en "Promover a bloqueante" y confirma la acción
- **THEN** R3 pasa a `sub_estado = '2b'`, `posicion_cola → NULL`,
  `consulta_bloqueante_id → NULL`, `ttl_expiracion → now() + tenant_settings.ttl_consulta_dias`
- **AND** la promoción usa la transición declarativa `{consulta,2d} → {consulta,2b}`

#### Scenario: El Gestor promueve la primera de la cola (posicion_cola = 1)

- **GIVEN** R1 bloqueante, R2 (`posicion_cola = 1`), R3 (`posicion_cola = 2`)
- **WHEN** el Gestor selecciona R2 y confirma la promoción
- **THEN** R2 pasa a `sub_estado = '2b'` (nueva bloqueante, `posicion_cola → NULL`,
  `consulta_bloqueante_id → NULL`)

### Requirement: Expiración forzosa de la bloqueante activa antes de la promoción manual

El sistema SHALL (DEBE), como parte indivisible de la promoción manual, **expirar
forzosamente** la RESERVA que bloquea actualmente la fecha si sigue viva (`sub_estado ∈
{'2b','2c','2v'}`, con TTL vigente **o** ya vencido pero aún no procesado por el barrido
automático): `sub_estado → '2x'`, `ttl_expiracion → NULL`. Esta expiración reutiliza la
semántica terminal `2.x` de US-012 (consulta expirada), aplicada aquí de forma **deliberada
por el Gestor** (acción destructiva). Si la fecha **no** tiene bloqueante viva (ya
expirada/liberada), el sistema procede solo con la promoción sin expirar nada. (Fuente:
`US-019 §Reglas de negocio`, `§Happy Path`, `§FA-02`; US-012 semántica de `2.x`.)

#### Scenario: La bloqueante viva se expira a 2.x antes de promover

- **GIVEN** R1 bloqueante en `sub_estado = '2b'` con TTL vigente y R3 en cola
- **WHEN** el Gestor promueve R3 y confirma
- **THEN** R1 pasa a `sub_estado = '2x'`, `ttl_expiracion → NULL` (expirada forzosamente)
- **AND** la expiración de R1 y la promoción de R3 ocurren en la misma transacción

#### Scenario: Bloqueante con TTL ya vencido pero no barrida — se expira igualmente (FA-02)

- **GIVEN** R1 con `ttl_expiracion < now()` que el barrido automático aún no ha procesado
- **WHEN** el Gestor promueve manualmente una consulta de la cola
- **THEN** el sistema detecta que R1 ya expiró, la marca como `2.x` y ejecuta la promoción
  elegida por el Gestor
- **AND** el `SELECT … FOR UPDATE` sobre `FECHA_BLOQUEADA` evita que el barrido automático
  concurrente duplique la operación

### Requirement: Re-asignación atómica del bloqueo blando a la RESERVA promovida manualmente

El sistema SHALL (DEBE), como parte indivisible de la promoción manual, dejar la fila de
`FECHA_BLOQUEADA` de `(tenant, fecha)` apuntando a la RESERVA promovida:
`reserva_id → <promovida>`, `tipo_bloqueo = 'blando'`, `ttl_expiracion = now() +
tenant_settings.ttl_consulta_dias`, manteniendo **una sola fila activa** por `(tenant,
fecha)` en todo momento (nunca hay instante observable con la fecha libre). La atomicidad y la
no-doble-reserva las provee **exclusivamente PostgreSQL**: `UNIQUE(tenant_id, fecha)` +
`SELECT … FOR UPDATE` vía Prisma `$queryRaw`, reutilizando la primitiva `bloquearFecha()`
(US-040). El sistema NO DEBE usar Redis, Redlock ni locks distribuidos. El `ttl_expiracion`
DEBE calcularse/compararse como **instante `timestamptz`**, nunca como fecha formateada.
(Fuente: `US-019 §Reglas de negocio`; `CLAUDE.md §Regla crítica: bloqueo atómico`;
`er-diagram.md §5.3`; US-040.)

#### Scenario: La promoción manual deja la fecha bloqueada por la promovida

- **GIVEN** una promoción manual en curso de R3 sobre la fecha D de un tenant T (R1 bloqueante
  actual)
- **WHEN** el sistema materializa el bloqueo de la promovida
- **THEN** la fila de `FECHA_BLOQUEADA` de `(T, D)` queda con `reserva_id = R3.id`,
  `tipo_bloqueo = 'blando'` y `ttl_expiracion = now() + tenant_settings.ttl_consulta_dias`
- **AND** la restricción `UNIQUE(tenant_id, fecha)` garantiza que nunca coexisten dos bloqueos
  activos para `(T, D)`

### Requirement: Reordenación de la cola por cierre del hueco tras la promoción manual

El sistema SHALL (DEBE), tras promover una RESERVA en `posicion_cola = P`, **reordenar la cola
cerrando el hueco** en la misma transacción: cada RESERVA en `sub_estado = '2d'` restante con
`posicion_cola > P` DEBE decrementar su `posicion_cola` en 1; todas las RESERVA restantes de
la cola (las de posición `< P` no cambian de posición) DEBEN actualizar su
`consulta_bloqueante_id` al id de la nueva bloqueante (la promovida). El sistema DEBE preservar
la unicidad `UNIQUE(tenant_id, consulta_bloqueante_id, posicion_cola) WHERE posicion_cola IS
NOT NULL` (US-004): tras la reordenación las posiciones DEBEN ser contiguas empezando en 1. Si
al leer la cola bajo lock las posiciones no son contiguas (anomalía de datos), el sistema DEBE
registrar la inconsistencia en `AUDIT_LOG` y **abortar sin corrección silenciosa** (mismo
criterio que US-018). (Fuente: `US-019 §Happy Path`, `§FA-01`, `§FA-03`; `er-diagram.md
§Índices de cola`; US-018 reordenación FIFO.)

#### Scenario: Promover una posición intermedia cierra el hueco y re-apunta a la nueva bloqueante

- **GIVEN** R1 bloqueante, R2 (`posicion_cola = 1`) y R3 (`posicion_cola = 2`) apuntando a R1
- **WHEN** el Gestor promueve R3
- **THEN** R3 → `2b` (nueva bloqueante, `posicion_cola → NULL`, `consulta_bloqueante_id → NULL`)
- **AND** R2: `posicion_cola → 1` (cierra el hueco de R3), `consulta_bloqueante_id → R3.id`
- **AND** las posiciones de la cola quedan contiguas empezando en 1

#### Scenario: Cola de un único elemento queda vacía tras la promoción (FA-03)

- **GIVEN** R1 bloqueante y solo R2 en cola (`posicion_cola = 1`, `consulta_bloqueante_id = R1.id`)
- **WHEN** el Gestor promueve R2
- **THEN** R1 → `2x`; R2 → `2b`; `FECHA_BLOQUEADA.reserva_id → R2.id`; la cola queda vacía

### Requirement: Promoción manual atómica all-or-nothing sin estado intermedio observable

El sistema SHALL (DEBE) ejecutar la promoción manual completa —expiración forzosa de la
bloqueante a `2x` + transición de la promovida a `2b` + re-asignación de `FECHA_BLOQUEADA` +
reordenación de la cola + auditoría— como una operación **all-or-nothing** dentro de **una
única transacción** serializada por `SELECT … FOR UPDATE` sobre la fila de `FECHA_BLOQUEADA`,
bajo el contexto RLS del tenant del Gestor. NO DEBE existir ningún instante observable en que
`FECHA_BLOQUEADA` quede sin apuntar a una bloqueante viva ni en que la cola tenga un hueco de
posición. Si cualquier paso falla, la transacción hace rollback completo (la bloqueante sigue
viva, la fecha sigue bloqueada por ella, la cola intacta). (Fuente: `US-019 §Reglas de
negocio`, `§Impacto de Negocio`; `CLAUDE.md §Regla crítica`.)

#### Scenario: Un fallo parcial revierte toda la promoción manual

- **GIVEN** una promoción manual de R3 en curso (expiración de R1 + re-bloqueo + reordenación)
- **WHEN** una de las operaciones falla antes del commit
- **THEN** la transacción hace rollback completo: R1 permanece como bloqueante viva, R3 sigue
  en `2d` con su posición, la fila de `FECHA_BLOQUEADA` sigue apuntando a R1 y la cola queda
  intacta

### Requirement: Guarda de validación — solo se promueve una RESERVA en sub_estado 2.d

El sistema SHALL (DEBE) validar en el servidor, **antes** de cualquier mutación, que la RESERVA
que el Gestor intenta promover está en `sub_estado = '2d'` y pertenece a la cola de la fecha
indicada. Si la RESERVA está en cualquier otro sub-estado (terminales `2x`/`2y`/`2z`, la propia
bloqueante, etc.) —por ejemplo porque expiró o fue actualizada entre la carga de la vista y la
confirmación—, el sistema DEBE **rechazar la operación** con un mensaje de error ("La consulta
seleccionada ya no está en cola") y **no realizar ningún cambio**. La guarda de origen reutiliza
la máquina de estados declarativa (solo `{consulta,2d}` es promovible). (Fuente: `US-019 §FA-05`,
`§Reglas de Validación`; `CLAUDE.md §Máquina de estados`.)

#### Scenario: Promover una consulta que ya no está en 2.d se rechaza sin efectos (FA-05)

- **GIVEN** una consulta que el Gestor eligió pero que transitó a un estado terminal
  (`2x`/`2y`/`2z`) antes de que confirmara
- **WHEN** el Gestor confirma la promoción
- **THEN** el sistema detecta que `sub_estado ≠ '2d'`, rechaza la operación con "La consulta
  seleccionada ya no está en cola" y no realiza ningún cambio

### Requirement: Guarda de validación — la promoción exige FECHA_BLOQUEADA activa para la fecha

El sistema SHALL (DEBE) rechazar la promoción manual cuando **no existe** una fila activa en
`FECHA_BLOQUEADA` para la `(tenant, fecha)` de la consulta elegida (inconsistencia de datos:
una consulta en `2.d` sin fecha bloqueada), sin modificar ninguna RESERVA ni registro
relacionado. (Fuente: `US-019 §Reglas de Validación`.)

#### Scenario: Sin FECHA_BLOQUEADA para la fecha — la promoción se rechaza

- **GIVEN** una consulta en `2d` cuya fecha no tiene fila activa en `FECHA_BLOQUEADA`
  (inconsistencia)
- **WHEN** el Gestor intenta promoverla
- **THEN** el sistema responde con un error de inconsistencia de datos y no modifica nada

### Requirement: Confirmación explícita del Gestor para la acción destructiva de promoción manual

El sistema SHALL (DEBE) exigir que el Gestor **confirme explícitamente** la promoción manual
antes de ejecutarla, dado que expira irreversiblemente la bloqueante activa (`2.x` terminal).
La confirmación se materializa en un **diálogo de confirmación** en la UI de la vista de cola
(US-017); si el Gestor **cancela**, no se realiza ningún cambio de estado (la bloqueante sigue
activa, la cola inalterada). El endpoint de escritura solo actúa ante una petición explícita del
Gestor. (Fuente: `US-019 §Reglas de negocio`, `§FA-04`, `§Reglas de Validación`.)

#### Scenario: El Gestor cancela el diálogo de confirmación (FA-04)

- **GIVEN** que el Gestor ha seleccionado una consulta y el sistema muestra el diálogo de
  confirmación
- **WHEN** el Gestor hace clic en "Cancelar"
- **THEN** no se realiza ningún cambio de estado; la bloqueante sigue activa; la cola permanece
  inalterada; la vista vuelve a su estado anterior

### Requirement: AUDIT_LOG de la promoción manual por cada RESERVA modificada, con el usuario del Gestor

El sistema SHALL (DEBE) registrar en `AUDIT_LOG`, dentro de la misma transacción de la
promoción manual, una entrada `accion = 'transicion'`, `entidad = 'RESERVA'` **por cada RESERVA
modificada**, incluyendo el `usuario_id` del Gestor que ejecuta la acción: para la bloqueante
expirada forzosamente (`datos_anteriores.sub_estado ∈ {2b,2c,2v}`, `datos_nuevos.sub_estado =
'2x'`); para la promovida (`datos_anteriores.sub_estado = '2d'`, `datos_nuevos = {sub_estado:
'2b', origen: 'promocion_manual'}`); y para cada RESERVA reordenada con su cambio de
`posicion_cola`/`consulta_bloqueante_id`. El `origen: 'promocion_manual'` distingue esta acción
de la automática de US-018 (`origen: 'promocion_automatica'`). (Fuente: `US-019 §Happy Path`,
`§Reglas de negocio`; US-018 auditoría de promoción.)

#### Scenario: Cada RESERVA modificada por la promoción manual deja su registro con el Gestor

- **GIVEN** una promoción manual que expira R1, promueve R3 y reordena R2
- **WHEN** la transacción de promoción confirma
- **THEN** `AUDIT_LOG` contiene una entrada `accion='transicion'`, `entidad='RESERVA'` con el
  `usuario_id` del Gestor para R1 (`sub_estado 2b→2x`), para R3
  (`datos_nuevos = {sub_estado: '2b', origen: 'promocion_manual'}`) y para R2 (nuevo
  `posicion_cola`/`consulta_bloqueante_id`)

### Requirement: Coordinación anti-doble-promoción — promoción manual vs promoción automática (RC-A)

El sistema SHALL (DEBE) coordinar la promoción manual con la **promoción automática** de US-018
de modo que **nunca** se produzca doble promoción sobre la misma `(tenant, fecha)`: ambas rutas
DEBEN contender por el `SELECT … FOR UPDATE` sobre la fila de `FECHA_BLOQUEADA` de la fecha
(la ruta automática la toma en `liberarFecha()` antes de eliminarla; la manual la toma antes de
expirar la bloqueante) y re-evaluar la **guarda "ya promovida"** de US-018 dentro de la
transacción. La primera ruta que adquiere el lock completa su operación; la segunda, al obtener
el lock, detecta que el estado ya cambió (la consulta elegida ya no está en `2.d`, o la
bloqueante esperada ya está en estado terminal, o la fecha ya está bloqueada por otra
promovida) y **aborta sin inconsistencia**. Rige **FIFO estricto + "gana quien toma el lock
primero"** (decisión de US-018 §D-6): NO hay cesión de prioridad a la acción manual. Cuando la
que falla es la acción del Gestor, el sistema DEBE devolverle el mensaje "La cola ya fue
actualizada automáticamente, por favor recarga la vista". La garantía reside **exclusivamente
en PostgreSQL**, NUNCA en locks distribuidos. Zona crítica cubierta con **TDD primero** (skill
`concurrency-locking`). (Fuente: `US-019 §Race condition: promoción manual vs. barrido
automático`; US-018 requisito RC-3, `§D-3`, `§D-6`; `CLAUDE.md §Regla crítica`, `§Testing`.)

#### Scenario: Manual y automática compiten — una promueve, la otra aborta limpio

- **GIVEN** el Gestor inicia una promoción manual y, a la vez, el barrido de TTL (US-018) intenta
  promover la primera de la cola para la misma fecha
- **WHEN** ambas transacciones contienden por el `SELECT … FOR UPDATE` sobre la fila de
  `FECHA_BLOQUEADA`
- **THEN** la primera en adquirir el lock completa su promoción (manual o automática)
- **AND** la segunda, al obtener el lock, detecta que el estado ya cambió y aborta sin
  inconsistencia
- **AND** si la que falla es la acción del Gestor, este recibe "La cola ya fue actualizada
  automáticamente, por favor recarga la vista"

### Requirement: Coordinación — dos Gestores promueven simultáneamente en la misma cola (RC-B)

El sistema SHALL (DEBE) garantizar que, ante dos Gestores (sesiones distintas del mismo tenant)
que inician simultáneamente la promoción de consultas **distintas** de la misma cola, ambas
transacciones contiendan por el `SELECT … FOR UPDATE` sobre la fila de `FECHA_BLOQUEADA` y
**exactamente una** complete la promoción (expira bloqueante, promueve su elegida, reordena). La
segunda, al obtener el lock, detecta el estado inconsistente (la bloqueante que esperaba ya está
en `2.x`, o su consulta elegida ya no tiene `posicion_cola` válida / ya no está en `2.d`) y
**aborta** mostrando el error al Gestor correspondiente. La garantía reside en PostgreSQL, no en
locks distribuidos. Zona crítica cubierta con **TDD primero**. (Fuente: `US-019 §Race condition:
dos Gestores promueven simultáneamente`; `CLAUDE.md §Testing`.)

#### Scenario: Dos Gestores, una sola promoción efectiva

- **GIVEN** dos Gestores del mismo tenant inician a la vez la promoción de dos consultas
  distintas de la misma cola
- **WHEN** ambas transacciones intentan adquirir `SELECT … FOR UPDATE` sobre `FECHA_BLOQUEADA`
- **THEN** exactamente una transacción completa la promoción
- **AND** la otra, al obtener el lock, detecta el estado ya cambiado y aborta mostrando el error
  al Gestor correspondiente

