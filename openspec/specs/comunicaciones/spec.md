# comunicaciones Specification

## Purpose
TBD - created by archiving change us-045-motor-email-automatico. Update Purpose after archive.
## Requirements
### Requirement: Motor de email reutilizable que envía y traza la comunicación

El sistema SHALL (DEBE) proveer un **motor de email** reutilizable que, dado un
trigger del ciclo de vida (E1–E8), ejecute en secuencia: **seleccionar la
plantilla** correspondiente, **sustituir las variables** con datos de `RESERVA` y
`CLIENTE`, **resolver los adjuntos** si la plantilla los declara, **enviar** el
email al destinatario a través del **puerto de dominio de envío**, y **registrar**
el resultado en `COMUNICACION` y en `AUDIT_LOG`. El motor DEBE ser independiente del
trigger concreto (la misma lógica sirve a E1–E8) y NO DEBE importar el proveedor
externo en el dominio (hexagonal). (Fuente: `US-045 §Historia`, `§Impacto`;
`design.md §2`.)

#### Scenario: El motor procesa un trigger y deja la comunicación trazada

- **GIVEN** un trigger de email del ciclo de vida con su `RESERVA` y `CLIENTE`
- **WHEN** el motor procesa el trigger
- **THEN** selecciona la plantilla del código de email, sustituye sus variables y
  envía el email al destinatario a través del puerto de envío
- **AND** crea una entrada en `COMUNICACION` con el `codigo_email`, `reserva_id`,
  `cliente_id` y `tenant_id` correctos
- **AND** registra la operación en `AUDIT_LOG`

### Requirement: Transporte real de email con proveedor y modo sandbox para CI/QA

El sistema SHALL (DEBE) implementar el puerto de envío con un **adaptador de
transporte real** sobre un proveedor externo (Resend), configurado por **entorno**
(clave API, remitente, modo) y validado en el arranque. El adaptador del proveedor
DEBE vivir **solo en infraestructura**. El sistema DEBE ofrecer un **modo
sandbox/fake** que NO realiza envíos reales por red, seleccionable por configuración,
y que se usa de forma forzada en `test`/CI para que las pruebas no envíen correos a
destinatarios reales. (Fuente: `US-045 §Supuestos`; `design.md §1`.)

#### Scenario: En CI/test el motor no envía correos reales

- **GIVEN** el entorno de test o CI con el transporte en modo fake
- **WHEN** el motor procesa un trigger que provocaría un envío
- **THEN** no se realiza ninguna llamada de red al proveedor externo
- **AND** el envío se registra en memoria de modo verificable para las aserciones

#### Scenario: En producción el envío usa el proveedor real configurado

- **GIVEN** un entorno con `EMAIL_TRANSPORT=resend` y la clave de API presente
- **WHEN** el motor despacha un email
- **THEN** el adaptador del proveedor entrega el email desde el remitente
  configurado
- **AND** el dominio no conoce ningún detalle del proveedor (depende solo del puerto)

#### Scenario: Falta de configuración obligatoria corta el arranque

- **GIVEN** un entorno con `EMAIL_TRANSPORT=resend` pero sin clave de API
- **WHEN** la aplicación arranca y valida el entorno
- **THEN** el arranque falla con un mensaje explícito que identifica la variable que
  falta

### Requirement: Catálogo de plantillas por código de email e idioma del tenant

El sistema SHALL (DEBE) seleccionar la plantilla del email por **`codigo_email`** y
por **idioma**, tomando el idioma de **`TENANT_SETTINGS.idioma`** (por defecto
`es`). El catálogo DEBE declarar las entradas E1–E8 con sus variables requeridas y
sus adjuntos; en este change **solo E1 está activa** (con render real), mientras
**E2–E8 quedan declaradas como diseñadas/inactivas** (sin trigger cableado). Si no
existe plantilla en el idioma del tenant, el sistema DEBE usar el idioma por defecto
`es` y dejar constancia en `AUDIT_LOG`. (Fuente: `US-045 §Reglas de negocio` idioma;
`§Notas de alcance`; `design.md §3`.)

#### Scenario: La plantilla se selecciona por código e idioma del tenant

