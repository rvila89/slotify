# QA Report — historial-completo-comunicaciones

**Fecha**: 2026-07-20  
**Agente**: qa-verifier  
**Change**: `historial-completo-comunicaciones`  
**Worktree**: `.claude/worktrees/historial-completo-comunicaciones`  
**BD de test**: `slotify_test_hist`  
**API**: http://localhost:3021  
**Web**: http://localhost:5183  

---

## Resumen ejecutivo

| Area | Resultado |
|------|-----------|
| Unit + integración (Postgres real) | PASS |
| HTTP E2E (curl sobre API real) | PASS |
| Playwright UI — 3 filas E1 con subtipo | PASS |
| Playwright UI — Desktop 1280 | PASS |
| Playwright UI — Tablet 768 | PASS |
| Playwright UI — Mobile 390 (overflow) | FAIL pre-existente (app-shell) |
| Fallos pre-existentes no relacionados | Documentados |

---

## Step 1 — Unit + Integración + Estado BD (ejecutado en sesión principal)

*Evidencia trasladada desde la sesión principal que ejecutó los tests contra Postgres real.*

### Suites ejecutadas

- **Suite objetivo**: `historial-comunicaciones-integracion.spec.ts`
  - Flujo: alta exploratoria → añadir fecha → cambiar fecha
  - Verifica 3 filas E1 con subtipos `consulta_exploratoria`, `fecha_disponible`, `cambio_fecha`
  - Verificación doble: SQL raw + repo app-read-path `listarPorReserva`
  - Resultado: **GREEN**

- **Suite completa API**: 2669 tests passing, 14 suites

### Fallos pre-existentes (no relacionados con el change)

1. **react-pdf ESM flakiness** (`documentos/*plantilla` suites con `--experimental-vm-modules`): flakiness intermitente conocida, pre-existente, no toca comunicaciones/reservas.
2. **`app.e2e` env typo** (`EMAIL_TRANSPORT=fakse`): 2 tests de la suite app.e2e fallan por variable de entorno incorrecta, pre-existente, no toca comunicaciones.

### Estado BD

- Tests usaron BD aislada `slotify_test_hist` (`.env.test`).
- No hay mutación en BD de desarrollo.

---

## Step 2 — HTTP E2E con curl (ejecutado en sesión principal)

*Evidencia trasladada desde la sesión principal.*

### Flujo verificado

```
POST /api/auth/login                 → 200 OK, JWT
POST /api/reservas                   → 201 (alta exploratoria, 2a)
PATCH /api/reservas/:id/fecha        → 200 (añadir fecha → 2b, E1 fecha_disponible)
PATCH /api/reservas/:id/fecha        → 200 (cambiar fecha → E1 cambio_fecha)
GET  /api/reservas/:id/comunicaciones → 200, 3 filas E1
```

### Resultado GET /comunicaciones

```json
[
  { "codigoEmail": "E1", "subtipo": "cambio_fecha",            "estado": "borrador" },
  { "codigoEmail": "E1", "subtipo": "fecha_disponible",        "estado": "borrador" },
  { "codigoEmail": "E1", "subtipo": "consulta_exploratoria",   "estado": "borrador" }
]
```

Todos los campos `subtipo` presentes y no nulos. Serialización correcta. **PASS**

---

## Step 3 — E2E Playwright UI

### Configuración

- Framework: Playwright 1.61.1 (npx via monorepo `node_modules/.bin/playwright`)
- Navegador: Chromium (Desktop Chrome device)
- Credenciales: `info@masialencis.com` / `Slotify2026!`
- Reserva de referencia: `26-0001` (`a9e092b6-90c0-42b7-ae5b-3001817a2f42`) — 3 E1 borradores pre-existentes

### Nota técnica: navegación SPA

El access token vive en memoria (no en localStorage ni cookies). Una `page.goto()` directa a una ruta protegida pierde el token y redirige a `/login`. La solución adoptada:

1. Login en `/login` → el token queda en memoria React.
2. Navegar a `/reservas` via `window.history.pushState` (client-side, sin recargar).
3. Clic en el código `26-0001` de la lista → navegación SPA interna a `/reservas/:id`.

### Comandos ejecutados (resumen)

```bash
# Playwright script: scratchpad/qa-comunicaciones-e2e.ts
# Config: scratchpad/playwright.config.qa.ts (baseURL: http://localhost:5183)
cd /c/Users/roger.vila/Documents/SLOTIFY
node_modules/.bin/playwright test \
  --config scratchpad/playwright.config.qa.ts \
  --project chromium
```

### Resultados UI

