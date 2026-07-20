# Spec Delta — Capability `confirmacion`

> **fix-importe-total-confirmar-senal** — Corrige el bug bloqueante por el que
> `POST /reservas/{id}/confirmar-senal` (US-021, UC-17) devolvía **siempre** HTTP
> 422 `IMPORTE_TOTAL_INVALIDO`: la guarda `validarImporteTotal` leía un
> `RESERVA.importe_total` que **ningún código de producción escribía nunca**. La
> confirmación pasa ahora a **obtener el total del PRESUPUESTO vigente**
> (`MAX(version)`, `estado='enviado'`) dentro de su transacción, **congelarlo** en
> `RESERVA.importe_total` y **marcar ese presupuesto como `aceptado`** — el paso
> de aceptación que nunca existió. El endpoint, el DTO, la respuesta HTTP y el
> contrato OpenAPI **no cambian**.
>
> Fuente: US-021 §Happy Path (`importe_senal = 1.200,00 €` / `importe_liquidacion
> = 1.800,00 €`), §Reglas de negocio (pct_senal 40/60), §Supuestos (presupuesto
> aceptado / `importe_total` fijado), §Reglas de Validación (`importe_total > 0`);
> UC-17; `confirmar-pago-senal.use-case.ts:432,560`; `er-diagram.md §3.12
> PRESUPUESTO` (vigente = `MAX(version)`, `estado ∈ {enviado, aceptado}`, `total`;
> `§3.6 RESERVA` `importe_total = "Total del presupuesto aceptado"`); US-022,
> US-027 (facturación depende de `PRESUPUESTO(estado='aceptado')`).

## MODIFIED Requirements

### Requirement: Congelado de importes de señal y liquidación al confirmar

El sistema SHALL (DEBE), al confirmar el pago de la señal y **dentro de la misma
transacción atómica** de la confirmación (bajo `SELECT ... FOR UPDATE` sobre la
fila de `FECHA_BLOQUEADA` y contexto RLS del tenant), **antes** de calcular los
importes de señal y liquidación:

1. **Obtener el total del PRESUPUESTO vigente** de la RESERVA: el de mayor
   `version` (`MAX(version)`, vigencia **derivada**, no almacenada) con `estado =
   'enviado'`.
2. **Validar `total > 0`.** Si **no** existe un presupuesto vigente válido (no
   hay presupuesto en `estado = 'enviado'`, o su `total ≤ 0`), el sistema DEBE
   lanzar `ImporteTotalInvalidoError` → **HTTP 422 `IMPORTE_TOTAL_INVALIDO`**
   ("El importe total de la reserva no es válido / no hay presupuesto aceptado")
   **sin producir ningún efecto**: no cambia `RESERVA.estado`, no crea DOCUMENTO,
   no modifica `FECHA_BLOQUEADA`, no crea FICHA_OPERATIVA, no marca el presupuesto
   y no congela `importe_total`. La guarda `validarImporteTotal` valida este total
   del presupuesto vigente y **ya no** lee un `RESERVA.importe_total` prefijado
   (que ninguna operación de producción poblaba).
3. **Congelar `RESERVA.importe_total = presupuesto.total`.**
4. **Marcar ese PRESUPUESTO como `estado = 'aceptado'`.**

A partir de ese `importe_total` recién congelado, el sistema DEBE fijar
`RESERVA.importe_senal = round(importe_total × TENANT_SETTINGS.pct_senal / 100,
2)` (40% en MVP, **derivado del setting, nunca hardcodeado**) y
`RESERVA.importe_liquidacion = importe_total − importe_senal` (60%), usando la
resta para el complemento de modo que `importe_senal + importe_liquidacion =
importe_total` exactamente (sin desajuste de céntimos). El sistema NO recalcula la
tarifa: usa el `total` ya congelado del presupuesto vigente. El congelado de
`importe_total` y el marcado del presupuesto a `aceptado` ocurren en la misma
transacción all-or-nothing que el resto de la confirmación; si cualquier
escritura falla, revierten por completo. La operación DEBE ser **coherente ante
double-click / confirmación concurrente**: solo la primera transacción congela el
importe y acepta el presupuesto; la segunda detecta que la RESERVA ya está en
`reserva_confirmada` y no re-congela ni re-acepta (ver `consultas` §Concurrencia).
(Fuente: `US-021 §Happy Path` `importe_senal = 1.200,00 €` / `importe_liquidacion
= 1.800,00 €`, `§Reglas de negocio` pct_senal 40/60, `§Supuestos`, `§Reglas de
Validación` `importe_total > 0`; UC-17; `er-diagram.md §3.12 PRESUPUESTO` vigente
= `MAX(version)`, `total`, `estado`; `§3.6 RESERVA` `importe_total`,
`importe_senal`/`importe_liquidacion`; `§TENANT_SETTINGS pct_senal`; US-022/US-027
dependen de `PRESUPUESTO(estado='aceptado')`.)

