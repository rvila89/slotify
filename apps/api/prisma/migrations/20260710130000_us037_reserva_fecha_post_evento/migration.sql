-- US-037 (D-2 = Opción A, aprobada en el gate SDD 2026-07-10): fuente de verdad del reloj T+7d
-- del archivado automático (post_evento -> reserva_completada).
--
-- Migración ADITIVA (no destructiva): columna nullable, sin default. Se puebla en caliente en la
-- transición evento_en_curso -> post_evento (US-034, misma transacción que fija estado). El
-- residual pre-migración (RESERVA ya en post_evento con fecha_post_evento = NULL) se backfillea
-- de forma IDEMPOTENTE desde AUDIT_LOG (la entrada de transición cuyo datos_nuevos.estado =
-- 'post_evento').
--
-- Se ejecuta a nivel de esquema (fuera del RLS de request): el backfill actualiza TODAS las filas
-- que cumplan la condición, CROSS-TENANT, con independencia de app.tenant_id. Es correcto y
-- deliberado (derivación de datos histórica, no acceso de request de un tenant).

-- 1) Columna nullable (aditiva).
ALTER TABLE "reserva" ADD COLUMN "fecha_post_evento" TIMESTAMP(3);

-- 2) Índice de apoyo al filtro de candidatas del barrido (estado + fecha_post_evento).
CREATE INDEX "reserva_estado_fecha_post_evento_idx" ON "reserva"("estado", "fecha_post_evento");

-- 3) BACKFILL del residual (idempotente): deriva el instante de entrada a post_evento desde la
--    entrada de AUDIT_LOG de la transición (accion='transicion', entidad='RESERVA',
--    datos_nuevos->>'estado' = 'post_evento'). Si hubiera varias, se toma la MÁS RECIENTE.
--    Trabaja con timestamps reales (fecha_creacion del log), NUNCA con strings formateados
--    (blindaje del off-by-one de TZ conocido). Solo toca estado='post_evento' AND
--    fecha_post_evento IS NULL -> re-ejecutable sin efectos duplicados.
UPDATE "reserva" r
SET "fecha_post_evento" = sub."fecha_transicion"
FROM (
  SELECT DISTINCT ON (a."entidad_id")
    a."entidad_id" AS reserva_id,
    a."fecha_creacion" AS fecha_transicion
  FROM "audit_log" a
  WHERE a."accion" = 'transicion'
    AND a."entidad" = 'RESERVA'
    AND a."datos_nuevos" ->> 'estado' = 'post_evento'
  ORDER BY a."entidad_id", a."fecha_creacion" DESC
) sub
WHERE r."id_reserva" = sub.reserva_id
  AND r."estado" = 'post_evento'
  AND r."fecha_post_evento" IS NULL;

-- Nota operativa: las RESERVA en post_evento SIN entrada de AUDIT_LOG de la transición (residual
-- muy improbable — toda transición se audita desde US-034) quedan con fecha_post_evento = NULL y
-- el barrido las ignora (no candidatas hasta que se re-transicione o se corrija manualmente). No
-- se usa fallback a fecha_actualizacion (frágil por @updatedAt, descartado en el gate: Opción C).
