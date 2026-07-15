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

### Requirement: La activación de pre_reserva dispara el email E2 con el PDF del presupuesto

El sistema SHALL (DEBE), tras la activación exitosa de la pre-reserva (creación del
PRESUPUESTO + transición de la RESERVA a `pre_reserva`), disparar el envío del email **E2**
al cliente de la RESERVA, adjuntando por referencia el **PDF del presupuesto**
(`PRESUPUESTO.pdf_url`) con el desglose de tarifa (base + IVA 21%), extras, total, reparto
40%/60%/fianza e instrucciones de transferencia, reutilizando el **motor de email de US-045**
y su **interfaz de adjuntos**. El sistema DEBE registrar el resultado en `COMUNICACION` con
`codigo_email = 'E2'`, `estado = 'enviado'`, `reserva_id` = la RESERVA, `cliente_id` = el
CLIENTE de esa RESERVA y el `tenant_id` correspondiente, y registrar la operación en
`AUDIT_LOG`. La idempotencia por `(reserva_id, codigo_email)` del motor de US-045 garantiza
**una sola** E2 por RESERVA. (Fuente: `US-014 §Email relacionado E2`, `§Happy Path`; UC-14;
E2 §9.3; US-045 §Catálogo de plantillas, §Interfaz de adjuntos, §Idempotencia.)

#### Scenario: Confirmar el presupuesto envía E2 y crea la fila de COMUNICACION

- **GIVEN** una activación de `pre_reserva` que acaba de crear el PRESUPUESTO con su
  `pdf_url` disponible
- **WHEN** el sistema completa la operación tras el commit
- **THEN** el motor de email envía E2 al cliente con el PDF del presupuesto adjunto
- **AND** se crea una fila en `COMUNICACION` con `codigo_email = 'E2'`, `estado = 'enviado'`,
  `reserva_id` = esta RESERVA, `cliente_id` = el CLIENTE de la reserva y el `tenant_id`
  correcto

#### Scenario: E2 no se duplica ante un segundo disparo sobre la misma RESERVA

- **GIVEN** una RESERVA que ya tiene una `COMUNICACION` con `codigo_email = 'E2'`
- **WHEN** el trigger E2 se vuelve a disparar para esa RESERVA
- **THEN** el motor detecta la entrada existente y no crea una segunda `COMUNICACION` E2 ni
  reenvía el email (idempotencia por `(reserva_id, codigo_email)` de US-045)

### Requirement: El envío de E2 es posterior al commit y su fallo no revierte la pre_reserva

El sistema SHALL (DEBE) disparar el envío de E2 **después** del commit de la transacción que
crea el PRESUPUESTO, deja la RESERVA en `pre_reserva`, actualiza/crea `FECHA_BLOQUEADA` y
vacía la cola, de modo que un fallo del proveedor de email **NO** revierta la activación de
la pre-reserva (la transición y el bloqueo son válidos e inmutables por el fallo de envío).
Un fallo o reintento del envío DEBE quedar **trazado en `COMUNICACION`** (con un `estado`
distinto de `'enviado'`, p. ej. `'fallido'`) para su seguimiento/reintento, coherente con el
motor de US-045. Si el `PRESUPUESTO.pdf_url` requerido por el adjunto no está disponible, el
motor NO DEBE enviar E2 y DEBE registrar el error (interfaz de adjuntos de US-045). En
entornos `test`/CI el transporte DEBE operar en **modo fake** (sin envíos reales por red).
(Fuente: `US-014 §Email relacionado`; US-045 §Fallo del proveedor, §Interfaz de adjuntos,
§Transporte real / modo sandbox.)

#### Scenario: Un fallo del proveedor de email no saca la RESERVA de pre_reserva

- **GIVEN** una activación de `pre_reserva` cuyo commit (PRESUPUESTO + RESERVA +
  `FECHA_BLOQUEADA` + cola) ya ha tenido éxito
- **WHEN** el envío posterior de E2 falla en el proveedor
- **THEN** la RESERVA permanece en `estado = 'pre_reserva'` con su bloqueo a 7 días (el
  estado no se revierte)
- **AND** el fallo del envío queda trazado en `COMUNICACION` para reintento/seguimiento

#### Scenario: En test/CI E2 no envía correos reales

- **GIVEN** el entorno de test o CI con el transporte de email en modo fake
- **WHEN** una activación de `pre_reserva` dispara E2
- **THEN** no se realiza ninguna llamada de red al proveedor externo
- **AND** el disparo de E2 y su registro en `COMUNICACION` quedan verificables para las
  aserciones de los tests

### Requirement: La transición 2.v → 2.b (cliente interesado) dispara el email E7 y lo registra en COMUNICACION

