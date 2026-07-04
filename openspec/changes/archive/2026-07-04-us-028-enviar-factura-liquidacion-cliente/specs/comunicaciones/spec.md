# Spec Delta — Capability `comunicaciones` (MODIFICADA)

> US-028 **cablea el email E4** (hasta ahora declarado/inactivo en el catálogo de US-045) con
> **AMBOS PDFs adjuntos** (factura de liquidación + recibo de fianza) por referencia a su
> `pdf_url`, reutilizando el motor de email, la interfaz de adjuntos y el registro en
> `COMUNICACION` de US-045. A diferencia del patrón "post-commit, fallo no revierte" de
> E2/E6/E7, el disparo de E4 es **síncrono y confirmado**: la transición de estado de la
> emisión (US-028, capability `facturacion`) solo se consolida si E4 se confirma (atomicidad).
> Además especifica el **reenvío** de E4 (nueva fila de `COMUNICACION` por reenvío, sin tocar
> la factura) y el **envío del recibo de fianza por separado** como email `manual` (sin código
> E). La emisión de la factura, la numeración y los cambios de estado de la RESERVA se
> especifican en el delta de la capability `facturacion`.
> Fuente: US-028, UC-21 (pasos 3–6), UC-22 (pasos 3–4), E4 §9.3; US-045 (motor de email,
> interfaz de adjuntos, `COMUNICACION`); `er-diagram.md §3.16 COMUNICACION`.

## ADDED Requirements

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
