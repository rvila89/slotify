/**
 * Adaptador FAKE del puerto de generación de PDF del presupuesto (US-014 / §D-6).
 *
 * INFRAESTRUCTURA. La generación real (Puppeteer/react-pdf) es un adaptador diferido;
 * el MVP entrega un fake determinista que devuelve una `pdf_url` sintética por
 * presupuesto SIN tocar red ni disco. Vive en infraestructura (el dominio solo conoce
 * el puerto `GenerarPdfPresupuestoPort`). La generación es POST-COMMIT, fuera de la
 * transacción crítica que sostiene el `FOR UPDATE` sobre la fila bloqueada.
 */
import { Injectable } from '@nestjs/common';
import type { GenerarPdfPresupuestoPort } from '../application/generar-presupuesto.use-case';

@Injectable()
export class PdfPresupuestoFakeAdapter {
  readonly generar: GenerarPdfPresupuestoPort = async (params) =>
    `https://storage.local/presupuestos/${params.idPresupuesto}.pdf`;
}
