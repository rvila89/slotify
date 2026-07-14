/**
 * Adaptador REAL de generación de PDF del presupuesto CON IVA (épico #6, rebanada 6.1b
 * `documentos-presupuesto-pdf-con-iva`) — INFRAESTRUCTURA de `presupuestos`.
 *
 * Implementa el puerto de dominio `GenerarPdfPresupuestoPort` (firma
 * `(params:{tenantId,reservaId,idPresupuesto}) => Promise<string|null>`, token
 * `GENERAR_PDF_PRESUPUESTO_PORT`), SUSTITUYE al fake en producción. Flujo (design.md
 * §"Flujo del adaptador real"), POST-COMMIT fuera de la tx crítica:
 *   1. Obtiene la CONFIG del tenant (6.1a) vía `ObtenerConfiguracionDocumentoService`.
 *      `null` → degrada a `null` sin renderizar ni subir (no revienta la pre_reserva).
 *   2. Carga los DATOS del presupuesto (cliente/reserva/extras/desglose/reparto) bajo el
 *      RLS del tenant. `null` (RLS/cross-tenant) → degrada a `null`.
 *   3. Renderiza el PDF (react-pdf, capa de plantilla de `documentos`) → bytes.
 *   4. Sube por `AlmacenDocumentosPort.subir(bytes, clave)` con una clave que AÍSLA por
 *      tenant (`presupuestos/{tenantId}/{idPresupuesto}.pdf`) y devuelve la URL.
 *
 * Hexagonal: depende SOLO de puertos/servicios inyectados; el render se inyecta como
 * función `(config, datos) => Promise<Uint8Array>` para no instanciar react-pdf en los
 * tests del adaptador.
 */
import type { ObtenerConfiguracionDocumentoService } from '../../documentos/application/obtener-configuracion-documento.service';
import type { AlmacenDocumentosPort } from '../../documentos/domain/almacen-documentos.port';
import type { ConfiguracionDocumentoTenant } from '../../documentos/domain/configuracion-documento';
import type { DatosDocumentoPresupuesto } from '../../documentos/presentation/modelo-documento-presupuesto';
import type { GenerarPdfPresupuestoPort } from '../application/generar-presupuesto.use-case';

/**
 * DATOS del presupuesto cargados de BD para alimentar el documento. Superset estructural
 * de `DatosDocumentoPresupuesto` (lo que consume la plantilla), cargado bajo el RLS del
 * tenant por el puerto de lectura.
 */
export type DatosDocumentoPresupuestoCargados = DatosDocumentoPresupuesto;

/** Parámetros de la carga de datos del documento (RLS del tenant). */
export interface CargarDatosDocumentoPresupuestoParams {
  tenantId: string;
  reservaId: string;
  idPresupuesto: string;
}

/**
 * Puerto de lectura de los datos del documento de presupuesto. Devuelve los datos
 * cargados o `null` cuando no existen para el tenant (RLS/cross-tenant). Token
 * `CARGAR_DATOS_DOCUMENTO_PRESUPUESTO_PORT`.
 */
export interface CargarDatosDocumentoPresupuestoPort {
  ejecutar(
    params: CargarDatosDocumentoPresupuestoParams,
  ): Promise<DatosDocumentoPresupuestoCargados | null>;
}

/** Renderizador del documento a bytes de PDF (capa de plantilla de `documentos`). */
export type RenderizarDocumentoPresupuesto = (
  config: ConfiguracionDocumentoTenant,
  datos: DatosDocumentoPresupuestoCargados,
) => Promise<Uint8Array>;

/** Deriva la clave del objeto en el almacén; AÍSLA por tenant. */
const clavePdf = (tenantId: string, idPresupuesto: string): string =>
  `presupuestos/${tenantId}/${idPresupuesto}.pdf`;

export class PdfPresupuestoRealAdapter {
  constructor(
    private readonly configService: ObtenerConfiguracionDocumentoService,
    private readonly cargarDatos: CargarDatosDocumentoPresupuestoPort,
    private readonly almacen: AlmacenDocumentosPort,
    private readonly renderizar: RenderizarDocumentoPresupuesto,
  ) {}

  readonly generar: GenerarPdfPresupuestoPort = async (params) => {
    // (1) Config del tenant: sin config no hay documento posible → degrada a null.
    const config = await this.configService.ejecutar(params.tenantId);
    if (config === null) {
      return null;
    }

    // (2) Datos del presupuesto bajo RLS: cross-tenant/no encontrados → degrada a null.
    const datos = await this.cargarDatos.ejecutar({
      tenantId: params.tenantId,
      reservaId: params.reservaId,
      idPresupuesto: params.idPresupuesto,
    });
    if (datos === null) {
      return null;
    }

    // (3) Render → bytes. (4) Sube con clave que aísla por tenant y devuelve la URL.
    const bytes = await this.renderizar(config, datos);
    const clave = clavePdf(params.tenantId, params.idPresupuesto);
    return this.almacen.subir(bytes, clave);
  };
}
