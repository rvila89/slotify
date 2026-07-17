/**
 * Adaptador de LECTURA de la RESERVA + su CLIENTE para el email manual del Gestor
 * (US-046 / UC-36).
 *
 * INFRAESTRUCTURA: carga la proyección `ReservaContexto` (`clienteId`, `clienteEmail`)
 * bajo el contexto RLS del tenant del JWT (`app.tenant_id` fijado en la transacción): una
 * RESERVA de otro tenant es INVISIBLE (→ `null` → 404). El `cliente_id` sale de la
 * relación de la RESERVA (nunca del body); el `tenant_id`, del JWT. Lectura previa al envío.
 */
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../shared/prisma/prisma.service';
import type {
  CargarReservaContextoParams,
  CargarReservaContextoPort,
  ReservaContexto,
} from '../application/crear-email-manual.use-case';

@Injectable()
export class CargarReservaContextoPrismaAdapter
  implements CargarReservaContextoPort
{
  constructor(private readonly prisma: PrismaService) {}

  async cargar(
    params: CargarReservaContextoParams,
  ): Promise<ReservaContexto | null> {
    return this.prisma.$transaction(async (tx) => {
      await this.prisma.fijarTenant(tx, params.tenantId);
      const fila = await tx.reserva.findFirst({
        where: { idReserva: params.reservaId, tenantId: params.tenantId },
        select: {
          idReserva: true,
          tenantId: true,
          clienteId: true,
          cliente: { select: { email: true } },
        },
      });
      if (fila === null) {
        return null;
      }
      return {
        idReserva: fila.idReserva,
        tenantId: fila.tenantId,
        clienteId: fila.clienteId,
        clienteEmail: fila.cliente.email,
      };
    });
  }
}