#### Scenario: Confirmar con presupuesto vigente enviado congela el total y lo acepta

- **GIVEN** una RESERVA en `pre_reserva` cuyo PRESUPUESTO vigente
  (`MAX(version)`) está en `estado = 'enviado'` con `total = 3.000,00 €`, y
  `TENANT_SETTINGS.pct_senal = 40,00`
- **WHEN** el gestor confirma el pago de la señal con un justificante válido
- **THEN** la RESERVA transiciona a `reserva_confirmada`
- **AND** `RESERVA.importe_total = 3.000,00 €` (congelado desde el presupuesto vigente)
- **AND** ese PRESUPUESTO pasa a `estado = 'aceptado'`
- **AND** `RESERVA.importe_senal = 1.200,00 €` y `RESERVA.importe_liquidacion = 1.800,00 €`
- **AND** `importe_senal + importe_liquidacion = importe_total`

#### Scenario: Sin presupuesto vigente válido se rechaza con 422 sin efectos

- **GIVEN** una RESERVA en `pre_reserva` que **no** tiene ningún PRESUPUESTO en
  `estado = 'enviado'` (o cuyo presupuesto vigente tiene `total ≤ 0`)
- **WHEN** el gestor intenta confirmar el pago de la señal con un justificante válido
- **THEN** el sistema responde **HTTP 422 `IMPORTE_TOTAL_INVALIDO`** ("no hay
  presupuesto aceptado")
- **AND** no cambia `RESERVA.estado`, no congela `importe_total`, no marca ningún
  presupuesto como `aceptado`, no crea DOCUMENTO, no modifica `FECHA_BLOQUEADA` ni
  crea FICHA_OPERATIVA

#### Scenario: El porcentaje se deriva de TENANT_SETTINGS, no hardcodeado

- **GIVEN** `TENANT_SETTINGS.pct_senal = 50,00` y una RESERVA en `pre_reserva`
  cuyo presupuesto vigente `enviado` tiene `total = 2.000,00 €`
- **WHEN** el sistema confirma la reserva
- **THEN** `RESERVA.importe_total = 2.000,00 €` congelado y el presupuesto pasa a `aceptado`
- **AND** `RESERVA.importe_senal = 1.000,00 €` e `importe_liquidacion = 1.000,00 €`,
  derivados del setting vigente del tenant

#### Scenario: Con varias versiones se toma el total de la vigente (MAX(version))

- **GIVEN** una RESERVA en `pre_reserva` con dos versiones de PRESUPUESTO —
  `version = 1` (`total = 3.000,00 €`) y `version = 2` (`total = 3.500,00 €`,
  `estado = 'enviado'`, vigente)
- **WHEN** el gestor confirma el pago de la señal
- **THEN** `RESERVA.importe_total = 3.500,00 €` (el total de la versión vigente)
- **AND** el PRESUPUESTO `version = 2` pasa a `estado = 'aceptado'`

#### Scenario: Double-click no re-congela ni re-acepta

- **GIVEN** dos confirmaciones concurrentes de la misma RESERVA en `pre_reserva`
  con presupuesto vigente `enviado`
- **WHEN** ambas se ejecutan sobre la misma fila de `FECHA_BLOQUEADA` (`SELECT ...
  FOR UPDATE`)
- **THEN** exactamente una congela `importe_total` y marca el presupuesto como
  `aceptado`
- **AND** la segunda detecta que la RESERVA ya está en `reserva_confirmada` y no
  re-congela el importe ni vuelve a marcar el presupuesto
