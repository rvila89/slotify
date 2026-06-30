# Step 8 — E2E con Playwright
## Change: us-039-consultar-calendario
## Fecha: 2026-06-30
## Agente: qa-verifier

---

## 1. Entorno

- Frontend: Vite + React en http://localhost:5173 (ya en ejecución)
- Backend: NestJS en http://localhost:3000 (ya en ejecución)
- Playwright: 1.61.1, proyecto `chromium`
- Spec E2E: `e2e/us-039-calendario.spec.ts` (creado por qa-verifier)
- Estrategia de sesión: `test.describe.configure({ mode: 'serial' })` + contexto compartido (login único — igual que US-003/US-004 para preservar el access token en memoria React)

---

## 2. Seed de datos de prueba (pre-E2E)

Insertados directamente en BD con tag `@qa-e2e-039.test`:

| Fecha | Estado/SubEstado | Color esperado | Cola |
|-------|-----------------|----------------|------|
| 2026-07-15 | consulta/s2b | gris | 1 (s2d apuntando) |
| 2026-07-22 | pre_reserva | ambar | 0 |
| 2026-07-28 | reserva_confirmada | verde | 0 |

Los IDs de reserva: `2da089be` (gris), `793da8c1` (ambar), `c6554648` (verde).

---

## 3. Tests E2E ejecutados

Comando: `npx playwright test e2e/us-039-calendario.spec.ts --project=chromium`

| Test | Descripción | Resultado |
|------|-------------|-----------|
| 1 | El calendario es la página de inicio tras login | PASS |
| 2 | Vista mensual julio 2026 con código de colores canónico (gris/ámbar/verde) | PASS |
| 3 | Cambio de vista Mes→Semana→Día→Lista mantiene coherencia | PASS |
| 4 | Indicador 🔁 N en cola sobre fecha bloqueante | PASS |
| 5 | Clic en evento gris → popover con cliente/estado/TTL/enlace a ficha | PASS |
| 6 | Mes vacío (junio 2026) es navegable sin errores | PASS |
| 7a | Responsive 390px (móvil) — sin overflow, drawer accesible | PASS |
| 7b | Responsive 768px (tablet) — sin overflow, calendario visible | PASS |
| 7c | Responsive 1280px (escritorio) — sidebar fijo, calendario completo | PASS |

**Total: 9 tests / 9 PASS — 10.8 s**

---

## 4. Detalle de resultados por test

### Test 1 — Calendario como página de inicio
- Login en `/login` → redirección a `/calendario` en < 15 s ✓
- Heading "Calendario de disponibilidad" visible ✓
- Sidebar `aside` con link "Calendario" visible (desktop 1280px) ✓
- `.rbc-calendar` renderizado ✓
- Botones de navegación "Período anterior", "Período siguiente", "Hoy" visibles ✓
- Tabs de vista (Mes/Semana/Día/Lista) con `role="tab"` visibles ✓
- Leyenda "Consulta activa" y "Pre-reserva" visible ✓

### Test 2 — Código de colores canónico
- Navegación a julio 2026 usando "Período siguiente" ✓
- `count >= 2` eventos en `.rbc-event` ✓
- `.rbc-event.bg-cal-gris` visible (consulta 2b, Ana Garcia) ✓
- `.rbc-event.bg-cal-ambar` visible (pre_reserva, Luis Perez) ✓
- `.rbc-event.bg-cal-verde` visible (confirmada, Maria Lopez) ✓
- Fechas libres no aparecen como eventos ✓

### Test 3 — Cambio de vista
- Vista Mes activa: `aria-selected="true"` en tab Mes, `.rbc-month-view` visible ✓
- Cambio a Semana: `.rbc-time-view` visible ✓
- Cambio a Día: `.rbc-time-view` visible ✓
- Cambio a Lista: `.rbc-agenda-view` visible ✓
- Vuelta a Mes: mismo número de eventos que en la primera carga (mismo dataset) ✓

### Test 4 — Indicador de cola
- `[aria-label*="en cola"]` visible con count >= 1 en el evento del 15/07/2026 ✓
- El indicador tiene `aria-label="1 en cola"` y `title="1 en cola"` ✓

