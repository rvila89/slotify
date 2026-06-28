-- US-045 / UC-35 — Idempotencia de un email por reserva y código (design.md §4).
--
-- Garantiza UNA sola COMUNICACION por (reserva_id, codigo_email): un segundo
-- disparo del mismo trigger (o una carrera de doble inserción) viola el índice y el
-- motor lo trata como "ya existe" sin reenviar (P2002 → ComunicacionDuplicadaError).
--
-- Es un índice UNIQUE PARCIAL porque `reserva_id` es NULLABLE (emails `manual`
-- desvinculados de reserva, US-046): esos quedan EXCLUIDOS del constraint y no
-- colisionan entre sí. `reserva_id` es UUID global, así que (reserva_id, codigo_email)
-- basta; la RLS ya aísla las lecturas por tenant (no se incluye tenant_id).
--
-- Prisma no modela el predicado `WHERE` de un índice parcial; se crea como SQL crudo
-- (patrón US-040). Migración NO destructiva: solo añade el índice.

CREATE UNIQUE INDEX "uq_comunicacion_reserva_codigo"
  ON "comunicacion" ("reserva_id", "codigo_email")
  WHERE "reserva_id" IS NOT NULL;
