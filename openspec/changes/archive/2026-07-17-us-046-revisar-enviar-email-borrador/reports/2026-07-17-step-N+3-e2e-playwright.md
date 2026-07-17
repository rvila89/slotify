# QA — Paso N+3: E2E Playwright (US-046)

Fecha: 2026-07-17 · Ejecutado por: sesión principal (Playwright MCP) · Web `http://localhost:5174` · API `http://localhost:3002` (transporte fake).

> El E2E lo ejecuta la sesión principal (necesita web + api + navegador). Gotcha conocido
> confirmado: navegar con `goto` a una ruta protegida recarga la SPA y pierde el access
> token en memoria → redirige a `/login`; la navegación válida es dentro de la SPA (el
> `RequireAuth` recuerda la ruta destino y, tras el login por UI, redirige de vuelta a la
> ficha). El CORS del API exige `WEB_URL` = origen real del front (aquí 5174).

## Flujo verificado (happy path + estados)

1. **Login por UI** (`info@masialencis.com`) → `/dashboard`. OK.
2. **Ficha de la reserva** (`/reservas/{R1}`) → sección **"Comunicaciones"** renderizada con
   la lista completa: badges `Borrador` / `Enviado` / `Fallido`, filas `enviado`/`fallido`
   en **solo lectura** (sin botones) y filas `borrador` **accionables** ("Revisar y enviar",
   "Descartar"), más el botón "Nuevo email manual". OK.
3. **Revisar y enviar** sobre el borrador E4: el diálogo muestra `Tipo de email` y
   `Destinatario` en **solo lectura** y precarga **Asunto** y **Cuerpo** con el contenido
   real del borrador (`<p>Contenido visible del borrador…</p>`). → **confirma el fix del
   bug 1**: antes el cuerpo llegaba `null` y el diálogo salía vacío. Captura:
   `e2e-screenshots/e2e-us046-revisar-borrador-dialog.png`.
4. **Enviar** → 200; la lista se refresca (invalidación de query) y la fila E4 pasa a
   **`Enviado`** con su marca temporal y **pierde** los botones de acción (idempotencia UI). OK.
5. **Responsive en los 3 viewports** (regla dura del proyecto 390 / 768 / 1280): la sección
   se adapta sin romperse y **sin overflow horizontal** en ninguno. Capturas:
   - `e2e-screenshots/e2e-us046-comunicaciones-mobile-390.png` (móvil: columna única, botones a ancho completo).
   - `e2e-screenshots/e2e-us046-comunicaciones-tablet-768.png` (tablet: grids de metadatos a 2 columnas).
   - `e2e-screenshots/e2e-us046-comunicaciones-desktop-1280.png` (escritorio: layout amplio).

Consola del navegador: **0 errores** en todo el flujo.

## Cobertura de acciones destructivas/errores

Las variantes de error (409 estado no borrador, 422 destinatario inválido, 502 proveedor) y
el descarte / email manual se verificaron exhaustivamente por **curl** (ver
`2026-07-17-step-N+2-curl-endpoint-tests.md`), incluidos los 3 bugs detectados y corregidos.
El E2E cubre el recorrido de UI y la integración front↔API↔BD del happy path y los estados de
la lista.

Veredicto del paso: **PASS**.
