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

### Requirement: Idioma y horario opcionales en el alta de consulta

El sistema SHALL (DEBE) aceptar en el alta de consulta dos campos opcionales:
`idioma` (`'es'` | `'ca'`, por defecto `'es'`) que determina el idioma de
comunicación con ese cliente a lo largo de su ciclo de vida; y `horario`
(cadena `HH:MM`, p. ej. `"10:00"`) que indica la hora de inicio prevista del
evento. El campo `horario` DEBE ser **válido únicamente si `duracionHoras` también
está presente**: si se envía `horario` sin `duracionHoras`, el sistema DEBE rechazar
el alta con un error de validación. Ambos campos se persisten en `RESERVA.idioma` y
`RESERVA.horario` respectivamente. (Fuente: decisión de producto post-US-003/004.)

#### Scenario: Alta con idioma y horario los persiste en la RESERVA

- **GIVEN** un alta válida con `idioma = 'ca'`, `duracionHoras = 8` y `horario = '11:00'`
- **WHEN** el sistema crea la RESERVA
- **THEN** persiste `RESERVA.idioma = 'ca'` y `RESERVA.horario = '11:00'`

#### Scenario: horario sin duracionHoras se rechaza en servidor

- **GIVEN** un alta con `horario = '10:00'` pero sin `duracionHoras`
- **WHEN** el servidor valida la solicitud
- **THEN** retorna un error de validación en el campo `horario`
- **AND** no crea ningún registro

### Requirement: Respuesta inicial automática E1 personalizada según idioma y situación de fecha

El sistema SHALL (DEBE) registrar una fila en `COMUNICACION` con
`codigo_email = 'E1'` para toda alta de consulta. Si el alta **no** incluye
`comentarios`, el sistema DEBE crear la COMUNICACION con `estado = 'enviado'` y
disparar el envío al email del cliente **sin intervención adicional** del gestor. Si
el alta **incluye** `comentarios`, el sistema DEBE crear la COMUNICACION con
`estado = 'borrador'`, **sin enviarla**, y la UI DEBE alertar al gestor de que tiene
un borrador pendiente de revisar y confirmar.

El cuerpo de E1 se selecciona del **catálogo de plantillas** según el `idioma` de la
RESERVA (`'es'` o `'ca'`) y una de **4 variantes** determinadas por el sub-estado
resultante del alta y la presencia de `fecha_evento`:

| Variante | Condición | Sub-estado |
|----------|-----------|------------|
| `sin_fecha` | Alta sin `fecha_evento` | `2a` |
| `fecha_disponible` | Fecha presente y libre | `2b` |
| `fecha_cola` | Fecha presente y bloqueada en consulta | `2d` |
| `fecha_confirmada` | Fecha presente y bloqueada por reserva confirmada | `2a` degradada |

En la variante `fecha_confirmada`, el sistema DEBE intentar obtener fechas
alternativas disponibles en el mismo fin de semana (±1 día, solo sábado/domingo sin
entrada en `FECHA_BLOQUEADA`) para incluirlas en el email.

E1 DEBE incluir siempre el **dossier informativo del espacio** en PDF adjunto, en el
idioma de la RESERVA (`Dossier-Masia-Encis-es.pdf` o `Dossier-Masia-Encis-ca.pdf`).
El dossier se adjunta por referencia de URL desde el almacén local del tenant.

**Fallback**: si el catálogo no puede renderizar la plantilla (idioma no soportado,
error de configuración), el sistema NO DEBE bloquear el alta; degrada a un
asunto/cuerpo mínimo y envía igualmente — el motor de email centraliza el resultado
(`enviado` o `fallido`). En producción el catálogo siempre está inyectado y el camino
real usa siempre el render personalizado. (Fuente: `US-003 §Happy Path`; `US-004
§Email relacionado`; decisión de producto post-US-045.)

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

#### Scenario: E1 sin fecha usa la variante sin_fecha en el idioma del lead

- **GIVEN** un alta sin `fecha_evento` con `idioma = 'ca'`, sin comentarios
- **WHEN** el sistema envía E1
- **THEN** E1 se envía con el cuerpo de la variante `sin_fecha` en catalán
- **AND** adjunta el dossier `Dossier-Masia-Encis-ca.pdf`

#### Scenario: E1 con fecha libre usa la variante fecha_disponible

- **GIVEN** un alta con `fecha_evento` libre (sub-estado `2b`), sin comentarios
- **WHEN** el sistema envía E1
- **THEN** E1 informa de que la fecha está disponible e incluye la fecha en el cuerpo
- **AND** adjunta el dossier en el idioma de la RESERVA

#### Scenario: E1 con fecha confirmada ofrece fechas alternativas si existen

- **GIVEN** un alta con `fecha_evento` bloqueada por reserva confirmada (sub-estado
  `2a` degradada), sin comentarios
- **WHEN** el sistema envía E1
- **THEN** E1 indica que la fecha solicitada no está disponible
- **AND** si existe alguna fecha adyacente (sáb/dom ±1 día) libre, la incluye en el
  cuerpo como alternativa

#### Scenario: Catálogo no disponible envía E1 con texto mínimo sin bloquear el alta

- **GIVEN** un alta sin comentarios en un contexto donde el catálogo no puede renderizar
- **WHEN** el sistema procesa el alta
- **THEN** la RESERVA se crea correctamente
- **AND** la COMUNICACION E1 se envía con asunto/cuerpo mínimo de fallback
- **AND** el alta devuelve 201 sin error al gestor

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

El sistema SHALL (DEBE), tras una transición exitosa `2.a → 2.b` (fecha libre), registrar
una `COMUNICACION` E1 dirigida al cliente **en estado `borrador`** con la plantilla de
transición "fecha disponible" (asunto y cuerpo renderizados dinámicamente, ver
"Plantillas dinámicas de la transición de fecha") y **NO enviarla automáticamente**: el
correo queda pendiente de **revisión y envío manual por el gestor** mediante el flujo ya
existente de US-046 (`GET /reservas/:id/comunicaciones` → *"Revisar y enviar borrador"*
→ `POST /reservas/:id/comunicaciones/.../enviar`). La `COMUNICACION` se crea en la
**misma transacción** que la mutación de la RESERVA y el bloqueo (atomicidad), con
`codigo_email = 'E1'`, `estado = 'borrador'` y `fecha_envio = null`; la creación es
**idempotente** (upsert por `(reserva_id, codigo_email)`) para no colisionar con un E1
de alta previo. Este email es una **extensión de E1** para el caso de actualización de
fecha y **no tiene un código `E` propio** en el catálogo §9.3 (E1–E8). El sistema **NO
invoca ningún proveedor de email** en este flujo; en consecuencia, no existe ya el envío
post-commit ni su manejo de fallo. Tras la transición, la UI DEBE comunicar al gestor que
**se ha generado un borrador de confirmación pendiente de revisión y envío** (NO "se ha
enviado un email"): el aviso de resultado DEBE ser un aviso **ámbar** (pendiente/acción
requerida), NO un aviso verde de éxito de envío, y la ficha DEBE **desplazar la vista al
aviso** (scroll-to-top) e **invalidar la lectura de comunicaciones** para que el borrador
recién creado sea visible sin recargar. (Fuente: `US-005 §Email relacionado`; US-046 flujo
de revisión/envío de borradores; UC-04 paso 8; catálogo §9.3 E1; plan aprobado del usuario.)

#### Scenario: Transición a 2.b crea el borrador E1 sin enviarlo

- **GIVEN** una transición `2.a → 2.b` que se completa con su bloqueo blando
- **WHEN** el sistema registra la comunicación de la transición
- **THEN** crea una `COMUNICACION` E1 con `estado = 'borrador'` y `fecha_envio = null`
  dirigida al cliente, con el asunto y cuerpo de la plantilla "fecha disponible"
  renderizados
- **AND** NO invoca ningún proveedor de email ni cambia el estado a `enviado`
- **AND** la `COMUNICACION` queda disponible para revisión/envío manual por el flujo de
  US-046

#### Scenario: La transición a 2.d (cola) crea un borrador E1 con la plantilla "fecha bloqueada"

- **GIVEN** una RESERVA propia en `sub_estado = '2a'` y una `fecha_evento` bloqueada por
  una consulta en `2.b`, y el gestor **acepta** entrar en cola (`aceptarCola = true`)
- **WHEN** la RESERVA transiciona a `sub_estado = '2d'`
- **THEN** el sistema crea, en la **misma transacción**, una `COMUNICACION` E1 con
  `estado = 'borrador'` y `fecha_envio = null`, con el asunto y cuerpo de la plantilla
  "fecha bloqueada" renderizados
- **AND** NO invoca ningún proveedor de email

#### Scenario: El caso no encolable no crea ninguna comunicación

- **GIVEN** una RESERVA propia en `sub_estado = '2a'` y una `fecha_evento` bloqueada por
  un estado no encolable (`2.c`/`2.v`/`pre_reserva`/`reserva_confirmada` o posterior), o
  bloqueada por `2.b` sin que el gestor acepte la cola
- **WHEN** el sistema rechaza la asignación inmediata (permanece en `2.a`, HTTP 409)
- **THEN** NO crea ninguna `COMUNICACION` ni muta la RESERVA

#### Scenario: El aviso de resultado indica "borrador pendiente", no "email enviado"

- **GIVEN** una transición de fecha (`2.a → 2.b` o `2.a → 2.d`) que crea el borrador E1
- **WHEN** la ficha muestra el resultado de la transición al gestor
- **THEN** el aviso es **ámbar** e indica que se ha generado un **borrador de confirmación
  pendiente de revisión y envío** (no un aviso verde de "email enviado al cliente")
- **AND** la ficha desplaza la vista hasta el aviso (scroll-to-top)
- **AND** el borrador recién creado queda visible sin recargar (la lectura de
  comunicaciones se invalida y se recarga)

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

### Requirement: Barrido periódico protegido de inicio automático de evento en T-0

El sistema SHALL (DEBE) exponer un **barrido interno protegido** que, al ser invocado,
seleccione todas las RESERVA con `estado = 'reserva_confirmada'` **AND** cuya `fecha_evento`
sea **hoy** (día T-0, es decir `date(fecha_evento) = date(hoy)`) y, para cada una que cumpla
las **tres precondiciones** (`pre_evento_status = 'cerrado'` **AND** `liquidacion_status =
'cobrada'` **AND** `fianza_status = 'cobrada'`), transicione automáticamente `RESERVA.estado`
de `reserva_confirmada` a `evento_en_curso`. El barrido SHALL (DEBE) autenticarse
**service-to-service** mediante la cabecera `X-Cron-Token` (comparada con `CRON_TOKEN` del
entorno vía `CronTokenGuard`); NO DEBE ser accesible con JWT de usuario ni desde el exterior.
Un **cron scheduler** (`@nestjs/schedule`) lo invoca **una vez al día a las 00:00 del día del
evento** siguiendo el patrón obligatorio "estado en fila + barrido periódico" (nunca
Lambda/EventBridge ni timers exactos); el trabajo pendiente es estado en la BBDD
(`RESERVA.estado` + `fecha_evento` + los tres `*_status`). El barrido DEBE procesar **todas
las candidatas del mismo pase** y devolver un **resumen** (candidatas evaluadas, eventos
iniciados, candidatas con precondiciones incumplidas, fallos aislados). (Fuente: `US-031
§Historia`, `§Reglas de negocio`, `§Reglas de Validación`; `CLAUDE.md §Jobs asíncronos`;
`architecture.md §2.5`; skill `async-jobs`; patrón de US-012/US-026; `use-cases.md` UC-23.)

#### Scenario: El cron invoca el barrido con token válido e inicia los eventos elegibles

- **GIVEN** una o más RESERVA en `estado = 'reserva_confirmada'` con `fecha_evento = hoy` y
  las tres precondiciones cumplidas (`pre_evento_status = cerrado`, `liquidacion_status =
  cobrada`, `fianza_status = cobrada`), en uno o varios tenants
- **WHEN** el cron invoca el barrido de eventos con la cabecera `X-Cron-Token` válida
- **THEN** el sistema transiciona cada candidata cumplidora a `estado = evento_en_curso` bajo
  el contexto RLS de su tenant
- **AND** devuelve un resumen con el nº de candidatas evaluadas, eventos iniciados, candidatas
  con precondiciones incumplidas y fallos aislados

#### Scenario: Llamada sin token o con token inválido se rechaza

- **GIVEN** una petición al barrido de eventos sin `X-Cron-Token` o con un valor que no
  coincide con `CRON_TOKEN`
- **WHEN** el sistema recibe la petición
- **THEN** la rechaza con error de autorización (401)
- **AND** no transiciona ninguna RESERVA

### Requirement: Transición atómica a evento_en_curso solo con las tres precondiciones cumplidas

El sistema SHALL (DEBE), por cada RESERVA candidata (`estado = 'reserva_confirmada'`,
`fecha_evento = hoy`), evaluar las **tres precondiciones en una única lectura de la fila**
dentro de una **transacción atómica** bajo el contexto RLS de su tenant: si `pre_evento_status
= 'cerrado'` **AND** `liquidacion_status = 'cobrada'` **AND** `fianza_status = 'cobrada'`,
transicionar `RESERVA.estado` de `reserva_confirmada` a `evento_en_curso` y registrar en
`AUDIT_LOG` una entrada con `accion = 'transicion'`, `entidad = 'RESERVA'`, `datos_anteriores
= {estado: reserva_confirmada}` y `datos_nuevos = {estado: evento_en_curso}`, con origen
**Sistema**. La transición se modela en la **máquina de estados declarativa** del agregado
RESERVA (guarda de origen `reserva_confirmada → evento_en_curso` como estructura de datos, NO
`if` dispersos), y la guarda de las tres precondiciones se **re-evalúa dentro de la
transacción bajo el lock de la fila** (`SELECT … FOR UPDATE`). (Fuente: `US-031 §Happy Path`,
`§Reglas de negocio`, `§Reglas de Validación`; `CLAUDE.md §Máquina de estados`; UC-23.)

#### Scenario: RESERVA confirmada con las tres precondiciones y fecha_evento hoy transiciona

- **GIVEN** una RESERVA en `estado = 'reserva_confirmada'`, `fecha_evento = hoy`,
  `pre_evento_status = cerrado`, `liquidacion_status = cobrada` y `fianza_status = cobrada`
- **WHEN** el barrido de T-0 se ejecuta
- **THEN** en una transacción atómica el sistema fija `RESERVA.estado = evento_en_curso`
- **AND** registra en `AUDIT_LOG` `accion = 'transicion'`, `entidad = 'RESERVA'`,
  `datos_anteriores = {estado: reserva_confirmada}`, `datos_nuevos = {estado: evento_en_curso}`
  con origen Sistema
- **AND** la RESERVA queda en el estado que habilita la vista móvil "evento en curso" y el
  checklist de documentación pendiente (superficie de US-033/US-034)

### Requirement: Precondiciones incumplidas — no transiciona y alerta crítica al gestor

