-- change `reserva-viva-edicion-recalculo-ficha` (§D-5/§D-6): migración ADITIVA.
-- 1) Columna `origen` en PRESUPUESTO (nullable): NULL para versiones normales,
--    'modificacion' para la versión creada por el recálculo en la ventana viva.
ALTER TABLE "presupuesto" ADD COLUMN "origen" TEXT;

-- 2) Nuevo código de email E9 (modificación de reserva) en el enum CodigoEmail.
ALTER TYPE "CodigoEmail" ADD VALUE IF NOT EXISTS 'E9';
