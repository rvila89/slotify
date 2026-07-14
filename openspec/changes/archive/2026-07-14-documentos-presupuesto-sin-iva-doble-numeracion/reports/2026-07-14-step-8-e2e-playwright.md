# QA Report — Fase 8: E2E con Playwright (MCP)

**Change:** `documentos-presupuesto-sin-iva-doble-numeracion` (épico #6, rebanada 6.2)
**Fecha:** 2026-07-14 · **Ejecutado por:** sesión principal (Playwright MCP + stack en marcha)

## 8.1 — Entorno
Frontend `http://localhost:5173` (Vite) + backend `http://localhost:3000` contra `slotify_dev`.
Login UI con `info@masialencis.com` → dashboard. 0 errores JS de la app (ver 8.4).

## 8.2/8.3 — Flujo del selector de método de pago ✅
Reserva `26-0003` (consulta 2b con fecha) → **Generar presupuesto** → diálogo:
- **Selector presente**: grupo "Método de pago — requerido", `radiogroup` accesible con dos opciones:
  - **Transferencia** — "Presupuesto con IVA (21%)." (checked por defecto)
  - **Efectivo** — "Presupuesto sin IVA."
- **Toggle**: click en Efectivo → queda `[checked]` y Transferencia se desmarca; estado visual
  resaltado (borde + radio marcado) en desktop.
- **Preview reactivo (5.2)**: al cambiar a Efectivo, el frontend **re-solicita** `POST …/presupuesto/
  preview` con el nuevo `metodoPago` (observado en la red: 2ª petición al togglear). En esta reserva
  el preview responde 422 porque `26-0003` no tiene `duracionHoras` (no es fallo de la 6.2); el
  cálculo del borrador por régimen está cubierto por unit tests + el test real-DB de la fase 6.

> El borrador con desglose por régimen (SIN IVA vs CON IVA) no se pudo capturar end-to-end en la UI
> porque la única reserva 2b de dev no tiene duración y modificar ese registro compartido de dev fue
> bloqueado por el guardrail de datos. Cubierto por: unit `desglose-fiscal-por-regimen` +
> `generar-presupuesto-regimen.use-case` y el test real-DB de la fase 6.4.

## 8.4 — Validación de método de pago
El selector trae **default `transferencia`** (siempre hay una opción seleccionada), de modo que desde
la UI nunca se envía el request sin `metodoPago` (más seguro). El caso "sin método" a nivel HTTP
(→ 400) se verificó por curl en la fase 7.4. Consola: los únicos 2 errores son el 422 esperado del
preview (reserva sin duración); **0 errores JS de la aplicación**.

## 8.5 — Responsive en 3 viewports (regla dura) ✅
Diálogo abierto con el selector visible. Capturas en `reports/e2e-screenshots/`:
- **390×844 (móvil)** `e2e-6.2-selector-390.png`: diálogo a ancho completo, campos y opciones
  APILADOS en columna, scroll vertical; **sin overflow horizontal**.
- **768×1024 (tablet)** `e2e-6.2-selector-768.png`.
- **1280×800 (desktop)** `e2e-6.2-selector-1280.png`: selector en **dos tarjetas lado a lado**
  (Transferencia | Efectivo), CP+Población en 2 columnas; Efectivo seleccionado y resaltado; sin
  overflow.
Layout mobile-first correcto (columna en móvil, fila en ≥sm). Objetivos táctiles amplios.

## 8.6 — Restauración
Sin mutaciones persistentes (flujo hasta el borrador, no se confirmó). Reserva `26-0003` intacta.
Capturas movidas de la raíz a `reports/e2e-screenshots/` (evita dejar PNGs en la raíz).

## Veredicto fase 8
**OK** — el selector de método de pago renderiza y funciona en la app real (toggle + estado visual),
dispara el re-cálculo del preview con el `metodoPago` elegido, comunica el régimen en la propia UI
(con IVA 21% / sin IVA) y es responsive sin overflow en 390/768/1280. Sin errores JS de la app.
