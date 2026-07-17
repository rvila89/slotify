/**
 * Adaptador Prisma del puerto `CargarReservaDocumentacionEventoPort` (US-033).
 *
 * Lee la RESERVA por id bajo el contexto RLS del tenant (cross-tenant → null → 404). Se usa
 * FUERA de la transacción crítica para la guarda de estado (existencia + `evento_en_curso`)
 * sin efectos. Proyecta solo `estado` + tenant. Hexagonal: solo `@Injectable` como acople de
 * framework.
 */
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../shared/prisma/prisma.service';
import type {
  CargarReservaDocumentacionEventoPort,
  ReservaDocumentacionEvento,
} from '../application/subir-documento-evento.use-case';
import type { EstadoReserva } from '../../reservas/domain/maquina-estados';

@Injectable()
export class CargarReservaDocumentacionEventoPrismaAdapter {
  constructor(private readonly prisma: PrismaService) {}

  readonly cargar: CargarReservaDocumentacionEventoPort = async (params) => {
    const fila = await this.prisma.$transaction(async (tx) => {
      await this.prisma.fijarTenant(tx, params.tenantId);
      return tx.reserva.findFirst({
        where: { idReserva: params.reservaId, tenantId: params.tenantId },
        select: { idReserva: true, tenantId: true, estado: true },
      });
    });
    if (fila === null) {
      return null;
    }
    const reserva: ReservaDocumentacionEvento = {
      idReserva: fila.idReserva,
      tenantId: fila.tenantId,
      estado: fila.estado as EstadoReserva,
    };
    return reserva;
  };
}
