/**
 * Adaptador Prisma del puerto `ColaQueryPort` (US-041 / UC-31, §D-2).
 *
 * Lectura PURA: ¿hay alguna RESERVA en sub-estado `s2d` (en cola) apuntando a la
 * reserva liberada (`consulta_bloqueante_id`)? Determina si la liberación debe
 * disparar el seam de promoción. Fija el contexto RLS dentro de la transacción.
 */
import { Injectable } from '@nestjs/common';
import { SubEstadoConsulta } from '@prisma/client';
import { PrismaService } from '../../shared/prisma/prisma.service';
import { ColaQueryPort } from '../domain/liberar-fecha.service';

@Injectable()
export class ColaQueryPrismaAdapter implements ColaQueryPort {
  constructor(private readonly prisma: PrismaService) {}

  async hayColaActiva(params: {
    reservaBloqueanteId: string;
    tenantId?: string;
  }): Promise<boolean> {
    const { reservaBloqueanteId, tenantId } = params;
    const total = await this.prisma.$transaction(async (tx) => {
      if (tenantId) {
        await this.prisma.fijarTenant(tx, tenantId);
      }
      return tx.reserva.count({
        where: {
          ...(tenantId ? { tenantId } : {}),
          subEstado: SubEstadoConsulta.s2d,
          consultaBloqueanteId: reservaBloqueanteId,
        },
      });
    });
    return total > 0;
  }
}
