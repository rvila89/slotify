# Step 8 — E2E con Playwright (3 viewports)
## Change: us-006-extender-plazo-bloqueo
## Fecha: 2026-06-30
## Agente: qa-verifier

---

## 1. Entorno

- Frontend: `http://localhost:5173` (Vite dev server, React SPA)
- Backend: `http://localhost:3000` (NestJS)
- Playwright: v1.x, Chromium, sin headed/trace (headless)
- Spec: `e2e/us-006-extender-bloqueo.spec.ts` (creado por qa-verifier)
- Viewports probados: **390** (móvil) / **768** (tablet) / **1280** (escritorio)
- Sesión: login único en `beforeAll` → token React-in-memory; navegación via `navReact` (pushState + popstate) para mantener sesión

---

## 2. Datos de prueba (pre-E2E)

| Recurso | Descripción |
|---------|-------------|
| `3d8dd655` | RESERVA consulta/2b, TTL vigente, FechaBloqueada blanda creada por qa-verifier |
| `1abe5647` | RESERVA consulta/2a, sin FechaBloqueada (para verificar visibilidad condicional) |

---

## 3. Comandos ejecutados

```
npx playwright test e2e/us-006-extender-bloqueo.spec.ts --reporter=line
```

---

## 4. Resultados por test

| # | Viewport | Test | Resultado |
|---|----------|------|-----------|
| 1 | 1280 | 2a no muestra boton-extender-bloqueo (guarda visual) | PASS |
| 2 | 1280 | 2b con bloqueo vigente: muestra boton-extender-bloqueo | PASS |
| 3 | 1280 | Dialog se abre y muestra TTL actual | PASS |
| 4 | 1280 | Validación cliente: dias=0 muestra error sin mutar BD | PASS |
| 5 | 1280 | Happy path: extiende 7 días y muestra aviso con nuevo TTL | PASS |
| 6 | 1280 | Sin overflow horizontal en página ficha | PASS |
| 7 | 768 | 2b muestra boton-extender-bloqueo sin overflow | PASS |
| 8 | 768 | Dialog funciona y valida en tablet | PASS |
| 9 | 390 | 2b muestra boton-extender-bloqueo sin overflow | PASS |
| 10 | 390 | Dialog funciona en móvil (touch targets ≥ 48px) | PASS |
| 11 | 390 | Nav sin overflow en viewport móvil | PASS |

**Total: 11/11 PASS — Tiempo: 9.2 s**

---

## 5. Verificación responsive

### Verificación de overflow horizontal

| Viewport | scrollWidth ≤ clientWidth | Resultado |
|----------|--------------------------|-----------|
| 1280 (escritorio) | Sí (0px overflow) | PASS |
| 768 (tablet) | Sí (0px overflow) | PASS |
| 390 (móvil) | Sí (0px overflow) | PASS |

### Objetivos táctiles (móvil 390)

El botón "Extender bloqueo" (`boton-extender-bloqueo`) tiene clase `h-14` (56px height) ≥ 48px mínimo táctil.
El botón "Confirmar" del dialog (`confirmar-extender-bloqueo`) tiene clase `h-12` (48px height) = 48px mínimo táctil exacto.
Verificado via `boundingBox().height ≥ 48`.

### Navegación en viewports < lg (< 1024px)

En viewports 390 y 768, la navegación lateral colapsa (se verifica que no hay overflow horizontal en la página de ficha). El AppShell usa el patrón drawer + hamburguesa para viewports < lg (verificado en `app-shell-responsive.spec.ts` existente; no se re-verifica aquí pero no hubo regresiones detectadas).

---

## 6. Flujo E2E verificado (desktop-1280)

1. Login con `info@masialencis.com / Slotify2026!` → redirect a `/calendario` ✓
2. Navegar a `/reservas/3d8dd655-...` (consulta/2b con bloqueo vigente)
3. Verificar que `[data-testid="boton-extender-bloqueo"]` es visible ✓
4. Verificar que para reserva 2a (`1abe5647`) el botón NO es visible ✓
5. Click en "Extender bloqueo" → dialog `[data-testid="dialog-extender-bloqueo"]` abierto ✓
6. Introducir `dias=0` → mensaje de error en `#extender-bloqueo-dias-error` ✓
7. Introducir `dias=7` → click en "Confirmar" → dialog cierra ✓
8. Aviso `[data-testid="alerta-bloqueo-extendido"]` visible con nuevo TTL ✓

---

## 7. Verificación de persistencia BD (post happy path E2E)

Tras el happy path E2E (extender 7 días):
- RESERVA `3d8dd655` TTL: `2026-07-02T14:29:14.137Z` → nuevo valor (TTL + 7 días)
- FECHA_BLOQUEADA sincronizada al mismo nuevo valor
- AUDIT_LOG entrada `accion='actualizar'` creada

**Restauración ejecutada:**
- RESERVA TTL restaurado a `2026-07-02T14:29:14.137Z`
- FECHA_BLOQUEADA eliminada
- AUDIT_LOG de prueba eliminado

---

## 8. Comparación BD pre/post E2E

| Tabla | Pre | Post | Restaurado |
|-------|-----|------|------------|
| RESERVA (total) | 9 | 9 | n/a |
| RESERVA `3d8dd655` TTL | 2026-07-02T14:29:14.137Z | 2026-07-02T14:29:14.137Z | sí (restaurado) |
| FECHA_BLOQUEADA | 0 | 0 | sí (eliminada la de test) |
| AUDIT_LOG accion=actualizar | 0 | 0 | sí (eliminada) |

BD en estado idéntico al baseline tras restauración.

---

## Outcome: PASS

11/11 tests E2E en verde. Sin overflow horizontal en ningún viewport. Objetivos táctiles ≥ 48px en móvil. Happy path verificado end-to-end (UI → backend → BD → UI). Persistencia verificada. BD restaurada.
