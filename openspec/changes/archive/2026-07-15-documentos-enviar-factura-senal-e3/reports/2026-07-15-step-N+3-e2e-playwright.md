# Step N+3 — E2E con Playwright MCP

**Change:** documentos-enviar-factura-senal-e3 (épico #6, rebanada 6.4b — Bloque C)
**Date:** 2026-07-15
**Branch:** feature/documentos-enviar-factura-senal-e3
**Stack:** frontend Vite (`localhost:5173`) + backend NestJS (`localhost:3000/api`) + Postgres `slotify_dev` (Docker)
**Outcome:** ✅ VERDE

---

## 0. Preparación (seed temporal autorizado)

La BD dev no tenía ninguna factura de señal. Con autorización explícita del usuario se
sembró (y luego se **eliminó**) un dataset mínimo para que apareciera la acción:
- CLIENTE `E2E SixFourB` (`e2e-64b@test.local`).
- RESERVA `E2E-64B` en `reserva_confirmada`.
- FACTURA `tipo='senal'`, `estado='enviada'`, `numero='F-2026-0001'`, `pdf_url` no nulo
  (el botón "Enviar factura 40%" se muestra cuando la factura de señal está emitida,
  `estadoVisual='enviada'`; el envío E3 es una acción separada de la emisión).

## 1. Flujo E2E (viewport desktop 1280)

| Paso | Acción | Resultado |
|------|--------|-----------|
| 1 | Login `info@masialencis.com` | → `/dashboard`, sesión iniciada |
| 2 | Navegar a `/reservas/{id}` (ficha) | Ficha de `E2E-64B` renderiza la tarjeta **Factura de señal** ("Enviada", F-2026-0001, base 826,45 € / IVA 21% 173,55 € / total 1000,00 €) con el botón **"Enviar factura 40%"** y el aviso "Factura aprobada y lista para enviarse…". Captura `e2e-64b-01-ficha-desktop-1280.png` |
| 3 | Click **"Enviar factura 40%"** | 200. Verificado en BD: COMUNICACION `E3` `enviado` creada (`es_reenvio=false`), `RESERVA.cond_part_enviadas_fecha` fijada (2026-07-15 06:51:44), `cond_part_firmadas=false`, factura sigue `enviada` con `numero` conservado. (El toast de éxito de sonner se auto-descarta.) |
| 4 | Re-click **"Enviar factura 40%"** (idempotencia) | 409 `E3_YA_ENVIADO`. La UI muestra el aviso inline **"La factura de señal ya se envió por E3 para la reserva"**. En BD: **exactamente 1** COMUNICACION E3 `enviado` (sin duplicado). Captura `e2e-64b-02-idempotencia-409.png` |

El único error de consola observado (`409 en /ficha-operativa`) es **ajeno** a esta
rebanada (la reserva sembrada no tiene ficha operativa; comportamiento pre-existente).

## 2. Responsive (regla dura — 3 viewports)

| Viewport | Captura | Observación |
|----------|---------|-------------|
| 390 (móvil) | `e2e-64b-03-mobile-390.png` | Navegación lateral colapsada a hamburguesa ("Abrir navegación"); tarjeta y botón "Enviar factura 40%" a ancho completo (`w-full`), objetivo táctil 44px (`h-11`); sin overflow horizontal |
| 768 (tablet) | `e2e-64b-04-tablet-768.png` | Layout intermedio correcto; botón `sm:w-auto` |
| 1280 (desktop) | `e2e-64b-01-ficha-desktop-1280.png` | Sidebar visible; layout completo |

## 3. Restauración

Dataset E2E **eliminado** de `slotify_dev` (COMUNICACION E3, AUDIT_LOG, FACTURA, RESERVA,
CLIENTE) en transacción con contexto RLS. Verificado post-limpieza: la BD dev vuelve a su
estado original (3 reservas, 0 facturas, 3 clientes). Servidores dev detenidos al terminar.

**Veredicto del paso:** ✅ E2E verde — happy path (envío E3 con persistencia real),
idempotencia (409 sin duplicar) y responsive en 3 viewports. Capturas en
`reports/e2e-screenshots/`.
