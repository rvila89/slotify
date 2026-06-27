/**
 * Módulo reservas (US-040, hexagonal). Enlaza los puertos de la operación
 * `bloquearFecha()` a sus adaptadores Prisma y compone `BloquearFechaService`
 * (dominio puro) vía factory, inyectando los puertos por token (Symbol).
 */
import { Module } from '@nestjs/common';
import { PrismaModule } from '../shared/prisma/prisma.module';
import { PrismaService } from '../shared/prisma/prisma.service';
import {
  BloquearFechaService,
  ClockPort,
  FechaBloqueadaRepositoryPort,
  TenantSettingsPort,
} from './domain/bloquear-fecha.service';
import { FechaBloqueadaPrismaAdapter } from './infrastructure/fecha-bloqueada.prisma.adapter';
import { TenantSettingsPrismaAdapter } from './infrastructure/tenant-settings.prisma.adapter';
import { SistemaClockAdapter } from './infrastructure/sistema-clock.adapter';
import {
  CLOCK_PORT,
  FECHA_BLOQUEADA_REPOSITORY_PORT,
  TENANT_SETTINGS_PORT,
} from './reservas.tokens';

@Module({
  imports: [PrismaModule],
  providers: [
    {
      provide: FECHA_BLOQUEADA_REPOSITORY_PORT,
      inject: [PrismaService],
      useFactory: (prisma: PrismaService) => new FechaBloqueadaPrismaAdapter(prisma),
    },
    { provide: TENANT_SETTINGS_PORT, useClass: TenantSettingsPrismaAdapter },
    { provide: CLOCK_PORT, useClass: SistemaClockAdapter },
    {
      provide: BloquearFechaService,
      inject: [FECHA_BLOQUEADA_REPOSITORY_PORT, TENANT_SETTINGS_PORT, CLOCK_PORT],
      useFactory: (
        repositorio: FechaBloqueadaRepositoryPort,
        tenantSettings: TenantSettingsPort,
        clock: ClockPort,
      ) =>
        new BloquearFechaService({
          repositorio,
          tenantSettings,
          clock,
        }),
    },
  ],
  exports: [BloquearFechaService],
})
export class ReservasModule {}
