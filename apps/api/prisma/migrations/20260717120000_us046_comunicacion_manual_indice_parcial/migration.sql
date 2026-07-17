-- US-046 (D-5 Opción C) — El email `manual` del Gestor queda FUERA del índice UNIQUE
-- parcial de idempotencia, pero con `reserva_id` NO nulo y `es_reenvio = false`
-- (semántica HONESTA: un manual no es un reenvío).
--
-- El índice de US-045/US-028 `uq_comunicacion_reserva_codigo (reserva_id, codigo_email)
-- WHERE reserva_id IS NOT NULL AND es_reenvio = false` impediría insertar un segundo
-- email `manual` para la misma reserva (colisión P2002), porque el manual ahora lleva
-- `reserva_id` no nulo (se crea desde la ficha de la RESERVA) y `es_reenvio = false`.
--
-- Solución (NO destructiva, ADITIVA): se recrea el índice añadiendo al predicado la
-- exclusión `AND codigo_email <> 'manual'`, de modo que los `manual` quedan fuera del
-- constraint (caben varios por reserva) SIN tener que mentir con `es_reenvio = true`.
-- La idempotencia de E1–E8 se conserva intacta (un segundo E-código no-reenvío sigue
-- colisionando). Prisma no modela el predicado WHERE de índices parciales: se recrea por
-- SQL crudo (patrón US-040 / US-045 / US-028).

DROP INDEX IF EXISTS "uq_comunicacion_reserva_codigo";

CREATE UNIQUE INDEX "uq_comunicacion_reserva_codigo"
  ON "comunicacion" ("reserva_id", "codigo_email")
  WHERE "reserva_id" IS NOT NULL AND "es_reenvio" = false AND "codigo_email" <> 'manual';
