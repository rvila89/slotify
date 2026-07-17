/**
 * Módulo raíz de la API.
 *
 * - `ConfigModule` global con validación de entorno vía zod (falla en bootstrap
 *   si falta una variable o `JWT_ACCESS_SECRET` < 32 chars).
 * - `PrismaModule` global (acceso a BD).
 * - `JwtAuthGuard` global: todo endpoint requiere token salvo los `@Public()`.
 */
import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { ServeStaticModule } from '@nestjs/serve-static';
import { validarEntorno } from './config/env.validation';
import { resolverAlmacenLocalDir } from './documentos/documentos.module';
import { AuthModule } from './auth/auth.module';
import { HealthModule } from './health/health.module';
import { JwtAuthGuard } from './shared/auth/jwt-auth.guard';
import { PrismaModule } from './shared/prisma/prisma.module';
import { ReservasModule } from './reservas/reservas.module';
import { CalendarioModule } from './calendario/calendario.module';
import { ClientesModule } from './clientes/clientes.module';
import { PresupuestosModule } from './presupuestos/presupuestos.module';
import { ConfirmacionModule } from './confirmacion/confirmacion.module';
import { TarifasModule } from './tarifas/tarifas.module';
import { FacturacionModule } from './facturacion/facturacion.module';
import { ComunicacionesModule } from './comunicaciones/comunicaciones.module';
import { FichaEventoModule } from './ficha-evento/ficha-evento.module';
import { TareasModule } from './tareas/tareas.module';
import { DashboardsModule } from './dashboards/dashboards.module';
import { ConfiguracionModule } from './configuracion/configuracion.module';
import { DocumentosModule } from './documentos/documentos.module';
import { DocumentacionEventoModule } from './documentacion-evento/documentacion-evento.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      validate: validarEntorno,
    }),
    // Épico #6 (6.5): ruta estática que sirve los ficheros del almacén local
    // (logos, PDFs) para que `logoUrl`/`pdf_url` resuelvan desde el navegador.
    // Es un FILE SERVER de assets, FUERA del prefijo global `/api` (los assets
    // estáticos no se prefijan): `GET /almacen/*` → `ALMACEN_LOCAL_DIR/*`.
    ServeStaticModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => [
        {
          rootPath: resolverAlmacenLocalDir(config),
          serveRoot: '/almacen',
          serveStaticOptions: { fallthrough: false },
        },
      ],
    }),
    PrismaModule,
    AuthModule,
    HealthModule,
    ReservasModule,
    CalendarioModule,
    ClientesModule,
    PresupuestosModule,
    ConfirmacionModule,
    TarifasModule,
    FacturacionModule,
    ComunicacionesModule,
    FichaEventoModule,
    TareasModule,
    DashboardsModule,
    ConfiguracionModule,
    DocumentosModule,
    DocumentacionEventoModule,
  ],
  providers: [
    {
      provide: APP_GUARD,
      useClass: JwtAuthGuard,
    },
  ],
})
export class AppModule {}
