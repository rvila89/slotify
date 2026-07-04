-- US-022 (§D-7): numeración fiscal secuencial por tenant + idempotencia de la factura por
-- (reserva, tipo). Cambios ADITIVOS sobre la tabla FACTURA existente.

-- 1) Sustituir el UNIQUE global de numero_factura por UNIQUE(tenant_id, numero_factura):
--    el año va embebido en el literal F-YYYY-NNNN, así "único por tenant + año" queda
--    cubierto y dos tenants distintos pueden tener F-2026-0001.
DROP INDEX "factura_numero_factura_key";
CREATE UNIQUE INDEX "factura_tenant_id_numero_factura_key" ON "factura"("tenant_id", "numero_factura");

-- 2) Idempotencia: una única factura por (reserva, tipo) — red de seguridad ante disparos
--    concurrentes del trigger post-commit de la confirmación (US-021).
CREATE UNIQUE INDEX "factura_reserva_id_tipo_key" ON "factura"("reserva_id", "tipo");
