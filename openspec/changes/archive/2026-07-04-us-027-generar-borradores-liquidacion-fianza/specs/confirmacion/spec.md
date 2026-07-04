# Spec Delta — Capability `confirmacion` (MODIFICADA)

> US-027 **concreta** que la activación de los sub-procesos paralelos de liquidación y fianza
> —ya inicializados en `pendiente` por US-021— **dispara**, como efecto posterior al commit de
> la confirmación, la generación de los borradores de la factura de liquidación y del recibo de
> fianza (agregado FACTURA, capability `facturacion`). Se **modifica** el requisito ya vivo
> "Inicialización de los tres sub-procesos paralelos al confirmar" para reflejar ese disparo,
> manteniendo intacto que este change de `confirmacion` **solo** inicializa los estados y
> dispara la generación (la lógica de creación de las facturas vive en `facturacion`).
> Fuente: US-027, UC-21 (pasos 1–2), UC-22 (pasos 1–2), A7; `US-021 §Happy Path`; spec viva de
> `confirmacion` (US-021) y de `facturacion` (US-022).

## MODIFIED Requirements

### Requirement: Inicialización de los tres sub-procesos paralelos al confirmar

El sistema SHALL (DEBE), al confirmar, inicializar los tres sub-procesos paralelos de la
RESERVA en la misma transacción: `pre_evento_status = 'pendiente'`, `liquidacion_status =
'pendiente'` y `fianza_status = 'pendiente'`. Estos estados quedan listos para que las US
posteriores los avancen. **Tras el commit** de la confirmación, la activación de los
sub-procesos de liquidación y fianza **dispara** —como efecto posterior al commit, espejo del
disparo de la factura de señal (US-022)— la generación automática de los **borradores de la
factura de liquidación y del recibo de fianza** (agregado FACTURA, capability `facturacion`;
US-027). Esa generación es **posterior al commit**: su ausencia o fallo **no revierte** la
confirmación ya realizada (la RESERVA permanece en `reserva_confirmada` y la generación es
reintentable por idempotencia). Este change de `confirmacion` **solo** inicializa los estados y
dispara la generación; la lógica de creación de los documentos (cálculo del total, desglose
fiscal, idempotencia, alerta y auditoría) se especifica en la capability `facturacion`. (Fuente:
`US-021 §Happy Path`, `§Reglas de negocio` sub-procesos inicializados; `US-027 §Historia`,
`§Reglas de negocio`; UC-17 paso 10, UC-21, UC-22; `er-diagram.md §RESERVA` enums de
sub-procesos.)

#### Scenario: Confirmar deja los tres sub-procesos en pendiente

- **GIVEN** una RESERVA en `pre_reserva` que se confirma con justificante válido
- **WHEN** el sistema completa la transición a `reserva_confirmada`
- **THEN** `RESERVA.pre_evento_status = 'pendiente'`, `liquidacion_status = 'pendiente'` y
  `fianza_status = 'pendiente'`

#### Scenario: La activación de los sub-procesos dispara los borradores de liquidación y fianza tras el commit

- **GIVEN** una confirmación de señal exitosa que dejó la RESERVA en `reserva_confirmada` con
  `liquidacion_status = 'pendiente'` y `fianza_status = 'pendiente'`
- **WHEN** el sistema completa el commit
- **THEN** genera automáticamente los borradores de la factura de liquidación y del recibo de
  fianza (capability `facturacion`, US-027) y alerta al Gestor para su revisión

#### Scenario: El fallo al generar los borradores no revierte la confirmación

- **GIVEN** una RESERVA que ya ha transitado a `reserva_confirmada` (commit realizado)
- **WHEN** la generación de los borradores de liquidación/fianza falla temporalmente tras el commit
- **THEN** la RESERVA permanece en `reserva_confirmada` (la confirmación no se revierte)
- **AND** el sistema puede reintentar la generación sin duplicar (idempotencia por `(reserva_id,
  tipo)`)
