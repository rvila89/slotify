/**
 * Módulo reservas (US-040 + US-041, hexagonal). Enlaza los puertos de las
 * operaciones `bloquearFecha()` y `liberarFecha()` a sus adaptadores Prisma y
 * compone los servicios de dominio (puros) vía factory, inyectando los puertos por
 * token (Symbol).
 */
import { Logger, Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
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
import { UnidadDeTrabajoResultadoVisitaPrismaAdapter } from './infrastructure/registrar-resultado-visita-uow.prisma.adapter';
import { CargarClienteResultadoVisitaPrismaAdapter } from './infrastructure/cargar-cliente-resultado-visita.prisma.adapter';
import { UnidadDeTrabajoExtenderBloqueoPrismaAdapter } from './infrastructure/extender-bloqueo-uow.prisma.adapter';
import { ConfirmacionBloqueoEmailAdapter } from './infrastructure/confirmacion-bloqueo-email.adapter';
import { ConfirmacionVisitaEmailAdapter } from './infrastructure/confirmacion-visita-email.adapter';
import { ConfirmacionResultadoVisitaEmailAdapter } from './infrastructure/confirmacion-resultado-visita-email.adapter';
import { TarifaEstimadaAdapter } from './infrastructure/tarifa-estimada.adapter';
import { AltaConsultaController } from './interface/alta-consulta.controller';
import { TransicionFechaController } from './interface/transicion-fecha.controller';
import { PendienteInvitadosController } from './interface/pendiente-invitados.controller';
import { ProgramarVisitaController } from './interface/programar-visita.controller';
import { RegistrarResultadoVisitaController } from './interface/registrar-resultado-visita.controller';
import { ExtenderBloqueoController } from './interface/extender-bloqueo.controller';
import { ObtenerReservaController } from './interface/obtener-reserva.controller';
import { ObtenerColaEsperaController } from './interface/obtener-cola-espera.controller';
import { ListarReservasController } from './interface/listar-reservas.controller';
import { ListarHistoricoController } from './interface/listar-historico.controller';
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
  ObtenerColaEsperaUseCase,
  type ColaEsperaQueryPort,
} from './application/obtener-cola-espera.query';
import { ColaEsperaQueryPrismaAdapter } from './infrastructure/cola-espera-query.prisma.adapter';
import {
  ListarReservasUseCase,
  type PipelineQueryPort,
} from './application/listar-reservas.use-case';
import { ListarReservasPrismaAdapter } from './infrastructure/listar-reservas.prisma.adapter';
import {
  ListarHistoricoUseCase,
  type HistoricoQueryPort,
} from './application/listar-historico.use-case';
import { ListarHistoricoPrismaAdapter } from './infrastructure/listar-historico.prisma.adapter';
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
  RegistrarResultadoVisitaUseCase,
  type CargarClienteResultadoVisitaPort,
  type EnviarConfirmacionResultadoVisitaPort,
  type TenantSettingsResultadoVisitaPort,
  type UnidadDeTrabajoResultadoVisitaPort,
} from './application/registrar-resultado-visita.use-case';
import {
  ExtenderBloqueoUseCase,
  type UnidadDeTrabajoExtenderBloqueoPort,
} from './application/extender-bloqueo.use-case';
import {
  ExpirarConsultasVencidasService,
  type CandidatasExpiracionPort,
  type ExpiracionReservaPort,
} from './application/expirar-consultas-vencidas.service';
import { CandidatasExpiracionPrismaAdapter } from './infrastructure/candidatas-expiracion.prisma.adapter';
import { ExpiracionReservaUoWPrismaAdapter } from './infrastructure/expiracion-reserva-uow.prisma.adapter';
import {
  PromoverPrimeroEnColaService,
  type PromocionColaUoWPort,
} from './application/promover-primero-en-cola.service';
import { PromocionColaUoWPrismaAdapter } from './infrastructure/promocion-cola-uow.prisma.adapter';
import { PromocionColaPrismaAdapter } from './infrastructure/promocion-cola.prisma.adapter';
import {
  PromoverManualEnColaService,
  type PromocionManualColaUoWPort,
} from './application/promover-manual-en-cola.service';
import { PromocionManualColaUoWPrismaAdapter } from './infrastructure/promocion-manual-cola-uow.prisma.adapter';
import { PromoverManualController } from './interface/promover-manual.controller';
import { BarridoExpiracionController } from './interface/barrido-expiracion.controller';
import { BarridoExpiracionScheduler } from './interface/barrido-expiracion.scheduler';
import { BarridoEventosController } from './interface/barrido-eventos.controller';
import { BarridoEventosScheduler } from './interface/barrido-eventos.scheduler';
import { BarridoCompletadasController } from './interface/barrido-completadas.controller';
import { BarridoCompletadasScheduler } from './interface/barrido-completadas.scheduler';
import {
  IniciarEventosDelDiaService,
  type AlertaInicioEventoPort,
  type CandidatasInicioEventoPort,
  type InicioEventoPort,
} from './application/iniciar-eventos-del-dia.service';
import { CandidatasInicioEventoPrismaAdapter } from './infrastructure/candidatas-inicio-evento.prisma.adapter';
import { InicioEventoUoWPrismaAdapter } from './infrastructure/inicio-evento-uow.prisma.adapter';
import { AlertaInicioEventoAdapter } from './infrastructure/alerta-inicio-evento.adapter';
import {
  ArchivarReservasCompletadasService,
  type AlertaFianzaPendientePort,
  type ArchivadoPort,
  type CandidatasArchivadoPort,
} from './application/archivar-reservas-completadas.service';
import { CandidatasArchivadoPrismaAdapter } from './infrastructure/candidatas-archivado.prisma.adapter';
import { ArchivadoUoWPrismaAdapter } from './infrastructure/archivado-uow.prisma.adapter';
import { AlertaFianzaPendientePrismaAdapter } from './infrastructure/alerta-fianza-pendiente.prisma.adapter';
import {
  FinalizarEventoUseCase,
  type DispararE5Port,
  type DocumentacionEventoPort,
  type FinalizarEventoComando,
  type ReservaFinalizacion,
  type UnidadDeTrabajoFinalizacionPort,
} from './application/finalizar-evento.use-case';
import { CargarReservaFinalizacionPrismaAdapter } from './infrastructure/cargar-reserva-finalizacion.prisma.adapter';
import { UnidadDeTrabajoFinalizacionPrismaAdapter } from './infrastructure/finalizar-evento-uow.prisma.adapter';
import {
  ArchivarReservaManualUseCase,
  type ArchivarReservaManualComando,
  type ReservaArchivable,
  type ReservaHidratadaArchivado,
  type UnidadDeTrabajoArchivadoManualPort,
} from './application/archivar-reserva-manual.use-case';
import { CargarReservaArchivadoManualPrismaAdapter } from './infrastructure/cargar-reserva-archivado-manual.prisma.adapter';
import { ArchivarReservaManualUoWPrismaAdapter } from './infrastructure/archivar-reserva-manual-uow.prisma.adapter';
import { ArchivarReservaManualController } from './interface/archivar-reserva-manual.controller';
import {
  DescartarConsultaPorClienteUseCase,
  type DescarteConsultaUoWPort,
} from './application/descartar-consulta-por-cliente.use-case';
import { DescartarConsultaUoWPrismaAdapter } from './infrastructure/descartar-consulta-uow.prisma.adapter';
import { DescartarConsultaController } from './interface/descartar-consulta.controller';
import { DispararE5Adapter } from './infrastructure/disparar-e5.adapter';
import { DocumentacionEventoStubAdapter } from './infrastructure/documentacion-evento.stub.adapter';
import { FinalizarEventoController } from './interface/finalizar-evento.controller';
import {
  ForzarInicioEventoUseCase,
  type ForzarInicioEventoComando,
  type ReservaForzarInicio,
  type UnidadDeTrabajoForzarInicioPort,
} from './application/forzar-inicio-evento.use-case';
import { CargarReservaForzarInicioPrismaAdapter } from './infrastructure/cargar-reserva-forzar-inicio.prisma.adapter';
import { UnidadDeTrabajoForzarInicioPrismaAdapter } from './infrastructure/forzar-inicio-evento-uow.prisma.adapter';
import { ForzarInicioEventoController } from './interface/forzar-inicio-evento.controller';
import {
  RegistrarIbanDevolucionUseCase,
  type DispararE8Port,
  type RegistrarIbanDevolucionComando,
  type ReservaIbanDevolucion,
  type UnidadDeTrabajoIbanDevolucionPort,
} from './application/registrar-iban-devolucion.use-case';
import { CargarReservaIbanDevolucionPrismaAdapter } from './infrastructure/cargar-reserva-iban-devolucion.prisma.adapter';
import { RegistrarIbanDevolucionUoWPrismaAdapter } from './infrastructure/registrar-iban-devolucion-uow.prisma.adapter';
import { DispararE8Adapter } from './infrastructure/disparar-e8.adapter';
import { RegistrarIbanDevolucionController } from './interface/registrar-iban-devolucion.controller';
import {
  ActualizarDatosFiscalesClienteUseCase,
  type ActualizarDatosFiscalesClienteComando,
  type ReservaDatosFiscales,
  type UnidadDeTrabajoDatosFiscalesPort,
} from './application/actualizar-datos-fiscales-cliente.use-case';
import { CargarReservaDatosFiscalesPrismaAdapter } from './infrastructure/cargar-reserva-datos-fiscales.prisma.adapter';
import { ActualizarDatosFiscalesUoWPrismaAdapter } from './infrastructure/actualizar-datos-fiscales-uow.prisma.adapter';
import { ActualizarDatosFiscalesClienteController } from './interface/actualizar-datos-fiscales-cliente.controller';
import { CronTokenGuard } from '../shared/auth/cron-token.guard';
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
  UNIDAD_DE_TRABAJO_RESULTADO_VISITA_PORT,
  CONFIRMACION_RESULTADO_VISITA_EMAIL_PORT,
  CARGAR_CLIENTE_RESULTADO_VISITA_PORT,
  UNIDAD_DE_TRABAJO_EXTENDER_BLOQUEO_PORT,
  UNIDAD_DE_TRABAJO_PENDIENTE_INVITADOS_PORT,
  UNIDAD_DE_TRABAJO_PROGRAMAR_VISITA_PORT,
  UNIDAD_DE_TRABAJO_PORT,
  UNIDAD_DE_TRABAJO_TRANSICION_PORT,
  CANDIDATAS_EXPIRACION_PORT,
  EXPIRACION_RESERVA_PORT,
  PROMOCION_COLA_UOW_PORT,
  PROMOCION_MANUAL_COLA_UOW_PORT,
  COLA_ESPERA_QUERY_PORT,
  PIPELINE_QUERY_PORT,
  HISTORICO_QUERY_PORT,
  CANDIDATAS_INICIO_EVENTO_PORT,
  INICIO_EVENTO_PORT,
  ALERTA_INICIO_EVENTO_PORT,
  CARGAR_RESERVA_FINALIZACION_PORT,
  UNIDAD_DE_TRABAJO_FINALIZACION_PORT,
  DISPARAR_E5_PORT,
  DOCUMENTACION_EVENTO_PORT,
  CARGAR_RESERVA_FORZAR_INICIO_PORT,
  UNIDAD_DE_TRABAJO_FORZAR_INICIO_PORT,
  CARGAR_RESERVA_IBAN_DEVOLUCION_PORT,
  UNIDAD_DE_TRABAJO_IBAN_DEVOLUCION_PORT,
  DISPARAR_E8_PORT,
  CARGAR_RESERVA_DATOS_FISCALES_PORT,
  UNIDAD_DE_TRABAJO_DATOS_FISCALES_PORT,
  CANDIDATAS_ARCHIVADO_PORT,
  ARCHIVADO_PORT,
  ALERTA_FIANZA_PENDIENTE_PORT,
  CARGAR_RESERVA_ARCHIVADO_MANUAL_PORT,
  UNIDAD_DE_TRABAJO_ARCHIVADO_MANUAL_PORT,
  UNIDAD_DE_TRABAJO_DESCARTE_CONSULTA_PORT,
} from './reservas.tokens';

