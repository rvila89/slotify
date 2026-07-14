# QA Report — Fase 4: unit tests + verificación de BD

**Change:** `documentos-presupuesto-pdf-con-iva` (épico #6, rebanada 6.1b)
**Fecha:** 2026-07-13 · **Ejecutado por:** sesión principal (Postgres real)

## Migración
- `20260713150000_presupuesto_numero_tenant` aplicada con `prisma migrate deploy` a **`slotify_test`** y **`slotify_dev`**.
- **Corrección durante QA:** la migración original incluía `ENABLE ROW LEVEL SECURITY` + `CREATE POLICY tenant_isolation` sobre `presupuesto`, pero esa tabla **YA tenía RLS + policy `tenant_isolation`** desde el `init` (aísla por **subconsulta a `reserva`**, porque no tenía `tenant_id` directo). Recrearla colisionaba (`42710`). Se editó la migración para **NO recrear** la policy (la existente por join sigue aislando); las columnas nuevas + backfill + unique index se mantienen. La nueva `tenant_id` sirve para la unicidad de la numeración.
- Verificado en `slotify_test`: columnas `tenant_id` + `numero_presupuesto` presentes; índice único `presupuesto_tenant_id_numero_presupuesto_key`.

## Tests
```
NODE_OPTIONS=--experimental-vm-modules jest --runInBand documentos presupuestos activar-prereserva
Test Suites: 14 passed, 14 total
Tests:       112 passed, 112 total
```
- Incluye las 2 suites con BD real (`activar-prereserva-integracion`, `activar-prereserva-concurrencia`) que estaban rojas hasta aplicar la migración (dependían de `presupuesto.tenant_id`).
- Incluye el render de la plantilla (16/16) y el adaptador real (dobles).
- **Nota toolchain:** react-pdf es ESM puro; los tests requieren `NODE_OPTIONS=--experimental-vm-modules` (lo inyecta el script `test` vía cross-env). Ejecutar `npx jest` sin el flag falla los 2 tests de render (falso negativo de invocación, no bug).
- Flaky conocida US-004 (40P01) ajena al change.

## Veredicto fase 4
**OK** — 112 tests verde incluida integración con BD real; migración aplicada y esquema verificado (columnas + unicidad); RLS preexistente por join respetada.
