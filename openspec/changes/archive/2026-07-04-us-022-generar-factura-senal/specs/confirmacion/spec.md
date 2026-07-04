# Spec Delta — Capability `confirmacion` (MODIFICADA)

> US-022 **modifica** el requisito ya presente en la capability `confirmacion`
> "Presentación de la factura de señal en borrador tras confirmar (disparo US-022)",
> introducido por US-021 como mero *disparo*. US-022 lo **concreta**: tras el commit de la
> confirmación, el sistema **genera efectivamente** la FACTURA de señal en `borrador` (cuya
> lógica de creación, desglose, numeración, PDF y ciclo de vida vive en la nueva capability
> `facturacion`) y **bloquea E3** hasta que el Gestor la apruebe. La generación es un efecto
> **posterior al commit**; su fallo NO revierte la confirmación ya realizada.
> Fuente: US-022, UC-18; `openspec/specs/confirmacion/spec.md` (requisito existente de
> US-021); `US-021 §Email relacionado`.

## MODIFIED Requirements

### Requirement: Presentación de la factura de señal en borrador tras confirmar (disparo US-022)

El sistema SHALL (DEBE), **tras el commit** de la confirmación, generar automáticamente la
factura de señal en `borrador` (agregado FACTURA, capability `facturacion`) para su revisión
por el Gestor. Esta generación es un efecto **posterior al commit** de la transición a
`reserva_confirmada`: su ausencia o fallo **no revierte** la confirmación ya realizada (la
RESERVA permanece en `reserva_confirmada` y el sistema reintenta la generación / el PDF). Este
change **no** genera las condiciones particulares (US-023/UC-19) y **no** envía el email E3:
E3 se dispara únicamente después de que el Gestor **apruebe** la factura de señal (US-022) y el
sistema genere las condiciones particulares (US-023); mientras la factura esté en `borrador`
(o sea inválida, o su PDF esté pendiente, o haya sido rechazada), **E3 queda bloqueado**.
(Fuente: `US-022 §Historia`, `§Happy Path`, `§Email relacionado`; `US-021 §Happy Path`
"presenta la factura de señal en borrador"; UC-18.)

#### Scenario: Tras confirmar se genera la factura de señal en borrador sin enviar E3

- **GIVEN** una confirmación de señal exitosa que dejó la RESERVA en `reserva_confirmada`
- **WHEN** el sistema completa el commit
- **THEN** genera automáticamente la factura de señal en `borrador` (capability `facturacion`)
  y la presenta al Gestor para revisión
- **AND** no genera las condiciones particulares ni envía el email E3 en este change

#### Scenario: El fallo al generar la factura no revierte la confirmación

- **GIVEN** una RESERVA que ya ha transitado a `reserva_confirmada` (commit realizado)
- **WHEN** la generación de la factura de señal (o de su PDF) falla temporalmente tras el commit
- **THEN** la RESERVA permanece en `reserva_confirmada` (la confirmación no se revierte)
- **AND** el sistema reintenta la generación y E3 permanece bloqueado hasta que la factura sea
  aprobada