El sistema SHALL (DEBE), en **toda transición exitosa** de una RESERVA de `2.v` a `2.b` por
resultado "cliente interesado", disparar el envío del email **E7** (confirmación de bloqueo
post-visita, con el plazo de 3 días para decidir) al cliente de la RESERVA, reutilizando el
motor de email de US-045. El sistema DEBE registrar el resultado en `COMUNICACION` con
`codigo_email = 'E7'`, `estado = 'enviado'`, `reserva_id` = la RESERVA que transiciona,
`cliente_id` = el CLIENTE de esa RESERVA y el `tenant_id` correspondiente. La idempotencia
`(reserva_id, codigo_email)` de US-045 garantiza a lo sumo una fila E7 por RESERVA. (Fuente:
`US-009 §Happy Path`, `§Reglas de negocio`, `§Reglas de Validación`; E7.)

#### Scenario: La transición a 2.b envía E7 y crea la fila de COMUNICACION

- **GIVEN** una RESERVA que acaba de transicionar correctamente de `2v` a `2b` por "cliente
  interesado"
- **WHEN** el sistema completa la transición
- **THEN** el motor de email envía E7 al cliente confirmando el bloqueo post-visita (3 días)
- **AND** se crea una fila en `COMUNICACION` con `codigo_email = 'E7'`, `estado = 'enviado'`,
  `reserva_id` = esta RESERVA, `cliente_id` = el CLIENTE de la reserva y el `tenant_id` correcto

### Requirement: El envío de E7 es posterior al commit y su fallo no revierte la transición a 2.b

El sistema SHALL (DEBE) disparar el envío de E7 **después** del commit de la transacción que
deja la RESERVA en `2.b` (`visita_realizada = true`, TTL fresco) y actualiza `FECHA_BLOQUEADA`,
de modo que un fallo del proveedor de email **NO** revierta el estado (la transición es válida
e inmutable por el fallo de envío). Un fallo o reintento del envío DEBE quedar **trazado en
`COMUNICACION`** con `estado = 'fallido'` (distinto de `'enviado'`) para su
seguimiento/reintento, coherente con el motor de US-045. En entornos `test`/CI, el transporte
de email DEBE operar en **modo fake** (sin envíos reales por red), de modo que las pruebas
verifiquen el disparo de E7 y su registro en `COMUNICACION` sin enviar correos a destinatarios
reales. (Fuente: `US-009 §Reglas de Validación`; `design.md §D-4`; `US-045 §Transporte real /
modo sandbox`.)

#### Scenario: Un fallo del proveedor de email no deja la RESERVA fuera de 2.b

- **GIVEN** una transición a `2.b` cuyo commit de estado (RESERVA + `FECHA_BLOQUEADA`) ya ha
  tenido éxito
- **WHEN** el envío posterior de E7 falla en el proveedor
- **THEN** la RESERVA permanece en `sub_estado = '2b'` con `visita_realizada = true` y su TTL
  fresco (el estado no se revierte)
- **AND** el fallo del envío queda trazado en `COMUNICACION` con `estado = 'fallido'` para
  reintento/seguimiento

#### Scenario: En test/CI E7 no envía correos reales

- **GIVEN** el entorno de test o CI con el transporte de email en modo fake
- **WHEN** una transición `2v → 2b` por "cliente interesado" dispara E7
- **THEN** no se realiza ninguna llamada de red al proveedor externo
- **AND** el disparo de E7 y el registro en `COMUNICACION` quedan verificables para las
  aserciones de los tests

### Requirement: Cableado de E4 con los PDFs de liquidación y fianza adjuntos

El sistema SHALL (DEBE), al aprobar y enviar la factura de liquidación (US-028), disparar el
envío del email **E4** al `CLIENTE.email` de la RESERVA, adjuntando **por referencia** el PDF de
la **factura de liquidación** (`FACTURA(liquidacion).pdf_url`) **y** el PDF del **recibo de
fianza** (`FACTURA(fianza).pdf_url`), reutilizando el **motor de email de US-045** y su
**interfaz de adjuntos**. Antes de enviar, el motor DEBE verificar que ambos `pdf_url` requeridos
existen; si algún adjunto requerido no está disponible, NO DEBE enviar E4 (coherente con la
interfaz de adjuntos de US-045). El sistema DEBE registrar el resultado en `COMUNICACION` con
`codigo_email = 'E4'`, `estado = 'enviado'`, `fecha_envio = now()`, `reserva_id` = la RESERVA,
`cliente_id` = el CLIENTE de esa RESERVA y el `tenant_id` correspondiente, y registrar la
operación en `AUDIT_LOG`. Si la fianza ya fue enviada por separado, E4 adjunta **solo** la
factura de liquidación. (Fuente: `US-028 §Happy Path` E4 con ambos PDFs, `§Email relacionado
E4`; US-045 §Catálogo de plantillas E4, §Interfaz de adjuntos.)

#### Scenario: Aprobar y enviar dispara E4 con ambos PDFs y registra la comunicación

- **GIVEN** una emisión de liquidación cuya `FACTURA(liquidacion).pdf_url` y
  `FACTURA(fianza).pdf_url` están disponibles y `CLIENTE.email` no es nulo
- **WHEN** el sistema envía E4
- **THEN** el motor adjunta ambos PDFs (factura de liquidación + recibo de fianza) al email al
  `CLIENTE.email`
