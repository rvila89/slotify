/**
 * Caso de uso de APLICACIÓN: listar (solo lectura) las FACTURA de una RESERVA (US-027 / UC-21,
 * UC-22) — vista de la colección `GET /reservas/{id}/facturas`.
 *
 * Devuelve todas las facturas de la reserva (`senal`, `liquidacion`, `fianza`,
 * `complementaria`), opcionalmente filtradas por `tipo`, cada una con su desglose fiscal,
 * estado, `numero_factura` (NULL en borrador), `pdfUrl`, `fechaEmision` y los flags derivados.
 * NO crea ni muta ninguna FACTURA. Aislada por `tenant_id` (RLS): si la reserva no existe en
 * el tenant → ReservaFacturasNoEncontradaError (404). La alerta al Gestor "Documentos de
 * liquidación y fianza pendientes de revisión" la DERIVA el frontend de esta colección (§D-6).
 *
 * Hexagonal (hook `no-infra-in-domain`): depende SOLO de puertos inyectados.
 */

/** Tipos de factura del contrato. */
export type TipoFacturaListado = 'senal' | 'liquidacion' | 'fianza' | 'complementaria';

/** Vista de lectura de una FACTURA de la colección. */
export interface FacturaListada {
  idFactura: string;
  reservaId: string;
  numeroFactura: string | null;
  tipo: TipoFacturaListado;
  baseImponible: string;
  ivaPorcentaje: string;
  ivaImporte: string;
  total: string;
  concepto: string | null;
  pdfUrl: string | null;
  estado: 'borrador' | 'enviada' | 'cobrada';
  fechaEmision: Date | null;
  fechaCreacion: Date;
}

/** Comando de listado (tenant del JWT, nunca del path/body; filtro opcional por tipo). */
export interface ListarFacturasReservaComando {
  tenantId: string;
  reservaId: string;
  tipo?: TipoFacturaListado;
}

/** La RESERVA no existe para el tenant (RLS). Mapea a 404. */
export class ReservaFacturasNoEncontradaError extends Error {
  readonly codigo = 'RESERVA_NO_ENCONTRADA' as const;
  readonly reservaId: string;

  constructor(reservaId: string) {
    super('La reserva no existe para el tenant');
    this.name = 'ReservaFacturasNoEncontradaError';
    this.reservaId = reservaId;
  }
}

/** Lectura de las FACTURA de la reserva (RLS: cross-tenant → null; array si existe). */
export interface ListarFacturasReservaPort {
  (params: {
    tenantId: string;
    reservaId: string;
    tipo?: TipoFacturaListado;
  }): Promise<ReadonlyArray<FacturaListada> | null>;
}

/** Dependencias del caso de uso. */
export interface ListarFacturasReservaDeps {
  listarFacturas: ListarFacturasReservaPort;
}

export class ListarFacturasReservaUseCase {
  constructor(private readonly deps: ListarFacturasReservaDeps) {}

  /** Lista las facturas de la reserva (colección), opcionalmente filtradas por tipo. */
  async ejecutar(
    comando: ListarFacturasReservaComando,
  ): Promise<ReadonlyArray<FacturaListada>> {
    const facturas = await this.deps.listarFacturas({
      tenantId: comando.tenantId,
      reservaId: comando.reservaId,
      tipo: comando.tipo,
    });
    if (facturas === null) {
      throw new ReservaFacturasNoEncontradaError(comando.reservaId);
    }
    return facturas;
  }
}
