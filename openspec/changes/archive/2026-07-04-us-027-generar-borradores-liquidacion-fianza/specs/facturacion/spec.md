# Spec Delta — Capability `facturacion` (MODIFICADA)

> US-027 **extiende** la capability `facturacion` (creada en US-022) a los tipos
> `liquidacion` y `fianza`: al activarse los sub-procesos paralelos de liquidación y fianza
> de una RESERVA que ha transitado a `reserva_confirmada` (US-021), el sistema genera **dos
> documentos de cobro en borrador** —la **factura de liquidación** (`total = importe_liquidacion
> + Σ extras pendientes`) y el **recibo de fianza** (`total = fianza_default_eur`)—, aplica el
> desglose fiscal ya definido (base derivada del total, IVA 21 %, redondeo contable), difiere la
> numeración `F-YYYY-NNNN` a la emisión (`numero_factura = NULL` en borrador), garantiza la
> idempotencia por `(reserva_id, tipo)` (constraint UK ya migrado en US-022), omite el recibo de
> fianza si `fianza_default_eur = 0`, alerta al Gestor y audita la creación. NO asigna
> `numero_factura`, NO envía email (E4 es US-028) y NO marca los `RESERVA_EXTRA` con `factura_id`
> (eso ocurre al emitir, US-028). El disparo desde la activación de sub-procesos se especifica en
> el delta de la capability `confirmacion`.
> Fuente: US-027, UC-21 (pasos 1–2), UC-22 (pasos 1–2), A7; `er-diagram.md §3.12 FACTURA`,
> `§3.10 RESERVA_EXTRA`, `§TENANT_SETTINGS fianza_default_eur`,
> `§RESERVA importe_liquidacion/liquidacion_status/fianza_status`.

## ADDED Requirements

### Requirement: Generación automática de la factura de liquidación en borrador al activar los sub-procesos

El sistema SHALL (DEBE), como efecto **posterior al commit** de la transición de la RESERVA a
`reserva_confirmada` y de la activación de sus sub-procesos (US-021), cuando `RESERVA.estado =
'reserva_confirmada'` Y `RESERVA.liquidacion_status = 'pendiente'`, crear **una** FACTURA con
`tipo = 'liquidacion'`, `estado = 'borrador'`, `reserva_id` de la RESERVA, `tenant_id` correcto,
`numero_factura = NULL` y `total = RESERVA.importe_liquidacion + Σ(RESERVA_EXTRA.subtotal WHERE
factura_id IS NULL)` de esa reserva. `RESERVA.importe_liquidacion` viene **congelado** de US-021
(`importe_total − importe_senal`, 60 % MVP): el sistema NO recalcula el porcentaje ni la tarifa,
y **suma** los `subtotal` ya congelados por línea sin recalcularlos. El sistema NO marca los
`RESERVA_EXTRA` con `factura_id` en la fase de borrador (ese marcado ocurre al emitir, US-028).
El fallo de esta generación NO revierte la confirmación ya realizada. (Fuente: `US-027 §Historia`,
`§Happy Path`, `§Reglas de negocio`, `§Reglas de Validación`; UC-21; `er-diagram.md §3.12 FACTURA`,
`§3.10 RESERVA_EXTRA`.)

#### Scenario: Liquidación con extras pendientes suma el 60 % y los extras con factura_id nulo

- **GIVEN** una RESERVA que ha transitado a `reserva_confirmada` con `importe_liquidacion =
  3.600,00 €` y dos `RESERVA_EXTRA` con `factura_id IS NULL` de subtotales `300,00 €` y `200,00 €`
- **WHEN** el sistema genera la factura de liquidación al activar los sub-procesos
- **THEN** se crea una FACTURA con `tipo = 'liquidacion'`, `estado = 'borrador'`, `numero_factura
  = NULL`, `total = 4.100,00 €`, `reserva_id` de la RESERVA y `tenant_id` correcto

#### Scenario: Liquidación sin extras pendientes es solo el 60 %

- **GIVEN** una RESERVA `reserva_confirmada` con `importe_liquidacion = 3.600,00 €` sin ningún
  `RESERVA_EXTRA` con `factura_id IS NULL`
- **WHEN** el sistema genera la factura de liquidación
- **THEN** la FACTURA de liquidación tiene `total = 3.600,00 €` (solo el 60 % sin extras)

