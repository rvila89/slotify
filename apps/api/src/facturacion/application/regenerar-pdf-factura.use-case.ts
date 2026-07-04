/**
 * Caso de uso de APLICACIÓN: reintentar la generación del PDF de la factura de señal
 * (US-022 / UC-18, design.md §D-5/§D-9). Reintento MANUAL además del automático post-commit.
 *
 * Idempotente sobre `pdf_url`: si el PDF se genera, actualiza `pdf_url`; el `estado`
 * permanece en `borrador` (no aprueba ni envía). Guardas:
 *   - FACTURA existe (RLS) → si no, FacturaNoEncontradaError (404).
 *   - está en `borrador` → si no, FacturaNoBorradorError (409): el PDF de una factura ya
 *     emitida es inmutable.
 *   - datos fiscales del CLIENTE completos → si no, DatosFiscalesIncompletosError (422); no
 *     se produce PDF y el borrador sigue inválido.
 *   - el servicio de PDF responde → si falla de forma transitoria, PdfPendienteError (422).
 *
 * Hexagonal (hook `no-infra-in-domain`): depende SOLO de puertos inyectados.
 */
import { esBorrador } from '../domain/factura';
import type {
  CargarClienteFiscalPort,
  CargarTenantFiscalPort,
  FacturaSenal,
  FacturaSenalResultado,
  GenerarPdfFacturaPort,
  UnidadDeTrabajoFacturacionPort,
} from './generar-factura-senal.use-case';
import { CAMPOS_FISCALES_CLIENTE } from './generar-factura-senal.use-case';
import {
  DatosFiscalesIncompletosError,
  FacturaNoBorradorError,
  FacturaNoEncontradaError,
  PdfPendienteError,
} from './aprobar-factura.use-case';

/** Comando de regeneración de PDF. */
export interface RegenerarPdfFacturaComando {
  tenantId: string;
  usuarioId: string;
  facturaId: string;
}

/** Lectura de la FACTURA + la reserva/cliente asociados para regenerar. */
export interface CargarFacturaParaPdfPort {
  (params: { tenantId: string; facturaId: string }): Promise<{
    factura: FacturaSenal;
    clienteId: string;
    concepto: string;
  } | null>;
}

/** Dependencias del caso de uso (puertos inyectados). */
export interface RegenerarPdfFacturaDeps {
  cargarFacturaParaPdf: CargarFacturaParaPdfPort;
  cargarCliente: CargarClienteFiscalPort;
  cargarTenant: CargarTenantFiscalPort;
  generarPdf: GenerarPdfFacturaPort;
  unidadDeTrabajo: UnidadDeTrabajoFacturacionPort;
}

export class RegenerarPdfFacturaUseCase {
  constructor(private readonly deps: RegenerarPdfFacturaDeps) {}

  /** Regenera el PDF idempotente sobre `pdf_url`; el estado sigue en `borrador`. */
  async ejecutar(
    comando: RegenerarPdfFacturaComando,
  ): Promise<FacturaSenalResultado> {
    const cargada = await this.deps.cargarFacturaParaPdf({
      tenantId: comando.tenantId,
      facturaId: comando.facturaId,
    });
    if (cargada === null) {
      throw new FacturaNoEncontradaError(comando.facturaId);
    }
    const { factura, clienteId, concepto } = cargada;
    if (!esBorrador(factura.estado)) {
      throw new FacturaNoBorradorError();
    }

    const cliente = await this.deps.cargarCliente({
      tenantId: comando.tenantId,
      clienteId,
    });
    const faltantes = CAMPOS_FISCALES_CLIENTE.filter((campo) => {
      const valor = cliente[campo];
      return valor === null || valor === undefined || valor === '';
    });
    if (faltantes.length > 0) {
      throw new DatosFiscalesIncompletosError(faltantes);
    }

    const emisor = await this.deps.cargarTenant({ tenantId: comando.tenantId });
    let pdfUrl: string;
    try {
      pdfUrl = await this.deps.generarPdf({
        idFactura: factura.idFactura,
        numeroFactura: factura.numeroFactura,
        concepto,
        emisor: {
          nombre: emisor.nombre,
          nif: emisor.nif ?? undefined,
          iban: emisor.iban ?? undefined,
          direccion: emisor.direccion ?? undefined,
        },
        receptor: cliente,
        baseImponible: factura.baseImponible,
        ivaPorcentaje: factura.ivaPorcentaje,
        ivaImporte: factura.ivaImporte,
        total: factura.total,
      });
    } catch {
      // El reintento manual también puede fallar de forma transitoria.
      throw new PdfPendienteError();
    }
    await this.deps.unidadDeTrabajo.ejecutar(comando.tenantId, async (repos) => {
      await repos.facturas.guardarPdfUrl(factura.idFactura, pdfUrl);
    });
    return {
      ...factura,
      pdfUrl,
      esBorradorInvalido: false,
      pdfPendiente: false,
      camposFiscalesFaltantes: [],
    };
  }
}
