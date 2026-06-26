/**
 * Adaptador Prisma del puerto `TarifaRepositoryPort`.
 *
 * Busca la fila de TARIFA vigente por temporada × duración × tramo de invitados
 * en la fecha del evento. Lectura pura, filtrada por `tenant_id` bajo RLS. El
 * importe `precio_total_eur` es `Decimal` en BD (convención del proyecto) y se
 * expone al dominio como `number` en EUR (céntimos, IVA 21% incluido).
 */
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../shared/prisma/prisma.service';
import {
  TarifaRepositoryPort,
  Temporada,
} from '../domain/calculadora-tarifa.service';

@Injectable()
export class TarifaPrismaAdapter implements TarifaRepositoryPort {
  constructor(private readonly prisma: PrismaService) {}

  async buscarVigente(params: {
    tenantId: string;
    temporada: Temporada;
    duracionHoras: number;
    numInvitados: number;
    fechaEvento: Date;
  }): Promise<{ idTarifa: string; precioTotalEur: number } | null> {
    const { tenantId, temporada, duracionHoras, numInvitados, fechaEvento } = params;
    const fila = await this.prisma.$transaction(async (tx) => {
      await this.prisma.fijarTenant(tx, tenantId);
      return tx.tarifa.findFirst({
        where: {
          tenantId,
          temporada,
          duracionHoras,
          invitadosMin: { lte: numInvitados },
          invitadosMax: { gte: numInvitados },
          activo: true,
          vigenteDesde: { lte: fechaEvento },
          OR: [{ vigenteHasta: null }, { vigenteHasta: { gte: fechaEvento } }],
        },
        orderBy: { vigenteDesde: 'desc' },
        select: { idTarifa: true, precioTotalEur: true },
      });
    });
    return fila
      ? { idTarifa: fila.idTarifa, precioTotalEur: fila.precioTotalEur.toNumber() }
      : null;
  }
}
