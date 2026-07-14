-- Épico #6, rebanada 6.2 (documentos-presupuesto-sin-iva-doble-numeracion): método de pago
-- + régimen fiscal del presupuesto y DOBLE NUMERACIÓN por régimen (design.md D1/D2).
--
-- D1: se añaden a PRESUPUESTO las columnas `metodo_pago` (enum MetodoPago) y `regimen_iva`
-- (enum RegimenIva), ambas NULLABLE (migración ADITIVA / no destructiva). Backfill de las
-- filas de 6.1b (todas CON IVA por transferencia) a `metodo_pago = 'transferencia'` /
-- `regimen_iva = 'con_iva'`. La aplicación siempre escribe ambos en la creación (nunca null
-- en filas nuevas).
--
-- D2 (Opción A): la unicidad de la numeración pasa de `(tenant_id, numero_presupuesto)`
-- (6.1b) a `(tenant_id, regimen_iva, numero_presupuesto)`, de modo que las secuencias CON y
-- SIN sean independientes y puedan compartir el mismo literal `AAAANNN` (`2026001` en CON y
-- en SIN sin colisionar). El reintento `P2002` del use-case se ancla al nuevo índice
-- `presupuesto_tenant_id_regimen_iva_numero_presupuesto_key`.
--
-- NOTA RLS: `presupuesto` YA tiene Row-Level Security con la policy `tenant_isolation` del
-- init, que aísla por SUBCONSULTA a `reserva`. Esa policy sigue siendo el mecanismo de
-- aislamiento y NO se recrea aquí (recrearla colisiona — igual criterio que en 6.1b). Las
-- columnas nuevas quedan cubiertas por la policy existente.

-- 1) Tipos enum nativos (idempotentes ante re-ejecución defensiva).
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'MetodoPago') THEN
    CREATE TYPE "MetodoPago" AS ENUM ('transferencia', 'efectivo');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'RegimenIva') THEN
    CREATE TYPE "RegimenIva" AS ENUM ('con_iva', 'sin_iva');
  END IF;
END
$$;

-- 2) Columnas nuevas (nullable; migración aditiva).
ALTER TABLE "presupuesto" ADD COLUMN "metodo_pago" "MetodoPago";
ALTER TABLE "presupuesto" ADD COLUMN "regimen_iva" "RegimenIva";

-- 3) Backfill: las filas de 6.1b eran todas CON IVA por transferencia.
UPDATE "presupuesto"
SET "metodo_pago" = 'transferencia', "regimen_iva" = 'con_iva'
WHERE "metodo_pago" IS NULL OR "regimen_iva" IS NULL;

-- 4) Unicidad de la doble numeración (Opción A): sustituye la de 6.1b. En PostgreSQL los
--    NULL no colisionan, así que los presupuestos sin número (aún no confirmados) conviven,
--    y CON/SIN pueden compartir literal `AAAANNN` al diferenciarse por `regimen_iva`.
DROP INDEX IF EXISTS "presupuesto_tenant_id_numero_presupuesto_key";
CREATE UNIQUE INDEX "presupuesto_tenant_id_regimen_iva_numero_presupuesto_key"
  ON "presupuesto"("tenant_id", "regimen_iva", "numero_presupuesto");

-- (RLS ya habilitada en `presupuesto` desde el init con la policy `tenant_isolation` por
--  subconsulta a `reserva`; no se recrea aquí — ver NOTA RLS de la cabecera.)
