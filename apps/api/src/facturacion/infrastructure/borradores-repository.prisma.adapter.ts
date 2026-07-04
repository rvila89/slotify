/**
 * Repositorios Prisma tx-bound de los BORRADORES de liquidación y fianza (US-027 / UC-21,
 * UC-22).
 *
 * Implementan los puertos de `GenerarBorradoresLiquidacionFianzaUseCase` sobre el cliente
 * transaccional (`Prisma.TransactionClient`) que la unidad de trabajo abre bajo el contexto
 * RLS. La creación fija `numero_factura = NULL` (la numeración fiscal se difiere a la emisión,
 * US-028); la idempotencia se apoya en el `UNIQUE(reserva_id, tipo)` (design.md §D-4, ya
 * migrado en US-022). Un `P2002` PROPAGA para que el use-case recupere la existente. Los
 * Decimal se mapean a string de 2 decimales.
 */
import {
  AccionAudit,
  EstadoFactura as EstadoFacturaPrisma,
  Prisma,
  TipoFactura as TipoFacturaPrisma,
} from '@prisma/client';
import type {
  AuditoriaBorradorPort,
  BorradorFactura,
  CrearBorradorParams,
  FacturaBorradorRepositoryPort,
  RegistroAuditoriaBorrador,
} from '../application/generar-borradores-liquidacion-fianza.use-case';

/** Mapea una fila FACTURA de Prisma a la proyección de dominio `BorradorFactura`. */
const aBorradorFactura = (fila: {
  idFactura: string;
  tenantId: string;
  reservaId: string;
  numeroFactura: string | null;
  tipo: TipoFacturaPrisma;
  estado: EstadoFacturaPrisma;
  total: Prisma.Decimal;
  baseImponible: Prisma.Decimal;
  ivaPorcentaje: Prisma.Decimal;
  ivaImporte: Prisma.Decimal;
}): BorradorFactura => ({
  idFactura: fila.idFactura,
  tenantId: fila.tenantId,
  reservaId: fila.reservaId,
  numeroFactura: fila.numeroFactura,
  tipo: fila.tipo as 'liquidacion' | 'fianza',
  estado: fila.estado as 'borrador' | 'enviada' | 'cobrada',
  total: fila.total.toFixed(2),
  baseImponible: fila.baseImponible.toFixed(2),
  ivaPorcentaje: fila.ivaPorcentaje.toFixed(2),
  ivaImporte: fila.ivaImporte.toFixed(2),
});

/** Repositorio tx-bound de FACTURA (borradores de liquidación/fianza). */
export class FacturaBorradorPrismaRepository implements FacturaBorradorRepositoryPort {
  constructor(private readonly tx: Prisma.TransactionClient) {}

  async buscarPorReservaYTipo(
    reservaId: string,
    tipo: 'liquidacion' | 'fianza',
  ): Promise<BorradorFactura | null> {
    const fila = await this.tx.factura.findFirst({
      where: { reservaId, tipo: TipoFacturaPrisma[tipo] },
    });
    return fila === null ? null : aBorradorFactura(fila);
  }

  async crear(params: CrearBorradorParams): Promise<BorradorFactura> {
    const fila = await this.tx.factura.create({
      data: {
        tenantId: params.tenantId,
        reservaId: params.reservaId,
        numeroFactura: null,
        tipo: TipoFacturaPrisma[params.tipo],
        estado: EstadoFacturaPrisma.borrador,
        total: new Prisma.Decimal(params.total),
        baseImponible: new Prisma.Decimal(params.baseImponible),
        ivaPorcentaje: new Prisma.Decimal(params.ivaPorcentaje),
        ivaImporte: new Prisma.Decimal(params.ivaImporte),
        concepto: params.concepto,
      },
    });
    return aBorradorFactura(fila);
  }
}

/** Repositorio tx-bound de AUDIT_LOG de los borradores (`accion='crear'`). */
export class AuditoriaBorradorPrismaRepository implements AuditoriaBorradorPort {
  constructor(private readonly tx: Prisma.TransactionClient) {}

  async registrar(registro: RegistroAuditoriaBorrador): Promise<void> {
    await this.tx.auditLog.create({
      data: {
        tenantId: registro.tenantId,
        entidad: registro.entidad,
        entidadId: registro.entidadId,
        accion: AccionAudit.crear,
        datosNuevos: (registro.datosNuevos ?? null) as Prisma.InputJsonValue,
      },
    });
  }
}