### Requirement: Desglose fiscal de la factura de liquidación con IVA 21 % y redondeo contable

El sistema SHALL (DEBE) calcular el desglose fiscal de la factura de liquidación derivando la base
del total, con el **mismo criterio** que la factura de señal (US-022): `iva_porcentaje = 21,00`;
`base_imponible = round(total / 1,21, 2)`; `iva_importe = total − base_imponible`. El redondeo es
**contable a 2 decimales (mitad hacia arriba)** y el `iva_importe` se obtiene **por resta** del
total, de modo que `base_imponible + iva_importe = total` **exactamente**. El cálculo del desglose
es lógica de **dominio puro** y **reutiliza** la función ya existente de `facturacion`. (Fuente:
`US-027 §Happy Path` `base = (3.600 + 500) / 1,21 ≈ 3.388,43`, `iva ≈ 711,57`, `§Reglas de
Validación` IVA 21 %; `er-diagram.md §3.12` base/iva derivados.)

#### Scenario: 4.100 € de total desglosa 3.388,43 base + 711,57 IVA

- **GIVEN** una factura de liquidación con `total = 4.100,00 €`
- **WHEN** el sistema calcula el desglose fiscal
- **THEN** `iva_porcentaje = 21,00`, `base_imponible = 3.388,43 €`, `iva_importe = 711,57 €`
- **AND** `base_imponible + iva_importe = total` exactamente

### Requirement: Generación automática del recibo de fianza en borrador

El sistema SHALL (DEBE), al activar los sub-procesos de una RESERVA `reserva_confirmada` con
`fianza_status = 'pendiente'` y `TENANT_SETTINGS.fianza_default_eur > 0`, crear **una** FACTURA
con `tipo = 'fianza'`, `estado = 'borrador'`, `reserva_id`, `tenant_id`, `numero_factura = NULL`
y `total = TENANT_SETTINGS.fianza_default_eur`. La generación del recibo de fianza es
**independiente** de la de la factura de liquidación: la ausencia de una no impide la otra.
(Fuente: `US-027 §Happy Path`, `§Reglas de negocio`; `er-diagram.md §TENANT_SETTINGS
fianza_default_eur`.)

#### Scenario: Recibo de fianza en borrador por el importe por defecto del tenant

- **GIVEN** una RESERVA `reserva_confirmada` con `fianza_status = 'pendiente'` y
  `TENANT_SETTINGS.fianza_default_eur = 1.000,00 €`
- **WHEN** el sistema activa los sub-procesos
- **THEN** se crea una FACTURA con `tipo = 'fianza'`, `estado = 'borrador'`, `numero_factura =
  NULL` y `total = 1.000,00 €`

### Requirement: Omisión del recibo de fianza cuando el importe por defecto es cero

El sistema SHALL (DEBE), si `TENANT_SETTINGS.fianza_default_eur = 0`, **NO generar** la FACTURA
de tipo `fianza`; `RESERVA.fianza_status` **permanece `pendiente`** (no se marca como facturado
ni se crea documento) y la alerta al Gestor menciona **solo** la factura de liquidación. El
Gestor podrá generar el recibo manualmente con un importe negociado en una US posterior. La
factura de liquidación se genera igualmente. (Fuente: `US-027 §TENANT_SETTINGS.fianza_default_eur
= 0`.)

#### Scenario: Fianza por defecto cero no genera recibo y deja fianza_status pendiente

- **GIVEN** una RESERVA `reserva_confirmada` con `TENANT_SETTINGS.fianza_default_eur = 0`
- **WHEN** el sistema activa los sub-procesos
- **THEN** NO se crea ninguna FACTURA de tipo `fianza`
- **AND** `RESERVA.fianza_status` permanece `pendiente` y la alerta al Gestor menciona solo la
  factura de liquidación

### Requirement: Numeración diferida a la emisión — numero_factura nulo en borrador

El sistema SHALL (DEBE) crear los borradores de liquidación y de fianza con `numero_factura =
NULL`. La asignación del `numero_factura` con formato `F-YYYY-NNNN` (secuencial y único por
`tenant_id` + año) se produce **solo al emitir/enviar** el documento (US-028), reutilizando la
numeración ya definida en `facturacion` (US-022). En borrador, la ausencia de `numero_factura`
NO viola la unicidad `UNIQUE(tenant_id, numero_factura)`, que solo aplica a valores no nulos.
(Fuente: `US-027 §Reglas de negocio` `numero_factura` no se asigna en borrador, `§Reglas de
Validación`.)

