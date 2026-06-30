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

