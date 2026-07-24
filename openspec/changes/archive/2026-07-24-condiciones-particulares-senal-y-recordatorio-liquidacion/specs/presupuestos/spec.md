# Spec Delta — Capability `presupuestos`

> **condiciones-particulares-senal-y-recordatorio-liquidacion** — Revierte la parte E2 de
> la "Mejora B" del change `condiciones-idioma-e2-firma-banner`: el email de presupuesto
> (E2) deja de adjuntar las condiciones particulares y de bloquear/mutar por ellas. Las
> condiciones pasan a adjuntarse en la factura de la señal (E3), que fija
> `cond_part_enviadas_fecha` (ver delta `facturacion`). Se **elimina la guarda dura**
> `CONDICIONES_NO_CONFIGURADAS` (409) y la fijación de `cond_part_enviadas_fecha` /
> `cond_part_firmadas` dentro de la transición a `pre_reserva`.
>
> Fuente: petición de usuario; `US-023`; change `condiciones-idioma-e2-firma-banner`
> Mejora B (revertida en E2); `disparar-e2.adapter.ts`; `generar-presupuesto.use-case.ts`;
> `er-diagram.md §3.6 RESERVA`.

## ADDED Requirements

### Requirement: El email de presupuesto (E2) adjunta solo el PDF del presupuesto

El disparo del email de presupuesto (E2, US-014 §D-7) SHALL (DEBE) adjuntar
**únicamente el PDF del presupuesto** de la reserva, referenciado por
`PRESUPUESTO.pdf_url`. El E2 **NO** adjunta el PDF de "Condicions particulars" (que pasa a
adjuntarse en la factura de la señal, E3 — ver capability `facturacion`) y el disparo del
E2 **NO** invoca `GenerarPdfCondicionesPort` ni depende de él. El nombre del adjunto del
presupuesto se compone con el número de presupuesto y el nombre del cliente
(`P{numeroPresupuesto} {nombre} {apellidos}.pdf`, con fallback `Presupuesto {nombre}
{apellidos}.pdf` cuando no hay número). El disparo es **fire-and-forget post-commit** y la
**idempotencia** del E2 (índice UNIQUE parcial `(reserva_id, codigo_email=E2)`) se
mantiene. (Fuente: `US-014` / UC-14 §D-7; `presupuestos` 6.1b `DispararE2Adapter`; change
`condiciones-particulares-senal-y-recordatorio-liquidacion` — revierte la parte E2 de la
Mejora B de `condiciones-idioma-e2-firma-banner`.)

#### Scenario: E2 adjunta solo el presupuesto, sin condiciones

- **GIVEN** un tenant con configuración de documento, una RESERVA con `idioma = 'es'`, un
  presupuesto con `pdf_url` válida y `numero_presupuesto = '2026019'`, y un cliente con
  nombre `Mercè` y apellidos `Escribano`
- **WHEN** se dispara el E2 post-commit
- **THEN** el motor de email recibe **un único** adjunto: `presupuesto`
  (`P2026019 Mercè Escribano.pdf`)
- **AND** el disparo del E2 **no** invoca `GenerarPdfCondicionesPort` ni adjunta ningún
  documento de condiciones

#### Scenario: El nombre del adjunto usa el número de presupuesto y el nombre del cliente

- **GIVEN** un presupuesto con `numero_presupuesto = '2026019'` y un cliente con nombre
  `Mercè` y apellidos `Escribano`
- **WHEN** se dispara el E2 post-commit
- **THEN** el adjunto del presupuesto tiene `nombre = 'P2026019 Mercè Escribano.pdf'`

#### Scenario: El nombre del adjunto usa fallback cuando no hay número de presupuesto

- **GIVEN** un presupuesto histórico sin `numero_presupuesto` (`null`) y un cliente con
  nombre `Mercè` y apellidos `Escribano`
- **WHEN** se dispara el E2 post-commit
- **THEN** el adjunto del presupuesto tiene `nombre = 'Presupuesto Mercè Escribano.pdf'`

## REMOVED Requirements

### Requirement: El email de presupuesto (E2) adjunta las Condicions particulars

**Reason**: Las condiciones particulares dejan de adjuntarse en E2 y pasan a la factura de
la señal (E3, ver delta `facturacion`). Se sustituye por el requirement (ADDED arriba) "El
email de presupuesto (E2) adjunta solo el PDF del presupuesto". Es un **rename** del
requirement (REMOVED + ADDED), no una modificación en sitio, porque su significado cambia
(E2 deja de invocar `GenerarPdfCondicionesPort` y de adjuntar condiciones).

**Migration**: `DispararE2Adapter` retira la dep `GenerarPdfCondicionesPort` y el bloque de
adjunto de condiciones. No hay migración de datos.

### Requirement: Confirmar presupuesto requiere condicions particulars configuradas

**Reason**: Se elimina la guarda dura. El negocio decide que confirmar el presupuesto
(y enviar la señal) **no** debe bloquearse por condiciones no configuradas. Las condiciones
pasan a adjuntarse en E3 de forma **degradable** (`.catch(() => null)`): si no están
configuradas, la señal se envía igual sin el adjunto. Desaparecen la clase
`CondicionesNoConfiguradasError` y la respuesta `409 CONDICIONES_NO_CONFIGURADAS`.

**Migration**: El endpoint de confirmar presupuesto deja de devolver `409
CONDICIONES_NO_CONFIGURADAS` (dueño del contrato: `contract-engineer`); el frontend retira
el manejo de ese error (dueño: `frontend-developer`). No hay migración de datos.

### Requirement: Confirmar presupuesto fija cond_part_enviadas_fecha en la transacción

**Reason**: La fijación de `RESERVA.cond_part_enviadas_fecha` / `cond_part_firmadas` se
traslada a la emisión de la factura de la señal (E3), que es cuando se **envían** las
condiciones. La transición a `pre_reserva` deja de fijar esos campos y `confirmar` deja de
devolver `condPartFechaEnvio` como consecuencia de esta operación.

**Migration**: Ninguna sobre datos existentes. Las reservas ya confirmadas conservan su
`cond_part_enviadas_fecha` actual; las nuevas lo reciben al enviar la señal (ver delta
`facturacion`).