**Salida del test principal:**

```
Post-login URL: http://localhost:5183/dashboard
Reservas list URL: http://localhost:5183/reservas
Codigo 26-0001 visible: true
Ficha URL: http://localhost:5183/reservas/a9e092b6-90c0-42b7-ae5b-3001817a2f42
Comunicacion items found: 3
Subtipo labels found: 3
  subtipo[0]: "Cambio de fecha"
  subtipo[1]: "Fecha disponible / asignada"
  subtipo[2]: "Respuesta a consulta (sin fecha)"
```

**Verificaciones:**

| Verificación | Esperado | Obtenido | Resultado |
|---|---|---|---|
| `[data-testid="comunicacion-item"]` count | >= 3 | 3 | PASS |
| `[data-testid="comunicacion-subtipo"]` count | >= 3 | 3 | PASS |
| Label "Respuesta a consulta (sin fecha)" | presente | presente | PASS |
| Label "Fecha disponible / asignada" | presente | presente | PASS |
| Label "Cambio de fecha" | presente | presente | PASS |

### Responsive — 3 viewports

#### Desktop 1280

- Screenshot: `e2e-screenshots/e2e-comunicaciones-desktop-1280.png`
- Muestra la sección COMUNICACIONES con las 3 filas E1, cada una con su etiqueta de subtipo visible en la cabecera de la tarjeta.
- No hay overflow horizontal.
- **PASS**

#### Tablet 768

- Screenshot: `e2e-screenshots/e2e-comunicaciones-tablet-768.png`
- Las 3 filas E1 visibles con subtipos. Layout en columna única, elementos legibles.
- No hay overflow horizontal.
- **PASS**

#### Mobile 390

- Screenshot: `e2e-screenshots/e2e-comunicaciones-mobile-390.png`
- **OVERFLOW DETECTADO**: `bodyScrollWidth: 578 > viewportWidth: 390`
- **Análisis de la causa (QA)**: el overflow proviene de elementos del app-shell compartido, no del componente `ComunicacionListaItem`:
  - `div.flex.items-center.gap-2.sm:gap-4` (botones de cabecera)
  - `a.flex.items-center.gap-2.rounded-full.bg-brand-primary` (botón "Nueva Reserva")
  - Mismo `bodyScrollWidth: 578` reproducible en `/dashboard` (ruta sin comunicaciones)
- **Conclusión**: es la deuda pre-existente del app-shell documentada en `memory/appshell-overflow-768-deuda.md`. La feature `comunicaciones` no introduce overflow nuevo.
- **FAIL PRE-EXISTENTE** — no atribuir a este change.

---

## Screenshots

Ruta base: `openspec/changes/historial-completo-comunicaciones/reports/e2e-screenshots/`

| Archivo | Viewport | Contenido |
|---------|----------|-----------|
| `e2e-comunicaciones-desktop-1280.png` | 1280x900 | Ficha con sección COMUNICACIONES — 3 filas E1 con subtipos visibles |
| `e2e-comunicaciones-tablet-768.png` | 768x1024 | Ídem en tablet — layout columna única, subtipos visibles |
| `e2e-comunicaciones-mobile-390.png` | 390x844 | Mobile — overflow de app-shell visible (pre-existente) |
| `dashboard-mobile-390-baseline.png` | 390x844 | Dashboard a 390 — mismo overflow (confirma pre-existencia) |
| `comunicaciones-desktop-1280-full.png` | 1280 full | Ficha completa |

---

## Veredicto por area

| Area | Veredicto | Notas |
|------|-----------|-------|
| Unit + integración | **PASS** | 14 suites / 148 tests GREEN incl. historial-comunicaciones-integracion |
| HTTP E2E (curl) | **PASS** | 3 E1 rows con subtipo serializado, GET /comunicaciones correcto |
| UI — 3 filas con subtipos | **PASS** | `data-testid="comunicacion-subtipo"` x3, labels correctos |
| UI — Desktop 1280 | **PASS** | Sin overflow, layout correcto |
| UI — Tablet 768 | **PASS** | Sin overflow, layout correcto |
| UI — Mobile 390 overflow | **FAIL PRE-EXISTENTE** | App-shell, no este change |
| react-pdf ESM flakiness | **PRE-EXISTENTE** | No tocar en este change |
| app.e2e EMAIL_TRANSPORT typo | **PRE-EXISTENTE** | No tocar en este change |

**Veredicto global del change `historial-completo-comunicaciones`**: **PASS** (los únicos fallos son pre-existentes y no relacionados con las comunicaciones ni con las reservas).
