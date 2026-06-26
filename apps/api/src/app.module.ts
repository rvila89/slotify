/**
 * Módulo raíz de la API.
 *
 * - `ConfigModule` global con validación de entorno vía zod (falla en bootstrap
 *   si falta una variable o `JWT_ACCESS_SECRET` < 32 chars).
 * - `PrismaModule` global (acceso a BD).
 * - `JwtAuthGuard` global: todo endpoint requiere token salvo los `@Public()`.
 */
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { validarEntorno } from './config/env.validation';
import { AuthModule } from './auth/auth.module';
import { HealthModule } from './health/health.module';
import { JwtAuthGuard } from './shared/auth/jwt-auth.guard';
import { PrismaModule } from './shared/prisma/prisma.module';
import { ReservasModule } from './reservas/reservas.module';
import { CalendarioModule } from './calendario/calendario.module';
import { ClientesModule } from './clientes/clientes.module';
import { PresupuestosModule } from './presupuestos/presupuestos.module';
import { FacturacionModule } from './facturacion/facturacion.module';
import { ComunicacionesModule } from './comunicaciones/comunicaciones.module';
import { FichaEventoModule } from './ficha-evento/ficha-evento.module';
import { TareasModule } from './tareas/tareas.module';
import { DashboardsModule } from './dashboards/dashboards.module';
import { ConfiguracionModule } from './configuracion/configuracion.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      validate: validarEntorno,
    }),
    PrismaModule,
    AuthModule,
    HealthModule,
    ReservasModule,
    CalendarioModule,
    ClientesModule,
    PresupuestosModule,
    FacturacionModule,
    ComunicacionesModule,
    FichaEventoModule,
    TareasModule,
    DashboardsModule,
    ConfiguracionModule,
  ],
  providers: [
    {
      provide: APP_GUARD,
      useClass: JwtAuthGuard,
    },
  ],
})
export class AppModule {}
