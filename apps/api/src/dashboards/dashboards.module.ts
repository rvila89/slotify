/**
 * Módulo dashboards (US-044 / UC-34, hexagonal). Compone el read-model del dashboard
 * operativo: enlaza los puertos `DashboardQueryPort` y `ClockPort` a sus adaptadores
 * (tokens `Symbol`) e inyecta el use-case `ConsultarDashboardUseCase` vía factory.
 * Expone el controlador `GET /dashboard`. LECTURA PURA: no muta estado.
 */
import { Module } from '@nestjs/common';
import { PrismaModule } from '../shared/prisma/prisma.module';
import { PrismaService } from '../shared/prisma/prisma.service';
import { DashboardController } from './interface/dashboard.controller';
import { ConsultarDashboardUseCase } from './application/consultar-dashboard.use-case';
import type { DashboardQueryPort } from './domain/dashboard-query.port';
import type { ClockPort } from './domain/clock.port';
import { DashboardQueryPrismaAdapter } from './infrastructure/dashboard-query.prisma.adapter';
import { ClockAdapter } from './infrastructure/clock.adapter';
import { CLOCK_PORT, DASHBOARD_QUERY_PORT } from './dashboards.tokens';

@Module({
  imports: [PrismaModule],
  controllers: [DashboardController],
  providers: [
    {
      provide: DASHBOARD_QUERY_PORT,
      inject: [PrismaService],
      useFactory: (prisma: PrismaService) =>
        new DashboardQueryPrismaAdapter(prisma),
    },
    {
      provide: CLOCK_PORT,
      useFactory: () => new ClockAdapter(),
    },
    {
      provide: ConsultarDashboardUseCase,
      inject: [DASHBOARD_QUERY_PORT, CLOCK_PORT],
      useFactory: (dashboard: DashboardQueryPort, clock: ClockPort) =>
        new ConsultarDashboardUseCase({ dashboard, clock }),
    },
  ],
  exports: [ConsultarDashboardUseCase],
})
export class DashboardsModule {}
