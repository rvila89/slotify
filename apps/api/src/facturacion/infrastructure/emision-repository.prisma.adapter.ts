/**
 * Repositorios Prisma tx-bound de la EMISIÓN de la liquidación (fix-liquidacion-fianza-
 * independientes / UC-21), flujo standalone espejo de la señal.
 *
 * Implementan los puertos de `EnviarFacturaLiquidacionUseCase` sobre el cliente transaccional
 * (`Prisma.TransactionClient`) que la unidad de trabajo abre bajo el contexto RLS. La
 * numeración se apoya en `UNIQUE(tenant_id, numero_factura)` (reintento ante `P2002` en el
 * use-case; nunca locks distribuidos). Toda consulta filtra por tenant vía RLS. Los Decimal se
 * mapean a string de 2 decimales. E4 = SOLO liquidación: NO toca la fianza.
 */
import {
  AccionAudit,
  EstadoFactura as EstadoFacturaPrisma,
  Prisma,
  LiquidacionStatus as LiquidacionStatusPrisma,
  TipoFactura as TipoFacturaPrisma,
  CodigoEmail as CodigoEmailPrisma,
  EstadoComunicacion as EstadoComunicacionPrisma,
} from '@prisma/client';
import { prefijoNumeroFactura } from '../domain/numeracion-factura';
import type {
  AuditoriaLiquidacionEmisionPort,
  ComunicacionesLiquidacionEmisionPort,
  EmitirFacturaLiquidacionParams,
  ExtrasLiquidacionEmisionPort,
  FacturaLiquidacionEmitible,
  FacturasLiquidacionEmisionPort,
  RegistroAuditoriaLiquidacionEmision,
  ReservasLiquidacionEmisionPort,
} from '../application/enviar-factura-liquidacion.use-case';
import type { EstadoFactura, TipoFactura } from '../domain/factura';

/** Fila cruda del MAX(numero_factura) del tenant en el año. */
interface FilaUltimoNumero {
  numero_factura: string | null;
}

/** Mapea una fila FACTURA de Prisma a la proyección `FacturaLiquidacionEmitible`. */
const aFacturaEmitible = (fila: {
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
}): FacturaLiquidacionEmitible => ({
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

/** Repositorio tx-bound de FACTURA (emisión + numeración). */
export class FacturaLiquidacionEmisionPrismaRepository
  implements FacturasLiquidacionEmisionPort
{
  constructor(private readonly tx: Prisma.TransactionClient) {}

  async buscarPorReservaYTipo(
    reservaId: string,
    tipo: 'liquidacion',
  ): Promise<FacturaLiquidacionEmitible | null> {
    const fila = await this.tx.factura.findFirst({
      where: { reservaId, tipo: TipoFacturaPrisma[tipo] },
    });
    return fila === null ? null : aFacturaEmitible(fila);
  }

  /** Último `numero_factura` del tenant en el año (máximo de la secuencia). */
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

  /** Transición borrador → enviada con numeración, fecha_emision y desglose. */
  async emitir(params: EmitirFacturaLiquidacionParams): Promise<void> {
    await this.tx.factura.update({
      where: { idFactura: params.idFactura },
      data: {
        numeroFactura: params.numeroFactura,
        estado: EstadoFacturaPrisma.enviada,
        fechaEmision: params.fechaEmision,
        total: new Prisma.Decimal(params.total),
        baseImponible: new Prisma.Decimal(params.baseImponible),
        ivaPorcentaje: new Prisma.Decimal(params.ivaPorcentaje),
        ivaImporte: new Prisma.Decimal(params.ivaImporte),
      },
    });
  }
}

/** Repositorio tx-bound de la RESERVA (avance del sub-proceso de liquidación). */
export class ReservaLiquidacionEmisionPrismaRepository
  implements ReservasLiquidacionEmisionPort
{
  constructor(private readonly tx: Prisma.TransactionClient) {}

  async avanzarLiquidacionStatus(params: {
    reservaId: string;
    estado: 'facturada';
  }): Promise<void> {
    await this.tx.reserva.update({
      where: { idReserva: params.reservaId },
      data: { liquidacionStatus: LiquidacionStatusPrisma.facturada },
    });
  }
}

/** Repositorio tx-bound de RESERVA_EXTRA (marcado con el factura_id de la liquidación). */
export class ExtraLiquidacionEmisionPrismaRepository
  implements ExtrasLiquidacionEmisionPort
{
  constructor(private readonly tx: Prisma.TransactionClient) {}

  async marcarConFactura(params: { reservaId: string; facturaId: string }): Promise<void> {
    await this.tx.reservaExtra.updateMany({
      where: { reservaId: params.reservaId, facturaId: null },
      data: { facturaId: params.facturaId },
    });
  }
}

/** Repositorio tx-bound de COMUNICACION (E4). */
export class ComunicacionLiquidacionEmisionPrismaRepository
  implements ComunicacionesLiquidacionEmisionPort
{
  constructor(private readonly tx: Prisma.TransactionClient) {}

  async crear(params: {
    tenantId: string;
    reservaId: string;
    clienteId: string;
    codigoEmail: 'E4';
    estado: 'enviado';
    fechaEnvio: Date;
    destinatarioEmail: string;
  }): Promise<{ idComunicacion: string; estado: string; fechaEnvio: Date | null }> {
    const fila = await this.tx.comunicacion.create({
      data: {
        tenantId: params.tenantId,
        reservaId: params.reservaId,
        clienteId: params.clienteId,
        codigoEmail: CodigoEmailPrisma.E4,
        asunto: 'Factura de liquidación',
        cuerpo: null,
        destinatarioEmail: params.destinatarioEmail,
        estado: EstadoComunicacionPrisma.enviado,
        fechaEnvio: params.fechaEnvio,
      },
      select: { idComunicacion: true, estado: true, fechaEnvio: true },
    });
    return {
      idComunicacion: fila.idComunicacion,
      estado: fila.estado,
      fechaEnvio: fila.fechaEnvio,
    };
  }
}

/** Repositorio tx-bound de AUDIT_LOG de la emisión (`accion='actualizar'`/`'crear'`). */
export class AuditoriaLiquidacionEmisionPrismaRepository
  implements AuditoriaLiquidacionEmisionPort
{
  constructor(private readonly tx: Prisma.TransactionClient) {}

  async registrar(registro: RegistroAuditoriaLiquidacionEmision): Promise<void> {
    await this.tx.auditLog.create({
      data: {
        tenantId: registro.tenantId,
        entidad: registro.entidad,
        entidadId: registro.entidadId,
        accion:
          registro.accion === 'crear' ? AccionAudit.crear : AccionAudit.actualizar,
        datosAnteriores: (registro.datosAnteriores ?? null) as Prisma.InputJsonValue,
        datosNuevos: (registro.usuarioId
          ? { ...(registro.datosNuevos ?? {}), usuarioId: registro.usuarioId }
          : (registro.datosNuevos ?? null)) as Prisma.InputJsonValue,
      },
    });
  }
}
