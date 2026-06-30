# Step 6 — Unit Tests + Verificación de BD
## Change: 2026-06-30-us-008-programar-visita-espacio
## Fecha: 30/06/2026
## Agente: qa-verifier

---

## 1. Baseline de BD (pre-tests)

| Tabla | Count |
|-------|-------|
| RESERVA (total) | 9 |
| RESERVA s2a | 1 |
| RESERVA s2b | 5 |
| RESERVA s2c | 1 |
| RESERVA s2d | 2 |
| FECHA_BLOQUEADA | 2 |
| AUDIT_LOG | 62 |
| COMUNICACION | 9 |
| CLIENTE | 9 |

Nota: las 2 filas de FECHA_BLOQUEADA preexisten de los seeds de US-005/007 (una para la RESERVA 2b `0c421363` y otra para la 2c `d07f3b65`). El registro extra de COMUNICACION (9 vs 8 de US-007) corresponde a la RESERVA creada mediante la UI el 30-06 (código 26-0009).

- PostgreSQL: `slotify-postgres` (Docker, estado `healthy`)
- Branch: `feature/us-008-programar-visita-espacio`

---

## 2. Tests ejecutados

### 2.1 Suite dirigida US-008 (4 suites)

Comando:
```
pnpm exec jest --testPathPatterns="programar-visita|maquina-estados-programar-visita" --forceExit --no-coverage --runInBand --verbose
```

| Spec | Tests | Resultado |
|------|-------|-----------|
| `maquina-estados-programar-visita.spec.ts` | 13 | PASS |
| `programar-visita.use-case.spec.ts` | 22 | PASS |
| `programar-visita-integracion.spec.ts` | 10 | PASS |
| `programar-visita-concurrencia.spec.ts` | 5 | PASS |

**Total suite dirigida: 50 tests / 4 suites — todos PASS**

Runtime: 21.335 s

### 2.2 Suite completa

Comando:
```
pnpm exec jest --forceExit --no-coverage --runInBand
```

Resultado: **417 passed, 1 failed / 61 suites total**

El único fallo es en `alta-consulta-con-fecha-concurrencia.spec.ts` — error PostgreSQL deadlock `40P01` en el test `debe_producir_un_unico_bloqueo_y_posiciones_de_cola_unicas_y_contiguas_1_a_N_menos_1`. Este fallo es el **defecto pre-existente conocido de US-004** documentado en `.claude/projects/.../memory/us004-concurrency-test-flaky.md` (deadlock flaky del bloqueo de alta concurrente). No es un fallo de US-008.

Runtime suite completa: 102.054 s

---

## 3. Criterios de aceptación verificados por spec