#### Scenario: Los borradores de liquidación y fianza no llevan número de factura

- **GIVEN** una RESERVA `reserva_confirmada` para la que se generan los borradores de liquidación
  y fianza
- **WHEN** el sistema crea ambas FACTURA en `borrador`
- **THEN** ambas tienen `numero_factura = NULL` y solo recibirán `F-YYYY-NNNN` al emitirse (US-028)

### Requirement: Idempotencia — una única liquidación y un único recibo de fianza por reserva

El sistema SHALL (DEBE) garantizar que exista **como máximo una** FACTURA con `tipo =
'liquidacion'` y **como máximo una** con `tipo = 'fianza'` por `reserva_id` en estado `borrador`
o `enviada`. Antes de crear cada documento, el sistema comprueba si ya existe una FACTURA con ese
`reserva_id` y ese `tipo`; si existe, **NO crea un duplicado** (operación idempotente, sin efecto
secundario). La unicidad la refuerza en BD la restricción `UNIQUE(reserva_id, tipo)` ya
introducida en US-022 (cubre `senal`, `liquidacion` y `fianza`): una reinvocación concurrente del
trigger que sortee la guarda aborta por `P2002` y recupera la existente. (Fuente: `US-027
§Idempotencia — trigger duplicado`, `§Reglas de Validación`.)

#### Scenario: Reinvocación del trigger no duplica los borradores de liquidación ni de fianza

- **GIVEN** una RESERVA que ya tiene una FACTURA `tipo = 'liquidacion'` y una `tipo = 'fianza'`
  en `borrador`
- **WHEN** el trigger de activación de sub-procesos se ejecuta de nuevo para esa RESERVA
- **THEN** el sistema detecta los borradores existentes y **no** crea documentos duplicados
- **AND** la operación no tiene efecto secundario (idempotente)

### Requirement: Alerta al Gestor de documentos pendientes de revisión

El sistema SHALL (DEBE), tras generar los borradores, alertar al Gestor en la UI con el texto
"Documentos de liquidación y fianza pendientes de revisión". Si el recibo de fianza se omitió
por `fianza_default_eur = 0`, la alerta menciona **solo** la factura de liquidación. La alerta es
una señal de UI (no un email: E4 se dispara en US-028 tras la aprobación del Gestor). (Fuente:
`US-027 §Happy Path`, `§TENANT_SETTINGS.fianza_default_eur = 0`, `§Email relacionado`.)

#### Scenario: Con liquidación y fianza generadas, la alerta cita ambos documentos

- **GIVEN** una RESERVA para la que se han generado el borrador de liquidación y el de fianza
- **WHEN** el sistema completa la generación
- **THEN** el Gestor recibe la alerta "Documentos de liquidación y fianza pendientes de revisión"

#### Scenario: Con la fianza omitida, la alerta cita solo la liquidación

- **GIVEN** una RESERVA con `fianza_default_eur = 0` para la que solo se generó el borrador de
  liquidación
- **WHEN** el sistema completa la generación
- **THEN** la alerta al Gestor menciona solo la factura de liquidación

### Requirement: Auditoría de la creación de los borradores de liquidación y fianza

El sistema SHALL (DEBE) registrar en `AUDIT_LOG` una entrada con `accion = 'crear'`, `entidad =
'FACTURA'` y el `entidad_id` de la factura creada por **cada** documento generado (liquidación y,
si procede, fianza). Si el recibo de fianza se omitió (`fianza_default_eur = 0`), solo se registra
la creación de la liquidación. (Fuente: `US-027 §Happy Path` "ambas acciones quedan registradas en
AUDIT_LOG con accion = crear".)

#### Scenario: Crear cada borrador registra un AUDIT_LOG de creación

- **GIVEN** una RESERVA para la que se generan los borradores de liquidación y fianza
- **WHEN** el sistema crea ambas FACTURA
- **THEN** `AUDIT_LOG` registra dos entradas con `accion = 'crear'`, `entidad = 'FACTURA'`, cada
  una con el `entidad_id` de la factura correspondiente
