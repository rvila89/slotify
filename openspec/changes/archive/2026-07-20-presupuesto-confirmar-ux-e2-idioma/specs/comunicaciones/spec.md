# Spec Delta — Capability `comunicaciones`

> **Workstreams D y E (bugfix backend del E2)** — El email **E2** (presupuesto enviado) se
> disparaba **sin** propagar el idioma de la RESERVA, así que salía en el idioma del tenant
> (`'es'`) en vez del idioma del lead (`RESERVA.idioma`, p. ej. `'ca'`), y el catálogo solo
> tenía la variante `es` con un cuerpo genérico de relleno (no había `PLANTILLA_E2_CA`, de modo
> que ni propagando el idioma se habría renderizado en catalán). Este delta **MODIFICA** dos
> requisitos vivos:
>
> - **(D)** el disparo de E2, para que el idioma se resuelva desde `RESERVA.idioma` —igual que
>   E1— y no desde `TENANT_SETTINGS`;
> - **(E)** el catálogo de plantillas por código e idioma, para reflejar que **E2 existe activa
>   en `es` y en `ca`** con el **texto de marca definitivo** (Masia l'Encís) y su asunto por
>   idioma.
>
> Reutiliza el motor de email y la interfaz de adjuntos de US-045; NO reimplementa el transporte,
> la idempotencia ni la máquina de estados, y NO toca el contrato OpenAPI.
>
> Fuente: workstreams D/E del change; `disparar-e2.adapter.ts` (comando sin `idioma`),
> `catalogo-plantillas.ts` (`renderE2`, `renderE1Ca`, `PLANTILLA_E2_ES`, `registroCa`,
> `seleccionar`), `despachar-email.service.ts` (`comando.idioma ?? TENANT_SETTINGS ?? 'es'`,
> fallback de idioma); specs vivas `comunicaciones` "Catálogo de plantillas por código de email e
> idioma" y "La activación de pre_reserva dispara el email E2 con el PDF del presupuesto";
> `US-014 §Email relacionado E2`; `US-045 §Reglas de negocio` idioma.

## MODIFIED Requirements

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
(no figura en `adjuntosRequeridos`): si degrada a `null`, se omite sin romper el E2. El sistema
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
`disparar-e2.adapter.ts`, `generar-presupuesto.use-case.ts`, `resend.email.adapter.ts`.)

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

## §Textos del E2 (contenido de marca — referencia normativa del render)

> `{nombre}` = nombre de pila del cliente. `{codigo}` = `codigoReserva`.

### Catalán (`renderE2Ca` / `PLANTILLA_E2_CA`)

Asunto: «El teu pressupost per a l'esdeveniment (reserva {codigo})»

```
Hola {nombre},
Moltes gràcies per confiar en la Masia l'Encís!
T'adjuntem el pressupost perquè pugueu efectuar el pagament anticipat del 40% de l'import total i així deixar confirmada la reserva.
El pressupost està basat en les persones que tens confirmades actualment i, una setmana abans de la reserva, ens posarem en contacte amb tu per concretar el llistat final d'assistents. En aquest moment recalcularem l'import total si cal.

A l'hora de realitzar la transferència, cal indicar com a destinatari "Canoliart, SL" i, en el concepte, "Masia l'Encís".
També t'adjuntem les condicions particulars, que haureu de retornar degudament signades abans de la data de la reserva.

Si tens qualsevol dubte o necessites adaptar algun detall del pressupost, estarem encantats d'ajudar-te!
Una abraçada,
Ari
Masia l'Encís
```

### Español (`renderE2` / `PLANTILLA_E2_ES`)

Asunto: «Tu presupuesto para el evento (reserva {codigo})»

```
Hola {nombre},
¡Muchas gracias por confiar en la Masia l'Encís!
Te adjuntamos el presupuesto para que podáis efectuar el pago anticipado del 40% del importe total y así dejar confirmada la reserva.
El presupuesto está basado en las personas que tienes confirmadas actualmente y, una semana antes de la reserva, nos pondremos en contacto contigo para concretar el listado final de asistentes. En ese momento recalcularemos el importe total si es necesario.

A la hora de realizar la transferencia, debes indicar como destinatario "Canoliart, SL" y, en el concepto, "Masia l'Encís".
También te adjuntamos las condiciones particulares, que deberéis devolver debidamente firmadas antes de la fecha de la reserva.

Si tienes cualquier duda o necesitas adaptar algún detalle del presupuesto, ¡estaremos encantados de ayudarte!
Un abrazo,
Ari
Masia l'Encís
```
