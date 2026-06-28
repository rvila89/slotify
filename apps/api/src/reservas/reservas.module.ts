/**
 * Módulo reservas (US-040 + US-041, hexagonal). Enlaza los puertos de las
 * operaciones `bloquearFecha()` y `liberarFecha()` a sus adaptadores Prisma y
 * compone los servicios de dominio (puros) vía factory, inyectando los puertos por
 * token (Symbol).
 */
import { Module } from '@nestjs/common';
import { PrismaModule } from '../shared/prisma/prisma.module';
import { PrismaService } from '../shared/prisma/prisma.service';
import { ComunicacionesModule } from '../comunicaciones/comunicaciones.module';
import { ENVIAR_EMAIL_PORT } from '../comunicaciones/comunicaciones.tokens';
import type { EnviarEmailPort } from '../comunicaciones/domain/enviar-email.port';
import {
  BloquearFechaService,
  ClockPort,
  FechaBloqueadaRepositoryPort,
  TenantSettingsPort,
} from './domain/bloquear-fecha.service';
import {
  AltaConsultaUseCase,
  type UnidadDeTrabajoPort,
} from './application/alta-consulta.use-case';
import { UnidadDeTrabajoPrismaAdapter } from './infrastructure/unidad-de-trabajo.prisma.adapter';
import { AltaConsultaController } from './interface/alta-consulta.controller';
import {
  AuditLogPort,
  ColaQueryPort,
  FechaBloqueadaLiberacionPort,
  LiberarFechaService,
  PromocionColaPort,
  RegistroAuditoriaLiberacion,
  ReservaEstadoPort,
} from './domain/liberar-fecha.service';
import { LiberarFechasEnLoteService } from './application/liberar-fechas-lote.service';
import { FechaBloqueadaPrismaAdapter } from './infrastructure/fecha-bloqueada.prisma.adapter';
import { TenantSettingsPrismaAdapter } from './infrastructure/tenant-settings.prisma.adapter';
import { SistemaClockAdapter } from './infrastructure/sistema-clock.adapter';
import { ReservaEstadoPrismaAdapter } from './infrastructure/reserva-estado.prisma.adapter';
import { ColaQueryPrismaAdapter } from './infrastructure/cola-query.prisma.adapter';
import { PromocionColaStubAdapter } from './infrastructure/promocion-cola.stub.adapter';
import { AuditLogPrismaAdapter } from './infrastructure/audit-log.prisma.adapter';
import {
  AUDIT_LOG_PORT,
  CLOCK_PORT,
  COLA_QUERY_PORT,
  FECHA_BLOQUEADA_LIBERACION_PORT,
  FECHA_BLOQUEADA_REPOSITORY_PORT,
  PROMOCION_COLA_PORT,
  RESERVA_ESTADO_PORT,
  TENANT_SETTINGS_PORT,
  UNIDAD_DE_TRABAJO_PORT,
} from './reservas.tokens';

@Module({
  imports: [PrismaModule, ComunicacionesModule],
  controllers: [AltaConsultaController],
  providers: [
    {
      provide: UNIDAD_DE_TRABAJO_PORT,
      inject: [PrismaService],
      useFactory: (prisma: PrismaService) => new UnidadDeTrabajoPrismaAdapter(prisma),
    },
    {
      provide: AltaConsultaUseCase,
      inject: [UNIDAD_DE_TRABAJO_PORT, ENVIAR_EMAIL_PORT, CLOCK_PORT],
      useFactory: (
        unidadDeTrabajo: UnidadDeTrabajoPort,
        enviarEmail: EnviarEmailPort,
        clock: ClockPort,
      ) => new AltaConsultaUseCase({ unidadDeTrabajo, enviarEmail, clock }),
    },
    {
      provide: FECHA_BLOQUEADA_REPOSITORY_PORT,
      inject: [PrismaService],
      useFactory: (prisma: PrismaService) => new FechaBloqueadaPrismaAdapter(prisma),
    },
    {
      provide: FECHA_BLOQUEADA_LIBERACION_PORT,
      inject: [PrismaService],
      useFactory: (prisma: PrismaService) => new FechaBloqueadaPrismaAdapter(prisma),
    },
    { provide: TENANT_SETTINGS_PORT, useClass: TenantSettingsPrismaAdapter },
    { provide: CLOCK_PORT, useClass: SistemaClockAdapter },
    { provide: RESERVA_ESTADO_PORT, useClass: ReservaEstadoPrismaAdapter },
    { provide: COLA_QUERY_PORT, useClass: ColaQueryPrismaAdapter },
    { provide: PROMOCION_COLA_PORT, useClass: PromocionColaStubAdapter },
    { provide: AUDIT_LOG_PORT, useClass: AuditLogPrismaAdapter },
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
    {
      provide: LiberarFechaService,
      inject: [
        FECHA_BLOQUEADA_LIBERACION_PORT,
        RESERVA_ESTADO_PORT,
        COLA_QUERY_PORT,
        PROMOCION_COLA_PORT,
        AUDIT_LOG_PORT,
      ],
      useFactory: (
        repositorio: FechaBloqueadaLiberacionPort,
        reservaEstado: ReservaEstadoPort,
        cola: ColaQueryPort,
        promocion: PromocionColaPort,
        auditoria: AuditLogPort<RegistroAuditoriaLiberacion>,
      ) =>
        new LiberarFechaService({
          repositorio,
          reservaEstado,
          cola,
          promocion,
          auditoria,
        }),
    },
    {
      provide: LiberarFechasEnLoteService,
      inject: [LiberarFechaService],
      useFactory: (servicio: LiberarFechaService) => new LiberarFechasEnLoteService(servicio),
    },
  ],
  exports: [
    BloquearFechaService,
    LiberarFechaService,
    LiberarFechasEnLoteService,
    AltaConsultaUseCase,
  ],
})
export class ReservasModule {}
