# Change: condiciones-particulares-senal-y-recordatorio-liquidacion

## Why

El change `condiciones-idioma-e2-firma-banner` (archivado 2026-07-21, "Mejora B")
movió las **condiciones particulares** (PDF en blanco a firmar, generado por tenant +
idioma vía `GenerarPdfCondicionesPort` / token `GENERAR_PDF_CONDICIONES_PORT`) al
**correo del presupuesto (E2)** y las convirtió en **guarda dura**: confirmar el
presupuesto se bloquea con `409 CONDICIONES_NO_CONFIGURADAS` si el tenant no las tiene
configuradas, y fija `RESERVA.cond_part_enviadas_fecha` dentro de la transición a
`pre_reserva`.

El uso real ha mostrado que ese momento (con el presupuesto, antes de que el cliente
decida) es demasiado temprano y que la guarda dura bloquea de más: un tenant sin
condiciones configuradas no puede ni confirmar presupuesto ni enviar la señal. El
negocio quiere:

1. **Adjuntar las condiciones particulares al correo de la factura de la SEÑAL (E3)**,
   no al del presupuesto (E2) — el cliente las recibe cuando ya ha decidido reservar.
2. En el correo de la factura de **LIQUIDACIÓN (E4)**: si las condiciones firmadas aún
   NO están en la ficha (`RESERVA.cond_part_firmadas = false`), añadir un **párrafo
   recordatorio al cliente** de que están pendientes de devolver firmadas.
3. **Eliminar la guarda dura** `CONDICIONES_NO_CONFIGURADAS` (y su `409`): la señal se
   envía con las condiciones adjuntas **solo si están configuradas**; si no, **degrada**
   (`.catch(() => null)`) y se envía igual. Confirmar presupuesto y enviar señal **dejan
   de bloquearse** por condiciones.

### Dos conceptos que la spec NO debe confundir

- **Condiciones en blanco** = plantilla por tenant + idioma (`GenerarPdfCondicionesPort`).
  Es lo que se **ENVÍA**. Este change la mueve E2 → E3.
- **Condiciones firmadas** = `DOCUMENTO tipo='condiciones_particulares'` (subido por
  US-024), flag `RESERVA.cond_part_firmadas`. Es lo que se **RECIBE**. Gobierna el
  recordatorio condicional de E4.

## What Changes

### A) Presupuesto / E2 — quitar condiciones y la guarda dura (revierte la parte E2 de Mejora B)

- `presupuestos/infrastructure/disparar-e2.adapter.ts`: quitar la dep
  `GenerarPdfCondicionesPort` y el bloque de adjunto de condiciones. E2 adjunta **solo
  el presupuesto**.
- `presupuestos/application/generar-presupuesto.use-case.ts`: eliminar la guarda PRE-TX
  `asegurarCondicionesConfiguradas`, la clase `CondicionesNoConfiguradasError`, la dep de
  condiciones, y dejar de pasar `condPartEnviadasFecha` / `condPartFirmadas` a
  `transicionarAPrereserva`.
- `presupuestos/infrastructure/activar-prereserva-uow.prisma.adapter.ts` + puerto
  `transicionarAPrereserva`: quitar esos campos.
- `presupuestos/presupuestos.module.ts`: retirar el wiring `GENERAR_PDF_CONDICIONES_PORT`.
- `presupuestos/interface/generar-presupuesto.controller.ts`: quitar el mapeo
  `409 CONDICIONES_NO_CONFIGURADAS`.
- `catalogo-plantillas.ts` `renderE2` / `renderE2Ca`: quitar la frase de condiciones.

### B) Factura de señal / E3 — adjuntar condiciones (soft) + fijar `cond_part_enviadas_fecha`

- `facturacion/application/enviar-factura-senal.use-case.ts`: dep
  `GenerarPdfCondicionesPort`; generar el PDF de condiciones **PRE-TX** (fuera de la UoW,
  `.catch(() => null)`); si hay URL, añadir el adjunto
  `{ clave: 'condiciones', nombre: 'condiciones-particulares.pdf' | 'condicions-particulars.pdf', pdfUrl }`;
  nuevo repo `reservas` en la UoW (`fijarCondicionesEnviadas`) llamado **dentro de la tx**
  tras confirmar E3 **solo si se adjuntaron**; flag `condicionesAdjuntas` en
  `EnviarE3EmisionParams`.
- `facturacion/infrastructure/emision-email.adapter.ts` (`EnviarE3EmisionAdapter`): pasar
  `condicionesAdjuntas` al render.
- `catalogo-plantillas.ts` `renderE3` / `renderE3Ca`: párrafo de condiciones condicionado
  a `condicionesAdjuntas === true`.
- Reenvío E3 (`reenviar-e3.use-case.ts` + `ReenviarE3Adapter`): **alinear** — sustituir el
  `buscarDocumentoCondiciones` (código stale tras Mejora B) por **regenerar el PDF en
  blanco** vía `GenerarPdfCondicionesPort`; mantener `fijarCondicionesEnviadas`.

### C) Factura de liquidación / E4 — recordatorio condicional al cliente

