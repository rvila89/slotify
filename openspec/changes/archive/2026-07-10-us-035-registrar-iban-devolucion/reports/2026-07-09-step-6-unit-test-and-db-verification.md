# Step 6 — Unit Tests + DB Verification
**Change:** us-035-registrar-iban-devolucion  
**Date:** 2026-07-09  
**Branch:** feature/us-035-registrar-iban-devolucion  
**Executor:** qa-verifier (claude-sonnet-4-6)

---

## 6.1 Baseline de BD (pre-test)

Base de datos: `slotify_test` (postgresql://localhost:5432)  
Estado capturado antes de ejecutar los tests:

| Tabla / Filtro | Valor |
|---|---|
| `cliente` total | 4 |
| `cliente` con `iban_devolucion` NOT NULL | 0 |
| `comunicacion` con `codigo_email='E8'` | 0 |
| `audit_log` con `entidad='CLIENTE'` y `accion='actualizar'` | 0 |
| `reserva` con `estado='post_evento'` | 0 |

---

## 6.2 Tests dirigidos — módulos cambiados

### Suite validar-iban (dominio)
```
pnpm --filter @slotify/api exec jest "validar-iban" --no-coverage
```
- **Test Suites:** 1 passed, 1 total
- **Tests:** 14 passed, 14 total
- **Tiempo:** 4.02 s
- Archivo: `src/comunicaciones/domain/validar-iban.spec.ts`

### Suite registrar-iban-devolucion (use-case + controller)
```
pnpm --filter @slotify/api exec jest "registrar-iban-devolucion" --no-coverage
```
- **Test Suites:** 2 passed, 2 total
- **Tests:** 31 passed, 31 total
- **Tiempo:** 8.34 s
- Archivos:
  - `src/reservas/__tests__/registrar-iban-devolucion.use-case.spec.ts`
  - `src/reservas/__tests__/registrar-iban-devolucion.controller.http.spec.ts`

### Suite comunicaciones (módulo completo)
```
pnpm --filter @slotify/api exec jest "comunicaciones" --no-coverage
```
- **Test Suites:** 10 passed, 10 total
- **Tests:** 56 passed, 56 total
- **Tiempo:** 14.45 s

**Total tests dirigidos US-035: 45 passed, 0 failed** (14 validar-iban + 31 use-case/controller).

---

## 6.3 Suite requerida completa

### pnpm lint (apps/api)
```
pnpm --filter @slotify/api lint
```
- **Resultado:** PASS (sin errores ESLint, sin advertencias)
- `eslint "src/**/*.ts"` — salida limpia

### pnpm typecheck (apps/api)
```
pnpm --filter @slotify/api typecheck
```
- **Resultado:** PASS
- `tsc --noEmit -p tsconfig.json` — sin errores TypeScript

### pnpm lint (apps/web)
```
pnpm --filter @slotify/web lint
```
- **Resultado:** PASS (solo warnings de deprecación de `eslint-plugin-boundaries` de versión, no errores semánticos)

### pnpm typecheck (apps/web)
```
pnpm --filter @slotify/web typecheck
```
- **Resultado:** PASS
- `tsc --noEmit -p tsconfig.json` — sin errores TypeScript

### pnpm test (apps/api — suite completa)
```
pnpm --filter @slotify/api test
```
- **Test Suites:** 1 failed, 166 passed, 167 total
- **Tests:** 1 failed, 1547 passed, 1548 total
- **Tiempo:** 178.85 s

**Único fallo:** `src/reservas/__tests__/alta-consulta-con-fecha-concurrencia.spec.ts`  
Test: `debe_producir_un_unico_bloqueo_y_posiciones_de_cola_unicas_y_contiguas_1_a_N_menos_1`  
Causa: deadlock PostgreSQL `40P01` en tests de concurrencia — **pre-existing flaky test documentado en MEMORY.md** (US-004), completamente ajeno a US-035. No introducido por este cambio.

### pnpm test (apps/web — suite completa)
```
pnpm --filter @slotify/web test
```
- **Test Files:** 24 passed, 24 total
- **Tests:** 117 passed, 117 total
- **Tiempo:** 30.43 s

---

## 6.4 Verificación BD post-test + restauración

Estado de BD tras ejecutar todos los tests (los tests US-035 usan mocks, no tocan BD real):

| Tabla / Filtro | Pre-test | Post-test | Delta |
|---|---|---|---|
| `cliente` total | 4 | 4 | 0 |
| `cliente` con `iban_devolucion` | 0 | 0 | 0 |
| `comunicacion` E8 | 0 | 0 | 0 |
| `audit_log` CLIENTE actualizar | 0 | 0 | 0 |
| `reserva` post_evento | 0 | 0 | 0 |

**Sin mutación:** los tests unitarios usan repositorios mockeados (in-memory). La BD no fue modificada. No se requiere restauración.

---

## Resultado

| Quality gate | Estado |
|---|---|
| `pnpm lint` (api) | PASS |
| `pnpm typecheck` (api) | PASS |
| `pnpm lint` (web) | PASS |
| `pnpm typecheck` (web) | PASS |
| Tests dirigidos US-035 (45 tests) | PASS |
| `pnpm test` (api — 1548 tests) | PASS* |
| `pnpm test` (web — 117 tests) | PASS |
| BD sin mutación tras tests | PASS |

*El único fallo (`alta-consulta-con-fecha-concurrencia.spec.ts`) es el deadlock 40P01 pre-existente de US-004 documentado en MEMORY.md, no relacionado con US-035.

**Outcome: PASS (con advertencia sobre fallo pre-existente US-004 ajeno a US-035)**
