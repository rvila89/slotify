/**
 * Adaptador Prisma del puerto `CargarReservaConfirmacionPort` (US-021).
 *
 * Lee la RESERVA por id bajo el contexto RLS del tenant (cross-tenant → null → 404).
 * Se usa FUERA de la transacción crítica para las guardas previas (existencia, origen,
 * importe_total) sin efectos. Mapea el enum Prisma `SubEstadoConsulta` (`s2a`) al valor
 * de dominio (`2a`) y el `importe_total` Decimal a string (2 decimales).
 */
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../shared/prisma/prisma.service';
import type {
  CargarReservaConfirmacionPort,
  ReservaConfirmacion,
} from '../application/confirmar-pago-senal.use-case';
import type { EstadoReserva } from '../../reservas/domain/maquina-estados';
import {
  subEstadoPrismaADominio,
  type SubEstadoConsultaPrisma,
} from '../../reservas/infrastructure/sub-estado-consulta.mapper';

@Injectable()
export class CargarReservaConfirmacionPrismaAdapter {
  constructor(private readonly prisma: PrismaService) {}

  readonly cargar: CargarReservaConfirmacionPort = async (params) => {
    const fila = await this.prisma.$transaction(async (tx) => {
      await this.prisma.fijarTenant(tx, params.tenantId);
      return tx.reserva.findFirst({
        where: { idReserva: params.reservaId, tenantId: params.tenantId },
      });
    });
    if (fila === null) {
      return null;
    }
    const reserva: ReservaConfirmacion = {
      idReserva: fila.idReserva,
      tenantId: fila.tenantId,
      estado: fila.estado as EstadoReserva,
      subEstado:
        fila.subEstado === null
          ? null
          : subEstadoPrismaADominio(fila.subEstado as SubEstadoConsultaPrisma),
      fechaEvento: fila.fechaEvento,
      importeTotal: fila.importeTotal === null ? null : fila.importeTotal.toFixed(2),
      comentarios: fila.comentarios,
    };
    return reserva;
  };
}
