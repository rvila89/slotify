-- historial-completo-comunicaciones (§D-subtipo, §D-indice-terna) — HISTORIAL COMPLETO
-- de las comunicaciones E1 por evento del ciclo de vida.
--
-- Un mismo `codigo_email = 'E1'` agrupa emails SEMÁNTICAMENTE DISTINTOS (respuesta a
-- consulta exploratoria, asignación de fecha, confirmación de fecha, cola, cambio de
-- fecha). Se persiste un `subtipo` explícito (nullable) y se INSERTA una fila por
-- evento, en lugar del upsert previo que sobrescribía la única E1 de la reserva.
--
-- Prisma no modela ni el predicado WHERE de índices parciales ni `NULLS NOT DISTINCT`;
-- el enum + la columna van por Prisma pero el índice se recrea por SQL crudo (patrón
-- US-040 / US-045 / US-046).

-- 1. Enum del subtipo semántico del E1.
CREATE TYPE "SubtipoEmail" AS ENUM (
  'consulta_exploratoria',
  'fecha_disponible',
  'fecha_confirmada',
  'cola_espera',
  'cambio_fecha'
);

-- 2. Columna `subtipo` NULLABLE (NULL para E2–E8, `manual` y filas legadas → sin backfill).
ALTER TABLE "comunicacion" ADD COLUMN "subtipo" "SubtipoEmail";

-- 3. Reclavar el índice UNIQUE parcial sobre la TERNA `(reserva_id, codigo_email,
--    subtipo)`, restringido a envíos consumados (`estado = 'enviado'`).
DROP INDEX IF EXISTS "uq_comunicacion_reserva_codigo";

-- CRÍTICO — `NULLS NOT DISTINCT` (Postgres 15). Sin él, las filas E2–E8 (subtipo = NULL)
-- se tratarían como DISTINTAS entre sí y DOS envíos E2 de la misma `(reserva, codigo)`
-- podrían coexistir en `enviado`, rompiendo su idempotencia. Con `NULLS NOT DISTINCT`,
-- dos filas `enviado` de la misma `(reserva, codigo, NULL)` SIGUEN colisionando
-- (idempotencia E2–E8 preservada), mientras que los E1 con subtipos NO nulos distintos
-- coexisten en `enviado` (emails legítimos distintos, NO reenvíos). El predicado
-- `estado = 'enviado'` deja fuera los `borrador` (historial ilimitado por evento).
CREATE UNIQUE INDEX "uq_comunicacion_reserva_codigo"
  ON "comunicacion" ("reserva_id", "codigo_email", "subtipo")
  NULLS NOT DISTINCT
  WHERE "reserva_id" IS NOT NULL
    AND "es_reenvio" = false
    AND "codigo_email" <> 'manual'
    AND "estado" = 'enviado';
