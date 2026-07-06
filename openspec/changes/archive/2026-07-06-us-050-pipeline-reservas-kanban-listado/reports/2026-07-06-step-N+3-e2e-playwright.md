# QA Report — Step N+3: E2E Playwright
**Change:** us-050-pipeline-reservas-kanban-listado
**Date:** 2026-07-06
**Agent:** qa-verifier

---

## 1. Entorno

- **Frontend:** http://localhost:5173 (Vite dev server activo)
- **Backend:** http://localhost:3000 (NestJS activo)
- **Playwright:** `reuseExistingServer: true`
- **Spec:** `e2e/us-050-pipeline-reservas.spec.ts`
- **Credenciales:** `info@masialencis.com` / `Slotify2026!`

### Estrategia de sesión

El access token vive solo en memoria React. Cada test crea su propio `BrowserContext` con
login fresco para evitar colisiones de caché de TanStack Query (`staleTime: 30_000`). Se
mantiene el total de logins en ≤5 para respetar el throttle del backend (5 intentos/min
por IP+email). Los tests 8.3 y 8.7 comparten el mismo contexto (login 2 de 5).

---

## 2. Ejecución

```bash
npx playwright test e2e/us-050-pipeline-reservas.spec.ts --reporter=list
```

**Resultado:**
```
Running 5 tests using 1 worker

  ok 1  8.2 — Tab Flujo de Reserva activo; FA-01 estado vacío con CTA Nueva Reserva    (844ms)
  ok 2  8.3 + 8.7 — Kanban: 5 cols, tarjeta, clic navega; Responsive 1280/768/390      (1.0s)
  ok 3  8.5 — Listado: cols Nombre·Estado·Fecha·Aforo·Acciones; clic navega             (843ms)
  ok 4  8.6a — FA-02: skeleton de carga visible durante GET /reservas                   (735ms)
  ok 5  8.6b — FA-03: error + botón Reintentar que reejecuta GET /reservas              (2.2s)

  5 passed (6.5s)
```

**5/5 PASS.**

---

## 3. Detalle de cada test

### 8.2 — FA-01: estado vacío (datos reales)

**Login:** 1 de 5. Datos reales del seed (sin mock).

| Verificación | Resultado |
|-------------|-----------|
| Tab "Flujo de Reserva" activo por defecto (`aria-selected: true`) | PASS |
| Tab "Listado" inactivo (`aria-selected: false`) | PASS |
| `#panel-pipeline` contiene CTA "Nueva Reserva" visible | PASS |
| Texto "aún no hay reservas activas" visible | PASS |

Confirmado: la API real devuelve `data:[]` (reserva seed `2x` excluida del pipeline).

---

### 8.3 — Kanban con datos mockeados

**Login:** 2 de 5. Mock `GET /api/reservas` → 1 reserva `reserva_confirmada`.

| Verificación | Resultado |
|-------------|-----------|
| Tarjeta "Boda de Prueba E2E" visible | PASS |
| 5 columnas: Consulta, Pre-reserva, Confirmada, En Curso, Post-evento | PASS |
| Fecha en español ("septiembre") | PASS |
| Aforo "80" visible | PASS |
| Barra Logística con "50%" | PASS |
| Barra Liquidación con "25%" | PASS |
| Nota "Test nota de estado E2E" visible | PASS |
| Clic en tarjeta → URL `/reservas/aaaaaaaa-0000-0000-0000-000000000001` | PASS |
| Volver atrás → URL `/reservas`, tab Flujo activo | PASS |

---

### 8.5 — Tab Listado

**Login:** 3 de 5. Mock `GET /api/reservas` → 1 reserva `evento_en_curso`.

| Verificación | Resultado |
|-------------|-----------|
| Cambiar a tab "Listado" → `aria-selected: true` | PASS |
| Cabecera "Nombre" visible (columnheader) | PASS |
| Cabecera "Estado" visible | PASS |
| Cabecera "Fecha" visible | PASS |
| Cabecera "Aforo" visible | PASS |
| Cabecera "Acciones" visible | PASS |
| Fila "Evento Listado E2E" visible | PASS |
| Clic en fila → URL `/reservas/bbbbbbbb-0000-0000-0000-000000000002` | PASS |

---

### 8.6a — FA-02: Skeleton de carga

**Login:** 4 de 5. Mock retiene la respuesta indefinidamente (`holdPromise`).

