/**
 * Adaptador Prisma de LECTURA de la colección de FACTURA de una RESERVA (US-027 / UC-21,
 * UC-22) — `GET /reservas/{id}/facturas`.
 *
 * Abre su propio `$transaction` + `fijarTenant` (RLS). Primero comprueba la existencia de la
 * RESERVA en el tenant (para distinguir 404 de colección vacía) y luego lee sus FACTURA
 * (opcionalmente filtradas por `tipo`), ordenadas por fecha de creación. Cross-tenant → null
 * (reserva invisible por RLS → 404). Los Decimal se mapean a string de 2 decimales.
 */
import { Injectable } from '@nestjs/common';
import { TipoFactura as TipoFacturaPrisma } from '@prisma/client';
import { PrismaService } from '../../shared/prisma/prisma.service';
import type {
  FacturaListada,
  ListarFacturasReservaPort,
} from '../application/listar-facturas-reserva.use-case';

@Injectable()
export class ListarFacturasReservaPrismaAdapter {
  constructor(private readonly prisma: PrismaService) {}

  readonly listar: ListarFacturasReservaPort = async (params) => {
    return this.prisma.$transaction(async (tx) => {
      await this.prisma.fijarTenant(tx, params.tenantId);
      const reserva = await tx.reserva.findFirst({
        where: { idReserva: params.reservaId, tenantId: params.tenantId },
        select: { idReserva: true },
      });
      if (reserva === null) {
        return null;
      }
      const filas = await tx.factura.findMany({
        where: {
          reservaId: params.reservaId,
          tenantId: params.tenantId,
          ...(params.tipo === undefined
            ? {}
            : { tipo: TipoFacturaPrisma[params.tipo] }),
        },
        orderBy: { fechaCreacion: 'asc' },
      });
      const facturas: ReadonlyArray<FacturaListada> = filas.map((fila) => ({
        idFactura: fila.idFactura,
        reservaId: fila.reservaId,
        numeroFactura: fila.numeroFactura,
        tipo: fila.tipo as FacturaListada['tipo'],
        baseImponible: fila.baseImponible.toFixed(2),
        ivaPorcentaje: fila.ivaPorcentaje.toFixed(2),
        ivaImporte: fila.ivaImporte.toFixed(2),
        total: fila.total.toFixed(2),
        concepto: fila.concepto,
        pdfUrl: fila.pdfUrl,
        estado: fila.estado as FacturaListada['estado'],
        fechaEmision: fila.fechaEmision,
        fechaCreacion: fila.fechaCreacion,
      }));
      return facturas;
    });
  };
}
