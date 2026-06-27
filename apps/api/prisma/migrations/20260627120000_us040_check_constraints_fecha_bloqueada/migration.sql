-- US-040 / UC-30 — Invariantes de coherencia tipo↔TTL en `fecha_bloqueada` (design.md D-3).
--
-- Defensa en profundidad: además de la validación de dominio en `bloquearFecha()`,
-- el motor impone la *forma* (nulo / no nulo) del TTL según el tipo de bloqueo.
-- El predicado temporal `ttl > now()` NO se modela como CHECK (un CHECK con now()
-- se reevalúa de forma problemática); se valida en dominio antes de escribir.
--
-- Migración NO destructiva: el `UNIQUE(tenant_id, fecha)` y la RLS ya existen
-- desde la migración 0 (US-000). Aquí solo se añaden los check constraints.

-- tipo='firme'  ⟹ ttl_expiracion IS NULL
ALTER TABLE "fecha_bloqueada"
  ADD CONSTRAINT "chk_firme_sin_ttl"
    CHECK ("tipo_bloqueo" <> 'firme' OR "ttl_expiracion" IS NULL);

-- tipo='blando' ⟹ ttl_expiracion IS NOT NULL
ALTER TABLE "fecha_bloqueada"
  ADD CONSTRAINT "chk_blando_con_ttl"
    CHECK ("tipo_bloqueo" <> 'blando' OR "ttl_expiracion" IS NOT NULL);
