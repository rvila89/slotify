# Spec Delta — Capability `comunicaciones` (MODIFICADA)

> E4 pasa a llevar **solo** la factura de liquidación (se retira el adjunto del recibo de fianza y
> su envío separado como `manual`), con el texto bilingüe CA/ES nuevo. Se **añade** una plantilla
> nueva "fianza devuelta" (CA/ES, activa) disparada post-commit best-effort al registrar la
> devolución. Se **eliminan** E5 (solicitud de IBAN) y E8 (confirmación de IBAN registrado), junto
> con la captura de IBAN. Fuente: plan `fix-liquidacion-fianza-independientes`; US-028, US-034,
> US-035, US-036; `er-diagram.md §3.16 COMUNICACION`, `§CLIENTE iban_devolucion`.

## ADDED Requirements

### Requirement: Plantilla y disparo del email de fianza devuelta (CA/ES, activa)

El sistema SHALL (DEBE) registrar en el catálogo de plantillas una plantilla **nueva "fianza
devuelta"**, **activa** (con render real) y **bilingüe** (CA/ES), seleccionada por el `idioma` de la
RESERVA, con variables requeridas `['nombre', 'fianzaEur']`. Al registrar la devolución completa de
la fianza (capability `facturacion`), el sistema DEBE disparar este email al `CLIENTE.email` como
efecto **posterior al commit** y **best-effort** (patrón `disparar-e8.adapter.ts`, invertido respecto
a la atomicidad de E4): un fallo del proveedor **no revierte** el registro de la devolución. El
sistema DEBE registrar el resultado en `COMUNICACION` con `codigo_email` del email de fianza devuelta,
`reserva_id`, `cliente_id`, `tenant_id`, `estado ∈ {enviado, fallido}` y `fecha_envio`. El Gestor DEBE
poder **reintentar** el envío desde la ficha si quedó `fallido`. El cuerpo CA/ES es el aprobado en el
plan (§Email copy — "fianza devuelta"), con `{nombre}` y `{fianzaEur}` como variables. (Fuente: plan
§Devolución simplificada, §Email copy; patrón post-commit best-effort `US-035 disparar-e8`; US-045
§Catálogo de plantillas.)

#### Scenario: Registrar la devolución dispara el email de fianza devuelta en el idioma de la reserva

- **GIVEN** una RESERVA con `idioma = 'ca'` cuya devolución de fianza se acaba de registrar
  (`fianza_status = 'devuelta'`, commit realizado) con `fianza_eur = 500.00`
- **WHEN** el sistema dispara el email de fianza devuelta
- **THEN** se renderiza la plantilla CA con `{nombre}` y `{fianzaEur}` sustituidos
- **AND** se crea `COMUNICACION` con el `codigo_email` del email de fianza devuelta, `estado =
  'enviado'`, `fecha_envio` no nulo, `reserva_id`, `cliente_id` y `tenant_id` correctos

#### Scenario: El fallo del proveedor deja la comunicación en fallido sin revertir la devolución

- **GIVEN** una devolución de fianza ya registrada (`fianza_status = 'devuelta'`) cuyo email de
  confirmación falla en el proveedor
- **WHEN** el motor procesa el resultado del envío
- **THEN** la `COMUNICACION` queda en `estado = 'fallido'` y la RESERVA permanece en `fianza_status =
  'devuelta'`
- **AND** el Gestor puede reintentar el envío desde la ficha

## MODIFIED Requirements

### Requirement: Cableado de E4 con los PDFs de liquidación y fianza adjuntos

El sistema SHALL (DEBE), al aprobar y enviar la factura de liquidación (flujo standalone espejo de la
señal), disparar el envío del email **E4** al `CLIENTE.email` de la RESERVA, adjuntando **por
referencia** el PDF de la **factura de liquidación** (`FACTURA(liquidacion).pdf_url`), reutilizando el
**motor de email de US-045** y su **interfaz de adjuntos**. **E4 = solo liquidación**: no adjunta
ningún recibo de fianza (la fianza deja de ser una FACTURA). El cuerpo de E4 es el **texto bilingüe
CA/ES nuevo** aprobado en el plan (§Email copy — "E4 Liquidación"), seleccionado por el `idioma` de la
RESERVA, con variables requeridas `['nombre', 'fianzaEur']` (recuerda al cliente abonar la fianza de
`{fianzaEur}` € antes o el día del evento). Antes de enviar, el motor DEBE verificar que el `pdf_url`
de la liquidación está disponible; si no lo está, NO DEBE enviar E4. El sistema DEBE registrar el
resultado en `COMUNICACION` con `codigo_email = 'E4'`, `estado = 'enviado'`, `fecha_envio = now()`,
`reserva_id` = la RESERVA, `cliente_id` = el CLIENTE de esa RESERVA y el `tenant_id` correspondiente,
y registrar la operación en `AUDIT_LOG`. (Fuente: plan §Liquidación standalone, §Email copy; US-045
§Catálogo de plantillas E4, §Interfaz de adjuntos.)

