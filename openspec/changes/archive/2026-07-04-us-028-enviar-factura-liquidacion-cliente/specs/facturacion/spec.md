# Spec Delta — Capability `facturacion` (MODIFICADA)

> US-028 **extiende** la capability `facturacion` (US-022 + US-027): el Gestor **aprueba y
> emite** la factura de liquidación en `borrador` (generada por US-027) y la **envía al
> cliente** junto con el recibo de fianza en un único email E4. La emisión asigna el
> `numero_factura` `F-YYYY-NNNN` **en el momento de emisión** (reutilizando la numeración de
> US-022), pasa la FACTURA a `enviada`, fija `fecha_emision`, marca los `RESERVA_EXTRA` con el
> `factura_id` (cierre del vínculo diferido de US-027), transiciona
> `RESERVA.liquidacion_status: pendiente → facturada` y `RESERVA.fianza_status: pendiente →
> recibo_enviado`, todo con **atomicidad estado↔email E4** (si E4 falla, rollback total). El
> Gestor puede **ajustar** el borrador con un descuento negociado antes de aprobar (total y
> desglose recalculados, `importe_liquidacion` actualizado, descuento en AUDIT_LOG). Cubre el
> **envío separado del recibo de fianza** y el **reenvío** de una factura ya emitida. El
> cableado del email E4 y su registro en `COMUNICACION` se especifica en el delta de la
> capability `comunicaciones`.
> Fuente: US-028, UC-21 (pasos 3–6), UC-22 (pasos 3–4), E4; `er-diagram.md §3.12 FACTURA`,
> `§3.10 RESERVA_EXTRA`, `§RESERVA liquidacion_status/fianza_status/importe_liquidacion`.

## ADDED Requirements

### Requirement: Emisión de la factura de liquidación al aprobar y enviar (borrador → enviada con número asignado)

El sistema SHALL (DEBE), cuando el Gestor pulsa "Aprobar y enviar" sobre una FACTURA con `tipo =
'liquidacion'` en `estado = 'borrador'` y `RESERVA.liquidacion_status = 'pendiente'`, **emitir**
la factura: asignar `numero_factura` con formato `F-YYYY-NNNN` (secuencial y único por
`tenant_id` + año, **reutilizando la numeración de US-022** con `UNIQUE(tenant_id,
numero_factura)` + reintento aplicativo ante `P2002`, **nunca** locks distribuidos) **en el
momento de la emisión** (nunca en borrador), fijar `fecha_emision` con el timestamp actual,
pasar `FACTURA.estado = 'enviada'`, marcar los `RESERVA_EXTRA` de la reserva que se sumaron al
borrador con el `factura_id` de la liquidación emitida, y transicionar `RESERVA.liquidacion_status
= 'facturada'`. Todo ello ocurre solo si el envío del email E4 se confirma (ver atomicidad). El
sistema DEBE registrar `AUDIT_LOG` con `accion = 'actualizar'`, `datos_anteriores.estado =
'borrador'` y `datos_nuevos.estado = 'enviada'`. (Fuente: `US-028 §Happy Path`, `§Reglas de
negocio`, `§Reglas de Validación`; UC-21 pasos 3–6; `er-diagram.md §3.12 FACTURA`, `§3.10
RESERVA_EXTRA`.)

#### Scenario: Aprobar y enviar emite la liquidación con número y la deja enviada

- **GIVEN** una FACTURA `tipo = 'liquidacion'` en `estado = 'borrador'` con `numero_factura =
  NULL`, PDF disponible y datos fiscales válidos, y `RESERVA.liquidacion_status = 'pendiente'`
- **WHEN** el Gestor pulsa "Aprobar y enviar" y el envío de E4 se confirma
- **THEN** `FACTURA.estado = 'enviada'`, `numero_factura = 'F-{año}-NNNN'` (secuencial, único
  por `tenant_id` + año), `fecha_emision` con el timestamp actual
- **AND** `RESERVA.liquidacion_status = 'facturada'` y los `RESERVA_EXTRA` sumados al borrador
  quedan marcados con el `factura_id` de la liquidación
- **AND** `AUDIT_LOG` registra `accion = 'actualizar'` con `datos_anteriores.estado = 'borrador'`
  y `datos_nuevos.estado = 'enviada'`

#### Scenario: El número de factura se asigna solo en la emisión, nunca en borrador

- **GIVEN** una FACTURA `tipo = 'liquidacion'` en `borrador` con `numero_factura = NULL`
- **WHEN** el Gestor todavía no ha aprobado
- **THEN** `numero_factura` permanece `NULL`
- **AND** solo al emitir (aprobar y enviar con E4 confirmado) recibe su `F-{año}-NNNN`

### Requirement: Atomicidad entre la transición de estado y el envío de E4 (rollback ante fallo)

