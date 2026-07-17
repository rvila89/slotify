-- US-042 (D-2) — Índices GIN FUNCIONALES para la búsqueda full-text del histórico
-- (`GET /historico`). Es la ÚNICA mutación de esquema del change: dos índices de
-- RENDIMIENTO (no columnas nuevas), aditivos y no destructivos.
--
-- La búsqueda `q` del adaptador `ListarHistoricoPrismaAdapter` evalúa dos documentos
-- `to_tsvector('spanish', ...)` PARAMETRIZADOS con `plainto_tsquery`, uno por tabla:
--   - RESERVA: codigo + notas
--   - CLIENTE: nombre + apellidos + email (el email pasa por `translate('@._-' -> espacios)`
--     porque el parser FTS trata un email completo como UN solo token `email`; sin trocearlo,
--     buscar un fragmento del email — p. ej. "zafiro" en "contacto.zafiro-…@…" — nunca casaría).
-- (un índice GIN funcional solo referencia columnas de UNA tabla; por eso se parte en dos
-- y el adaptador las combina con OR). Las expresiones de estos índices deben ser
-- IDÉNTICAS a las del WHERE para que el planificador las use en históricos grandes.
--
-- El aislamiento por `tenant_id` sigue precediendo al match full-text en el plan (filtro
-- explícito en el WHERE + RLS). Estos índices solo aceleran el `@@`, no cambian semántica.

CREATE INDEX IF NOT EXISTS "idx_reserva_fts_historico"
  ON "reserva"
  USING GIN (
    to_tsvector('spanish',
      coalesce("codigo", '') || ' ' || coalesce("notas", '')
    )
  );

CREATE INDEX IF NOT EXISTS "idx_cliente_fts_historico"
  ON "cliente"
  USING GIN (
    to_tsvector('spanish',
      coalesce("nombre", '') || ' ' || coalesce("apellidos", '') || ' ' ||
      translate(coalesce("email", ''), '@._-', '    ')
    )
  );
