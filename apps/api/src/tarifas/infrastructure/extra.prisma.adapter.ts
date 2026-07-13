/**
 * Adaptador Prisma de los puertos de EXTRA:
 *   - `ExtraRepositoryPort`: lee un EXTRA por id (motor de tarifa). Filtra por
 *     `tenant_id` bajo RLS: un extra de otro tenant no es visible (devuelve `null`),
 *     de modo que el dominio lo traduce a `EXTRA_NO_ENCONTRADO` sin fuga de existencia.
 *   - `CatalogoExtrasPort`: lista el catálogo de extras activos del tenant (US-014,
 *     `GET /extras`) para alimentar el selector del borrador de presupuesto.
 */
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../shared/prisma/prisma.service';
import { ExtraRepositoryPort } from '../domain/calculadora-tarifa.service';
import { CatalogoExtrasPort, ExtraCatalogoItem } from '../domain/catalogo-extras.port';

@Injectable()
export class ExtraPrismaAdapter implements ExtraRepositoryPort, CatalogoExtrasPort {
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

  async listarActivos(tenantId: string): Promise<ExtraCatalogoItem[]> {
    const filas = await this.prisma.$transaction(async (tx) => {
      await this.prisma.fijarTenant(tx, tenantId);
      return tx.extra.findMany({
        where: { tenantId, activo: true },
        orderBy: { nombre: 'asc' },
        select: { idExtra: true, nombre: true, descripcion: true, precioEur: true, activo: true },
      });
    });
    return filas.map((fila) => ({
      idExtra: fila.idExtra,
      nombre: fila.nombre,
      descripcion: fila.descripcion,
      precioEur: fila.precioEur.toNumber(),
      activo: fila.activo,
    }));
  }
}
