/**
 * Repositorios Prisma tx-bound del envío SEPARADO del recibo de fianza (US-028 / UC-22, D-3).
 *
 * Implementan los puertos de `EnviarReciboFianzaSeparadoUseCase` sobre el cliente
 * transaccional bajo contexto RLS. La COMUNICACION se registra con `codigo_email='manual'`
 * (NO E4). La emisión de la fianza no recalcula desglose (el recibo es inmutable): solo
 * transita a `enviada` con su `numero_factura` propio y `fecha_emision`.
 */
import {
  AccionAudit,
  EstadoFactura as EstadoFacturaPrisma,
  Prisma,
  FianzaStatus as FianzaStatusPrisma,
  TipoFactura as TipoFacturaPrisma,
  CodigoEmail as CodigoEmailPrisma,
  EstadoComunicacion as EstadoComunicacionPrisma,
} from '@prisma/client';
import { prefijoNumeroFactura } from '../domain/numeracion-factura';
import type {
  AuditoriaFianzaPort,
  ComunicacionesFianzaPort,
  EmitirFianzaParams,
  FacturaFianzaEmitible,
  FacturasFianzaPort,
  ReservasFianzaPort,
} from '../application/enviar-recibo-fianza-separado.use-case';
import type { EstadoFactura, TipoFactura } from '../domain/factura';

interface FilaUltimoNumero {
  numero_factura: string | null;
}

const aFacturaFianza = (fila: {
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
}): FacturaFianzaEmitible => ({
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

export class FacturaFianzaPrismaRepository implements FacturasFianzaPort {
  constructor(private readonly tx: Prisma.TransactionClient) {}

  async buscarPorReservaYTipo(
    reservaId: string,
    tipo: 'liquidacion' | 'fianza',
  ): Promise<FacturaFianzaEmitible | null> {
    const fila = await this.tx.factura.findFirst({
      where: { reservaId, tipo: TipoFacturaPrisma[tipo] },
    });
    return fila === null ? null : aFacturaFianza(fila);
  }

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

  async emitir(params: EmitirFianzaParams): Promise<void> {
    await this.tx.factura.update({
      where: { idFactura: params.idFactura },
      data: {
        numeroFactura: params.numeroFactura,
        estado: EstadoFacturaPrisma.enviada,
        fechaEmision: params.fechaEmision,
      },
    });
  }
}

export class ReservaFianzaPrismaRepository implements ReservasFianzaPort {
  constructor(private readonly tx: Prisma.TransactionClient) {}

  async avanzarFianzaStatus(params: {
    reservaId: string;
    estado: 'recibo_enviado';
  }): Promise<void> {
    await this.tx.reserva.update({
      where: { idReserva: params.reservaId },
      data: { fianzaStatus: FianzaStatusPrisma.recibo_enviado },
    });
  }

  // Presente por contrato del puerto; el envío separado NO avanza liquidacion_status.
  async avanzarLiquidacionStatus(): Promise<void> {
    return undefined;
  }
}

export class ComunicacionFianzaPrismaRepository implements ComunicacionesFianzaPort {
  constructor(private readonly tx: Prisma.TransactionClient) {}

  async crear(params: {
    tenantId: string;
    reservaId: string;
    clienteId: string;
    codigoEmail: 'manual';
    estado: 'enviado';
    fechaEnvio: Date;
    destinatarioEmail: string;
  }): Promise<{ idComunicacion: string; estado: string; fechaEnvio: Date | null }> {
    const fila = await this.tx.comunicacion.create({
      data: {
        tenantId: params.tenantId,
        reservaId: params.reservaId,
        clienteId: params.clienteId,
        codigoEmail: CodigoEmailPrisma.manual,
        asunto: 'Recibo de fianza',
        cuerpo: null,
        destinatarioEmail: params.destinatarioEmail,
        estado: EstadoComunicacionPrisma.enviado,
        fechaEnvio: params.fechaEnvio,
      },
      select: { idComunicacion: true, estado: true, fechaEnvio: true },
    });
    return { idComunicacion: fila.idComunicacion, estado: fila.estado, fechaEnvio: fila.fechaEnvio };
  }
}

export class AuditoriaFianzaPrismaRepository implements AuditoriaFianzaPort {
  constructor(private readonly tx: Prisma.TransactionClient) {}

  async registrar(registro: {
    tenantId: string;
    usuarioId?: string | null;
    entidad: 'FACTURA' | 'RESERVA' | 'COMUNICACION';
    entidadId: string;
    accion: 'actualizar' | 'crear';
    datosAnteriores?: Record<string, unknown> | null;
    datosNuevos?: Record<string, unknown> | null;
  }): Promise<void> {
    await this.tx.auditLog.create({
      data: {
        tenantId: registro.tenantId,
        // El actor se conserva en `datos_nuevos.usuarioId` (no se fuerza el FK usuario_id).
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
