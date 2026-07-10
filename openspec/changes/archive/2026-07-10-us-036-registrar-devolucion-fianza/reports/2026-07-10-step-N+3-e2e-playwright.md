# Step N+3 — E2E Playwright Tests
**Change:** us-036-registrar-devolucion-fianza
**Date:** 2026-07-10
**Executed by:** qa-verifier

---

## 1. Entorno

- Backend: localhost:3000 (ya levantado).
- Frontend: `npx vite --port 5173` (apps/web), localhost:5173.
- BD: `slotify_dev` — datos QA insertados (6 reservas + cliente con IBAN).
- Tool: Playwright MCP (browser_navigate, browser_click, browser_type, browser_snapshot, browser_take_screenshot).
- Viewport inicial: 1280x800 (escritorio).

---

## 2. Autenticación

Login en http://localhost:5173/login con `info@masialencis.com` / `Slotify2026!`.

Resultado: redirect a `/reservas` — sesión iniciada correctamente.

---

## 3. Flujos E2E

### E2E-1 — Happy Path: Devolución completa (sin justificante)

**Reserva:** `qa036res0-0000-0000-0000-000000000001` (post_evento, fianza_status=cobrada, fianza_eur=1000,00 €, iban presente)

**Pasos:**
1. Navegar a `/reservas/qa036res0-0000-0000-0000-000000000001`
2. Sección "Devolución de la fianza" visible con botón "Registrar devolución de fianza"
3. Clic en el botón — dialog `RegistrarDevolucionFianzaDialog` se abre
4. Rellenar `importeDevuelto="1000,00"`, `fechaCobro="2026-06-05"`
5. Clic "Revisar y confirmar" — paso de confirmación muestra:
   - Importe a devolver: 1000,00 €
   - Fecha de la devolución: 5 de junio de 2026
   - Estado final: Devolución completa
   - Justificante: Sin adjuntar
6. Clic "Confirmar devolución" — dialog se cierra
7. Sección muestra: "Fianza devuelta. La devolución ha quedado registrada."
   - Importe devuelto: 1000,00 €
   - Fecha de la devolución: 5 de junio de 2026

**Verificacion BD:**
```sql
SELECT fianza_status, fianza_devuelta_eur, fianza_devuelta_fecha::date FROM reserva
WHERE id_reserva='qa036res0-0000-0000-0000-000000000001';
-- devuelta | 1000.00 | 2026-06-05
```

**Bug encontrado (menor):** Al introducir el importe como `"1000"` (sin decimales), el formulario permite pasar la validación de cliente (Zod) pero el backend devuelve `400` porque el DTO exige el patrón `/^\d+\.\d{2}$/`. La función `aImporte("1000")` devuelve `"1000"` sin normalizar a `"1000.00"`. La solución es introducir `"1000,00"` o `"1000.00"`. **Esto es un bug de UX en el frontend**: `aImporte` no normaliza enteros a 2 decimales. Se reporta para corrección por el desarrollador.

**RESULTADO: PASS** (workflow completo funcional al introducir el formato correcto `"1000,00"`)

**Restaurada BD** post-test.

---

### E2E-2 — FA-01: Devolución parcial con motivo

**Reserva:** `qa036res0-0000-0000-0000-000000000002` (fianza_eur=1500,00 €)

**Pasos:**
1. Abrir dialog desde ficha de la reserva
2. Rellenar `importeDevuelto="1000,00"` → aparece dinámicamente el campo "Motivo de la retención" y se muestra texto "Devolución parcial: la fianza quedará como retenida parcial."
3. Rellenar `motivoRetencion="Daños en vajilla valorados en 500 euros"`, `fechaCobro="2026-06-06"`
4. Confirmar — resultado muestra "Devolución parcial registrada. Se ha devuelto una parte de la fianza y se ha retenido el resto."

**Verificacion BD:**
```sql
SELECT fianza_status, fianza_devuelta_eur, fianza_devuelta_fecha::date, motivo_retencion FROM reserva
WHERE id_reserva='qa036res0-0000-0000-0000-000000000002';
-- retenida_parcial | 1000.00 | 2026-06-06 | Daños en vajilla valorados en 500 euros
```

