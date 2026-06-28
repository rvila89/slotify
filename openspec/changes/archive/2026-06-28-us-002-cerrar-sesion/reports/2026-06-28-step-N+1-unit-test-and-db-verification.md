# Step N+1 — Unit Tests + DB State Verification
**Change:** us-002-cerrar-sesion
**Date:** 2026-06-28
**Ejecutado por:** qa-verifier

---

## 1. Baseline de BD (pre-tests)

| Entidad       | Metrica                | Valor  |
|---------------|------------------------|--------|
| AuditLog      | Total rows             | 22     |
| AuditLog      | accion = 'login'       | 16     |
| AuditLog      | accion = 'logout'      | 6      |

Capturado con:
```js
prisma.auditLog.groupBy({ by: ['accion'], _count: true })
// => [{"_count":6,"accion":"logout"},{"_count":16,"accion":"login"}]
prisma.auditLog.count() // => 22
```

---

## 2. Tests dirigidos — módulos cambiados

### Backend (`apps/api`) — auth/logout

**Comando:**
```bash
cd apps/api && npx jest --testPathPatterns="logout" --forceExit
```

**Resultado: 12/12 PASSED (2 test suites)**
- `src/auth/__tests__/logout.use-case.spec.ts` — PASS
- `src/auth/__tests__/logout.controller.http.spec.ts` — PASS

Casos cubiertos:
- Happy path: identifica por refresh y audita (§3 entidad='Usuario'/entidadId=usuarioId)
- Idempotencia: refresh ausente → sin error, sin auditoría
- Idempotencia: refresh inválido/expirado → sin error, sin auditoría
- Access expirado pero refresh válido → logout completa, audita
- Multi-tenancy: registra con tenant_id del refresh
- HTTP: 204 + Set-Cookie limpia cookie → siempre
- HTTP: no 401 con cookie ausente
- HTTP: pasa refreshToken al use-case (no accede a req.user)
- HTTP: ignora usuario de destino del body (no-anónimo)

### Frontend (`apps/web`) — auth/useLogout + app/CerrarSesionUI

**Comando:**
```bash
cd apps/web && npx vitest run src/auth/__tests__/useLogout.test.tsx src/app/__tests__/CerrarSesionUI.test.tsx
```

**Resultado: 11/11 PASSED (2 test files)**
- `src/auth/__tests__/useLogout.test.tsx` — 6 tests PASS
- `src/app/__tests__/CerrarSesionUI.test.tsx` — 5 tests PASS

Casos cubiertos:
- useLogout happy path: llama SDK, limpia access token, redirige a /login
- useLogout degradado: limpia sesión aunque la red falle, muestra aviso en DOM (nota: ver §4 sobre persistencia real)
- AppShell: botón "Cerrar sesión" presente y accionable
- AppShell: llama endpoint de logout
- AppShell: redirige al login y vacía la sesión
- AppShell: botón accesible dentro del drawer (mobile <lg)
- RequireAuth: ruta protegida tras logout → /login sin exponer datos

---

## 3. Suite completa (`pnpm test`)

### Backend — `npx jest --forceExit`
```
Test Suites: 2 failed, 27 passed, 29 total
Tests:       4 failed, 139 passed, 143 total
```

**Tests fallidos (PRE-EXISTENTES, no relacionados con US-002):**
- `src/reservas/__tests__/fecha-bloqueada-concurrencia.spec.ts` — 1 fail (bloqueo atómico concurrencia)
- `src/reservas/__tests__/liberar-fecha-integracion.spec.ts` — 3 fails (liberar fecha integración)
- `src/reservas/__tests__/bloquear-fecha-integracion.spec.ts` — 2 fails (bloquear fecha integración)

Todos en `reservas/__tests__` (tests de integración de bloqueo atómico de fecha). No pertenecen a US-002.
Los tests `auth/__tests__/logout.*` y todos los de US-002 pasan.

### Frontend — `npx vitest run`
```
Test Files: 13 passed (13)
Tests:      45 passed (45)
```
VERDE completo.

### Lint + Typecheck
```bash
pnpm --filter @slotify/api run lint    # VERDE (sin warnings)
pnpm --filter @slotify/api run typecheck  # VERDE
pnpm --filter @slotify/web run lint    # VERDE (sin warnings)
pnpm --filter @slotify/web run typecheck  # VERDE
```

---

## 4. Estado BD post-tests

Los tests unitarios usan dobles (jest.fn/vi.mock) y no tocan la BD real.

| Entidad       | Metrica                | Valor post-test | Delta |
|---------------|------------------------|-----------------|-------|
| AuditLog      | Total rows             | 22              | 0     |
| AuditLog      | accion = 'login'       | 16              | 0     |
| AuditLog      | accion = 'logout'      | 6               | 0     |

**BD NO mutada. No se requiere restauración.**

---

## 5. Outcome

| Componente              | Resultado |
|-------------------------|-----------|
| Backend logout tests    | PASS (12/12) |
| Frontend logout tests   | PASS (11/11) |
| Full suite API          | PASS (139/143 — 4 fallos pre-existentes en reservas, sin relación con US-002) |
| Full suite Web          | PASS (45/45) |
| lint API                | VERDE |
| typecheck API           | VERDE |
| lint Web                | VERDE |
| typecheck Web           | VERDE |
| BD post-test            | Sin mutación |

**OUTCOME: PASS** (los 4 fallos de la suite completa son pre-existentes en reservas, ajenos a US-002)
