# Step N+1 — Unit Tests + BD Verification
**Change:** us-009-resultado-visita-cliente-interesado
**Date:** 2026-07-03
**Agent:** qa-verifier

---

## 1. Baseline de BD (slotify_test, pre-tests)

| Tabla | Count |
|-------|-------|
| reserva | 1 |
| fecha_bloqueada | 0 |
| comunicacion | 0 |
| audit_log | 20 |

Capturado vía Prisma antes de ejecutar los tests.

---

## 2. Tests dirigidos

**Comando ejecutado:**
```
cd apps/api && npx jest --runInBand --testPathPatterns="resultado-visita|maquina-estados-resultado-visita"
```

**Resultado:**
```
Test Suites: 4 passed, 4 total
Tests:       49 passed, 49 total
Snapshots:   0 total
Time:        10.913 s
```

**Suites ejecutadas:**
- `maquina-estados-resultado-visita.spec.ts` — guarda de origen pura (dominio, sin infra)
- `resultado-visita-interesado.use-case.spec.ts` — caso de uso unitario (mocks)
- `resultado-visita-interesado-integracion.spec.ts` — integración real contra slotify_test
- `resultado-visita-interesado-concurrencia.spec.ts` — concurrencia real con FOR UPDATE

**Resultado por suite:** PASS todas.

---

## 3. Suite completa pnpm test

**Comando ejecutado:**
```
pnpm test
```

**Resultado API:**
```
Test Suites: 104 passed, 104 total
Tests:       823 passed, 823 total
Snapshots:   0 total
Time:        203.206 s
```

**Resultado Web (Vitest):**
```
Test Files: 13 passed (13)
Tests:      49 passed (49)
Duration:   51.38s
```

**Arch check (depcruise):**
```
✔ no dependency violations found (271 modules, 932 dependencies cruised)
```

Nota flaky US-004: NO apareció el deadlock 40P01 pre-existente en esta ejecución. Suite completamente verde.

---

## 4. Estado BD post-tests (slotify_test)

| Tabla | Count |
|-------|-------|
| reserva | 1 |
| fecha_bloqueada | 0 |
| comunicacion | 0 |
| audit_log | 20 |

**Comparación:** Idéntico al baseline. No hay mutación residual. Los tests de integración limpian correctamente en `afterAll`/`beforeEach`.

**Restauración necesaria:** No. La BD quedó en el mismo estado baseline.

---

## 5. Hallazgos

### Enum descarta vs descarte (confirmado)
- El DTO (`registrar-resultado-visita.dto.ts`) define el enum con el valor `descarta` (no `descarte`).
- El tipo de dominio `ResultadoVisita` en el use-case usa `descarte` como nombre de la variante no soportada.
- El contrato especificaba el nombre en el prompt como "descarte"; el código implementa `descarta` en el DTO (coherente con la instrucción del controlador: `// El contrato usa descarta`).
- Implicación: un body `{"resultado":"descarte"}` recibe 400 (enum inválido), mientras `{"resultado":"descarta"}` recibe 422 (resultado no soportado). Confirmado en step N+2.

---

## Outcome: PASS

Todos los tests en verde (49 dirigidos + 823 API + 49 web). BD inalterada. Sin bloqueos.
