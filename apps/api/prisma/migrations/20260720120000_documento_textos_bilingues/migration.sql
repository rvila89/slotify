-- Change `pdf-presupuesto-horario-idioma` (Mejora 3): textos libres del tenant bilingües
-- es/ca en `plantilla_documento_tenant`. Migración NO destructiva pero de esquema limpio
-- (design.md §D3, resuelto en el gate): ADD columnas `_ca`/`_es` nullable -> backfill
-- `_ca` = columna monolingüe actual, `_es` = `_ca` como placeholder (el reseed del piloto
-- fija la traducción `es` real) -> `condiciones` JSON a estructura bilingüe -> ALTER
-- `_ca`/`_es` NOT NULL -> DROP de las columnas monolingües antiguas.
-- La tabla es config 1-1 por tenant y sembrada: riesgo bajo. RLS: la policy 1-1 por tenant
-- YA existe y las columnas nuevas la heredan; NO se recrea.

-- 1) Columnas de texto bilingües (nullable en el paso intermedio).
ALTER TABLE "plantilla_documento_tenant"
  ADD COLUMN "plantilla_concepto_fiscal_ca" TEXT,
  ADD COLUMN "plantilla_concepto_fiscal_es" TEXT,
  ADD COLUMN "validesa_texto_ca" TEXT,
  ADD COLUMN "validesa_texto_es" TEXT,
  ADD COLUMN "pie_legal_ca" TEXT,
  ADD COLUMN "pie_legal_es" TEXT;

-- 2) Backfill: `_ca` = valor catalán actual; `_es` = `_ca` (placeholder; reseed pone es).
UPDATE "plantilla_documento_tenant"
SET
  "plantilla_concepto_fiscal_ca" = "plantilla_concepto_fiscal",
  "plantilla_concepto_fiscal_es" = "plantilla_concepto_fiscal",
  "validesa_texto_ca" = "validesa_texto",
  "validesa_texto_es" = "validesa_texto",
  "pie_legal_ca" = "pie_legal",
  "pie_legal_es" = "pie_legal";

-- 3) `condiciones` JSON: strings -> { "ca": <str>, "es": <str> } (titulo del bloque y
--    titulo/cuerpo de cada seccion). El backfill mueve el catalán actual a `ca` y `es`;
--    el reseed del piloto fija el `es` definitivo. Filas con `condiciones = '{}'` quedan
--    intactas (jsonb_build_object solo actúa si las claves existen).
UPDATE "plantilla_documento_tenant"
SET "condiciones" = jsonb_build_object(
  'titulo',
  jsonb_build_object(
    'ca', "condiciones"->>'titulo',
    'es', "condiciones"->>'titulo'
  ),
  'secciones',
  COALESCE(
    (
      SELECT jsonb_agg(
        jsonb_build_object(
          'titulo', jsonb_build_object('ca', s->>'titulo', 'es', s->>'titulo'),
          'cuerpo', jsonb_build_object('ca', s->>'cuerpo', 'es', s->>'cuerpo')
        )
      )
      FROM jsonb_array_elements("condiciones"->'secciones') AS s
    ),
    '[]'::jsonb
  )
)
WHERE "condiciones" ? 'titulo';

-- 4) Fijar NOT NULL una vez backfilled.
ALTER TABLE "plantilla_documento_tenant"
  ALTER COLUMN "plantilla_concepto_fiscal_ca" SET NOT NULL,
  ALTER COLUMN "plantilla_concepto_fiscal_es" SET NOT NULL,
  ALTER COLUMN "validesa_texto_ca" SET NOT NULL,
  ALTER COLUMN "validesa_texto_es" SET NOT NULL,
  ALTER COLUMN "pie_legal_ca" SET NOT NULL,
  ALTER COLUMN "pie_legal_es" SET NOT NULL;

-- 5) DROP de las columnas monolingües antiguas (esquema limpio; gate §D3).
ALTER TABLE "plantilla_documento_tenant"
  DROP COLUMN "plantilla_concepto_fiscal",
  DROP COLUMN "validesa_texto",
  DROP COLUMN "pie_legal";
