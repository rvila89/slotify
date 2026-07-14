/**
 * Adaptador REAL de generación del PDF de la FACTURA (épico #6, 6.3, design.md §D4/§D6) —
 * INFRAESTRUCTURA de `facturacion`. SUSTITUYE al `PdfFacturaFakeAdapter` en producción.
 *
 * Implementa el puerto `GenerarPdfFacturaPort` (token `GENERAR_PDF_FACTURA_PORT`). Flujo
 * POST-COMMIT, fuera de la transacción crítica:
 *   1. Carga los datos del documento (config del tenant + numeroPresupuesto + regimenIva +
 *      cliente + tipo + fechaEmision + extras + desglose) vía `CargarDatosDocumentoFacturaPort`
 *      bajo el RLS del tenant.
 *   2. Construye el modelo de vista con `construirModeloDocumentoFactura` (flags CON/SIN IVA
 *      derivados del desglose; concepto por tipo, §D-2).
 *   3. Renderiza el PDF a bytes con `renderizarDocumentoFacturaABytes` (react-pdf).
 *   4. Sube por `AlmacenDocumentosPort.subir(bytes, clave)` con una clave que AÍSLA por tenant
 *      (`tenant_id/facturas/{idFactura}.pdf`) y devuelve la URL.
 *
 * Hexagonal: depende SOLO de puertos/servicios inyectados; el render se inyecta como función
 * para no instanciar react-pdf en los tests del adaptador.
 */
import type { AlmacenDocumentosPort } from '../../documentos/domain/almacen-documentos.port';
import {
  construirModeloDocumentoFactura,
  type ModeloDocumentoFactura,
  type TipoDocumentoFactura,
} from '../../documentos/presentation/modelo-documento-factura';
import type { CargarDatosDocumentoFacturaPort } from '../domain/cargar-datos-documento-factura.port';
import type {
  GenerarPdfFacturaParams,
  GenerarPdfFacturaPort,
} from '../application/generar-factura-senal.use-case';
import type { TipoFactura } from '../domain/factura';

/** Render del documento de factura a bytes (capa de plantilla de `documentos`). */
export type RenderizarDocumentoFactura = (
  modelo: ModeloDocumentoFactura,
) => Promise<Buffer>;

/** Deriva la clave del objeto en el almacén; AÍSLA por tenant. */
const clavePdf = (tenantId: string, idFactura: string): string =>
  `${tenantId}/facturas/${idFactura}.pdf`;

/** Mapea el tipo de FACTURA al tipo de documento renderizable (§D-2). */
const aTipoDocumento = (tipo: TipoFactura): TipoDocumentoFactura => {
  if (tipo === 'senal' || tipo === 'liquidacion' || tipo === 'fianza') {
    return tipo;
  }
  // `complementaria` no tiene plantilla propia en el MVP: se pinta como liquidación.
  return 'liquidacion';
};

export class PdfFacturaRealAdapter {
  constructor(
    private readonly cargarDatos: CargarDatosDocumentoFacturaPort,
    private readonly almacen: AlmacenDocumentosPort,
    private readonly renderizar: RenderizarDocumentoFactura,
  ) {}

  readonly generar: GenerarPdfFacturaPort = async (
    params: GenerarPdfFacturaParams,
  ): Promise<string> => {
    // (1) Datos del documento bajo RLS del tenant.
    const datos = await this.cargarDatos.cargar(params.idFactura, params.tenantId);

    // (2) Modelo de vista (flags CON/SIN IVA + concepto por tipo).
    const modelo = construirModeloDocumentoFactura({
      config: datos.configuracion,
      datos: {
        tipo: aTipoDocumento(datos.tipo),
        numeroFactura: datos.numeroFactura,
        fechaEmision: datos.fechaEmision,
        numeroPresupuesto: datos.numeroPresupuesto,
        cliente: {
          nombre: datos.cliente.nombre,
          apellidos: datos.cliente.apellidos,
          dniNif: datos.cliente.dniNif,
          direccion: datos.cliente.direccion,
          codigoPostal: datos.cliente.codigoPostal,
          poblacion: datos.cliente.poblacion,
          provincia: datos.cliente.provincia,
        },
        extras: datos.extras,
        desglose: datos.desglose,
      },
    });

    // (3) Render → bytes. (4) Sube con clave que aísla por tenant y devuelve la URL.
    const bytes = await this.renderizar(modelo);
    const clave = clavePdf(params.tenantId, params.idFactura);
    return this.almacen.subir(new Uint8Array(bytes), clave);
  };
}