@Module({
  imports: [
    ScheduleModule.forRoot(),
    PrismaModule,
    ComunicacionesModule,
    TarifasModule,
  ],
  controllers: [
    AltaConsultaController,
    TransicionFechaController,
    PendienteInvitadosController,
    ProgramarVisitaController,
    RegistrarResultadoVisitaController,
    ExtenderBloqueoController,
    ObtenerReservaController,
    ObtenerColaEsperaController,
    ListarReservasController,
    ListarHistoricoController,
    BarridoExpiracionController,
    BarridoEventosController,
    BarridoCompletadasController,
    PromoverManualController,
    FinalizarEventoController,
    ForzarInicioEventoController,
    RegistrarIbanDevolucionController,
    ActualizarDatosFiscalesClienteController,
    ArchivarReservaManualController,
    DescartarConsultaController,
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
    // US-009 — registro del resultado de visita «cliente interesado» (2.v → 2.b).
    {
      provide: UNIDAD_DE_TRABAJO_RESULTADO_VISITA_PORT,
      inject: [PrismaService],
      useFactory: (prisma: PrismaService) =>
        new UnidadDeTrabajoResultadoVisitaPrismaAdapter(prisma),
    },
    {
      provide: CONFIRMACION_RESULTADO_VISITA_EMAIL_PORT,
      inject: [DespacharEmailService, PrismaService],
      useFactory: (motor: DespacharEmailService, prisma: PrismaService) =>
        new ConfirmacionResultadoVisitaEmailAdapter(motor, prisma),
    },
    // US-010 — carga del CLIENTE para la validación de datos obligatorios UC-14.
    {
      provide: CARGAR_CLIENTE_RESULTADO_VISITA_PORT,
      inject: [PrismaService],
      useFactory: (prisma: PrismaService) =>
        new CargarClienteResultadoVisitaPrismaAdapter(prisma),
    },
    {
      provide: RegistrarResultadoVisitaUseCase,
      inject: [
        UNIDAD_DE_TRABAJO_RESULTADO_VISITA_PORT,
        CLOCK_PORT,
        TENANT_SETTINGS_PORT,
        CONFIRMACION_RESULTADO_VISITA_EMAIL_PORT,
        CARGAR_CLIENTE_RESULTADO_VISITA_PORT,
      ],
      useFactory: (
        unidadDeTrabajo: UnidadDeTrabajoResultadoVisitaPort,
        clock: ClockPort,
        tenantSettings: TenantSettingsResultadoVisitaPort,
        confirmacionResultado: EnviarConfirmacionResultadoVisitaPort,
        cargarCliente: CargarClienteResultadoVisitaPort,
      ) =>
        new RegistrarResultadoVisitaUseCase({
          unidadDeTrabajo,
          clock,
          tenantSettings,
          confirmacionResultado,
          cargarCliente,
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
    // US-017 — lectura de la cola de espera (GET /reservas/{id}/cola).
    {
      provide: COLA_ESPERA_QUERY_PORT,
      inject: [PrismaService, CLOCK_PORT],
      useFactory: (prisma: PrismaService, clock: ClockPort) =>
        new ColaEsperaQueryPrismaAdapter(prisma, clock),
    },
    {
      provide: ObtenerColaEsperaUseCase,
      inject: [COLA_ESPERA_QUERY_PORT],
      useFactory: (colaEspera: ColaEsperaQueryPort) =>
        new ObtenerColaEsperaUseCase({ colaEspera }),
    },
    // US-049 — pipeline de reservas activas (GET /reservas → ReservaListResponse).
    {
      provide: PIPELINE_QUERY_PORT,
      inject: [PrismaService],
      useFactory: (prisma: PrismaService) =>
        new ListarReservasPrismaAdapter(prisma),
    },
    {
      provide: ListarReservasUseCase,
      inject: [PIPELINE_QUERY_PORT],
      useFactory: (pipeline: PipelineQueryPort) =>
        new ListarReservasUseCase({ pipeline }),
    },
    // US-042 — histórico de reservas cerradas (GET /historico → ReservaHistoricoListResponse).
    {
      provide: HISTORICO_QUERY_PORT,
      inject: [PrismaService],
      useFactory: (prisma: PrismaService) =>
        new ListarHistoricoPrismaAdapter(prisma),
    },
    {
      provide: ListarHistoricoUseCase,
      inject: [HISTORICO_QUERY_PORT],
      useFactory: (historico: HistoricoQueryPort) =>
        new ListarHistoricoUseCase({ historico }),
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
    // US-018 — el seam de promoción resuelve al adaptador REAL (sustituye al stub
    // no-op de US-012/US-041). El stub `PromocionColaStubAdapter` queda importado solo
    // para el test de binding (verifica que YA NO se resuelve a él).
    {
      provide: PROMOCION_COLA_PORT,
      inject: [PromoverPrimeroEnColaService],
      useFactory: (servicio: PromoverPrimeroEnColaService) =>
        new PromocionColaPrismaAdapter(servicio),
    },
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
    // US-012 — barrido de expiración por TTL.
    {
      provide: CANDIDATAS_EXPIRACION_PORT,
      inject: [PrismaService],
      useFactory: (prisma: PrismaService) =>
        new CandidatasExpiracionPrismaAdapter(prisma),
    },
    {
      provide: EXPIRACION_RESERVA_PORT,
      inject: [PrismaService, PROMOCION_COLA_PORT],
      useFactory: (prisma: PrismaService, promocion: PromocionColaPort) =>
        new ExpiracionReservaUoWPrismaAdapter(prisma, promocion),
    },
    {
      provide: ExpirarConsultasVencidasService,
      inject: [CANDIDATAS_EXPIRACION_PORT, EXPIRACION_RESERVA_PORT],
      useFactory: (
        candidatas: CandidatasExpiracionPort,
        expiracion: ExpiracionReservaPort,
      ) => new ExpirarConsultasVencidasService({ candidatas, expiracion }),
    },
    // US-018 — promoción automática del primero en cola (UoW atómica + caso de uso).
    {
      provide: PROMOCION_COLA_UOW_PORT,
      inject: [PrismaService],
      useFactory: (prisma: PrismaService) =>
        new PromocionColaUoWPrismaAdapter(
          prisma,
          new FechaBloqueadaPrismaAdapter(prisma),
          new TenantSettingsPrismaAdapter(prisma),
        ),
    },
    {
      provide: PromoverPrimeroEnColaService,
      inject: [PROMOCION_COLA_UOW_PORT],
      useFactory: (uow: PromocionColaUoWPort) =>
        new PromoverPrimeroEnColaService({ uow }),
    },
    // US-019 — promoción MANUAL de una consulta arbitraria de la cola por el Gestor.
    {
      provide: PROMOCION_MANUAL_COLA_UOW_PORT,
      inject: [PrismaService],
      useFactory: (prisma: PrismaService) =>
        new PromocionManualColaUoWPrismaAdapter(
          prisma,
          new FechaBloqueadaPrismaAdapter(prisma),
          new TenantSettingsPrismaAdapter(prisma),
        ),
    },
    {
      provide: PromoverManualEnColaService,
      inject: [PROMOCION_MANUAL_COLA_UOW_PORT],
      useFactory: (uow: PromocionManualColaUoWPort) =>
        new PromoverManualEnColaService({ uow }),
    },
    // US-031 — barrido de inicio automático de evento en T-0 (cross-tenant read + UoW
    // por RESERVA con SELECT … FOR UPDATE bajo RLS del tenant de la fila; alertas de
    // Sistema desacopladas de la superficie de notificaciones US-044).
    {
      provide: CANDIDATAS_INICIO_EVENTO_PORT,
      inject: [PrismaService],
      useFactory: (prisma: PrismaService) =>
        new CandidatasInicioEventoPrismaAdapter(prisma),
    },
    {
      provide: INICIO_EVENTO_PORT,
      inject: [PrismaService],
      useFactory: (prisma: PrismaService) => new InicioEventoUoWPrismaAdapter(prisma),
    },
    { provide: ALERTA_INICIO_EVENTO_PORT, useClass: AlertaInicioEventoAdapter },
    {
      provide: IniciarEventosDelDiaService,
      inject: [
        CANDIDATAS_INICIO_EVENTO_PORT,
        INICIO_EVENTO_PORT,
        ALERTA_INICIO_EVENTO_PORT,
      ],
      useFactory: (
        candidatas: CandidatasInicioEventoPort,
        inicio: InicioEventoPort,
        alerta: AlertaInicioEventoPort,
      ) => new IniciarEventosDelDiaService({ candidatas, inicio, alerta }),
    },
    // US-037 — barrido de archivado automático en T+7d (cross-tenant read + UoW por
    // RESERVA con SELECT … FOR UPDATE bajo RLS del tenant de la fila; alerta interna FA-01
    // como entrada de AUDIT_LOG con anti-duplicación, desacoplada de la superficie de
    // notificaciones US-044).
    {
      provide: CANDIDATAS_ARCHIVADO_PORT,
      inject: [PrismaService],
      useFactory: (prisma: PrismaService) =>
        new CandidatasArchivadoPrismaAdapter(prisma),
    },
    {
      provide: ARCHIVADO_PORT,
      inject: [PrismaService],
      useFactory: (prisma: PrismaService) => new ArchivadoUoWPrismaAdapter(prisma),
    },
    {
      provide: ALERTA_FIANZA_PENDIENTE_PORT,
      inject: [PrismaService],
      useFactory: (prisma: PrismaService) =>
        new AlertaFianzaPendientePrismaAdapter(prisma),
    },
    {
      provide: ArchivarReservasCompletadasService,
      inject: [
        CANDIDATAS_ARCHIVADO_PORT,
        ARCHIVADO_PORT,
        ALERTA_FIANZA_PENDIENTE_PORT,
      ],
      useFactory: (
        candidatas: CandidatasArchivadoPort,
        archivado: ArchivadoPort,
        alerta: AlertaFianzaPendientePort,
      ) => {
        // El fallo aislado por RESERVA se registra vía el Logger de Nest (observabilidad,
        // en paralelo a los demás barridos); la aplicación solo conoce el puerto mínimo.
        const logger = new Logger('BarridoArchivadoCompletadas');
        return new ArchivarReservasCompletadasService({
          candidatas,
          archivado,
          alerta,
          logger: { error: (mensaje: string) => logger.error(mensaje) },
        });
      },
    },
    // US-034 — finalización manual del evento (evento_en_curso → post_evento). La
    // transición + AUDIT_LOG (origen Usuario) + marca NPS van en la transacción bajo
    // SELECT … FOR UPDATE de la fila RESERVA; el disparo de E5 es POST-COMMIT best-effort
    // (reuso del motor de comunicaciones US-045); la advertencia de documentación (US-033)
    // es fail-open.
    {
      provide: CARGAR_RESERVA_FINALIZACION_PORT,
      inject: [PrismaService],
      useFactory: (prisma: PrismaService) =>
        new CargarReservaFinalizacionPrismaAdapter(prisma),
    },
    {
      provide: UNIDAD_DE_TRABAJO_FINALIZACION_PORT,
      inject: [PrismaService],
      useFactory: (prisma: PrismaService) =>
        new UnidadDeTrabajoFinalizacionPrismaAdapter(prisma),
    },
    {
      provide: DISPARAR_E5_PORT,
      inject: [DespacharEmailService, PrismaService],
      useFactory: (motor: DespacharEmailService, prisma: PrismaService) =>
        new DispararE5Adapter(motor, prisma),
    },
    { provide: DOCUMENTACION_EVENTO_PORT, useClass: DocumentacionEventoStubAdapter },
    {
      provide: FinalizarEventoUseCase,
      inject: [
        UNIDAD_DE_TRABAJO_FINALIZACION_PORT,
        CARGAR_RESERVA_FINALIZACION_PORT,
        RESERVA_DETALLE_QUERY_PORT,
        DISPARAR_E5_PORT,
        DOCUMENTACION_EVENTO_PORT,
      ],
      useFactory: (
        unidadDeTrabajo: UnidadDeTrabajoFinalizacionPort,
        cargador: CargarReservaFinalizacionPrismaAdapter,
        reservaDetalle: ReservaDetalleQueryPort,
        dispararE5: DispararE5Port,
        documentacion: DocumentacionEventoPort,
      ) =>
        new FinalizarEventoUseCase({
          unidadDeTrabajo,
          cargarReserva: (comando: FinalizarEventoComando): Promise<ReservaFinalizacion | null> =>
            cargador.cargar(comando),
          // Relectura POST-COMMIT de la RESERVA completa reusando la MISMA lectura de
          // GET /reservas/{id} (bajo RLS del tenant) para hidratar `allOf(Reserva)` (US-034 D-2).
          cargarReservaDetalle: (comando: FinalizarEventoComando) =>
            reservaDetalle.buscarDetalle({
              tenantId: comando.tenantId,
              reservaId: comando.reservaId,
            }),
          dispararE5,
          documentacion,
        }),
    },
    // US-032 — forzado manual del inicio de evento (reserva_confirmada → evento_en_curso).
    // Reutiliza las guardas de dominio de US-031 (resolverInicioEvento + precondiciones), añade
    // la guarda de fecha esDiaDelEvento y FUERZA la transición aunque haya precondiciones
    // incumplidas. La transición + AUDIT_LOG (origen Usuario, forzado_por_gestor +
    // precondiciones_incumplidas) van en una transacción bajo SELECT … FOR UPDATE de la fila
    // RESERVA (sin locks distribuidos). Muta EXCLUSIVAMENTE `estado` (D-5). Relectura
    // POST-COMMIT reusando GET /reservas/{id} para hidratar allOf(Reserva).
    {
      provide: CARGAR_RESERVA_FORZAR_INICIO_PORT,
      inject: [PrismaService],
      useFactory: (prisma: PrismaService) =>
        new CargarReservaForzarInicioPrismaAdapter(prisma),
    },
    {
      provide: UNIDAD_DE_TRABAJO_FORZAR_INICIO_PORT,
      inject: [PrismaService],
      useFactory: (prisma: PrismaService) =>
        new UnidadDeTrabajoForzarInicioPrismaAdapter(prisma),
    },
    {
      provide: ForzarInicioEventoUseCase,
      inject: [
        UNIDAD_DE_TRABAJO_FORZAR_INICIO_PORT,
        CARGAR_RESERVA_FORZAR_INICIO_PORT,
        RESERVA_DETALLE_QUERY_PORT,
      ],
      useFactory: (
        unidadDeTrabajo: UnidadDeTrabajoForzarInicioPort,
        cargador: CargarReservaForzarInicioPrismaAdapter,
        reservaDetalle: ReservaDetalleQueryPort,
      ) =>
        new ForzarInicioEventoUseCase({
          unidadDeTrabajo,
          cargarReserva: (
            comando: ForzarInicioEventoComando,
          ): Promise<ReservaForzarInicio | null> => cargador.cargar(comando),
          // Relectura POST-COMMIT de la RESERVA completa reusando la MISMA lectura de
          // GET /reservas/{id} (bajo RLS del tenant) para hidratar `allOf(Reserva)` (US-032 D-1).
          cargarReservaDetalle: (comando: ForzarInicioEventoComando) =>
            reservaDetalle.buscarDetalle({
              tenantId: comando.tenantId,
              reservaId: comando.reservaId,
            }),
        }),
    },
    // US-035 — registro del IBAN de devolución (post_evento + fianza > 0 →
    // CLIENTE.iban_devolucion + E8). Validación mod-97 (dominio) previa a la escritura; el
    // UPDATE CLIENTE + AUDIT_LOG (entidad CLIENTE, origen Usuario) van en una transacción
    // bajo RLS; el disparo de E8 es POST-COMMIT best-effort reusando el motor de
    // comunicaciones (US-045) con reenvío D-3A (nueva COMUNICACION E8 por cada corrección).
    {
      provide: CARGAR_RESERVA_IBAN_DEVOLUCION_PORT,
      inject: [PrismaService],
      useFactory: (prisma: PrismaService) =>
        new CargarReservaIbanDevolucionPrismaAdapter(prisma),
    },
    {
      provide: UNIDAD_DE_TRABAJO_IBAN_DEVOLUCION_PORT,
      inject: [PrismaService],
      useFactory: (prisma: PrismaService) =>
        new RegistrarIbanDevolucionUoWPrismaAdapter(prisma),
    },
    {
      provide: DISPARAR_E8_PORT,
      inject: [DespacharEmailService, PrismaService],
      useFactory: (motor: DespacharEmailService, prisma: PrismaService) =>
        new DispararE8Adapter(motor, prisma),
    },
    {
      provide: RegistrarIbanDevolucionUseCase,
      inject: [
        UNIDAD_DE_TRABAJO_IBAN_DEVOLUCION_PORT,
        CARGAR_RESERVA_IBAN_DEVOLUCION_PORT,
        DISPARAR_E8_PORT,
      ],
      useFactory: (
        unidadDeTrabajo: UnidadDeTrabajoIbanDevolucionPort,
        cargador: CargarReservaIbanDevolucionPrismaAdapter,
        dispararE8: DispararE8Port,
      ) =>
        new RegistrarIbanDevolucionUseCase({
          unidadDeTrabajo,
          cargarReserva: (
            comando: RegistrarIbanDevolucionComando,
          ): Promise<ReservaIbanDevolucion | null> => cargador.cargar(comando),
          dispararE8,
        }),
    },
    // US-014 #5 (Parte B) — actualización de datos fiscales del CLIENTE de una RESERVA. El CLIENTE
    // se resuelve a través de la RESERVA bajo RLS del tenant del JWT; el UPDATE PARCIAL de columnas
    // fiscales del CLIENTE + AUDIT_LOG (entidad CLIENTE, origen Usuario) van en una transacción bajo
    // RLS. Alcance estricto (D-3): NO toca RESERVA ni FECHA_BLOQUEADA.
    {
      provide: CARGAR_RESERVA_DATOS_FISCALES_PORT,
      inject: [PrismaService],
      useFactory: (prisma: PrismaService) =>
        new CargarReservaDatosFiscalesPrismaAdapter(prisma),
    },
    {
      provide: UNIDAD_DE_TRABAJO_DATOS_FISCALES_PORT,
      inject: [PrismaService],
      useFactory: (prisma: PrismaService) =>
        new ActualizarDatosFiscalesUoWPrismaAdapter(prisma),
    },
    {
      provide: ActualizarDatosFiscalesClienteUseCase,
      inject: [
        UNIDAD_DE_TRABAJO_DATOS_FISCALES_PORT,
        CARGAR_RESERVA_DATOS_FISCALES_PORT,
      ],
      useFactory: (
        unidadDeTrabajo: UnidadDeTrabajoDatosFiscalesPort,
        cargador: CargarReservaDatosFiscalesPrismaAdapter,
      ) =>
        new ActualizarDatosFiscalesClienteUseCase({
          unidadDeTrabajo,
          cargarReserva: (
            comando: ActualizarDatosFiscalesClienteComando,
          ): Promise<ReservaDatosFiscales | null> => cargador.cargar(comando),
        }),
    },
    // US-038 — archivado MANUAL de la reserva por el Gestor (post_evento →
    // reserva_completada). Reutiliza las guardas puras de US-037 (resolverArchivadoAutomatico
    // + fianzaResuelta); UoW propia delgada scoped a UNA RESERVA del tenant del JWT con
    // SELECT … FOR UPDATE + AUDIT_LOG origen Gestor. Sin email, sin cron, sin filtro T+7d.
    {
      provide: CARGAR_RESERVA_ARCHIVADO_MANUAL_PORT,
      inject: [PrismaService],
      useFactory: (prisma: PrismaService) =>
        new CargarReservaArchivadoManualPrismaAdapter(prisma),
    },
    {
      provide: UNIDAD_DE_TRABAJO_ARCHIVADO_MANUAL_PORT,
      inject: [PrismaService],
      useFactory: (prisma: PrismaService) =>
        new ArchivarReservaManualUoWPrismaAdapter(prisma),
    },
    {
      provide: ArchivarReservaManualUseCase,
      inject: [
        UNIDAD_DE_TRABAJO_ARCHIVADO_MANUAL_PORT,
        CARGAR_RESERVA_ARCHIVADO_MANUAL_PORT,
        RESERVA_DETALLE_QUERY_PORT,
      ],
      useFactory: (
        unidadDeTrabajo: UnidadDeTrabajoArchivadoManualPort,
        cargador: CargarReservaArchivadoManualPrismaAdapter,
        reservaDetalle: ReservaDetalleQueryPort,
      ) =>
        new ArchivarReservaManualUseCase({
          unidadDeTrabajo,
          cargarReserva: (
            comando: ArchivarReservaManualComando,
          ): Promise<ReservaArchivable | null> => cargador.cargar(comando),
          // Relectura POST-COMMIT de la RESERVA completa reusando la MISMA lectura de
          // GET /reservas/{id} (bajo RLS del tenant) para hidratar `allOf(Reserva)`.
          cargarReservaDetalle: (
            comando: ArchivarReservaManualComando,
          ): Promise<ReservaHidratadaArchivado | null> =>
            reservaDetalle.buscarDetalle({
              tenantId: comando.tenantId,
              reservaId: comando.reservaId,
            }),
        }),
    },
    // US-013 — descarte por cliente ({2a,2b,2c,2d,2v} → 2z). UoW atómica propia scoped a UNA
    // RESERVA del tenant del JWT con SELECT … FOR UPDATE: transición a 2z + (según origen)
    // liberación de FECHA_BLOQUEADA (misma mecánica que liberarFecha()) + decremento de cola
    // (2d) + anexado opcional del motivo a notas + AUDIT_LOG (origen Gestor). La promoción A15
    // (2b/2v con cola) se dispara POST-COMMIT vía el seam PROMOCION_COLA_PORT, exactamente una
    // vez. Sin email, sin cron, sin locks distribuidos.
    {
      provide: UNIDAD_DE_TRABAJO_DESCARTE_CONSULTA_PORT,
      inject: [PrismaService, PROMOCION_COLA_PORT],
      useFactory: (prisma: PrismaService, promocion: PromocionColaPort) =>
        new DescartarConsultaUoWPrismaAdapter(prisma, promocion),
    },
    {
      provide: DescartarConsultaPorClienteUseCase,
      inject: [UNIDAD_DE_TRABAJO_DESCARTE_CONSULTA_PORT],
      useFactory: (uow: DescarteConsultaUoWPort) =>
        new DescartarConsultaPorClienteUseCase({ uow }),
    },
    CronTokenGuard,
    BarridoExpiracionScheduler,
    BarridoEventosScheduler,
    BarridoCompletadasScheduler,
  ],
  exports: [
    BloquearFechaService,
    LiberarFechaService,
    LiberarFechasEnLoteService,
    AltaConsultaUseCase,
    TransicionFechaUseCase,
    TransicionPendienteInvitadosUseCase,
    ProgramarVisitaUseCase,
    RegistrarResultadoVisitaUseCase,
    ExtenderBloqueoUseCase,
    ObtenerReservaUseCase,
    ObtenerColaEsperaUseCase,
    ListarReservasUseCase,
    ListarHistoricoUseCase,
    ExpirarConsultasVencidasService,
    PromoverPrimeroEnColaService,
    PromoverManualEnColaService,
    IniciarEventosDelDiaService,
    FinalizarEventoUseCase,
    ForzarInicioEventoUseCase,
    RegistrarIbanDevolucionUseCase,
    ActualizarDatosFiscalesClienteUseCase,
    ArchivarReservasCompletadasService,
    ArchivarReservaManualUseCase,
    DescartarConsultaPorClienteUseCase,
  ],
})
export class ReservasModule {}
