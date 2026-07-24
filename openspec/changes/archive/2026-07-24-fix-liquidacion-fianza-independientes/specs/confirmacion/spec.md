# Spec Delta — Capability `confirmacion` (MODIFICADA)

> La inicialización de los sub-procesos al confirmar la señal deja de disparar el borrador del
> **recibo de fianza**: solo dispara el borrador de la **factura de liquidación** (la fianza pasa a
> un flujo pasivo de subida de comprobante, sin FACTURA). Fuente: plan
> `fix-liquidacion-fianza-independientes` §Fianza pasiva; US-021, US-027; UC-17, UC-21;
> `er-diagram.md §RESERVA enums de sub-procesos`.

## MODIFIED Requirements

### Requirement: Inicialización de los tres sub-procesos paralelos al confirmar

El sistema SHALL (DEBE), al confirmar, inicializar los tres sub-procesos paralelos de la RESERVA en la
misma transacción: `pre_evento_status = 'pendiente'`, `liquidacion_status = 'pendiente'` y
`fianza_status = 'pendiente'`. Estos estados quedan listos para que las US posteriores los avancen.
**Tras el commit** de la confirmación, la activación del sub-proceso de liquidación **dispara** —como
efecto posterior al commit, espejo del disparo de la factura de señal (US-022)— la generación
automática del **borrador de la factura de liquidación** (agregado FACTURA, capability `facturacion`).
**No** se genera ningún borrador ni recibo de fianza: la fianza pasa a un flujo pasivo de subida de
comprobante (`fianza_status = 'cobrada'` = comprobante recibido), sin FACTURA. Esa generación es
**posterior al commit**: su ausencia o fallo **no revierte** la confirmación ya realizada (la RESERVA
permanece en `reserva_confirmada` y la generación es reintentable por idempotencia). Este change de
`confirmacion` **solo** inicializa los estados y dispara la generación del borrador de liquidación; la
lógica de creación del documento (cálculo del total, desglose fiscal, idempotencia, alerta y
auditoría) se especifica en la capability `facturacion`. (Fuente: plan §Fianza pasiva; `US-021 §Happy
Path`, `§Reglas de negocio` sub-procesos inicializados; `US-027 §Historia`; UC-17 paso 10, UC-21;
`er-diagram.md §RESERVA` enums de sub-procesos.)

#### Scenario: Confirmar deja los tres sub-procesos en pendiente

- **GIVEN** una RESERVA en `pre_reserva` que se confirma con justificante válido
- **WHEN** el sistema completa la transición a `reserva_confirmada`
- **THEN** `RESERVA.pre_evento_status = 'pendiente'`, `liquidacion_status = 'pendiente'` y
  `fianza_status = 'pendiente'`

#### Scenario: La activación de los sub-procesos dispara solo el borrador de liquidación tras el commit

- **GIVEN** una confirmación de señal exitosa que dejó la RESERVA en `reserva_confirmada` con
  `liquidacion_status = 'pendiente'` y `fianza_status = 'pendiente'`
- **WHEN** el sistema completa el commit
- **THEN** genera automáticamente el borrador de la factura de liquidación (capability `facturacion`)
  y alerta al Gestor para su revisión
- **AND** no genera ningún borrador ni recibo de fianza

#### Scenario: El fallo al generar el borrador de liquidación no revierte la confirmación

- **GIVEN** una RESERVA que ya ha transitado a `reserva_confirmada` (commit realizado)
- **WHEN** la generación del borrador de liquidación falla temporalmente tras el commit
- **THEN** la RESERVA permanece en `reserva_confirmada` (la confirmación no se revierte)
- **AND** el sistema puede reintentar la generación sin duplicar (idempotencia por `(reserva_id,
  tipo)`)
