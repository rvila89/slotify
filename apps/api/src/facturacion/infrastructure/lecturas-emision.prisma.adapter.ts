/**
 * Adaptadores Prisma de LECTURA de la EMISIÓN (US-028 / UC-21, UC-22).
 *
 * Cargan la RESERVA (con el email del cliente) y la FACTURA de liquidación fuera de la tx
 * crítica, cada una en su propio `$transaction` + `fijarTenant` (RLS): cross-tenant → null
 * (invisible por RLS). Los Decimal se mapean a string de 2 decimales.
 */
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../shared/prisma/prisma.service';
import type {
  CargarReservaEmisionPort,
  ReservaEmision,
} from '../application/aprobar-y-enviar-liquidacion.use-case';
import type {
  CargarReservaFianzaPort,
  ReservaFianza,
} from '../application/enviar-recibo-fianza-separado.use-case';
import type {
  CargarLiquidacionReenvioPort,
  CargarReservaReenvioPort,
  FacturaEmitida,
  ReservaReenvio,
} from '../application/reenviar-liquidacion.use-case';

/** Carga la RESERVA para la emisión (email del cliente incluido). */
@Injectable()
export class CargarReservaEmisionPrismaAdapter {
  constructor(private readonly prisma: PrismaService) {}

  readonly cargar: CargarReservaEmisionPort = async (params) => {
    const fila = await this.prisma.$transaction(async (tx) => {
      await this.prisma.fijarTenant(tx, params.tenantId);
      return tx.reserva.findFirst({
        where: { idReserva: params.reservaId, tenantId: params.tenantId },
        select: {
          idReserva: true,
          tenantId: true,
          clienteId: true,
          codigo: true,
          liquidacionStatus: true,
          fianzaStatus: true,
          importeLiquidacion: true,
          cliente: { select: { email: true } },
        },
      });
    });
    if (fila === null) {
      return null;
    }
    const reserva: ReservaEmision = {
      idReserva: fila.idReserva,
      tenantId: fila.tenantId,
      clienteId: fila.clienteId,
      codigo: fila.codigo,
      liquidacionStatus: fila.liquidacionStatus,
      fianzaStatus: fila.fianzaStatus,
      importeLiquidacion:
        fila.importeLiquidacion === null ? '0.00' : fila.importeLiquidacion.toFixed(2),
      clienteEmail: fila.cliente.email ?? '',
    };
    return reserva;
  };
}

/** Carga la RESERVA para el envío separado del recibo de fianza. */
@Injectable()
export class CargarReservaFianzaPrismaAdapter {
  constructor(private readonly prisma: PrismaService) {}

  readonly cargar: CargarReservaFianzaPort = async (params) => {
    const fila = await this.prisma.$transaction(async (tx) => {
      await this.prisma.fijarTenant(tx, params.tenantId);
      return tx.reserva.findFirst({
        where: { idReserva: params.reservaId, tenantId: params.tenantId },
        select: {
          idReserva: true,
          tenantId: true,
          clienteId: true,
          codigo: true,
          liquidacionStatus: true,
          fianzaStatus: true,
          cliente: { select: { email: true } },
        },
      });
    });
    if (fila === null) {
      return null;
    }
    const reserva: ReservaFianza = {
      idReserva: fila.idReserva,
      tenantId: fila.tenantId,
      clienteId: fila.clienteId,
      codigo: fila.codigo,
      liquidacionStatus: fila.liquidacionStatus,
      fianzaStatus: fila.fianzaStatus,
      clienteEmail: fila.cliente.email ?? '',
    };
    return reserva;
  };
}

/** Carga la RESERVA para el reenvío. */
@Injectable()
export class CargarReservaReenvioPrismaAdapter {
  constructor(private readonly prisma: PrismaService) {}

  readonly cargar: CargarReservaReenvioPort = async (params) => {
    const fila = await this.prisma.$transaction(async (tx) => {
      await this.prisma.fijarTenant(tx, params.tenantId);
      return tx.reserva.findFirst({
        where: { idReserva: params.reservaId, tenantId: params.tenantId },
        select: {
          idReserva: true,
          tenantId: true,
          clienteId: true,
          codigo: true,
          liquidacionStatus: true,
          fianzaStatus: true,
          cliente: { select: { email: true } },
        },
      });
    });
    if (fila === null) {
      return null;
    }
    const reserva: ReservaReenvio = {
      idReserva: fila.idReserva,
      tenantId: fila.tenantId,
      clienteId: fila.clienteId,
      codigo: fila.codigo,
      liquidacionStatus: fila.liquidacionStatus,
      fianzaStatus: fila.fianzaStatus,
      clienteEmail: fila.cliente.email ?? '',
    };
    return reserva;
  };
}

/** Carga la FACTURA de liquidación de una reserva (para el reenvío). */
@Injectable()
export class CargarLiquidacionReenvioPrismaAdapter {
  constructor(private readonly prisma: PrismaService) {}

  readonly cargar: CargarLiquidacionReenvioPort = async (params) => {
    const fila = await this.prisma.$transaction(async (tx) => {
      await this.prisma.fijarTenant(tx, params.tenantId);
      return tx.factura.findFirst({
        where: { reservaId: params.reservaId, tipo: 'liquidacion' },
        select: {
          idFactura: true,
          tenantId: true,
          reservaId: true,
          numeroFactura: true,
          tipo: true,
          estado: true,
          total: true,
          pdfUrl: true,
          fechaEmision: true,
        },
      });
    });
    if (fila === null) {
      return null;
    }
    const liquidacion: FacturaEmitida = {
      idFactura: fila.idFactura,
      tenantId: fila.tenantId,
      reservaId: fila.reservaId,
      numeroFactura: fila.numeroFactura,
      tipo: 'liquidacion',
      estado: fila.estado as 'borrador' | 'enviada' | 'cobrada',
      total: fila.total.toFixed(2),
      pdfUrl: fila.pdfUrl,
      fechaEmision: fila.fechaEmision,
    };
    return liquidacion;
  };
}
