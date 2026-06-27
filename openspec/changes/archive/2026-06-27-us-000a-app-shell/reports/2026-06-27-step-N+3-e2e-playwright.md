# Step N+3 — E2E Playwright Tests
**Change:** us-000a-app-shell
**Fecha:** 2026-06-27
**Ejecutado por:** qa-verifier
**Herramienta:** Playwright 1.61.1 + Chromium headless (chromium-headless-shell v1228)

---

## 1. Entorno

- Frontend: `pnpm --filter @slotify/web dev` en `http://localhost:5174` (port 5174 para no colisionar con el worktree principal).
- Backend: no requerido (US-000A no consume endpoints; `LoginPage` es stub).
- Mecanismo de sesión: `SessionProvider` existe en `src/auth/session.tsx` pero `main.tsx` **no lo instancia** — el contexto por defecto es `{ status: 'unauthenticated' }`. No hay ruta/dev-provider que inyecte sesión sin US-001.

---

## 2. Escenarios ejecutados

### Escenario A — Ruta protegida sin sesión redirige a `/login`

**Comando:**
```js
await page.goto('http://localhost:5174/calendario', { waitUntil: 'networkidle' });
```

| Check | Resultado | Detalle |
|---|---|---|
| A1 — URL final contiene `/login` | PASS | URL final: `http://localhost:5174/login` |
| A2 — Sin sidebar ni nav del shell tras redirect | PASS | `aside` ausente; `nav[aria-label="Navegación principal"]` ausente |

El guard `RequireAuth` detecta `session.status !== 'authenticated'` y ejecuta `<Navigate to="/login" replace state={{ from: location }} />`. La redirección es inmediata y correcta.

---

### Escenario B — `/login` no muestra chrome del shell (separación de layouts)

**Comando:**
```js
await page.goto('http://localhost:5174/login', { waitUntil: 'networkidle' });
```

| Check | Resultado | Detalle |
|---|---|---|
| B1 — Sin elemento `aside` (sidebar) en /login | PASS | `aside` ausente |
| B2 — Sin `nav[aria-label="Navegación principal"]` en /login | PASS | Nav del shell ausente |
| B3 — Campo `input[type="email"]` presente | PASS | Campo email del formulario presente |
| B4 — Campo `input[type="password"]` presente | PASS | Campo password del formulario presente |
| B5 — `button[type="submit"]` presente | PASS | Botón "Entrar" presente |

`/login` renderiza `LoginPage` directamente, sin montar `AppShell`. Separación de layouts verificada.

---

## 3. Escenarios bloqueados por US-001

Los siguientes escenarios requieren una sesión autenticada. El `SessionProvider` está implementado como contrato (context + hook), pero `main.tsx` no lo envuelve con ningún valor de sesión real — el contexto por defecto es siempre `unauthenticated`. No existe ruta `/dev-login` ni dev-provider que simule una sesión sin credenciales reales.

**Política aplicada:** no se modifica código de producción para simular auth. Escenarios marcados como BLOQUEADOS hasta que US-001 implemente el flujo de login real.

| Escenario | Estado | Motivo |
|---|---|---|
| C — Shell completo + regreso a ruta solicitada (`state.from`) | BLOQUEADO | Requiere sesión autenticada — pendiente US-001 |
| D — Navegación entre secciones sin recarga + item activo (`aria-current`) | BLOQUEADO | Requiere sesión autenticada — pendiente US-001 |
| E — Placeholder de sección no implementada (`data-testid="section-placeholder"`) | BLOQUEADO | Requiere sesión autenticada — pendiente US-001 |
| F — "No encontrado" dentro del shell conservando nav (`data-testid="not-found"`) | BLOQUEADO | Requiere sesión autenticada — pendiente US-001 |

**Cobertura de los escenarios bloqueados en unit tests (Vitest/RTL):**
Los tests unitarios de Fase 2/3 verifican estos escenarios inyectando sesión vía `SessionProvider` directamente en los renders de test. Todos 13 tests pasan (ver report step-N+1). La cobertura E2E de C–F queda diferida a US-001.

---

## 4. Resumen de resultados

| Estado | Cantidad | Checks |
|---|---|---|
| PASS | 7 | A1, A2, B1, B2, B3, B4, B5 |
| FAIL | 0 | — |
| BLOCKED | 4 | C, D, E, F |

---

## 5. Limpieza del entorno

- `await context.close()` y `await browser.close()` ejecutados correctamente.
- El proceso del dev server fue iniciado con `run_in_background`; no persiste datos entre sesiones (sin BD, sin cookies de sesión real).
- No se modificó ningún archivo de producción.

---

## 6. Outcome

**PASS (parcial — 7 checks ejecutados sin fallos; 4 bloqueados por dependencia US-001).**

Los comportamientos verificables sin sesión están correctos: la redirección del guard funciona, la separación de layouts auth/app es efectiva, y el formulario de login está bien formado. Los escenarios con sesión deberán re-ejecutarse en el contexto de QA de US-001.
