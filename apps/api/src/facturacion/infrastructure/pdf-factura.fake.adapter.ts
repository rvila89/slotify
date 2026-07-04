/**
 * Adaptador FAKE del puerto `GenerarPdfFacturaPort` (US-022 / §D-5).
 *
 * INFRAESTRUCTURA. Reutiliza el patrón del `PdfPresupuestoFakeAdapter` (US-014): el MVP
 * entrega un fake determinista que devuelve una `pdf_url` sintética por factura SIN tocar
 * red ni disco. El render real (Puppeteer/react-pdf) es un adaptador diferido enchufable
 * sin cambiar el dominio. La generación es POST-COMMIT, fuera de la transacción crítica.
 */
import { Injectable } from '@nestjs/common';
import type { GenerarPdfFacturaPort } from '../application/generar-factura-senal.use-case';

@Injectable()
export class PdfFacturaFakeAdapter {
  readonly generar: GenerarPdfFacturaPort = async (params) =>
    `https://storage.local/facturas/${params.idFactura}.pdf`;
}
