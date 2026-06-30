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
import { DespacharEmailService } from '../comunicaciones/application/despachar-email.service';
import { TarifasModule } from '../tarifas/tarifas.module';
import { CalculadoraTarifaService } from '../tarifas/domain/calculadora-tarifa.service';
import {
  BloquearFechaService,
  ClockPort,
  FechaBloqueadaRepositoryPort,
  TenantSettingsPort,
} from './domain/bloquear-fecha.service';
import {
  AltaConsultaUseCase,
  type TarifaEstimadaPort,
  type UnidadDeTrabajoPort,
} from './application/alta-consulta.use-case';
import { UnidadDeTrabajoPrismaAdapter } from './infrastructure/unidad-de-trabajo.prisma.adapter';
import { UnidadDeTrabajoTransicionPrismaAdapter } from './infrastructure/transicion-fecha-uow.prisma.adapter';
import { UnidadDeTrabajoPendienteInvitadosPrismaAdapter } from './infrastructure/transicion-pendiente-invitados-uow.prisma.adapter';
import { UnidadDeTrabajoProgramarVisitaPrismaAdapter } from './infrastructure/programar-visita-uow.prisma.adapter';
import { UnidadDeTrabajoExtenderBloqueoPrismaAdapter } from './infrastructure/extender-bloqueo-uow.prisma.adapter';
import { ConfirmacionBloqueoEmailAdapter } from './infrastructure/confirmacion-bloqueo-email.adapter';
import { ConfirmacionVisitaEmailAdapter } from './infrastructure/confirmacion-visita-email.adapter';
import { TarifaEstimadaAdapter } from './infrastructure/tarifa-estimada.adapter';
import { AltaConsultaController } from './interface/alta-consulta.controller';
import { TransicionFechaController } from './interface/transicion-fecha.controller';
import { PendienteInvitadosController } from './interface/pendiente-invitados.controller';
import { ProgramarVisitaController } from './interface/programar-visita.controller';
import { ExtenderBloqueoController } from './interface/extender-bloqueo.controller';
import { ObtenerReservaController } from './interface/obtener-reserva.controller';
import {
  TransicionFechaUseCase,
  type ConfirmacionBloqueoEmailPort,
  type UnidadDeTrabajoTransicionPort,
} from './application/transicion-fecha.use-case';
import {
  ObtenerReservaUseCase,
  type ReservaDetalleQueryPort,
} from './application/obtener-reserva.query';
import {
  TransicionPendienteInvitadosUseCase,
  type UnidadDeTrabajoPendienteInvitadosPort,
} from './application/transicion-pendiente-invitados.use-case';
import {
  ProgramarVisitaUseCase,
  type EnviarConfirmacionVisitaPort,
  type UnidadDeTrabajoProgramarVisitaPort,
} from './application/programar-visita.use-case';
import {
  ExtenderBloqueoUseCase,
  type UnidadDeTrabajoExtenderBloqueoPort,
} from './application/extender-bloqueo.use-case';
import { ReservaDetalleQueryPrismaAdapter } from './infrastructure/reserva-detalle-query.prisma.adapter';
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
  CONFIRMACION_BLOQUEO_EMAIL_PORT,
  FECHA_BLOQUEADA_LIBERACION_PORT,
  FECHA_BLOQUEADA_REPOSITORY_PORT,
  PROMOCION_COLA_PORT,
  RESERVA_DETALLE_QUERY_PORT,
  RESERVA_ESTADO_PORT,
  TARIFA_ESTIMADA_PORT,
  TENANT_SETTINGS_PORT,
  CONFIRMACION_VISITA_EMAIL_PORT,
  UNIDAD_DE_TRABAJO_EXTENDER_BLOQUEO_PORT,
  UNIDAD_DE_TRABAJO_PENDIENTE_INVITADOS_PORT,
  UNIDAD_DE_TRABAJO_PROGRAMAR_VISITA_PORT,
  UNIDAD_DE_TRABAJO_PORT,
  UNIDAD_DE_TRABAJO_TRANSICION_PORT,
} from './reservas.tokens';