El sistema SHALL (DEBE) hacer **atómicos** la transición de estado de la emisión y el envío del
email E4: la asignación de `numero_factura`, `FACTURA (liquidacion).estado = 'enviada'`,
`RESERVA.liquidacion_status = 'facturada'`, el marcado de los `RESERVA_EXTRA`, la emisión del
recibo de fianza (`FACTURA (fianza).estado = 'enviada'`, `RESERVA.fianza_status =
'recibo_enviado'`) y el registro de `COMUNICACION` E4 se consolidan **solo si el envío de E4 se
confirma**. Si la **generación del PDF** de cualquiera de los adjuntos o el **envío de E4**
falla, el sistema DEBE hacer **rollback** de todos los cambios de estado: ambas FACTURA
**permanecen en `borrador`**, `numero_factura` **NO se asigna** (permanece `NULL`),
`RESERVA.liquidacion_status` permanece `pendiente`, los `RESERVA_EXTRA` **no** se marcan; el
sistema muestra un **error recuperable** y el Gestor puede **reintentar**. Esta atomicidad
**invierte** deliberadamente el patrón "post-commit, fallo no revierte" de E2/E6/E7 (US-045),
porque US-028 exige que si E4 falla los estados no cambien. (Fuente: `US-028 §Reglas de negocio`
atomicidad, `§Fallo en la generación del PDF o en el envío del email`, `§Reglas de Validación`;
`design.md §D-1`.)

#### Scenario: Fallo del PDF o del email deja todo en borrador y permite reintento

- **GIVEN** una FACTURA `tipo = 'liquidacion'` en `borrador` y una `tipo = 'fianza'` en
  `borrador`, con `RESERVA.liquidacion_status = 'pendiente'`
- **WHEN** el Gestor pulsa "Aprobar y enviar" pero la generación del PDF del adjunto o el envío
  de E4 falla
- **THEN** ambas FACTURA permanecen en `estado = 'borrador'` con `numero_factura = NULL`
- **AND** `RESERVA.liquidacion_status` permanece `pendiente` y los `RESERVA_EXTRA` siguen sin
  `factura_id`
- **AND** el sistema muestra un error recuperable y el Gestor puede reintentar

#### Scenario: Solo con E4 confirmado se consolidan los cambios de estado

- **GIVEN** una emisión de liquidación en curso cuyo envío de E4 aún no se ha confirmado
- **WHEN** el proveedor de email confirma el envío de E4
- **THEN** se consolidan `estado = 'enviada'`, `numero_factura`, `liquidacion_status =
  'facturada'`, la emisión de la fianza y el `COMUNICACION` E4
- **AND** si el proveedor no confirma, no se consolida ninguno de esos cambios

### Requirement: Ajuste del importe (descuento negociado) antes de aprobar

El sistema SHALL (DEBE) permitir al Gestor **ajustar** el borrador de la factura de liquidación
(aplicar un descuento negociado o corregir extras) **mientras la FACTURA sigue en `borrador`**.
Al aplicar el ajuste, el sistema **recalcula el `total`** y su **desglose fiscal reutilizando la
función de dominio puro ya existente de `facturacion`** (US-022: `base_imponible = round(total /
1,21, 2)`, `iva_importe = total − base_imponible`, `iva_porcentaje = 21,00`, con `base + iva =
total` exacto). Al emitir con el ajuste, `RESERVA.importe_liquidacion` se **actualiza** con el
nuevo importe y el **descuento** (importe/motivo) queda registrado en `AUDIT_LOG`. El ajuste es
**manual del Gestor**: el sistema NO recalcula tarifa ni porcentaje. (Fuente: `US-028 §Gestor
ajusta el importe antes de aprobar`; `design.md §D-2`.)

#### Scenario: Un descuento de 200 € emite la factura por 3.900 € con desglose recalculado

- **GIVEN** un borrador de liquidación con `total = 4.100,00 €` y el Gestor aplica un descuento
  de 200,00 €
- **WHEN** el Gestor modifica el descuento y pulsa "Aprobar y enviar"
- **THEN** la FACTURA se emite con `total = 3.900,00 €`, `base_imponible = 3.223,14 €`,
  `iva_importe = 676,86 €` (`base + iva = total` exacto)
- **AND** `RESERVA.importe_liquidacion` se actualiza a 3.900,00 € y el descuento queda en
  `AUDIT_LOG`

### Requirement: Emisión del recibo de fianza como efecto del envío de E4

El sistema SHALL (DEBE), como **efecto del envío de E4** (que adjunta el recibo de fianza junto
con la factura de liquidación), emitir el recibo de fianza en la **misma operación atómica**:
`FACTURA (fianza).estado = 'enviada'` y `RESERVA.fianza_status = 'recibo_enviado'`. Si el recibo
de fianza ya fue enviado por separado previamente (ver requisito de envío separado), E4 **no**
vuelve a cambiar `fianza_status` ni el estado de la fianza (ya `enviada`/`recibo_enviado`), y su
adjunto en E4 puede omitirse. (Fuente: `US-028 §Happy Path`, `§Envío del recibo de fianza por
separado`; `design.md §D-3`.)

