# QA Report — Step N+1: Unit Tests + DB State Verification
## Change: us-012-expirar-consulta-ttl
## Date: 2026-07-01
## Executor: qa-verifier (agente)

---

## 1. BD Baseline (pre-tests)

Base de datos: `slotify_test` (`postgresql://user:password@localhost:5432/slotify_test`)

| Tabla | Count |
|-------|-------|
| `reserva` | 0 |
| `fecha_bloqueada` | 0 |
| `audit_log` | 0 |
| `tenant` | 2 |

Estado: BD limpia. Ninguna candidata expirada preexistente.

---

## 2. Tests dirigidos de US-012 ejecutados

Comando:
```
npx jest --runInBand --testPathPatterns="maquina-estados-expiracion-ttl|expirar-consultas|barrido-expiracion"
```

### 2.1 Suite: `maquina-estados-expiracion-ttl.spec.ts`
Cubre: task 3.1 — mapa/guarda declarativos `resolverExpiracionTtl(estado, subEstado)`.
Escenarios cubiertos:
- `2b/2c/2v` de `consulta` expiran a `consulta/2x` (it.each 3 candidatos)
- `pre_reserva` (null) expira a `reserva_cancelada` (null)
- Terminales `2x/2y/2z/reserva_cancelada/reserva_completada` devuelven `null`
- `2a` y `2d` (no candidatos) devuelven `null`
- Estados principales no candidatos (`reserva_confirmada`, `evento_en_curso`, `post_evento`) devuelven `null`
- Determinismo: misma entrada = mismo resultado (función pura sobre tabla de datos)
- No confunde `2x` (TTL) con `2y` (cola) ni `2z` (cliente)

### 2.2 Suite: `expirar-consultas.use-case.spec.ts`
Cubre: tasks 3.2, 3.3, 3.4, 3.5, 3.6, 3.9 — caso de uso contra dobles de puertos in-memory.
Escenarios cubiertos:
- 2b sin cola: transición 2b→2x + fecha liberada, sin promoción
- 2b con cola: seam `PromocionColaPort` disparado exactamente una vez (D-8)
- 2c sin cola: transición 2c→2x, sin promoción posible
- 2v sin cola heredada: transición 2v→2x, sin promoción
- 2v con cola heredada: promoción disparada
- pre_reserva: transición a `reserva_cancelada` (sub_estado NULL), sin promoción
- Idempotencia: candidata que bajo lock ya no es candidata → `expirada=false`, no cuenta como fallo
- Fallo aislado por RESERVA: fallo de una no corta el lote; resumen refleja fallo
- Cross-tenant: candidatas de TENANT_A y TENANT_B procesadas con su propio tenantId
- Sin candidatas: resumen `{0,0,0,0}`

### 2.3 Suite: `expirar-consultas-integracion.spec.ts`
Cubre: tasks 3.2, 3.4, 3.5, 3.6, 3.7, 3.8, 3.9 — integración real contra Postgres `slotify_test`.
Escenarios cubiertos:
- 2b sin cola: transición real + FECHA_BLOQUEADA eliminada + AUDIT_LOG `accion='transicion'` y `accion='eliminar'`
- 2b con cola: seam disparado (cola en 2d)
- 2c: transición 2c→2x
- 2v sin cola: transición 2v→2x
- 2v con cola heredada: seam disparado
- pre_reserva: transición a `reserva_cancelada`, FECHA_BLOQUEADA eliminada
- Idempotencia (D-4): 2ª ejecución → 0 cambios, 0 auditorías duplicadas; reserva ya terminal → no expira
- FECHA_BLOQUEADA ya eliminada antes del barrido → transición sin error (DELETE 0 = éxito silencioso)
- TTL extendido (US-006 simulado): `ttl_expiracion > now()` → no seleccionada
- Selección por instante (D-7): `ttl_expiracion < now()` en `timestamptz`, no fecha formateada
- Fallo aislado: fallo en una candidata → rollback solo de esa; las demás expiran

### 2.4 Suite: `expirar-consultas-concurrencia.spec.ts`
Cubre: task 3.10 — tests de concurrencia reales (skill `concurrency-locking`).
Escenarios cubiertos:
- RC-1: doble barrido simultáneo sobre la misma RESERVA → exactamente 1 transición, 0 duplicados
- RC-2: expiración vs extensión manual US-006 → exactamente una gana, sin estado intermedio
- RC-3: liberación por expiración vs nuevo bloqueo de la misma fecha → nunca doble bloqueo (`UNIQUE`)

### 2.5 Suite: `barrido-expiracion.controller.spec.ts`
Cubre: task 3.11 — endpoint/guard `CronTokenGuard` contra app Nest mínima con supertest.
Escenarios cubiertos:
- `X-Cron-Token` válido → 200 con resumen `BarridoExpiracionResponse` exacto
- Cabecera `X-Cron-Token` ausente → 401
- `X-Cron-Token` incorrecto → 401
- `Authorization: Bearer <jwt>` sin cabecera de cron → 401

---

## 3. Resultado de Tests Dirigidos

```
Test Suites: 5 passed, 5 total
Tests:       46 passed, 46 total
Snapshots:   0 total
Time:        ~20s
```

**Resultado: PASS (5/5 suites, 46/46 tests)**

---

## 4. Suite Completa (`pnpm test` / `npx jest --runInBand`)

Comando:
```
npx jest --runInBand
```

Resultado:
```
Test Suites: 1 failed, 77 passed, 78 total
Tests:       1 failed, 567 passed, 568 total
Snapshots:   0 total
Time:        ~121s
```

### Fallo detectado: DEUDA PREEXISTENTE US-004

Suite fallida: `src/reservas/__tests__/alta-consulta-con-fecha-concurrencia.spec.ts`

Error:
```
Raw query failed. Code: `40P01`. Message: `ERROR: deadlock detected
Process N waits for ShareLock on transaction X; blocked by process M.
Process M waits for ShareLock on transaction Y; blocked by process N.
```

Este fallo es el **deadlock 40P01 pre-existente de US-004**, documentado en la memoria del proyecto (`MEMORY.md`: "US-004 concurrency test flaky — deadlock 40P01 pre-existente que deja la suite global en rojo intermitente"). **No es atribuible a US-012**. Ningún archivo de US-012 fue modificado en relación con este test. La suite us-012 pasa al 100%.

---

## 5. BD Post-tests

| Tabla | Count | Delta |
|-------|-------|-------|
| `reserva` | 0 | 0 |
| `fecha_bloqueada` | 0 | 0 |
| `audit_log` | 0 | 0 |
| `tenant` | 2 | 0 |

Estado: BD idéntica al baseline. Los tests de integración limpian correctamente en `afterAll`/`afterEach`. **Sin mutación residual.**

---

## 6. Restauración BD

No fue necesaria restauración: la BD quedó en estado idéntico al baseline tras los tests.

---

## Outcome

**PASS** — Las 5 suites de US-012 (46 tests) pasan en verde. El fallo en la suite global es el deadlock 40P01 de US-004, deuda preexistente documentada, no atribuible a este change.
