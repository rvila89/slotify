# QA Report — Step N+1 (re-verificacion 5b.4): Unit Tests + DB Verification
**Change:** us-050-pipeline-reservas-kanban-listado
**Date:** 2026-07-06
**Agent:** qa-verifier
**Motivo:** Re-ejecucion post-fix backend conformidad contrato (US-050 §5b.2 — 5b.4)

---

## 1. BD Baseline (pre-ejecucion)

Capturado mediante PrismaClient directo a `slotify_dev`.

| Tabla | Count | Detalle |
|-------|-------|---------|
| RESERVA | 1 | `e2e00001-...0002` `consulta/s2x` (terminal, excluida del pipeline) |
| FECHA_BLOQUEADA | 0 | — |
| CLIENTE | 1 | Anna Puig (fixture E2E) |

La unica reserva tiene `estado=consulta`, `subEstado=s2x` (terminal). El pipeline la excluye y la API devuelve `data:[]`.

---

## 2. Tests dirigidos del modulo — Backend (listar-reservas)

**Comando:**
```
cd apps/api && npx jest listar-reservas --no-coverage --forceExit
```

**Resultado:**
```
Test Suites: 3 passed, 3 total
Tests:       40 passed, 40 total
Time:        9.487 s
```

Suites cubiertas:
- `listar-reservas.controller.http.spec.ts` — tests HTTP de conformidad de contrato (5b.1): PASS
- `listar-reservas.use-case.spec.ts` — use-case proyeccion `idReserva` + cinco campos: PASS
- `listar-reservas.prisma.adapter.spec.ts` — construccion del `where` Prisma: PASS

**40/40 en verde. Cero fallos.**

---

## 3. Suite completa backend — pnpm test

**Comando:**
```
cd apps/api && pnpm test
```

**Resultado (segunda ejecucion — la primera tuvo fallo flaky conocido):**
```
Test Suites: 147 passed, 147 total
Tests:       1326 passed, 1326 total
Time:        138.24 s
```

El unico fallo observado fue en la primera pasada: `alta-consulta-con-fecha-concurrencia.spec.ts` (deadlock 40P01 pre-existente, documentado en MEMORY `us004-concurrency-test-flaky.md`). La segunda ejecucion devolvio 1326/1326. No es una regresion del diff de US-050.

---

## 4. Lint y typecheck — Backend

**Comandos:**
```
cd apps/api && pnpm lint
cd apps/api && npx tsc --noEmit
```

**Resultado:**
- `pnpm lint`: exit code 0, sin errores (solo avisos de depcruise que no afectan al codigo de produccion)
- `tsc --noEmit`: sin errores (exit code 0)

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
   Duration 24.78s
```

- `pnpm lint`: exit code 0 (solo avisos de deprecacion de `eslint-plugin-boundaries` v5→v6, no son errores)
- `pnpm typecheck` (`tsc --noEmit`): sin errores

Reglas verificadas: `func-style` (arrow functions), `boundaries/element-types` (imports por barrel), `max-lines` (<=300 por archivo).

---

## 6. Verificacion de BD post-ejecucion

La US-050 es **frontend-only y de solo lectura**. Todos los tests de Vitest usan mocks del SDK (`apiClient.GET`) y no realizan peticiones reales a la BD.

| Tabla | Count pre | Count post | Delta |
|-------|-----------|------------|-------|
| RESERVA | 1 | 1 | 0 |
| FECHA_BLOQUEADA | 0 | 0 | 0 |
| CLIENTE | 1 | 1 | 0 |

**BD identica al baseline. Sin mutacion.**

---

## 7. Hallazgos

### Hallazgo 1 — Bug en adaptador Prisma: `subEstado: { notIn: [...terminales] }` excluye NULL

**Archivo:** `apps/api/src/reservas/infrastructure/listar-reservas.prisma.adapter.ts` linea 124

El adaptador genera:
```typescript
subEstado: { notIn: [...SUB_ESTADOS_TERMINALES] }
```

En SQL esto se traduce como:
```sql
WHERE sub_estado NOT IN ('s2x', 's2y', 's2z')
```

En SQL three-valued logic, `NULL NOT IN (...)` evalua a NULL (no TRUE), por lo que **todas las reservas con `subEstado = NULL` son excluidas del pipeline**. Esto afecta a `reserva_confirmada`, `pre_reserva`, `evento_en_curso`, `post_evento` — todos los estados principales que no tienen sub-estado.

**Evidencia directa:** Se sembraron dos reservas activas de QA:
- `qa050000-...0002`: `reserva_confirmada`, `numInvitadosFinal=80`, `notas='Alergia a frutos secos...'`, `fechaEvento=2027-11-15`
- `qa050000-...0003`: `pre_reserva`, `numInvitadosFinal=30`, `notas='Sin gluten para 5 personas'`, `fechaEvento=2027-12-10`

La API devolvio `data: []` para ambas, tanto sin filtro como con `?estado=reserva_confirmada` y `?estado=pre_reserva`.

**Fix necesario (NO aplicado por el QA-verifier):**
```typescript
subEstado: filtros.subEstado
  ? { equals: subEstadoDominioAPrisma(filtros.subEstado), notIn: [...SUB_ESTADOS_TERMINALES] }
  : { OR: [{ equals: null }, { notIn: [...SUB_ESTADOS_TERMINALES] }] }
```

o equivalentemente:
```typescript
// Fuera de subEstado, con OR a nivel ReservaWhereInput:
OR: [
  { subEstado: null },
  { subEstado: { notIn: [...SUB_ESTADOS_TERMINALES] } }
]
```

**Impacto:** BLOQUEANTE. El pipeline siempre muestra `data:[]` para reservas activas con estados principales (pre_reserva, reserva_confirmada, evento_en_curso, post_evento). Solo las reservas en estado `consulta` con sub-estado no terminal (2a, 2b, 2c, 2d, 2v) aparecerian — y solo si tienen un sub-estado no nulo.

**Contexto:** Este bug es pre-existente en el adaptador de US-049, NO fue introducido por el fix 5b.2 (que solo cubrio controller/use-case/DTO). Los tests del adaptador mockearon PrismaService completamente y no detectaron el comportamiento SQL de NULL.

---

## 8. Outcome

**PASS** para unit tests, lint, typecheck y verificacion de BD.
**BLOQUEANTE** para la funcionalidad completa: se identifica hallazgo nuevo que impide al pipeline mostrar reservas activas reales.

| Tarea | Resultado |
|-------|-----------|
| 6.1 Baseline BD capturado | PASS |
| 6.2 Tests dirigidos listar-reservas (40/40) | PASS |
| 6.3 Suite completa backend (1326/1326) | PASS |
| 6.3 Suite completa frontend (84/84) | PASS |
| 6.3 ESLint backend + frontend | PASS |
| 6.3 TypeScript backend + frontend | PASS |
| 6.4 BD sin mutacion | PASS |
| Hallazgo adaptador NULL subEstado | BLOQUEANTE — requiere fix |