- **GIVEN** un tenant con `TENANT_SETTINGS.idioma = 'es'` y un trigger E1
- **WHEN** el motor selecciona la plantilla
- **THEN** elige la plantilla E1 en `es`
- **AND** sustituye sus variables con datos de `RESERVA` y `CLIENTE`

#### Scenario: E2–E8 están diseñadas pero no se disparan en este change

- **GIVEN** el catálogo de plantillas del motor
- **WHEN** se consulta una entrada E2–E8
- **THEN** existe declarada con sus variables y adjuntos como **diseñada/inactiva**
- **AND** no hay ningún trigger cableado que la dispare en este change

### Requirement: Registro en COMUNICACION con estado y fecha de envío coherentes

El sistema SHALL (DEBE) registrar cada comunicación en `COMUNICACION` con un
**estado** coherente: `enviado` con `fecha_envio` **no nulo** cuando el proveedor
acepta el envío; `borrador` **sin** `fecha_envio` cuando el email queda pendiente de
revisión manual (E1 con comentarios, UC-36); `fallido` **sin** `fecha_envio` cuando
el envío falla. `tenant_id` y `cliente_id` DEBEN ser **no nulos** en toda entrada;
`reserva_id` DEBE ser no nulo para E1–E8. `codigo_email` solo admite el enum
`E1`–`E8` o `manual`. (Fuente: `US-045 §Reglas de Validación`, `§Happy Path`;
`design.md §5`.)

#### Scenario: Un envío aceptado se registra como enviado con fecha

- **GIVEN** un trigger cuyo email se envía correctamente
- **WHEN** el motor registra el resultado
- **THEN** crea `COMUNICACION` con `estado = 'enviado'` y `fecha_envio` no nulo
- **AND** con `tenant_id`, `cliente_id` y `reserva_id` no nulos

#### Scenario: fecha_envio solo se rellena si el estado es enviado

- **GIVEN** una comunicación en `estado = 'borrador'` o `estado = 'fallido'`
- **WHEN** se inspecciona la fila de `COMUNICACION`
- **THEN** `fecha_envio` es nulo

### Requirement: Idempotencia de un email por reserva y código

El sistema SHALL (DEBE) garantizar que cada trigger genera **una sola** entrada en
`COMUNICACION` por `(reserva_id, codigo_email)`. Si el trigger se dispara dos veces
para la misma reserva y código, el sistema DEBE detectar la entrada existente y **no
duplicar** el registro ni el envío. La garantía se DEBE reforzar con un **índice
UNIQUE parcial** en BD sobre `(reserva_id, codigo_email)` aplicable cuando
`reserva_id` no es nulo (los emails `manual` sin reserva quedan excluidos del
constraint). (Fuente: `US-045 §Reglas de Validación` idempotencia; `design.md §4`.)

#### Scenario: Un segundo disparo del mismo trigger no duplica la comunicación

- **GIVEN** una `RESERVA` que ya tiene una `COMUNICACION` con `codigo_email = 'E1'`
- **WHEN** el trigger E1 se vuelve a disparar para esa reserva
- **THEN** el sistema detecta la entrada existente
- **AND** no crea una segunda `COMUNICACION` E1 ni reenvía el email

#### Scenario: Una carrera de doble inserción la frena el índice único

- **GIVEN** dos disparos concurrentes del mismo trigger sobre la misma reserva
- **WHEN** ambos intentan insertar la `COMUNICACION` del mismo código
- **THEN** el índice UNIQUE parcial impide la segunda inserción
- **AND** el sistema trata el conflicto como "ya existe" sin error de usuario

### Requirement: Fallo del proveedor sin reintento automático

El sistema SHALL (DEBE), ante un error del proveedor de email (timeout, bounce
permanente, credenciales inválidas), crear o actualizar la `COMUNICACION` con
`estado = 'fallido'` y **sin** `fecha_envio`, y registrar el error en `AUDIT_LOG`.
El sistema NO DEBE reintentar el envío automáticamente en el MVP. El gestor podrá
reenviar manualmente desde la revisión de borradores (UC-36 / US-046), fuera de este
change. (Fuente: `US-045 §Fallo del proveedor de email`.)

#### Scenario: Error del proveedor deja la comunicación en fallido y auditada

