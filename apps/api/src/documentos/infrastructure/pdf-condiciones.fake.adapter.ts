/**
 * Adaptador FAKE de generación del PDF de "Condicions particulars" (épico #6, rebanada
 * 6.4a) — INFRAESTRUCTURA de `documentos` para tests/CI.
 *
 * Espejo del fake del presupuesto (6.1b): implementa `GenerarPdfCondicionesPort`
 * devolviendo una URL SINTÉTICA determinista por tenant e IDIOMA (clave
 * `condiciones/{tenantId}-{idioma}.pdf`, Mejora A), sin tocar red, disco ni react-pdf.
 */
import type { GenerarPdfCondicionesPort } from '../domain/generar-pdf-condiciones.port';

export class PdfCondicionesFakeAdapter implements GenerarPdfCondicionesPort {
  async generar(params: { tenantId: string; idioma: 'es' | 'ca' }): Promise<string | null> {
    return `https://storage.local/condiciones/${params.tenantId}-${params.idioma}.pdf`;
  }
}
