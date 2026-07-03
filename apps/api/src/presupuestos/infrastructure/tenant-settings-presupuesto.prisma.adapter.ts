/**
 * Adaptador Prisma del puerto `TenantSettingsPresupuestoPort` (US-014).
 *
 * Lee de TENANT_SETTINGS el TTL de la pre_reserva (`ttl_prereserva_dias`) y los
 * parámetros del reparto (`pct_senal`, `fianza_default_eur`) bajo el contexto RLS del
 * tenant. Estos valores nunca se hardcodean (derivan del setting del tenant).
 */
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../shared/prisma/prisma.service';
import type {
  TenantSettingsPresupuesto,
  TenantSettingsPresupuestoPort,
} from '../application/generar-presupuesto.use-case';

@Injectable()
export class TenantSettingsPresupuestoPrismaAdapter
  implements TenantSettingsPresupuestoPort
{
  constructor(private readonly prisma: PrismaService) {}

  async obtener(tenantId: string): Promise<TenantSettingsPresupuesto | null> {
    const fila = await this.prisma.$transaction(async (tx) => {
      await this.prisma.fijarTenant(tx, tenantId);
      return tx.tenantSettings.findUnique({
        where: { tenantId },
        select: { ttlPrereservaDias: true, pctSenal: true, fianzaDefaultEur: true },
      });
    });
    return fila === null
      ? null
      : {
          ttlPrereservaDias: fila.ttlPrereservaDias,
          pctSenal: Number(fila.pctSenal),
          fianzaDefaultEur: Number(fila.fianzaDefaultEur),
        };
  }
}