- **AND** se crea `COMUNICACION` con `codigo_email = 'E4'`, `estado = 'enviado'`, `fecha_envio`
  no nulo, `reserva_id`, `cliente_id` y `tenant_id` correctos
- **AND** se registra la operación en `AUDIT_LOG`

#### Scenario: Adjunto requerido de E4 no disponible bloquea el envío

- **GIVEN** una emisión de liquidación en la que el `pdf_url` de la factura o del recibo de
  fianza es nulo
- **WHEN** el motor intenta enviar E4
- **THEN** no envía E4 y registra el error (interfaz de adjuntos de US-045)
- **AND** la emisión no se consolida (los estados no cambian; ver delta `facturacion` §atomicidad)

### Requirement: E4 es un envío síncrono y confirmado cuya atomicidad condiciona la emisión

El sistema SHALL (DEBE) disparar E4 de forma **síncrona y esperando la confirmación del
proveedor**, de modo que la consolidación de la emisión de la factura de liquidación (asignación
de `numero_factura`, `estado = 'enviada'`, `liquidacion_status = 'facturada'`, emisión de la
fianza) ocurra **solo si E4 se confirma**. Este disparo **invierte deliberadamente** el patrón
"post-commit, fallo no revierte" de E2/E6/E7 (US-045): en E4, un fallo del proveedor o de la
generación del PDF **impide** consolidar los cambios de estado (rollback), y el resultado del
envío queda **trazado en `COMUNICACION`** para el reintento del Gestor. En entornos `test`/CI el
transporte DEBE operar en **modo fake** (confirmación simulada, sin llamadas de red reales).
(Fuente: `US-028 §Reglas de negocio` atomicidad, `§Fallo en la generación del PDF o en el envío
del email`; `design.md §D-1`; US-045 §Transporte real / modo sandbox.)

#### Scenario: Un fallo de E4 no consolida la emisión y queda trazado

- **GIVEN** una emisión de liquidación en curso cuyo envío de E4 falla en el proveedor
- **WHEN** el motor procesa el resultado
- **THEN** los cambios de estado de la emisión no se consolidan (rollback; ver delta
  `facturacion`)
- **AND** el resultado del envío queda trazado en `COMUNICACION` (con un `estado` distinto de
  `'enviado'`) para el reintento del Gestor

#### Scenario: En test/CI E4 no envía correos reales

- **GIVEN** el entorno de test o CI con el transporte de email en modo fake
- **WHEN** una emisión de liquidación dispara E4
- **THEN** no se realiza ninguna llamada de red al proveedor externo
- **AND** el disparo de E4 y su registro en `COMUNICACION` quedan verificables para las
  aserciones de los tests

### Requirement: Reenvío de E4 crea una nueva comunicación sin alterar la factura

El sistema SHALL (DEBE), cuando el Gestor reenvía una factura de liquidación ya emitida (US-028),
crear un **nuevo** registro `COMUNICACION` con `codigo_email = 'E4'`, `estado = 'enviado'` y
`fecha_envio = now()` por cada reenvío, reutilizando el PDF ya emitido. El reenvío es una
**excepción explícita y auditada** a la idempotencia `(reserva_id, codigo_email)` de US-045: la
idempotencia evita la duplicación por **disparos automáticos** del mismo trigger, pero un reenvío
**manual del Gestor** es una acción intencionada que DEBE quedar trazada como una nueva
comunicación (o, alternativamente, con un contador de reenvíos; la decisión concreta se fija en
el gate). El reenvío NO modifica la FACTURA (ni `numero_factura` ni `estado`) ni los status de la
RESERVA. (Fuente: `US-028 §Factura ya enviada (reenvío)`; `design.md §D-4`; US-045 §Idempotencia.)

#### Scenario: Cada reenvío deja su propia traza de comunicación

- **GIVEN** una FACTURA `tipo = 'liquidacion'` en `estado = 'enviada'` con su `COMUNICACION` E4
  original ya registrada
- **WHEN** el Gestor pulsa "Reenviar factura de liquidación"
- **THEN** se crea una nueva `COMUNICACION` `codigo_email = 'E4'`, `estado = 'enviado'` con su
  `fecha_envio`, reutilizando el PDF ya emitido
- **AND** la FACTURA (número y estado) y los status de la RESERVA no se modifican

### Requirement: Envío del recibo de fianza por separado como email manual sin código E

El sistema SHALL (DEBE), cuando el Gestor envía el recibo de fianza por separado (US-028),
registrar la comunicación como **email manual** con `codigo_email = 'manual'` (NO `E4`), con el
PDF del recibo de fianza adjunto al `CLIENTE.email`. Al ser `manual`, este envío queda **fuera**
del índice UNIQUE parcial de idempotencia `(reserva_id, codigo_email)` que aplica a E1–E8 (los
emails `manual` están excluidos del constraint, US-045), de modo que no colisiona con un
posterior E4 de la misma RESERVA. Los efectos sobre el estado de la fianza y de la RESERVA se
especifican en el delta de la capability `facturacion`. (Fuente: `US-028 §Envío del recibo de
fianza por separado`; `design.md §D-3`; US-045 §Registro en COMUNICACION `codigo_email` enum,
§Idempotencia índice parcial.)

