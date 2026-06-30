# Step 6 — Unit Tests + Verificación de BD
## Change: us-006-extender-plazo-bloqueo
## Fecha: 2026-06-30
## Agente: qa-verifier

---

## 1. Baseline de BD (pre-tests)

| Tabla | Count |
|-------|-------|
| RESERVA (total, tenant) | 9 |
| RESERVA s2a | 1 |
| RESERVA s2b | 6 |
| RESERVA s2c | 1 |
| RESERVA s2d | 2 |
| FECHA_BLOQUEADA | 0 |
| AUDIT_LOG | 69 |

Las 6 RESERVA en s2b y 1 en s2c son del seed; ninguna tiene FECHA_BLOQUEADA activa (el seed no las crea). Las 9 reservas tienen TTL vigente donde corresponde por estado.

Reservas con TTL vigente antes de tests:
- `3d8dd655` (2b, fechaEvento 2026-08-08, ttl 2026-07-02T14:29:14.137Z)
- `af594bda` (2b, fechaEvento 2026-07-18, ttl 2026-07-02T14:32:04.482Z)
- `a2c03835` (2b, fechaEvento 2026-07-26, ttl 2026-07-03T07:03:10.430Z)
- `d07f3b65` (2c, fechaEvento 2026-07-04, ttl 2026-07-06T11:12:29.926Z)
- `c9303a17` (2b, fechaEvento 2026-07-18, ttl 2026-07-03T07:04:44.550Z)
- `0c421363` (2b, fechaEvento 2026-07-11, ttl 2026-07-03T09:12:19.694Z)

---

## 2. Entorno

- PostgreSQL: Docker (`slotify-postgres`), estado healthy
- Branch: `feature/us-006-extender-plazo-bloqueo`
- `prisma migrate status`: sin migraciones nuevas (US-006 no requiere migración)

---

## 3. Tests ejecutados

### 3.1 Suite dirigida (5 specs de US-006)

Comando: `npx jest --testPathPatterns="extender-bloqueo" --runInBand --no-coverage`

| Spec | Tests | Resultado |
|------|-------|-----------|
| `maquina-estados-extender-bloqueo.spec.ts` | 15 | PASS |
| `extender-bloqueo.use-case.spec.ts` | 25 | PASS |
| `extender-bloqueo-integracion.spec.ts` | 12 | PASS |
| `extender-bloqueo.controller.spec.ts` | 5 | PASS |
| `extender-bloqueo-concurrencia.spec.ts` | 2 | PASS |

**Total suite dirigida: 59 tests / 5 suites — todos PASS**
**Tiempo: 19.18 s**

### 3.2 Suite completa `pnpm test` (jest --runInBand)

Comando: `npx jest --runInBand --no-coverage`

Resultado: **476 passed, 1 failed (flaky ajeno) / 66 total suites — 102.9 s**

Fallo detectado: `alta-consulta-con-fecha-concurrencia.spec.ts` (US-004) — deadlock PostgreSQL 40P01 pre-existente (documentado en MEMORY.md `us004-concurrency-test-flaky.md`). NO es un fallo de US-006. Las 5 suites de US-006 permanecen en verde en esta ejecución.

---

## 4. Verificación de BD post-tests

| Tabla | Count pre | Count post | Delta | Correcto |
|-------|-----------|------------|-------|----------|
| RESERVA total | 9 | 9 | 0 | SI |
| RESERVA s2b | 6 | 6 | 0 | SI |
| RESERVA s2c | 1 | 1 | 0 | SI |
| FECHA_BLOQUEADA | 0 | 0 | 0 | SI |
| AUDIT_LOG | 69 | 69 | 0 | SI |

Los TTL de todas las reservas son idénticos pre/post tests (los tests de integración usan su propio seed con patrón `@us006-*.test` o `@us006-conc.test` y limpian en `beforeEach`/`afterAll`). Estado BD: idéntico al baseline.

### 4.1 Invariancias verificadas por los tests

| Invariancia | Spec que lo verifica | Resultado |
|------------|---------------------|-----------|
| RESERVA.ttl_expiracion = ttl_anterior + N días (NO now()) | use-case.spec (happy path) | PASS |
| FECHA_BLOQUEADA.ttl_expiracion = mismo nuevo valor | use-case.spec + integracion | PASS |
| estado/subEstado sin cambios | use-case.spec (invariancia) | PASS |
| tipo_bloqueo/fecha sin cambios | integracion.spec | PASS |
| AUDIT_LOG accion='actualizar' con datos_anteriores/nuevos.ttlExpiracion | use-case.spec | PASS |
| Atomicidad: fallo parcial → rollback | use-case.spec (atomicidad) | PASS |
| 409 TTL expirado | use-case.spec + integracion | PASS |
| 409 sin fila bloqueante blanda | use-case.spec + integracion | PASS |
| 409 reserva_confirmada (firme) | use-case.spec | PASS |
| 422 estado 2a/terminal (predicado declarativo) | maquina-estados.spec + use-case | PASS |
| 422 dias 0/negativo/no entero | use-case.spec | PASS |
| 404 reserva inexistente o cross-tenant | integracion.spec | PASS |
| Concurrencia: dos extensiones → serialización sin lost-update | concurrencia.spec (2/2) | PASS |
| Concurrencia: extensión vs barrido → coherencia sin estado intermedio | concurrencia.spec (2/2) | PASS |

---

## 5. Restauración de BD

No fue necesaria restauración: los tests de integración usan su propio seed aislado y limpian en `beforeEach`/`afterAll`. El estado post-tests es idéntico al baseline.

---

## Outcome: PASS

59/59 tests US-006 en verde. Suite global: 476/477 PASS (1 flaky pre-existente ajeno US-004). BD idéntica al baseline. Sin bloqueantes.
