-- US-029 (D-1): tenant_id explícito en PAGO (regla dura multi-tenancy/RLS del proyecto).
-- Migración ADITIVA: no destruye datos. Backfill defensivo desde FACTURA.tenant_id para
-- filas preexistentes (en la práctica la tabla está vacía: US-029 crea el primer PAGO).

-- 1) Columna nullable temporal.
ALTER TABLE "pago" ADD COLUMN "tenant_id" TEXT;

-- 2) Backfill del tenant desde la factura padre (derivación ER previa).
UPDATE "pago" p
SET "tenant_id" = f."tenant_id"
FROM "factura" f
WHERE f."id_factura" = p."factura_id"
  AND p."tenant_id" IS NULL;

-- 3) NOT NULL una vez backfilleado.
ALTER TABLE "pago" ALTER COLUMN "tenant_id" SET NOT NULL;

-- 4) FK a TENANT + índices (tenant_id y factura_id; SIN UNIQUE sobre factura_id: cobros
--    parciales futuros — la unicidad de cobro del MVP la da la guarda de estado bajo FOR UPDATE).
ALTER TABLE "pago"
  ADD CONSTRAINT "pago_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id_tenant") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE INDEX "pago_tenant_id_idx" ON "pago"("tenant_id");
CREATE INDEX "pago_factura_id_idx" ON "pago"("factura_id");

-- 5) RLS: la política pasa a filtrar por el tenant_id DIRECTO de PAGO (antes se derivaba por
--    join a FACTURA). Coherente con el resto de tablas de negocio (SET LOCAL app.tenant_id).
DROP POLICY IF EXISTS tenant_isolation ON "pago";
CREATE POLICY tenant_isolation ON "pago"
  USING (tenant_id = current_setting('app.tenant_id', true));
