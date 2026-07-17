# QA · Paso N+3 — E2E con Playwright (US-033)

Fecha: 2026-07-17 · Web `http://localhost:5174` (vite dedicado de este worktree) → API `http://localhost:3001` (test DB). Rol gestor. Ejecutado desde la **sesión principal**.

## Flujo verificado

1. **Login** UI (`info@masialencis.com`) → dashboard. JWT en memoria.
2. **Gotcha SPA-nav confirmado**: `goto` directo a `/reservas/:id` pierde el JWT y rebota a `/login`. Se accede correctamente vía navegación intra-SPA (el guard preserva la ruta destino y, tras el login, aterriza en la ficha).
3. **Ficha de reserva** en `evento_en_curso` → sección **"Documentación del evento"** visible con:
   - Aviso informativo **no bloqueante**: "Quedan **1** documento pendiente. … no bloquea la finalización del evento."
   - `dni_anverso` y `clausula_responsabilidad` registrados (reflejan el estado real de BD del paso N+2), con enlace al fichero y tamaño; **la referencia del anverso apunta al documento más reciente** (`863aeffa…` = re-subida v2) → no-idempotencia visible en UI.
   - `dni_reverso` pendiente con "Subir documento".
4. **Subida por UI** (`dni_reverso`, JPEG) → multipart FormData real → 201 → **checklist se refresca en tiempo real** sin recargar: el ítem pasa a "Documento registrado" y el aviso cambia a verde **"Documentación completa. Los tres documentos obligatorios del evento están registrados."**
5. **Validación de formato en cliente** (criterio de aceptación): al intentar subir un `.txt` en `dni_reverso`, aparece alerta inline **"Formato no admitido. Por favor, usa JPEG, PNG o PDF."** y **no** se envía petición ni cambia el documento.

## Responsive (regla dura — 3 viewports)

Capturas de página completa en `reports/e2e-screenshots/`:
- `us033-documentacion-390.png` (móvil): filas apiladas, botones full-width, sin overflow horizontal.
- `us033-documentacion-768.png` (tablet).
- `us033-documentacion-1280.png` (escritorio): filas en horizontal (`sm:flex-row`).

Sin overflow horizontal ni desbordes en ninguno de los tres anchos.

## Notas

- 1 error de consola no bloqueante (icono/recurso), 2 warnings; no afectan al flujo.
- Datos de prueba sembrados bajo email `@us033-curl.test`; limpiables por patrón.

**Veredicto paso N+3: OK.**
