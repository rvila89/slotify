/**
 * Adaptador Prisma del puerto `TenantSettingsPort` del motor de email (US-045).
 *
 * INFRAESTRUCTURA: lee `TENANT_SETTINGS.idioma` para resolver el idioma de la
 * plantilla, fijando el contexto RLS (`SET LOCAL app.tenant_id`) dentro de la
 * transacción de lectura. Devuelve `null` si el tenant no tiene settings (el motor
 * aplica el default `es`).
 */
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../shared/prisma/prisma.service';
import type { TenantSettingsPort } from '../domain/tenant-settings.port';

@Injectable()
export class TenantSettingsIdiomaPrismaAdapter implements TenantSettingsPort {
  constructor(private readonly prisma: PrismaService) {}

  async obtenerIdioma(tenantId: string): Promise<string | null> {
    const fila = await this.prisma.$transaction(async (tx) => {
      await this.prisma.fijarTenant(tx, tenantId);
      return tx.tenantSettings.findUnique({
        where: { tenantId },
        select: { idioma: true },
      });
    });
    return fila?.idioma ?? null;
  }
}
