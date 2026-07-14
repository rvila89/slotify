# QA Report — Fase 7: pruebas manuales con curl + verificación VISUAL del PDF

**Change:** `documentos-presupuesto-sin-iva-doble-numeracion` (épico #6, rebanada 6.2)
**Fecha:** 2026-07-14 · **Ejecutado por:** sesión principal (backend en marcha + Postgres real)

## 7.1 — Entorno
Backend dev en `http://localhost:3000` (ts-node-dev, código 6.2 tras respawn) contra `slotify_dev`
migrado; login del piloto `info@masialencis.com` (rol `gestor`, tenant piloto) → `accessToken` OK.

## 7.2/7.3 — Régimen derivado del método de pago (confirm, contra BD real)
La persistencia `efectivo→sin_iva` / `transferencia→con_iva` con numeración por régimen se verificó
contra **BD real** en la fase 6.4 (test dirigido con `useCase.confirmar` real, que es exactamente lo
que invoca el controller `POST /reservas/{id}/presupuesto`):
- `efectivo` → `sin_iva`, `2026001`, total = base (889.26), IVA 0.
- `transferencia` → `con_iva`, `2026001` (secuencia independiente), total 1076 (base+IVA).
- 2ª `transferencia` → `con_iva` `2026002`. Coexistencia CON/SIN en `2026001` confirmada.

## 7.4 — Validación HTTP del campo `metodoPago` (ValidationPipe) ✅
Contra el backend en marcha, `POST /api/reservas/{id}/presupuesto/preview`:
- **Sin `metodoPago`** (`{}`) → **HTTP 400** (ValidationPipe `whitelist`+`forbidNonWhitelisted`+`@IsIn`
  rechaza el campo obligatorio). Confirma que el DTO 6.2 está vivo en el server.
- **Con `metodoPago='efectivo'`** y **`='transferencia'`** → pasa la validación y entra en la lógica
  de negocio (devuelve 422 `VALIDACION` "La duración debe ser 4, 8 o 12 horas" SOLO porque la reserva
  de prueba `26-0003` no tiene `duracionHoras`; el método de pago fue aceptado). Confirma que el
  backend en marcha sirve el contrato 6.2.

> Nota: no se ejecutó un `POST` de confirmación 201 vía HTTP contra una reserva completa para no
> mutar datos del dev compartido; la persistencia confirmar+numeración quedó cubierta contra BD real
> en 6.4 (misma ruta de código que el controller).

## 7.6 — PDF SIN IVA generado e inspeccionado VISUALMENTE (D6) ✅
Render real con `renderizarDocumentoPresupuestoABytes` + config sembrada del piloto
(`construirConfiguracionDocumentoPiloto`, sin logo) para ambas variantes. Muestras en `reports/`:
- **`muestra-presupuesto-sin-iva.pdf`** (3.559 bytes) — inspeccionado:
  - Cabecera: **"Masia l'Encís"** + dirección + web + email; **SIN "Canoliart, SL" ni "NIF: B10874287"** ✅
  - Concepte: "Gestió de l'ús espai de Masia l'Encís per esdeveniment (8 hores)…" — **sin "lloguer"** ✅
  - Extras Neteja/Barra lliure; **Total 1000.00 € solo, SIN línea Base imposable / IVA** ✅ (importe menor)
  - Condicions: Senyal 400 / Liquidació 600 / Fiança 500 (40/60 sobre 1000) ✅; Validesa 10 DIES.
  - Dades bancàries (IBAN, Beneficiari Canoliart SL, Concepte Masia l'Encís) + pie legal.
- **`muestra-presupuesto-con-iva.pdf`** (3.740 bytes) — no regresión de 6.1b:
  - Cabecera CON "Canoliart, SL" + "NIF: B10874287" ✅
  - **Base imposable 1000 / IVA (21.00%) 210 / Total 1210** ✅; Senyal 484 / Liquidació 726 / Fiança 500.

La diferencia entre variantes es exactamente la diseñada (D3): SIN IVA omite razón social fiscal +
NIF de la cabecera y muestra solo el Total (base, sin IVA, importe menor).

### Observación (no bloqueante, para code-review)
El bloque "Dades bancàries" (transferencia) también se pinta en la variante SIN IVA (efectivo). El
spec/D3 solo pidió omitir razón social + NIF de la **cabecera**; el pie bancario no estaba en alcance.
Coherente con lo aprobado; se anota por si en 6.3+ se decide ocultarlo para efectivo.

## 7.7 — Restauración
`slotify_dev` intacto (baseline total=1/con_numero=0); reserva `26-0003` NO modificada; ficheros
temporales de QA (`qa-*.mjs`, `qa-render.ts`, spec temporal) eliminados. Muestras PDF conservadas en
`reports/` como evidencia.

## Veredicto fase 7
**OK** — validación HTTP de `metodoPago` (400 sin campo) verificada contra el server; régimen +
numeración confirmados contra BD real (6.4); **PDF SIN IVA verificado visualmente** contra las reglas
de negocio del Excel, con CON IVA sin regresión; BD y entorno restaurados.