- **GIVEN** un trigger cuyo envío el proveedor rechaza con error
- **WHEN** el motor procesa el resultado
- **THEN** la `COMUNICACION` queda en `estado = 'fallido'` sin `fecha_envio`
- **AND** se registra el error en `AUDIT_LOG`
- **AND** el sistema no reintenta el envío automáticamente

### Requirement: Bloqueo de envío ante variable de plantilla nula

El sistema SHALL (DEBE), cuando un campo requerido por la plantilla está nulo (p.
ej. `CLIENTE.email` nulo), **impedir el envío** del email malformado: NO DEBE crear
una `COMUNICACION` con `estado = 'enviado'` y DEBE registrar el error en `AUDIT_LOG`
con la descripción del campo faltante para que el gestor complete los datos.
(Fuente: `US-045 §Variable de plantilla nula`, `§Reglas de Validación`.)

#### Scenario: Campo requerido nulo impide el envío

- **GIVEN** un trigger cuyo `CLIENTE.email` (u otra variable requerida) es nulo
- **WHEN** el motor intenta sustituir las variables de la plantilla
- **THEN** no envía el email
- **AND** no crea una `COMUNICACION` con `estado = 'enviado'`
- **AND** registra en `AUDIT_LOG` el campo faltante

### Requirement: Interfaz de adjuntos por referencia documental

El sistema SHALL (DEBE) definir en el motor una **interfaz de adjuntos** que permita
adjuntar documentos por **referencia** a su `pdf_url` (de `FACTURA`, `DOCUMENTO` o
`PRESUPUESTO`). El motor DEBE poder incorporar adjuntos al envío y, antes de enviar
un email que los requiera, verificar que el `pdf_url` existe; si no está disponible,
NO DEBE enviar y DEBE registrar el error. La **generación** de esos PDFs y el
cableado de los emails con adjuntos (E2/E3/E4) quedan **diferidos** a sus US.
(Fuente: `US-045 §Reglas de negocio` adjuntos, `§Reglas de Validación` adjuntos;
`design.md §5`.)

#### Scenario: El motor adjunta un documento por su pdf_url

- **GIVEN** una plantilla que declara un adjunto y un documento con `pdf_url`
  disponible
- **WHEN** el motor prepara el envío
- **THEN** incorpora el adjunto referenciado al email

#### Scenario: Adjunto requerido no disponible bloquea el envío

- **GIVEN** una plantilla que requiere un adjunto cuyo `pdf_url` es nulo
- **WHEN** el motor intenta enviar
- **THEN** no envía el email y registra el error

### Requirement: Cableado real de E1 con regresión cero sobre el alta de consulta

El sistema SHALL (DEBE) sustituir el adaptador **STUB no-op** de envío de email
(usado por US-003/US-004) por el **transporte real** sin alterar el contrato del
**puerto de dominio de envío** ni romper el flujo de alta. Al crear una consulta:
si **no** hay comentarios, el sistema DEBE auto-enviar E1 y registrar la
`COMUNICACION` como `enviado`; si **hay** comentarios, DEBE crear la `COMUNICACION`
como `borrador` sin `fecha_envio`, sin enviar. El comportamiento observable de
US-003/US-004 DEBE mantenerse (regresión cero). (Fuente: `US-045 §Happy Path E1`,
`§E1 con notas/comentarios`; `design.md §6`.)

#### Scenario: Alta sin comentarios auto-envía E1 por el transporte real

- **GIVEN** un alta de consulta válida sin comentarios
- **WHEN** el sistema procesa el alta y dispara E1
- **THEN** envía el email vía el transporte real (o fake en test)
- **AND** registra `COMUNICACION` con `codigo_email = 'E1'`, `estado = 'enviado'` y
  `fecha_envio` no nulo

#### Scenario: Alta con comentarios deja E1 en borrador sin enviar

- **GIVEN** un alta de consulta válida con comentarios
- **WHEN** el sistema procesa el alta
- **THEN** crea `COMUNICACION` con `codigo_email = 'E1'`, `estado = 'borrador'` y sin
  `fecha_envio`
- **AND** no envía el email

#### Scenario: El cambio de adaptador no rompe el contrato del puerto

