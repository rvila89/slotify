/**
 * Repositorios Prisma tx-bound de la capability `facturacion` (US-022 / UC-18).
 *
 * Implementan los puertos de `GenerarFacturaSenalUseCase` sobre el cliente transaccional
 * (`Prisma.TransactionClient`) que la unidad de trabajo abre bajo el contexto RLS. Toda
 * consulta filtra por `tenant_id`; la numeración se apoya en `UNIQUE(tenant_id,
 * numero_factura)` (design.md §D-3/§D-8), la idempotencia en `UNIQUE(reserva_id, tipo)`
 * (§D-4). Los importes Decimal se mapean a string de 2 (importes) / 2 (IVA) decimales.
 */
import {
  AccionAudit,
  EstadoFactura as EstadoFacturaPrisma,
  Prisma,
  TipoFactura as TipoFacturaPrisma,
} from '@prisma/client';
import type {
  AuditoriaFacturacionPort,
  CrearFacturaParams,
  FacturaRepositoryPort,
  FacturaSenal,
  RegistroAuditoriaFacturacion,
} from '../application/generar-factura-senal.use-case';
import { prefijoNumeroFactura } from '../domain/numeracion-factura';
import type { EstadoFactura, TipoFactura } from '../domain/factura';

/** Fila cruda del MAX(numero_factura) del tenant en el año. */
interface FilaUltimoNumero {
  numero_factura: string | null;
}

/** Mapea una fila FACTURA de Prisma a la proyección de dominio `FacturaSenal`. */
export const aFacturaSenal = (fila: {
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
  pdfUrl: string | null;
  fechaEmision: Date | null;
}): FacturaSenal => ({
  idFactura: fila.idFactura,
  tenantId: fila.tenantId,
  reservaId: fila.reservaId,
  numeroFactura: fila.numeroFactura,
  tipo: fila.tipo as TipoFactura,
  estado: fila.estado as EstadoFactura,
  total: fila.total.toFixed(2),
  baseImponible: fila.baseImponible.toFixed(2),
  ivaPorcentaje: fila.ivaPorcentaje.toFixed(2),
  ivaImporte: fila.ivaImporte.toFixed(2),
  pdfUrl: fila.pdfUrl,
  fechaEmision: fila.fechaEmision,
});

/** Repositorio tx-bound de FACTURA. */
export class FacturaPrismaRepository implements FacturaRepositoryPort {
  constructor(private readonly tx: Prisma.TransactionClient) {}

  async buscarPorReservaYTipo(
    reservaId: string,
    tipo: 'senal',
  ): Promise<FacturaSenal | null> {
    const fila = await this.tx.factura.findFirst({
      where: { reservaId, tipo: TipoFacturaPrisma[tipo] },
    });
    return fila === null ? null : aFacturaSenal(fila);
  }

  /**
   * Último `numero_factura` del tenant en el año (MAX lexicográfico del literal
   * `F-{año}-NNNN` con padding fijo, equivalente al máximo numérico de la secuencia).
   */
  async ultimoNumeroDelAnio(tenantId: string, anio: number): Promise<string | null> {
    const prefijo = `${prefijoNumeroFactura(anio)}%`;
    const filas = await this.tx.$queryRaw<FilaUltimoNumero[]>(Prisma.sql`
      SELECT numero_factura
      FROM factura
      WHERE tenant_id = ${tenantId} AND numero_factura LIKE ${prefijo}
      ORDER BY LENGTH(numero_factura) DESC, numero_factura DESC
      LIMIT 1
    `);
    return filas.length === 0 ? null : filas[0].numero_factura;
  }

  async crear(params: CrearFacturaParams): Promise<FacturaSenal> {
    const fila = await this.tx.factura.create({
      data: {
        tenantId: params.tenantId,
        reservaId: params.reservaId,
        numeroFactura: params.numeroFactura,
        tipo: TipoFacturaPrisma.senal,
        estado: EstadoFacturaPrisma.borrador,
        total: new Prisma.Decimal(params.total),
        baseImponible: new Prisma.Decimal(params.baseImponible),
        ivaPorcentaje: new Prisma.Decimal(params.ivaPorcentaje),
        ivaImporte: new Prisma.Decimal(params.ivaImporte),
        concepto: params.concepto,
      },
    });
    return aFacturaSenal(fila);
  }

  async guardarPdfUrl(idFactura: string, pdfUrl: string): Promise<void> {
    await this.tx.factura.update({
      where: { idFactura },
      data: { pdfUrl },
    });
  }
}

/** Repositorio tx-bound de AUDIT_LOG de facturación. */
export class AuditoriaFacturacionPrismaRepository implements AuditoriaFacturacionPort {
  constructor(private readonly tx: Prisma.TransactionClient) {}

  async registrar(registro: RegistroAuditoriaFacturacion): Promise<void> {
    await this.tx.auditLog.create({
      data: {
        tenantId: registro.tenantId,
        entidad: registro.entidad,
        entidadId: registro.entidadId,
        accion: AccionAudit[registro.accion === 'crear' ? 'crear' : 'actualizar'],
        datosAnteriores: (registro.datosAnteriores ?? null) as Prisma.InputJsonValue,
        datosNuevos: this.datosNuevosConMotivo(registro) as Prisma.InputJsonValue,
      },
    });
  }

  /** Anexa el motivo (idempotencia/rechazo) a `datos_nuevos` para no perder el detalle. */
  private datosNuevosConMotivo(
    registro: RegistroAuditoriaFacturacion,
  ): Record<string, unknown> {
    const base = registro.datosNuevos ?? {};
    return registro.motivo ? { ...base, motivo: registro.motivo } : base;
  }
}
