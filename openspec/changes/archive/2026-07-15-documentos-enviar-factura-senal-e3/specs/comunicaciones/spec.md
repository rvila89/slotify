# Spec Delta — Capability `comunicaciones` (MODIFICADA)

> 6.4b (Bloque C) **cablea y activa el email E3** (hasta ahora declarado/inactivo en el
> catálogo de US-045) con **DOS adjuntos**: la **factura de señal** (`FACTURA(senal).pdf_url`,
> requerido) y las **condicions particulars** (`GenerarPdfCondicionesPort`, opcional; ver
> delta `documentos`). A diferencia del patrón "post-commit, fallo no revierte" de E2, el
> disparo de E3 es **síncrono y confirmado**: la emisión de la factura de señal (delta
> `facturacion`) solo se consolida si E3 se confirma (atomicidad). Por esa razón, el envío
> atómico de E3 se realiza por el **puerto de envío directo** (`EnviarEmailPort`, que
> propaga el fallo), **espejo del cableado de E4** (US-028), y **NO** por el motor
> `DespacharEmailService` (que traza el fallo sin propagar, incompatible con el rollback).
> La **plantilla E3 pasa a ACTIVA** en el catálogo para dejarlo coherente y aportar
> asunto/cuerpo canónicos.
> Fuente: US-023 (§Happy Path E3 con factura+condiciones, §Fallo en el envío del email E3),
> UC-19; US-045 (catálogo, interfaz de adjuntos, `COMUNICACION`, modo fake en test);
> `er-diagram.md §3.16 COMUNICACION`; `design.md §D-ruta-email`.

## ADDED Requirements

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
