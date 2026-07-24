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
import * as path from 'node:path';
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
import { CargarComunicacionPrismaAdapter } from './infrastructure/cargar-comunicacion.prisma.adapter';
import { CargarReservaContextoPrismaAdapter } from './infrastructure/cargar-reserva-contexto.prisma.adapter';
import { CargarReservaPresupuestoContextoPrismaAdapter } from './infrastructure/cargar-reserva-presupuesto-contexto.prisma.adapter';
import {
  DespacharEmailService,
  type ClockPort,
} from './application/despachar-email.service';
import {
  EnviarBorradorUseCase,
  type CargarComunicacionPort,
} from './application/enviar-borrador.use-case';
import { DescartarBorradorUseCase } from './application/descartar-borrador.use-case';
import {
  CrearEmailManualUseCase,
  type CargarReservaContextoPort,
} from './application/crear-email-manual.use-case';
import {
  SolicitarDatosPresupuestoUseCase,
  type CargarReservaPresupuestoContextoPort,
} from './application/solicitar-datos-presupuesto.use-case';
import { ComunicacionesController } from './interface/comunicaciones.controller';
import type { CatalogoPlantillasPort } from './domain/catalogo-plantillas.port';
import type { ComunicacionRepositoryPort } from './domain/comunicacion.repository.port';
import type { TenantSettingsPort } from './domain/tenant-settings.port';
import type { EnviarEmailPort } from './domain/enviar-email.port';
import type { AuditLogPort as AuditLogPortAlias } from '../shared/audit/audit-log.port';
import {
  CARGAR_COMUNICACION_PORT,
  CARGAR_RESERVA_CONTEXTO_PORT,
  CARGAR_RESERVA_PRESUPUESTO_CONTEXTO_PORT,
  CATALOGO_PLANTILLAS_PORT,
  COMUNICACION_REPOSITORY_PORT,
  COMUNICACIONES_CLOCK_PORT,
  ENVIAR_EMAIL_PORT,
  TENANT_SETTINGS_IDIOMA_PORT,
} from './comunicaciones.tokens';

@Module({
  imports: [PrismaModule],
  controllers: [ComunicacionesController],
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
    // US-046 — carga de la COMUNICACION (enviar/descartar) scoped por tenant (RLS).
    {
      provide: CARGAR_COMUNICACION_PORT,
      inject: [PrismaService],
      useFactory: (prisma: PrismaService) =>
        new CargarComunicacionPrismaAdapter(prisma),
    },
    // US-046 — carga de la RESERVA + CLIENTE (email manual) scoped por tenant (RLS).
    {
      provide: CARGAR_RESERVA_CONTEXTO_PORT,
      inject: [PrismaService],
      useFactory: (prisma: PrismaService) =>
        new CargarReservaContextoPrismaAdapter(prisma),
    },
    // US-046 — confirmar el envío de un borrador (delega en `finalizarEnvio`, D-1).
    {
      provide: EnviarBorradorUseCase,
      inject: [
        CARGAR_COMUNICACION_PORT,
        COMUNICACION_REPOSITORY_PORT,
        DespacharEmailService,
        AuditLogPrismaAdapter,
      ],
      useFactory: (
        cargarComunicacion: CargarComunicacionPort,
        comunicaciones: ComunicacionRepositoryPort,
        motor: DespacharEmailService,
        auditoria: AuditLogPortAlias,
      ) =>
        new EnviarBorradorUseCase({
          cargarComunicacion,
          comunicaciones,
          motor,
          auditoria,
          // US-047 — URL base del almacén para adjuntar el dossier E1 al enviar el
          // borrador. Misma resolución que el alta (US-004): en local (Resend lee del
          // disco) la ruta absoluta del almacén; en producción (S3) la URL pública.
          dossierBaseUrl:
            (process.env.ALMACEN_PROVIDER ?? 'local') === 'local'
              ? path.resolve(process.env.ALMACEN_LOCAL_DIR ?? '.almacen')
              : (process.env.ALMACEN_S3_BASE_URL ?? ''),
        }),
    },
    // US-046 — descartar un borrador (borrador→fallido sin envío + AUDIT_LOG, D-5).
    {
      provide: DescartarBorradorUseCase,
      inject: [
        CARGAR_COMUNICACION_PORT,
        COMUNICACION_REPOSITORY_PORT,
        AuditLogPrismaAdapter,
      ],
      useFactory: (
        cargarComunicacion: CargarComunicacionPort,
        comunicaciones: ComunicacionRepositoryPort,
        auditoria: AuditLogPortAlias,
      ) =>
        new DescartarBorradorUseCase({
          cargarComunicacion,
          comunicaciones,
          auditoria,
        }),
    },
    // US-046 — crear y enviar un email manual (codigo=manual, es_reenvio=false, D-5 C).
    {
      provide: CrearEmailManualUseCase,
      inject: [
        CARGAR_RESERVA_CONTEXTO_PORT,
        COMUNICACION_REPOSITORY_PORT,
        ENVIAR_EMAIL_PORT,
        AuditLogPrismaAdapter,
        COMUNICACIONES_CLOCK_PORT,
      ],
      useFactory: (
        cargarReserva: CargarReservaContextoPort,
        comunicaciones: ComunicacionRepositoryPort,
        enviarEmail: EnviarEmailPort,
        auditoria: AuditLogPortAlias,
        clock: ClockPort,
      ) =>
        new CrearEmailManualUseCase({
          cargarReserva,
          comunicaciones,
          enviarEmail,
          auditoria,
          clock,
        }),
    },
    // change solicitud-datos-presupuesto-borrador — carga de la RESERVA + CLIENTE
    // (contexto de presupuesto) scoped por tenant (RLS).
    {
      provide: CARGAR_RESERVA_PRESUPUESTO_CONTEXTO_PORT,
      inject: [PrismaService],
      useFactory: (prisma: PrismaService) =>
        new CargarReservaPresupuestoContextoPrismaAdapter(prisma),
    },
    // change solicitud-datos-presupuesto-borrador — solicitar datos de presupuesto:
    // deja EN BORRADOR un E1 `solicitud_datos` reutilizando la plantilla del E1 disponible.
    {
      provide: SolicitarDatosPresupuestoUseCase,
      inject: [
        CARGAR_RESERVA_PRESUPUESTO_CONTEXTO_PORT,
        COMUNICACION_REPOSITORY_PORT,
        AuditLogPrismaAdapter,
      ],
      useFactory: (
        cargarReserva: CargarReservaPresupuestoContextoPort,
        comunicaciones: ComunicacionRepositoryPort,
        auditoria: AuditLogPortAlias,
      ) =>
        new SolicitarDatosPresupuestoUseCase({
          cargarReserva,
          comunicaciones,
          auditoria,
        }),
    },
  ],
  exports: [ENVIAR_EMAIL_PORT, DespacharEmailService, CATALOGO_PLANTILLAS_PORT],
})
export class ComunicacionesModule {}
