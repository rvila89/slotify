# Step N+3 — E2E Playwright Tests
**Change:** `us-004-alta-consulta-con-fecha`
**Date:** 2026-06-28
**Agent:** qa-verifier

---

## Setup

**Dev servers killed and relaunched fresh** (per MEMORY: reuseExistingServer can reuse stale servers):
- Killed PIDs: 15737 (Vite, port 5173) + 47831 (ts-node-dev, port 3000)
- Backend: `pnpm --filter @slotify/api run dev` → port 3000 (HTTP 400 on invalid login = UP)
- Frontend: `pnpm --filter @slotify/web run dev` → port 5173 (HTTP 200 = UP)

**Playwright config:** `playwright.config.ts` — chromium, workers=1, fullyParallel=false, baseURL=`http://localhost:5173`, reuseExistingServer=true (servers already running).

**E2E spec created:** `e2e/us-004-alta-consulta-con-fecha.spec.ts` (9 tests)

---

## Regression: US-003 E2E

```
npx playwright test us-003-nueva-consulta.spec.ts --reporter=list
→ 9 passed (3.7s) — ZERO regression
```

---

## US-004 E2E Test Results

```
npx playwright test us-004-alta-consulta-con-fecha.spec.ts --reporter=list
→ 9 passed (6.2s)
```

### Test-by-test detail:

| # | Test | Status | Key assertions |
|---|------|--------|----------------|
| 1 | 8.2 — navega a /reservas/nueva con fechaEvento visible | PASS | `min > HOY` (tomorrow); `#fechaEvento` visible; form present |
| 2 | 8.3 — alta fecha libre → alerta-fecha-bloqueada (2b) + tarifa estimada | PASS | HTTP 201; `[data-testid="alerta-fecha-bloqueada"]` visible + "fecha reservada"; `[data-testid="tarifa-estimada-importe"]` visible + "€" + importe = 1076 (PRECIOS[alta][3][1]); `[data-testid="alerta-e1-enviado"]` visible; BD: s2b + ttl≠null + fecha_bloqueada blando + E1 enviado + audit_log RESERVA crear |
| 3 | 8.4a — alta sobre fecha bloqueada 2b → alerta-cola (2d) | PASS | HTTP 201; `[data-testid="alerta-cola"]` visible + "posición 1"; BD: s2d + posicion_cola=1 + no nueva fecha_bloqueada |
| 4 | 8.4b — alta sobre fecha pre_reserva → alerta-no-disponible (2a) | PASS | HTTP 201; `[data-testid="alerta-fecha-no-disponible"]` visible + "exploratoria"; BD: s2a + posicion_cola=null + no fecha_bloqueada |
| 5 | 8.5a — fecha de hoy bloqueada por min=mañana + Zod | PASS | `min='2026-06-29'` > HOY='2026-06-28'; bypass con native setter → `#fechaEvento-error` visible; API no llamada |
| 6 | 8.5b — fecha + comentarios → E1 borrador | PASS | `[data-testid="alerta-e1-borrador"]` visible + "borrador" + "no se ha enviado"; BD: comunicacion.estado=borrador; sub_estado=s2b |
| 7 | 8.6a — viewport 390 (móvil) | PASS | scrollWidth ≤ 392; `aside` NOT visible; hamburguesa `button[aria-label="Abrir navegación"]` visible; `#fechaEvento` visible |
| 8 | 8.6b — viewport 768 (tablet) | PASS | scrollWidth ≤ 770; `aside` NOT visible; hamburguesa visible; `#fechaEvento` visible |
| 9 | 8.6c — viewport 1280 (escritorio) | PASS | scrollWidth ≤ 1282; `aside` visible (sidebar fijo); hamburguesa NOT visible; `#fechaEvento` visible |

---

## Detalle aserción tarifa estimada en 2b (nueva — re-verificación B-1)

**Contexto bloqueante B-1:** el code-review detectó que el importe de la tarifa estimada no se renderizaba en el aviso 2b por un desajuste `snake_case`→`camelCase` (`total_eur` vs `tarifaEstimada.totalEur`). Corregido en contrato/SDK/frontend.

