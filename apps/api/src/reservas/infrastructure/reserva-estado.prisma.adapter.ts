/**
 * Adaptador Prisma del puerto `ReservaEstadoPort` (US-041 / UC-31).
 *
 * Lectura PURA del estado de la RESERVA para resolver la guarda firme (§D-5). No
 * muta nada: la liberación nunca escribe en la RESERVA (§D-7). Fija el contexto RLS
 * (`SET LOCAL app.tenant_id`) dentro de la transacción de lectura.
 */
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../shared/prisma/prisma.service';
import {
  EstadoReservaDominio,
  ReservaEstadoPort,
} from '../domain/liberar-fecha.service';

@Injectable()
export class ReservaEstadoPrismaAdapter implements ReservaEstadoPort {
  constructor(private readonly prisma: PrismaService) {}

  async obtenerEstado(params: {
    reservaId: string;
    tenantId?: string;
  }): Promise<EstadoReservaDominio | null> {
    const { reservaId, tenantId } = params;
    const fila = await this.prisma.$transaction(async (tx) => {
      if (tenantId) {
        await this.prisma.fijarTenant(tx, tenantId);
      }
      return tx.reserva.findFirst({
        where: tenantId ? { idReserva: reservaId, tenantId } : { idReserva: reservaId },
        select: { estado: true },
      });
    });
    return fila ? (fila.estado as EstadoReservaDominio) : null;
  }
}
