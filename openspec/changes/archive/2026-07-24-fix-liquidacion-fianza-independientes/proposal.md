# Change: fix-liquidacion-fianza-independientes

## Why

El proceso de **liquidación** y **fianza** está mal modelado: ambos van acoplados en un
único flujo de emisión (email **E4** lleva la factura de liquidación *y* el recibo de fianza,
US-028), la **fianza** se trata como una FACTURA que se emite y se envía al cliente (recibo,
`fianza_status = recibo_enviado`, cobro por PAGO, política "Negociable", US-027/US-030), y es
una **precondición dura** para iniciar el evento (`fianza_status = cobrada` como una de las tres
guardas de `reserva_confirmada → evento_en_curso`, US-029/US-030 y `ficha-operativa`). Además
la **devolución** (US-035/US-036) está sobredimensionada: pide el IBAN al cliente por email E8
(US-035), permite **retención parcial con motivo** y deriva `fianza_status = retenida_parcial`,
y **no** confirma al cliente por correo que se le ha devuelto la fianza.

El objetivo es **desacoplar** liquidación y fianza en dos flujos independientes y **simplificar**
la fianza a un flujo pasivo, alineado con cómo la Masia trabaja de verdad:

- La **liquidación** se comporta **exactamente igual que la factura de señal**: tarjeta propia,
  su propio flujo `borrador → enviada`, acción de aprobar+enviar, banner permanente "enviada el
  {fecha/hora}", reenvío y PDF fiel a la referencia. El email **E4 = solo liquidación**, bilingüe
  CA/ES.
- La **fianza** deja de ser una FACTURA que se emite: pasa a ser una sección **pasiva** donde el
  gestor sube el **comprobante** de la transferencia recibida (patrón espejo de
  `condiciones_particulares`, capability `confirmacion`). Es **opcional** y **no bloquea** el
  inicio del evento.
- La **devolución** se simplifica: un botón "Devolver fianza" en `post_evento` que registra la
  devolución **completa** (`fianza_status = 'devuelta'`) y envía un **email nuevo** de confirmación
  (CA/ES). Se **eliminan** la captura de IBAN, E5, E8 y la retención parcial.

**¿Hay hoy acción/comunicación de devolución?** Sí: hoy se pide el IBAN (E5, US-034/US-035), se
confirma su registro (E8, US-035) y se registra la devolución permitiendo retención parcial con
motivo (US-036), pero **no** existe un email que confirme al cliente que la fianza se ha devuelto.
Por decisión del usuario se **eliminan** E5/E8, la captura de IBAN y la retención parcial, y se
**añade** el email nuevo de "fianza devuelta".

### Decisiones confirmadas con el usuario (Gate previo)

1. **Fianza — simplificar del todo:** eliminar el recibo/FACTURA de fianza y su emisión; **E4 =
   solo liquidación**; fianza = subida de comprobante, opcional, sin envíos ni recibo.
2. **Precondición del evento — eliminar la fianza:** `reserva_confirmada → evento_en_curso`
   dependerá solo de *liquidación cobrada* + *pre-evento cerrado*.
3. **Devolución — simplificar:** un botón "Devolver fianza" que registra devolución **completa**
   + envía el correo nuevo; se **elimina** captura de IBAN (E5/E8) y retención parcial.

(Fuente: plan aprobado `fix-liquidacion-fianza-independientes`; US-027, US-028, US-029, US-030,
US-034, US-035, US-036; UC-21, UC-22, UC-26, UC-27; `er-diagram.md §3.12 FACTURA`, `§RESERVA
fianza_*`, `§CLIENTE iban_devolucion`, `§3.16 COMUNICACION`.)

## What Changes

> Slice vertical grande, probablemente multi-sesión (back + front + contrato + datos + specs +
> docs). Este change entrega **solo** los artefactos SDD (proposal + spec-deltas + design + tasks)
> y se detiene en el **⏸ Gate de revisión humana** antes de contrato/TDD/implementación.

### Liquidación standalone (capability `facturacion` + `comunicaciones`)