#### Scenario: Aprobar y enviar dispara E4 con solo el PDF de la liquidación y registra la comunicación

- **GIVEN** una emisión de liquidación cuya `FACTURA(liquidacion).pdf_url` está disponible y
  `CLIENTE.email` no es nulo
- **WHEN** el sistema envía E4
- **THEN** el motor adjunta únicamente el PDF de la factura de liquidación al email al `CLIENTE.email`
  (sin ningún recibo de fianza)
- **AND** se crea `COMUNICACION` con `codigo_email = 'E4'`, `estado = 'enviado'`, `fecha_envio` no
  nulo, `reserva_id`, `cliente_id` y `tenant_id` correctos
- **AND** se registra la operación en `AUDIT_LOG`

#### Scenario: El PDF de la liquidación ausente bloquea el envío de E4

- **GIVEN** una emisión de liquidación en la que el `pdf_url` de la factura de liquidación es nulo
- **WHEN** el motor intenta enviar E4
- **THEN** no envía E4 y registra el error (interfaz de adjuntos de US-045)
- **AND** la emisión no se consolida (los estados no cambian; ver delta `facturacion`)

### Requirement: E4 es un envío síncrono y confirmado cuya atomicidad condiciona la emisión

El sistema SHALL (DEBE) disparar E4 de forma **síncrona y esperando la confirmación del proveedor**,
de modo que la consolidación de la emisión de la factura de liquidación (asignación de
`numero_factura`, `estado = 'enviada'`, `liquidacion_status = 'facturada'`) ocurra **solo si E4 se
confirma**. E4 = solo liquidación: **no** emite ni toca la fianza. Este disparo **invierte
deliberadamente** el patrón "post-commit, fallo no revierte" de E2/E6/E7 (US-045): en E4, un fallo del
proveedor o de la generación del PDF **impide** consolidar los cambios de estado (rollback), y el
resultado del envío queda **trazado en `COMUNICACION`** para el reintento del Gestor. En entornos
`test`/CI el transporte DEBE operar en **modo fake** (confirmación simulada, sin llamadas de red
reales). (Fuente: plan §Liquidación standalone; `US-028 §Reglas de negocio` atomicidad; US-045
§Transporte real / modo sandbox.)

#### Scenario: Un fallo de E4 no consolida la emisión y queda trazado

- **GIVEN** una emisión de liquidación en curso cuyo envío de E4 falla en el proveedor
- **WHEN** el motor procesa el resultado
- **THEN** los cambios de estado de la emisión no se consolidan (rollback; ver delta `facturacion`)
- **AND** el resultado del envío queda trazado en `COMUNICACION` (con un `estado` distinto de
  `'enviado'`) para el reintento del Gestor

#### Scenario: En test/CI E4 no envía correos reales

- **GIVEN** el entorno de test o CI con el transporte de email en modo fake
- **WHEN** una emisión de liquidación dispara E4
- **THEN** no se realiza ninguna llamada de red al proveedor externo
- **AND** el disparo de E4 y su registro en `COMUNICACION` quedan verificables para las aserciones de
  los tests

## REMOVED Requirements

### Requirement: Envío del recibo de fianza por separado como email manual sin código E

**Motivo:** desaparece el recibo de fianza. Ya no hay ningún envío separado del recibo al cliente ni
su registro como `COMUNICACION codigo_email = 'manual'` asociado a la fianza.

### Requirement: E5 (solicitud de IBAN) se dispara al finalizar el evento solo si fianza_eur > 0

**Motivo:** se elimina la captura de IBAN al cliente. El email E5 (agradecimiento + solicitud de
IBAN) se retira; la finalización del evento deja de disparar E5.

### Requirement: fianza_eur IS NULL se trata como sin fianza y alerta de dato anómalo

**Motivo:** ligado al disparo condicional de E5, que se elimina.

### Requirement: La transición no depende del éxito de E5 — fallo deja COMUNICACION fallido y reintento

**Motivo:** ligado a E5, que se elimina.

### Requirement: El gestor registra el IBAN de devolución sobre CLIENTE con validación mod-97 previa

**Motivo:** se elimina la captura de IBAN (`CLIENTE.iban_devolucion`). La devolución se registra sin
IBAN. **Migración:** eliminar `CLIENTE.iban_devolucion`.

### Requirement: El registro de un IBAN válido dispara el email E8 al CLIENTE reutilizando el motor de comunicaciones

**Motivo:** se elimina el email E8 (confirmación de IBAN registrado) junto con la captura de IBAN.

### Requirement: El guardado del IBAN y el envío de E8 son operaciones separadas — un fallo de E8 no revierte el IBAN

**Motivo:** ligado a E8 y a la captura de IBAN, que se eliminan.

### Requirement: El registro de IBAN se rechaza sin fianza cobrada o fuera de post_evento

**Motivo:** ligado a la captura de IBAN, que se elimina.

### Requirement: Cada corrección del IBAN reenvía E8 como excepción auditada a la idempotencia

**Motivo:** ligado a E8 y a la captura de IBAN, que se eliminan.
