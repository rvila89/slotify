# QA Report — Fase 4: unit tests + verificación de BD e integración SQL real

**Change:** `documentos-config-tenant-storage` (épico #6, rebanada 6.1a)
**Fecha:** 2026-07-13
**Ejecutado por:** sesión principal (Postgres real; los subagentes QA no tienen BD — memoria `subagentes-sin-docker-postgres`)

## Entorno
- Postgres `slotify-postgres` (postgres:15), healthy.
- Migración `20260713140000_documento_config_tenant` aplicada con `prisma migrate deploy` a **`slotify_test`** (para integración) y **`slotify_dev`** (para seed).
- Nota Prisma: `prisma generate` no pudo reemplazar el binario del engine (EPERM: dev server en watch lo bloquea), pero es irrelevante — los tipos del client ya estaban regenerados y el engine es agnóstico al schema.

## 4.2 / 4.3 Tests dirigidos + suite del módulo
```
npx jest --runInBand documentos
Test Suites: 5 passed, 5 total
Tests:       21 passed, 21 total
```
Suites: contrato del puerto (domain), adaptador local (infra), servicio de lectura (application), factory del seed piloto (infra), **integración SQL real** (infra).
- Flaky conocida ajena al change: `alta-consulta-con-fecha-concurrencia.spec.ts` (deadlock 40P01, US-004) puede teñir la suite global; no relacionada.

## 4.4 Migración + RLS contra Postgres real (integración SQL, `slotify_test`)
Test `configuracion-documento-integracion.spec.ts` — **6/6 verde**:
- Tabla `plantilla_documento_tenant` existe con `UNIQUE(tenant_id)` y FK a `tenant`.
- RLS habilitada (`relrowsecurity = true`) + policy `tenant_isolation` con `current_setting('app.tenant_id')`.
- `UNIQUE(tenant_id)` impone la relación 1-1 (segunda fila del mismo tenant rechazada).
- Aislamiento a nivel de aplicación: el servicio devuelve a cada tenant SOLO su config.
- El adaptador mapea el VO (4 bloques); razón social fiscal ("Canoliart, SL") ≠ nombre comercial ("Masia l'Encís"); concepto con "espai", sin "lloguer".

### Hallazgo relevante (defensa en profundidad RLS)
En **dev/test la app conecta como OWNER** de las tablas y, como **ninguna tabla del proyecto usa `FORCE ROW LEVEL SECURITY`**, Postgres **bypasea la policy para el owner**: un `findMany()` sin filtro bajo `fijarTenant()` devuelve filas de todos los tenants. Esto NO es un bug de 6.1a — es una propiedad **preexistente de todo el schema** (init incluido). El aislamiento efectivo se logra a **nivel de aplicación** (los adaptadores consultan por `tenantId`); la RLS+policy es la defensa que aplica en **producción con un rol NO-owner**. La migración de 6.1a calca exactamente el patrón del `init`. El test verifica el aislamiento como lo garantiza el código (vía servicio/adaptador) + la existencia de RLS+policy.

## 4.5 Seed + idempotencia (`slotify_dev`)
`pnpm db:seed` ejecutado **dos veces**. Verificación SQL posterior:
- `count(plantilla_documento_tenant) = 1` (una sola fila tras dos seeds → **idempotente**).
- Valores reales: `razon_social_fiscal='Canoliart, SL'`, `nombre_comercial="Masia l'Encís"`, `nif='B10874287'`, `iban='ES30 0182 1683 4002 0172 9599'`, `validesa='10 DIES'`.
- `plantilla_concepto_fiscal` contiene "espai" = **true**, contiene "lloguer" = **false**.

## 4.6 Estado posterior de BD
- `slotify_dev` queda con el seed canónico (incluye la nueva config del piloto) — estado limpio y coherente.
- `slotify_test` queda sin filas de config (el test limpia en `afterAll`).

## Veredicto fase 4
**OK** — 21 tests verde incluida integración SQL real; migración + RLS + UNIQUE + FK verificados; seed idempotente con datos reales; concepto "espai" nunca "lloguer".