- El borrador de liquidación se sigue generando **automáticamente** al confirmar la señal (US-027),
  pero **sin** generar el recibo de fianza.
- La emisión de la liquidación deja de ser una acción combinada "Aprobar y enviar" acoplada a la
  fianza y con **atomicidad estado↔E4** (US-028): pasa a ser un **flujo espejo de la señal**
  (aprobar + enviar, banner permanente, reenvío dedicado). El email **E4 = solo liquidación** con
  el texto bilingüe nuevo (CA/ES). Desglose fiscal (IVA 21 %, redondeo contable, base por resta) y
  numeración `F-YYYY-NNNN` se **conservan sin cambios**.
- PDF de liquidación fiel a la referencia (`F2026030 Mercè Escribano.pdf`): concepto "Gestió ús
  espai de Masia l'Encís per esdeveniment", subtítulo "*60% de l'import restant del pressupost
  núm. {n}", fila de condicions "A l'arribada · {fianzaEur}€ · Fiança", desglose IVA 21 %, pie
  bancario. Bilingüe CA/ES.

### Fianza pasiva (capability `facturacion`)

- Nueva sección de fianza pasiva: el gestor **sube el comprobante** de la transferencia recibida
  (espejo de `condiciones_particulares`). Opcional, **no** requerida antes del evento, **sin**
  emisión ni recibo.
- Se **elimina** la generación del borrador de fianza (US-027), su emisión / recibo y su
  acoplamiento en E4 (US-028), el envío separado del recibo, el cobro de fianza vía PAGO y la
  política "Negociable" (US-030).

### Máquina de estados (capability `ficha-operativa`)

- Se **elimina la fianza como precondición** de `reserva_confirmada → evento_en_curso`. La
  transición pasa a depender de **dos** precondiciones: `pre_evento_status = 'cerrado'` **y**
  `liquidacion_status = 'cobrada'` (se quita `fianza_status = 'cobrada'`).

### Devolución simplificada (capability `facturacion` + `comunicaciones`)

- Un botón "Devolver fianza" en `post_evento` registra la devolución **completa**
  (`fianza_status = 'devuelta'`, `fianza_devuelta_fecha = now()`, importe = `fianza_eur`) y **dispara
  el email nuevo** de confirmación al cliente (CA/ES), como efecto **post-commit best-effort**
  (patrón `disparar-e8.adapter.ts`: su fallo no revierte el registro; reintentable).
- Se **elimina** la captura de IBAN (`CLIENTE.iban_devolucion`, US-035), los emails **E5** y **E8**,
  la **retención parcial** (`fianza_status = 'retenida_parcial'`, `motivo_retencion`,
  `fianza_devuelta_eur`) y las guardas asociadas (IBAN NOT NULL, importe ≤ fianza, motivo requerido).

### Modelo de datos (fuera de este change de spec; ver `tasks.md` + `design.md`)

- `TipoFactura`: eliminar `fianza` → `senal | liquidacion | complementaria`.
- `FianzaStatus`: reducir a `pendiente | cobrada | devuelta` (`cobrada` = comprobante recibido).
- `RESERVA`: eliminar `motivo_retencion`, `fianza_devuelta_eur`; conservar `fianza_eur`,
  `fianza_cobrada_fecha`, `fianza_devuelta_fecha`; añadir referencia al DOCUMENTO comprobante de
  fianza (o `fianza_comprobante_fecha`, análogo a `cond_part_firmadas_fecha`).
- `CLIENTE.iban_devolucion`: eliminar.

## Impact

