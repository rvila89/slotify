/**
 * Adaptador Prisma del puerto `CargarReservaFirmaCondicionesPort` (US-024).
 *
 * Lee la RESERVA por id bajo el contexto RLS del tenant (cross-tenant → null → 404).
 * Se usa FUERA de la transacción crítica para las guardas de precondición (existencia,
 * E3 enviado, estado válido) sin efectos. Proyecta solo lo relevante para la firma:
 * `estado`, `cond_part_enviadas_fecha` y `cond_part_firmadas` (flag anterior para la
 * auditoría). Hexagonal: no importa dominio de framework más allá del `@Injectable`.
 */
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../shared/prisma/prisma.service';
import type {
  CargarReservaFirmaCondicionesPort,
  ReservaFirmaCondiciones,
} from '../application/registrar-firma-condiciones.use-case';
import type { EstadoReserva } from '../../reservas/domain/maquina-estados';

@Injectable()
export class CargarReservaFirmaCondicionesPrismaAdapter {
  constructor(private readonly prisma: PrismaService) {}

  readonly cargar: CargarReservaFirmaCondicionesPort = async (params) => {
    const fila = await this.prisma.$transaction(async (tx) => {
      await this.prisma.fijarTenant(tx, params.tenantId);
      return tx.reserva.findFirst({
        where: { idReserva: params.reservaId, tenantId: params.tenantId },
        select: {
          idReserva: true,
          tenantId: true,
          estado: true,
          condPartEnviadasFecha: true,
          condPartFirmadas: true,
        },
      });
    });
    if (fila === null) {
      return null;
    }
    const reserva: ReservaFirmaCondiciones = {
      idReserva: fila.idReserva,
      tenantId: fila.tenantId,
      estado: fila.estado as EstadoReserva,
      condPartEnviadasFecha: fila.condPartEnviadasFecha,
      condPartFirmadas: fila.condPartFirmadas,
    };
    return reserva;
  };
}
