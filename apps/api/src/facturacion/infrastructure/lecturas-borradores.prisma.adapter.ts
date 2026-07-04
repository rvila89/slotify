/**
 * Adaptadores Prisma de LECTURA de los BORRADORES de liquidación y fianza (US-027 / UC-21,
 * UC-22).
 *
 * Cada lectura abre su propio `$transaction` + `fijarTenant` (RLS): la RESERVA liquidable
 * (origen + `importe_liquidacion` congelado + estados de sub-procesos), los RESERVA_EXTRA
 * pendientes (`factura_id IS NULL`, design.md §D-2) y el `fianza_default_eur` del tenant
 * (§D-3). Cross-tenant → null/vacío (invisible por RLS). Los Decimal se mapean a string de 2
 * decimales.
 */
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../shared/prisma/prisma.service';
import type {
  CargarExtrasPendientesPort,
  CargarFianzaDefaultPort,
  CargarReservaLiquidablePort,
  ExtraPendiente,
  ReservaLiquidable,
} from '../application/generar-borradores-liquidacion-fianza.use-case';

/** Lectura de la RESERVA liquidable (origen + importe de liquidación congelado). */
@Injectable()
export class CargarReservaLiquidablePrismaAdapter {
  constructor(private readonly prisma: PrismaService) {}

  readonly cargar: CargarReservaLiquidablePort = async (params) => {
    const fila = await this.prisma.$transaction(async (tx) => {
      await this.prisma.fijarTenant(tx, params.tenantId);
      return tx.reserva.findFirst({
        where: { idReserva: params.reservaId, tenantId: params.tenantId },
        select: {
          idReserva: true,
          tenantId: true,
          codigo: true,
          estado: true,
          liquidacionStatus: true,
          fianzaStatus: true,
          importeLiquidacion: true,
        },
      });
    });
    if (fila === null) {
      return null;
    }
    const reserva: ReservaLiquidable = {
      idReserva: fila.idReserva,
      tenantId: fila.tenantId,
      codigo: fila.codigo,
      estado: fila.estado,
      liquidacionStatus: fila.liquidacionStatus,
      fianzaStatus: fila.fianzaStatus,
      importeLiquidacion:
        fila.importeLiquidacion === null ? '0.00' : fila.importeLiquidacion.toFixed(2),
    };
    return reserva;
  };
}

/** Lectura de los RESERVA_EXTRA pendientes de la reserva (filtra `factura_id IS NULL`). */
@Injectable()
export class CargarExtrasPendientesPrismaAdapter {
  constructor(private readonly prisma: PrismaService) {}

  readonly cargar: CargarExtrasPendientesPort = async (params) => {
    const filas = await this.prisma.$transaction(async (tx) => {
      await this.prisma.fijarTenant(tx, params.tenantId);
      return tx.reservaExtra.findMany({
        where: { reservaId: params.reservaId, facturaId: null },
        select: { subtotal: true },
      });
    });
    const extras: ReadonlyArray<ExtraPendiente> = filas.map((f) => ({
      subtotal: f.subtotal.toFixed(2),
    }));
    return extras;
  };
}

/** Lectura del importe de fianza por defecto del tenant (TENANT_SETTINGS.fianza_default_eur). */
@Injectable()
export class CargarFianzaDefaultPrismaAdapter {
  constructor(private readonly prisma: PrismaService) {}

  readonly cargar: CargarFianzaDefaultPort = async (params) => {
    const fila = await this.prisma.$transaction(async (tx) => {
      await this.prisma.fijarTenant(tx, params.tenantId);
      return tx.tenantSettings.findFirst({
        where: { tenantId: params.tenantId },
        select: { fianzaDefaultEur: true },
      });
    });
    return fila === null ? '0.00' : fila.fianzaDefaultEur.toFixed(2);
  };
}
