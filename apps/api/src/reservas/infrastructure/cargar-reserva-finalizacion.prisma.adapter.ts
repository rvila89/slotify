/**
 * Adaptador de LECTURA de la RESERVA para la finalización del evento (US-034 / UC-25).
 *
 * Carga la proyección mínima de la RESERVA (`estado`, `sub_estado`, `cliente_id`,
 * `fianza_eur`, `fianza_status`) bajo el contexto RLS del tenant del Gestor: una RESERVA de
 * otro tenant es INVISIBLE (→ `null` → 404). La lectura es previa a la transacción de la
 * transición; la guarda de origen se re-evalúa DENTRO de la transacción bajo el lock (D-8).
 */
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../shared/prisma/prisma.service';
import type {
  FianzaStatusFinalizacion,
  FinalizarEventoComando,
  ReservaFinalizacion,
} from '../application/finalizar-evento.use-case';
import type {
  EstadoReserva,
  SubEstadoConsulta,
} from '../domain/maquina-estados';
import {
  subEstadoPrismaADominio,
  type SubEstadoConsultaPrisma,
} from './sub-estado-consulta.mapper';

@Injectable()
export class CargarReservaFinalizacionPrismaAdapter {
  constructor(private readonly prisma: PrismaService) {}

  async cargar(
    comando: FinalizarEventoComando,
  ): Promise<ReservaFinalizacion | null> {
    return this.prisma.$transaction(async (tx) => {
      await this.prisma.fijarTenant(tx, comando.tenantId);
      const fila = await tx.reserva.findFirst({
        where: { idReserva: comando.reservaId, tenantId: comando.tenantId },
        select: {
          idReserva: true,
          tenantId: true,
          clienteId: true,
          estado: true,
          subEstado: true,
          fianzaEur: true,
          fianzaStatus: true,
        },
      });
      if (fila === null) {
        return null;
      }
      return {
        idReserva: fila.idReserva,
        tenantId: fila.tenantId,
        clienteId: fila.clienteId,
        estado: fila.estado as EstadoReserva,
        subEstado:
          fila.subEstado === null
            ? null
            : (subEstadoPrismaADominio(
                fila.subEstado as SubEstadoConsultaPrisma,
              ) as SubEstadoConsulta),
        // Importe como STRING (Decimal(10,2), sin coma flotante) o null.
        fianzaEur: fila.fianzaEur === null ? null : fila.fianzaEur.toString(),
        fianzaStatus: fila.fianzaStatus as FianzaStatusFinalizacion,
      };
    });
  }
}
