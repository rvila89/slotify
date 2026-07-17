/**
 * Adaptador de LECTURA de la RESERVA para el FORZADO MANUAL del inicio de evento
 * (US-032 / UC-23 FA-01).
 *
 * Carga la proyección mínima de la RESERVA (`estado`, `sub_estado`, `cliente_id`,
 * `fecha_evento` y los tres `*_status`) bajo el contexto RLS del tenant del Gestor: una
 * RESERVA de otro tenant es INVISIBLE (→ `null` → 404). La lectura es previa a la transacción
 * de la transición; la guarda de origen se re-evalúa DENTRO de la transacción bajo el lock
 * (D-3). Los tres `*_status` alimentan el cálculo de `precondiciones_incumplidas` que el
 * use-case persiste en el AUDIT_LOG (D-4).
 */
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../shared/prisma/prisma.service';
import type {
  ForzarInicioEventoComando,
  ReservaForzarInicio,
} from '../application/forzar-inicio-evento.use-case';
import type {
  EstadoReserva,
  FianzaStatusDominio,
  LiquidacionStatusDominio,
  PreEventoStatusDominio,
  SubEstadoConsulta,
} from '../domain/maquina-estados';
import {
  subEstadoPrismaADominio,
  type SubEstadoConsultaPrisma,
} from './sub-estado-consulta.mapper';

@Injectable()
export class CargarReservaForzarInicioPrismaAdapter {
  constructor(private readonly prisma: PrismaService) {}

  async cargar(
    comando: ForzarInicioEventoComando,
  ): Promise<ReservaForzarInicio | null> {
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
          fechaEvento: true,
          preEventoStatus: true,
          liquidacionStatus: true,
          fianzaStatus: true,
        },
      });
      if (fila === null || fila.fechaEvento === null) {
        // Sin `fecha_evento` no es candidata al forzado (la guarda de fecha no aplicaría):
        // se trata como no resoluble para esta acción → 404 (o 409/422 aguas arriba nunca).
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
        fechaEvento: fila.fechaEvento,
        preEventoStatus: fila.preEventoStatus as PreEventoStatusDominio,
        liquidacionStatus: fila.liquidacionStatus as LiquidacionStatusDominio,
        fianzaStatus: fila.fianzaStatus as FianzaStatusDominio,
      };
    });
  }
}
