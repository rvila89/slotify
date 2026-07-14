# QA Report — Fase 4: unit tests + verificación de BD

**Change:** `documentos-sin-iva-omite-pie-bancario` (fix apilado sobre 6.2)
**Fecha:** 2026-07-14 · **Ejecutado por:** sesión principal

## Naturaleza del cambio
Fix de **presentación pura** (render backend): no toca BD, contrato, dominio de `presupuestos`
ni frontend. Por tanto no hay baseline/mutación de BD que verificar (4.1/4.4 N/A — sin cambios de
esquema ni de datos).

## 4.2/4.3 — Tests dirigidos (aislados, `NODE_OPTIONS=--experimental-vm-modules`)
- `documento-presupuesto-pie-bancario.plantilla.spec.ts` (nuevo): **8/8 passed**
- `documento-presupuesto-sin-iva.plantilla.spec.ts` (6.2, ajustado): **11/11 passed**
- `documento-presupuesto.plantilla.spec.ts` (6.1b CON IVA, no-regresión): **16/16 passed**
- `tsc --noEmit`: **sin errores**

(Se ejecutan aislados por la limitación conocida jest+react-pdf ESM en multi-suite; en la suite
completa Jest los aísla igualmente.)

## 4.4 — BD
Sin cambios: el fix no persiste ni lee nada nuevo. `slotify_dev`/`slotify_test` intactas.

## Veredicto fase 4
**OK** — specs nuevos y de no-regresión en verde; typecheck limpio; sin impacto en BD.
