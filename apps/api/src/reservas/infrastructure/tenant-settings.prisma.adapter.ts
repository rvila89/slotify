/**
 * Adaptador Prisma del puerto `TenantSettingsPort`.
 *
 * Lee los días de TTL (`ttl_consulta_dias`, `ttl_prereserva_dias`) de
 * TENANT_SETTINGS para el tenant dado. Los TTL del bloqueo se derivan de esta
 * configuración, nunca se hardcodean (US-040 §Reglas de negocio).
 */
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../shared/prisma/prisma.service';
import {
  TenantSettingsBloqueo,
  TenantSettingsPort,
} from '../domain/bloquear-fecha.service';

@Injectable()
export class TenantSettingsPrismaAdapter implements TenantSettingsPort {
  constructor(private readonly prisma: PrismaService) {}

  async obtener(tenantId: string): Promise<TenantSettingsBloqueo | null> {
    const fila = await this.prisma.$transaction(async (tx) => {
      await this.prisma.fijarTenant(tx, tenantId);
      return tx.tenantSettings.findUnique({
        where: { tenantId },
        select: { ttlConsultaDias: true, ttlPrereservaDias: true },
      });
    });
    return fila
      ? {
          ttlConsultaDias: fila.ttlConsultaDias,
          ttlPrereservaDias: fila.ttlPrereservaDias,
        }
      : null;
  }
}
