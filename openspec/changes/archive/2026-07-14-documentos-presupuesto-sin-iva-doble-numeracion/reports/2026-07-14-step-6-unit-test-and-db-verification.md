# QA Report — Fase 6: unit tests + verificación de BD

**Change:** `documentos-presupuesto-sin-iva-doble-numeracion` (épico #6, rebanada 6.2)
**Fecha:** 2026-07-14 · **Ejecutado por:** sesión principal (Postgres real: `slotify_dev` + `slotify_test`)

## 6.1 — Baseline de BD (pre-migración)
- `slotify_dev`: `presupuesto` total=1, con_numero=0; índice único viejo `presupuesto_tenant_id_numero_presupuesto_key`; sin columnas `metodo_pago`/`regimen_iva`.
- `slotify_test`: total=0; mismo índice viejo.

## 6.2 — Specs nuevos dirigidos (6.2) ✅
`NODE_OPTIONS=--experimental-vm-modules jest` sobre los 5 specs:
`regimen-desde-metodo-pago`, `desglose-fiscal-por-regimen`, `numeracion-presupuesto-por-regimen`,
`documento-presupuesto-sin-iva.plantilla`, `generar-presupuesto-regimen.use-case`
→ **5 suites, 48 tests PASSED**.

## 6.3 — Suite completa `apps/api` ✅ (con 1 flaky conocido, ajeno)
`jest --runInBand` (toda la suite): **1889 passed, 1 failed / 1890 total** (201 suites).
- Único fallo: `reservas/__tests__/alta-consulta-con-fecha-concurrencia.spec.ts` → **deadlock `40P01`**.
  Es el **flaky pre-existente documentado** (US-004), intermitente y **ajeno a la 6.2** (no toca
  presupuesto/régimen). Re-ejecutado en aislamiento 3 veces: passed / failed / passed → confirmado
  intermitente. Deuda técnica trackeada aparte, NO regresión de este change.
- Los dos specs de plantilla (CON IVA 6.1b + SIN IVA 6.2) pasan juntos en el run completo (el
  teardown ESM de react-pdf NO se manifestó bajo el aislamiento de módulos de Jest).

## 6.4 — Migración aplicada y verificada contra BD real ✅
`prisma migrate deploy` sobre **dev** y **test** → `20260714120000_presupuesto_metodo_pago_regimen_iva`
aplicada. Verificación post-migración (ambas BD):
- Columnas nuevas presentes: `metodo_pago`, `regimen_iva`.
- Índice único **reemplazado**: `presupuesto_tenant_id_numero_presupuesto_key` →
  **`presupuesto_tenant_id_regimen_iva_numero_presupuesto_key`** (Opción A).
- Backfill correcto: el presupuesto existente de dev → `regimen_iva = con_iva` (n=1).
- RLS de `presupuesto` NO recreada (sigue la policy por subconsulta a reserva de 6.1b).

### Verificación real-DB del eje régimen + doble numeración (test dirigido temporal)
Script de verificación (Nest `TestingModule` + `PresupuestosModule` real contra `slotify_test`,
`useCase.confirmar` real, luego borrado). Resultados:
- `metodoPago='efectivo'` → `regimen_iva=sin_iva`, `numero=2026001`, base 889.26, **IVA 0, total 889.26
  (= base, importe MENOR)** ✅
- `metodoPago='transferencia'` → `regimen_iva=con_iva`, `numero=2026001` (**mismo literal, secuencia
  independiente**), IVA 186.74, total 1076 (base+IVA) ✅
- 2ª `transferencia` → `con_iva` **2026002** (contador CON incrementa independiente del SIN) ✅
- **Coexistencia**: `(tenant, sin_iva, 2026001)` y `(tenant, con_iva, 2026001)` conviven → doble
  numeración + unicidad por régimen confirmadas ✅

## 6.5 — Estado posterior de BD (restaurado) ✅
- `slotify_dev`: total=1, con_numero=0 (baseline intacto; la reserva `26-0003` NO se modificó).
- `slotify_test`: total=0 (limpio; el test dirigido borra su propio rastro).
- Ficheros temporales de QA eliminados.

## Veredicto fase 6
**OK** — 5 specs nuevos verdes; suite completa verde salvo el flaky pre-existente de US-004 (ajeno,
intermitente); migración aditiva aplicada y verificada en dev+test; eje régimen + doble numeración
verificado contra BD real con el motor de tarifas real; BD restaurada.
