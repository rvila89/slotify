/**
 * Adaptador Prisma del puerto `TemporadaCalendarioPort`.
 *
 * Lectura pura del calendario de temporadas del tenant. Filtra SIEMPRE por
 * `tenant_id` dentro de una transacción con `SET LOCAL app.tenant_id` para que
 * las políticas RLS de PostgreSQL apliquen (multi-tenancy).
 */
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../shared/prisma/prisma.service';
import {
  TemporadaCalendarioPort,
  Temporada,
} from '../domain/calculadora-tarifa.service';

@Injectable()
export class TemporadaCalendarioPrismaAdapter implements TemporadaCalendarioPort {
  constructor(private readonly prisma: PrismaService) {}

  async resolverTemporada(params: {
    tenantId: string;
    mes: number;
  }): Promise<Temporada | null> {
    const { tenantId, mes } = params;
    const fila = await this.prisma.$transaction(async (tx) => {
      await this.prisma.fijarTenant(tx, tenantId);
      return tx.temporadaCalendario.findFirst({
        where: { tenantId, mes },
        select: { temporada: true },
      });
    });
    return fila ? (fila.temporada as Temporada) : null;
  }
}
