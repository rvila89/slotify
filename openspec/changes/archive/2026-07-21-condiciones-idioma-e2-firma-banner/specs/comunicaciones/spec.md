# Spec-delta: condiciones-idioma-e2-firma-banner (capability `comunicaciones`)

## MODIFIED Requirements

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
