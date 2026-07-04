/**
 * Caso de uso de APLICACIÓN: obtener (solo lectura) la factura de señal de una reserva
 * (US-022 / UC-18). No crea ni muta la FACTURA: la crea el disparo post-commit de US-021.
 *
 * Deriva los flags `esBorradorInvalido` / `pdfPendiente` (design.md §D-9) a partir del
 * estado de `pdf_url` y de los datos fiscales del CLIENTE. Aislado por `tenant_id` (RLS).
 * Si la reserva no existe o aún no tiene factura de señal → FacturaSenalNoEncontradaError.
 *
 * Hexagonal (hook `no-infra-in-domain`): depende SOLO de puertos inyectados.
 */
import type {
  CargarClienteFiscalPort,
  CargarReservaFacturablePort,
  FacturaRepositoryPort,
  FacturaSenal,
  FacturaSenalResultado,
  UnidadDeTrabajoFacturacionPort,
} from './generar-factura-senal.use-case';
import { CAMPOS_FISCALES_CLIENTE } from './generar-factura-senal.use-case';
import type { CargarFacturaParaPdfPort } from './regenerar-pdf-factura.use-case';

/** Comando de lectura. */
export interface ObtenerFacturaSenalComando {
  tenantId: string;
  reservaId: string;
}

/** No existe factura de señal para la reserva (o la reserva no existe). Mapea a 404. */
export class FacturaSenalNoEncontradaError extends Error {
  readonly codigo = 'FACTURA_SENAL_NO_ENCONTRADA' as const;
  readonly reservaId: string;

  constructor(reservaId: string) {
    super('La reserva no tiene factura de señal');
    this.name = 'FacturaSenalNoEncontradaError';
    this.reservaId = reservaId;
  }
}

/** Dependencias del caso de uso. */
export interface ObtenerFacturaSenalDeps {
  unidadDeTrabajo: UnidadDeTrabajoFacturacionPort;
  cargarReserva: CargarReservaFacturablePort;
  cargarCliente: CargarClienteFiscalPort;
  cargarFacturaParaPdf: CargarFacturaParaPdfPort;
}

export class ObtenerFacturaSenalUseCase {
  constructor(private readonly deps: ObtenerFacturaSenalDeps) {}

  /** Lee la factura de señal de una RESERVA (GET /reservas/{id}/factura-senal). */
  async ejecutar(
    comando: ObtenerFacturaSenalComando,
  ): Promise<FacturaSenalResultado> {
    const reserva = await this.deps.cargarReserva({
      tenantId: comando.tenantId,
      reservaId: comando.reservaId,
    });
    if (reserva === null || reserva === undefined) {
      throw new FacturaSenalNoEncontradaError(comando.reservaId);
    }
    const factura = (await this.deps.unidadDeTrabajo.ejecutar(
      comando.tenantId,
      (repos: { facturas: FacturaRepositoryPort }) =>
        repos.facturas.buscarPorReservaYTipo(comando.reservaId, 'senal'),
    )) as FacturaSenal | null;
    if (factura === null) {
      throw new FacturaSenalNoEncontradaError(comando.reservaId);
    }
    return this.conFlags(comando.tenantId, factura, reserva.clienteId);
  }

  /** Lee la factura por su id y deriva sus flags (respuesta tras aprobar/rechazar). */
  async ejecutarPorFactura(comando: {
    tenantId: string;
    facturaId: string;
  }): Promise<FacturaSenalResultado> {
    const cargada = await this.deps.cargarFacturaParaPdf({
      tenantId: comando.tenantId,
      facturaId: comando.facturaId,
    });
    if (cargada === null) {
      throw new FacturaSenalNoEncontradaError(comando.facturaId);
    }
    return this.conFlags(comando.tenantId, cargada.factura, cargada.clienteId);
  }

  /** Deriva los flags `esBorradorInvalido`/`pdfPendiente` (design.md §D-9). */
  private async conFlags(
    tenantId: string,
    factura: FacturaSenal,
    clienteId: string,
  ): Promise<FacturaSenalResultado> {
    const cliente = await this.deps.cargarCliente({ tenantId, clienteId });
    const faltantes = CAMPOS_FISCALES_CLIENTE.filter((campo) => {
      const valor = cliente[campo];
      return valor === null || valor === undefined || valor === '';
    });
    const esBorradorInvalido = faltantes.length > 0 && factura.pdfUrl === null;
    return {
      ...factura,
      esBorradorInvalido,
      pdfPendiente: factura.pdfUrl === null && !esBorradorInvalido,
      camposFiscalesFaltantes: faltantes,
    };
  }
}
