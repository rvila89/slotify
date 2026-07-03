/**
 * Adaptador Prisma del puerto `CargarReservaPort` (US-014).
 *
 * Lee la RESERVA por id bajo el contexto RLS del tenant (cross-tenant → null → 404).
 * Se usa FUERA de la transacción crítica para las guardas previas (existencia, origen,
 * datos fiscales) sin efectos. Mapea el enum Prisma `SubEstadoConsulta` (`s2a`) al valor
 * de dominio (`2a`) y la `DuracionHoras` (`h8` → `8`).
 */
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../shared/prisma/prisma.service';
import type {
  CargarReservaPort,
  ReservaPresupuesto,
} from '../application/generar-presupuesto.use-case';
import type { EstadoReserva } from '../../reservas/domain/maquina-estados';
import { duracionHorasPrismaANumero } from '../../reservas/infrastructure/duracion-horas.mapper';
import {
  subEstadoPrismaADominio,
  type SubEstadoConsultaPrisma,
} from '../../reservas/infrastructure/sub-estado-consulta.mapper';

@Injectable()
export class CargarReservaPrismaAdapter {
  constructor(private readonly prisma: PrismaService) {}

  readonly cargar: CargarReservaPort = async (params) => {
    const fila = await this.prisma.$transaction(async (tx) => {
      await this.prisma.fijarTenant(tx, params.tenantId);
      return tx.reserva.findFirst({
        where: { idReserva: params.reservaId, tenantId: params.tenantId },
      });
    });
    if (fila === null) {
      return null;
    }
    const reserva: ReservaPresupuesto = {
      idReserva: fila.idReserva,
      tenantId: fila.tenantId,
      clienteId: fila.clienteId,
      estado: fila.estado as EstadoReserva,
      subEstado:
        fila.subEstado === null
          ? null
          : subEstadoPrismaADominio(fila.subEstado as SubEstadoConsultaPrisma),
      fechaEvento: fila.fechaEvento,
      duracionHoras: duracionHorasPrismaANumero(fila.duracionHoras),
      numAdultosNinosMayores4: fila.numAdultosNinosMayores4,
      numNinosMenores4: fila.numNinosMenores4,
      tipoEvento: fila.tipoEvento,
      ttlExpiracion: fila.ttlExpiracion,
    };
    return reserva;
  };
}