- **Specs afectadas:**
  - `facturacion/` — REMOVED (generación del borrador de fianza; emisión del recibo de fianza y su
    acoplamiento en E4; envío separado del recibo; cobro de fianza + política "Negociable";
    devolución con retención parcial + sus guardas), MODIFIED (emisión de liquidación → standalone
    espejo de la señal), ADDED (fianza pasiva por comprobante; devolución completa + email).
  - `comunicaciones/` — MODIFIED (E4 = solo liquidación con texto CA/ES; reenvío de E4), ADDED
    (plantilla "fianza devuelta" CA/ES, activa, disparada post-commit best-effort), REMOVED (E5 y
    E8, incluido el envío separado del recibo como `manual`).
  - `ficha-operativa/` — MODIFIED (las dos referencias a la precondición triple de
    `evento_en_curso` para quitar la fianza).
  - `confirmacion/` — MODIFIED (la inicialización de sub-procesos ya no dispara el borrador de
    fianza; solo el de liquidación).
- **Contrato OpenAPI (`docs/api-spec.yml`): NO se toca en este change de spec.** Se prevé (fase de
  contrato, post-gate): añadir `POST /reservas/{id}/facturas/liquidacion/enviar` y `.../reenviar`
  (standalone, espejo de señal), `POST /reservas/{id}/fianza/comprobante`, `POST
  /reservas/{id}/fianza/devolver`; eliminar `.../facturas/liquidacion/aprobar-enviar` (combinado),
  `.../facturas/fianza/enviar`, cobro de fianza, `registrar-iban-devolucion`, y la variante de
  devolución con retención.
- **Migración Prisma** (post-gate): drop de `TipoFactura.fianza`, reducción de `FianzaStatus`, drop
  de `RESERVA.motivo_retencion` / `fianza_devuelta_eur` / `CLIENTE.iban_devolucion`, alta de la
  referencia al DOCUMENTO comprobante de fianza.
- **Superficie de eliminación** (representativa, detalle en `design.md §Removal surface`):
  `aprobar-y-enviar-liquidacion`, `registrar-cobro-fianza.*`, `registrar-iban-devolucion.*`,
  `disparar-e8.adapter.ts`, `cargar-reserva-iban-devolucion.*`, las partes de retención/IBAN de
  `registrar-devolucion-fianza.*`, plantillas E5/E8; frontend
  `DocumentosLiquidacionFianza.tsx`, `AccionesFacturacion.tsx`,
  `AprobarEnviarLiquidacionDialog.tsx`, `RegistrarCobroFianzaDialog.tsx`, `IbanDevolucionCard.tsx`.
- **Trazabilidad:** US-027, US-028, US-029, US-030, US-034, US-035, US-036; UC-21, UC-22, UC-26,
  UC-27; E4 (redefinido), E5/E8 (eliminados), nuevo email "fianza devuelta"; entidades FACTURA,
  RESERVA, CLIENTE, DOCUMENTO, COMUNICACION, AUDIT_LOG.

## Lo que NO entra (anti-scope)

- **No se modifica** la numeración `F-YYYY-NNNN`, el desglose fiscal (base derivada, IVA 21 %,
  redondeo contable), ni el flujo de la **factura de señal** (US-022/US-023) ni el **cobro de la
  liquidación** (US-029): se reutilizan tal cual.
- **No se toca `docs/api-spec.yml` ni el cliente generado** en este change (fase de contrato,
  post-gate; dueño `contract-engineer`).
- **No se implementa** código de negocio, migraciones ni tests aquí: este change entrega solo los
  artefactos SDD y se detiene en el Gate de revisión humana.
- **No se reintroduce** la retención parcial, la captura de IBAN ni el cobro de la fianza por PAGO:
  quedan explícitamente fuera de MVP por decisión del usuario.

## Decisiones de diseño (aprobadas en el Gate previo, detalladas en `design.md`)

- **D-1** Liquidación standalone (flujo espejo de la señal, sin atomicidad estado↔E4 combinada).
- **D-2** Fianza pasiva por comprobante (espejo de `condiciones_particulares`), opcional.
- **D-3** Devolución completa + email nuevo post-commit **best-effort** (patrón `disparar-e8`).
- **D-4** Precondición de `evento_en_curso` reducida a dos guardas (quita fianza).
- **D-5** Deltas de modelo de datos (enums, campos eliminados, comprobante) + idempotencia por
  `UNIQUE(reserva_id, tipo)`.