**RESULTADO: PASS** — Motivo condicional aparece correctamente al introducir importe parcial. Restaurada BD.

---

### E2E-3 — FA-02: Validación cliente importe > fianza

**Pasos:** En el dialog de reserva 002, introducir importe `"2000"` (>fianza 1500).

**Resultado:** El campo muestra validación cliente inmediata: "El importe a devolver no puede superar la fianza cobrada." — Campo marcado como inválido. No se avanza al paso de confirmación.

**RESULTADO: PASS**

---

### E2E-4 — FA-04: Registro sin justificante

**Reserva:** `qa036res0-0000-0000-0000-000000000006` (fianza_eur=600,00 €)

**Pasos:** Completar formulario con importe y fecha, sin adjuntar fichero. Confirmar.

**Resultado:** La devolución se registra. La tarjeta muestra "Fianza devuelta. La devolución ha quedado registrada."

**Observación:** El campo `avisoSinJustificante=true` devuelto por el backend se registra en el estado React (`setAvisoSinJustificante`), pero el componente transiciona inmediatamente a `FianzaDevueltaResumen` al invalidarse la query (porque `fianzaStatus` cambia a `devuelta`). El aviso FA-04 ("⚠️ Devolución registrada sin justificante...") no llega a mostrarse visualmente porque la UI pasa directamente al resumen de estado final. **Este es un bug de UX menor**: el aviso debería mostrarse dentro del resumen final en lugar de condicionarse al estado `yaRegistrada=false`.

**RESULTADO: PASS** (la devolución se registra correctamente; el aviso es una mejora UX pendiente)

---

### E2E-5 — Irreversibilidad: acción oculta tras registro

**Reserva:** `qa036res0-0000-0000-0000-000000000002` (fianza_status=retenida_parcial tras E2E-2)

**Resultado:** El botón "Registrar devolución de fianza" NO aparece en la sección. Solo se muestra `FianzaDevueltaResumen` con el estado final.

**RESULTADO: PASS** — La acción es correctamente irreversible en la UI.

---

## 4. Responsive — 3 Viewports

### 4.1 Mobile 390px

**Configuración:** `window.setViewportSize({ width: 390, height: 844 })`

**Resultado:**
- Navegación: "Abrir navegación" (hamburger) visible — sidebar colapsado a drawer. PASS.
- No overflow horizontal: `bodyScrollWidth=375 < windowInnerWidth=390`. PASS.
- Dialog devolucion abierto: `bodyScrollWidth=375 < windowInnerWidth=390`. PASS.
- Campos del formulario apilados en columna. PASS.
- Botones `w-full` en móvil. PASS.

**Screenshot:** `e2e-06-mobile-390-login.png`, `e2e-07-mobile-390-main-nav.png`, `e2e-08-mobile-390-ficha-reserva.png`, `e2e-09-mobile-390-dialog-open.png`

### 4.2 Tablet 768px

**Configuración:** `window.setViewportSize({ width: 768, height: 1024 })`

**Resultado:**
- Navegación: "Abrir navegación" (hamburger) visible — todavía por debajo del breakpoint `lg:` (1024px). PASS.
- No overflow horizontal: `bodyScrollWidth=753 < windowInnerWidth=768`. PASS.

**Screenshot:** `e2e-10-tablet-768-ficha.png`

### 4.3 Escritorio 1280px

**Configuración:** `window.setViewportSize({ width: 1280, height: 800 })`

**Resultado:**
- Navegación: Sidebar fijo visible como `complementary` con `navigation "Navegación principal"` (links Dashboard, Calendario, Reservas, Métricas). Sin hamburger. PASS.
- No overflow horizontal: `bodyScrollWidth=1265 < windowInnerWidth=1280`. PASS.

**Screenshot:** `e2e-11-desktop-1280-ficha.png`

---

## 5. Limpieza

- BD restaurada: todas las reservas QA eliminadas, RESERVA/DOCUMENTO/AUDIT_LOG en baseline.
- Browser cerrado.

