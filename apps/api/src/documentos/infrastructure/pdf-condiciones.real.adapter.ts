/**
 * Adaptador REAL de generación del PDF de "Condicions particulars" (épico #6, rebanada
 * 6.4a `documentos-condiciones-particulares-pdf`) — INFRAESTRUCTURA de `documentos`.
 *
 * Implementa el puerto de dominio `GenerarPdfCondicionesPort` (firma
 * `(params:{tenantId,idioma}) => Promise<string|null>`, token `GENERAR_PDF_CONDICIONES_PORT`).
 * Espejo de `PdfPresupuestoRealAdapter` (6.1b). El documento es LEGAL y largo: la clave
 * diferencia por tenant e IDIOMA `condiciones/{tenantId}-{idioma}.pdf` (Mejora A) para que
 * `es` y `ca` del mismo tenant NO compartan PDF, y reutiliza el objeto ya subido.
 *
 * Flujo con degradación (design.md §Flujo + D3):
 *   1. `ObtenerConfiguracionDocumentoService.ejecutar(tenantId)`; `null` → `null`.
 *   2. Si `config.condiciones.secciones` está VACÍO → `null` (D3): no se genera ni sube.
 *   3. Solo con secciones: `renderizar(config, idioma)` → bytes (el idioma elige el texto
 *      del JSON bilingüe).
 *   4. `AlmacenDocumentosPort.subir(bytes, clave)` → URL.
 *
 * Hexagonal: depende SOLO de puertos/servicios inyectados; el render se inyecta como
 * función `(config, idioma) => Promise<Uint8Array>` para no instanciar react-pdf en los
 * tests del adaptador.
 */
import type { ObtenerConfiguracionDocumentoService } from '../application/obtener-configuracion-documento.service';
import type { AlmacenDocumentosPort } from '../domain/almacen-documentos.port';
import type { ConfiguracionDocumentoTenant } from '../domain/configuracion-documento';
import type { GenerarPdfCondicionesPort } from '../domain/generar-pdf-condiciones.port';

/** Renderizador del documento a bytes de PDF (capa de plantilla de `documentos`). */
export type RenderizarDocumentoCondiciones = (
  config: ConfiguracionDocumentoTenant,
  idioma: 'es' | 'ca',
) => Promise<Uint8Array>;

/** Deriva la clave del objeto en el almacén; AÍSLA por tenant e IDIOMA (Mejora A). */
const clavePdf = (tenantId: string, idioma: 'es' | 'ca'): string =>
  `condiciones/${tenantId}-${idioma}.pdf`;

export class PdfCondicionesRealAdapter implements GenerarPdfCondicionesPort {
  constructor(
    private readonly configService: ObtenerConfiguracionDocumentoService,
    private readonly almacen: AlmacenDocumentosPort,
    private readonly renderizar: RenderizarDocumentoCondiciones,
  ) {}

  async generar(params: { tenantId: string; idioma: 'es' | 'ca' }): Promise<string | null> {
    // (1) Config del tenant: sin config no hay documento posible → degrada a null.
    const config = await this.configService.ejecutar(params.tenantId);
    if (config === null) {
      return null;
    }

    // (2) D3: config presente pero sin secciones → no se genera ni adjunta (null).
    if (config.condiciones.secciones.length === 0) {
      return null;
    }

    // (3) Render → bytes (el idioma selecciona el texto del JSON bilingüe). (4) Sube con
    //     clave diferenciada por tenant e idioma y devuelve la URL.
    const bytes = await this.renderizar(config, params.idioma);
    return this.almacen.subir(bytes, clavePdf(params.tenantId, params.idioma));
  }
}
