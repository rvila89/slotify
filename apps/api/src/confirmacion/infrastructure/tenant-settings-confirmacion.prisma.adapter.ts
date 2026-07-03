/**
 * Adaptador Prisma del puerto `TenantSettingsConfirmacionPort` (US-021).
 *
 * Lee de TENANT_SETTINGS el porcentaje de la señal (`pct_senal`) bajo el contexto RLS del
 * tenant. Este valor nunca se hardcodea (deriva del setting del tenant; 40,00 en MVP).
 */
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../shared/prisma/prisma.service';
import type {
  TenantSettingsConfirmacion,
  TenantSettingsConfirmacionPort,
} from '../application/confirmar-pago-senal.use-case';

@Injectable()
export class TenantSettingsConfirmacionPrismaAdapter
  implements TenantSettingsConfirmacionPort
{
  constructor(private readonly prisma: PrismaService) {}

  async obtener(tenantId: string): Promise<TenantSettingsConfirmacion | null> {
    const fila = await this.prisma.$transaction(async (tx) => {
      await this.prisma.fijarTenant(tx, tenantId);
      return tx.tenantSettings.findUnique({
        where: { tenantId },
        select: { pctSenal: true },
      });
    });
    return fila === null ? null : { pctSenal: Number(fila.pctSenal) };
  }
}
