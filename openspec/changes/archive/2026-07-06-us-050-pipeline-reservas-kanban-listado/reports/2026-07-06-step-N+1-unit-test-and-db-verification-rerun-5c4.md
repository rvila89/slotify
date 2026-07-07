# QA Report — Step N+1 (re-verificacion 5c.4): Unit Tests + DB Verification
**Change:** us-050-pipeline-reservas-kanban-listado
**Date:** 2026-07-06
**Agent:** qa-verifier
**Motivo:** Re-ejecucion post-fix backend filtro subEstado NULL (US-050 §5c.2 — 5c.4)
**Fixes aplicados:** Fix 1 (conformidad contrato idReserva + 5 campos) + Fix 2 (subEstado NULL en adaptador)

---

## 1. BD Baseline (pre-ejecucion)

Capturado mediante PrismaClient directo a `slotify_dev`.

| Tabla | Count | Detalle |
|-------|-------|---------|
| RESERVA | 1 | `e2e00001-0000-0000-0000-000000000002` `consulta/s2x` (terminal, excluida del pipeline) |
| FECHA_BLOQUEADA | 0 | — |
| CLIENTE | 1 | `e2e00001-0000-0000-0000-000000000001` anna.puig@e2e.test |

La unica reserva tiene `estado=consulta`, `subEstado=s2x` (terminal). Pipeline la excluye.

---

## 2. Tests dirigidos del modulo — Backend (listar-reservas)

**Comando:**
```
cd apps/api && npx jest listar-reservas --no-coverage --forceExit
```

**Resultado:**
```
Test Suites: 4 passed, 4 total
Tests:       43 passed, 43 total
Time:        10.666 s
```

Suites cubiertas:
- `listar-reservas.controller.http.spec.ts` — conformidad contrato (5b.1): PASS
- `listar-reservas.use-case.spec.ts` — proyeccion idReserva + 5 campos: PASS
- `listar-reservas.prisma.adapter.spec.ts` — construccion where Prisma: PASS
- `listar-reservas-subestado-null-integracion.spec.ts` — integracion BD real (5c.1): PASS
  (3 tests: incluye reservas subEstado null, excluye terminales/cerrados, count correcto)

**43/43 en verde. Cero fallos.**

Nota respecto a la ejecucion anterior (5b.4): la suite ahora incluye 3 tests adicionales
del spec de integracion (5c.1), de ahi el paso de 40 a 43.

---

## 3. Suite completa backend — pnpm test

**Comando:**
```
cd apps/api && pnpm test
```

**Resultado:**
```
Test Suites: 148 passed, 148 total
Tests:       1329 passed, 1329 total
Time:        140.137 s
```

Sin fallo flaky en esta ejecucion. La suite de concurrencia `alta-consulta-con-fecha-concurrencia.spec.ts`
(deadlock 40P01 pre-existente, documentado en MEMORY `us004-concurrency-test-flaky.md`) paso en verde.
No es una regresion del diff de US-050.

---

## 4. Lint y typecheck — Backend

**Comandos:**
```
cd apps/api && pnpm lint
cd apps/api && npx tsc --noEmit
```

**Resultados:**
- `pnpm lint`: exit code 0 (sin errores)
- `tsc --noEmit`: exit code 0 (sin errores)

---

## 5. Suite completa frontend — pnpm test + lint + typecheck

**Comandos:**
```
cd apps/web && pnpm test
cd apps/web && pnpm lint
cd apps/web && pnpm typecheck
```

**Resultados:**
```
Test Files  18 passed (18)
      Tests 84 passed (84)
   Duration 39.45s
```

- `pnpm lint`: exit code 0 (solo avisos de deprecacion de eslint-plugin-boundaries v5→v6, no son errores)
- `pnpm typecheck` (tsc --noEmit): exit code 0

Reglas verificadas: `func-style` (arrow functions), `boundaries/element-types` (imports por barrel),
`max-lines` (<=300 por archivo).

---

## 6. Verificacion de BD post-ejecucion

La US-050 es frontend-only y de solo lectura. Los tests de Vitest usan mocks del SDK (apiClient.GET)
y no realizan peticiones reales a la BD. Los tests de integracion del adaptador (slotify_test) limpian
sus propios datos en afterAll.

| Tabla | Count pre | Count post | Delta |
|-------|-----------|------------|-------|
| RESERVA | 1 | 1 | 0 |
| FECHA_BLOQUEADA | 0 | 0 | 0 |
| CLIENTE | 1 | 1 | 0 |

**BD identica al baseline. Sin mutacion.**

---

## 7. Hallazgos

Ninguno. Los fixes 5b.2 y 5c.2 estan en verde. La suite completa (backend + frontend) esta en verde.
La regla de lint y typecheck se cumple. La BD no muto.

---

## 8. Outcome

**PASS**

| Tarea | Resultado |
|-------|-----------|
| 6.1 Baseline BD capturado | PASS |
| 6.2 Tests dirigidos listar-reservas (43/43, incl. integracion 5c.1) | PASS |
| 6.3 Suite completa backend (1329/1329) | PASS |
| 6.3 Suite completa frontend (84/84) | PASS |
| 6.3 ESLint backend + frontend | PASS |
| 6.3 TypeScript backend + frontend | PASS |
| 6.4 BD sin mutacion | PASS |
