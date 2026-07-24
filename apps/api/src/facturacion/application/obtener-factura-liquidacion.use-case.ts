/**
 * Caso de uso de APLICACIÓN: obtener (solo lectura) la factura de liquidación de una reserva
 * (fix-liquidacion-fianza-independientes / UC-21). Espejo de `obtener-factura-senal`. No crea ni
 * muta la FACTURA: la crea el disparo post-commit de US-021/US-027.
 *
 * Deriva los flags `esBorradorInvalido` / `pdfPendiente` (a partir del estado de `pdf_url` y de
 * los datos fiscales del CLIENTE) y `e4Enviado` (COMUNICACION E4 `enviado`, no reenvío) para el
 * banner permanente "Liquidación enviada el {fecha/hora}". Aislado por `tenant_id` (RLS). Si la
 * reserva no existe o aún no tiene factura de liquidación → FacturaLiquidacionNoEncontradaError.
 *
 * Hexagonal (hook `no-infra-in-domain`): depende SOLO de puertos inyectados.
 */
import type {
  CargarClienteFiscalPort,
  CargarReservaFacturablePort,
} from './generar-factura-senal.use-case';
import { CAMPOS_FISCALES_CLIENTE } from './generar-factura-senal.use-case';
import type { EstadoFactura, TipoFactura } from '../domain/factura';

/** Comando de lectura. */
export interface ObtenerFacturaLiquidacionComando {
  tenantId: string;
  reservaId: string;
}

/** FACTURA de liquidación (proyección de lectura). */
export interface FacturaLiquidacion {
  idFactura: string;
  tenantId: string;
  reservaId: string;
  numeroFactura: string | null;
  tipo: TipoFactura;
  estado: EstadoFactura;
  total: string;
  baseImponible: string;
  ivaPorcentaje: string;
  ivaImporte: string;
  pdfUrl: string | null;
  fechaEmision: Date | null;
}

/** Resultado: la factura + flags derivados + campos fiscales faltantes + `e4Enviado`. */
export interface FacturaLiquidacionResultado extends FacturaLiquidacion {
  esBorradorInvalido: boolean;
  pdfPendiente: boolean;
  camposFiscalesFaltantes: ReadonlyArray<string>;
  /** `true` si ya se envió la liquidación por E4 (COMUNICACION E4 `enviado`, no reenvío). */
  e4Enviado?: boolean;
}

/** No existe factura de liquidación para la reserva (o la reserva no existe). Mapea a 404. */
export class FacturaLiquidacionNoEncontradaError extends Error {
  readonly codigo = 'FACTURA_LIQUIDACION_NO_ENCONTRADA' as const;
  readonly reservaId: string;

  constructor(reservaId: string) {
    super('La reserva no tiene factura de liquidación');
    this.name = 'FacturaLiquidacionNoEncontradaError';
    this.reservaId = reservaId;
  }
}

/** Lectura de la FACTURA de liquidación por reserva (RLS). */
export interface CargarFacturaLiquidacionPort {
  (params: {
    tenantId: string;
    reservaId: string;
  }): Promise<FacturaLiquidacion | null | undefined>;
}

/** Verificación de si ya se envió E4 (COMUNICACION E4 `enviado`, no reenvío). */
export interface VerificarE4EnviadoPort {
  (params: { tenantId: string; reservaId: string }): Promise<boolean>;
}

/** Dependencias del caso de uso. */
export interface ObtenerFacturaLiquidacionDeps {
  cargarReserva: CargarReservaFacturablePort;
  cargarLiquidacion: CargarFacturaLiquidacionPort;
  cargarCliente: CargarClienteFiscalPort;
  verificarE4Enviado: VerificarE4EnviadoPort;
}

export class ObtenerFacturaLiquidacionUseCase {
  constructor(private readonly deps: ObtenerFacturaLiquidacionDeps) {}

  /** Lee la factura de liquidación de una RESERVA (GET /reservas/{id}/factura-liquidacion). */
  async ejecutar(
    comando: ObtenerFacturaLiquidacionComando,
  ): Promise<FacturaLiquidacionResultado> {
    const reserva = await this.deps.cargarReserva({
      tenantId: comando.tenantId,
      reservaId: comando.reservaId,
    });
    if (reserva === null || reserva === undefined) {
      throw new FacturaLiquidacionNoEncontradaError(comando.reservaId);
    }
    const factura = await this.deps.cargarLiquidacion({
      tenantId: comando.tenantId,
      reservaId: comando.reservaId,
    });
    if (factura === null || factura === undefined) {
      throw new FacturaLiquidacionNoEncontradaError(comando.reservaId);
    }
    const resultado = await this.conFlags(comando.tenantId, factura, reserva.clienteId);
    const e4Enviado = await this.deps.verificarE4Enviado({
      tenantId: comando.tenantId,
      reservaId: comando.reservaId,
    });
    return { ...resultado, e4Enviado };
  }

  /** Deriva los flags `esBorradorInvalido`/`pdfPendiente`. */
  private async conFlags(
    tenantId: string,
    factura: FacturaLiquidacion,
    clienteId: string,
  ): Promise<FacturaLiquidacionResultado> {
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