| Criterio | Spec | Resultado |
|----------|------|-----------|
| D-1: `esOrigenValidoParaProgramarVisita` acepta `{2a,2b,2c}` | `maquina-estados-programar-visita.spec.ts` (3 tests) | PASS |
| D-1: `2d` rechazado (cola) | `maquina-estados-programar-visita.spec.ts` (2 tests) | PASS |
| D-1: terminales `{2x,2y,2z}` rechazados | `maquina-estados-programar-visita.spec.ts` (3 tests) | PASS |
| D-1: estados no-consulta rechazados | `maquina-estados-programar-visita.spec.ts` (6 tests) | PASS |
| D-1: `consulta` sin subEstado rechazado | `maquina-estados-programar-visita.spec.ts` (1 test) | PASS |
| UC-12: `2d → 409` con mensaje UC-12 | `programar-visita.use-case.spec.ts` (3.1) | PASS |
| Terminales → 422 sin mutar | `programar-visita.use-case.spec.ts` (3.1) | PASS |
| 404 reserva inexistente (multi-tenant RLS) | `programar-visita.use-case.spec.ts` (3.1) | PASS |
| `2a` sin `fecha_evento` → 422 sin mutar | `programar-visita.use-case.spec.ts` (3.2) | PASS |
| Ventana fecha ≤ hoy → 422 | `programar-visita.use-case.spec.ts` (3.3) | PASS |
| Ventana fecha > hoy+max_dias → 422 | `programar-visita.use-case.spec.ts` (3.3) | PASS |
| Borde exacto hoy+7 → acepta | `programar-visita.use-case.spec.ts` (3.3) | PASS |
| Setting `max_dias_programar_visita` leído de TENANT_SETTINGS | `programar-visita.use-case.spec.ts` (3.3) | PASS |
| `2b/2c → 2v` + campos visita + UPDATE TTL + auditoria | `programar-visita.use-case.spec.ts` (3.4) | PASS |
| `2a → 2v` + INSERT nueva fila FECHA_BLOQUEADA blanda + TTL | `programar-visita.use-case.spec.ts` (3.5) | PASS |
| Atomicidad: fallo parcial propaga error para rollback | `programar-visita.use-case.spec.ts` (3.6) | PASS |
| E6 disparado tras commit (`invocationCallOrder` E6 > UoW) | `programar-visita.use-case.spec.ts` (3.8) | PASS |
| Fallo proveedor email no revierte transición | `programar-visita.use-case.spec.ts` (3.8) | PASS |
| Integración BD: `2b → 2v` + UPDATE FECHA_BLOQUEADA + E6 + AUDIT_LOG | `programar-visita-integracion.spec.ts` (3.4) | PASS |
| Integración BD: `2a → 2v` + INSERT fila blanda + E6 | `programar-visita-integracion.spec.ts` (3.5) | PASS |
| Integración BD: `2c → 2v` + UPDATE TTL bloqueo previo | `programar-visita-integracion.spec.ts` (3.4) | PASS |
| Integración BD: `2d → 409` RESERVA intacta | `programar-visita-integracion.spec.ts` (3.1) | PASS |
| Integración BD: terminal → 422 RESERVA intacta | `programar-visita-integracion.spec.ts` (3.1) | PASS |
| Integración BD: `2a` sin fecha_evento → 422 sin bloqueo | `programar-visita-integracion.spec.ts` (3.2) | PASS |
| Integración BD: ventana fecha → 422 RESERVA intacta | `programar-visita-integracion.spec.ts` (3.3) | PASS |
| Integración BD: RLS cross-tenant → 404 | `programar-visita-integracion.spec.ts` | PASS |
| Concurrencia: dos simultáneas → exactamente una aplica + guarda | `programar-visita-concurrencia.spec.ts` (D-9) | PASS |
| Concurrencia: transición vs barrido A4 → estado coherente | `programar-visita-concurrencia.spec.ts` (D-9) | PASS |
| Concurrencia: INSERT desde `2a` vs bloqueo concurrente → UNIQUE | `programar-visita-concurrencia.spec.ts` (D-9) | PASS |

---

## 4. Verificación de estado de BD post-tests

| Tabla | Baseline | Post-tests | Delta | Estado |
|-------|----------|------------|-------|--------|
| RESERVA total | 9 | 9 | 0 | OK |
| RESERVA s2a | 1 | 1 | 0 | OK |
| RESERVA s2b | 5 | 5 | 0 | OK |
| RESERVA s2c | 1 | 1 | 0 | OK |
| RESERVA s2d | 2 | 2 | 0 | OK |
| FECHA_BLOQUEADA | 2 | 2 | 0 | OK |
| AUDIT_LOG | 62 | 62 | 0 | OK |
| COMUNICACION | 9 | 9 | 0 | OK |
| CLIENTE | 9 | 9 | 0 | OK |

**Estado BD: idéntico al baseline.** Los tests de integración utilizan sus propios seeds con patrón de email `@us008-int.test` y `@us008-conc.test`, y limpian en `beforeEach`/`afterAll`. No dejaron residuos en la BD.

---

## 5. Restauración de BD

No fue necesaria restauración adicional. Los tests de integración limpian correctamente mediante su patrón de email y las operaciones `limpiar()` en los hooks `beforeEach`/`afterAll`.

---

## Outcome: PASS

Todos los tests de US-008 en verde (50/50). Suite completa: 417/418 passed (1 fallo pre-existente US-004, no relacionado con US-008). BD idéntica al baseline. Sin bloqueantes de US-008.