#### Scenario: Aprobar y enviar deja el recibo de fianza enviado

- **GIVEN** una emisión de liquidación cuyo envío de E4 se confirma, con la FACTURA `tipo =
  'fianza'` en `borrador` y `RESERVA.fianza_status = 'pendiente'`
- **WHEN** se consolida la emisión (E4 confirmado)
- **THEN** `FACTURA (fianza).estado = 'enviada'` y `RESERVA.fianza_status = 'recibo_enviado'`

#### Scenario: Fianza ya enviada por separado no se re-emite con E4

- **GIVEN** una RESERVA con `fianza_status = 'recibo_enviado'` (recibo ya enviado por separado)
- **WHEN** el Gestor aprueba y envía la liquidación (E4)
- **THEN** `fianza_status` permanece `recibo_enviado` y el estado de la fianza no cambia
- **AND** E4 incluye solo la factura de liquidación

### Requirement: Envío del recibo de fianza por separado (sin la liquidación)

El sistema SHALL (DEBE) permitir al Gestor enviar el **recibo de fianza por separado** desde la
ficha de la reserva, con solo el recibo de fianza adjunto. Al hacerlo, `FACTURA (fianza).estado
= 'enviada'` y `RESERVA.fianza_status = 'recibo_enviado'`; `RESERVA.liquidacion_status` **no
cambia**. Este envío se trata como **email manual SIN código E** (no usa E4); su registro en
`COMUNICACION` usa `codigo_email = 'manual'` (ver delta de `comunicaciones`). (Fuente: `US-028
§Envío del recibo de fianza por separado`; `design.md §D-3`.)

#### Scenario: El envío separado marca la fianza sin tocar la liquidación

- **GIVEN** una RESERVA con `fianza_status = 'pendiente'` y `liquidacion_status = 'pendiente'`,
  con el recibo de fianza en `borrador`
- **WHEN** el Gestor selecciona "Enviar recibo de fianza por separado"
- **THEN** `FACTURA (fianza).estado = 'enviada'` y `RESERVA.fianza_status = 'recibo_enviado'`
- **AND** `RESERVA.liquidacion_status` permanece `pendiente` (la liquidación no se ve afectada)

### Requirement: Reenvío de la factura de liquidación ya emitida sin reasignar número ni estado

El sistema SHALL (DEBE), cuando `FACTURA (liquidacion).estado = 'enviada'` y el Gestor pulsa
"Reenviar factura de liquidación", **reenviar el PDF ya emitido** al email del cliente **sin
modificar** el `numero_factura` ni el `estado` de la factura y **sin** cambiar los status de la
RESERVA. Cada reenvío crea un **nuevo** registro `COMUNICACION` con `codigo_email = 'E4'` (ver
delta de `comunicaciones`). (Fuente: `US-028 §Factura ya enviada (reenvío)`; `design.md §D-4`.)

#### Scenario: El reenvío no reasigna ni modifica la factura emitida

- **GIVEN** una FACTURA `tipo = 'liquidacion'` en `estado = 'enviada'` con `numero_factura =
  'F-{año}-NNNN'`
- **WHEN** el Gestor pulsa "Reenviar factura de liquidación"
- **THEN** el sistema reenvía el PDF ya emitido al email del cliente
- **AND** `numero_factura` y `estado` permanecen sin cambios y no se modifican los status de la
  reserva

### Requirement: Solo se puede aprobar y enviar desde borrador; el estado facturada no retrocede

El sistema SHALL (DEBE) permitir la acción "Aprobar y enviar" **solo si** `FACTURA
(liquidacion).estado = 'borrador'`. Si la factura ya está `enviada`, el sistema DEBE **rechazar**
una nueva aprobación (la vía disponible es el reenvío, que no reasigna nada). El sistema NO DEBE
permitir el retroceso de `RESERVA.liquidacion_status` de `facturada` a `pendiente` (no modelado
en MVP). (Fuente: `US-028 §Reglas de Validación`.)

#### Scenario: No se puede aprobar una factura que ya está enviada

- **GIVEN** una FACTURA `tipo = 'liquidacion'` en `estado = 'enviada'`
- **WHEN** el Gestor intenta "Aprobar y enviar" de nuevo
- **THEN** el sistema rechaza la acción indicando que ya está emitida
- **AND** no reasigna `numero_factura` ni cambia el estado

#### Scenario: liquidacion_status no retrocede de facturada a pendiente

- **GIVEN** una RESERVA con `liquidacion_status = 'facturada'`
- **WHEN** ocurre cualquier flujo del sistema en el MVP
- **THEN** `liquidacion_status` no retrocede a `pendiente` (no hay transición inversa modelada)
