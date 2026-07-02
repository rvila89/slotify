# Step N+1 — Unit Tests + Verificación de BD (2026-07-02)

## Módulo: US-017 Visualizar Cola de Espera

### Comandos ejecutados

```
# Tests dirigidos de US-017 (3 archivos)
cd apps/api
npx jest --testPathPatterns="cola-espera" --runInBand

# Suite completa
npx jest --runInBand
```

### BD baseline (pre-tests) — slotify_test

| tabla             | pre  |
|-------------------|------|
| reserva           | 0    |
| cliente           | 0    |
| fecha_bloqueada   | 0    |
| audit_log         | 0    |

### Resultados — tests dirigidos (cola-espera)

```
Test Suites: 3 passed, 3 total
Tests:       25 passed, 25 total
Snapshots:   0 total
Time:        17.913 s
Ran all test suites matching cola-espera.
```

Suites cubiertas:
- `cola-espera-derivacion.spec.ts` — dominio puro: `derivarTtlRestante` y `derivarTiempoEnCola` (instantes, anti off-by-one TZ)
- `obtener-cola-espera.query.spec.ts` — aplicación aislada contra puerto mock: happy path, FA-01, FA-02, FA-03, FA-04, FA-05, aislamiento multi-tenant
- `obtener-cola-espera-integracion.spec.ts` — integración real contra slotify_test: filtrado s2d, orden FIFO, FA-04 fecha disponible vs 404, RLS cross-tenant

### Resultados — suite completa

```
Test Suites: 1 failed, 88 passed, 89 total
Tests:       1 failed, 646 passed, 647 tests
Time:        200.591 s
```

El único fallo:
- `alta-consulta-con-fecha-concurrencia.spec.ts` — ERROR `40P01` (deadlock en SELECT FOR UPDATE)
- **Identificado como defecto PRE-EXISTENTE** documentado en la memoria del proyecto: "US-004 concurrency test flaky — deadlock 40P01 pre-existente que deja la suite global en rojo intermitente".
- No tiene relación con US-017 (lectura pura, sin transacciones de escritura ni bloqueos).

Los 25 tests de US-017 están en VERDE. No hay regresiones en los 621 otros tests distintos del flaky pre-existente.

### BD post-tests — slotify_test

| tabla             | pre | post | restaurado |
|-------------------|-----|------|------------|
| reserva           | 0   | 0    | n/a        |
| cliente           | 0   | 0    | n/a        |
| fecha_bloqueada   | 0   | 0    | n/a        |
| audit_log         | 0   | 0    | n/a        |

La BD queda intacta. US-017 es lectura pura: los tests de integración crean y limpian su propio sembrado en `beforeEach`/`afterAll` con patrón propio del spec.

### Outcome

**PASS**

- US-017 específico: 25/25 tests verdes.
- Suite global: 646/647 (fallo pre-existente US-004, documentado, ajeno a US-017).
- BD slotify_test: sin mutación residual.