@Module({
  imports: [PrismaModule, ComunicacionesModule, TarifasModule],
  controllers: [
    AltaConsultaController,
    TransicionFechaController,
    PendienteInvitadosController,
    ProgramarVisitaController,
    ExtenderBloqueoController,
    ObtenerReservaController,
  ],
  providers: [
    {
      provide: UNIDAD_DE_TRABAJO_PORT,
      inject: [PrismaService],
      useFactory: (prisma: PrismaService) => new UnidadDeTrabajoPrismaAdapter(prisma),
    },
    {
      provide: TARIFA_ESTIMADA_PORT,
      inject: [CalculadoraTarifaService],
      useFactory: (calculadora: CalculadoraTarifaService) =>
        new TarifaEstimadaAdapter(calculadora),
    },
    {
      provide: AltaConsultaUseCase,
      inject: [
        UNIDAD_DE_TRABAJO_PORT,
        DespacharEmailService,
        CLOCK_PORT,
        TARIFA_ESTIMADA_PORT,
        TENANT_SETTINGS_PORT,
      ],
      useFactory: (
        unidadDeTrabajo: UnidadDeTrabajoPort,
        finalizarEnvio: DespacharEmailService,
        clock: ClockPort,
        tarifaEstimada: TarifaEstimadaPort,
        tenantSettings: TenantSettingsPort,
      ) =>
        new AltaConsultaUseCase({
          unidadDeTrabajo,
          finalizarEnvio,
          clock,
          tarifaEstimada,
          tenantSettings,
        }),
    },
    {
      provide: UNIDAD_DE_TRABAJO_TRANSICION_PORT,
      inject: [PrismaService],
      useFactory: (prisma: PrismaService) =>
        new UnidadDeTrabajoTransicionPrismaAdapter(prisma),
    },
    {
      provide: CONFIRMACION_BLOQUEO_EMAIL_PORT,
      inject: [DespacharEmailService],
      useFactory: (motor: DespacharEmailService) =>
        new ConfirmacionBloqueoEmailAdapter(motor),
    },
    {
      provide: TransicionFechaUseCase,
      inject: [
        UNIDAD_DE_TRABAJO_TRANSICION_PORT,
        CONFIRMACION_BLOQUEO_EMAIL_PORT,
        CLOCK_PORT,
        TENANT_SETTINGS_PORT,
      ],
      useFactory: (
        unidadDeTrabajo: UnidadDeTrabajoTransicionPort,
        confirmacionBloqueo: ConfirmacionBloqueoEmailPort,
        clock: ClockPort,
        tenantSettings: TenantSettingsPort,
      ) =>
        new TransicionFechaUseCase({
          unidadDeTrabajo,
          confirmacionBloqueo,
          clock,
          tenantSettings,
        }),
    },
    {
      provide: UNIDAD_DE_TRABAJO_PENDIENTE_INVITADOS_PORT,
      inject: [PrismaService],
      useFactory: (prisma: PrismaService) =>
        new UnidadDeTrabajoPendienteInvitadosPrismaAdapter(prisma),
    },
    {
      provide: TransicionPendienteInvitadosUseCase,
      inject: [
        UNIDAD_DE_TRABAJO_PENDIENTE_INVITADOS_PORT,
        CLOCK_PORT,
        TENANT_SETTINGS_PORT,
      ],
      useFactory: (
        unidadDeTrabajo: UnidadDeTrabajoPendienteInvitadosPort,
        clock: ClockPort,
        tenantSettings: TenantSettingsPort,
      ) =>
        new TransicionPendienteInvitadosUseCase({
          unidadDeTrabajo,
          clock,
          tenantSettings,
        }),
    },
    {
      provide: UNIDAD_DE_TRABAJO_PROGRAMAR_VISITA_PORT,
      inject: [PrismaService],
      useFactory: (prisma: PrismaService) =>
        new UnidadDeTrabajoProgramarVisitaPrismaAdapter(prisma),
    },
    {
      provide: CONFIRMACION_VISITA_EMAIL_PORT,
      inject: [DespacharEmailService, PrismaService],
      useFactory: (motor: DespacharEmailService, prisma: PrismaService) =>
        new ConfirmacionVisitaEmailAdapter(motor, prisma),
    },
    {
      provide: ProgramarVisitaUseCase,
      inject: [
        UNIDAD_DE_TRABAJO_PROGRAMAR_VISITA_PORT,
        CLOCK_PORT,
        TENANT_SETTINGS_PORT,
        CONFIRMACION_VISITA_EMAIL_PORT,
      ],
      useFactory: (
        unidadDeTrabajo: UnidadDeTrabajoProgramarVisitaPort,
        clock: ClockPort,
        tenantSettings: TenantSettingsPort,
        confirmacionVisita: EnviarConfirmacionVisitaPort,
      ) =>
        new ProgramarVisitaUseCase({
          unidadDeTrabajo,
          clock,
          tenantSettings,
          confirmacionVisita,
        }),
    },
    {
      provide: UNIDAD_DE_TRABAJO_EXTENDER_BLOQUEO_PORT,
      inject: [PrismaService],
      useFactory: (prisma: PrismaService) =>
        new UnidadDeTrabajoExtenderBloqueoPrismaAdapter(prisma),
    },
    {
      provide: ExtenderBloqueoUseCase,
      inject: [UNIDAD_DE_TRABAJO_EXTENDER_BLOQUEO_PORT, CLOCK_PORT],
      useFactory: (
        unidadDeTrabajo: UnidadDeTrabajoExtenderBloqueoPort,
        clock: ClockPort,
      ) =>
        new ExtenderBloqueoUseCase({
          unidadDeTrabajo,
          clock,
        }),
    },
    {
      provide: RESERVA_DETALLE_QUERY_PORT,
      inject: [PrismaService],
      useFactory: (prisma: PrismaService) =>
        new ReservaDetalleQueryPrismaAdapter(prisma),
    },
    {
      provide: ObtenerReservaUseCase,
      inject: [RESERVA_DETALLE_QUERY_PORT],
      useFactory: (reservaDetalle: ReservaDetalleQueryPort) =>
        new ObtenerReservaUseCase({ reservaDetalle }),
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
    TransicionFechaUseCase,
    TransicionPendienteInvitadosUseCase,
    ProgramarVisitaUseCase,
    ExtenderBloqueoUseCase,
    ObtenerReservaUseCase,
  ],
})
export class ReservasModule {}
