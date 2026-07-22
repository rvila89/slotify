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

### Requirement: Catálogo de plantillas por código de email e idioma

El sistema SHALL (DEBE) seleccionar la plantilla del email por **`codigo_email`** y
por **idioma**. Para **E1**, el idioma se resuelve desde **`RESERVA.idioma`**
(campo por lead, por defecto `'es'`), permitiendo comunicar con cada cliente en su
propio idioma independientemente del idioma del tenant. Para **E2**, el idioma
también se resuelve desde **`RESERVA.idioma`** (el disparo propaga `idioma:
reserva.idioma` al motor; ver el requisito "La activación de pre_reserva dispara el
email E2 con el PDF del presupuesto"), de modo que el cliente recibe el presupuesto
en su propio idioma. Para el resto de emails (E3–E8), el idioma se toma de
**`TENANT_SETTINGS.idioma`** (por defecto `'es'`). El catálogo DEBE declarar las
entradas E1–E8 con sus variables requeridas y sus adjuntos; **E1, E2 y E3 están
activas** (con render real); **E4–E8 quedan declaradas como diseñadas/inactivas**
(sin trigger cableado). **E1 y E2 soportan los idiomas `'es'` y `'ca'`**; E3 solo
`'es'` por ahora. La plantilla **E2 en `ca`** (`PLANTILLA_E2_CA`, `idioma: 'ca'`,
`activa: true`, `variablesRequeridas: ['nombre', 'codigoReserva']`,
`adjuntosRequeridos: ['presupuesto']`) SE REGISTRA en el registro de idioma `ca`
junto a E1. El **contenido de E2** (asunto y cuerpo) es el texto de marca definitivo
del tenant (Masia l'Encís), en dos variantes:

- **Asunto** — ES: «Tu presupuesto para el evento (reserva {codigo})»; CA: «El teu
  pressupost per a l'esdeveniment (reserva {codigo})». El `{codigo}` es
  `codigoReserva`; si es vacío, la referencia entre paréntesis se omite.
- **Cuerpo** — `{nombre}` es el **nombre de pila** del cliente; el cuerpo explica el
  pago anticipado del 40%, el recálculo una semana antes con el listado final de
  asistentes, las instrucciones de transferencia (destinatario "Canoliart, SL",
  concepto "Masia l'Encís"), las condicions particulars a devolver firmadas, y cierra
  con la firma «Ari — Masia l'Encís». (Texto literal ES/CA acordado con el usuario,
  ver §Textos del E2 al final del delta.)

Si no existe plantilla en el idioma solicitado, el sistema DEBE usar el idioma por
defecto `'es'` y dejar constancia en `AUDIT_LOG`. (Fuente: `US-045 §Reglas de negocio`
idioma; `§Notas de alcance`; workstreams D/E del change; `catalogo-plantillas.ts`
`registroEs`/`registroCa`/`seleccionar`; decisión de producto sobre el E2 catalán.)

#### Scenario: E1 se selecciona por el idioma del lead (RESERVA.idioma)

- **GIVEN** una RESERVA con `idioma = 'ca'` y un trigger E1
- **WHEN** el motor selecciona la plantilla
- **THEN** elige la plantilla E1 en `'ca'`
- **AND** sustituye sus variables con datos de `RESERVA` y `CLIENTE`

#### Scenario: E2 se selecciona por el idioma del lead (RESERVA.idioma)

- **GIVEN** una RESERVA con `idioma = 'ca'` y un trigger E2 (activación de pre_reserva)
- **WHEN** el motor selecciona la plantilla
- **THEN** elige la plantilla `PLANTILLA_E2_CA` (`idioma = 'ca'`, activa) del registro
  catalán, con asunto «El teu pressupost per a l'esdeveniment (reserva {codigo})»
- **AND** sustituye `{nombre}` y `{codigoReserva}` con datos de `RESERVA` y `CLIENTE`

#### Scenario: E2 en español usa el texto de marca definitivo

- **GIVEN** una RESERVA con `idioma = 'es'` y un trigger E2
- **WHEN** el motor renderiza la plantilla E2 en `'es'`
- **THEN** el asunto es «Tu presupuesto para el evento (reserva {codigo})»
- **AND** el cuerpo incluye el pago anticipado del 40%, el recálculo del listado final
  una semana antes, las instrucciones de transferencia (destinatario "Canoliart, SL",
  concepto "Masia l'Encís") y la firma «Ari — Masia l'Encís» (no el cuerpo genérico
  anterior)

#### Scenario: La plantilla se selecciona por código e idioma del tenant para E3–E8

- **GIVEN** un tenant con `TENANT_SETTINGS.idioma = 'es'` y un trigger E3–E8
- **WHEN** el motor selecciona la plantilla
- **THEN** elige la plantilla correspondiente en `'es'`
- **AND** sustituye sus variables con datos de `RESERVA` y `CLIENTE`

#### Scenario: E4–E8 están diseñadas pero no se disparan aún

- **GIVEN** el catálogo de plantillas del motor
- **WHEN** se consulta una entrada E4–E8
- **THEN** existe declarada con sus variables y adjuntos como **diseñada/inactiva**
- **AND** no hay ningún trigger cableado que la dispare en este alcance

#### Scenario: E2 en un idioma sin variante cae al español por defecto y lo audita

- **GIVEN** una RESERVA con un `idioma` para el que NO existe variante E2 (ni `es` ni `ca`)
- **WHEN** el motor intenta seleccionar la plantilla E2 en ese idioma
- **THEN** usa la variante por defecto `'es'` (`PLANTILLA_E2_ES`)
- **AND** deja constancia del fallback de idioma en `AUDIT_LOG`

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

El sistema SHALL (DEBE) crear una `COMUNICACION` propia por cada **evento** de ciclo de vida que genera un email, etiquetándola con su `subtipo`. Un mismo `codigo_email = 'E1'` cubre emails **semánticamente distintos** según el evento que lo dispara (respuesta a una **consulta exploratoria** sin fecha, asignación de una **fecha disponible**, **confirmación** de fecha, entrada en **cola de espera**, **cambio de fecha**). Por ello el sistema DEBE **persistir un `subtipo` explícito** en `COMUNICACION` (enum nullable `SubtipoEmail`; `NULL` para E2–E8, `manual` y filas legadas) con los valores:
`consulta_exploratoria`, `fecha_disponible`, `fecha_confirmada`, `cola_espera`,
`cambio_fecha`. El sistema **NO DEBE** sobrescribir la fila anterior de ese código
(fin del upsert `findFirst` + `update`); DEBE **INSERTAR** una fila nueva por evento,
conservando el **historial completo**: es válido y esperado que una misma RESERVA
tenga **varias** filas E1 `borrador` de subtipos distintos, cada una con su propio
`subtipo`, `asunto` y `fecha_creacion`.

El anti-duplicado se **clava sobre la terna `(reserva_id, codigo_email, subtipo)`**:
dos filas con **distinto** `subtipo` pueden **ambas** llegar a `estado = 'enviado'`
porque son emails legítimos y distintos (NO son reenvíos). Solo un **segundo envío**
del **mismo** `(reserva_id, codigo_email, subtipo)` constituye una repetición, y ese
SÍ es un **reenvío genuino** que se marca `es_reenvio = true` (consistente con el
patrón de reenvío E3/E4/E8), quedando fuera del constraint. El sistema **NO DEBE
auto-enviar** una terna `(reserva_id, codigo_email, subtipo)` que **ya tiene** una
fila en `estado = 'enviado'`: la trata como **idempotente** sin crear otra fila
enviada ni reenviar. Los E1 de transición y de cambio de fecha son siempre `borrador`
y **NO se auto-envían** (los revisa y envía el gestor, US-046).