- `facturacion/application/enviar-factura-liquidacion.use-case.ts`: añadir
  `condPartFirmadas` a `ReservaLiquidacionEmision`; propagar
  `recordarCondicionesPendientes = !condPartFirmadas` a `EnviarE4EmisionParams`.
- `facturacion/infrastructure/lecturas-emision.prisma.adapter.ts`: `select` de
  `cond_part_firmadas`.
- `emision-email.adapter.ts` (`EnviarE4EmisionAdapter` y `ReenviarE4Adapter`): pasar el
  flag al render.
- `catalogo-plantillas.ts` `renderE4` / `renderE4Ca`: párrafo recordatorio **solo si**
  `recordarCondicionesPendientes === true`.

### D) Contrato + SDK (dueño: contract-engineer)

- Quitar el `409 CONDICIONES_NO_CONFIGURADAS` del endpoint de confirmar presupuesto en
  `docs/api-spec.yml` y regenerar el SDK.

### E) Frontend (dueño: frontend-developer)

- Eliminar el manejo del `409 CONDICIONES_NO_CONFIGURADAS` en el flujo de confirmar
  presupuesto (verificar referencias reales; **no** tocar el manejo de errores del
  reenvío E3). Sin UI nueva.

## Impact

- **Specs afectadas**:
  - `openspec/specs/presupuestos/spec.md`
    - MODIFIED "El email de presupuesto (E2) adjunta las Condicions particulars" → E2 deja
      de adjuntar condiciones (adjunta solo el presupuesto).
    - REMOVED "Confirmar presupuesto requiere condicions particulars configuradas" (guarda
      dura + `409`).
    - REMOVED "Confirmar presupuesto fija cond_part_enviadas_fecha en la transacción" (la
      transición a `pre_reserva` deja de fijar `cond_part_enviadas_fecha`).
  - `openspec/specs/facturacion/spec.md`
    - MODIFIED "Emisión y envío de la factura de señal al aprobar y enviar E3
      (borrador → enviada)" → E3 adjunta condiciones (degradable) y fija
      `cond_part_enviadas_fecha` **solo si** se adjuntaron.
    - MODIFIED "Reenvío manual de E3 sin re-emitir la factura ni duplicar documentos" →
      regenera el PDF en blanco vía `GenerarPdfCondicionesPort` en vez de buscar el
      DOCUMENTO stale.
    - MODIFIED "Emisión standalone de la factura de liquidación (flujo espejo de la señal)"
      → E4 añade recordatorio condicional cuando `cond_part_firmadas = false`.
- **Contrato/SDK**: se retira el error `409 CONDICIONES_NO_CONFIGURADAS` del endpoint de
  confirmar presupuesto (cambio no rompiente: se elimina una respuesta de error que dejará
  de emitirse).
- **BD**: sin migración. `cond_part_enviadas_fecha` y `cond_part_firmadas` ya existen en
  `RESERVA`. El cambio es solo **quién** fija `cond_part_enviadas_fecha` (E3 en vez de E2)
  y que ya no es incondicional.
- **Riesgo**: medio-bajo.
  - Punto sensible 1: el disparo del PDF de condiciones en E3 debe ser **pre-tx y
    degradable** (`.catch(() => null)`); un fallo o ausencia de config NO puede tumbar el
    envío atómico de la señal (que sí hace rollback ante fallo de E3). `fijarCondicionesEnviadas`
    solo se llama dentro de la tx **si** el adjunto se preparó.
  - Punto sensible 2: el reenvío E3 tenía código stale (`buscarDocumentoCondiciones`) que
    tras Mejora B ya no persiste ese DOCUMENTO; hay que regenerar el PDF en blanco.
  - Punto sensible 3: el recordatorio de E4 depende del flag **`cond_part_firmadas`**
    (recibido), no de `cond_part_enviadas_fecha` (enviado): no confundirlos.
- **No rompe**: el endpoint `POST /reservas/{id}/condiciones-firmadas` (US-024) no cambia;
  el flag `cond_part_firmadas` que lee E4 lo sigue gobernando esa US.

## Trazabilidad

- US-023 (`user-stories/US-023-enviar-condiciones-particulares.md`) — envío de condiciones
  con la señal (E3); UC-19.
- US-024 (`user-stories/US-024-registrar-firma-condiciones-particulares.md`) — flag
  `cond_part_firmadas` que gobierna el recordatorio de E4.
- US-028 (`user-stories/US-028-enviar-factura-liquidacion-cliente.md`) — envío de la
  factura de liquidación (E4); UC-21.
- Change previo revertido/ajustado: `condiciones-idioma-e2-firma-banner` (Mejora B),
  archivado 2026-07-21.
- `docs/er-diagram.md §3.6 RESERVA` (`cond_part_enviadas_fecha`, `cond_part_firmadas`),
  `§3.12 FACTURA`, `§3.16 COMUNICACION`.
- Decisiones confirmadas por el usuario: recordatorio E4 = párrafo condicional al cliente
  (no aviso interno); sin guarda dura; condiciones soft-degradables en E3.