- **GIVEN** los flujos de alta de US-003/US-004 que dependen del puerto de envío
- **WHEN** se sustituye el STUB por el adaptador real
- **THEN** el contrato del puerto de dominio se mantiene
- **AND** los flujos de alta conservan su comportamiento observable

### Requirement: La transición a 2.v dispara el email E6 al cliente y lo registra en COMUNICACION

El sistema SHALL (DEBE), en **toda transición exitosa** de una RESERVA a `sub_estado = '2v'`
(programación de visita), disparar el envío del email **E6** (confirmación de visita
programada con su fecha y hora) al cliente de la RESERVA, reutilizando el motor de email de
US-045. El sistema DEBE registrar el resultado en `COMUNICACION` con `codigo_email = 'E6'`,
`estado = 'enviado'`, `reserva_id` = la RESERVA que transiciona, `cliente_id` = el CLIENTE de
esa RESERVA y el `tenant_id` correspondiente. El registro en `COMUNICACION` se realiza con
independencia de si el bloqueo de `FECHA_BLOQUEADA` fue **creado** (origen `2.a`) o
**actualizado** (origen `2.b`/`2.c`). (Fuente: `US-008 §Happy Path`, `§Reglas de negocio`,
`§Reglas de Validación`; A18; E6 §9.3.)

#### Scenario: Transición a 2.v envía E6 y crea la fila de COMUNICACION

- **GIVEN** una RESERVA que acaba de transicionar correctamente a `sub_estado = '2v'` con su
  `visita_programada_fecha` y `visita_programada_hora`
- **WHEN** el sistema completa la transición
- **THEN** el motor de email envía E6 al cliente con la fecha y la hora de visita confirmadas
- **AND** se crea una fila en `COMUNICACION` con `codigo_email = 'E6'`, `estado = 'enviado'`,
  `reserva_id` = esta RESERVA, `cliente_id` = el CLIENTE de la reserva y el `tenant_id` correcto

#### Scenario: E6 se registra tanto si el bloqueo es nuevo como si se actualiza

- **GIVEN** dos transiciones a `2.v`: una desde `2.a` (crea fila en `FECHA_BLOQUEADA`) y otra
  desde `2.b` (actualiza la fila existente)
- **WHEN** ambas transiciones se completan
- **THEN** en ambos casos se envía E6 y se registra en `COMUNICACION` con `codigo_email = 'E6'`

### Requirement: El envío de E6 es posterior al commit y su fallo no revierte la transición a 2.v

El sistema SHALL (DEBE) disparar el envío de E6 **después** del commit de la transacción que
deja la RESERVA en `2.v` y actualiza/crea `FECHA_BLOQUEADA`, de modo que un fallo del
proveedor de email **NO** revierta el estado de la visita (la transición es válida e
inmutable por el fallo de envío). Un fallo o reintento del envío DEBE quedar **trazado en
`COMUNICACION`** (con un `estado` distinto de `'enviado'`) para su seguimiento/reintento,
coherente con el motor de US-045. En entornos `test`/CI, el transporte de email DEBE operar
en **modo fake** (sin envíos reales por red), de modo que las pruebas verifiquen el disparo de
E6 y su registro en `COMUNICACION` sin enviar correos a destinatarios reales. (Fuente:
`design.md §D-6`; `US-045 §Transporte real / modo sandbox`.)

#### Scenario: Un fallo del proveedor de email no deja la RESERVA fuera de 2.v

- **GIVEN** una transición a `2.v` cuyo commit de estado (RESERVA + `FECHA_BLOQUEADA`) ya ha
  tenido éxito
- **WHEN** el envío posterior de E6 falla en el proveedor
- **THEN** la RESERVA permanece en `sub_estado = '2v'` con su bloqueo correcto (el estado no
  se revierte)
- **AND** el fallo del envío queda trazado en `COMUNICACION` para reintento/seguimiento

#### Scenario: En test/CI E6 no envía correos reales

- **GIVEN** el entorno de test o CI con el transporte de email en modo fake
- **WHEN** una transición a `2.v` dispara E6
- **THEN** no se realiza ninguna llamada de red al proveedor externo
- **AND** el disparo de E6 y el registro en `COMUNICACION` quedan verificables para las
  aserciones de los tests