#### Scenario: El envío separado del recibo se registra como manual, no como E4

- **GIVEN** una RESERVA cuyo recibo de fianza el Gestor decide enviar por separado
- **WHEN** el sistema envía el email con solo el recibo de fianza adjunto
- **THEN** se crea `COMUNICACION` con `codigo_email = 'manual'`, `estado = 'enviado'` y
  `fecha_envio` no nulo
- **AND** no usa el código `E4` ni bloquea un posterior E4 de la misma RESERVA por idempotencia

### Requirement: E5 (solicitud de IBAN) se dispara al finalizar el evento solo si fianza_eur > 0

El sistema SHALL (DEBE), al finalizar el evento (transición `evento_en_curso → post_evento`,
US-034), disparar el trigger de email **E5** (agradecimiento + solicitud de IBAN para la
devolución de fianza + enlace NPS) a través del **motor de email** de `comunicaciones` (US-045)
**únicamente cuando `RESERVA.fianza_eur > 0`**. El motor SHALL (DEBE) enviar E5 al
`CLIENTE.email` (nunca al gestor) y crear una `COMUNICACION` con `codigo_email = 'E5'`,
`reserva_id`, `cliente_id` y `tenant_id` correctos. Cuando `RESERVA.fianza_eur = 0`, el sistema
NO DEBE enviar E5 **ni** crear `COMUNICACION` para E5 (no hay IBAN que solicitar); la transición
de estado se ejecuta igualmente. E5 está **condicionado** a `fianza_eur > 0` mientras que la
transición es **incondicional**. (Fuente: `US-034 §Historia`, `§Reglas de negocio`,
`§Email relacionado` E5, `§Finalización sin fianza`, `§Reglas de Validación`; `comunicaciones`
Requirement "Motor de email reutilizable".)

#### Scenario: Finalización con fianza cobrada envía E5 al cliente

- **GIVEN** una RESERVA en `evento_en_curso` con `fianza_eur = 1000.00` y un `CLIENTE.email`
- **WHEN** el gestor finaliza el evento
- **THEN** el motor envía E5 al `CLIENTE.email` (agradecimiento + solicitud de IBAN + enlace NPS)
- **AND** crea `COMUNICACION` con `codigo_email = 'E5'`, `reserva_id`, `cliente_id`, `tenant_id`
  y `estado = enviado` (si el envío tiene éxito)

#### Scenario: Finalización sin fianza (fianza_eur = 0) no envía E5

- **GIVEN** una RESERVA en `evento_en_curso` con `fianza_eur = 0`
- **WHEN** el gestor finaliza el evento
- **THEN** la RESERVA transiciona a `post_evento` igualmente
- **AND** no se envía E5 ni se crea ninguna `COMUNICACION` con `codigo_email = 'E5'`

### Requirement: fianza_eur IS NULL se trata como sin fianza y alerta de dato anómalo

El sistema SHALL (DEBE) tratar `RESERVA.fianza_eur IS NULL` como **"sin fianza"** (equivalente a
`0`) a efectos de E5: NO DEBE enviar E5 ni crear `COMUNICACION` para E5, **aunque**
`RESERVA.fianza_status = 'cobrada'`. Cuando concurren `fianza_status = 'cobrada'` y `fianza_eur
IS NULL` (dato inconsistente de integridad), el sistema DEBE registrar la inconsistencia en
`AUDIT_LOG` como **alerta de dato anómalo**. `fianza_eur IS NULL` NUNCA DEBE provocar un envío
de E5 con IBAN pendiente. (Fuente: `US-034 §fianza_status = cobrada pero fianza_eur IS NULL`,
`§Finalización sin fianza`, `§Reglas de Validación`.)

#### Scenario: fianza_status cobrada pero fianza_eur IS NULL — sin E5 y alerta

- **GIVEN** una RESERVA en `evento_en_curso` con `fianza_status = 'cobrada'` pero `fianza_eur IS
  NULL`
- **WHEN** el gestor finaliza el evento
- **THEN** la RESERVA transiciona a `post_evento`
- **AND** el sistema trata la condición como "sin fianza": no envía E5 ni crea `COMUNICACION`
  para E5
- **AND** registra la inconsistencia en `AUDIT_LOG` como alerta de dato anómalo

### Requirement: La transición no depende del éxito de E5 — fallo deja COMUNICACION fallido y reintento

