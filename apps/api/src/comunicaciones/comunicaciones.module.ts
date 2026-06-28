/**
 * Módulo comunicaciones (US-003 + US-045, hexagonal) — capability M10.
 *
 * Cierra DT-EMAIL-01: el token `ENVIAR_EMAIL_PORT` deja de apuntar al STUB no-op y
 * se enlaza por `useFactory` al transporte REAL (`ResendEmailAdapter`) o al FAKE en
 * memoria (`FakeEmailAdapter`) según `EMAIL_TRANSPORT` (en `test`/CI: fake, cero
 * red). Se conserva el contrato del puerto de dominio (`EnviarEmailPort`), por lo
 * que `reservas` (alta E1) sigue consumiéndolo por token sin cambios.
 *
 * Además compone el MOTOR de email reutilizable (`DespacharEmailService`) con sus
 * puertos (catálogo de plantillas, repositorio COMUNICACION, idioma del tenant,
 * auditoría compartida y reloj), listo para cablear los triggers E2–E8 (diferidos a
 * sus US). El dominio/aplicación dependen solo de interfaces; los adaptadores
 * (Prisma/Resend) viven en infraestructura.
 */
import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaModule } from '../shared/prisma/prisma.module';
import { PrismaService } from '../shared/prisma/prisma.service';
import { AuditLogPrismaAdapter } from '../shared/audit/audit-log.prisma.adapter';
import type { AuditLogPort } from '../shared/audit/audit-log.port';
import { FakeEmailAdapter } from './infrastructure/fake-email.adapter';
import { ResendEmailAdapter } from './infrastructure/resend.email.adapter';
import { CatalogoPlantillasEnCodigo } from './infrastructure/plantillas/catalogo-plantillas';
import { ComunicacionRepositoryPrismaAdapter } from './infrastructure/comunicacion.repository.prisma.adapter';
import { TenantSettingsIdiomaPrismaAdapter } from './infrastructure/tenant-settings.prisma.adapter';
import { SistemaClockAdapter } from './infrastructure/sistema-clock.adapter';
import {
  DespacharEmailService,
  type ClockPort,
} from './application/despachar-email.service';
import type { CatalogoPlantillasPort } from './domain/catalogo-plantillas.port';
import type { ComunicacionRepositoryPort } from './domain/comunicacion.repository.port';
import type { TenantSettingsPort } from './domain/tenant-settings.port';
import type { EnviarEmailPort } from './domain/enviar-email.port';
import {
  CATALOGO_PLANTILLAS_PORT,
  COMUNICACION_REPOSITORY_PORT,
  COMUNICACIONES_CLOCK_PORT,
  ENVIAR_EMAIL_PORT,
  TENANT_SETTINGS_IDIOMA_PORT,
} from './comunicaciones.tokens';

@Module({
  imports: [PrismaModule],
  providers: [
    // Transporte: real (Resend) o fake según EMAIL_TRANSPORT. En test/CI → fake.
    {
      provide: ENVIAR_EMAIL_PORT,
      inject: [ConfigService],
      useFactory: (config: ConfigService): EnviarEmailPort => {
        const transporte = config.get<string>('EMAIL_TRANSPORT') ?? 'fake';
        if (transporte === 'resend') {
          // DEFAULT SEGURO (Bj3): sandbox activo salvo opt-in EXPLÍCITO. La
          // validación de env ya transforma EMAIL_SANDBOX a boolean, pero según
          // cómo resuelva `ConfigService` puede llegar como boolean o como string;
          // tratamos como envío REAL solo el `false`/'false' explícito, cualquier
          // otro valor (incluido unset) deja el sandbox activo.
          const sandboxRaw = config.get<boolean | string>('EMAIL_SANDBOX');
          const sandbox = !(sandboxRaw === false || sandboxRaw === 'false');
          return new ResendEmailAdapter({
            apiKey: config.get<string>('RESEND_API_KEY') ?? '',
            from: config.get<string>('EMAIL_FROM') ?? '',
            sandbox,
          });
        }
        return new FakeEmailAdapter();
      },
    },
    // Catálogo de plantillas (E1 activa; E2–E8 diseñadas/inactivas).
    { provide: CATALOGO_PLANTILLAS_PORT, useClass: CatalogoPlantillasEnCodigo },
    // Repositorio de COMUNICACION (idempotencia vía índice UNIQUE parcial).
    {
      provide: COMUNICACION_REPOSITORY_PORT,
      inject: [PrismaService],
      useFactory: (prisma: PrismaService) =>
        new ComunicacionRepositoryPrismaAdapter(prisma),
    },
    // Idioma del tenant (TENANT_SETTINGS.idioma).
    {
      provide: TENANT_SETTINGS_IDIOMA_PORT,
      inject: [PrismaService],
      useFactory: (prisma: PrismaService) =>
        new TenantSettingsIdiomaPrismaAdapter(prisma),
    },
    // Reloj del sistema (fecha_envio).
    { provide: COMUNICACIONES_CLOCK_PORT, useClass: SistemaClockAdapter },
    // Auditoría compartida (AUDIT_LOG).
    AuditLogPrismaAdapter,
    // Motor de email reutilizable (listo para cablear E2–E8 en sus US).
    {
      provide: DespacharEmailService,
      inject: [
        CATALOGO_PLANTILLAS_PORT,
        COMUNICACION_REPOSITORY_PORT,
        TENANT_SETTINGS_IDIOMA_PORT,
        AuditLogPrismaAdapter,
        ENVIAR_EMAIL_PORT,
        COMUNICACIONES_CLOCK_PORT,
      ],
      useFactory: (
        catalogo: CatalogoPlantillasPort,
        comunicaciones: ComunicacionRepositoryPort,
        tenantSettings: TenantSettingsPort,
        auditoria: AuditLogPort,
        enviarEmail: EnviarEmailPort,
        clock: ClockPort,
      ) =>
        new DespacharEmailService({
          catalogo,
          comunicaciones,
          tenantSettings,
          auditoria,
          enviarEmail,
          clock,
        }),
    },
  ],
  exports: [ENVIAR_EMAIL_PORT, DespacharEmailService],
})
export class ComunicacionesModule {}
