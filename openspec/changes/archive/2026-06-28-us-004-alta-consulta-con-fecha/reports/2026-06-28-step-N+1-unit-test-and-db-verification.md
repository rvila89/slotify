# Step N+1 — Unit Tests + BD Verification
**Change:** `us-004-alta-consulta-con-fecha`
**Date:** 2026-06-28
**Agent:** qa-verifier

---

## 1. BD Baseline (pre-tests)

| Table | Count |
|-------|-------|
| `reserva` | 0 |
| `fecha_bloqueada` | 0 |
| `comunicacion` | 0 |
| `audit_log` | 34 |
| `cliente` | 0 |
| `tenant` | 1 |
| `usuario` | 1 |

Unique indexes confirmed active:
- `fecha_bloqueada_tenant_id_fecha_key` UNIQUE btree(tenant_id, fecha)
- `reserva_cola_posicion_key` UNIQUE btree(tenant_id, consulta_bloqueante_id, posicion_cola) WHERE posicion_cola IS NOT NULL

---

## 2. Targeted Tests — `con-fecha` modules

**Command:**
```
cd apps/api && npx jest --testPathPatterns="con-fecha" --runInBand --no-coverage --reporters=default
```

**Result:**
```
PASS src/reservas/__tests__/alta-consulta-con-fecha-concurrencia.spec.ts
PASS src/reservas/__tests__/alta-consulta-con-fecha-integracion.spec.ts
PASS src/reservas/__tests__/alta-consulta-con-fecha.use-case.spec.ts
PASS src/reservas/__tests__/maquina-estados-alta-con-fecha.spec.ts

Test Suites: 4 passed, 4 total
Tests:       29 passed, 29 total
Time:        ~2s
```

### Concurrency tests D4 detail (alta-consulta-con-fecha-concurrencia.spec.ts):

| Test | Workers | Result |
|------|---------|--------|
| D4: dos altas concurrentes (1×2.b + 1×2.d) | 2 | PASS — exactly 1×s2b + 1 FECHA_BLOQUEADA + 1×s2d posicion_cola=1 pointing to 2b |
| D5/D6: N altas concurrentes (1×2.b + N-1×2.d contiguas) | 5 | PASS — 1×s2b + 4×s2d posiciones {1,2,3,4} únicas y contiguas, 1 FECHA_BLOQUEADA |

---

## 3. Full Suite

**Command:**
```
cd apps/api && pnpm test
```
(which runs `jest --runInBand && pnpm run arch`)

**Result:**
```
Test Suites: 38 passed, 38 total
Tests:       218 passed, 218 total
Snapshots:   0 total
Time:        ~2.7s

depcruise src → ✔ no dependency violations found (125 modules, 319 dependencies cruised)
```

Note: 2× `[Nest] ERROR [HttpExceptionFilter] DB connection lost` logged during `auth.controller.http.spec.ts` — these are intentional test assertions simulating DB errors, not real failures.

---

## 4. BD State Post-tests

| Table | Pre | Post | Delta |
|-------|-----|------|-------|
| `reserva` | 0 | 0 | 0 |
| `fecha_bloqueada` | 0 | 0 | 0 |
| `comunicacion` | 0 | 0 | 0 |
| `audit_log` | 34 | 34 | 0 |
| `cliente` | 0 | 0 | 0 |

**BD restaurada:** YES — los tests de integración/concurrencia usan `beforeEach(limpiar)` + `afterAll(limpiar)` que borra reservas, fechas_bloqueadas, comunicaciones, audit_logs y clientes creados durante los tests.

---

## 5. Unicidad verificada

```sql
-- FECHA_BLOQUEADA unique: tenant_id + fecha
SELECT indexdef FROM pg_indexes WHERE indexname='fecha_bloqueada_tenant_id_fecha_key';
-- → CREATE UNIQUE INDEX ... ON fecha_bloqueada USING btree (tenant_id, fecha)

-- posicion_cola unique parcial:
SELECT indexdef FROM pg_indexes WHERE indexname='reserva_cola_posicion_key';
-- → CREATE UNIQUE INDEX ... ON reserva USING btree (tenant_id, consulta_bloqueante_id, posicion_cola) WHERE posicion_cola IS NOT NULL
```

Ambos índices UNIQUE activos y confirmados en BD. Ninguna violación durante los tests.

---

## Outcome: PASS

- 4/4 suites con-fecha verdes (29 tests)
- 38/38 suites globales verdes (218 tests)
- depcruise sin violaciones
- BD restaurada al baseline
- Concurrencia D4: 2-workers (1×2b+1×2d) y N-workers=5 (1×2b+4×2d contiguas) PASS