El sistema SHALL (DEBE), cuando una RESERVA candidata (`estado = 'reserva_confirmada'`,
`fecha_evento = hoy`) NO cumpla las tres precondiciones (alguna de `pre_evento_status`,
`liquidacion_status`, `fianza_status` distinta de su valor requerido), **NO** transicionar la
RESERVA (permanece en `reserva_confirmada`) y generar una **alerta crítica al gestor** que
enumere las precondiciones incumplidas (p. ej. "El evento de hoy [código reserva] tiene
precondiciones incumplidas: [lista]. Puedes forzar el inicio manualmente."). El **forzado
manual** de la transición corresponde a **US-032** y queda fuera de este alcance. El resumen
del barrido DEBE contabilizar estas candidatas como precondiciones incumplidas. (Fuente:
`US-031 §Precondiciones incumplidas — cron no transiciona`, `§Reglas de negocio`; UC-23 FA-01
→ US-032.)

#### Scenario: Liquidación no cobrada el día del evento — no transiciona y alerta

- **GIVEN** una RESERVA en `estado = 'reserva_confirmada'`, `fecha_evento = hoy`,
  `pre_evento_status = cerrado`, `fianza_status = cobrada` pero `liquidacion_status =
  facturada` (no `cobrada`)
- **WHEN** el barrido de T-0 evalúa la RESERVA
- **THEN** el sistema no transiciona: `RESERVA.estado` permanece `reserva_confirmada`
- **AND** genera una alerta crítica al gestor enumerando la precondición incumplida
  (`liquidacion_status`)
- **AND** no registra ninguna entrada de transición en `AUDIT_LOG` para esa RESERVA

### Requirement: A29 — alerta no bloqueante si las condiciones particulares no están firmadas

El sistema SHALL (DEBE), como **efecto colateral no bloqueante** (automatización A29),
generar una **alerta al gestor** cuando `RESERVA.cond_part_firmadas = false` el día del evento
("Las condiciones particulares de esta reserva no están firmadas. El cliente puede firmarlas
presencialmente."). A29 NO DEBE impedir la transición: si las tres precondiciones se cumplen,
la RESERVA transiciona a `evento_en_curso` **igualmente**. A29 se evalúa con **independencia**
del resultado de la transición (se dispara aunque la transición se ejecute). (Fuente: `US-031
§A29 — Condiciones particulares no firmadas el día del evento`, `§Contexto de Negocio` A29.)

#### Scenario: Tres precondiciones cumplidas pero condiciones particulares no firmadas

- **GIVEN** una RESERVA en `estado = 'reserva_confirmada'`, `fecha_evento = hoy`, las tres
  precondiciones cumplidas y `cond_part_firmadas = false`
- **WHEN** el barrido de T-0 ejecuta la transición
- **THEN** `RESERVA.estado = evento_en_curso` (la transición se ejecuta igualmente)
- **AND** el gestor recibe una alerta NO bloqueante sobre las condiciones particulares no
  firmadas (A29), sin que impida ni revierta el inicio del evento

### Requirement: Filtro estricto por estado y fecha — solo reserva_confirmada con fecha_evento hoy

El sistema SHALL (DEBE) aplicar el inicio automático **únicamente** a RESERVA en `estado =
'reserva_confirmada'` cuya `fecha_evento` sea **hoy** (`date(fecha_evento) = date(hoy)`).
Cualquier RESERVA en otro estado (`consulta`, `pre_reserva`, `reserva_cancelada`,
`reserva_completada`, `evento_en_curso`, `post_evento`) NO DEBE ser transicionada por este
barrido, **aunque** su `fecha_evento = hoy`; y ninguna RESERVA con `fecha_evento` distinta de
hoy (pasado o futuro) DEBE entrar en el pase. La comparación es por **fecha de calendario del
evento** (no por instante ni por un `ttl_expiracion`) usando una definición única de "hoy" por
pase, blindando el off-by-one de zona horaria (la selección NO depende de ningún string
formateado). El filtro por estado forma parte de la selección de candidatas (cero falsos
positivos sobre otros estados). (Fuente: `US-031 §Reglas de negocio`, `§Reglas de Validación`;
UC-23.)

#### Scenario: RESERVA en otro estado con fecha_evento hoy no se transiciona

- **GIVEN** una RESERVA en `estado = 'pre_reserva'` (o `consulta`, `reserva_cancelada`,
  `reserva_completada`, `post_evento`) con `fecha_evento = hoy`
- **WHEN** el barrido de T-0 se ejecuta
- **THEN** el sistema no aplica el inicio automático a esa RESERVA (el filtro incluye solo
  `estado = 'reserva_confirmada'`)
- **AND** la RESERVA no se modifica

#### Scenario: Solo los eventos de hoy entran en el pase

- **GIVEN** RESERVA confirmadas con las tres precondiciones cumplidas: una con `fecha_evento =
  hoy`, otra con `fecha_evento = mañana`, otra con `fecha_evento = ayer`
- **WHEN** el barrido de T-0 se ejecuta hoy
- **THEN** solo se transiciona la RESERVA con `fecha_evento = hoy`
- **AND** las de mañana y ayer no se modifican en este pase

### Requirement: Idempotencia del barrido — reserva ya en evento_en_curso no se re-transiciona

El sistema SHALL (DEBE) ser idempotente: una RESERVA con `estado = 'evento_en_curso'`
(transicionada por un pase anterior o por el gestor vía US-032) **no** es candidata (el filtro
`estado = 'reserva_confirmada'` la excluye) y NO DEBE ser modificada ni generar entrada
duplicada en `AUDIT_LOG`. N ejecuciones del barrido sobre la misma RESERVA = **1 sola**
transición y **1 sola** entrada de transición. La guarda de origen se **re-evalúa dentro** de
la transacción de cada RESERVA (bajo `SELECT … FOR UPDATE`) para que un reintento o un pase
concurrente re-lea el `estado` ya actualizado y termine como no-op. (Fuente: `US-031
§Idempotencia — reserva ya en evento_en_curso`, `§Reglas de Validación`.)

#### Scenario: Segunda ejecución del barrido no re-transiciona un evento ya en curso

- **GIVEN** una RESERVA que ya fue transicionada por un pase anterior del barrido (`estado =
  evento_en_curso`) con `fecha_evento = hoy`
- **WHEN** el barrido se ejecuta de nuevo y la evalúa
- **THEN** la RESERVA no está entre las candidatas y no se modifica
- **AND** no se genera ninguna entrada nueva ni duplicada en `AUDIT_LOG`

### Requirement: Concurrencia cron vs gestor — exactamente una transición gana sin error

El sistema SHALL (DEBE) garantizar que, cuando el barrido de Sistema y el gestor (US-032)
intentan transicionar **simultáneamente** la misma RESERVA de `reserva_confirmada` a
`evento_en_curso`, **exactamente una** operación tiene éxito y actualiza `RESERVA.estado =
evento_en_curso`; la segunda operación detecta bajo el lock que el estado ya no es
`reserva_confirmada` (la UPDATE afecta **0 filas**) y termina como **no-op sin error**. El
`AUDIT_LOG` DEBE contener **exactamente una** entrada de transición. La serialización la da
PostgreSQL sobre la fila RESERVA (`SELECT … FOR UPDATE`), sin locks distribuidos (Redis/Redlock
prohibidos). (Fuente: `US-031 §Concurrencia / Race Conditions`; `CLAUDE.md §Regla crítica:
bloqueo atómico` y `§Jobs asíncronos`.)

#### Scenario: Cron y gestor compiten por la misma RESERVA

- **GIVEN** una RESERVA en `estado = 'reserva_confirmada'` con las tres precondiciones
  cumplidas y `fecha_evento = hoy`, sobre la que el cron y el gestor (US-032) ejecutan la
  transición en la misma ventana temporal
- **WHEN** ambas operaciones leen `estado = reserva_confirmada` y ejecutan la UPDATE bajo el
  lock de la fila
- **THEN** exactamente una tiene éxito y fija `estado = evento_en_curso`
- **AND** la segunda observa que el estado ya no es `reserva_confirmada` (0 filas afectadas) y
  termina como no-op sin error
- **AND** `AUDIT_LOG` contiene exactamente una entrada de transición para esa RESERVA

### Requirement: Procesa todas las elegibles con aislamiento de fallos por RESERVA

El sistema SHALL (DEBE) procesar **todas** las RESERVA elegibles del mismo pase, cada una en
su **propia transacción independiente**: el fallo de una transición (excepción, conflicto,
guarda) NO DEBE abortar ni revertir las transiciones de las demás candidatas; el resumen del
barrido registra los fallos aislados. Cuando existen varias RESERVA con `fecha_evento = hoy`,
el sistema transiciona todas las que están en `reserva_confirmada` con las tres precondiciones
cumplidas (una entrada de transición independiente por cada inicio efectivo), omite las que ya
están en `evento_en_curso` y alerta las que tienen precondiciones incumplidas. (Fuente:
`US-031 §Impacto de Negocio`; patrón de fallo aislado de US-012/US-026.)

#### Scenario: Varias reservas de hoy — cumplidoras inician, incumplidoras alertan, ya iniciada se omite

- **GIVEN** cuatro RESERVA distintas con `fecha_evento = hoy`: dos en `reserva_confirmada` con
  las tres precondiciones cumplidas, una en `reserva_confirmada` con una precondición
  incumplida, y una ya en `evento_en_curso`
- **WHEN** el barrido de T-0 se ejecuta
- **THEN** el sistema transiciona las dos cumplidoras a `evento_en_curso` (dos entradas de
  transición en `AUDIT_LOG`), no transiciona la incumplidora (alerta crítica) y omite la que ya
  estaba en `evento_en_curso` (cero acción)
- **AND** el resumen refleja dos eventos iniciados y una candidata con precondiciones
  incumplidas

#### Scenario: Un fallo parcial en una candidata no revierte las demás

- **GIVEN** un barrido con N candidatas donde la transición de una falla
- **WHEN** el sistema procesa el pase
- **THEN** cada candidata se procesa en su propia transacción independiente
- **AND** el fallo de una no revierte ni impide la transición de las demás
- **AND** el resumen del barrido refleja la candidata fallida como fallo aislado

### Requirement: La auditoría del inicio automático registra el origen Sistema

El sistema SHALL (DEBE) registrar cada transición automática a `evento_en_curso` en
`AUDIT_LOG` con origen **Sistema** (no un `USUARIO`): `accion = 'transicion'`, `entidad =
'RESERVA'`, sin `usuario_id` de usuario (nulo/no-usuario), `datos_anteriores = {estado:
reserva_confirmada}`, `datos_nuevos = {estado: evento_en_curso}` (con la causa de la
automatización reflejada en `datos_nuevos`). Esta convención es la misma que usan los barridos
de Sistema de US-012 (expiración) y US-026 (cierre de fichas). El `AUDIT_LOG` es **obligatorio**
en toda transición de estado ejecutada por el cron. (Fuente: `US-031 §Happy Path`, `§Reglas de
Validación`; `er-diagram.md` AUDIT_LOG; convención de auditoría de Sistema de US-012/US-026.)

#### Scenario: El inicio automático se audita como acción de Sistema

- **GIVEN** una RESERVA candidata que el barrido transiciona a `evento_en_curso`
- **WHEN** el sistema registra la transición en `AUDIT_LOG`
- **THEN** la entrada tiene `accion = 'transicion'`, `entidad = 'RESERVA'`, `datos_anteriores =
  {estado: reserva_confirmada}`, `datos_nuevos = {estado: evento_en_curso}` y **no** un
  `usuario_id` de usuario final (origen Sistema)
- **AND** refleja la causa de la automatización de inicio de evento en `datos_nuevos`

### Requirement: Finalización manual del evento — transición evento_en_curso → post_evento

El sistema SHALL (DEBE) permitir al **gestor** ejecutar la acción "Marcar evento como
finalizado" sobre una RESERVA, que transiciona `RESERVA.estado` de `evento_en_curso` a
`post_evento`. La transición SHALL (DEBE) modelarse como **guarda de origen declarativa** en la
máquina de estados del agregado RESERVA (`maquina-estados.ts`), como **estructura de datos** (NO
`if` dispersos), consistente con `resolverInicioEvento` (US-031) y `resolverExpiracionTtl`
(US-012). La acción SHALL (DEBE) autenticarse con **JWT de usuario** (no `X-Cron-Token`: es una
acción manual del gestor, no un barrido de Sistema) y ejecutarse bajo el **contexto RLS del
tenant** del gestor. La transición es **incondicional respecto a la fianza y al email**: solo
depende de que el estado de origen sea `evento_en_curso`. (Fuente: `US-034 §Historia`, `§Reglas
de negocio`, `§Reglas de Validación`; `use-cases.md` UC-25; `CLAUDE.md §Máquina de estados`.)

#### Scenario: El gestor finaliza un evento en curso y la reserva pasa a post_evento

- **GIVEN** una RESERVA en `estado = 'evento_en_curso'` en el tenant del gestor autenticado
- **WHEN** el gestor selecciona "Marcar evento como finalizado" y confirma
- **THEN** el sistema fija `RESERVA.estado = post_evento` bajo el contexto RLS de su tenant
- **AND** la RESERVA queda en `post_evento`, que arranca el sub-proceso post-evento

### Requirement: La acción de finalizar solo está disponible en estado evento_en_curso

El sistema SHALL (DEBE) permitir la finalización del evento **únicamente** cuando
`RESERVA.estado = 'evento_en_curso'`. Si la RESERVA está en cualquier otro estado (`consulta`,
`pre_reserva`, `reserva_confirmada`, `post_evento`, `reserva_completada`, `reserva_cancelada`),
la acción SHALL (DEBE) rechazarse con un **conflicto de estado** y NO DEBE modificar la RESERVA
ni disparar E5 ni escribir en `AUDIT_LOG` una transición. La disponibilidad de la acción es una
guarda de origen de la máquina de estados, no una validación dispersa. (Fuente: `US-034 §Reglas
de negocio`, `§Reglas de Validación`; UC-25.)

#### Scenario: Intento de finalizar una reserva que no está en evento_en_curso

- **GIVEN** una RESERVA en `estado = 'reserva_confirmada'` (o cualquier estado distinto de
  `evento_en_curso`)
- **WHEN** el gestor intenta "Marcar evento como finalizado"
- **THEN** el sistema rechaza la acción con un conflicto de estado
- **AND** `RESERVA.estado` no cambia, no se dispara E5 y no se registra transición en `AUDIT_LOG`

### Requirement: La transición evento_en_curso → post_evento es irreversible

El sistema SHALL (DEBE) tratar la transición `evento_en_curso → post_evento` como
**irreversible**: no existe transición de retorno `post_evento → evento_en_curso` en la máquina
de estados del agregado RESERVA, y la máquina de estados NO DEBE ofrecer ningún camino que
devuelva la RESERVA a `evento_en_curso` una vez en `post_evento`. Una segunda ejecución de la
acción de finalizar sobre una RESERVA ya en `post_evento` DEBE rechazarse como conflicto de
estado (no re-ejecuta la transición ni re-dispara E5). (Fuente: `US-034 §Reglas de negocio`,
`§Reglas de Validación`.)

#### Scenario: No hay camino de retorno desde post_evento a evento_en_curso

- **GIVEN** una RESERVA que ya transicionó a `estado = 'post_evento'`
- **WHEN** se consulta la máquina de estados por las transiciones válidas desde `post_evento`
- **THEN** ninguna transición válida devuelve la RESERVA a `evento_en_curso`
- **AND** un segundo intento de "Marcar evento como finalizado" se rechaza como conflicto de
  estado sin re-disparar efectos

### Requirement: La transición se registra en AUDIT_LOG con origen Usuario

El sistema SHALL (DEBE) registrar cada finalización efectiva del evento en `AUDIT_LOG` con
`accion = 'transicion'`, `entidad = 'RESERVA'`, `datos_anteriores = {estado: evento_en_curso}` y
`datos_nuevos = {estado: post_evento}`, con origen **Usuario** (el gestor autenticado, con su
`usuario_id` poblado — a diferencia del barrido de Sistema de US-031, que no puebla usuario). El
`AUDIT_LOG` es **obligatorio** para toda transición de estado. El registro de la transición NO
DEBE depender del resultado del envío de E5 (la transición se audita aunque E5 falle). (Fuente:
`US-034 §Happy Path`, `§Reglas de Validación`; `er-diagram.md` AUDIT_LOG.)

#### Scenario: La finalización del evento se audita como acción de Usuario

- **GIVEN** una RESERVA en `evento_en_curso` que el gestor finaliza
- **WHEN** el sistema ejecuta la transición a `post_evento`
- **THEN** registra en `AUDIT_LOG` una entrada con `accion = 'transicion'`, `entidad =
  'RESERVA'`, `datos_anteriores = {estado: evento_en_curso}`, `datos_nuevos = {estado:
  post_evento}` y el `usuario_id` del gestor (origen Usuario)
- **AND** la entrada se registra aunque el posterior envío de E5 falle

### Requirement: Advertencia no bloqueante si el checklist de documentación está incompleto

El sistema SHALL (DEBE), al iniciar la acción de finalizar el evento, **consultar** la
completitud del checklist de documentación del evento (superficie de US-033); si tiene ítems
pendientes (p. ej. cláusula de responsabilidad no subida), DEBE mostrar una **advertencia
informativa** que enumere los ítems sin subir ("Documentación pendiente: [lista de ítems sin
subir]. Puedes continuar igualmente."). La advertencia NO DEBE bloquear la finalización: si el
gestor confirma, la transición a `post_evento` se ejecuta igualmente, y el checklist permanece
accesible para subidas tardías en `post_evento`. US-034 solo **consulta** la completitud; NO
construye el checklist. (Fuente: `US-034 §FA-01 — Documentación del evento incompleta al
finalizar`; UC-25.)

#### Scenario: Documentación incompleta al finalizar — advierte pero no bloquea

- **GIVEN** una RESERVA en `evento_en_curso` cuyo checklist de documentación tiene ítems
  pendientes
- **WHEN** el gestor selecciona "Marcar evento como finalizado"
- **THEN** el sistema muestra una advertencia informativa que enumera los ítems pendientes
- **AND** si el gestor confirma, la transición a `post_evento` se ejecuta igualmente
- **AND** el checklist sigue accesible para subidas tardías en `post_evento`

### Requirement: Doble finalización concurrente — exactamente una transición gana sin doble efecto

El sistema SHALL (DEBE) garantizar que, ante dos peticiones concurrentes de finalización de la
**misma** RESERVA (doble click / doble request), **exactamente una** transiciona `estado =
post_evento`; la segunda detecta bajo el lock que el estado ya no es `evento_en_curso` y termina
como **conflicto de estado**, sin doble transición, sin doble entrada de transición en
`AUDIT_LOG` y sin doble disparo de E5. La guarda de origen se **re-evalúa dentro de la
transacción bajo `SELECT … FOR UPDATE`** de la fila RESERVA; la serialización la da PostgreSQL
sobre la fila, sin locks distribuidos (Redis/Redlock prohibidos). (Fuente: `US-034 §Reglas de
Validación`; `CLAUDE.md §Regla crítica: bloqueo atómico`.)

#### Scenario: Dos peticiones simultáneas finalizan la misma reserva

- **GIVEN** una RESERVA en `estado = 'evento_en_curso'` sobre la que llegan dos peticiones de
  finalización en la misma ventana temporal
- **WHEN** ambas leen `estado = evento_en_curso` y ejecutan la transición bajo el lock de la fila
- **THEN** exactamente una tiene éxito y fija `estado = post_evento`
- **AND** la segunda observa que el estado ya no es `evento_en_curso` y termina como conflicto de
  estado (0 filas afectadas)
- **AND** `AUDIT_LOG` contiene exactamente una entrada de transición y E5 se dispara a lo sumo
  una vez

### Requirement: Barrido periódico protegido de archivado automático a reserva_completada en T+7d

El sistema SHALL (DEBE) exponer un **barrido interno protegido** que, al ser invocado, seleccione
todas las RESERVA con `estado = 'post_evento'` cuyo **tiempo en `post_evento` sea ≥ 7 días
naturales** (T+7d) y, para cada una que cumpla la **guarda de fianza resuelta** (`fianza_status ∈
{devuelta, retenida_parcial}` **O** `fianza_eur <= 0` **O** `fianza_eur IS NULL`), transicione
automáticamente `RESERVA.estado` de `post_evento` a `reserva_completada` (estado **terminal e
inmutable**). El barrido SHALL (DEBE) autenticarse **service-to-service** mediante la cabecera
`X-Cron-Token` (comparada con `CRON_TOKEN` del entorno vía `CronTokenGuard`); NO DEBE ser accesible
con JWT de usuario ni desde el exterior. Un **cron scheduler** (`@nestjs/schedule`) lo invoca **una
vez al día** siguiendo el patrón obligatorio "estado en fila + barrido periódico" (nunca
Lambda/EventBridge ni timers exactos); el trabajo pendiente es estado en la BBDD (`RESERVA.estado
= post_evento` + el momento de entrada a `post_evento` + la guarda de fianza). El barrido se expone
como **endpoint DEDICADO** `POST /cron/barrido-completadas` (gemelo de `POST /cron/barrido-eventos`
de US-031 y `POST /cron/barrido-expiracion` de US-012), y NO DEBE reutilizar `POST /cron/barrido` ni
un dispatch por `?tarea=` (ese dispatch no está implementado en el repo). El barrido DEBE procesar
**todas las candidatas del mismo pase** y devolver un **resumen** (candidatas evaluadas, reservas
archivadas, candidatas con fianza pendiente, fallos aislados). (Fuente: `US-037 §Historia`, `§Reglas
de negocio`, `§Reglas de Validación`; `CLAUDE.md §Jobs asíncronos`; `architecture.md §2.5`; skill
`async-jobs`; patrón de US-012/US-026/US-031; `use-cases.md` UC-28.)

#### Scenario: El cron invoca el barrido con token válido y archiva las reservas elegibles

- **GIVEN** una o más RESERVA en `estado = 'post_evento'` con ≥ 7 días naturales en ese estado y la
  guarda de fianza resuelta, en uno o varios tenants
- **WHEN** el cron invoca el barrido con la cabecera `X-Cron-Token` válida
- **THEN** el sistema transiciona cada candidata cumplidora a `estado = reserva_completada` bajo el
  contexto RLS de su tenant
- **AND** devuelve un resumen con el nº de candidatas evaluadas, reservas archivadas, candidatas con
  fianza pendiente y fallos aislados

#### Scenario: Llamada sin token o con token inválido se rechaza

- **GIVEN** una petición al barrido de archivado sin `X-Cron-Token` o con un valor que no coincide
  con `CRON_TOKEN`
- **WHEN** el sistema recibe la petición
- **THEN** la rechaza con error de autorización (401)
- **AND** no transiciona ninguna RESERVA

### Requirement: Transición atómica a reserva_completada solo con la guarda de fianza resuelta

El sistema SHALL (DEBE), por cada RESERVA candidata (`estado = 'post_evento'`, ≥ 7 días naturales en
`post_evento`), evaluar la **guarda de fianza resuelta en una única lectura de la fila** dentro de
una **transacción atómica** bajo el contexto RLS de su tenant: si `fianza_status ∈ {devuelta,
retenida_parcial}` **O** `fianza_eur <= 0` **O** `fianza_eur IS NULL`, transicionar `RESERVA.estado`
de `post_evento` a `reserva_completada` y registrar en `AUDIT_LOG` una entrada con `accion =
'transicion'`, `entidad = 'RESERVA'`, `datos_anteriores = {estado: post_evento}` y `datos_nuevos =
{estado: reserva_completada, causa: 'T+7d'}`, con origen **Sistema** (`usuario_id` nulo). La
transición se modela en la **máquina de estados declarativa** del agregado RESERVA (arista
`post_evento → reserva_completada` como estructura de datos, NO `if` dispersos, misma forma que
`MAPA_FINALIZACION_EVENTO` de US-034 y `MAPA_INICIO_EVENTO` de US-031); `reserva_completada` es
**terminal** (sin arista de salida). La guarda de origen y la guarda de fianza se **re-evalúan
dentro de la transacción bajo el lock de la fila** (`SELECT … FOR UPDATE`). (Fuente: `US-037 §Happy
Path`, `§Reglas de negocio`, `§Reglas de Validación`; `CLAUDE.md §Máquina de estados`; UC-28;
guarda de fianza de US-036.)

#### Scenario: Fianza devuelta y T+7d cumplido — archiva

- **GIVEN** una RESERVA en `estado = 'post_evento'`, `fianza_status = devuelta` y ≥ 7 días naturales
  en `post_evento`
- **WHEN** el barrido se ejecuta
- **THEN** en una transacción atómica el sistema fija `RESERVA.estado = reserva_completada`
- **AND** registra en `AUDIT_LOG` `accion = 'transicion'`, `entidad = 'RESERVA'`, `datos_anteriores
  = {estado: post_evento}`, `datos_nuevos = {estado: reserva_completada, causa: 'T+7d'}` con origen
  Sistema
- **AND** la RESERVA queda visible y filtrable en el módulo Histórico y no se envía ningún email al
  cliente ni al gestor

#### Scenario: Sin fianza (fianza_eur = 0 o NULL) — archiva sin evaluar fianza_status

- **GIVEN** una RESERVA en `estado = 'post_evento'`, `fianza_eur = 0` (tenant sin fianza) o
  `fianza_eur IS NULL`, y ≥ 7 días naturales en `post_evento`
- **WHEN** el barrido se ejecuta
- **THEN** la guarda de fianza se satisface por ausencia de fianza (no se evalúa `fianza_status`) y
  el sistema fija `RESERVA.estado = reserva_completada`
- **AND** la RESERVA queda visible y filtrable en el módulo Histórico

#### Scenario: Retención total (retenida_parcial con importe devuelto 0) — es estado resuelto válido

- **GIVEN** una RESERVA en `estado = 'post_evento'`, `fianza_status = retenida_parcial`,
  `fianza_devuelta_eur = 0.00` (retención del 100%) y ≥ 7 días naturales en `post_evento`
- **WHEN** el barrido se ejecuta
- **THEN** el sistema trata `retenida_parcial` (con cualquier importe devuelto, incluido 0) como
  fianza resuelta y fija `RESERVA.estado = reserva_completada`

### Requirement: Fianza no resuelta en T+7d — no archiva y emite alerta interna al gestor sin duplicar

El sistema SHALL (DEBE), cuando una RESERVA candidata (`estado = 'post_evento'`, ≥ 7 días naturales
en `post_evento`) NO cumpla la guarda de fianza resuelta (p. ej. `fianza_status = cobrada` con
`fianza_eur > 0`, o `pendiente`/`recibo_enviado` con importe), **NO** transicionar la RESERVA
(permanece en `post_evento`) y emitir una **alerta interna al gestor**: "⚠️ La reserva [código]
lleva más de 7 días en post_evento con fianza pendiente de resolución. Registra la devolución o
retención (US-036) para poder archivarla." La alerta NO DEBE **duplicarse** en cada ejecución del
cron mientras el estado no cambie (anti-duplicación por flag/idempotencia; el mecanismo concreto es
decisión de diseño). El resumen del barrido DEBE contabilizar estas candidatas como fianza
pendiente. La operación NO DEBE registrar entrada de transición en `AUDIT_LOG` para estas RESERVA.
(Fuente: `US-037 §FA-01 — Fianza no resuelta en T+7d`, `§Reglas de negocio`; UC-28; US-036.)

#### Scenario: Fianza cobrada pero sin resolver en T+7d — no archiva y alerta

- **GIVEN** una RESERVA en `estado = 'post_evento'`, `fianza_status = cobrada`, `fianza_eur > 0`
  (sin devolución ni retención registradas) y ≥ 7 días naturales en `post_evento`
- **WHEN** el barrido evalúa la RESERVA
- **THEN** el sistema no transiciona: `RESERVA.estado` permanece `post_evento`
- **AND** emite una alerta interna al gestor con el código de la reserva remitiendo a US-036
- **AND** no registra ninguna entrada de transición en `AUDIT_LOG` para esa RESERVA

#### Scenario: La alerta de fianza pendiente no se duplica en barridos sucesivos

- **GIVEN** una RESERVA en `post_evento` con fianza no resuelta que ya generó la alerta en un pase
  anterior y cuyo estado y estado de fianza no han cambiado
- **WHEN** el barrido se ejecuta de nuevo
- **THEN** el sistema no vuelve a emitir una alerta duplicada para esa RESERVA
- **AND** la RESERVA sigue sin archivarse (permanece en `post_evento`)

### Requirement: Filtro estricto por estado y antigüedad — solo post_evento con ≥ 7 días naturales

El sistema SHALL (DEBE) aplicar el archivado automático **únicamente** a RESERVA en `estado =
'post_evento'` cuyo tiempo en ese estado sea **≥ 7 días naturales** (T+7d). Cualquier RESERVA en
otro estado (`consulta`, `pre_reserva`, `reserva_confirmada`, `evento_en_curso`,
`reserva_completada`, `reserva_cancelada`) NO DEBE ser transicionada por este barrido; y ninguna
RESERVA que lleve menos de 7 días en `post_evento` DEBE entrar en el pase. La comparación de
antigüedad se hace sobre el **momento de entrada a `post_evento`** determinado por el mecanismo
elegido en el gate (nuevo campo `fechaPostEvento`, derivación de `AUDIT_LOG`, o `fechaActualizacion`
— ver `design.md §D-2`); NO DEBE depender de un string formateado (blindaje del off-by-one de TZ
conocido en presentación). El filtro por estado forma parte de la selección de candidatas (cero
falsos positivos sobre otros estados). (Fuente: `US-037 §Reglas de negocio`, `§Reglas de
Validación`; UC-28.)

#### Scenario: RESERVA en otro estado no se archiva

- **GIVEN** una RESERVA en `estado = 'reserva_confirmada'` (o `consulta`, `pre_reserva`,
  `evento_en_curso`, `reserva_cancelada`)
- **WHEN** el barrido se ejecuta
- **THEN** el sistema no aplica el archivado automático a esa RESERVA (el filtro incluye solo
  `estado = 'post_evento'`)
- **AND** la RESERVA no se modifica

#### Scenario: RESERVA con menos de 7 días en post_evento no entra en el pase

- **GIVEN** una RESERVA en `estado = 'post_evento'` con la fianza resuelta pero solo 3 días
  naturales en `post_evento`
- **WHEN** el barrido se ejecuta
- **THEN** el sistema no la archiva (no cumple T+7d)
- **AND** la RESERVA permanece en `post_evento`

### Requirement: Idempotencia del barrido — reserva ya en reserva_completada no se re-archiva

El sistema SHALL (DEBE) ser idempotente: una RESERVA con `estado = 'reserva_completada'` (archivada
por un pase anterior del cron o por el archivado manual de US-038) **no** es candidata (el filtro
`estado = 'post_evento'` la excluye) y NO DEBE ser modificada ni generar entrada en `AUDIT_LOG`.
Leer `estado = reserva_completada` es suficiente para saltar la RESERVA. N ejecuciones del barrido
sobre la misma RESERVA = **1 sola** transición y **1 sola** entrada de transición. La guarda de
origen se **re-evalúa dentro** de la transacción de cada RESERVA (bajo `SELECT … FOR UPDATE`) para
que un reintento o un pase concurrente re-lea el `estado` ya actualizado y termine como no-op.
(Fuente: `US-037 §FA-02 — Idempotencia (reserva ya archivada)`, `§Reglas de Validación`.)

#### Scenario: Segunda ejecución del barrido no re-archiva una reserva ya completada

- **GIVEN** una RESERVA que ya fue archivada por un pase anterior o por US-038 (`estado =
  reserva_completada`)
- **WHEN** el barrido se ejecuta de nuevo y la evalúa
- **THEN** la RESERVA no está entre las candidatas y no se modifica
- **AND** no se genera ninguna entrada nueva ni duplicada en `AUDIT_LOG`

### Requirement: Concurrencia cron vs archivado manual (US-038) — exactamente una transición gana sin error

El sistema SHALL (DEBE) garantizar que, cuando el barrido de Sistema (US-037) y el gestor mediante
el archivado manual (US-038) intentan transicionar **simultáneamente** la misma RESERVA de
`post_evento` a `reserva_completada`, **exactamente una** operación tiene éxito y actualiza
`RESERVA.estado = reserva_completada`; la segunda detecta bajo el lock que el estado ya no es
`post_evento` (la UPDATE afecta **0 filas**) y termina como **no-op sin error**, sin duplicar el
registro en `AUDIT_LOG` ni generar estado inconsistente. El chequeo del estado actual dentro de la
transacción (patrón "leer-verificar-actualizar" en una única transacción con `SELECT … FOR UPDATE`)
evita la ventana de carrera. La serialización la da PostgreSQL sobre la fila RESERVA, sin locks
distribuidos (Redis/Redlock prohibidos). (Fuente: `US-037 §Concurrencia / Race Conditions`;
`CLAUDE.md §Regla crítica: bloqueo atómico` y `§Jobs asíncronos`.)

#### Scenario: Cron y archivado manual compiten por la misma RESERVA

- **GIVEN** una RESERVA en `estado = 'post_evento'` con la fianza resuelta y ≥ 7 días en
  `post_evento`, sobre la que el cron (US-037) y el gestor (US-038) ejecutan la transición en la
  misma ventana temporal
- **WHEN** ambas operaciones leen `estado = post_evento` y ejecutan la UPDATE bajo el lock de la
  fila
- **THEN** exactamente una tiene éxito y fija `estado = reserva_completada`
- **AND** la segunda observa que el estado ya no es `post_evento` (0 filas afectadas) y termina como
  no-op sin error
- **AND** `AUDIT_LOG` contiene exactamente una entrada de transición para esa RESERVA

### Requirement: El barrido de archivado procesa todas las elegibles con aislamiento de fallos por RESERVA

El sistema SHALL (DEBE) procesar **todas** las RESERVA elegibles del mismo pase, cada una en su
**propia transacción independiente**: el fallo de una transición (excepción, conflicto, guarda) NO
DEBE abortar ni revertir las transiciones de las demás candidatas; el resumen del barrido registra
los fallos aislados. Cuando existen varias RESERVA en `post_evento` con ≥ 7 días, el sistema archiva
todas las que cumplen la guarda de fianza (una entrada de transición independiente por cada
archivado), omite las que ya están en `reserva_completada` y alerta las que tienen fianza pendiente.
(Fuente: `US-037 §Impacto de Negocio`; patrón de fallo aislado de US-012/US-026/US-031.)

#### Scenario: Varias reservas — resueltas archivan, pendientes alertan, ya completada se omite

- **GIVEN** cuatro RESERVA distintas con ≥ 7 días en su estado: dos en `post_evento` con la fianza
  resuelta, una en `post_evento` con fianza no resuelta (`cobrada`, importe > 0), y una ya en
  `reserva_completada`
- **WHEN** el barrido se ejecuta
- **THEN** el sistema archiva las dos resueltas a `reserva_completada` (dos entradas de transición
  en `AUDIT_LOG`), no archiva la de fianza pendiente (alerta interna) y omite la ya completada (cero
  acción)
- **AND** el resumen refleja dos reservas archivadas y una candidata con fianza pendiente

#### Scenario: Un fallo parcial en una candidata no revierte las demás

- **GIVEN** un barrido con N candidatas donde la transición de una falla
- **WHEN** el sistema procesa el pase
- **THEN** cada candidata se procesa en su propia transacción independiente
- **AND** el fallo de una no revierte ni impide la transición de las demás
- **AND** el resumen del barrido refleja la candidata fallida como fallo aislado

### Requirement: La auditoría del archivado automático registra el origen Sistema

El sistema SHALL (DEBE) registrar cada transición automática a `reserva_completada` en `AUDIT_LOG`
con origen **Sistema** (no un `USUARIO`): `accion = 'transicion'`, `entidad = 'RESERVA'`, sin
`usuario_id` de usuario (nulo), `datos_anteriores = {estado: post_evento}`, `datos_nuevos = {estado:
reserva_completada, causa: 'T+7d'}`. Esta convención es la misma que usan los barridos de Sistema de
US-012 (expiración), US-026 (cierre de fichas) y US-031 (inicio de evento). El `AUDIT_LOG` es
**obligatorio** en toda transición ejecutada por el cron y NO se escribe cuando la RESERVA ya está
en `reserva_completada` (idempotencia). (Fuente: `US-037 §Happy Path`, `§Reglas de Validación`;
`er-diagram.md` AUDIT_LOG; convención de auditoría de Sistema de US-012/US-026/US-031.)

#### Scenario: El archivado automático se audita como acción de Sistema

- **GIVEN** una RESERVA candidata que el barrido archiva a `reserva_completada`
- **WHEN** el sistema registra la transición en `AUDIT_LOG`
- **THEN** la entrada tiene `accion = 'transicion'`, `entidad = 'RESERVA'`, `datos_anteriores =
  {estado: post_evento}`, `datos_nuevos = {estado: reserva_completada, causa: 'T+7d'}` y **no** un
  `usuario_id` de usuario final (origen Sistema)

### Requirement: Archivado manual de la reserva a reserva_completada por el gestor desde la ficha

El sistema SHALL (DEBE) permitir al **Gestor** archivar **manualmente** una RESERVA en `estado =
'post_evento'`, transicionándola a `reserva_completada` (estado **terminal e inmutable**) **sin esperar**
al archivado automático de T+7d (US-037), **cuando la fianza esté resuelta**. La acción se expone como un
**endpoint de usuario dedicado** `POST /reservas/{id}/archivar` (actor Gestor), autenticado con **JWT de
usuario** y **rol gestor** (NUNCA `X-Cron-Token`: no es un barrido de Sistema); el `tenant_id` y el
`usuario_id` DERIVAN SIEMPRE del JWT, nunca del path ni del body. El `{id}` del path identifica la ÚNICA
RESERVA a archivar (no es un barrido). La transición reutiliza la **máquina de estados declarativa** del
agregado RESERVA (guarda de origen `resolverArchivadoAutomatico`: `post_evento → reserva_completada`,
terminal, la misma que introdujo US-037; NO se añade arista nueva). Al éxito, la RESERVA queda visible y
filtrable en el módulo Histórico y no se envía ningún email. (Fuente: `US-038 §Historia`, `§Reglas de
negocio`, `§Reglas de Validación`; `use-cases.md` UC-28 flujo alternativo manual; guarda de origen de
US-037; `CLAUDE.md §Máquina de estados`.)

#### Scenario: El gestor archiva una reserva en post_evento con la fianza resuelta

- **GIVEN** una RESERVA en `estado = 'post_evento'` con la fianza resuelta (p. ej. `fianza_status =
  devuelta`), aunque solo lleve 3 días en `post_evento`
- **WHEN** el gestor invoca `POST /reservas/{id}/archivar` con su JWT (rol gestor) y confirma la acción
- **THEN** en una transacción atómica bajo el contexto RLS de su tenant el sistema fija `RESERVA.estado =
  reserva_completada`
- **AND** la RESERVA queda visible y filtrable en el módulo Histórico y sale del pipeline activo
- **AND** no se aplica ningún filtro de antigüedad T+7d (el archivado manual no requiere que hayan
  transcurrido 7 días)

#### Scenario: Solo el gestor autenticado puede archivar

- **GIVEN** una petición a `POST /reservas/{id}/archivar`
- **WHEN** la petición no lleva JWT válido
- **THEN** el sistema la rechaza con 401 y no transiciona ninguna RESERVA
- **AND** si el JWT es válido pero el rol no es gestor, la rechaza con 403 sin ejecutar la transición

#### Scenario: Reserva inexistente o de otro tenant

- **GIVEN** un `{id}` que no corresponde a ninguna RESERVA del tenant del JWT (inexistente o de otro
  tenant, invisible bajo RLS)
- **WHEN** el gestor invoca el archivado manual
- **THEN** el sistema responde 404 y no transiciona ni audita nada

### Requirement: La condición de fianza resuelta del archivado manual es idéntica a la del automático (US-037)

El sistema SHALL (DEBE), en el archivado manual, evaluar la **misma guarda de fianza resuelta** que el
archivado automático de US-037 (`fianzaResuelta`): la fianza está resuelta si `fianza_status ∈ {devuelta,
retenida_parcial}` **O** `fianza_eur ≤ 0` **O** `fianza_eur IS NULL`. La guarda se evalúa **en una única
lectura de la fila** dentro de la transacción atómica, bajo el `SELECT … FOR UPDATE` de la RESERVA. La
AUSENCIA de fianza (`fianza_eur ≤ 0` o `NULL`) satisface la guarda sin evaluar `fianza_status`;
`retenida_parcial` con `fianza_devuelta_eur = 0` (retención del 100%) es un estado resuelto válido.
(Fuente: `US-038 §Reglas de negocio`, `§Happy Path — Sin fianza`, `§Happy Path — Con fianza totalmente
retenida`; guarda de fianza de US-037/US-036.)

#### Scenario: Sin fianza (fianza_eur = 0 o NULL) — archiva sin evaluar fianza_status

- **GIVEN** una RESERVA en `estado = 'post_evento'` con `fianza_eur = 0` (tenant sin fianza) o `fianza_eur
  IS NULL`
- **WHEN** el gestor invoca el archivado manual y confirma
- **THEN** la guarda de fianza se satisface por ausencia de fianza (no se evalúa `fianza_status`) y el
  sistema fija `RESERVA.estado = reserva_completada` sin restricciones adicionales

#### Scenario: Retención total (retenida_parcial con importe devuelto 0) — es estado resuelto válido

- **GIVEN** una RESERVA en `estado = 'post_evento'`, `fianza_status = retenida_parcial`,
  `fianza_devuelta_eur = 0.00` (retención del 100%)
- **WHEN** el gestor invoca el archivado manual y confirma
- **THEN** el sistema trata `retenida_parcial` (con cualquier importe devuelto, incluido 0) como fianza
  resuelta y fija `RESERVA.estado = reserva_completada`

### Requirement: Bloqueo del archivado manual con fianza no resuelta y mensaje específico

El sistema SHALL (DEBE), cuando el gestor intente archivar una RESERVA en `estado = 'post_evento'` cuya
fianza NO esté resuelta (`fianza_status ∈ {cobrada, recibo_enviado, pendiente}` con `fianza_eur > 0`),
**BLOQUEAR** el archivado: NO transicionar (la RESERVA permanece en `post_evento`), NO registrar entrada
de transición en `AUDIT_LOG`, y devolver un error con el mensaje específico "No se puede archivar la
reserva: la fianza está pendiente de resolución. Registra la devolución o retención de fianza antes de
archivar." El bloqueo es una **respuesta de error síncrona** al gestor (NO una alerta interna diferida
como en US-037); el frontend puede además **deshabilitar** el botón "Archivar reserva" cuando la fianza no
está resuelta (defensa en UI), pero el backend valida siempre (defensa en profundidad). El código HTTP
concreto del bloqueo por fianza no resuelta (409 conflicto vs. 422 precondición de negocio) es decisión de
diseño resuelta en el gate (design.md §D-3). (Fuente: `US-038 §FA-01`, `§FA-02`, `§Reglas de Validación`;
guarda de fianza de US-036/US-037.)

#### Scenario: Fianza cobrada sin resolver (FA-01) — bloquea

- **GIVEN** una RESERVA en `estado = 'post_evento'`, `fianza_status = cobrada` y `fianza_eur > 0` (fianza
  cobrada pero sin devolución ni retención registradas)
- **WHEN** el gestor intenta archivar la reserva
- **THEN** el sistema bloquea la acción y devuelve el mensaje "No se puede archivar la reserva: la fianza
  está pendiente de resolución. Registra la devolución o retención de fianza antes de archivar."
- **AND** `RESERVA.estado` permanece `post_evento` y no se registra ninguna entrada de transición en
  `AUDIT_LOG`

#### Scenario: Fianza en estado intermedio recibo_enviado (FA-02) — bloquea con el mismo mensaje

- **GIVEN** una RESERVA en `estado = 'post_evento'`, `fianza_status = recibo_enviado` y `fianza_eur > 0`
- **WHEN** el gestor intenta archivar la reserva
- **THEN** el sistema bloquea con el mismo mensaje que FA-01 (cualquier `fianza_status ∉ {devuelta,
  retenida_parcial}` con `fianza_eur > 0` es "fianza no resuelta")
- **AND** `RESERVA.estado` permanece `post_evento`

### Requirement: La auditoría del archivado manual registra el origen Gestor con usuario_id

El sistema SHALL (DEBE) registrar cada transición manual a `reserva_completada` en `AUDIT_LOG` con origen
**Gestor** (a diferencia del archivado automático de US-037, que es de Sistema con `usuario_id` nulo):
`accion = 'transicion'`, `entidad = 'RESERVA'`, `entidad_id = <id de la RESERVA>`, `usuario_id = <id del
gestor del JWT>` (NO nulo), `datos_anteriores = {estado: post_evento}`, `datos_nuevos = {estado:
reserva_completada}`. La auditoría es **obligatoria** en toda transición manual efectiva y NO se escribe
cuando el archivado se bloquea (fianza no resuelta) ni cuando la RESERVA ya no está en `post_evento`.
(Fuente: `US-038 §Happy Path`, `§Reglas de Validación` — "AUDIT_LOG obligatorio con usuario_id del
gestor"; `er-diagram.md` AUDIT_LOG.)

#### Scenario: El archivado manual se audita como acción del gestor

- **GIVEN** una RESERVA que el gestor archiva a `reserva_completada`
- **WHEN** el sistema registra la transición en `AUDIT_LOG`
- **THEN** la entrada tiene `accion = 'transicion'`, `entidad = 'RESERVA'`, `datos_anteriores = {estado:
  post_evento}`, `datos_nuevos = {estado: reserva_completada}` y `usuario_id = <id del gestor>` (origen
  Gestor, NO Sistema)

### Requirement: Idempotencia y concurrencia del archivado manual frente al cron de US-037

El sistema SHALL (DEBE) garantizar que el archivado manual es idempotente y coordina con el archivado
automático (US-037) sobre la misma RESERVA: la guarda de origen (`resolverArchivadoAutomatico`) se
**re-evalúa dentro de la transacción bajo el `SELECT … FOR UPDATE`** de la fila RESERVA. Si bajo el lock
la RESERVA ya NO está en `post_evento` (porque un pase del cron de US-037, un doble clic del gestor u otra
acción ya la dejó en `reserva_completada` o en otro estado), la guarda devuelve `null` y el sistema NO
transiciona ni audita, devolviendo un conflicto de estado (409 `code: 'transicion_no_permitida'`). Cuando
el barrido de Sistema (US-037) y el gestor (US-038) intentan transicionar **simultáneamente** la misma
RESERVA de `post_evento` a `reserva_completada`, **exactamente una** operación tiene éxito; la segunda
detecta bajo el lock que el estado ya no es `post_evento` y termina sin error (no-op para el cron; 409
para el gestor), sin duplicar el registro en `AUDIT_LOG` ni generar estado inconsistente. La serialización
la da PostgreSQL sobre la fila RESERVA, sin locks distribuidos (Redis/Redlock prohibidos). (Fuente:
`US-038 §Concurrencia / Race Conditions`, `§Reglas de Validación` — `reserva_completada` terminal e
inmutable; `CLAUDE.md §Regla crítica: bloqueo atómico`; US-037 §D-7.)

#### Scenario: Cron (US-037) y archivado manual (US-038) compiten por la misma RESERVA

- **GIVEN** una RESERVA en `estado = 'post_evento'` con la fianza resuelta, sobre la que el cron (US-037)
  y el gestor (US-038) ejecutan la transición en la misma ventana temporal
- **WHEN** ambas operaciones leen `estado = post_evento` bajo el lock de la fila y ejecutan la UPDATE
- **THEN** exactamente una tiene éxito y fija `estado = reserva_completada`
- **AND** la segunda observa que el estado ya no es `post_evento` y termina sin error (no-op para el cron;
  409 `transicion_no_permitida` para el gestor)
- **AND** `AUDIT_LOG` contiene exactamente una entrada de transición para esa RESERVA

#### Scenario: Doble clic del gestor sobre archivar — la segunda petición no re-archiva

- **GIVEN** una RESERVA en `estado = 'post_evento'` con la fianza resuelta sobre la que el gestor lanza
  dos peticiones `POST /reservas/{id}/archivar` concurrentes
- **WHEN** ambas se procesan
- **THEN** una archiva la RESERVA (200) y la otra observa bajo el lock que el estado ya no es
  `post_evento` y responde 409 `transicion_no_permitida`
- **AND** no se genera ninguna entrada duplicada en `AUDIT_LOG`

#### Scenario: Intento de archivar una reserva que no está en post_evento

- **GIVEN** una RESERVA en un estado distinto de `post_evento` (p. ej. `reserva_confirmada`,
  `evento_en_curso`, o ya `reserva_completada`)
- **WHEN** el gestor invoca `POST /reservas/{id}/archivar`
- **THEN** el sistema no transiciona (la guarda de origen devuelve `null`) y responde 409 `code:
  'transicion_no_permitida'`
- **AND** la RESERVA no se modifica y no se registra nada en `AUDIT_LOG`

### Requirement: Transición de descarte por cliente de sub_estado no terminal a 2.z

El sistema SHALL (DEBE) permitir a un Gestor autenticado marcar una RESERVA en
`estado = 'consulta'` y `sub_estado ∈ {2a, 2b, 2c, 2d, 2v}` como **descartada por el
cliente**, transicionándola a `sub_estado = '2z'` (estado **terminal e inmutable**). La
transición modela la variante manual de **UC-10 / A17** ("Salir de la cola") ejecutada
por el Gestor en nombre del cliente que ha comunicado su desistimiento; en el MVP no hay
portal de cliente. La transición `{consulta, 2a|2b|2c|2d|2v} → {consulta, 2z}` DEBE
modelarse en la **máquina de estados declarativa** (`maquina-estados.ts`, tabla de datos,
NO condicionales dispersos), NO como una expiración por TTL (`2.x`, US-012) ni como un
vaciado de cola por activación de pre-reserva (`2.y`, US-014): `2.z` es un terminal
distinto que significa "descartada por cliente". La transición y **todas** sus
consecuencias (liberación de FECHA_BLOQUEADA + promoción/reordenación de cola +
auditoría) son **atómicas en una única transacción** bajo el contexto RLS del tenant.
(Fuente: `US-013 §Historia`, `§Reglas de negocio`, `§Reglas de Validación`; UC-10; A17;
`CLAUDE.md §Máquina de estados`.)

#### Scenario: Descarte desde 2.a solo marca 2.z sin tocar fecha ni cola

- **GIVEN** una RESERVA en `sub_estado = '2a'` (sin fila en `FECHA_BLOQUEADA`, sin cola)
- **WHEN** el Gestor la marca como "descartada por cliente" (con o sin motivo)
- **THEN** la RESERVA pasa a `sub_estado = '2z'`
- **AND** no se busca ni se elimina ninguna fila en `FECHA_BLOQUEADA`
- **AND** no se ejecuta ninguna acción sobre cola

#### Scenario: 2.z es terminal e inmutable

- **GIVEN** una RESERVA que acaba de transicionar a `sub_estado = '2z'`
- **WHEN** se intenta cualquier transición posterior sobre ella
- **THEN** el sistema la rechaza por ser un estado terminal inmutable

### Requirement: Guarda de origen — el descarte por cliente solo es válido desde un sub_estado no terminal

El sistema SHALL (DEBE) validar en el servidor, **antes** de cualquier mutación, que la
RESERVA está en `estado = 'consulta'` con `sub_estado ∈ {2a, 2b, 2c, 2d, 2v}`. Si la
RESERVA está en un sub-estado terminal (`2x`, `2y`, `2z`) o en un estado terminal
(`reserva_cancelada`, `reserva_completada`), el sistema DEBE **rechazar** la petición con
el error "Esta consulta ya está en un estado terminal y no puede modificarse" y **no
modificar** la RESERVA, `FECHA_BLOQUEADA` ni la cola. La guarda se modela en la **máquina
de estados declarativa** (mismo criterio que US-005 §"Guarda de origen"), reutilizando el
patrón ya existente de rechazo desde/hacia estados terminales. En la UI, el botón "Marcar
como descartada" DEBE estar **deshabilitado** para RESERVA en estado terminal; la
validación de servidor es defensiva e independiente de la UI. (Fuente: `US-013 §FA
RESERVA en estado terminal`, `§Reglas de Validación`; patrón US-005 guarda de origen;
`CLAUDE.md §Máquina de estados`.)

#### Scenario: Descarte sobre una RESERVA en estado terminal se rechaza sin efectos

- **GIVEN** una RESERVA en `sub_estado = '2x'`, `2y` o `2z`, o en estado
  `reserva_cancelada`/`reserva_completada`
- **WHEN** el Gestor intenta marcarla como descartada por cliente
- **THEN** el sistema retorna el error "Esta consulta ya está en un estado terminal y no
  puede modificarse"
- **AND** no modifica la RESERVA, `FECHA_BLOQUEADA` ni ninguna posición de cola

### Requirement: Liberación de la fecha bloqueada al descartar desde 2.b, 2.c o 2.v

El sistema SHALL (DEBE), cuando el descarte por cliente parte de un sub_estado con bloqueo
asociado (`2b`, `2c`, `2v`), **liberar la fecha** eliminando la fila de `FECHA_BLOQUEADA`
de la RESERVA descartada mediante la primitiva atómica existente `liberarFecha()`
(US-040/US-041), dentro de la misma transacción de la transición a `2z`. El sistema NO
DEBE usar Redis, Redlock ni locks distribuidos: la atomicidad y la serialización las provee
**exclusivamente PostgreSQL** (`SELECT … FOR UPDATE` sobre la fila de `FECHA_BLOQUEADA`
vía Prisma `$queryRaw` + `UNIQUE(tenant_id, fecha)`). Cuando el origen es `2a` (sin
bloqueo), el sistema NO DEBE buscar ni intentar eliminar ninguna fila en `FECHA_BLOQUEADA`.
La auditoría de la liberación la registra `liberarFecha()` (`entidad = 'FECHA_BLOQUEADA'`,
causa `descarte`); esta transición NO DEBE duplicarla. (Fuente: `US-013 §Happy Path 2.b`,
`§2.c`, `§2.v`, `§Reglas de Validación`; US-040 `liberarFecha()`/`UNIQUE(tenant_id,
fecha)`; `CLAUDE.md §Regla crítica: bloqueo atómico`.)

#### Scenario: Descarte desde 2.b sin cola libera la fecha sin acción de cola

- **GIVEN** una RESERVA en `sub_estado = '2b'` con fila activa en `FECHA_BLOQUEADA` y sin
  ninguna RESERVA en `2d` apuntando a ella
- **WHEN** el Gestor la marca como descartada
- **THEN** en la misma transacción la RESERVA pasa a `2z` y `liberarFecha()` elimina su
  fila de `FECHA_BLOQUEADA`; la fecha queda disponible
- **AND** la búsqueda de cola devuelve 0 resultados y no dispara ninguna acción adicional

#### Scenario: Descarte desde 2.c libera la fecha sin cola posible

- **GIVEN** una RESERVA en `sub_estado = '2c'` (la cola ya se vació al entrar en `2c`)
- **WHEN** el Gestor la marca como descartada
- **THEN** la RESERVA pasa a `2z` y `liberarFecha()` elimina su fila de `FECHA_BLOQUEADA`
- **AND** no se ejecuta ninguna promoción ni reordenación (operación vacía sobre cola,
  válida y sin error)

### Requirement: Promoción FIFO al liberar la fecha si la consulta descartada era bloqueante (2.b/2.v con cola)

El sistema SHALL (DEBE), cuando el descarte parte de `2b` o `2v` y la RESERVA descartada
es `consulta_bloqueante` de una o más RESERVA en `sub_estado = '2d'`, disparar **una única
vez** el seam existente `PromocionColaPort.promoverPrimeroEnCola({ tenantId, fecha })`
(US-018/US-041, mecánica A15/UC-12) como parte indivisible de la liberación de la fecha.
El sistema NO DEBE redefinir la mecánica de promoción: reutiliza el seam tal cual, que
promueve la primera en cola (`posicion_cola = 1`) a `2b`, re-crea la fila de
`FECHA_BLOQUEADA` para la promovida vía `bloquearFecha()` (`tipo_bloqueo = 'blando'`,
`ttl_expiracion = now() + tenant_settings.ttl_consulta_dias`, instante `timestamptz`) y
reordena el resto de la cola re-apuntando a la nueva bloqueante. Si la cola está vacía, el
seam NO se dispara y la operación completa sin error. El caso `2v` con cola heredada (por
haber llegado a `2v` desde `2b`) se trata **idénticamente** al caso `2b` con cola. (Fuente:
`US-013 §Happy Path 2.b con cola`, `§2.v`, `§FA Cola vacía`; seam US-018/US-041 "Promoción
automática FIFO"; A15; UC-12.)

#### Scenario: Descarte desde 2.b con cola dispara la promoción A15 una vez

- **GIVEN** una RESERVA R1 en `2b` que es `consulta_bloqueante` de R2 (`posicion_cola = 1`),
  R3 (`posicion_cola = 2`) en `sub_estado = '2d'`
- **WHEN** el Gestor marca R1 como descartada por cliente
- **THEN** en la misma transacción R1 pasa a `2z`, `liberarFecha()` libera su fecha y
  dispara `promoverPrimeroEnCola` **una vez**
- **AND** R2 pasa a `2b` (nueva bloqueante, `posicion_cola → NULL`,
  `consulta_bloqueante_id → NULL`, `ttl_expiracion → now() + ttl_consulta_dias`) con su
  fila de `FECHA_BLOQUEADA` re-creada vía `bloquearFecha()`
- **AND** R3 queda con `posicion_cola → 1` y `consulta_bloqueante_id → R2.id`

#### Scenario: Descarte desde 2.v con cola heredada dispara la promoción igual que 2.b

- **GIVEN** una RESERVA en `sub_estado = '2v'` que heredó cola activa desde `2b`
- **WHEN** el Gestor la marca como descartada
- **THEN** pasa a `2z`, `liberarFecha()` libera su fecha y dispara la promoción A15 una
  vez, con la misma mecánica que el descarte desde `2b` con cola

#### Scenario: Descarte desde 2.b sin cola no dispara promoción

- **GIVEN** una RESERVA en `2b` sin ninguna RESERVA en `2d` apuntándola
- **WHEN** el Gestor la marca como descartada
- **THEN** libera la fecha y NO dispara `promoverPrimeroEnCola`; la operación completa sin
  error

### Requirement: Salida de cola con reordenación al descartar desde 2.d

El sistema SHALL (DEBE), cuando el descarte por cliente parte de `sub_estado = '2d'` con
`posicion_cola = P` y `consulta_bloqueante_id = B`, ejecutar en la misma transacción
atómica: (1) transicionar la RESERVA a `2z` con `posicion_cola → NULL` y
`consulta_bloqueante_id → NULL` (sale de la cola); (2) **decrementar en 1 la
`posicion_cola`** de **todas** las RESERVA en `sub_estado = '2d'` con el mismo
`consulta_bloqueante_id = B` y `posicion_cola > P`, cerrando el hueco. El sistema NO DEBE
modificar la RESERVA bloqueante (`B`), NO DEBE liberar ninguna `FECHA_BLOQUEADA` (la
RESERVA en `2d` no tiene bloqueo propio) y NO DEBE disparar promoción. La reordenación se
limita a la cola de `B` (mismo `consulta_bloqueante_id`); no afecta a otras colas de otras
fechas. El sistema DEBE preservar la unicidad `UNIQUE(tenant_id, consulta_bloqueante_id,
posicion_cola) WHERE posicion_cola IS NOT NULL` (US-004): tras la reordenación las
posiciones DEBEN ser contiguas empezando en 1. (Fuente: `US-013 §Happy Path 2.d`, `§Reglas
de Validación`; US-004 índice de cola; patrón de reordenación US-018/US-019.)

#### Scenario: Descarte de una posición intermedia de la cola cierra el hueco

- **GIVEN** R1 bloqueante y R2 (`posicion_cola = 1`), R3 (`posicion_cola = 2`), R4
  (`posicion_cola = 3`) en `sub_estado = '2d'` con `consulta_bloqueante_id = R1.id`
- **WHEN** el Gestor marca R3 como descartada por cliente
- **THEN** R3 pasa a `2z` con `posicion_cola → NULL` y `consulta_bloqueante_id → NULL`
- **AND** R4 decrementa a `posicion_cola → 2`; R2 permanece en `posicion_cola = 1`
- **AND** R1 (bloqueante) no se modifica y no se libera ninguna `FECHA_BLOQUEADA`
- **AND** las posiciones de la cola quedan contiguas empezando en 1

#### Scenario: Descarte del último en cola no altera al resto

- **GIVEN** R1 bloqueante y R2 (`posicion_cola = 1`), R3 (`posicion_cola = 2`) en `2d`
- **WHEN** el Gestor marca R3 (última) como descartada
- **THEN** R3 pasa a `2z` (`posicion_cola → NULL`, `consulta_bloqueante_id → NULL`)
- **AND** R2 permanece en `posicion_cola = 1` sin cambios

### Requirement: Motivo de descarte opcional en RESERVA.notas

El sistema SHALL (DEBE) permitir al Gestor registrar **opcionalmente** un motivo de
descarte que se persiste en `RESERVA.notas`. Si el Gestor proporciona motivo, el sistema
DEBE actualizar `RESERVA.notas` con él dentro de la misma transacción de la transición a
`2z`. Si el Gestor **no** proporciona motivo, la transición DEBE completar normalmente y
`RESERVA.notas` DEBE permanecer **sin cambios** (o vacío/`NULL` si ya lo era): la ausencia
de motivo NO DEBE bloquear ni retrasar la transición. (Fuente: `US-013 §Reglas de
negocio`, `§FA Motivo de descarte no proporcionado`, `§Reglas de Validación`.)

#### Scenario: Descarte con motivo actualiza notas

- **GIVEN** un Gestor que marca una RESERVA como descartada e introduce un motivo
- **WHEN** confirma la acción
- **THEN** la transición completa y `RESERVA.notas` queda actualizado con el motivo

#### Scenario: Descarte sin motivo deja notas sin cambios

- **GIVEN** un Gestor que marca una RESERVA como descartada sin introducir motivo
- **WHEN** confirma la acción
- **THEN** la transición completa normalmente y `RESERVA.notas` permanece sin cambios

### Requirement: Auditoría de la transición a 2.z sin duplicar la liberación de fecha

El sistema SHALL (DEBE) registrar en `AUDIT_LOG` la transición de descarte con
`accion = 'transicion'`, `entidad = 'RESERVA'`, `datos_anteriores.sub_estado =
<sub_estado origen>` y `datos_nuevos.sub_estado = '2z'`, dentro de la misma transacción.
Cuando el descarte parte de `2d`, la salida de cola de la RESERVA descartada DEBE quedar
reflejada de forma coherente con el criterio de US-014/US-018 para salidas de cola
(cambio de `posicion_cola`/`consulta_bloqueante_id` en `datos_nuevos`). El sistema NO DEBE
duplicar la auditoría de la liberación de `FECHA_BLOQUEADA` (la registra `liberarFecha()`
con `entidad = 'FECHA_BLOQUEADA'`, causa `descarte`) ni la de la promoción de cola (la
registra el seam `promoverPrimeroEnCola`). El sistema NO DEBE generar ningún email
automático al cliente: esta acción no está mapeada a ningún código E1-E8 del catálogo.
(Fuente: `US-013 §Happy Path 2.a` auditoría, `§Contexto de Negocio` email/AUDIT_LOG;
US-041 auditoría de `liberarFecha()`; US-018 auditoría de promoción.)

#### Scenario: La transición a 2.z deja un registro de auditoría de la RESERVA

- **GIVEN** un descarte por cliente que completa desde `sub_estado = '2a'`
- **WHEN** la transacción confirma
- **THEN** `AUDIT_LOG` contiene una entrada `accion='transicion'`, `entidad='RESERVA'` con
  `datos_anteriores.sub_estado = '2a'` y `datos_nuevos.sub_estado = '2z'`

#### Scenario: El descarte no genera email al cliente

- **GIVEN** cualquier descarte por cliente que completa la transición a `2z`
- **WHEN** la transacción confirma
- **THEN** el sistema NO crea ninguna COMUNICACION ni dispara ningún envío de email al
  cliente

### Requirement: Atomicidad y serialización de la transición de descarte

El sistema SHALL (DEBE) ejecutar la transición de descarte completa —cambio de
`sub_estado` a `2z` + (según origen) liberación de `FECHA_BLOQUEADA` vía `liberarFecha()`
+ promoción de cola vía `promoverPrimeroEnCola` **o** reordenación de la cola de `2d` +
actualización opcional de `RESERVA.notas` + auditoría— como una operación
**all-or-nothing** dentro de **una única transacción** serializada por `SELECT … FOR
UPDATE` sobre la fila de `FECHA_BLOQUEADA` (cuando el origen tiene bloqueo) y/o sobre la
RESERVA, bajo el contexto RLS del tenant. Si cualquier paso falla, la transacción hace
rollback completo: NO DEBE existir un instante observable con la RESERVA en `2z` y una
fila activa de `FECHA_BLOQUEADA` apuntándola, ni con la cola con un hueco de posición. El
sistema NO DEBE usar Redis, Redlock ni locks distribuidos. Este núcleo crítico
(concurrencia del bloqueo y máquina de estados) DEBE cubrirse con **TDD primero**.
(Fuente: `US-013 §Reglas de negocio` — atomicidad, `§Criterio de éxito`; `CLAUDE.md
§Regla crítica: bloqueo atómico`, `§Testing`.)

#### Scenario: Fallo en cualquier paso hace rollback completo

- **GIVEN** un descarte desde `2b` con cola en el que la promoción falla
- **WHEN** la transacción intenta confirmar
- **THEN** hace rollback completo: la RESERVA permanece en `2b`, su `FECHA_BLOQUEADA`
  intacta y la cola sin cambios

#### Scenario: No hay estado intermedio observable de 2.z con fecha bloqueada apuntándola

- **GIVEN** un descarte desde `2b` sin cola en curso
- **WHEN** cualquier lectura concurrente observa la RESERVA
- **THEN** la ve en `2b` con su bloqueo, o en `2z` sin fila de `FECHA_BLOQUEADA`
  apuntándola; nunca en `2z` con un bloqueo activo propio

### Requirement: Concurrencia — descarte vs barrido de TTL, doble descarte y re-bloqueo de fecha

El sistema SHALL (DEBE) garantizar la coherencia del descarte bajo concurrencia mediante
la serialización de PostgreSQL, sin locks distribuidos. **(RC-1)** Si el descarte compite
con el barrido de expiración de TTL (US-012) sobre la misma RESERVA, la primera
transacción en commitear tiene éxito y la segunda, al releer bajo lock, encuentra la
RESERVA fuera de un sub_estado activo y **no actúa**: el resultado final es `2z` **o**
`2x`, nunca ambos ni un estado inconsistente. **(RC-2)** Si la liberación de
`FECHA_BLOQUEADA` compite con una nueva solicitud de bloqueo de la misma `(tenant_id,
fecha)`, la restricción `UNIQUE(tenant_id, fecha)` garantiza que nunca coexistan dos
bloqueos activos: la eliminación ocurre dentro de la transacción de descarte y solo
después puede insertarse la nueva fila. **(RC-3)** Si dos Gestores descartan la misma
RESERVA a la vez, la primera transacción la pasa a `2z` y la segunda recibe un **error
controlado** (RESERVA ya en estado terminal inmutable) que la UI muestra como mensaje
informativo. Esta zona crítica DEBE cubrirse con **TDD primero**. (Fuente: `US-013 §RC-1`,
`§RC-2`, `§RC-3`; US-012 barrido TTL; US-040 `UNIQUE(tenant_id, fecha)`; `CLAUDE.md §Regla
crítica`, `§Testing`.)

#### Scenario: RC-1 — descarte vs expiración TTL nunca deja doble estado

- **GIVEN** un descarte y el barrido de TTL de US-012 compitiendo sobre la misma RESERVA
  cuyo `ttl_expiracion` acaba de vencer
- **WHEN** ambas transacciones se solapan
- **THEN** la primera en commitear tiene éxito; la segunda relee bajo lock, no encuentra la
  RESERVA en sub_estado activo y no actúa
- **AND** el resultado final es `2z` o `2x`, nunca ambos

#### Scenario: RC-2 — liberación vs nuevo bloqueo no produce doble bloqueo

- **GIVEN** la liberación de `FECHA_BLOQUEADA` de `(T, D)` por descarte y, a la vez, un
  nuevo lead que solicita bloquear `(T, D)`
- **WHEN** ambas operaciones se solapan
- **THEN** el descarte elimina la fila dentro de su transacción y solo después la nueva
  solicitud puede insertar; `UNIQUE(tenant_id, fecha)` impide dos bloqueos activos

#### Scenario: RC-3 — doble descarte concurrente: el segundo recibe error controlado

- **GIVEN** dos Gestores que marcan la misma RESERVA como descartada a la vez
- **WHEN** ambas transacciones compiten
- **THEN** la primera pasa la RESERVA a `2z` y la segunda recibe un error controlado
  "estado terminal inmutable" que la UI muestra como mensaje informativo

### Requirement: Forzado manual del inicio de evento por el Gestor — transición reserva_confirmada → evento_en_curso

El sistema SHALL (DEBE) permitir al **gestor** ejecutar la acción "Forzar inicio del evento"
sobre una RESERVA, que transiciona `RESERVA.estado` de `reserva_confirmada` a `evento_en_curso`
**aunque alguna precondición del inicio de evento esté incumplida** (`pre_evento_status ≠
'cerrado'` O `liquidacion_status ≠ 'cobrada'` O `fianza_status ≠ 'cobrada'`). La transición SHALL
(DEBE) reutilizar la **misma guarda de origen declarativa** que el inicio automático de US-031
(`reserva_confirmada → evento_en_curso`, `resolverInicioEvento` en `maquina-estados.ts`); la
única diferencia es que US-032 **fuerza** la transición con independencia de si las tres
precondiciones se cumplen (US-031 solo transiciona si `preconditionesEventoCumplidas().cumple ===
true`). La acción SHALL (DEBE) autenticarse con **JWT de usuario** (rol gestor; NO `X-Cron-Token`:
no es un barrido de Sistema) y ejecutarse bajo el **contexto RLS del tenant** del gestor; el
`tenant_id` y el `usuario_id` derivan del JWT, NUNCA del path/body. (Fuente: `US-032 §Historia`,
`§Happy Path`, `§Reglas de negocio`; `use-cases.md` UC-23 FA-01; `CLAUDE.md §Máquina de estados`.)

#### Scenario: El gestor fuerza el inicio con una precondición incumplida el día del evento

- **GIVEN** una RESERVA en `estado = 'reserva_confirmada'`, `fecha_evento = hoy` y al menos una
  precondición incumplida (p. ej. `liquidacion_status = facturada` en lugar de `cobrada`), en el
  tenant del gestor autenticado
- **WHEN** el gestor selecciona "Forzar inicio del evento" y confirma la doble confirmación
- **THEN** el sistema fija `RESERVA.estado = evento_en_curso` bajo el contexto RLS de su tenant
- **AND** la RESERVA queda en `evento_en_curso`, estado que habilita la vista móvil "evento en
  curso" y el checklist de documentación pendiente (superficie de US-033/US-034)

#### Scenario: El forzado es válido con múltiples precondiciones incumplidas

- **GIVEN** una RESERVA en `estado = 'reserva_confirmada'`, `fecha_evento = hoy`, con
  `pre_evento_status ≠ cerrado`, `liquidacion_status ≠ cobrada` y `fianza_status ≠ cobrada`
  simultáneamente
- **WHEN** el gestor fuerza el inicio y confirma la doble confirmación
- **THEN** la transición a `evento_en_curso` se ejecuta igualmente (el forzado es válido con
  independencia del número de precondiciones incumplidas)
- **AND** las tres precondiciones incumplidas se registran en `AUDIT_LOG.datos_nuevos.
  precondiciones_incumplidas`

### Requirement: El forzado solo está disponible el día del evento (fecha_evento = hoy)

El sistema SHALL (DEBE) permitir el forzado del inicio de evento **únicamente** cuando la RESERVA
esté en `estado = 'reserva_confirmada'` **AND** `date(fecha_evento) = date(hoy)`. La comparación
es por **fecha de calendario del evento** (no por instante ni por un `ttl_expiracion`) usando una
**única definición de "hoy"** en la zona horaria de negocio del servidor/tenant, calculada en el
backend (la guarda NO depende de ningún string formateado; blinda el off-by-one de zona horaria),
coherente con la selección de candidatas de US-031. La guarda de fecha SHALL (DEBE) modelarse
como **función de dominio pura** (`esDiaDelEvento(fechaEvento, hoy)` en `maquina-estados.ts`), NO
como un `if` de fecha disperso. Si `estado = 'reserva_confirmada'` pero `fecha_evento ≠ hoy`, el
forzado SHALL (DEBE) rechazarse **sin efectos** con un error de precondición de negocio
(HTTP 422, `code: 'fecha_evento_no_es_hoy'`), distinto del conflicto de estado. (Fuente: `US-032
§Intento de forzar fuera del día del evento`, `§Reglas de negocio`, `§Reglas de Validación`;
UC-23 FA-01.)

#### Scenario: Intento de forzar antes del día del evento se rechaza sin efectos

- **GIVEN** una RESERVA en `estado = 'reserva_confirmada'` con `fecha_evento ≠ hoy` (p. ej.
  mañana, el gestor abre la ficha el día anterior)
- **WHEN** se invoca el forzado del inicio de evento sobre esa RESERVA
- **THEN** el sistema rechaza la acción sin efectos con un error de precondición de negocio
  (HTTP 422, `fecha_evento_no_es_hoy`)
- **AND** `RESERVA.estado` permanece `reserva_confirmada` y no se registra transición en
  `AUDIT_LOG`

### Requirement: La lista de precondiciones incumplidas se calcula bajo el lock y se persiste en la auditoría

El sistema SHALL (DEBE), en el momento del forzado y **bajo el lock de la fila** (`SELECT … FOR
UPDATE`), calcular las precondiciones incumplidas con la **guarda pura reutilizada**
`preconditionesEventoCumplidas({ preEventoStatus, liquidacionStatus, fianzaStatus })` (US-031),
leyendo los tres `*_status` de la RESERVA en una única lectura, y persistir la lista `faltantes`
en `AUDIT_LOG.datos_nuevos.precondiciones_incumplidas`. El forzado SHALL (DEBE) ejecutarse con
independencia del resultado de la guarda (`cumple` puede ser `false`): a diferencia de US-031, el
resultado de la guarda **no veta** la transición, solo alimenta la evidencia de auditoría. Si en
el momento del forzado las tres precondiciones estuvieran cumplidas (caso borde),
`precondiciones_incumplidas` DEBE ser `[]` y el forzado se ejecuta igualmente. (Fuente: `US-032
§Happy Path`, `§Múltiples precondiciones incumplidas simultáneamente`, `§Reglas de Validación`.)

#### Scenario: Se registran exactamente las precondiciones incumplidas en el momento del forzado

- **GIVEN** una RESERVA en `estado = 'reserva_confirmada'`, `fecha_evento = hoy`, con
  `pre_evento_status = cerrado`, `fianza_status = cobrada` pero `liquidacion_status = facturada`
- **WHEN** el gestor fuerza el inicio del evento
- **THEN** el sistema calcula bajo el lock las precondiciones incumplidas (`[liquidacion_status]`)
- **AND** registra `AUDIT_LOG.datos_nuevos.precondiciones_incumplidas = [liquidacion_status]` y
  transiciona la RESERVA a `evento_en_curso`

### Requirement: La transición forzada se registra en AUDIT_LOG con origen Usuario y forzado_por_gestor = true

El sistema SHALL (DEBE) registrar cada forzado efectivo del inicio de evento en `AUDIT_LOG` con
`accion = 'transicion'`, `entidad = 'RESERVA'`, origen **Usuario** (el gestor autenticado, con su
`usuario_id` poblado — a diferencia del barrido de Sistema de US-031, que no puebla usuario),
`datos_anteriores = {estado: reserva_confirmada}` y `datos_nuevos = {estado: evento_en_curso,
forzado_por_gestor: true, precondiciones_incumplidas: [lista]}`. El campo `forzado_por_gestor =
true` es **evidencia de auditoría OBLIGATORIA**: distingue un inicio forzado de un inicio
automático de US-031 (que nunca lleva `forzado_por_gestor`). La escritura del `AUDIT_LOG` SHALL
(DEBE) formar parte de la **misma transacción** que la UPDATE del estado (all-or-nothing): si la
UPDATE afecta 0 filas, NO se escribe auditoría. (Fuente: `US-032 §Happy Path`, `§Reglas de
Validación`, `§Impacto de Negocio`; `er-diagram.md` AUDIT_LOG.)

#### Scenario: El forzado se audita como acción de Usuario con la marca de override

- **GIVEN** una RESERVA en `evento_en_curso` que el gestor acaba de forzar desde
  `reserva_confirmada`
- **WHEN** el sistema registra la transición en `AUDIT_LOG`
- **THEN** la entrada tiene `accion = 'transicion'`, `entidad = 'RESERVA'`, el `usuario_id` del
  gestor (origen Usuario), `datos_anteriores = {estado: reserva_confirmada}` y `datos_nuevos =
  {estado: evento_en_curso, forzado_por_gestor: true, precondiciones_incumplidas: [lista]}`
- **AND** la entrada permite distinguir este inicio forzado de un inicio automático de US-031

### Requirement: El forzado no resuelve ni modifica los sub-procesos incumplidos

El sistema SHALL (DEBE) tratar el forzado como una operación que muta **exclusivamente**
`RESERVA.estado`: los sub-procesos incumplidos en el momento del forzado (`pre_evento_status`,
`liquidacion_status`, `fianza_status`) **NO** se resuelven automáticamente y **conservan su
valor** tras el forzado, quedando pendientes para gestión posterior. El forzado NO DEBE producir
side-effects sobre `FICHA_OPERATIVA`, los cobros, `FECHA_BLOQUEADA` ni la cola. (Fuente: `US-032
§Reglas de negocio`, `§Reglas de Validación`.)

#### Scenario: Tras el forzado, los sub-procesos incumplidos siguen pendientes

- **GIVEN** una RESERVA en `estado = 'reserva_confirmada'`, `fecha_evento = hoy`, con
  `liquidacion_status = facturada` (no cobrada)
- **WHEN** el gestor fuerza el inicio del evento
- **THEN** `RESERVA.estado = evento_en_curso`
- **AND** `liquidacion_status` sigue siendo `facturada` (y los demás `*_status` conservan su
  valor); ningún sub-proceso se resuelve automáticamente

### Requirement: Cron llegó primero — el forzado es idempotente y no genera doble efecto

El sistema SHALL (DEBE) tratar el forzado como **idempotente** respecto al inicio automático de
US-031 y a otras sesiones del gestor: si la RESERVA **ya no está en `reserva_confirmada`** cuando
se ejecuta el forzado (p. ej. el cron de US-031 la transicionó a `evento_en_curso` mientras el
gestor tenía la pantalla abierta), la acción SHALL (DEBE) detectar el conflicto de estado y
terminar como **no-op sin efectos**, respondiendo con un **conflicto de estado** (HTTP 409,
`code: 'conflicto_estado'`) y el mensaje "El evento ya está en curso (iniciado automáticamente o
por otro usuario). No es necesaria ninguna acción." NO DEBE ejecutar una segunda transición ni
registrar una segunda entrada en `AUDIT_LOG`. La guarda de origen (`resolverInicioEvento`) se
evalúa antes de la transacción y **se re-evalúa dentro de ella bajo el lock** (`SELECT … FOR
UPDATE`), de modo que la RESERVA ya en `evento_en_curso` no produce candidatura. (Fuente: `US-032
§Cron llegó primero — reserva ya en evento_en_curso`, `§Reglas de Validación`.)

#### Scenario: El gestor fuerza pero el cron ya inició el evento

- **GIVEN** una RESERVA que el cron de US-031 ya transicionó a `estado = 'evento_en_curso'`
  mientras el gestor tenía la pantalla de alerta abierta
- **WHEN** el gestor pulsa "Forzar inicio del evento"
- **THEN** el sistema detecta que `estado ≠ reserva_confirmada` y responde con un conflicto de
  estado (HTTP 409) con el mensaje "El evento ya está en curso…"
- **AND** no ejecuta ninguna transición adicional ni registra una segunda entrada en `AUDIT_LOG`

### Requirement: Concurrencia — cron vs gestor (o doble sesión) exactamente una transición gana sin error

El sistema SHALL (DEBE) garantizar que, cuando el barrido de Sistema (US-031) y el gestor
(US-032), o **dos sesiones del gestor**, intentan transicionar **simultáneamente** la misma
RESERVA de `reserva_confirmada` a `evento_en_curso`, **exactamente una** operación tiene éxito y
actualiza `RESERVA.estado = evento_en_curso`; la segunda operación detecta bajo el lock que el
estado ya no es `reserva_confirmada` (la UPDATE condicional `WHERE estado='reserva_confirmada'`
afecta **0 filas**) y termina como **no-op** traducido a conflicto de estado (HTTP 409), sin doble
transición ni doble auditoría. El `AUDIT_LOG` DEBE contener **exactamente una** entrada de
transición para esa RESERVA. La serialización la da PostgreSQL sobre la fila RESERVA (`SELECT …
FOR UPDATE`), **sin locks distribuidos** (Redis/Redlock prohibidos). (Fuente: `US-032
§Concurrencia / Race Conditions`; `CLAUDE.md §Regla crítica: bloqueo atómico` y `§Jobs
asíncronos`.)

#### Scenario: Dos operaciones compiten por forzar la misma reserva

- **GIVEN** una RESERVA en `estado = 'reserva_confirmada'` con `fecha_evento = hoy`, sobre la que
  el cron (US-031) y el gestor (US-032) —o dos sesiones del gestor— ejecutan la transición en la
  misma ventana temporal
- **WHEN** ambas operaciones leen `estado = reserva_confirmada` y ejecutan la UPDATE condicional
  bajo el lock de la fila
- **THEN** exactamente una tiene éxito y fija `estado = evento_en_curso`
- **AND** la segunda observa 0 filas afectadas y termina como no-op / conflicto de estado sin error
- **AND** `AUDIT_LOG` contiene exactamente una entrada de transición para esa RESERVA

### Requirement: Doble confirmación obligatoria en la UI como guardarraíl no eludible

El sistema SHALL (DEBE) exponer en la ficha de la reserva la **lista de precondiciones
incumplidas** (derivable de los `*_status` que ya expone `GET /reservas/{id}`) y un botón "Forzar
inicio del evento" **visible SOLO** cuando `estado = 'reserva_confirmada'` **AND** `fecha_evento =
hoy`. El disparo del forzado SHALL (DEBE) requerir una **doble confirmación** explícita del gestor
(diálogo de dos pasos que enumera las precondiciones incumplidas antes de confirmar); la
cancelación en cualquier paso es un **no-op sin efectos** (sin transición, sin `AUDIT_LOG`). La
doble confirmación es un guardarraíl UX y NO DEBE poder eludirse mediante parámetros de URL ni
shortcuts: la **defensa definitiva** es la validación de servidor (estado ≠ reserva_confirmada →
409; fecha_evento ≠ hoy → 422), no la UI. (Fuente: `US-032 §Reglas de negocio`, `§Gestor cancela
en el diálogo de doble confirmación`, `§Reglas de Validación`.)

#### Scenario: El gestor cancela en el segundo paso del diálogo

- **GIVEN** el gestor ve la alerta de precondiciones incumplidas y pulsa "Forzar inicio del
  evento"
- **WHEN** el gestor cancela en el segundo paso del diálogo de confirmación
- **THEN** `RESERVA.estado` permanece `reserva_confirmada` y no se registra ninguna transición en
  `AUDIT_LOG`
- **AND** el gestor puede reintentar el forzado o resolver las precondiciones pendientes

#### Scenario: El botón no aparece fuera del día del evento

- **GIVEN** una RESERVA en `estado = 'reserva_confirmada'` con `fecha_evento ≠ hoy`
- **WHEN** el gestor navega a la ficha de la reserva
- **THEN** el botón "Forzar inicio del evento" no se renderiza en la UI
- **AND** aunque se invocara el endpoint directamente, el servidor rechazaría el forzado con
  HTTP 422 (`fecha_evento_no_es_hoy`)

### Requirement: Las acciones de la consulta se bloquean mientras el E1 sigue en borrador

El sistema SHALL (DEBE), mientras exista una `COMUNICACION` con `codigo_email = 'E1'` y
`estado = 'borrador'` asociada a la RESERVA, **bloquear las acciones de avance de la
consulta pero MANTENER disponibles la edición de la consulta y la gestión de la fecha**.
Concretamente: DEBEN permanecer disponibles **"Editar consulta"** (edición de campos
simples vía `PATCH /reservas/{id}`) y la **gestión de la fecha** (asignar/cambiar fecha por
el flujo atómico), porque son las acciones que introducen personas/horario/duración —los
datos que el propio borrador necesita (placeholder `___`)— y que el gestor debe poder
reflejar en el borrador antes de enviarlo. El **resto** de acciones downstream (p. ej.
"Generar presupuesto", "Programar visita", "Marcar como descartada") NO DEBEN ofrecerse
mientras el E1 siga en `borrador`; en su lugar, junto a "Generar presupuesto" DEBE mostrarse
un **aviso/CTA** que dirige a **revisar y enviar el correo de confirmación** antes de
continuar. En cuanto el borrador E1 pasa a `estado = 'enviado'` o `'fallido'` (deja de
haber E1 en `borrador`), **todas** las acciones vuelven a mostrarse. Este bloqueo es una
guarda de UI sobre la lectura de la existencia del borrador; las guardas de servidor de las
transiciones (US-046 y máquina de estados) permanecen intactas. (Fuente: `US-047` bloqueo
de acciones; `US-051`; plan aprobado del usuario; spec viva `comunicaciones` "Confirmación
de envío de un borrador".)

#### Scenario: Con un E1 en borrador, la ficha permite editar y gestionar fecha pero bloquea el resto

- **GIVEN** una RESERVA en sub-estado de consulta con una `COMUNICACION`
  `codigo_email = 'E1'`, `estado = 'borrador'`
- **WHEN** el gestor abre la ficha de la consulta
- **THEN** siguen disponibles "Editar consulta" y la gestión de la fecha
  (asignar/cambiar fecha)
- **AND** NO se ofrecen las acciones downstream (p. ej. "Generar presupuesto", "Programar
  visita", "Marcar como descartada")
- **AND** junto a "Generar presupuesto" se muestra el aviso/CTA "Revisa y envía el correo
  de confirmación antes de continuar."

#### Scenario: Al enviar el borrador E1, todas las acciones vuelven a estar disponibles

- **GIVEN** una RESERVA cuya `COMUNICACION` E1 estaba en `borrador` y las acciones
  downstream estaban bloqueadas
- **WHEN** el gestor revisa y envía el borrador E1 (pasa a `estado = 'enviado'`) y la ficha
  se recarga
- **THEN** ya no existe ninguna `COMUNICACION` E1 en `borrador` para la RESERVA
- **AND** todas las acciones (incluidas las downstream) vuelven a renderizarse con
  normalidad

#### Scenario: Sin borrador E1, la ficha muestra las acciones con normalidad

- **GIVEN** una RESERVA en sub-estado de consulta sin ninguna `COMUNICACION` E1 en
  `borrador` (E1 ya enviado, o alta sin comentarios)
- **WHEN** el gestor abre la ficha de la consulta
- **THEN** el bloque de acciones se renderiza normalmente y no aparece el aviso/CTA de
  borrador pendiente

### Requirement: El ítem del pipeline expone si la reserva tiene un borrador E1 pendiente

El sistema SHALL (DEBE) incluir en cada ítem del pipeline devuelto por `GET /reservas`
(`ReservaPipelineItemDto`) el flag booleano `tieneBorradorE1Pendiente`, `true` cuando
existe una `COMUNICACION` con `codigo_email = 'E1'` y `estado = 'borrador'` asociada a esa
RESERVA, y `false` en caso contrario. El flag se **calcula en el mismo query del pipeline**
bajo el contexto RLS del `tenant_id` del JWT (nunca considera comunicaciones de otro
tenant) y se **recalcula en cada fetch**, de modo que al pasar el borrador a `enviado` o
`fallido` el flag vale `false` sin ninguna acción adicional. (Fuente: `US-047` dashboard
alert; `er-diagram §3.17 COMUNICACION`; `CLAUDE.md §Multi-tenancy`.)

#### Scenario: Una reserva con E1 en borrador reporta el flag en true

- **GIVEN** una RESERVA del tenant del gestor con una `COMUNICACION` `codigo_email = 'E1'`,
  `estado = 'borrador'`
- **WHEN** el gestor solicita el pipeline `GET /reservas`
- **THEN** el ítem de esa RESERVA incluye `tieneBorradorE1Pendiente = true`

#### Scenario: Una reserva sin borrador E1 reporta el flag en false

- **GIVEN** una RESERVA sin ninguna `COMUNICACION` E1 en `borrador` (E1 enviado/fallido o
  inexistente)
- **WHEN** el gestor solicita el pipeline
- **THEN** el ítem de esa RESERVA incluye `tieneBorradorE1Pendiente = false`

#### Scenario: El flag no considera comunicaciones de otro tenant

- **GIVEN** una RESERVA cuyo E1 en `borrador` pertenece a otro tenant
- **WHEN** el gestor de un tenant distinto solicita el pipeline
- **THEN** el cálculo del flag se limita al `tenant_id` del JWT y no se ve afectado por la
  comunicación cross-tenant

### Requirement: El kanban y el listado señalan la reserva con un badge de E1 pendiente

El sistema SHALL (DEBE) mostrar en las **cards del kanban** y en las filas del **listado**
del pipeline un **badge ámbar** con el texto "Borrador E1 pendiente" cuando el ítem tiene
`tieneBorradorE1Pendiente === true`, y NO DEBE mostrarlo cuando el flag es `false`. El
badge es una señal visual de dashboard que dirige al gestor a las reservas cuyo primer
email aún no se ha enviado al cliente. (Fuente: `US-047` dashboard alert; `CLAUDE.md
§Web responsive`.)

#### Scenario: La kanban card muestra el badge ámbar con E1 pendiente

- **GIVEN** un ítem del pipeline con `tieneBorradorE1Pendiente = true`
- **WHEN** el gestor visualiza la card de esa RESERVA en el kanban
- **THEN** la card muestra el badge ámbar "Borrador E1 pendiente"

#### Scenario: La fila del listado muestra el badge ámbar con E1 pendiente

- **GIVEN** un ítem del pipeline con `tieneBorradorE1Pendiente = true`
- **WHEN** el gestor visualiza la fila de esa RESERVA en el listado
- **THEN** la fila muestra el badge ámbar "Borrador E1 pendiente"

#### Scenario: Sin E1 pendiente no se muestra el badge

- **GIVEN** un ítem del pipeline con `tieneBorradorE1Pendiente = false`
- **WHEN** el gestor visualiza la card en el kanban o la fila en el listado
- **THEN** no aparece el badge "Borrador E1 pendiente"

### Requirement: Visualización completa de los detalles del evento en la ficha

El sistema SHALL (DEBE) mostrar en la ficha de la RESERVA **todos** los datos del evento
presentes en la entidad: `tipoEvento`, `fechaEvento`, `duracionHoras`, número de invitados
(`numAdultosNinosMayores4`, `numNinosMenores4`, `numInvitadosFinal`), hora de inicio
(`horario`), visita programada (`visitaProgramadaFecha`/`visitaProgramadaHora`) y
comentarios (`notas`). Para cada campo **opcional ausente** (NULL), el sistema DEBE mostrar
un placeholder legible tipo "De momento no se dispone de esta información" en lugar de
omitir el campo, de modo que el gestor vea qué información falta. Esta visualización es de
**lectura**; no muta ninguna entidad. (Fuente: `US-051 §Punto 1`; `er-diagram §3.6
RESERVA`; spec viva `consultas` "Idioma y horario opcionales en el alta de consulta".)

#### Scenario: La ficha muestra todos los datos del evento cuando están presentes

- **GIVEN** una RESERVA con `tipoEvento='boda'`, `fechaEvento` definida,
  `duracionHoras=8`, `numAdultosNinosMayores4=30`, `numNinosMenores4=5`, `horario='11:00'`
  y `notas='Prefieren jardín'`
- **WHEN** el gestor abre la ficha de la consulta
- **THEN** la ficha muestra el tipo de evento, la fecha del evento, la duración (8 h), el
  nº de invitados (30 adultos/niños > 4 y 5 niños ≤ 4), la hora de inicio (11:00) y los
  comentarios

#### Scenario: Los campos opcionales ausentes muestran un placeholder informativo

- **GIVEN** una RESERVA en `2a` sin `duracionHoras`, sin `numAdultosNinosMayores4`, sin
  `horario` y sin `notas`
- **WHEN** el gestor abre la ficha
- **THEN** cada uno de esos campos se muestra con un placeholder tipo "De momento no se
  dispone de esta información"
- **AND** no se oculta el campo ni se deja la ficha sin indicar qué falta

### Requirement: Edición de los datos de una consulta/reserva

El sistema SHALL (DEBE) permitir a un gestor autenticado editar, desde la ficha, los
**campos simples** de la RESERVA mediante `PATCH /reservas/{id}`: `tipoEvento`,
`duracionHoras`, `numAdultosNinosMayores4`, `numNinosMenores4`, `numInvitadosFinal`,
`notas` y `horario`. La edición se ejecuta bajo el contexto RLS del tenant, escribe
`AUDIT_LOG` (`accion='actualizar'`, `entidad='RESERVA'`) y **NO cambia el estado ni el
sub-estado** de la RESERVA. El PATCH **NO DEBE** mutar `fechaEvento` ni el bloqueo de
fecha: toda mutación de fecha pasa por el bloqueo atómico (`bloquearFecha()`/
`liberarFecha()`), nunca por este endpoint. La validación de `horario` (`HH:MM`) es
**cruzada**: solo es válido si la RESERVA tiene `duracionHoras` (ya presente o fijada en el
mismo PATCH); en caso contrario el servidor rechaza con error de validación en `horario` y
no persiste nada. **Además**, cuando exista una `COMUNICACION` con `codigo_email = 'E1'` y
`estado = 'borrador'` para la RESERVA, el sistema DEBE, **tras** actualizar los campos,
**regenerar** el `asunto` y el `cuerpo` de ese borrador re-renderizando la plantilla de
transición (`tipo` según el sub-estado: `2b → 'disponible'`, `2d → 'cola'`; idioma según
`Reserva.idioma`) con los datos ya actualizados, y actualizar el borrador manteniéndolo en
`estado = 'borrador'`. Editar con borrador E1 pendiente **SÍ está permitido** (no hay guarda
409). La regeneración es **best-effort post-commit** (fuera de la transacción del PATCH): si
falla, el PATCH responde igualmente con éxito y el borrador queda editable. La regeneración
**sobrescribe** ediciones manuales previas del borrador (aceptable: el correo aún no se ha
enviado). (Fuente: `US-051 §Punto 2`; `US-005`; `US-047`; plan aprobado del usuario;
`api-spec.yml PATCH /reservas/{id}`, `UpdateReservaRequest`; `CLAUDE.md §Regla crítica:
bloqueo atómico de fecha`; spec viva `consultas` "Plantillas dinámicas de la transición de
fecha".)

#### Scenario: Editar el nº de invitados actualiza la RESERVA sin cambiar de estado

- **GIVEN** una RESERVA en `2b` con `numAdultosNinosMayores4=30`
- **WHEN** el gestor edita el nº de invitados a 20 y confirma
- **THEN** el sistema persiste `numAdultosNinosMayores4=20`
- **AND** la RESERVA permanece en `estado='consulta'` y `subEstado='2b'`
- **AND** no se modifica `FECHA_BLOQUEADA`
- **AND** se registra `AUDIT_LOG` `accion='actualizar'`, `entidad='RESERVA'`

#### Scenario: El PATCH no muta la fecha del evento aunque se intente

- **GIVEN** una RESERVA en `2b` con una `fechaEvento` bloqueada
- **WHEN** el gestor envía un `PATCH /reservas/{id}` con `duracionHoras=12` (y, si el
  cliente incluyera `fechaEvento`, ese campo)
- **THEN** el sistema persiste `duracionHoras=12`
- **AND** NO altera `fechaEvento` ni `FECHA_BLOQUEADA` por la vía del PATCH

#### Scenario: horario sin duracionHoras se rechaza en servidor

- **GIVEN** una RESERVA sin `duracionHoras`
- **WHEN** el gestor envía un `PATCH /reservas/{id}` con `horario='10:00'` y sin
  `duracionHoras`
- **THEN** el servidor retorna un error de validación en el campo `horario`
- **AND** no persiste ningún cambio en la RESERVA

#### Scenario: Asignar la fecha en 2.a reutiliza el flujo atómico existente

- **GIVEN** una RESERVA exploratoria en `2a` (sin fecha, `ttl_expiracion = NULL`)
- **WHEN** el gestor asigna una fecha del evento desde la ficha
- **THEN** el sistema NO usa el `PATCH /reservas/{id}` para la fecha, sino el flujo
  `POST /reservas/{id}/fecha` (transición `2a → 2b/2d` con bloqueo atómico y cola)

#### Scenario: Editar los campos con un E1 en borrador regenera el borrador con los datos nuevos

- **GIVEN** una RESERVA en `2b` con una `COMUNICACION` `codigo_email = 'E1'`,
  `estado = 'borrador'` cuyo cuerpo tiene el placeholder `___` en `personas` y `horas`
- **WHEN** el gestor edita `numInvitadosFinal=40` y `duracionHoras=8` y confirma
- **THEN** tras persistir los campos, el sistema re-renderiza la plantilla "disponible"
  con `personas=40` y `horas=8` y actualiza el `asunto`/`cuerpo` del borrador
- **AND** la `COMUNICACION` E1 permanece en `estado = 'borrador'` (no se envía)
- **AND** el cuerpo del borrador ya no contiene `___` en `personas` ni en `horas`

#### Scenario: La regeneración del borrador es best-effort y no revierte la edición

- **GIVEN** una RESERVA en `2d` con un borrador E1 pendiente y una edición de campos válida
- **WHEN** la edición se persiste correctamente pero la regeneración posterior del borrador
  falla
- **THEN** el PATCH responde con éxito y los campos quedan actualizados
- **AND** la edición no se revierte y el borrador queda editable para un reintento

#### Scenario: Sin borrador E1 en borrador, editar no toca ninguna comunicación

- **GIVEN** una RESERVA en `2b` cuya `COMUNICACION` E1 ya está `enviado` (o no existe)
- **WHEN** el gestor edita los campos simples y confirma
- **THEN** el sistema persiste los campos sin regenerar ni crear ninguna `COMUNICACION`

#### Scenario: Editar con éxito muestra banner y scroll al top

- **GIVEN** el gestor tiene abierto el diálogo "Editar consulta" de una RESERVA
- **WHEN** modifica algún campo y pulsa "Guardar cambios" (botón verde)
- **THEN** el sistema persiste los cambios, cierra el diálogo y hace scroll al inicio de
  la ficha
- **AND** se muestra un banner inline verde (emerald) en la cabecera con el mensaje
  "Consulta {código} actualizada"
- **AND** el banner es descartable con un botón de cerrar

### Requirement: Cambio atómico de una fecha ya bloqueada

El sistema SHALL (DEBE), cuando el gestor cambia la **fecha del evento** de una RESERVA que
YA tiene una fecha bloqueada (sub-estados `2b`/`2c`/`2v`) **o** de una RESERVA en **cola de
espera** (sub-estado `2d`), ejecutar una **única transacción atómica** bajo el contexto RLS
del `tenant_id` del JWT, con `SELECT … FOR UPDATE` sobre la RESERVA y sobre
`FECHA_BLOQUEADA(tenant_id, fecha_nueva)`, respetando `UNIQUE(tenant_id, fecha)`.

**Orígenes.** El cambio de fecha es válido desde `2b`/`2c`/`2v` (guarda declarativa
`esOrigenValidoParaCambiarFecha` sobre `ORIGENES_CAMBIAR_FECHA_BLOQUEADA`) **y** desde `2d`
(guarda declarativa **separada** `esOrigenCambiarFechaEnCola` sobre
`ORIGENES_CAMBIAR_FECHA_EN_COLA = [{ estado: 'consulta', subEstado: '2d' }]`). Ambas guardas
se modelan como estructura de datos, NO como condicionales dispersos, y se re-evalúan **bajo
el lock** antes de mutar. Cualquier otro `(estado, sub_estado)` se rechaza **sin efectos**
con **422**.

**Rama `2b`/`2c`/`2v` (la RESERVA posee bloqueo propio).** Si la fecha nueva está libre, el
sistema DEBE bloquearla (`bloquearFecha`), actualizar `RESERVA.fecha_evento`, liberar la
fecha antigua (`liberarFecha`) conservando el sub-estado, y, si la fecha antigua tenía cola
de espera, disparar la **promoción FIFO** del primero en cola (mecánica A15). Si la fecha
nueva NO puede bloquearse (ocupada por otra RESERVA), el sistema DEBE rechazar el cambio con
conflicto **sin** tocar la RESERVA ni la fecha antigua (rollback total).

**Rama `2d` (la RESERVA NO posee bloqueo propio).** A diferencia de la rama anterior, una
RESERVA en `2d` **no tiene fila `FECHA_BLOQUEADA`** (está en cola, no bloquea nada). Si la
fecha nueva `F2` está **libre**, el sistema DEBE, en la misma transacción: (1) **INSERTAR un
bloqueo nuevo** de `F2` mediante la primitiva atómica existente (`bloquearEnTx` /
`resolverPlanBloqueo` fase `2.b`, bloqueo **blando con TTL**), fijando `ttl_expiracion`;
(2) actualizar `RESERVA.fecha_evento = F2`; (3) **cambiar `sub_estado` de `2d` a `2b`**;
(4) **sacar la RESERVA de la cola** con `posicion_cola → NULL` y `consulta_bloqueante_id →
NULL`, y **reordenar la cola vieja** decrementando en 1 la `posicion_cola` de los hermanos
con el mismo `consulta_bloqueante_id` y `posicion_cola > P` (mecánica idéntica al requirement
*"Salida de cola con reordenación al descartar desde 2.d"*, US-013), preservando
`UNIQUE(tenant_id, consulta_bloqueante_id, posicion_cola) WHERE posicion_cola IS NOT NULL` y
dejando las posiciones contiguas empezando en 1; (5) crear una `COMUNICACION` **E1** en
estado **`borrador`** (`fecha_envio = NULL`, **no autoenviada**) reutilizando
`plantilla-transicion-fecha.ts` rama `'disponible'`. El sistema **NO DEBE promover** ninguna
cola (la RESERVA en `2d` no libera bloqueo alguno) y **NO DEBE modificar** la RESERVA
bloqueante de su fecha antigua ni su `FECHA_BLOQUEADA`. Si la fecha nueva `F2` está
**ocupada** por otra RESERVA, el sistema DEBE rechazar el cambio con conflicto **terminal**
(**409**) **sin** tocar nada: la RESERVA conserva su `sub_estado = '2d'`, su `posicion_cola`,
su `consulta_bloqueante_id` y la cola no se reordena (**rollback total**); NO se ofrece
re-encolar (el error expone solo `motivo`, **sin** `colaDisponible`).

El sistema NO DEBE usar locks distribuidos (Redis/Redlock): la serialización la da
PostgreSQL. Toda la operación registra `AUDIT_LOG` (`accion='actualizar'`, `entidad='RESERVA'`)
con la fecha anterior y la nueva; en la rama `2d` la salida de cola queda reflejada de forma
coherente (cambio de `sub_estado`, `posicion_cola`, `consulta_bloqueante_id` en
`datos_nuevos`). **Sin migración de BD**: las columnas `posicion_cola`,
`consulta_bloqueante_id`, `ttl_expiracion` y `sub_estado` ya existen. (Fuente: `US-051 §Punto
2` y `§D-2.3` (rama `2d` diferida a este change); UC-05/UC-12/UC-18; requirement vivo
*"Salida de cola con reordenación al descartar desde 2.d"* (US-013); US-004 índice de cola;
change archivado `email-transicion-fecha-borrador`; `er-diagram §FECHA_BLOQUEADA`;
`CLAUDE.md §Regla crítica: bloqueo atómico de fecha`.)

#### Scenario: Cambiar a una fecha libre libera la antigua y bloquea la nueva atómicamente

- **GIVEN** una RESERVA en `2b` con la fecha `F1` bloqueada y la fecha `F2` libre
- **WHEN** el gestor cambia la fecha del evento de `F1` a `F2`
- **THEN** en una única transacción el sistema bloquea `F2`, actualiza
  `RESERVA.fecha_evento = F2` y libera `F1`
- **AND** la RESERVA permanece en `estado='consulta'`, `subEstado='2b'`
- **AND** registra `AUDIT_LOG` `accion='actualizar'` con `F1` (anterior) y `F2` (nueva)

#### Scenario: Dos cambios concurrentes a la misma fecha nueva solo dejan pasar a uno

- **GIVEN** dos RESERVAS del mismo tenant, cada una con su fecha bloqueada, que solicitan a
  la vez cambiar a la **misma** fecha nueva `F2` (libre)
- **WHEN** ambas transacciones se ejecutan concurrentemente
- **THEN** exactamente una bloquea `F2` (respetando `UNIQUE(tenant_id, fecha)`) y completa
  el cambio
- **AND** la otra recibe conflicto y su RESERVA y su fecha antigua quedan intactas

#### Scenario: Liberar una fecha con cola promueve al primero en cola

- **GIVEN** una RESERVA en `2b` con la fecha `F1` bloqueada y **una consulta en cola** sobre
  `F1`, y una fecha `F2` libre
- **WHEN** el gestor cambia la fecha del evento de `F1` a `F2`
- **THEN** al liberar `F1` el sistema promueve (FIFO, A15) al primero en cola de `F1`
  exactamente una vez, sin estado intermedio observable

#### Scenario: La fecha nueva ocupada aborta el cambio sin efectos

- **GIVEN** una RESERVA en `2b` con la fecha `F1` bloqueada y una fecha `F2` **ya
  bloqueada** por otra RESERVA
- **WHEN** el gestor intenta cambiar la fecha del evento de `F1` a `F2`
- **THEN** el sistema rechaza el cambio con conflicto
- **AND** la RESERVA conserva `fecha_evento = F1` y `F1` sigue bloqueada (rollback total)

#### Scenario: Cambiar una consulta en cola (2d) a una fecha libre la saca de la cola y pasa a 2.b

- **GIVEN** una RESERVA en `estado='consulta'`, `subEstado='2d'` con
  `posicion_cola = P`, `consulta_bloqueante_id = B` y su fecha antigua bloqueada por `B`, y
  una fecha `F2` **libre**
- **WHEN** el gestor cambia la fecha del evento a `F2`
- **THEN** en una única transacción el sistema INSERTA el bloqueo blando de `F2` (fijando
  `ttl_expiracion`), actualiza `RESERVA.fecha_evento = F2` y cambia `subEstado` de `2d` a
  `2b`
- **AND** la RESERVA sale de la cola: `posicion_cola → NULL` y `consulta_bloqueante_id →
  NULL`
- **AND** la cola vieja se reordena decrementando en 1 la `posicion_cola` de los hermanos
  con el mismo `consulta_bloqueante_id = B` y `posicion_cola > P`
- **AND** el sistema crea una `COMUNICACION` E1 en `borrador` (`fecha_envio = NULL`, no
  autoenviada) con la plantilla de transición de fecha rama `'disponible'`
- **AND** registra `AUDIT_LOG` `accion='actualizar'`, `entidad='RESERVA'`
- **AND** el sistema NO promueve ninguna cola y NO modifica la RESERVA bloqueante `B` ni su
  `FECHA_BLOQUEADA`

#### Scenario: Cambiar una consulta en cola (2d) a una fecha ocupada aborta con conflicto (409) sin efectos

- **GIVEN** una RESERVA en `subEstado='2d'` con `posicion_cola = P` y
  `consulta_bloqueante_id = B`, y una fecha `F2` **ya bloqueada** por otra RESERVA
- **WHEN** el gestor intenta cambiar la fecha del evento a `F2`
- **THEN** el sistema rechaza el cambio con conflicto **terminal (409)** exponiendo solo
  `motivo` (sin `colaDisponible`)
- **AND** la RESERVA conserva `subEstado='2d'`, su `posicion_cola = P` y su
  `consulta_bloqueante_id = B`; ninguna cola se reordena ni se muta nada (rollback total)

#### Scenario: Al salir de la cola por cambio de fecha, la cola vieja se reordena contigua desde 1

- **GIVEN** R1 bloqueante y R2 (`posicion_cola = 1`), R3 (`posicion_cola = 2`), R4
  (`posicion_cola = 3`) en `subEstado='2d'` con `consulta_bloqueante_id = R1.id`, y una
  fecha `F2` libre
- **WHEN** el gestor cambia la fecha de R3 a `F2` (fecha libre)
- **THEN** R3 sale de la cola (`posicion_cola → NULL`, `consulta_bloqueante_id → NULL`) y
  pasa a `2b` bloqueando `F2`
- **AND** R4 decrementa a `posicion_cola → 2`; R2 permanece en `posicion_cola = 1`
- **AND** las posiciones de la cola quedan contiguas empezando en 1, preservando
  `UNIQUE(tenant_id, consulta_bloqueante_id, posicion_cola)`
- **AND** R1 (bloqueante) no se modifica y no se libera ninguna `FECHA_BLOQUEADA`

#### Scenario: Guarda de origen — el cambio de fecha es válido desde 2d además de 2b/2c/2v

- **GIVEN** una RESERVA en `subEstado='2d'`
- **WHEN** el gestor solicita cambiar la fecha del evento
- **THEN** la guarda de origen acepta la operación (además de `2b`/`2c`/`2v`)
- **AND** cualquier otro `(estado, sub_estado)` distinto de `2b`/`2c`/`2v`/`2d` se rechaza
  con **422** sin efectos

### Requirement: Sin acciones en consultas cerradas (estados y sub-estados terminales)

El sistema SHALL (DEBE), cuando la RESERVA está en un **sub-estado terminal de consulta**
(`2x`/`2y`/`2z`) o en un **estado terminal** (`reserva_cancelada`, `reserva_completada`),
NO ofrecer **ninguna** acción en la ficha —**ni siquiera deshabilitada**—: el sistema NO
DEBE renderizar los botones "Generar presupuesto" ni "Marcar como descartada" (ni ningún
otro), y en su lugar DEBE mostrar únicamente el fallback "No hay acciones disponibles para
esta consulta en su estado actual." Esta es una guarda de **UI** sobre el estado de la
RESERVA; las guardas de servidor de las transiciones permanecen intactas y revalidan de
forma defensiva. (Fuente: `US-051 §Punto 4`; `CLAUDE.md §Máquina de estados`; spec viva
`consultas`.)

#### Scenario: Una consulta descartada (2.z) no muestra ninguna acción

- **GIVEN** una RESERVA en `estado='consulta'`, `subEstado='2z'` (descartada)
- **WHEN** el gestor abre la ficha
- **THEN** la ficha NO renderiza ningún botón de acción (ni deshabilitado)
- **AND** muestra únicamente "No hay acciones disponibles para esta consulta en su estado
  actual."

#### Scenario: Una reserva cancelada no muestra ninguna acción

- **GIVEN** una RESERVA en `estado='reserva_cancelada'`
- **WHEN** el gestor abre la ficha
- **THEN** la ficha muestra únicamente el fallback "No hay acciones disponibles" y ningún
  botón

#### Scenario: Un sub-estado terminal no pinta "Generar presupuesto" ni "Descartar" deshabilitados

- **GIVEN** una RESERVA en `estado='consulta'`, `subEstado='2x'` (expirada)
- **WHEN** el gestor abre la ficha
- **THEN** NO aparecen los botones "Generar presupuesto" ni "Marcar como descartada" (ni
  siquiera deshabilitados con motivo)

### Requirement: Descarte manual de una pre-reserva a estado terminal por el Gestor

El sistema SHALL (DEBE) permitir a un Gestor autenticado **descartar manualmente** una RESERVA
en `estado = 'pre_reserva'`, transicionándola al estado **terminal** `reserva_cancelada`
(`sub_estado = NULL`, `ttl_expiracion = NULL`) en una **única transacción atómica** bajo el
contexto RLS del `tenant_id` del JWT. La transición es **mono-origen**: el ÚNICO origen legal es
`pre_reserva` (sub_estado `NULL`), validado por la guarda declarativa
`ORIGENES_TRANSICION_DESCARTAR_PRERESERVA = [{ estado: 'pre_reserva', subEstado: null }]` en
`maquina-estados.ts` (modelada como estructura de datos, NO condicionales dispersos; mismo
patrón que `ORIGENES_TRANSICION_CONFIRMAR_SENAL` de US-021). El destino `reserva_cancelada`
reutiliza el mismo terminal que la expiración de TTL de la pre-reserva (`MAPA_EXPIRACION_TTL`),
pero disparado **deliberadamente** por el Gestor. Cualquier otro estado que NO sea `pre_reserva`
ni `consulta` (`reserva_confirmada` y posteriores) NO es origen legal para el descarte de
pre-reserva y se rechaza **sin efectos** con **422**; una RESERVA ya terminal
(`reserva_cancelada`/`reserva_completada`, inmutables) o una carrera perdida bajo el lock se
rechaza con **409**. Esta transición se expone por el endpoint **REUTILIZADO**
`POST /reservas/{id}/descartar` (D-2, el mismo de US-013), que **despacha por el estado actual de
la RESERVA**: `consulta` (+sub-estados `2a|2b|2c|2d|2v`) → comportamiento US-013 (→ `2z`);
`pre_reserva` → esta transición (→ `reserva_cancelada`). El despacho por fase vive en un
**use-case orquestador** (no en condicionales de negocio dispersos en el controller): el
controller HTTP elige el caso de uso según `reserva.estado` y mapea los errores de dominio a HTTP.
El `tenant_id` y el `usuario_id` derivan SIEMPRE del JWT, nunca del path ni del body. (Fuente:
workstream B; `ORIGENES_TRANSICION_CONFIRMAR_SENAL`; US-013 descarte manual
(`descartar-consulta.controller.ts`); `CLAUDE.md §Máquina de estados`.)

#### Scenario: El Gestor descarta una pre-reserva y la deja en reserva_cancelada

- **GIVEN** una RESERVA en `estado = 'pre_reserva'` del tenant del Gestor
- **WHEN** el Gestor confirma el descarte de la pre-reserva
- **THEN** la RESERVA queda en `estado = 'reserva_cancelada'`, `sub_estado = NULL` y
  `ttl_expiracion = NULL`
- **AND** todo ocurre en una única transacción bajo el contexto RLS del `tenant_id` del JWT

#### Scenario: Descartar desde un estado que no es pre_reserva se rechaza sin efectos

- **GIVEN** una RESERVA en `estado = 'consulta'` (cualquier sub_estado) o en
  `reserva_confirmada`/posteriores
- **WHEN** se intenta descartarla como pre-reserva
- **THEN** el sistema rechaza la operación con **422** (origen inválido) sin mutar ninguna
  entidad

#### Scenario: Descartar una reserva ya terminal se rechaza como conflicto

- **GIVEN** una RESERVA ya en `reserva_cancelada` (por una petición previa o una carrera
  perdida bajo el lock)
- **WHEN** llega un segundo descarte de la misma RESERVA
- **THEN** el sistema responde **409** (transición no permitida) sin efectos adicionales

### Requirement: El descarte de la pre-reserva libera la fecha y promueve la cola en la misma transacción

El sistema SHALL (DEBE), al descartar una pre-reserva, ejecutar dentro de la **misma
transacción atómica** (`SELECT … FOR UPDATE` sobre `FECHA_BLOQUEADA` y RESERVA; sin locks
distribuidos): (1) **re-evaluar** la guarda de origen bajo el lock (para detectar el doble clic
o la carrera → 409); (2) transicionar la RESERVA a `reserva_cancelada`; (3) **liberar la
`FECHA_BLOQUEADA`** de esa fecha invocando **exclusivamente** la función canónica
`liberarFecha()` (regla dura: nunca por otra vía); y (4) **promover/reordenar la cola** de esa
fecha —si existe cola activa (`sub_estado = '2d'` apuntando a la reserva liberada)— con la
**misma mecánica** de promoción de US-018 usada por el descarte de consulta (US-013) y por la
liberación (US-041), garantizando **exactamente-una-vez** la promoción. La operación es
**all-or-nothing**: cualquier fallo revierte por completo (no queda fecha liberada sin la RESERVA
cancelada, ni cola promovida a medias). (Fuente: workstream B;
`descartar-consulta-uow.prisma.adapter.ts`; capability `bloqueo-fecha`
`R-LIBERACION-DESCARTE-PRERESERVA`; US-018 promoción; `CLAUDE.md §Regla crítica`,
`§Jobs asíncronos`.)

#### Scenario: Descartar una pre-reserva con cola libera la fecha y promueve al primero

- **GIVEN** una RESERVA en `pre_reserva` con su `FECHA_BLOQUEADA` firme y una cola activa
  (`RESERVA` en `2.d`) sobre esa fecha
- **WHEN** el Gestor descarta la pre-reserva
- **THEN** en la misma transacción se transiciona a `reserva_cancelada`, se invoca
  `liberarFecha()` para esa fecha y se promueve el primero de la cola exactamente una vez
- **AND** el resultado es all-or-nothing (no hay estado intermedio observable)

#### Scenario: Descartar una pre-reserva sin cola libera la fecha sin promover

- **GIVEN** una RESERVA en `pre_reserva` con su `FECHA_BLOQUEADA` firme y sin ninguna `RESERVA`
  en `2.d` que apunte a esa fecha
- **WHEN** el Gestor descarta la pre-reserva
- **THEN** se transiciona a `reserva_cancelada` y se libera la fecha vía `liberarFecha()` sin
  disparar ninguna promoción

#### Scenario: Un fallo durante el descarte revierte todo

- **GIVEN** una RESERVA en `pre_reserva` en proceso de descarte
- **WHEN** una escritura de la transacción (liberación de fecha o promoción de cola) falla
- **THEN** la RESERVA conserva `estado = 'pre_reserva'` y su `FECHA_BLOQUEADA` intacta
- **AND** no queda ninguna mutación parcial persistida

### Requirement: Confirmación con motivo opcional auditado en el descarte de pre-reserva

El sistema SHALL (DEBE) aceptar un **motivo OPCIONAL** al descartar la pre-reserva
(`{ motivo?: string }` en el body del endpoint **REUTILIZADO** `POST /reservas/{id}/descartar`,
el mismo de US-013 — D-2). La operación DEBE registrar en la misma transacción un `AUDIT_LOG` con
`accion = 'transicion'`, `entidad = 'RESERVA'`, el par origen→destino (`pre_reserva` →
`reserva_cancelada`) y, si viaja, el `motivo` en `datos_nuevos`. La **ausencia** de motivo
(`undefined`) NO bloquea la transición. El endpoint es `@Roles('gestor')`; el `tenant_id` y el
`usuario_id` (origen Gestor del AUDIT_LOG) derivan del JWT. El frontend ofrece el descarte con un
componente `AccionDescartarPreReserva` de tratamiento **secundario/destructivo** (botón outline,
**NO verde**, patrón `AccionDescartar` de US-013), **visible solo en `pre_reserva`**, y un diálogo
de confirmación con el motivo opcional (RHF + Zod); dicho componente **invoca el MISMO endpoint
`descartar`** que ya cubre el SDK regenerado (no una operación separada). La guarda
`puedeDescartarPreReserva({ estado })` vive en `lib/` (guardrail: no en `components/`). (Fuente:
workstream B; `descartar-consulta-por-cliente.use-case.ts` motivo opcional; `AccionDescartar.tsx`;
`CLAUDE.md §Estructura del frontend`; `er-diagram.md §AUDIT_LOG`.)

#### Scenario: Descartar con motivo lo audita en AUDIT_LOG

- **GIVEN** una RESERVA en `pre_reserva` y un `motivo` informado en el body
- **WHEN** el Gestor confirma el descarte
- **THEN** se registra un `AUDIT_LOG` con `accion = 'transicion'`, `entidad = 'RESERVA'`, el par
  `pre_reserva → reserva_cancelada` y el `motivo` en `datos_nuevos`

#### Scenario: Descartar sin motivo transiciona igualmente

- **GIVEN** una RESERVA en `pre_reserva` y un body sin `motivo`
- **WHEN** el Gestor confirma el descarte
- **THEN** la transición a `reserva_cancelada` se completa y el `AUDIT_LOG` registra la
  transición sin motivo

#### Scenario: La acción de descarte de pre-reserva se presenta como secundaria/destructiva

- **GIVEN** la sección "Acciones" de una RESERVA en `pre_reserva`
- **WHEN** se renderiza la acción "Descartar pre-reserva"
- **THEN** usa el tratamiento secundario/destructivo (botón outline, NO verde) y su
  visibilidad/habilitación la decide `puedeDescartarPreReserva({ estado })`

### Requirement: Plantillas dinámicas de la transición de fecha (disponible / cola)

El sistema SHALL (DEBE) renderizar el asunto y el cuerpo del borrador E1 de la transición
de fecha mediante un **módulo puro y testeable** (sin importar framework ni infra),
seleccionando **una de dos plantillas** según la rama de la transición: **"fecha
disponible"** (rama libre, `2.a → 2.b`) y **"fecha bloqueada"** (rama cola, `2.a → 2.d`).
El **asunto de la rama "fecha disponible"** DEBE ser **"Pre-reserva confirmada"** en
castellano y su equivalente en catalán (**"Pre-reserva confirmada"**); el asunto de la rama
"fecha bloqueada" NO cambia. El render interpola las variables: `nombre` (nombre de pila del
cliente, `Cliente.nombre`), `fechaEvento` (formateada según el idioma, estilo *"19 de
juliol de 2026"* / *"19 de julio de 2026"*, reutilizando el formateo del catálogo de
US-045), `personas` (= `Reserva.num_invitados_final`) y `horas` (= `Reserva.duracion_horas`).
La firma es **hardcodeada** *"Ari — Masia l'Encís"* (coherente con el catálogo E1/E3
actual; parametrizar por tenant es deuda futura). El "40 %" del pago y la solicitud de datos
fiscales son **texto fijo** de la plantilla "disponible". (Fuente: US-005 §Email
relacionado; plan aprobado del usuario; catálogo §9.3 E1.)

#### Scenario: Rama libre renderiza la plantilla "fecha disponible" con asunto "Pre-reserva confirmada"

- **GIVEN** una transición `2.a → 2.b` de una RESERVA con `nombre`, `fecha_evento`,
  `num_invitados_final` y `duracion_horas` conocidos
- **WHEN** el sistema renderiza el borrador E1
- **THEN** el asunto es "Pre-reserva confirmada" y el cuerpo corresponde a la plantilla
  "fecha disponible" con el `nombre`, la `fechaEvento` formateada, `personas` y `horas`
  interpolados, y la firma "Ari — Masia l'Encís"

#### Scenario: Rama cola renderiza la plantilla "fecha bloqueada" sin cambiar su asunto

- **GIVEN** una transición `2.a → 2.d` (cola aceptada) de una RESERVA con `nombre` y
  `fecha_evento` conocidos
- **WHEN** el sistema renderiza el borrador E1
- **THEN** el asunto y el cuerpo corresponden a la plantilla "fecha bloqueada" (asunto sin
  cambios) con el `nombre` y la `fechaEvento` formateada interpolados, y la firma
  "Ari — Masia l'Encís"

### Requirement: Selección de idioma de la plantilla por `reserva.idioma`

El sistema SHALL (DEBE) elegir el idioma de la plantilla de transición según
`Reserva.idioma`: si el valor es `'ca'`, renderiza en **catalán**; para **cualquier otro
valor** (incluido `'es'`, otro código o ausencia), renderiza en **castellano**. La
selección se aplica tanto al texto fijo de la plantilla como al formateo de la fecha
(nombres de mes en el idioma correspondiente). (Fuente: US-005; plan aprobado — decisión
de idiomas catalán/castellano.)

#### Scenario: idioma 'ca' renderiza en catalán

- **GIVEN** una RESERVA con `idioma = 'ca'` en una transición de fecha
- **WHEN** el sistema renderiza el borrador E1
- **THEN** el asunto, el cuerpo y el nombre del mes de la fecha están en catalán

#### Scenario: cualquier otro idioma renderiza en castellano

- **GIVEN** una RESERVA con `idioma = 'es'` (o cualquier valor distinto de `'ca'`) en una
  transición de fecha
- **WHEN** el sistema renderiza el borrador E1
- **THEN** el asunto, el cuerpo y el nombre del mes de la fecha están en castellano

### Requirement: Placeholder visible cuando faltan personas u horas

El sistema SHALL (DEBE), cuando `personas` (`num_invitados_final`) u `horas`
(`duracion_horas`) son `null` en la RESERVA (caso posible en una consulta exploratoria
que aún no los tiene), interpolar el **placeholder visible `___`** en el lugar del dato
faltante dentro del cuerpo del borrador, de modo que el gestor lo detecte y lo complete
al revisar el borrador antes de enviarlo (flujo US-046). El resto del texto se renderiza
normalmente. (Fuente: US-005; plan aprobado — decisión de placeholder.)

#### Scenario: personas nulo produce el placeholder ___

- **GIVEN** una transición de fecha de una RESERVA con `num_invitados_final = null` y
  `duracion_horas` conocido
- **WHEN** el sistema renderiza la plantilla "fecha disponible"
- **THEN** el cuerpo contiene `___` en el lugar de `personas` y el valor real de `horas`

#### Scenario: horas nulo produce el placeholder ___

- **GIVEN** una transición de fecha de una RESERVA con `duracion_horas = null` y
  `num_invitados_final` conocido
- **WHEN** el sistema renderiza la plantilla "fecha disponible"
- **THEN** el cuerpo contiene `___` en el lugar de `horas` y el valor real de `personas`