La garantía se DEBE reforzar con el **índice UNIQUE parcial** en BD sobre la terna,
con predicado restringido a envíos consumados:
`(reserva_id, codigo_email, subtipo) WHERE reserva_id IS NOT NULL AND es_reenvio =
false AND codigo_email <> 'manual' AND estado = 'enviado'`. Actúa como **backstop** de
la carrera de doble envío idéntico (dos `enviado` concurrentes de la misma terna
colisionan con `P2002`), mientras que varios `borrador` (de cualquier subtipo) y
subtipos distintos en `enviado` **no** colisionan. Los **reenvíos**
(`es_reenvio = true`, E3/E4/E8) y los emails **`manual`** siguen **fuera** del
constraint por su predicado. (Fuente: `US-045 §Reglas de Validación` idempotencia;
`US-046` revisión de borradores; requirement vivo *"Listado de las comunicaciones de
una RESERVA…"*; `design.md §D-subtipo`, `§D-indice-terna`, `§D-manual-2o-borrador`,
`§D-regenera-en-sitio`.)

#### Scenario: Un segundo auto-envío de la misma terna no crea otra fila enviada

- **GIVEN** una `RESERVA` que ya tiene una `COMUNICACION` con `codigo_email = 'E1'`,
  `subtipo = 'fecha_disponible'` y `estado = 'enviado'`
- **WHEN** el motor de auto-envío se vuelve a disparar para esa misma terna
- **THEN** el sistema detecta la fila `enviado` existente
- **AND** trata la operación como idempotente: no crea una segunda `COMUNICACION` de
  esa terna en `enviado` ni reenvía el email

#### Scenario: Dos subtipos distintos pueden ambos estar enviados sin colisión

- **GIVEN** una `RESERVA` con una `COMUNICACION` E1 `subtipo = 'consulta_exploratoria'`
  ya `enviado`
- **WHEN** más tarde se envía otra `COMUNICACION` E1 `subtipo = 'cambio_fecha'`
- **THEN** ambas filas coexisten en `estado = 'enviado'` sin colisión del índice
- **AND** ninguna se marca `es_reenvio` (son emails semánticamente distintos, no
  reenvíos)

#### Scenario: Una carrera de doble envío idéntico la frena el índice sobre la terna

- **GIVEN** dos disparos concurrentes del envío de la **misma** terna
  `(reserva, codigo, subtipo)`
- **WHEN** ambos intentan insertar/actualizar la `COMUNICACION` a `estado = 'enviado'`
- **THEN** el índice UNIQUE parcial (terna, predicado `estado = 'enviado'`) impide la
  segunda con `P2002`
- **AND** el sistema trata el conflicto como "ya enviado" sin error de usuario

#### Scenario: Alta exploratoria + añadir fecha + cambiar fecha deja tres E1 con subtipos distintos

- **GIVEN** una consulta que se da de **alta** exploratoria (sin fecha), luego se le
  **añade** una fecha disponible y después se **cambia** la fecha, generando en cada
  evento un email E1 en `borrador`
- **WHEN** se inspecciona `COMUNICACION` para esa RESERVA
- **THEN** existen **tres** filas E1 en `estado = 'borrador'` con `subtipo`
  `consulta_exploratoria`, `fecha_disponible` y `cambio_fecha` respectivamente, cada
  una con su propio `asunto` y `fecha_creacion`, sin que ninguna sobrescriba a otra
- **AND** el índice UNIQUE parcial (predicado `estado = 'enviado'`) no las bloquea por
  seguir en `borrador`

#### Scenario: Reeditar los datos de la consulta sin cambio de estado no añade fila al historial

- **GIVEN** una RESERVA con un borrador E1 pendiente de un `subtipo` dado y el gestor
  edita **datos** de la consulta (p. ej. nº de personas) **sin** cambio de estado
- **WHEN** el sistema re-renderiza el contenido del borrador
- **THEN** **ACTUALIZA en sitio** el borrador pendiente (mismo `subtipo`, mismo evento,
  contenido corregido)
- **AND** **NO** inserta una fila nueva en el historial (no es un evento de ciclo de
  vida)

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

### Requirement: Cableado real de E1 personalizado por idioma, situación de fecha y dossier adjunto

El sistema SHALL (DEBE) enviar E1 al crear una consulta usando el **catálogo de
plantillas** con la variante correcta según el idioma del lead (`RESERVA.idioma`) y
la situación de la fecha (`tipoE1`), y adjuntando siempre el **dossier PDF** del
espacio en el idioma del lead. Las 4 variantes de `tipoE1` son:

- `sin_fecha` — alta sin `fecha_evento` (sub-estado `2a`)
- `fecha_disponible` — fecha libre (sub-estado `2b`)
- `fecha_cola` — fecha en cola de consulta (sub-estado `2d`)
- `fecha_confirmada` — fecha ocupada por reserva confirmada (sub-estado `2a`
  degradada); el sistema DEBE intentar obtener fechas adyacentes libres (±1 día,
  solo fin de semana) para incluirlas en el cuerpo

El dossier se adjunta por referencia de URL (`Dossier-Masia-Encis-{idioma}.pdf`)
desde el almacén del tenant. El envío del dossier es obligatorio; si el fichero
no está disponible en el almacén, Resend falla la descarga y la COMUNICACION queda
en `estado = 'fallido'`.

Si el catálogo no puede renderizar la plantilla (idioma no soportado o error de
configuración), el sistema NO DEBE bloquear el alta: degrada a asunto/cuerpo mínimo
y envía igualmente — el motor centraliza el resultado (`enviado` o `fallido`). En
producción el catálogo siempre está inyectado y el camino real usa el render
personalizado.

Si el alta **incluye** `comentarios`, el sistema DEBE crear la COMUNICACION con
`estado = 'borrador'`, sin enviar, y DEBE **rellenarla con el `asunto` y el `cuerpo`
renderizados** por el catálogo con **paridad exacta al E1 automático**: la misma
variante `tipoE1` (según el sub-estado resultante del alta, incluyendo las fechas
alternativas en `fecha_confirmada`) y el mismo idioma (`RESERVA.idioma`, en su ausencia
`'es'`). El `asunto` renderizado reemplaza al placeholder y el `cuerpo` deja de estar
vacío, de modo que el gestor parte del E1 ya redactado, lo edita si quiere y lo envía por
la revisión de borradores (UC-36 / US-046), que adjunta el dossier según el idioma. El
borrador permanece en `estado = 'borrador'` **sin** `fecha_envio` mientras no se envíe. Si
el catálogo no está disponible, el borrador se rellena con el asunto/cuerpo mínimo de
fallback (nunca peor que hoy). El relleno del borrador es un efecto **post-commit
best-effort**: si falla, el alta responde `201` igualmente y el borrador queda editable.
(Fuente: fix sobre `US-045 §Happy Path E1`, `§E1 con notas/comentarios`; `US-047`;
`design.md §6`; decisión de producto post-US-003/004.)

#### Scenario: Alta sin comentarios auto-envía E1 personalizado con dossier

