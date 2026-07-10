-- US-036 (Gate 1 · G1-1): campo dedicado para el motivo de retención de la fianza.
-- Migración ADITIVA (no destructiva): columna nullable, sin default, sin backfill.
-- Se persiste solo cuando la devolución es parcial (fianza_status = 'retenida_parcial').
ALTER TABLE "reserva" ADD COLUMN "motivo_retencion" TEXT;