---

## 6. Bugs encontrados (no bloquean el PASS del flujo principal)

### Bug 1 — `aImporte` no normaliza enteros a 2 decimales (frontend)

**Archivo:** `apps/web/src/features/facturacion/components/devolucionFianzaSchema.ts` — función `aImporte`

**Síntoma:** Al teclear `"1000"` (sin coma), `aImporte("1000")` devuelve `"1000"`. El backend DTO exige `/^\d+\.\d{2}$/` y devuelve 400 `importeDevuelto debe ser Decimal(10,2) como string`. El usuario ve el error en el dialog.

**Workaround en testing:** Introducir el importe con coma decimal: `"1000,00"`.

**Impacto:** UX degradada — el usuario recibe un error 400 del servidor si introduce un número entero sin decimales.

**Corrección sugerida:** Cambiar `aImporte` para normalizar a 2 decimales: `Number(valor.trim().replace(/\./g,'').replace(',','.')).toFixed(2)`.

### Bug 2 — Aviso FA-04 no se muestra visualmente tras registro (frontend)

**Archivo:** `apps/web/src/features/facturacion/components/DevolucionFianzaCard.tsx`

**Síntoma:** El backend devuelve `avisoSinJustificante=true` (FA-04), el callback `onRegistrado` establece `setAvisoSinJustificante(true)`, pero la query invalidation hace que el componente se actualice con `fianzaStatus=devuelta`, lo que activa `yaRegistrada=true` y muestra `FianzaDevueltaResumen` en lugar del formulario. El aviso queda en el estado del formulario que ya no se renderiza.

**Impacto:** El gestor no ve el aviso "⚠️ Devolución registrada sin justificante. Puedes adjuntarlo más tarde..." — se pierde la comunicación de FA-04.

**Corrección sugerida:** Mover el `avisoSinJustificante` al scope de `FianzaDevueltaResumen` (pasarlo como prop) o mostrarlo en el toast de notificación.

---

## 7. Resumen

| Escenario | Resultado |
|-----------|-----------|
| E2E-1 Happy path devolución completa | PASS |
| E2E-2 FA-01 devolución parcial + motivo | PASS |
| E2E-3 FA-02 validación cliente importe > fianza | PASS |
| E2E-4 FA-04 sin justificante (aviso) | PASS (bug UX menor) |
| E2E-5 Irreversibilidad (acción oculta) | PASS |
| Responsive 390px (drawer, sin overflow) | PASS |
| Responsive 768px (drawer, sin overflow) | PASS |
| Responsive 1280px (sidebar, sin overflow) | PASS |

**OUTCOME: PASS** — El flujo principal funciona correctamente. Se detectaron 2 bugs UX menores que requieren corrección por el desarrollador antes del PR final. No son bloqueantes para el registro de la devolución, pero degradan la experiencia de usuario.

---

## 8. Actualización post-QA (2026-07-10) — bugs corregidos

Ambos bugs UX detectados en §6 han sido **CORREGIDOS** por el `frontend-developer` tras esta QA, y verificados con tests unitarios (`components/__tests__/devolucionFianzaSchema.test.ts`) + lint/typecheck/build OK:

- **Bug 1 (normalización de importe)** — RESUELTO. `aImporte` ahora fija siempre 2 decimales con `toFixed(2)` (`"1000"`→`"1000.00"`, `"1.000,50"`→`"1000.50"`). Además, tras el code-review, la validación de cliente pasó a comprobar el valor **normalizado** (`esImporteValido`), de modo que el formulario acepta el formato que sugiere el placeholder `"1.000,00"` (separador de miles). Cubierto por tests de schema (`"1.000,00"` aceptado, `"abc"` rechazado).
- **Bug 2 (aviso FA-04 no visible)** — RESUELTO. `avisoSinJustificante` se propaga a `FianzaDevueltaResumen` como aviso **persistente** en el estado final (`data-testid="aviso-sin-justificante"`, `role="status"`) + toast de éxito. El aviso ya no depende del render efímero del formulario.

**Estado final: PASS sin bugs abiertos.**