### Test 5 — Popover de detalle
- Clic en `.rbc-event.bg-cal-gris` (primer evento gris) ✓
- Popover (role="dialog") abierto ✓
- `getByRole('dialog').getByText('Ana Garcia')` visible ✓
- Link "Ver ficha de la reserva" visible ✓
- Link "Ver cola" visible (enCola=1 activa el enlace a la cola) ✓
- Nota sobre popover mobile: el popover se ancla con `side="bottom"` y `sideOffset=-240` — en móvil aparece centrado sobre el tablero, usable (verificado en test 7a)

### Test 6 — Mes vacío
- Botón "Hoy" navega al mes actual (junio 2026, sin datos seed) ✓
- Sin `role="alert"` de error ✓
- `.rbc-month-view` sigue renderizado y navegable ✓
- `count = 0` eventos en el mes vacío ✓

### Test 7a — Responsive 390px (móvil)
- Sin overflow horizontal: `scrollWidth <= clientWidth` ✓
- `.rbc-calendar` visible en móvil ✓
- Heading visible ✓
- Botón hamburguesa `aria-label="Abrir navegación"` visible ✓
- Botón "Período anterior" con bounding box height >= 40px (objetivo táctil accesible) ✓
- Popover en móvil: clic en evento → `getByRole('dialog').getByText('Ana Garcia')` visible ✓

### Test 7b — Responsive 768px (tablet)
- Sin overflow horizontal ✓
- `.rbc-calendar` visible ✓
- Botón hamburguesa visible (768 < lg=1024, sidebar en drawer) ✓
- Tab "Mes" visible ✓

### Test 7c — Responsive 1280px (escritorio)
- `aside` (sidebar fijo) visible en ≥lg ✓
- Botón hamburguesa NO visible en desktop ✓
- Sin overflow horizontal ✓
- `.rbc-calendar`, `.rbc-month-view` visibles ✓
- Los 4 tabs de vista visibles ✓
- Botones de navegación visibles ✓

---

## 5. Observaciones sobre el popover en móvil

El PopoverContent usa `side="bottom"` y `sideOffset=-240` — al estar anclado al `PopoverAnchor` (el div contenedor del tablero), en móvil el popover se pinta centrado sobre el tablero, superpuesto parcialmente. Esto es funcional y usable: el contenido del popover es accesible, el enlace "Ver ficha" es clicable, y el popover se puede cerrar con Escape. No hay overflow horizontal ni scroll bloqueado. Se considera APTO para MVP (mejora de posicionamiento delegable a iteración futura de UX).

---

## 6. Verificación de persistencia y no-mutación

Tras los 9 tests E2E (todos GETs en el calendario), la BD no sufrió mutación en RESERVA ni FECHA_BLOQUEADA:
- RESERVA: 9 + temporales seed E2E (eliminados en cleanup)
- FECHA_BLOQUEADA: 0 + temporales seed E2E (eliminados en cleanup)
- AUDIT_LOG: creció de 81 a 102 — exclusivamente por eventos de login del gestor (21 logins durante QA). Los GETs al calendario NO generan audit logs (lectura pura).

---

## 7. Restauración de BD

Eliminados todos los datos seed con tag `@qa-e2e-039.test`:
- 4 clientes, 5 reservas (incluida la de cola), 3 fechas_bloqueadas

| Tabla | Post-cleanup | Correcto |
|-------|-------------|---------|
| RESERVA total | 9 | SI |
| FECHA_BLOQUEADA total | 0 | SI |

BD restaurada al baseline ✓.

---

## 8. Hallazgos E2E

| # | Severidad | Descripción | Impacto |
|---|-----------|-------------|---------|
| E-1 | Info | El popover en móvil se ancla centrado sobre el tablero (offset -240px) en lugar de al lado del evento clicado. Es usable y accesible pero no ideal en pantallas pequeñas. | Cosmético. No bloquea. Deuda UX para iteración futura. |
| E-2 | Info (ya reportado en Step 7) | `GET /calendario?desde=2026-08-31&hasta=2026-08-01` devuelve 200 + `fechas:[]` en vez de 422. | No bloquea. Deuda de validación cross-field en DTO. |

---

## Outcome: PASS

9/9 tests E2E en verde (10.8 s). Responsive verificado en 390/768/1280 sin overflow. Popover funcional en móvil. BD restaurada. Sin bloqueantes.
