-- US-027 (§D-7 ajustado en implementación): los borradores de liquidación y fianza se crean
-- con `numero_factura = NULL` (la numeración fiscal F-YYYY-NNNN se asigna al EMITIR, US-028).
-- Se relaja la columna a NULLABLE. El `UNIQUE(tenant_id, numero_factura)` de US-022 se conserva:
-- en PostgreSQL los NULL no colisionan entre sí, por lo que varios borradores sin número
-- conviven sin violar la unicidad. Cambio ADITIVO/no destructivo sobre la tabla FACTURA.

ALTER TABLE "factura" ALTER COLUMN "numero_factura" DROP NOT NULL;
