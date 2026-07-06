# Step N+3 — E2E con Playwright (2026-07-06)

## Módulo: US-044 Visualizar Dashboard Operativo

### Setup

- Frontend: Vite SPA en `http://localhost:5173`
- Backend: NestJS en `http://localhost:3000` (slotify_dev)
- Herramienta: Playwright 1.61.1 (chromium), spec en `e2e/us-044-dashboard.spec.ts`
- Auth: `info@masialencis.com / Slotify2026!` (seed Masia l'Encís)
- Estrategia de sesión: login único en `beforeAll` + contexto compartido (SPA navigation — token en memoria React)

### Comandos ejecutados

```
npx playwright test e2e/us-044-dashboard.spec.ts --reporter=list
```

### Resultados

```
Running 7 tests using 1 worker

  ok 1  1280 — sidebar muestra entrada Dashboard y navega a /dashboard (103ms)
  ok 2  1280 — los 7 widgets se renderizan con su título en español (49ms)
  ok 3  1280 — pipeline activo contiene item con enlace a /reservas/:id (16ms)
  ok 4  1280 — sin overflow horizontal (16ms)
  ok 5  768 (tablet) — 7 widgets visibles y sin overflow (127ms)
  ok 6  390 (móvil) — 7 widgets visibles, hamburger nav, no overflow (112ms)
  ok 7  estado vacío — widget sin datos muestra mensaje específico sin romper los demás (28ms)

7 passed (2.3s)
```

### Escenarios verificados

#### 1. Sidebar con entrada "Dashboard" (§D-8)
El sidebar fijo en escritorio muestra "Dashboard" como primera opción de navegación.
Hacer clic en "Dashboard" navega correctamente a `/dashboard`. PASS.

#### 2. Título de la página
`h1` con texto "Dashboard operativo" visible tras navegar. PASS.

#### 3. Los 7 widgets con su título en español
Todos los widgets verificados con `getByRole('region', { name: <titulo> })`:
- "Hoy y mañana": PASS
- "Pipeline activo": PASS
- "Subprocesos críticos": PASS
- "Pendientes de acción": PASS
- "Consultas en cola": PASS
- "Visitas programadas": PASS
- "Próximos 30 días": PASS

#### 4. Item de widget con enlace a /reservas/:id (§FA-02)
El widget "Pipeline activo" contiene la reserva E2E-0001 con `href="/reservas/e2e00001-0000-0000-0000-000000000002"`. PASS.

#### 5. Estado vacío independiente por widget (§FA-01)
"Hoy y mañana" muestra "Sin eventos para hoy ni mañana" (sin datos) sin romper los otros 6 widgets, que siguen renderizándose correctamente. PASS.

### Verificación responsive (3 viewports)

Datos de columnas CSS computadas (`grid-template-columns`) y overflow:

| viewport | columnas CSS | overflow horizontal | nav |
|----------|-------------|---------------------|-----|
| 390 (móvil) | 1 col (358px) | scrollW=390, innerW=390 — PASS | Hamburger "Abrir navegación" visible |
| 768 (tablet) | 2 col (352px c/u) | scrollW=768, innerW=768 — PASS | Hamburger visible |
| 1280 (escritorio) | 3 col (≈298px c/u) | scrollW=1280, innerW=1280 — PASS | Sidebar `<aside>` fija |

Layout mobile-first verificado:
- `<lg` (390, 768): nav colapsa a drawer + botón hamburger ("Abrir navegación") — PASS
- `≥lg` (1280): sidebar `<aside>` fija permanentemente visible — PASS
- Sin overflow horizontal en ningún viewport — PASS

### Capturas de pantalla

- `dashboard-1280.png`: 3 columnas, sidebar fija, 7 widgets visibles, pipeline con E2E-0001
- `dashboard-768.png`: 2 columnas, hamburger, 7 widgets visibles
- `dashboard-390.png`: 1 columna, hamburger, widgets en lista vertical

### Comparación BD pre/post E2E — slotify_dev

| tabla             | pre | post-e2e | restaurado |
|-------------------|-----|----------|------------|
| reserva           | 1   | 1        | n/a        |
| fecha_bloqueada   | 1   | 1        | n/a        |
| pago              | 0   | 0        | n/a        |
| ficha_operativa   | 0   | 0        | n/a        |
| presupuesto       | 0   | 0        | n/a        |
| factura           | 0   | 0        | n/a        |
| cliente           | 1   | 1        | n/a        |

El dashboard es LECTURA PURA. Los tests E2E no mutaron la BD. No se requirió restauración.

### Restauración

No hubo mutaciones de BD durante los tests E2E. El entorno queda limpio.
Servidores de desarrollo (API puerto 3000, frontend puerto 5173) en funcionamiento para
su uso posterior. Se pueden detener manualmente.

### Outcome

**PASS**

Todos los escenarios E2E verificados:
- Login + navegación al dashboard via sidebar: PASS
- Los 7 widgets con título en español: PASS
- Grid responsive 1/2/3 columnas (390/768/1280): PASS
- Sin overflow horizontal en los 3 viewports: PASS
- Nav drawer en `<lg` + sidebar fija en `≥lg`: PASS
- Enlace de item a `/reservas/:id` (FA-02): PASS
- Estado vacío sin romper otros widgets (FA-01): PASS
- BD sin mutación (lectura pura): PASS
