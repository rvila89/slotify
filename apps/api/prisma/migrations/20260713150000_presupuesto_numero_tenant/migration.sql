-- Épico #6, rebanada 6.1b (documentos-presupuesto-pdf-con-iva): numeración del presupuesto
-- CON IVA por tenant y año + aislamiento multi-tenant.
--
-- N2: se añaden a PRESUPUESTO las columnas `tenant_id` (nullable, backfill desde la reserva)
-- y `numero_presupuesto` (nullable; formato `AAAANNN` = año + contador de 3 dígitos, reinicio
-- anual, con el año embebido en el literal). Unicidad `(tenant_id, numero_presupuesto)`: en
-- PostgreSQL los NULL no colisionan, así que los presupuestos sin número (aún no confirmados)
-- conviven. Cambio ADITIVO/no destructivo.
--
-- NOTA RLS: `presupuesto` YA tiene Row-Level Security habilitada con la policy
-- `tenant_isolation` del `init`, que aísla por SUBCONSULTA a `reserva`
-- (`EXISTS (SELECT 1 FROM reserva r WHERE r.id_reserva = presupuesto.reserva_id
--  AND r.tenant_id = current_setting('app.tenant_id'))`), porque la tabla no tenía
-- `tenant_id` directo. Esa policy sigue siendo el mecanismo de aislamiento y NO se
-- recrea aquí (hacerlo colisiona). La nueva columna `tenant_id` sirve para la unicidad
-- de la numeración por tenant; el use-case la persiste = `reserva.tenant_id`.

-- 1) Columnas nuevas (nullable).
ALTER TABLE "presupuesto" ADD COLUMN "tenant_id" TEXT;
ALTER TABLE "presupuesto" ADD COLUMN "numero_presupuesto" TEXT;

-- 2) Backfill de tenant_id desde la reserva (multi-tenancy: el presupuesto hereda el tenant
--    de su reserva).
UPDATE "presupuesto" AS p
SET "tenant_id" = r."tenant_id"
FROM "reserva" AS r
WHERE p."reserva_id" = r."id_reserva";

-- 3) FK a Tenant (coherente con la relación del schema; ON DELETE RESTRICT como el resto).
ALTER TABLE "presupuesto"
  ADD CONSTRAINT "presupuesto_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id_tenant")
  ON DELETE RESTRICT ON UPDATE CASCADE;

-- 4) Unicidad de la numeración por tenant (los NULL no colisionan en PostgreSQL).
CREATE UNIQUE INDEX "presupuesto_tenant_id_numero_presupuesto_key"
  ON "presupuesto"("tenant_id", "numero_presupuesto");

-- (RLS ya habilitada en `presupuesto` desde el init con la policy `tenant_isolation`
--  por subconsulta a `reserva`; no se recrea aquí — ver NOTA RLS de la cabecera.)