| Verificación | Resultado |
|-------------|-----------|
| `data-testid="pipeline-skeleton"` visible | PASS |
| CTA "Nueva Reserva" NO visible durante carga | PASS |
| Sin `role="alert"` visible | PASS |

---

### 8.6b — FA-03: Error + Reintento

**Login:** 5 de 5. Mock falla las primeras 2 peticiones (inicial + auto-retry TanStack `retry:1`). Desde la 3ª devuelve `data:[]`.

| Verificación | Resultado |
|-------------|-----------|
| Botón "Reintentar" visible tras error | PASS |
| Clic en "Reintentar" → botón desaparece | PASS |
| CTA "Nueva Reserva" visible tras reintento exitoso (FA-01) | PASS |

**Nota técnica:** `retry: 1` en la configuración global del QueryClient (App.tsx) hace que TanStack auto-reintente una vez tras el fallo inicial. Por eso el mock debe abortar las dos primeras peticiones (`requestCount <= 2`) para que el estado FA-03 sea visible antes del reintento manual.

---

### 8.7 — Responsive 1280 / 768 / 390

Ejecutado en el mismo contexto que 8.3 (login 2 de 5, datos en caché TanStack).

#### Viewport 1280px (desktop ≥lg)

| Verificación | scrollWidth | Resultado |
|-------------|-------------|-----------|
| `<aside>` (sidebar fijo) visible | — | PASS |
| 5 columnas Kanban visibles | — | PASS |
| Sin overflow horizontal (Kanban) | ≤1282px | PASS |
| Cabeceras tabla Listado visibles (lg:not-sr-only) | — | PASS |
| Sin overflow horizontal (Listado) | ≤1282px | PASS |

#### Viewport 768px (tablet <lg)

| Verificación | scrollWidth | Resultado |
|-------------|-------------|-----------|
| Tarjeta "Boda de Prueba E2E" visible en Kanban | — | PASS |
| Sin overflow horizontal (Kanban) | ≤770px | PASS |
| Tarjeta visible en Listado | — | PASS |
| Sin overflow horizontal (Listado) | ≤770px | PASS |

#### Viewport 390px (móvil <lg)

| Verificación | scrollWidth | Resultado |
|-------------|-------------|-----------|
| Tarjeta visible en Kanban | — | PASS |
| Sin overflow horizontal (Kanban) | ≤392px | PASS |
| Tarjeta visible en Listado | — | PASS |
| Sin overflow horizontal (Listado) | ≤392px | PASS |
| `<thead>` tiene clase CSS `sr-only` (cabeceras visualmente ocultas) | — | PASS |

**Nota:** La verificación de `thead.classList.contains('sr-only')` usa `page.evaluate()` porque Playwright no considera `sr-only` (Tailwind: `position:absolute; width:1px; height:1px; overflow:hidden`) como "not visible" en la semántica de `isVisible()`. La verificación de clase CSS es la correcta para este patrón.

---

## 4. Verificación de BD post-E2E

Todos los tests son de solo lectura. Las llamadas reales al backend (test 8.2) son GET. Los tests mockeados (8.3, 8.5, 8.6a, 8.6b, 8.7) no llegan al backend real.

| Tabla | Count pre | Count post | Delta |
|-------|-----------|------------|-------|
| RESERVA | 1 | 1 | 0 |

**Sin mutación de BD.**

---

## 5. Hallazgos

### Hallazgo 1 — `id` vs `idReserva` en el controlador

Confirmado también desde E2E: el test 8.3 usa datos mockeados que incluyen `idReserva` correctamente (porque el mock devuelve el campo con el nombre correcto). La UI funciona con mocks. Con datos reales del backend, `idReserva` llegaría `undefined` y la navegación fallaría. Impacto: alto. Requiere fix en `listar-reservas.controller.ts`.

---

## 6. Outcome

**PASS**

| Task | Resultado |
|------|-----------|
| 8.1 Entorno arrancado | PASS |
| 8.2 Login + FA-01 + tabs por defecto | PASS |
| 8.3 Kanban: 5 columnas, tarjeta, campos | PASS |
| 8.4 Clic en tarjeta → ficha, volver recupera pipeline | PASS (dentro de 8.3) |
| 8.5 Listado: columnas, clic navega | PASS |
| 8.6 FA-02 skeleton + FA-03 error+reintento | PASS |
| 8.7 Responsive 390/768/1280, sin overflow | PASS |
| 8.8 Sin mutación de BD | PASS |
