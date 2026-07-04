-- US-028 (D-4) — Reenvío de la factura de liquidación (E4) sin bloqueo de idempotencia.
--
-- El índice UNIQUE PARCIAL `uq_comunicacion_reserva_codigo (reserva_id, codigo_email)
-- WHERE reserva_id IS NOT NULL` de US-045 impide insertar una segunda COMUNICACION con
-- código E4 para la misma reserva. El reenvío manual del Gestor (D-4) es una EXCEPCIÓN
-- explícita y auditada a esa idempotencia: cada reenvío DEBE dejar su propia traza.
--
-- Solución: se añade la columna `es_reenvio` (default false) y se relaja el índice parcial
-- para excluir las filas de reenvío (`es_reenvio = false`). Así la idempotencia sigue
-- garantizando UN solo E4 "original" por reserva, pero admite N reenvíos posteriores.
--
-- Prisma no modela el predicado WHERE de índices parciales: se recrea por SQL crudo
-- (patrón US-040 / US-045). Migración NO destructiva.

-- 1) Nueva columna `es_reenvio` (default false para las filas existentes).
ALTER TABLE "comunicacion"
  ADD COLUMN "es_reenvio" BOOLEAN NOT NULL DEFAULT false;

-- 2) Relaja el índice parcial de idempotencia para excluir los reenvíos.
DROP INDEX IF EXISTS "uq_comunicacion_reserva_codigo";

CREATE UNIQUE INDEX "uq_comunicacion_reserva_codigo"
  ON "comunicacion" ("reserva_id", "codigo_email")
  WHERE "reserva_id" IS NOT NULL AND "es_reenvio" = false;
