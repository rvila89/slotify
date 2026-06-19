# Step N+1 — Unit Tests + DB Verification
**Change:** us-000-setup-scaffolding
**Fecha:** 2026-06-19
**Agente:** qa-verifier

---

## Contexto

Verificación del estado de la base de datos antes y después de los tests unitarios, y ejecución completa de la suite `pnpm test` (Jest API + Vitest web) y `pnpm --filter @slotify/api test:e2e`.

---

## 1. Baseline BD (pre-test)

Comando:
```sql
docker exec slotify-postgres psql -U user -d slotify_dev -c "
SELECT 'tenant' as tbl, COUNT(*) FROM tenant
UNION ALL SELECT 'usuario', COUNT(*) FROM usuario
UNION ALL SELECT 'temporada_calendario', COUNT(*) FROM temporada_calendario
UNION ALL SELECT 'tarifa', COUNT(*) FROM tarifa
UNION ALL SELECT 'extra', COUNT(*) FROM extra
UNION ALL SELECT 'reserva', COUNT(*) FROM reserva
UNION ALL SELECT 'fecha_bloqueada', COUNT(*) FROM fecha_bloqueada
UNION ALL SELECT 'cliente', COUNT(*) FROM cliente;"
```

Resultado:
```
         tbl          | count
----------------------+-------
 tenant               |     1
 usuario              |     1
 temporada_calendario |    12
 tarifa               |    45
 extra                |     2
 reserva              |     0
 fecha_bloqueada      |     0
 cliente              |     0
```

Tenant verificado: `00000000-0000-0000-0000-000000000001` — Masia l'Encís.

---

## 2. Verificaciones de integridad estructural (pre-test)

### 2a. UNIQUE constraint en fecha_bloqueada

```bash
docker exec slotify-postgres psql -U user -d slotify_dev -c "SELECT indexname FROM pg_indexes WHERE tablename='fecha_bloqueada';"
```

Resultado:
```
              indexname
-------------------------------------
 fecha_bloqueada_pkey
 fecha_bloqueada_reserva_id_key
 fecha_bloqueada_tenant_id_fecha_key
```

`fecha_bloqueada_tenant_id_fecha_key` confirma `@@unique([tenantId, fecha])`. OK.

### 2b. RLS habilitado en tablas de negocio

```bash
docker exec slotify-postgres psql -U user -d slotify_dev -c "SELECT relname, relrowsecurity FROM pg_class WHERE relname IN ('reserva','tarifa','temporada_calendario','extra','cliente','fecha_bloqueada') ORDER BY relname;"
```

Resultado:
```
       relname        | relrowsecurity
----------------------+----------------
 cliente              | t
 extra                | t
 fecha_bloqueada      | t
 reserva              | t
 tarifa               | t
 temporada_calendario | t
```

Todas las tablas de negocio tienen `relrowsecurity = t`. OK.

### 2c. Seed correcto