- **GIVEN** un alta de consulta válida sin comentarios, con `idioma = 'ca'`
- **WHEN** el sistema procesa el alta y dispara E1
- **THEN** envía el email con la variante correcta en catalán vía el transporte real
- **AND** adjunta `Dossier-Masia-Encis-ca.pdf` al email
- **AND** registra `COMUNICACION` con `codigo_email = 'E1'`, `estado = 'enviado'` y
  `fecha_envio` no nulo

#### Scenario: Alta con comentarios deja E1 en borrador ya redactado sin enviar

- **GIVEN** un alta de consulta válida con comentarios, con `idioma = 'ca'` y una situación
  de fecha que resuelve una variante `tipoE1` (p. ej. `sin_fecha`)
- **WHEN** el sistema procesa el alta
- **THEN** crea `COMUNICACION` con `codigo_email = 'E1'`, `estado = 'borrador'` y sin
  `fecha_envio`
- **AND** no envía el email
- **AND** la `COMUNICACION` tiene el `asunto` y el `cuerpo` renderizados por el catálogo en
  catalán y en la variante `tipoE1` correspondiente (no vacíos), idénticos a los que enviaría
  el auto-envío para el mismo alta

#### Scenario: El cuerpo del borrador con comentarios coincide con el del auto-envío

- **GIVEN** dos altas equivalentes (mismos datos, idioma y situación de fecha), una con
  comentarios y otra sin comentarios
- **WHEN** el sistema procesa ambas
- **THEN** el `cuerpo` persistido en el borrador de la primera coincide con el `cuerpo`
  enviado en el auto-envío de la segunda

#### Scenario: Catálogo no disponible envía E1 con texto mínimo sin bloquear el alta

- **GIVEN** un alta sin comentarios en un contexto donde el catálogo no puede renderizar
- **WHEN** el sistema procesa el alta
- **THEN** la RESERVA se crea correctamente
- **AND** la COMUNICACION E1 se envía con asunto/cuerpo mínimo de fallback
- **AND** el alta devuelve 201 sin error

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

El sistema SHALL (DEBE), tras la activación exitosa de la pre-reserva (creación del PRESUPUESTO
+ transición de la RESERVA a `pre_reserva`), disparar el envío del email **E2** al cliente de la
RESERVA reutilizando el **motor de email de US-045** y su **interfaz de adjuntos**, con la
plantilla E2 **ACTIVA** (`activa: true`, render real `renderE2` con
`variablesRequeridas: ['nombre', 'codigoReserva']`; el código `'E2'` deja de estar entre los
`CODIGOS_DIFERIDOS`). El disparo (`DispararE2Adapter`) DEBE **propagar el idioma de la RESERVA**
(`idioma: RESERVA.idioma`) en el comando del motor (`DespacharEmailService.despachar`), de modo
que la selección de plantilla use el idioma del lead —igual que E1— y NO el `TENANT_SETTINGS`;
el motor conserva su resolución `comando.idioma ?? TENANT_SETTINGS.idioma ?? 'es'` y su fallback
a `'es'` cuando no hay plantilla en el idioma pedido. El adjunto del **PDF del presupuesto**
(`PRESUPUESTO.pdf_url`) es **REQUERIDO** (`adjuntosRequeridos: ['presupuesto']`, como E3 con
`'senal'`): si el PDF falta, el envío de E2 se **BLOQUEA** (no se envía un E2 sin el
presupuesto). En consecuencia, el sistema DEBE **garantizar que el PDF existe y es alcanzable
por el proveedor de email en el momento del disparo de E2**: (a) el PDF se **genera y persiste
ANTES / EN el disparo de E2** (el post-commit de `generar-presupuesto.use-case.ts` produce el
`pdf_url` y NO dispara E2 con `pdf_url = null` de forma silenciosa); y (b) si el adjunto es un
**path local** (dev sin S3) se envía como `content` **Buffer** (`resend.email.adapter.ts` ya lo
soporta: el SDK de Resend no lee paths locales), y si es una **URL** debe ser **alcanzable por
Resend**. El adjunto de **condicions particulars** lo añade el adapter de forma **best-effort**
usando el **idioma de la RESERVA** (`RESERVA.idioma`, normalizado a `'es' | 'ca'`): si la
generación falla o devuelve `null` post-commit, el adjunto se omite sin romper el E2 (la guarda
pre-tx en `GenerarPresupuestoUseCase.confirmar()` garantiza que la config existe, por lo que un
`null` post-commit es un fallo transitorio de render/subida). El sistema
DEBE registrar el resultado en `COMUNICACION` con `codigo_email = 'E2'`, `reserva_id` = la
RESERVA, `cliente_id` = el CLIENTE de esa RESERVA y el `tenant_id` correspondiente, y registrar
la operación en `AUDIT_LOG`. La idempotencia por `(reserva_id, codigo_email)` del motor de
US-045 garantiza **una sola** E2 por RESERVA y **permite reintentar** el E2 una vez el PDF esté
disponible. La causa raíz del `estado = 'fallido'` observado con adjunto (tratamiento de
adjuntos por URL/path local en `resend.email.adapter.ts`) se **diagnostica de forma
sistemática** y se corrige de modo que el adjunto **se envíe de verdad** (path local ⇒ Buffer;
URL ⇒ alcanzable) — la corrección es **ruta crítica**, NO un fallback que omita el adjunto.
(Fuente: workstream D del change; `US-014 §Email relacionado E2`, `§Happy Path`; UC-14; E2 §9.3;
US-045 §Catálogo de plantillas, §Interfaz de adjuntos, §Idempotencia; `catalogo-plantillas.ts`,
`disparar-e2.adapter.ts`, `generar-presupuesto.use-case.ts`, `resend.email.adapter.ts`;
change `condiciones-idioma-e2-firma-banner` Mejora A+B.)

#### Scenario: El disparo de E2 propaga el idioma de la RESERVA al motor

- **GIVEN** una activación de `pre_reserva` de una RESERVA con `idioma = 'ca'` y su `pdf_url`
  disponible
- **WHEN** el `DispararE2Adapter` invoca `DespacharEmailService.despachar` tras el commit
- **THEN** el comando incluye `idioma = 'ca'` (tomado de `RESERVA.idioma`)
- **AND** el motor selecciona la plantilla E2 en `'ca'` y envía el presupuesto en catalán,
  sin recurrir al idioma del `TENANT_SETTINGS`

#### Scenario: Con PDF disponible, E2 se envía con el presupuesto adjunto y se traza

- **GIVEN** una activación de `pre_reserva` que acaba de crear el PRESUPUESTO con su `pdf_url`
  disponible y alcanzable
- **WHEN** el sistema completa la operación tras el commit
- **THEN** el motor de email envía E2 al cliente con el PDF del presupuesto adjunto (path local ⇒
  `content` Buffer; URL ⇒ descargada por Resend) y contenido real (no placeholder)
- **AND** se crea una fila en `COMUNICACION` con `codigo_email = 'E2'`, `estado = 'enviado'`,
  `reserva_id` = esta RESERVA, `cliente_id` = el CLIENTE de la reserva y el `tenant_id` correcto

#### Scenario: Sin PDF disponible, E2 NO se envía sin el presupuesto (adjunto requerido)

- **GIVEN** una activación de `pre_reserva` cuyo `PRESUPUESTO.pdf_url` aún no está disponible o no
  es alcanzable en el disparo de E2
- **WHEN** el sistema intenta disparar E2 tras el commit
- **THEN** el motor **NO envía** un E2 sin el presupuesto adjunto (adjunto requerido): el envío
  queda bloqueado y el intento es **observable** (no un envío silenciosamente incompleto)
