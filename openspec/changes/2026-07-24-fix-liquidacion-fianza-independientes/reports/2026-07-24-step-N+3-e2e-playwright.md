# QA — E2E Playwright (multi-viewport)

Change: `fix-liquidacion-fianza-independientes` · Fecha: 2026-07-24 · Web `http://localhost:5273` (Vite, CORS→API 3100). Login por UI: `info@masialencis.com`.

## Flujo
Login por formulario → `/dashboard` → navegación a la ficha `/reservas/{id}` de una reserva `reserva_confirmada` sembrada. La app mantiene sesión (refresh cookie) tras recarga; 0 errores de consola bloqueantes (los 404 `factura-senal` y 409 `ficha-operativa` son estados esperados manejados por las tarjetas).

## Orden de secciones verificado (snapshot de accesibilidad)
Datos del lead → Detalles del evento → Acciones → **Factura de señal** → **Factura de liquidación** → Ficha operativa → Firma de condiciones particulares → **Fianza** → Comunicaciones.

- **Factura de liquidación** (debajo de señal): tarjeta espejo de la señal; muestra desglose (Base 495,87 € · IVA 104,13 € · Total 600,00 €), estado borrador, "El PDF de la factura se está generando" + acción "Regenerar PDF".
- **Fianza** (pasiva): "Comprobante de fianza pendiente. Sube el comprobante de la transferencia cuando la recibas. **Es opcional y no bloquea el inicio del evento**." + botón "Subir comprobante de fianza". Sin UI de emisión/recibo/cobro.

## Viewports
- **1280** (desktop) — `e2e-screenshots/e2e-ficha-desktop-1280.png`.
- **390** (móvil) — `e2e-screenshots/e2e-ficha-mobile-390.png`: una sola columna, tarjetas y botones a ancho completo, **sin overflow horizontal**, objetivos táctiles amplios. Cumple mobile-first.

(768 no capturado explícitamente; el layout es fluido de una columna entre 390 y <lg — sin puntos de ruptura intermedios propios de estas tarjetas.)

**Veredicto**: la UI renderiza las nuevas tarjetas con el orden y el comportamiento pasivo/opcional esperados, en desktop y móvil.