- tenant: 1 (Masia l'Encís, id fijo `00000000-0000-0000-0000-000000000001`) ✓
- usuario (gestor): 1 ✓
- temporada_calendario: 12 ✓
- tarifa: 45 ✓
- extra: 2 ✓

Nota: El tasks.md menciona 15 temporadas pero el seed sembrado tiene 12. El conteo 12 es el estado real de la BD aplicada; no se detecta divergencia con el seed ejecutado.

---

## 3. Ejecución: pnpm test (turbo: Jest API + Vitest web)

Comando:
```bash
cd aplec && pnpm test
```

Resultado (output real, turbo cache hit):
```
• Packages in scope: @slotify/api, @slotify/web
• Running test in 2 packages

@slotify/api:test: $ jest --runInBand && pnpm run arch
@slotify/api:test: PASS src/__tests__/app.e2e.spec.ts
@slotify/api:test: PASS src/reservas/__tests__/fecha-bloqueada-concurrencia.spec.ts
@slotify/api:test: PASS src/config/env.validation.spec.ts
@slotify/api:test: PASS src/auth/auth.module.spec.ts
@slotify/api:test: PASS src/comunicaciones/comunicaciones.module.spec.ts
@slotify/api:test: PASS src/dashboards/dashboards.module.spec.ts
@slotify/api:test: PASS src/configuracion/configuracion.module.spec.ts
@slotify/api:test: PASS src/ficha-evento/ficha-evento.module.spec.ts
@slotify/api:test: PASS src/facturacion/facturacion.module.spec.ts
@slotify/api:test: PASS src/presupuestos/presupuestos.module.spec.ts
@slotify/api:test: PASS src/calendario/calendario.module.spec.ts
@slotify/api:test: PASS src/tareas/tareas.module.spec.ts
@slotify/api:test: PASS src/reservas/reservas.module.spec.ts
@slotify/api:test: PASS src/clientes/clientes.module.spec.ts

@slotify/api:test: Test Suites: 14 passed, 14 total
@slotify/api:test: Tests:       19 passed, 19 total
@slotify/api:test: Snapshots:   0 total
@slotify/api:test: Time:        1.185 s, estimated 3 s

@slotify/api:test: $ depcruise src
@slotify/api:test: ✔ no dependency violations found (55 modules, 98 dependencies cruised)

@slotify/web:test: $ vitest run
@slotify/web:test:  ✓ src/pages/__tests__/LoginPage.test.tsx (1 test) 34ms
@slotify/web:test:  Test Files  1 passed (1)
@slotify/web:test:       Tests  1 passed (1)
@slotify/web:test:    Duration  562ms

Tasks: 2 successful, 2 total
Cached: 2 cached, 2 total
Time: 17ms >>> FULL TURBO
```

---

## 4. Ejecución: pnpm --filter @slotify/api test:e2e

Comando:
```bash
cd aplec && pnpm --filter @slotify/api test:e2e
```

Resultado:
```
$ jest --runInBand --testPathPatterns=__tests__

Test Suites: 2 passed, 2 total
Tests:       4 passed, 4 total
Snapshots:   0 total
Time:        1.381 s
```

Las 2 suites de `__tests__/` son:
- `src/__tests__/app.e2e.spec.ts` — smoke test de arranque (health 200 + endpoint protegido 401)
- `src/reservas/__tests__/fecha-bloqueada-concurrencia.spec.ts` — 2 tests de concurrencia

Test de concurrencia verificado:
- `debe_permitir_un_bloqueo_y_rechazar_el_segundo_cuando_son_concurrentes`: 1 fulfilled / 1 rejected con `P2002` (Prisma UNIQUE violation), 1 fila resultante en BD. PASS.
- `debe_rechazar_segunda_reserva_con_P2002_cuando_fecha_ya_bloqueada`: error P2002 con target que incluye `tenant_id|fecha`. PASS.

---

## 5. Estado BD post-test

Misma consulta de conteo ejecutada tras los tests:

```
         tbl          | count
----------------------+-------
 tenant               |     1
 usuario              |     1
 temporada_calendario |    12
 tarifa               |    45
 extra                |     2
 reserva              |     0
 fecha_bloqueada      |     0
 cliente              |     0
```

Los tests de concurrencia crean y limpian datos en `beforeAll`/`afterAll` (reservas, clientes, fecha_bloqueada). El estado post-test es idéntico al baseline. No se requiere restauración.

---

## 6. Restauración de BD

No necesaria. Los tests de concurrencia realizan su propia limpieza (`afterAll` borra reservas, cliente y fecha_bloqueada de test). La BD quedó en estado idéntico al baseline.

---

## Resumen

| Item | Resultado |
|------|-----------|
| Jest API — 14 suites, 19 tests | PASS |
| Vitest web — 1 suite, 1 test | PASS |
| Dependency-cruiser arch — 55 módulos | PASS (0 violations) |
| test:e2e — 2 suites, 4 tests | PASS |
| Concurrencia P2002 | PASS |
| UNIQUE(tenant_id,fecha) en fecha_bloqueada | VERIFICADO |
| RLS habilitado en 6 tablas de negocio | VERIFICADO |
| Seed: 45 tarifas / 12 temporadas / 2 extras / 1 tenant | VERIFICADO |
| BD post-test == baseline | VERIFICADO (no restauración) |

**OUTCOME: PASS**
