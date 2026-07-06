# QA Report — Step N+1: Unit Tests + DB State Verification
## US-049 — GET /reservas (Pipeline de Reservas Activas)

**Fecha:** 2026-07-06
**Agente:** qa-verifier
**Change:** us-049-endpoint-get-reservas-pipeline
**BD de test:** `slotify_test` (`.env.test`) — BD aislada, NO la de dev

---

## 6.1 Baseline de BD (slotify_test — PRE-TEST)

| Tabla | Count baseline |
|-------|---------------|
| reserva | 1 |
| cliente | 4 |
| tenant | 3 |
| usuario | 3 |
| fecha_bloqueada | 0 |

Captura mediante `PrismaClient` apuntando a `postgresql://user:password@localhost:5432/slotify_test`.

---

## 6.2 Tests dirigidos del módulo cambiado

**Archivo:** `apps/api/src/reservas/__tests__/listar-reservas.use-case.spec.ts`

**Comando ejecutado:**
```
cd apps/api && npx jest --testPathPatterns="listar-reservas.use-case.spec" --runInBand
```

**Resultado:**
```
Test Suites: 1 passed, 1 total
Tests:       22 passed, 22 total
Snapshots:   0 total
Time:        11.311 s
```

**Tests cubiertos (22/22 en verde):**

| Ref spec | Test | Estado |
|----------|------|--------|
| 3.1 | lista vacía → `data: []`, `metadata.total = 0` | PASS |
| 3.2 | incluye todos los estados activos (2a/2b/2c/2d/2v/pre_reserva/reserva_confirmada/evento_en_curso/post_evento) ordenados por fechaCreacion DESC | PASS |
| 3.3 | excluye 2x/2y/2z/reserva_completada/reserva_cancelada | PASS |
| 3.4 | aislamiento multi-tenant: tenantId del comando propagado al puerto | PASS |
| 3.5 | derivación progressLogistica: pendiente=0, en_curso=50, cerrado=100; consulta 2a/2b/2c/2d/2v → 0; pre_reserva → 0 (8 casos) | PASS |
| 3.6 | derivación progressLiquidacion: pendiente=0, facturada=50, cobrada=100; consulta sin liquidación → 0; pre_reserva → 0 (5 casos) | PASS |
| 3.7 | nombreEvento = "{cliente.nombre} {cliente.apellidos}"; fallback a codigo si cliente null | PASS |
| 3.8 | filtro por estado propagado al puerto; todos los resultados del estado filtrado | PASS |
| 3.9 | lectura pura: no-mutación (guardar/actualizar/eliminar NO invocados) | PASS |

---

## 6.3 Suite completa (`pnpm test` / `npx jest --runInBand`)

**Comando ejecutado:**
```
cd apps/api && npx jest --runInBand
```

**Resultado:**
```
Test Suites: 1 failed, 144 passed, 145 total
Tests:       1 failed, 1307 passed, 1308 total
Snapshots:   0 total
Time:        165.109 s
```

**Fallo detectado (pre-existente — NO es regresión de US-049):**

- **Archivo:** `src/reservas/__tests__/alta-consulta-con-fecha-concurrencia.spec.ts`
- **Test:** `debe_producir_un_unico_bloqueo_y_posiciones_de_cola_unicas_y_contiguas_1_a_N_menos_1`
- **Error:** `PrismaClientKnownRequestError: Raw query failed. Code: 40P01` (deadlock detectado)
- **Causa:** Deadlock de PostgreSQL (`DETAIL: Process N waits for ShareLock on transaction X; blocked by process M. Process M waits for ShareLock on transaction Y; blocked by process N.`)
- **Verificación en aislado:** El test pasa cuando se ejecuta solo (`npx jest --testPathPatterns="alta-consulta-con-fecha-concurrencia" --runInBand`): 2 passed, 2 total.
- **Conclusión:** Es el fallo flaky pre-existente documentado en `MEMORY.md` (entrada "US-004 concurrency test flaky") con deadlock 40P01. NO es regresión introducida por US-049 (que es lectura pura, sin bloqueos atómicos ni mutaciones). No se cuenta como regresión de esta US.

**Módulo US-049:** `listar-reservas.use-case.spec.ts` → 22/22 en verde en la suite global.

---

## 6.4 Verificación del estado de BD post-test (slotify_test)

| Tabla | Baseline | Post-suite | Delta | Restauración |
|-------|----------|-----------|-------|-------------|
| reserva | 1 | 1 | 0 | No necesaria |
| cliente | 4 | 4 | 0 | No necesaria |
| tenant | 3 | 3 | 0 | No necesaria |
| usuario | 3 | 3 | 0 | No necesaria |
| fecha_bloqueada | 0 | 0 | 0 | No necesaria |

**Conclusión:** La BD de test quedó idéntica al baseline. El use-case es lectura pura: no produce ninguna escritura. Confirmado por la cobertura del test 3.9 (no-mutación) y la verificación directa de counts.

---

## Outcome: PASS

- 22/22 tests del módulo US-049 en verde.
- 1307/1308 tests de la suite en verde (el 1 fallido es el flaky pre-existente US-004 / 40P01, ajeno a esta US).
- BD de test intacta post-suite (lectura pura confirmada).
