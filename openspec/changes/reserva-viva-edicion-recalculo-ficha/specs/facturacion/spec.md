# Spec Delta — Capability `facturacion`

> **reserva-viva-edicion-recalculo-ficha** — El recálculo dentro de la ventana viva re-congela
> los importes de la RESERVA (`importe_total`, `importe_liquidacion`) SIN tocar `importe_senal`,
> y regenera el borrador de la FACTURA de liquidación con el nuevo importe, incluso si ya estaba
> `enviada` (mientras no `cobrada`). Reutiliza `calcularTotalLiquidacion` y el desglose fiscal de
> US-022/US-027; NO recalcula la fianza. Es idempotente y transaccional.
>
> Fuente: petición de usuario; `US-021 §Reglas de negocio` congelado 40/60;
> `US-027`/`US-028`/`US-029` borrador de liquidación, envío y cobro; `confirmar-pago-senal.
> use-case.ts §congelarImportes`; `generar-borradores-liquidacion-fianza.use-case.ts`;
> `calculo-total-liquidacion.ts`; memoria del proyecto "importe_total nunca escrito".

## ADDED Requirements

### Requirement: Recálculo en cascada del importe congelado y regeneración del borrador de liquidación

El sistema SHALL (DEBE), al recalcular el precio de una RESERVA dentro de la ventana viva (ver
delta `reserva-viva`), en la MISMA transacción y bajo el contexto RLS del tenant:
(1) **re-congelar** en la RESERVA `importe_total = nuevo_total` e `importe_liquidacion =
nuevo_total − importe_senal`, **sin modificar `importe_senal`** (la señal ya cobrada es un
importe fijo); (2) **regenerar el borrador de la FACTURA de liquidación** (`tipo='liquidacion'`)
de la reserva con el nuevo importe = `importe_liquidacion` re-congelado + Σ(subtotales de
RESERVA_EXTRA vigentes `factura_id IS NULL`), reutilizando `calcularTotalLiquidacion` y el
desglose fiscal por régimen (base derivada, IVA por resta). La regeneración DEBE ocurrir
**incluso si la FACTURA de liquidación ya está `enviada`** (se reescribe su importe/desglose),
y NO DEBE ocurrir si la FACTURA de liquidación ya está `cobrada` (en ese caso la RESERVA no está
en la ventana viva: la guarda ya lo rechaza aguas arriba). La **fianza NO se regenera** (no
depende del total). La operación es **idempotente**: aplicada dos veces con el mismo nuevo aforo/
duración produce el mismo estado final y no duplica facturas ni entradas de AUDIT_LOG
redundantes. Cada mutación se registra en `AUDIT_LOG`. (Fuente: petición de usuario; `US-021`
congelado; `US-027` borrador de liquidación; `US-029` cobro; `calculo-total-liquidacion.ts`;
`generar-borradores-liquidacion-fianza.use-case.ts`.)

#### Scenario: Recalcular re-congela total y liquidación sin tocar la señal

- **GIVEN** una RESERVA en la ventana viva con `importe_total = 3000,00`, `importe_senal =
  1200,00`, `importe_liquidacion = 1800,00` y un borrador de liquidación en `borrador`
- **WHEN** el recálculo produce un nuevo total de `3600,00`
- **THEN** el sistema fija `RESERVA.importe_total = 3600,00` e `importe_liquidacion = 2400,00`
- **AND** `RESERVA.importe_senal` permanece `1200,00`
- **AND** regenera el borrador de liquidación con importe `2400,00` (+ extras vigentes)

#### Scenario: Se regenera la liquidación aunque ya estuviera enviada

- **GIVEN** una RESERVA en la ventana viva con `liquidacion_status != 'cobrada'` y su FACTURA de
  liquidación en estado `enviada`
- **WHEN** el recálculo produce un nuevo total
- **THEN** el sistema reescribe el importe y el desglose de esa FACTURA de liquidación con el
  nuevo `importe_liquidacion` (+ extras vigentes)
- **AND** no crea una segunda FACTURA de liquidación (idempotente por `(reserva_id, tipo)`)

#### Scenario: La fianza no se regenera

- **GIVEN** una RESERVA en la ventana viva con FACTURA de fianza existente
- **WHEN** el recálculo produce un nuevo total
- **THEN** la FACTURA de fianza no se modifica (su importe no depende del total)

#### Scenario: Recálculo idempotente no duplica ni desajusta importes

- **GIVEN** una RESERVA en la ventana viva ya recalculada a total `3600,00`
- **WHEN** el mismo recálculo (mismo aforo/duración) se aplica de nuevo
- **THEN** el estado final es idéntico (`importe_total = 3600,00`, `importe_liquidacion =
  2400,00`, `importe_senal = 1200,00`) y no se duplican FACTURAS
