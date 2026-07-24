-- fix-liquidacion-fianza-independientes
-- Desacople liquidación/fianza + simplificación de la fianza y su devolución.

-- AlterEnum: nuevos valores (comprobante de fianza + email E10 de fianza devuelta)
ALTER TYPE "TipoDocumento" ADD VALUE 'comprobante_fianza';
ALTER TYPE "CodigoEmail" ADD VALUE 'E10';

-- AlterEnum: FianzaStatus sin `recibo_enviado` ni `retenida_parcial`
CREATE TYPE "FianzaStatus_new" AS ENUM ('pendiente', 'cobrada', 'devuelta');
ALTER TABLE "reserva" ALTER COLUMN "fianza_status" DROP DEFAULT;
ALTER TABLE "reserva" ALTER COLUMN "fianza_status" TYPE "FianzaStatus_new" USING ("fianza_status"::text::"FianzaStatus_new");
ALTER TYPE "FianzaStatus" RENAME TO "FianzaStatus_old";
ALTER TYPE "FianzaStatus_new" RENAME TO "FianzaStatus";
DROP TYPE "FianzaStatus_old";
ALTER TABLE "reserva" ALTER COLUMN "fianza_status" SET DEFAULT 'pendiente';

-- AlterEnum: TipoFactura sin `fianza`
CREATE TYPE "TipoFactura_new" AS ENUM ('senal', 'liquidacion', 'complementaria');
ALTER TABLE "factura" ALTER COLUMN "tipo" TYPE "TipoFactura_new" USING ("tipo"::text::"TipoFactura_new");
ALTER TYPE "TipoFactura" RENAME TO "TipoFactura_old";
ALTER TYPE "TipoFactura_new" RENAME TO "TipoFactura";
DROP TYPE "TipoFactura_old";

-- DropColumn: captura de IBAN y retención parcial eliminadas
ALTER TABLE "cliente" DROP COLUMN "iban_devolucion";
ALTER TABLE "reserva" DROP COLUMN "fianza_devuelta_eur";
ALTER TABLE "reserva" DROP COLUMN "motivo_retencion";

-- AddColumn: marca de subida del comprobante de la fianza (espejo de cond_part_firmadas_fecha)
ALTER TABLE "reserva" ADD COLUMN "fianza_comprobante_fecha" TIMESTAMP(3);
