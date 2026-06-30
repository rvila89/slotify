# Step 6 — Unit Tests + Verificación de BD
## Change: us-007-transicion-pendiente-invitados
## Fecha: 2026-06-30
## Agente: qa-verifier

---

## 1. Baseline de BD (pre-tests)

| Tabla | Count |
|-------|-------|
| RESERVA (total) | 8 |
| RESERVA s2a | 1 |
| RESERVA s2b | 5 |
| RESERVA s2d | 2 |
| FECHA_BLOQUEADA | 0 |
| AUDIT_LOG | 55 |
| COMUNICACION | 8 |
| CLIENTE | 8 |

Nota: las 5 RESERVA en s2b son del seed; ninguna tiene FECHA_BLOQUEADA activa (el seed no las crea).

---

## 2. Entorno

- PostgreSQL: `slotify-postgres` (Docker, estado `healthy`)
- `prisma migrate status`: las migraciones están al día (D-8 confirma: sin migración nueva para US-007)
- Branch: `feature/us-007-transicion-pendiente-invitados`

---

## 3. Tests ejecutados

### 3.1 Suite dirigida (5 specs de US-007)

Comando: `pnpm exec jest --testPathPatterns="pendiente-invitados" --forceExit --no-coverage --runInBand --verbose`

| Spec | Tests | Resultado |
|------|-------|-----------|
| `maquina-estados-transicion-pendiente-invitados.spec.ts` | 9 | PASS |
| `transicion-pendiente-invitados-ttl.spec.ts` | 4 | PASS |
| `transicion-pendiente-invitados.use-case.spec.ts` | 21 | PASS |
| `transicion-pendiente-invitados-integracion.spec.ts` | 7 | PASS |
| `transicion-pendiente-invitados-concurrencia.spec.ts` | 2 | PASS |

**Total suite dirigida: 43 tests / 5 suites — todos PASS**

### 3.2 Suite completa `pnpm test`

Comando: `pnpm test --testPathPattern=pendiente-invitados --forceExit` (ejecutó toda la suite via `jest --runInBand`)

Resultado: **368 tests / 57 suites — todos PASS**

Nota: el script de `pnpm test` = `jest --runInBand && pnpm run arch`. El `arch` (depcruise) falló al recibir los flags extra de playwright (`--testPathPattern`), pero el bloque `jest` finalizó con todos los tests en verde. Se verificó también ejecutando la suite completa sin flags: 368/368 PASS.

---

## 4. Verificación de BD post-tests

| Tabla | Count pre | Count post | Delta | Correcto |
|-------|-----------|------------|-------|----------|
| RESERVA total | 8 | 8 | 0 | SI |
| RESERVA s2a | 1 | 1 | 0 | SI |
| RESERVA s2b | 5 | 5 | 0 | SI |
| RESERVA s2d | 2 | 2 | 0 | SI |
| FECHA_BLOQUEADA | 0 | 0 | 0 | SI |
| AUDIT_LOG | 55 | 55 | 0 | SI |
| COMUNICACION | 8 | 8 | 0 | SI |
| CLIENTE | 8 | 8 | 0 | SI |

**Estado BD: identico al baseline. Los tests de integración limpian correctamente (beforeEach/afterAll con patron `@us007-int.test`).**

---

## 5. Criterios de aceptación verificados

| Criterio | Verificado por | Resultado |
|----------|----------------|-----------|
| D-1: solo origen 2b (estricto) | `maquina-estados-transicion-pendiente-invitados.spec.ts` (9 tests) | PASS |
| TTL extendido: base = ttl actual + ttl_consulta_dias (no now()) | `transicion-pendiente-invitados-ttl.spec.ts` (4 tests) | PASS |
| TTL extendido en RESERVA y FECHA_BLOQUEADA al mismo valor | `transicion-pendiente-invitados.use-case.spec.ts` (3.2) | PASS |
| Cola 2d→2y con posicion_cola=NULL y consulta_bloqueante_id=NULL (A16) | `transicion-pendiente-invitados.use-case.spec.ts` (3.3) | PASS |
| AUDIT_LOG por principal (2b→2c) y por cada descartada (2d→2y) | `transicion-pendiente-invitados.use-case.spec.ts` (3.3) | PASS |
| Atomicidad: fallo parcial → rollback completo | `transicion-pendiente-invitados.use-case.spec.ts` (3.4) | PASS |
| 409 sin FECHA_BLOQUEADA activa | `transicion-pendiente-invitados.use-case.spec.ts` (3.6) | PASS |
| 409 TTL expirado | `transicion-pendiente-invitados.use-case.spec.ts` (3.6) | PASS |
| D-7: NINGÚN email (no puerto de email en deps) | `transicion-pendiente-invitados.use-case.spec.ts` (3.7) | PASS |
| D-7: NINGUNA COMUNICACION en BD | `transicion-pendiente-invitados-integracion.spec.ts` (3.7) | PASS |
| Integración real (PostgreSQL): 2b→2c + TTL ambas tablas | `transicion-pendiente-invitados-integracion.spec.ts` (3.2) | PASS |
| Integración real: vaciado de cola A16 + audit | `transicion-pendiente-invitados-integracion.spec.ts` (3.3) | PASS |
| Integración real: precondición bloqueo (sin FB → 409, expirado → 409) | `transicion-pendiente-invitados-integracion.spec.ts` (3.6) | PASS |
| RLS multi-tenant: cross-tenant → 404 | `transicion-pendiente-invitados-integracion.spec.ts` | PASS |
| Concurrencia: exactamente-una transición, la segunda cae en guarda | `transicion-pendiente-invitados-concurrencia.spec.ts` | PASS |

---

## 6. Restauración de BD

No fue necesaria restauración: los tests de integración usan su propio seed con patrón de email `@us007-int.test` y limpian en `beforeEach`/`afterAll`. El estado post-tests es idéntico al baseline.

---

## Outcome: PASS

Todos los tests en verde. BD idéntica al baseline. Sin bloqueantes.