- **AND** por la idempotencia `(reserva_id, 'E2')` el E2 puede **reintentarse** una vez el PDF esté
  generado y alcanzable, entregándose entonces CON el presupuesto adjunto

#### Scenario: E2 adjunta condicions en español en el idioma de la reserva

- **GIVEN** una RESERVA con `idioma = 'es'` y un tenant con condicions configuradas
- **WHEN** se confirma el presupuesto y se dispara E2
- **THEN** el email E2 lleva adjunto el PDF de condicions generado en español
- **AND** la clave del PDF en el almacén es `condiciones/{tenantId}-es.pdf`

#### Scenario: E2 adjunta condicions en catalán en el idioma de la reserva

- **GIVEN** una RESERVA con `idioma = 'ca'` y un tenant con condicions configuradas
- **WHEN** se confirma el presupuesto y se dispara E2
- **THEN** el email E2 lleva adjunto el PDF de condicions generado en catalán
- **AND** la clave del PDF en el almacén es `condiciones/{tenantId}-ca.pdf`

#### Scenario: E2 no se duplica ante un segundo disparo sobre la misma RESERVA

- **GIVEN** una RESERVA que ya tiene una `COMUNICACION` con `codigo_email = 'E2'`
- **WHEN** el trigger E2 se vuelve a disparar para esa RESERVA
- **THEN** el motor detecta la entrada existente y no crea una segunda `COMUNICACION` E2 ni
  reenvía el email (idempotencia por `(reserva_id, codigo_email)` de US-045)

#### Scenario: En test/CI E2 no envía correos reales

- **GIVEN** el entorno de test o CI con el transporte de email en modo fake
- **WHEN** una activación de `pre_reserva` dispara E2
- **THEN** no se realiza ninguna llamada de red al proveedor externo
- **AND** el disparo de E2 y su registro en `COMUNICACION` quedan verificables para las
  aserciones de los tests

---

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
adjuntos: `adjuntosRequeridos` declara únicamente la **factura de señal como requerida**. La
activación deja el catálogo consistente; el envío atómico de esta acción manual usa el
puerto directo (ver requisito siguiente). (Fuente: US-045 §Catálogo (E3→US-021/022/023);
`design.md §D-ruta-email`; change `condiciones-idioma-e2-firma-banner` Mejora B.)

#### Scenario: E3 deja de estar inactiva y expone su render real

- **GIVEN** el catálogo de plantillas con E3 previamente inactiva (`renderInactivo`)
- **WHEN** se selecciona la plantilla E3 en idioma `es`
- **THEN** la plantilla está `activa = true` y devuelve un asunto y cuerpo reales (no el
  placeholder de plantilla inactiva)
- **AND** declara la factura de señal como único adjunto requerido (sin condicions particulars)

---

### Requirement: Cableado de E3 síncrono y confirmado por el puerto de envío directo

El sistema SHALL (DEBE), al enviar la factura de señal (delta `facturacion`), disparar el
envío del email **E3** al `CLIENTE.email` de la RESERVA por el **puerto de envío directo**
(`EnviarEmailPort`, `codigo_email = 'E3'`), adjuntando **únicamente** el PDF de la
**factura de señal** (`FACTURA(senal).pdf_url`). E3 ya **no adjunta el PDF de condicions
particulars** — las condicions se envían en E2 al confirmar el presupuesto. El disparo es
**síncrono y esperando la confirmación del proveedor**, de modo que si el proveedor
**falla, el fallo PROPAGA** para que la emisión de la factura (delta `facturacion`)
**revierta** (atomicidad). Este cableado **NO** usa el motor `DespacharEmailService`, que por
diseño traza el fallo en `COMUNICACION` sin propagar y sería incompatible con el rollback
exigido. El sistema DEBE registrar el resultado en `COMUNICACION` con `codigo_email = 'E3'`,
`estado = 'enviado'`, `fecha_envio = now()`, `reserva_id`, `cliente_id` y `tenant_id`
correctos, y en `AUDIT_LOG`. En entornos `test`/CI el transporte DEBE operar en **modo fake**
(confirmación simulada, sin red).
(Fuente: `US-023 §Happy Path`, `§Fallo en el envío del email E3`; US-028 patrón E4;
US-045 §Transporte real / modo sandbox; `design.md §D-ruta-email`;
change `condiciones-idioma-e2-firma-banner` Mejora B.)

#### Scenario: Enviar factura de señal dispara E3 con el adjunto de señal y registra la comunicación

- **GIVEN** una emisión de señal cuya `FACTURA(senal).pdf_url` está disponible y
  `CLIENTE.email` no es nulo
- **WHEN** el sistema envía E3
- **THEN** el envío adjunta únicamente la factura de señal al `CLIENTE.email`
- **AND** no se adjunta ningún PDF de condicions particulars en E3
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

