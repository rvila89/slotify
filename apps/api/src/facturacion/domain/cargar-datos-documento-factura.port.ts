/**
 * Puerto de dominio de carga de DATOS del documento de FACTURA (épico #6, rebanada 6.3
 * `documentos-facturas-pdf`, design.md §D3) — DOMINIO de `facturacion`.
 *
 * Abstrae la lectura de todo lo necesario para renderizar el PDF de una factura: la
 * CONFIGURACIÓN de documento del tenant (6.1a), el `numeroPresupuesto` y el `regimenIva`
 * del presupuesto aceptado de la reserva, y los datos fiscales del CLIENTE (receptor). El
 * adaptador Prisma une `Factura → Reserva → Presupuesto(estado=aceptado) → Cliente` y carga
 * la `PlantillaDocumentoTenant` del tenant, todo bajo el RLS del tenant.
 *
 * Interfaz PURA de dominio: no importa `@nestjs`, Prisma ni infra (hook `no-infra-in-domain`).
 * Reutiliza el VO `ConfiguracionDocumentoTenant` de `documentos` (frontera de presentación
 * compartida del épico; `facturacion` no depende de `presupuestos`).
 */
import type { ConfiguracionDocumentoTenant } from '../../documentos/domain/configuracion-documento';
import type { RegimenIvaFactura } from './calculo-factura';
import type { TipoFactura } from './factura';

/** Datos fiscales del CLIENTE (receptor) tal como se pintan en la factura. */
export interface ClienteDocumentoFactura {
  nombre: string;
  apellidos: string;
  dniNif: string | null;
  direccion: string | null;
  codigoPostal: string | null;
  poblacion: string | null;
  provincia: string | null;
  email: string;
}

/** Un extra facturado como sub-concepto (subtotal Decimal string de 2 decimales). */
export interface ExtraDocumentoFactura {
  descripcion: string;
  subtotal: string;
}

/** Desglose fiscal congelado de la FACTURA (importes Decimal string de 2 decimales). */
export interface DesgloseDocumentoFactura {
  baseImponible: string;
  ivaPorcentaje: string;
  ivaImporte: string;
  total: string;
}

/** DATOS necesarios para renderizar el PDF de la factura (cargados bajo RLS del tenant). */
export interface DatosDocumentoFactura {
  configuracion: ConfiguracionDocumentoTenant;
  tipo: TipoFactura;
  numeroFactura: string | null;
  fechaEmision: Date | null;
  /** Número del presupuesto aceptado; NULL si no lo tiene (caso edge de migración). */
  numeroPresupuesto: string | null;
  /** Régimen fiscal del presupuesto aceptado; CON IVA por defecto. */
  regimenIva: RegimenIvaFactura;
  cliente: ClienteDocumentoFactura;
  extras: ReadonlyArray<ExtraDocumentoFactura>;
  desglose: DesgloseDocumentoFactura;
}

/** Puerto de carga de los datos del documento de factura. Token `CARGAR_DATOS_DOCUMENTO_FACTURA_PORT`. */
export interface CargarDatosDocumentoFacturaPort {
  readonly cargar: (idFactura: string, tenantId: string) => Promise<DatosDocumentoFactura>;
}
