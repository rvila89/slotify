# Step N+1 — Unit Tests + DB Verification
**Change:** us-036-registrar-devolucion-fianza
**Date:** 2026-07-10
**Executed by:** qa-verifier

---

## 1. Baseline de BD (slotify_dev) — antes de los tests

| Tabla | Métrica | Valor |
|-------|---------|-------|
| `reserva` | total | 4 |
| `reserva` | fianza_status = 'cobrada' | 0 |
| `reserva` | fianza_status = 'devuelta' | 0 |
| `reserva` | fianza_status = 'retenida_parcial' | 0 |
| `reserva` | fianza_devuelta_eur IS NOT NULL | 0 |
| `reserva` | fianza_devuelta_fecha IS NOT NULL | 0 |
| `reserva` | motivo_retencion IS NOT NULL | 0 |
| `documento` | total | 0 |
| `documento` | tipo = 'justificante_pago' | 0 |
| `audit_log` | total | 330 |

Columna `motivo_retencion` confirmada presente en `reserva` vía `\d reserva` (migración `20260710120000_us036_reserva_motivo_retencion` aplicada correctamente).

---

## 2. Tests ejecutados

### 2.1 Tests de dominio — 3 suites, 29 tests

```
npx jest --testPathPatterns="(validar-devolucion-fianza|derivar-estado-fianza-devolucion|puede-registrar-devolucion)" --no-coverage
```

- `facturacion/domain/__tests__/validar-devolucion-fianza.spec.ts` — PASS
- `facturacion/domain/__tests__/derivar-estado-fianza-devolucion.spec.ts` — PASS
- `facturacion/domain/__tests__/puede-registrar-devolucion.spec.ts` — PASS

**Test Suites: 3 passed, 3 total — Tests: 29 passed, 29 total**

### 2.2 Tests de caso de uso + controller HTTP — 2 suites, 40 tests

```
npx jest --testPathPatterns="(registrar-devolucion-fianza.use-case|registrar-devolucion-fianza.controller)" --no-coverage
```

- `facturacion/__tests__/registrar-devolucion-fianza.use-case.spec.ts` — PASS
- `facturacion/__tests__/registrar-devolucion-fianza.controller.http.spec.ts` — PASS

**Test Suites: 2 passed, 2 total — Tests: 40 passed, 40 total**

### 2.3 Test de concurrencia (Postgres real) — 1 suite, 15 tests

```
npx jest --testPathPatterns="registrar-devolucion-fianza-concurrencia" --no-coverage
```

- `facturacion/__tests__/registrar-devolucion-fianza-concurrencia.spec.ts` — PASS (contra slotify_test)

**Test Suites: 1 passed, 1 total — Tests: 15 passed, 15 total**

### 2.4 Suite completa

```
npx jest --no-coverage
```

**Test Suites: 1 failed (pre-existente), 172 passed, 173 total**
**Tests: 1 failed (pre-existente), 1631 passed, 1632 total**

El único fallo es `fecha-bloqueada-concurrencia.spec.ts` — test flaky pre-existente del deadlock US-004 (documentado en MEMORY.md `us004-concurrency-test-flaky.md`). No relacionado con US-036. Cuando se ejecuta en aislamiento pasa: `2 passed, 2 total`.

---

## 3. Verificación de estado de BD tras los tests

```sql
-- slotify_dev — post-tests
SELECT id_reserva, fianza_status, fianza_devuelta_eur, fianza_devuelta_fecha, motivo_retencion
FROM reserva;
```

| id_reserva | fianza_status | fianza_devuelta_eur | fianza_devuelta_fecha | motivo_retencion |
|------------|---------------|---------------------|-----------------------|------------------|
| e2e00001-... | consulta/pendiente | NULL | NULL | NULL |
| 650d2e5b-... | consulta/pendiente | NULL | NULL | NULL |
| e2e035r0-...-001 | post_evento/pendiente | NULL | NULL | NULL |
| e2e035r0-...-002 | post_evento/pendiente | NULL | NULL | NULL |

Los tests de US-036 usan `slotify_test` (`.env.test`), NO `slotify_dev`. El estado de `slotify_dev` no fue mutado por los tests.

| Métrica | Antes | Después | Delta |
|---------|-------|---------|-------|
| total reservas dev | 4 | 4 | 0 |
| justificante_pago docs dev | 0 | 0 | 0 |
| audit_log dev | 330 | 330 | 0 |

**No se requiere restauración.** El estado de BD de dev es idéntico al baseline.

---

## 4. Verificación SQL real del esquema (lección US-049)

Columna `motivo_retencion` verificada con SQL real en `slotify_dev`:

```
docker exec slotify-postgres psql -U user -d slotify_dev -c "\d reserva"
```

Resultado: `motivo_retencion | text | | |` presente en la definición de la tabla (Nullable, tipo `text`).

---

## 5. Resultado

**OUTCOME: PASS**

- 84 tests de US-036 (5 suites: dominio, caso de uso, controller HTTP, concurrencia): todos en VERDE.
- BD `slotify_dev` sin mutación tras los tests.
- Columna `motivo_retencion` presente en el esquema real de la BD.
- El único fallo de la suite global es el flaky pre-existente de US-004 (no atribuible a US-036).