El sistema SHALL (DEBE), antes de disparar E3 por la acción de **primer envío**
(`.../senal/enviar`), comprobar si ya existe una `COMUNICACION` con `reserva_id` de la RESERVA,
`codigo_email = 'E3'`, `es_reenvio = false` en `estado = 'enviado'`. Si existe, NO DEBE re-enviar el
email ni crear una segunda `COMUNICACION` E3 `enviado` con `es_reenvio = false`; la acción de primer
envío se rechaza (ver delta `facturacion`, `E3_YA_ENVIADO`). El **reenvío explícito** de E3 (nueva
`COMUNICACION` con `es_reenvio = true`) **YA NO está fuera de alcance**: se realiza por la acción
dedicada de reenvío (`.../senal/reenviar`, ver el requisito de reenvío y el delta `facturacion`),
que es una excepción explícita y auditada a esta idempotencia. Una `COMUNICACION` E3 previa en
`estado = 'fallido'` NO bloquea el reintento. (Fuente: `US-023 §E3 ya enviado previamente`,
`§Reglas de Validación`; `design.md §D-reenvio-e3`; reemplaza la acotación "reenvío fuera de
alcance" de 6.4b.)

> US-023 **acota** este requisito al **primer disparo** de E3 (acción `.../senal/enviar`) y remite
> el **reenvío manual** al nuevo requisito "El reenvío manual de E3 crea una nueva COMUNICACION con
> es_reenvio marcado". 6.4b dejaba el reenvío fuera de alcance; ya no lo está.

#### Scenario: El primer disparo repetido de E3 se sigue rechazando

- **GIVEN** una RESERVA con una `COMUNICACION` E3 `enviado` (`es_reenvio = false`)
- **WHEN** el Gestor vuelve a usar la acción de primer envío `.../senal/enviar`
- **THEN** no se dispara un nuevo E3 con `es_reenvio = false` ni se crea una segunda COMUNICACION de
  ese tipo
- **AND** la acción de primer envío se rechaza (`E3_YA_ENVIADO`, ver delta `facturacion`)

#### Scenario: El reenvío explícito ya no está bloqueado

- **GIVEN** una RESERVA con E3 ya enviado (`es_reenvio = false`)
- **WHEN** el Gestor usa la acción dedicada de reenvío `.../senal/reenviar`
- **THEN** el sistema crea una nueva `COMUNICACION` E3 con `es_reenvio = true` (no aplica el bloqueo
  de idempotencia del primer disparo)

### Requirement: El reenvío manual de E3 crea una nueva COMUNICACION con es_reenvio marcado

El sistema SHALL (DEBE), cuando el Gestor reenvía E3 (delta `facturacion`), crear una **nueva**
`COMUNICACION` con `codigo_email = 'E3'`, `estado = 'enviado'`, `es_reenvio = true`,
`fecha_envio = now()`, `reserva_id`, `cliente_id` y `tenant_id` correctos, por cada reenvío. Al
llevar `es_reenvio = true`, la fila queda **fuera** del índice UNIQUE parcial
`(reserva_id, codigo_email) WHERE reserva_id IS NOT NULL AND es_reenvio = false` (US-045), de modo
que **no colisiona** (`P2002`) con la COMUNICACION E3 original (`es_reenvio = false`) ni entre
reenvíos sucesivos. El reenvío reutiliza los adjuntos ya existentes (PDF de la factura de señal y
`DOCUMENTO` de condiciones) y es una **excepción explícita y auditada** a la idempotencia: el
reenvío manual del Gestor es intencionado y DEBE quedar trazado como una nueva comunicación. El
envío usa el **puerto directo** (`EnviarEmailPort`, `codigo_email = 'E3'`) y ocurre **antes** de
crear la COMUNICACION (espejo del reenvío de E4); si el proveedor falla, propaga el error recuperable
y **no queda** ninguna COMUNICACION de reenvío (no se llegó a escribir en BD). (Fuente: `US-023 §E3 ya
enviado previamente (reenvío)`; patrón US-028 §Reenvío de E4; US-045 §Idempotencia índice parcial;
`design.md §D-reenvio-e3`.)

#### Scenario: Cada reenvío de E3 deja su propia COMUNICACION es_reenvio

- **GIVEN** una RESERVA con una `COMUNICACION` E3 `enviado` original (`es_reenvio = false`)
- **WHEN** el Gestor reenvía E3
- **THEN** se crea una nueva `COMUNICACION` `codigo_email = 'E3'`, `estado = 'enviado'`,
  `es_reenvio = true`, `fecha_envio` no nulo
- **AND** la inserción no colisiona con la COMUNICACION E3 original por el índice UNIQUE parcial

#### Scenario: Un segundo reenvío tampoco colisiona

- **GIVEN** una RESERVA que ya tuvo un primer reenvío de E3 (`es_reenvio = true`)
- **WHEN** el Gestor reenvía E3 de nuevo
- **THEN** se crea otra `COMUNICACION` E3 `es_reenvio = true` sin error de unicidad

#### Scenario: El fallo del proveedor en el reenvío no deja COMUNICACION

- **GIVEN** una RESERVA con E3 ya enviado
- **WHEN** el Gestor reenvía E3 pero el proveedor falla
- **THEN** no se crea ninguna `COMUNICACION` E3 de reenvío (el email va primero: al fallar no se
  escribe en BD) y el sistema devuelve un error recuperable

### Requirement: Listado de las comunicaciones de una RESERVA para la ficha del gestor

El sistema SHALL (DEBE) exponer un listado de todas las `COMUNICACION` asociadas a una
RESERVA (sección "Comunicaciones" de la ficha), devolviendo por cada fila al menos
`id`, `codigo_email`, `subtipo`, `estado`, `asunto`, `destinatario_email`,
`fecha_creacion`, `fecha_envio` y `es_reenvio`. El campo `subtipo` es **nullable**
(`NULL` para E2–E8, `manual` y filas legadas) y, cuando está presente, el frontend
DEBE renderizar una **etiqueta humana** por subtipo
(`consulta_exploratoria` → "Respuesta a consulta (sin fecha)"; `fecha_disponible` →
"Fecha disponible / asignada"; `fecha_confirmada` → "Fecha confirmada"; `cola_espera`
→ "En cola de espera"; `cambio_fecha` → "Cambio de fecha"). El listado DEBE devolver
**todas** las filas de esa RESERVA **sin deduplicar por código ni por subtipo**: si
hay varias E1 `borrador` de subtipos distintos (historial completo, por
alta/añadir/cambiar fecha) el listado las devuelve **todas**. El listado DEBE
ejecutarse bajo el **contexto RLS del `tenant_id` del JWT** del gestor autenticado y
devolver **únicamente** comunicaciones cuyo `reserva_id` es la RESERVA solicitada y
cuyo `tenant_id` coincide con el del JWT (nunca cross-tenant). Las comunicaciones en
`estado = 'enviado'` o `'fallido'` se presentan como **solo lectura**; las de
`estado = 'borrador'` son accionables (enviar / descartar). (Fuente: `US-046
§Supuestos` sección Comunicaciones de la ficha, `§Happy Path`; UC-36; `CLAUDE.md
§Multi-tenancy`; requirement vivo *"Idempotencia de un email por reserva y código"*;
`design.md §D-subtipo`.)

#### Scenario: El gestor lista las comunicaciones de su reserva

- **GIVEN** una RESERVA del tenant del gestor con varias `COMUNICACION`
  (p. ej. una E1 en `borrador`, una E2 `enviado`)
- **WHEN** el gestor solicita el listado de comunicaciones de esa RESERVA
- **THEN** el sistema devuelve todas las filas de esa RESERVA con su `codigo_email`,
  `subtipo`, `estado`, `asunto`, `destinatario_email`, `fecha_creacion`, `fecha_envio`
  y `es_reenvio`
- **AND** las de `estado = 'enviado'`/`'fallido'` se marcan de solo lectura y las de
  `'borrador'` como accionables

#### Scenario: El listado no expone comunicaciones de otro tenant

- **GIVEN** una RESERVA cuyo `tenant_id` no coincide con el `tenant_id` del JWT del
  gestor
- **WHEN** el gestor solicita el listado de comunicaciones de esa RESERVA
- **THEN** el sistema no devuelve comunicaciones de esa RESERVA (aislamiento RLS por
  tenant)

#### Scenario: El listado devuelve varias E1 etiquetadas por subtipo

- **GIVEN** una RESERVA del tenant del gestor cuyo ciclo de vida ha generado tres
  emails E1 en `borrador` con subtipos `consulta_exploratoria`, `fecha_disponible` y
  `cambio_fecha`
- **WHEN** el gestor solicita el listado de comunicaciones de esa RESERVA
- **THEN** el sistema devuelve las **tres** filas E1 (una por evento), no una sola
  sobrescrita, cada una con su `subtipo`, `asunto` y `fecha_creacion`
- **AND** el frontend muestra una etiqueta humana por subtipo ("Respuesta a consulta
  (sin fecha)", "Fecha disponible / asignada", "Cambio de fecha")

### Requirement: Confirmación de envío de un borrador con edición opcional de asunto y cuerpo

El sistema SHALL (DEBE) permitir al gestor **confirmar el envío** de una
`COMUNICACION` en `estado = 'borrador'`: envía el email al `destinatario_email` de la
comunicación (heredado del `CLIENTE`) **reutilizando el camino de envío del motor de
US-045** (`EnviarEmailPort`), y al aceptar el proveedor actualiza la fila a
`estado = 'enviado'` con `fecha_envio` **no nulo**. El gestor PUEDE editar opcionalmente
`asunto` y `cuerpo` antes de confirmar; cuando lo hace, el `asunto`/`cuerpo`
**persistido** en `COMUNICACION` DEBE reflejar el contenido **efectivamente enviado**
(no la versión original del borrador). El gestor NO PUEDE modificar `codigo_email` ni
`destinatario_email`. **En el borde de envío**, cuando el `cuerpo` es **texto plano** (con
saltos de línea `\n`, como el E1 de transición o un email manual editado en el textarea de
revisión), el sistema DEBE **convertirlo a HTML preservando el formato**: escapar el HTML,
transformar los párrafos (`\n\n → <p>…</p>`) y los saltos de línea simples (`\n → <br>`), y
enviar ese HTML en `html` mientras `text` conserva el **texto crudo**. Un `cuerpo` que ya
es **HTML renderizado** (p. ej. el generado por el catálogo E1/E2/E3) NO DEBE volver a
convertirse (para no doble-escapar el marcado). La conversión NO altera el `cuerpo`
**persistido** en `COMUNICACION` (que sigue siendo el texto que el gestor ve/edita); solo
afecta al `html` que recibe el proveedor. La acción DEBE registrarse en `AUDIT_LOG` y
ejecutarse bajo el `tenant_id` del JWT. (Fuente: `US-046 §Happy Path — Revisar y enviar`,
`§Happy Path — Revisar, editar y enviar`, `§Reglas de Validación`; UC-36; plan aprobado del
usuario; `resend.email.adapter.ts`; `catalogo-plantillas.ts`; `design.md §D-2`.)

#### Scenario: Confirmar el envío sin editar deja la comunicación enviada

- **GIVEN** una `COMUNICACION` con `codigo_email = 'E1'`, `estado = 'borrador'`,
  vinculada a una RESERVA activa, con `destinatario_email` válido
- **WHEN** el gestor confirma el envío sin editar
- **THEN** el sistema envía el email al `destinatario_email` reutilizando el puerto de
  envío del motor
- **AND** actualiza la fila a `estado = 'enviado'` con `fecha_envio` no nulo
- **AND** registra la operación en `AUDIT_LOG`

#### Scenario: Editar el cuerpo persiste el contenido efectivamente enviado

- **GIVEN** una `COMUNICACION` en `estado = 'borrador'`
- **WHEN** el gestor modifica el `cuerpo` con texto personalizado y confirma el envío
- **THEN** el sistema envía el email con el `cuerpo` editado
- **AND** actualiza `estado = 'enviado'`, registra `fecha_envio` y el `cuerpo`
  almacenado en `COMUNICACION` refleja el contenido enviado (no el original)

#### Scenario: El gestor no puede modificar el código ni el destinatario

- **GIVEN** una `COMUNICACION` en `estado = 'borrador'`
- **WHEN** el gestor confirma el envío
- **THEN** el sistema mantiene `codigo_email` y `destinatario_email` originales
  (solo `asunto` y `cuerpo` son editables)

#### Scenario: El cuerpo en texto plano se envía como HTML preservando los saltos de línea

- **GIVEN** una `COMUNICACION` en `estado = 'borrador'` cuyo `cuerpo` es **texto plano** con
  varios párrafos separados por `\n\n` y saltos de línea simples `\n` (E1 de transición o
  email manual)
- **WHEN** el gestor confirma el envío
- **THEN** el `html` que recibe el proveedor contiene el cuerpo convertido con `<p>` por
  párrafo y `<br>` por salto simple, con el texto escapado
- **AND** el `text` que recibe el proveedor conserva el texto plano crudo
- **AND** el cuerpo persistido en `COMUNICACION` sigue siendo el texto plano (la conversión
  no lo altera)

#### Scenario: Un cuerpo que ya es HTML del catálogo no se doble-escapa al enviar

- **GIVEN** una `COMUNICACION` cuyo `cuerpo` ya es **HTML renderizado** por el catálogo
  (E1/E2/E3, con `<p>`/`<br>`)
- **WHEN** el sistema envía el email
- **THEN** el `html` que recibe el proveedor conserva el marcado del catálogo intacto (no se
  vuelve a escapar ni a envolver en `<p>`)

### Requirement: Solo un borrador es enviable — enviado y fallido son de solo lectura (idempotencia de la acción manual)

El sistema SHALL (DEBE) permitir confirmar el envío **únicamente** de una
`COMUNICACION` en `estado = 'borrador'`. Una `COMUNICACION` en `estado = 'enviado'`
DEBE tratarse como **terminal y de solo lectura**: el sistema NO DEBE permitir un
segundo envío, NO DEBE revertirla a `borrador` y NO DEBE crear una entrada duplicada
en `COMUNICACION`. Una `COMUNICACION` en `estado = 'fallido'` es igualmente de solo
lectura para esta acción (el reintento se hace creando/reenviando, no re-enviando la
misma fila). Un intento de enviar una fila que no está en `borrador` DEBE rechazarse
como conflicto de estado sin efectos. (Fuente: `US-046 §Borrador ya enviado (intento
de reenvío duplicado)`, `§Reglas de Validación` idempotencia; UC-36.)

#### Scenario: Un segundo envío del mismo borrador ya enviado se rechaza sin duplicar

- **GIVEN** una `COMUNICACION` que ya está en `estado = 'enviado'`
- **WHEN** el gestor intenta enviarla de nuevo (doble clic o petición duplicada)
- **THEN** el sistema la muestra como "ya enviada" en solo lectura y rechaza el segundo
  envío
- **AND** no revierte el estado a `borrador` ni crea una entrada duplicada en
  `COMUNICACION`

#### Scenario: Enviar una comunicación en fallido se rechaza como conflicto de estado

- **GIVEN** una `COMUNICACION` en `estado = 'fallido'`
- **WHEN** el gestor intenta confirmar su envío como si fuera un borrador
- **THEN** el sistema rechaza la acción como conflicto de estado sin efectos

### Requirement: Validación del destinatario antes del envío deja el borrador en borrador

El sistema SHALL (DEBE), **antes** de intentar el envío de un borrador, validar que el
`destinatario_email` (heredado del `CLIENTE.email`) **no es nulo** y tiene un **formato
válido (RFC 5321)**. Si la validación falla, el sistema NO DEBE llamar al proveedor de
email, DEBE devolver un **error de validación** ("El cliente no tiene un email válido
registrado") y DEBE dejar la `COMUNICACION` **en `estado = 'borrador'`** (no la pasa a
`fallido`, porque el envío ni siquiera se intentó). El sistema DEBE invitar al gestor a
actualizar el email del `CLIENTE` antes de reintentar. Esta validación es **previa** al
envío, no posterior. (Fuente: `US-046 §Borrador con destinatario nulo o email
inválido`, `§Reglas de Validación`; spec viva `comunicaciones` "Bloqueo de envío ante
variable de plantilla nula".)

#### Scenario: Email de cliente nulo o inválido bloquea el envío y conserva el borrador

- **GIVEN** una `COMUNICACION` en `estado = 'borrador'` cuyo `destinatario_email` /
  `CLIENTE.email` es nulo o tiene formato inválido
- **WHEN** el gestor intenta confirmar el envío
- **THEN** el sistema devuelve un error de validación y no llama al proveedor de email
- **AND** la `COMUNICACION` permanece en `estado = 'borrador'` (no pasa a `fallido`)

### Requirement: Fallo del proveedor al enviar un borrador deja la comunicación en fallido sin reintento automático

El sistema SHALL (DEBE), cuando el gestor confirma el envío de un borrador con
destinatario válido pero el **proveedor de email falla** (timeout, bounce permanente,
credenciales inválidas), actualizar la `COMUNICACION` a `estado = 'fallido'` **sin**
`fecha_envio`, registrar el error en `AUDIT_LOG` y mostrar al gestor un mensaje
indicando que el envío falló y que puede **reintentarlo**. El sistema NO DEBE reintentar
el envío automáticamente en el MVP. La confirmación de envío del gestor NO DEBE propagar
la excepción del proveedor como error no controlado. (Fuente: `US-046 §Fallo del
proveedor de email al confirmar el envío`; spec viva `comunicaciones` "Fallo del
proveedor sin reintento automático".)

#### Scenario: El proveedor falla y la comunicación queda en fallido y auditada

- **GIVEN** una `COMUNICACION` en `estado = 'borrador'` con `destinatario_email` válido
- **WHEN** el gestor confirma el envío y el proveedor de email devuelve un error
- **THEN** la `COMUNICACION` queda en `estado = 'fallido'` sin `fecha_envio`
- **AND** el error se registra en `AUDIT_LOG` y el gestor ve un mensaje de que puede
  reintentar
- **AND** el sistema no reintenta el envío automáticamente

### Requirement: Descarte de un borrador por el gestor lo lleva a fallido sin envío y con causa auditada

El sistema SHALL (DEBE) permitir al gestor **descartar** una `COMUNICACION` en
`estado = 'borrador'`: la fila pasa a `estado = 'fallido'` (no existe un estado
"descartado" en el enum), **sin** enviar ningún email y **sin** `fecha_envio`, y el
sistema DEBE registrar la acción en `AUDIT_LOG` con la **causa "descartado por
gestor"** (distinguible de un fallo del proveedor por dicha causa). Tras el descarte, el
borrador **desaparece de la bandeja de borradores pendientes** de la ficha; la RESERVA
puede continuar su ciclo de vida con normalidad y el gestor puede crear un email manual
si lo necesita. Solo se puede descartar una fila en `estado = 'borrador'`.

**El endpoint backend de descarte se conserva** (misma lógica, misma guarda de estado y
misma auditoría de US-046), pero **desde US-047 ya no se expone en la interfaz de usuario**:
el botón "Descartar" se retira de `ComunicacionListaItem`/`ComunicacionesCard` y el
componente `DescartarBorradorDialog` se elimina. El descarte deja de ofrecerse como acción
manual del gestor en la UI porque, para un E1, la expectativa de negocio es enviar el
correo de confirmación, no descartarlo; la capacidad backend permanece disponible para
usos programáticos o futuras superficies. (Fuente: `US-046 §Gestor descarta el borrador sin
enviar`, `§Reglas de negocio` descarte; UC-36; `US-047` retirada del botón "Descartar" de la
UI conservando el endpoint.)

#### Scenario: Descartar un borrador lo pasa a fallido y lo audita como descartado

- **GIVEN** una `COMUNICACION` en `estado = 'borrador'` vinculada a una RESERVA
- **WHEN** se invoca el endpoint de descarte del borrador
- **THEN** la `COMUNICACION` pasa a `estado = 'fallido'` sin `fecha_envio` y sin enviar
  ningún email
- **AND** se registra en `AUDIT_LOG` con la causa "descartado por gestor"
- **AND** el borrador deja de aparecer en la bandeja de borradores pendientes

#### Scenario: No se puede descartar una comunicación que no está en borrador

- **GIVEN** una `COMUNICACION` en `estado = 'enviado'` o `'fallido'`
- **WHEN** se invoca el endpoint de descarte sobre ella
- **THEN** el sistema rechaza la acción como conflicto de estado sin efectos

#### Scenario: El descarte no se ofrece como acción en la interfaz de usuario

- **GIVEN** una `COMUNICACION` en `estado = 'borrador'` mostrada en la ficha de la RESERVA
- **WHEN** el gestor visualiza las acciones del borrador en la UI
- **THEN** no se muestra ningún botón "Descartar" (retirado en US-047)
- **AND** el endpoint backend de descarte permanece disponible pero sin exposición en la UI

### Requirement: Creación y envío de un email manual desde la ficha de la RESERVA

El sistema SHALL (DEBE) permitir al gestor **crear y enviar un email manual** desde la
ficha de una RESERVA: el gestor redacta `asunto` y `cuerpo`, y al confirmar el sistema
envía el email al `CLIENTE.email` de la RESERVA **reutilizando el puerto de envío del
motor de US-045**, y crea una `COMUNICACION` con `codigo_email = 'manual'`,
`estado = 'enviado'`, `fecha_envio` **no nulo**, `reserva_id` = la RESERVA,
`cliente_id` = el CLIENTE de esa RESERVA y el `tenant_id` del JWT, registrando la
operación en `AUDIT_LOG`. Al ser `manual`, la fila queda **fuera del índice UNIQUE
parcial de idempotencia** `(reserva_id, codigo_email)` de US-045 (permitiendo varios
emails manuales por RESERVA), de modo que no colisiona con otras comunicaciones de la
misma RESERVA. Antes de enviar, se aplica la misma validación de destinatario (email no
nulo y válido). (Fuente: `US-046 §Happy Path — Crear y enviar email manual`,
`§Reglas de negocio` `codigo_email = manual`; spec viva `comunicaciones` "Idempotencia
de un email por reserva y código" índice parcial.)

#### Scenario: Crear un email manual lo envía y crea la fila enviada

- **GIVEN** una RESERVA activa del tenant del gestor con `CLIENTE.email` válido
- **WHEN** el gestor selecciona "Nuevo email manual", redacta `asunto` y `cuerpo`, y
  confirma el envío
- **THEN** el sistema envía el email al `CLIENTE.email` reutilizando el puerto de envío
- **AND** crea `COMUNICACION` con `codigo_email = 'manual'`, `estado = 'enviado'`,
  `fecha_envio` no nulo, `reserva_id`, `cliente_id` y `tenant_id` correctos
- **AND** registra la operación en `AUDIT_LOG`

#### Scenario: Varios emails manuales sobre la misma reserva no colisionan por idempotencia

- **GIVEN** una RESERVA que ya tiene una `COMUNICACION` `manual` enviada
- **WHEN** el gestor crea y envía un segundo email manual sobre esa misma RESERVA
- **THEN** el sistema crea una segunda `COMUNICACION` `manual` sin error de unicidad
  (los emails `manual` quedan fuera del índice UNIQUE parcial de US-045)

#### Scenario: Email manual con cliente sin email válido bloquea el envío

- **GIVEN** una RESERVA cuyo `CLIENTE.email` es nulo o inválido
- **WHEN** el gestor intenta crear y enviar un email manual
- **THEN** el sistema devuelve un error de validación y no crea una `COMUNICACION`
  `enviado` ni llama al proveedor

### Requirement: Toda acción manual de comunicaciones corre bajo el tenant del JWT y el cliente de la reserva

El sistema SHALL (DEBE) ejecutar el listado, el envío, el descarte y el email manual
bajo el **contexto RLS del `tenant_id` del JWT** del gestor autenticado, verificando
que el `tenant_id` de la `COMUNICACION`/RESERVA coincide con el del JWT y que el
`cliente_id` corresponde al `CLIENTE` de la RESERVA asociada. El sistema NO DEBE operar
sobre comunicaciones ni reservas de otro tenant (cross-tenant), ni tomar el
`tenant_id`/`cliente_id` del path o del body en lugar del JWT y de la relación de la
RESERVA. (Fuente: `US-046 §Reglas de Validación` tenant/cliente; UC-36; `CLAUDE.md
§Multi-tenancy`.)

#### Scenario: Enviar un borrador de otro tenant se rechaza

- **GIVEN** una `COMUNICACION` cuyo `tenant_id` no coincide con el `tenant_id` del JWT
  del gestor
- **WHEN** el gestor intenta enviarla o descartarla
- **THEN** el sistema rechaza la acción (aislamiento RLS por tenant) sin efectos

#### Scenario: El tenant y el cliente se toman del JWT y de la reserva, no del body

- **GIVEN** una acción manual de comunicaciones con `tenant_id`/`cliente_id` en el body
  distintos de los del JWT y de la RESERVA
- **WHEN** el sistema procesa la acción
- **THEN** usa el `tenant_id` del JWT y el `cliente_id` del CLIENTE de la RESERVA,
  ignorando los del body

### Requirement: El envío de un borrador E1 adjunta el dossier PDF según el idioma de la reserva

El sistema SHALL (DEBE), cuando el gestor confirma el envío de una `COMUNICACION` en
`estado = 'borrador'` cuyo `codigo_email === 'E1'`, adjuntar **siempre** el dossier PDF del
espacio en el idioma de la RESERVA (`Dossier-Masia-Encis-{reserva.idioma}.pdf`), obtenido
por **referencia de URL** desde el almacén del tenant, reutilizando el mismo mecanismo de
adjuntos de US-045 usado por el alta de consulta (`AltaConsultaUseCase`). El idioma se toma
de `RESERVA.idioma` (la reserva que el use-case ya carga para validar el envío); en su
ausencia degrada al idioma por defecto (`'es'`), igual que el alta. Si `dossierBaseUrl` no
está configurado, el envío **procede sin adjunto** (degradación graceful idéntica a la de
`AltaConsultaUseCase`), sin bloquear el envío del borrador. Para códigos de email distintos
de `E1` (p. ej. borradores `manual`), el envío NO adjunta el dossier. Esta regla no altera
las transiciones de estado de US-046 (`borrador → enviado`/`fallido`): solo añade el adjunto
al camino de envío. (Fuente: `US-047` PDF adjunto al enviar borrador E1; spec viva
`comunicaciones` "Cableado real de E1 … dossier adjunto", "Interfaz de adjuntos por
referencia documental".)

#### Scenario: Enviar un borrador E1 en catalán adjunta el dossier en catalán

- **GIVEN** una `COMUNICACION` `codigo_email = 'E1'`, `estado = 'borrador'`, vinculada a una
  RESERVA con `idioma = 'ca'`, y `dossierBaseUrl` configurado
- **WHEN** el gestor confirma el envío del borrador
- **THEN** el sistema envía el email adjuntando `Dossier-Masia-Encis-ca.pdf` por referencia
  de URL
- **AND** actualiza la `COMUNICACION` a `estado = 'enviado'` con `fecha_envio` no nulo

#### Scenario: Sin dossierBaseUrl configurado, el envío del borrador E1 procede sin adjunto

- **GIVEN** una `COMUNICACION` `codigo_email = 'E1'`, `estado = 'borrador'`, y
  `dossierBaseUrl` **no** configurado
- **WHEN** el gestor confirma el envío del borrador
- **THEN** el sistema envía el email **sin** adjunto (degradación graceful)
- **AND** el envío no se bloquea por la ausencia del dossier

#### Scenario: Un borrador que no es E1 se envía sin adjuntar el dossier

- **GIVEN** una `COMUNICACION` en `estado = 'borrador'` cuyo `codigo_email` no es `'E1'`
- **WHEN** el gestor confirma el envío del borrador
- **THEN** el sistema envía el email sin adjuntar el dossier del espacio

### Requirement: El modal de revisión del borrador usa un ancho amplio para leer el cuerpo

El sistema SHALL (DEBE) presentar el diálogo de revisión y envío del borrador
(`RevisarEnviarBorradorDialog`) con un ancho amplio (`max-w-2xl`) para facilitar la lectura
y edición del `cuerpo` del email, manteniendo el diseño **responsive** (mobile-first) sin
provocar overflow horizontal en móvil, tablet ni escritorio. El contenido del cuerpo
mostrado en el modal es el que el borrador ya tiene **almacenado** (plantilla renderizada en
el alta, US-045); el modal no re-renderiza la plantilla. (Fuente: `US-047` modal más ancho;
`CLAUDE.md §Web responsive`.)

#### Scenario: El diálogo de revisión se muestra con ancho amplio y sin overflow

- **GIVEN** una `COMUNICACION` en `estado = 'borrador'` accionable en la ficha
- **WHEN** el gestor abre el diálogo de revisión y envío
- **THEN** el diálogo se presenta con ancho `max-w-2xl`
- **AND** no produce overflow horizontal en los viewports 390 / 768 / 1280

### Requirement: Email de modificación de reserva en el idioma de la reserva

El sistema SHALL (DEBE), tras un recálculo del precio en la ventana viva que produce un nuevo
presupuesto de modificación, **enviar al cliente** una COMUNICACION que le notifique la
modificación solicitada (indicando si cambió el **nº de personas**, la **duración** o ambos) y
que se le envía un nuevo presupuesto con el **restante a liquidar** actualizado. El email SHALL
(DEBE) redactarse en el **idioma de la reserva** (`RESERVA.idioma`), reutilizando el motor de
email de US-045 y el patrón i18n del catálogo de plantillas (render indexado por `codigoEmail` +
idioma con **fallback a `es`** y registro en `AUDIT_LOG` cuando no exista variante para el
idioma), como ya hacen E2/E3. Se añade una **plantilla nueva** (código de email dedicado, con
variantes `es` y `ca`) coherente en tono y formato con las plantillas existentes; el adjunto es
el PDF del presupuesto de modificación (patrón E2). El envío es un efecto **post-commit**: su
fallo NO revierte el recálculo ya comprometido y queda trazado como COMUNICACION `fallido`
reintentable. Toda operación filtra por el `tenant_id` del JWT (RLS). (Fuente: petición de
usuario; `US-045` motor + i18n + fallback; `US-015` reenvío post-commit; `catalogo-plantillas.
ts`; `codigo-email.ts`.)

#### Scenario: Modificación con la reserva en catalán envía el email en catalán

- **GIVEN** una RESERVA con `idioma = 'ca'` recalculada por un aumento de invitados
- **WHEN** el sistema notifica la modificación al cliente
- **THEN** envía la COMUNICACION con la plantilla nueva en variante `ca`, indicando el cambio de
  nº de personas y el nuevo restante a liquidar, con el PDF del presupuesto de modificación
  adjunto

#### Scenario: Modificación con la reserva en español envía el email en español

- **GIVEN** una RESERVA con `idioma = 'es'` recalculada por un cambio de duración
- **WHEN** el sistema notifica la modificación al cliente
- **THEN** envía la COMUNICACION con la plantilla nueva en variante `es`, indicando el cambio de
  duración y el nuevo restante a liquidar

#### Scenario: Idioma sin variante cae a español con traza

- **GIVEN** una RESERVA con un `idioma` sin variante de plantilla disponible
- **WHEN** el sistema resuelve la plantilla del email de modificación
- **THEN** aplica el fallback a la variante `es` y registra la incidencia en `AUDIT_LOG` (mismo
  comportamiento que E1/E2/E3)

#### Scenario: Un fallo del proveedor no revierte el recálculo

- **GIVEN** un recálculo ya comprometido (importes re-congelados, presupuesto de modificación y
  liquidación regenerados)
- **WHEN** el envío del email de modificación falla en el proveedor
- **THEN** el recálculo NO se revierte y la COMUNICACION queda registrada como `fallido`
  (reintentable), sin afectar a la consistencia de la RESERVA