**Re-verificación (2026-06-28):**

- Test 8.3 ampliado: el alta ahora envía `invitados=40`, `tipoEvento=boda`, `duracionHoras=8` (además de fecha) para que el motor de tarifas calcule precio.
- Fecha usada: `2026-08-12` (agosto = temporada alta, meses 5–9 del seed).
- Precio esperado: `PRECIOS[alta][3][1]` = **1076 €** (tramo 31–40 invitados, 8 horas, temporada alta).
- Selector: `[data-testid="alerta-fecha-bloqueada"] [data-testid="tarifa-estimada-importe"]`

**Resultado observado:**

```
textContent: "Se ha incluido una tarifa estimada de 1076 € en el email E1."
```

- `[data-testid="tarifa-estimada-importe"]` visible: **SI**
- Contiene "€": **SI**
- Contiene dígito: **SI**
- Importe `/1[.,]?076/`: **PASS** (valor = 1076, locale Playwright Chromium no aplica separador de miles en `toLocaleString('es-ES')` — comportamiento esperado en CI headless)

**Nota sobre locale:** `toLocaleString('es-ES')` en el navegador del usuario devuelve "1.076" (con punto de miles), pero en Playwright/Chromium headless puede devolver "1076". La aserción es locale-agnostic (`/1[.,]?076/`) para cubrir ambos entornos.

---

## Re-verificación servidores frescos (re-run B-1)

- Killed PIDs: 52267 (ts-node-dev, port 3000) + 52356 (Vite, port 5173)
- Backend: `pnpm --filter @slotify/api run dev` → HTTP 400 on bad login = UP
- Frontend: `pnpm --filter @slotify/web run dev` → HTTP 200 = UP
- SDK ya regenerado (camelCase `tarifaEstimada.totalEur`) — build Vite sirve código actualizado.

---

## Responsive verification summary (8.6)

| Viewport | overflow | nav collapse | sidebar fijo | hamburguesa | fechaEvento |
|----------|----------|-------------|-------------|------------|------------|
| 390 (móvil) | ≤392 ✓ | drawer (<lg) ✓ | — | visible ✓ | visible ✓ |
| 768 (tablet) | ≤770 ✓ | drawer (<lg) ✓ | — | visible ✓ | visible ✓ |
| 1280 (escritorio) | ≤1282 ✓ | — | visible ✓ | hidden ✓ | visible ✓ |

No overflow horizontal in any viewport. Nav collapses to drawer at <lg (390, 768) and shows fixed sidebar at ≥lg (1280).

---

## BD Persistence verification (8.7)

After all E2E tests, the `afterAll` hook ran `limpiarReserva()` for all created reservas:

**Final BD state (post re-run):**
```
reserva:         0 (baseline: 0) ✓
fecha_bloqueada: 0 (baseline: 0) ✓
comunicacion:    0 (baseline: 0) ✓
cliente:         0 (baseline: 0) ✓
```

**BD restaurada:** COMPLETE.

---

## Notes

- Test 8.5a used React native value setter (`Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set`) to bypass the `min` attribute and trigger Zod validation. First attempt with `input.value = iso` + `change` event failed (React didn't detect the change); fixed with native setter + `input` event before `change` event.
- Test 8.4b required SQL setup (creating a 2b reservation then updating to pre_reserva state) since no endpoint exists for state transitions yet.
- Test 8.3 robustness improvement: `await idReservaPromise` is now called immediately after `alerta-fecha-bloqueada` becomes visible (right after HTTP 201 lands), so the `reservaId` is registered for cleanup before any subsequent assertion can fail and leave orphan rows.
- Both US-003 (9 tests) and US-004 (9 tests) E2E specs pass: zero regression.

---

## Outcome: PASS

- 9/9 US-004 E2E tests PASS (incluida la nueva aserción tarifa-estimada-importe en 2b)
- 9/9 US-003 regression PASS
- Responsive: 390 / 768 / 1280 all PASS (no overflow, correct nav behavior)
- BD persistence verified + restored to baseline
- Bloqueante B-1 (importe tarifa no visible) verificado como corregido y cubierto por E2E
