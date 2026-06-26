/**
 * Adaptador Prisma del puerto `ExtraRepositoryPort`.
 *
 * Lee un EXTRA del catálogo del tenant por id. Filtra por `tenant_id` bajo RLS:
 * un extra de otro tenant simplemente no es visible (devuelve `null`), de modo
 * que el dominio lo traduce a `EXTRA_NO_ENCONTRADO` sin fuga de existencia.
 */
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../shared/prisma/prisma.service';
import { ExtraRepositoryPort } from '../domain/calculadora-tarifa.service';

@Injectable()
export class ExtraPrismaAdapter implements ExtraRepositoryPort {
  constructor(private readonly prisma: PrismaService) {}

  async buscarPorId(params: {
    tenantId: string;
    extraId: string;
  }): Promise<{ idExtra: string; precioEur: number; activo: boolean } | null> {
    const { tenantId, extraId } = params;
    const fila = await this.prisma.$transaction(async (tx) => {
      await this.prisma.fijarTenant(tx, tenantId);
      return tx.extra.findFirst({
        where: { idExtra: extraId, tenantId },
        select: { idExtra: true, precioEur: true, activo: true },
      });
    });
    return fila
      ? { idExtra: fila.idExtra, precioEur: fila.precioEur.toNumber(), activo: fila.activo }
      : null;
  }
}