El sistema SHALL (DEBE) tratar la **transición de estado** y el **envío de E5** como operaciones
**separadas**: si `fianza_eur > 0` y el envío de E5 falla (proveedor de email no disponible), la
transición `evento_en_curso → post_evento` NO DEBE revertirse. En ese caso el sistema DEBE dejar
`COMUNICACION.estado = 'fallido'` (la `COMUNICACION` para E5 se crea **tanto** en envío exitoso
—`estado = enviado`— **como** fallido —`estado = fallido`) y presentar al gestor una alerta ("La
reserva ha pasado a post-evento, pero el email E5 no pudo enviarse. Puedes reenviarlo desde la
ficha."). El gestor SHALL (DEBE) poder **reintentar** el envío de E5 desde la ficha de la
RESERVA. El `AUDIT_LOG` de la transición DEBE reflejar el fallo de E5. (Fuente: `US-034 §Fallo
en el envío de E5`, `§Reglas de negocio`, `§Reglas de Validación`.)

#### Scenario: E5 falla pero la reserva queda en post_evento y se puede reintentar

- **GIVEN** una RESERVA en `evento_en_curso` con `fianza_eur > 0` y el proveedor de email no
  disponible
- **WHEN** el gestor finaliza el evento y el envío de E5 falla
- **THEN** la transición `evento_en_curso → post_evento` se ejecuta igualmente (no se revierte)
- **AND** `COMUNICACION.estado = 'fallido'` para E5
- **AND** el gestor ve una alerta indicando que puede reenviar E5 desde la ficha
- **AND** el `AUDIT_LOG` de la transición refleja el fallo de E5

#### Scenario: El gestor reintenta el envío de E5 desde la ficha

- **GIVEN** una RESERVA en `post_evento` con una `COMUNICACION` E5 en `estado = 'fallido'`
- **WHEN** el gestor reintenta el envío de E5 desde la ficha
- **THEN** el motor de `comunicaciones` reintenta el envío al `CLIENTE.email`
- **AND** actualiza el resultado del reintento en la `COMUNICACION` E5

### Requirement: La NPS queda programada (T+3d) al finalizar el evento

El sistema SHALL (DEBE), al finalizar el evento, dejar la **NPS marcada como programada** para
T+3d, **con independencia** del valor de `fianza_eur` (también cuando `fianza_eur = 0` o `IS
NULL`). "Programada" significa marcada para envío futuro; el **envío real** de la NPS a T+3d
está **fuera de alcance MVP** (📐 recordatorios automáticos extendidos): el sistema NO DEBE
enviar automáticamente la NPS a T+3d en este alcance. (Fuente: `US-034 §Happy Path`,
`§Finalización sin fianza`, `§Supuestos`, `§Notas de alcance`.)

#### Scenario: La NPS se marca como programada aunque no haya fianza

- **GIVEN** una RESERVA en `evento_en_curso` con `fianza_eur = 0` (o `IS NULL`)
- **WHEN** el gestor finaliza el evento
- **THEN** la NPS queda marcada como programada (T+3d)
- **AND** no se realiza ningún envío automático de la NPS en este alcance (fuera de MVP)

### Requirement: El gestor registra el IBAN de devolución sobre CLIENTE con validación mod-97 previa

El sistema SHALL (DEBE) permitir al **gestor** registrar el **IBAN de devolución de fianza** que el
cliente le ha proporcionado, sobre una RESERVA concreta, y persistirlo en **`CLIENTE.iban_devolucion`**
(atributo del `CLIENTE`, **no** de la RESERVA, disponible para futuras reservas del mismo cliente).
La acción SHALL (DEBE) estar disponible **únicamente** cuando `RESERVA.estado = 'post_evento'` **Y**
`RESERVA.fianza_eur > 0`. Antes de **cualquier** escritura, el sistema SHALL (DEBE) validar el IBAN
con el algoritmo de **checksum módulo 97** (longitud según país, prefijo de país, dígitos de control);
si el IBAN no supera la validación, el sistema NO DEBE actualizar `CLIENTE.iban_devolucion` ni enviar
E8, y DEBE devolver un error de validación. Toda actualización de `CLIENTE.iban_devolucion` SHALL
(DEBE) quedar registrada en `AUDIT_LOG` con `accion = 'actualizar'`, `entidad = 'CLIENTE'`,
`datos_anteriores = {iban_devolucion: <previo o null>}` y `datos_nuevos = {iban_devolucion: <nuevo>}`.
La acción se ejecuta bajo el contexto RLS del `tenant` del gestor autenticado (JWT), nunca
cross-tenant. (Fuente: `US-035 §Historia`, `§Reglas de negocio`, `§Reglas de Validación`, `FA-01`;
UC-26/UC-27; `CLAUDE.md §Multi-tenancy`.)

#### Scenario: Registro de un IBAN válido persiste en CLIENTE y audita

- **GIVEN** una RESERVA en `estado = 'post_evento'` con `fianza_eur = 1000.00` y `CLIENTE.iban_devolucion = null`
- **WHEN** el gestor registra el IBAN válido `ES9121000418450200051332`
- **THEN** el sistema valida el IBAN por checksum módulo 97 con éxito
- **AND** actualiza `CLIENTE.iban_devolucion = 'ES9121000418450200051332'`
- **AND** registra en `AUDIT_LOG` `accion = 'actualizar'`, `entidad = 'CLIENTE'`,
  `datos_anteriores = {iban_devolucion: null}`, `datos_nuevos = {iban_devolucion: 'ES9121000418450200051332'}`

#### Scenario: IBAN con formato inválido bloquea la escritura antes de persistir (FA-01)

- **GIVEN** una RESERVA en `estado = 'post_evento'` con `fianza_eur > 0`
- **WHEN** el gestor intenta registrar el valor `ES12345INVALIDO`
- **THEN** la validación de checksum módulo 97 falla y el sistema devuelve un error de validación
  ("El IBAN introducido no tiene un formato válido. Verifica los dígitos de control y la longitud.")
- **AND** `CLIENTE.iban_devolucion` no se actualiza
- **AND** no se envía E8 ni se crea `COMUNICACION` para E8

#### Scenario: Corrección de un IBAN previo lo sobreescribe y audita el valor anterior (FA-02)

- **GIVEN** un `CLIENTE.iban_devolucion = 'ES0000000000000000000001'` (registrado pero erróneo) sobre
  una RESERVA en `post_evento` con `fianza_eur > 0`
- **WHEN** el gestor registra el IBAN corregido `ES9121000418450200051332`
- **THEN** `CLIENTE.iban_devolucion` se sobreescribe con `'ES9121000418450200051332'`
- **AND** registra en `AUDIT_LOG` `datos_anteriores = {iban_devolucion: 'ES0000000000000000000001'}`,
  `datos_nuevos = {iban_devolucion: 'ES9121000418450200051332'}`

### Requirement: El registro de un IBAN válido dispara el email E8 al CLIENTE reutilizando el motor de comunicaciones

El sistema SHALL (DEBE), tras persistir un IBAN válido en `CLIENTE.iban_devolucion`, disparar el
envío del email **E8** (confirmación de recepción del IBAN + descripción de los próximos pasos para la
devolución de la fianza) a través del **motor de email** de `comunicaciones` (US-045), enviándolo al
**`CLIENTE.email`** — **nunca** al gestor. El motor SHALL (DEBE) crear una `COMUNICACION` con
`codigo_email = 'E8'`, `reserva_id` = la RESERVA de la acción, `cliente_id` = el `CLIENTE`,
`tenant_id` correcto y `estado = 'enviado'` con `fecha_envio` no nulo cuando el proveedor acepta el
envío. US-035 **no reimplementa** el motor: lo **invoca** con el trigger E8; `E8` pertenece al
catálogo E1–E8 declarado por US-045. (Fuente: `US-035 §Reglas de negocio`, `§Email relacionado` E8,
`§Happy Path`, `§Reglas de Validación`; `comunicaciones` Requirement "Motor de email reutilizable".)

#### Scenario: Guardar un IBAN válido envía E8 al cliente y crea la fila de COMUNICACION

- **GIVEN** una RESERVA en `post_evento` con `fianza_eur = 1000.00` y un `CLIENTE.email` no nulo
- **WHEN** el gestor registra el IBAN válido `ES9121000418450200051332` y el proveedor acepta el envío
- **THEN** el motor envía E8 al `CLIENTE.email` con la confirmación de recepción y los próximos pasos
- **AND** crea `COMUNICACION` con `codigo_email = 'E8'`, `estado = 'enviado'`, `fecha_envio` no nulo,
  `reserva_id`, `cliente_id` y `tenant_id` correctos

#### Scenario: E8 se envía al cliente, nunca al gestor

- **GIVEN** un registro de IBAN válido realizado por el gestor autenticado
- **WHEN** el motor despacha E8
- **THEN** el destinatario del email es `CLIENTE.email`
- **AND** el email E8 no se envía en ningún caso a la dirección del gestor

### Requirement: El guardado del IBAN y el envío de E8 son operaciones separadas — un fallo de E8 no revierte el IBAN

El sistema SHALL (DEBE) tratar el **guardado de `CLIENTE.iban_devolucion`** y el **envío de E8** como
operaciones **separadas** (patrón "guardar-luego-enviar"): si el IBAN es válido pero el proveedor de
email no está disponible al enviar E8, el IBAN SHALL (DEBE) quedar **guardado igualmente** (el fallo
de email **NO** revierte la actualización del IBAN), la `COMUNICACION` SHALL (DEBE) quedar en
`estado = 'fallido'` sin `fecha_envio`, y el sistema DEBE presentar al gestor una alerta ("⚠️ IBAN
guardado, pero E8 no pudo enviarse. Puedes reenviarlo desde la ficha."). El gestor SHALL (DEBE) poder
**reintentar** el envío de E8 desde la ficha de la RESERVA, apoyándose en el mecanismo de reintento
del motor de `comunicaciones`. En entornos `test`/CI el transporte de email DEBE operar en **modo
fake** (sin envíos reales por red). (Fuente: `US-035 §Reglas de negocio`, `FA-03`; `US-045
§Transporte real / modo sandbox`, `§Fallo del proveedor sin reintento automático`.)

#### Scenario: Fallo de E8 deja el IBAN guardado y la comunicación en fallido (FA-03)

- **GIVEN** una RESERVA en `post_evento` con `fianza_eur > 0` y el proveedor de email no disponible
- **WHEN** el gestor registra un IBAN válido y el envío posterior de E8 falla
- **THEN** `CLIENTE.iban_devolucion` queda guardado con el nuevo IBAN (no se revierte)
- **AND** `COMUNICACION.estado = 'fallido'` sin `fecha_envio` para E8
- **AND** el gestor ve la alerta indicando que puede reenviar E8 desde la ficha

#### Scenario: En test/CI E8 no envía correos reales

- **GIVEN** el entorno de test o CI con el transporte de email en modo fake
- **WHEN** un registro de IBAN válido dispara E8
- **THEN** no se realiza ninguna llamada de red al proveedor externo
- **AND** el disparo de E8 y su registro en `COMUNICACION` quedan verificables para las aserciones

### Requirement: El registro de IBAN se rechaza sin fianza cobrada o fuera de post_evento

El sistema SHALL (DEBE) **rechazar** el registro de IBAN cuando `RESERVA.fianza_eur = 0` **o
`fianza_eur IS NULL`** (no hay fianza que devolver) o cuando `RESERVA.estado ≠ 'post_evento'`. El
backend NO DEBE confiar en que la UI oculte el campo: DEBE **validar la precondición** en el servidor
y devolver un error de conflicto de estado / sin fianza cuando no se cumple, **sin** actualizar
`CLIENTE.iban_devolucion` ni enviar E8. La UI DEBE, de forma complementaria, condicionar la
**visibilidad/habilitación** del campo IBAN a `RESERVA.fianza_eur > 0`. (Fuente: `US-035 §Reglas de
negocio`, `FA-04`, `§Reglas de Validación`.)

#### Scenario: Sin fianza (fianza_eur = 0) el backend rechaza el registro (FA-04)

- **GIVEN** una RESERVA en `estado = 'post_evento'` con `fianza_eur = 0` (o `IS NULL`)
- **WHEN** se intenta registrar un IBAN sobre esa RESERVA
- **THEN** el sistema rechaza la acción (no hay fianza que devolver)
- **AND** `CLIENTE.iban_devolucion` no se actualiza y no se envía E8

#### Scenario: La UI oculta o deshabilita el campo IBAN cuando no hay fianza

- **GIVEN** una RESERVA en `post_evento` con `fianza_eur = 0` (o `IS NULL`)
- **WHEN** el gestor accede a la ficha de post-evento
- **THEN** el campo IBAN no es visible o está deshabilitado

#### Scenario: Registro fuera de post_evento se rechaza como conflicto de estado

- **GIVEN** una RESERVA cuyo `estado ≠ 'post_evento'` (p. ej. `reserva_confirmada`)
- **WHEN** se intenta registrar un IBAN sobre esa RESERVA
- **THEN** el sistema rechaza la acción como conflicto de estado
- **AND** `CLIENTE.iban_devolucion` no se actualiza y no se envía E8

### Requirement: Cada corrección del IBAN reenvía E8 como excepción auditada a la idempotencia

El sistema SHALL (DEBE) disparar E8 en **cada** registro/corrección de un IBAN válido. El reenvío de
E8 tras una corrección del IBAN (FA-02) es una **acción intencionada del gestor** y por tanto una
**excepción explícita y auditada** a la idempotencia `(reserva_id, codigo_email)` del motor de US-045
(que evita duplicados por **disparos automáticos** del mismo trigger, no por reenvíos manuales): el
sistema DEBE crear una **nueva** `COMUNICACION` con `codigo_email = 'E8'`, `estado = 'enviado'` y
`fecha_envio` por cada envío. El reenvío en corrección NO DEBE bloquearse por la idempotencia.
(Fuente: `US-035 §Reglas de negocio` sobreescritura + reenvío, `FA-02`; `comunicaciones` Requirement
"Reenvío de E4 crea una nueva comunicación", "Idempotencia de un email por reserva y código".)

#### Scenario: Corregir el IBAN reenvía E8 con el valor actualizado como referencia (FA-02)

- **GIVEN** una RESERVA en `post_evento` con `fianza_eur > 0` y una `COMUNICACION` E8 previa por un
  IBAN erróneo ya registrado
- **WHEN** el gestor corrige el IBAN a `ES9121000418450200051332` y guarda
- **THEN** `CLIENTE.iban_devolucion` se sobreescribe con el IBAN corregido
- **AND** se crea una nueva `COMUNICACION` `codigo_email = 'E8'`, `estado = 'enviado'` enviada al
  cliente con el IBAN actualizado como referencia
- **AND** el reenvío no queda bloqueado por la idempotencia `(reserva_id, codigo_email)` de US-045

### Requirement: Activación de la plantilla E3 en el catálogo

El sistema SHALL (DEBE) marcar la plantilla **E3 como ACTIVA** en el catálogo de plantillas
(hoy E2–E8 están declaradas pero inactivas, US-045), con un render real en `es` (asunto y
cuerpo con los próximos hitos del proceso de confirmación) y su contrato de variables y
adjuntos: `adjuntosRequeridos` declara la **factura de señal como requerida** y las
**condicions particulars como opcionales** (coherente con el delta `documentos`). La
activación deja el catálogo consistente; el envío atómico de esta acción manual usa el
puerto directo (ver requisito siguiente). (Fuente: US-045 §Catálogo (E3→US-021/022/023);
`design.md §D-ruta-email`.)

#### Scenario: E3 deja de estar inactiva y expone su render real

- **GIVEN** el catálogo de plantillas con E3 previamente inactiva (`renderInactivo`)
- **WHEN** se selecciona la plantilla E3 en idioma `es`
- **THEN** la plantilla está `activa = true` y devuelve un asunto y cuerpo reales (no el
  placeholder de plantilla inactiva)
- **AND** declara la factura de señal como adjunto requerido y las condiciones como opcional

### Requirement: Cableado de E3 síncrono y confirmado por el puerto de envío directo

El sistema SHALL (DEBE), al enviar la factura de señal (delta `facturacion`), disparar el
envío del email **E3** al `CLIENTE.email` de la RESERVA por el **puerto de envío directo**
(`EnviarEmailPort`, `codigo_email = 'E3'`), adjuntando **por referencia** el PDF de la
**factura de señal** (`FACTURA(senal).pdf_url`) y, si está disponible, el PDF de las
**condicions particulars**. El disparo es **síncrono y esperando la confirmación del
proveedor**, de modo que si el proveedor **falla, el fallo PROPAGA** para que la emisión de
la factura (delta `facturacion`) **revierta** (atomicidad). Este cableado **NO** usa el
motor `DespacharEmailService`, que por diseño traza el fallo en `COMUNICACION` sin
propagar y sería incompatible con el rollback exigido. El sistema DEBE registrar el
resultado en `COMUNICACION` con `codigo_email = 'E3'`, `estado = 'enviado'`, `fecha_envio =
now()`, `reserva_id`, `cliente_id` y `tenant_id` correctos, y en `AUDIT_LOG`. En entornos
`test`/CI el transporte DEBE operar en **modo fake** (confirmación simulada, sin red).
(Fuente: `US-023 §Happy Path`, `§Fallo en el envío del email E3`; US-028 patrón E4;
US-045 §Transporte real / modo sandbox; `design.md §D-ruta-email`.)

#### Scenario: Enviar factura de señal dispara E3 con ambos adjuntos y registra la comunicación

- **GIVEN** una emisión de señal cuya `FACTURA(senal).pdf_url` está disponible y
  `CLIENTE.email` no es nulo, con las condicions particulars generables
- **WHEN** el sistema envía E3
- **THEN** el envío adjunta la factura de señal + las condicions particulars al `CLIENTE.email`
- **AND** se crea `COMUNICACION` con `codigo_email = 'E3'`, `estado = 'enviado'`,
  `fecha_envio` no nulo, `reserva_id`, `cliente_id` y `tenant_id` correctos
- **AND** se registra la operación en `AUDIT_LOG`

#### Scenario: Un fallo del proveedor en E3 propaga y no consolida la emisión

- **GIVEN** una emisión de señal en curso cuyo envío de E3 falla en el proveedor
- **WHEN** el puerto de envío directo procesa el fallo
- **THEN** el fallo propaga y la emisión de la factura de señal no se consolida (rollback;
  ver delta `facturacion`)
- **AND** no queda una `COMUNICACION` E3 en `estado = 'enviado'`

#### Scenario: En test/CI E3 no envía correos reales

- **GIVEN** el entorno de test o CI con el transporte de email en modo fake
- **WHEN** una emisión de señal dispara E3
- **THEN** no se realiza ninguna llamada de red al proveedor externo
- **AND** el disparo de E3 y su registro en `COMUNICACION` quedan verificables para las
  aserciones de los tests

### Requirement: Idempotencia del disparo de E3 (no re-enviar si ya se envió)

El sistema SHALL (DEBE), antes de enviar E3, comprobar si ya existe una `COMUNICACION` con
`reserva_id` de la RESERVA y `codigo_email = 'E3'` en `estado = 'enviado'`. Si existe, NO
DEBE re-enviar el email ni crear una segunda `COMUNICACION` E3 `enviado`; la acción se
rechaza (ver delta `facturacion`, `E3_YA_ENVIADO`). Una `COMUNICACION` E3 previa en
`estado = 'fallido'` NO bloquea el reintento. El **reenvío explícito** de E3 (nueva
`COMUNICACION` sin re-emitir, análogo al reenvío de US-028) queda **fuera del alcance de
esta rebanada**. (Fuente: `US-023 §E3 ya enviado previamente`, `§Reglas de Validación`;
`design.md §D-idempotencia`.)

#### Scenario: E3 ya enviado no se vuelve a disparar

- **GIVEN** una RESERVA con una `COMUNICACION` `codigo_email = 'E3'` en `estado = 'enviado'`
- **WHEN** el Gestor vuelve a lanzar "Enviar factura de señal"
- **THEN** no se dispara un nuevo E3 ni se crea una segunda `COMUNICACION` E3 `enviado`
- **AND** la acción se rechaza (ver delta `facturacion`)

