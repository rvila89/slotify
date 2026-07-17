-- AlterTable: personalización de E1 (idioma de comunicación + horario del evento).
ALTER TABLE "reserva" ADD COLUMN "idioma" TEXT NOT NULL DEFAULT 'es';
ALTER TABLE "reserva" ADD COLUMN "horario" TEXT;
