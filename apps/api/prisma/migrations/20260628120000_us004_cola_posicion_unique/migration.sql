-- US-004 / UC-03 — Unicidad de la posición de cola del sub-estado 2.d (design.md §D-8).
--
-- Defensa en profundidad APROBADA en el Gate 1 (decisión B). La atomicidad PRINCIPAL
-- de la asignación de `posicion_cola` la da la serialización por `SELECT … FOR UPDATE`
-- sobre la fila bloqueante de `fecha_bloqueada` (design.md §D-5). Este índice es la
-- red de seguridad: si por cualquier vía dos altas 2.d obtuvieran la misma posición,
-- el motor las rechaza con `P2002` y la unidad de trabajo reintenta re-derivando.
--
-- Migración ADITIVA y de bajo riesgo: índice UNIQUE PARCIAL que solo afecta a las
-- filas en cola (`posicion_cola IS NOT NULL`); las consultas 2.a/2.b (posición NULL)
-- no se ven afectadas. No es expresable en `schema.prisma` (Prisma no soporta índices
-- parciales), por lo que se gestiona como SQL crudo versionado.

CREATE UNIQUE INDEX "reserva_cola_posicion_key"
  ON "reserva" ("tenant_id", "consulta_bloqueante_id", "posicion_cola")
  WHERE "posicion_cola" IS NOT NULL;
