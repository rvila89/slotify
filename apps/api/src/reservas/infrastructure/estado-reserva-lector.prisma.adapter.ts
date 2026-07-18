/**
 * Adaptador Prisma del puerto `EstadoReservaLectorPort` (change
 * `presupuesto-prereserva-cta-descarte-y-e2`, workstream B / D-2).
 *
 * Lee el `(estado, subEstado)` actual de una RESERVA bajo el contexto RLS del tenant del JWT,
 * para que el orquestador del descarte elija la rama por fase (consulta → US-013; pre_reserva →
 * nueva transición). Devuelve `null` cuando la RESERVA es invisible bajo RLS (inexistente o de
 * otro tenant): el orquestador lo traduce a 404. La lectura fija el tenant en la sesión
 * (`SET LOCAL app.tenant_id`) dentro de una transacción de solo lectura y filtra SIEMPRE por
 * `tenant_id` (multi-tenancy: nunca del path/body).
 */
import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../shared/prisma/prisma.service';
import type {
  EstadoReservaLectorPort,
  EstadoReservaLeido,
} from '../application/descartar-reserva-orquestador.use-case';
import type { EstadoReserva } from '../domain/maquina-estados';
import {
  subEstadoPrismaADominio,
  type SubEstadoConsultaPrisma,
} from './sub-estado-consulta.mapper';

/** Fila cruda del estado de la RESERVA (columnas snake_case). */
interface FilaEstadoReserva {
  estado: EstadoReserva;
  sub_estado: SubEstadoConsultaPrisma | null;
}

@Injectable()
export class EstadoReservaLectorPrismaAdapter implements EstadoReservaLectorPort {
  constructor(private readonly prisma: PrismaService) {}

  async leerEstado(params: {
    tenantId: string;
    reservaId: string;
  }): Promise<EstadoReservaLeido | null> {
    const { tenantId, reservaId } = params;

    return this.prisma.$transaction(async (tx) => {
      await this.prisma.fijarTenant(tx, tenantId);

      const filas = await tx.$queryRaw<FilaEstadoReserva[]>(Prisma.sql`
        SELECT estado, sub_estado
        FROM reserva
        WHERE id_reserva = ${reservaId}
          AND tenant_id = ${tenantId}
      `);
      if (filas.length === 0) {
        return null;
      }
      const fila = filas[0];
      return {
        estado: fila.estado,
        subEstado:
          fila.sub_estado === null ? null : subEstadoPrismaADominio(fila.sub_estado),
      };
    });
  }
}
