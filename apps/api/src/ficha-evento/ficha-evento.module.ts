/**
 * Módulo `ficha-evento` (US-025 / UC-20, hexagonal).
 *
 * Compone los casos de uso de la FICHA_OPERATIVA (leer / guardar parcial / cerrar) vía
 * factory, inyectando los puertos de dominio por token (Symbol) que resuelven a sus
 * adaptadores Prisma (carga con RLS, unidades de trabajo transaccionales de guardado y
 * cierre) y el reloj del sistema. El controlador traduce HTTP ↔ aplicación.
 */
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { PrismaModule } from '../shared/prisma/prisma.module';
import { PrismaService } from '../shared/prisma/prisma.service';
import { CronTokenGuard } from '../shared/auth/cron-token.guard';
import type {
  CargarReservaConFichaPort,
  ClockPort,
  RepositoriosCierreFicha,
  RepositoriosGuardadoFicha,
  UnidadDeTrabajoFichaPort,
} from './domain/ficha-operativa.ports';
import type {
  CandidatasCierreFichaPort,
  CierreFichaVencidaPort,
} from './application/cerrar-fichas-vencidas.service';
import { LeerFichaOperativaUseCase } from './application/leer-ficha-operativa.use-case';
import { GuardarFichaOperativaUseCase } from './application/guardar-ficha-operativa.use-case';
import { CerrarFichaOperativaUseCase } from './application/cerrar-ficha-operativa.use-case';
import { CerrarFichasVencidasService } from './application/cerrar-fichas-vencidas.service';
import { CargarReservaConFichaPrismaAdapter } from './infrastructure/cargar-reserva-con-ficha.prisma.adapter';
import { GuardadoFichaUoWPrismaAdapter } from './infrastructure/guardado-ficha-uow.prisma.adapter';
import { CierreFichaUoWPrismaAdapter } from './infrastructure/cierre-ficha-uow.prisma.adapter';
import { CandidatasCierreFichaPrismaAdapter } from './infrastructure/candidatas-cierre-ficha.prisma.adapter';
import { CierreFichaVencidaUoWPrismaAdapter } from './infrastructure/cierre-ficha-vencida-uow.prisma.adapter';
import { SistemaClockFichaAdapter } from './infrastructure/sistema-clock-ficha.adapter';
import { FichaOperativaController } from './interface/ficha-operativa.controller';
import { BarridoFichasController } from './interface/barrido-fichas.controller';
import { BarridoFichasScheduler } from './interface/barrido-fichas.scheduler';
import {
  CANDIDATAS_CIERRE_FICHA_PORT,
  CARGAR_RESERVA_CON_FICHA_PORT,
  CIERRE_FICHA_VENCIDA_PORT,
  CLOCK_FICHA_PORT,
  UNIDAD_DE_TRABAJO_CIERRE_FICHA_PORT,
  UNIDAD_DE_TRABAJO_GUARDADO_FICHA_PORT,
} from './ficha-evento.tokens';

@Module({
  imports: [PrismaModule, ConfigModule, ScheduleModule.forRoot()],
  controllers: [FichaOperativaController, BarridoFichasController],
  providers: [
    CronTokenGuard,
    BarridoFichasScheduler,
    {
      provide: CANDIDATAS_CIERRE_FICHA_PORT,
      inject: [PrismaService],
      useFactory: (prisma: PrismaService) =>
        new CandidatasCierreFichaPrismaAdapter(prisma),
    },
    {
      provide: CIERRE_FICHA_VENCIDA_PORT,
      inject: [PrismaService],
      useFactory: (prisma: PrismaService) =>
        new CierreFichaVencidaUoWPrismaAdapter(prisma),
    },
    {
      provide: CerrarFichasVencidasService,
      inject: [CANDIDATAS_CIERRE_FICHA_PORT, CIERRE_FICHA_VENCIDA_PORT],
      useFactory: (
        candidatas: CandidatasCierreFichaPort,
        cierre: CierreFichaVencidaPort,
      ) => new CerrarFichasVencidasService({ candidatas, cierre }),
    },
    {
      provide: CARGAR_RESERVA_CON_FICHA_PORT,
      inject: [PrismaService],
      useFactory: (prisma: PrismaService) => {
        const adapter = new CargarReservaConFichaPrismaAdapter(prisma);
        return adapter.cargar;
      },
    },
    {
      provide: UNIDAD_DE_TRABAJO_GUARDADO_FICHA_PORT,
      inject: [PrismaService],
      useFactory: (prisma: PrismaService) => new GuardadoFichaUoWPrismaAdapter(prisma),
    },
    {
      provide: UNIDAD_DE_TRABAJO_CIERRE_FICHA_PORT,
      inject: [PrismaService],
      useFactory: (prisma: PrismaService) => new CierreFichaUoWPrismaAdapter(prisma),
    },
    { provide: CLOCK_FICHA_PORT, useClass: SistemaClockFichaAdapter },
    {
      provide: LeerFichaOperativaUseCase,
      inject: [CARGAR_RESERVA_CON_FICHA_PORT],
      useFactory: (cargarReservaConFicha: CargarReservaConFichaPort) =>
        new LeerFichaOperativaUseCase({ cargarReservaConFicha }),
    },
    {
      provide: GuardarFichaOperativaUseCase,
      inject: [
        UNIDAD_DE_TRABAJO_GUARDADO_FICHA_PORT,
        CARGAR_RESERVA_CON_FICHA_PORT,
        CLOCK_FICHA_PORT,
      ],
      useFactory: (
        unidadDeTrabajo: UnidadDeTrabajoFichaPort<RepositoriosGuardadoFicha>,
        cargarReservaConFicha: CargarReservaConFichaPort,
        clock: ClockPort,
      ) =>
        new GuardarFichaOperativaUseCase({
          unidadDeTrabajo,
          cargarReservaConFicha,
          clock,
        }),
    },
    {
      provide: CerrarFichaOperativaUseCase,
      inject: [
        UNIDAD_DE_TRABAJO_CIERRE_FICHA_PORT,
        CARGAR_RESERVA_CON_FICHA_PORT,
        CLOCK_FICHA_PORT,
      ],
      useFactory: (
        unidadDeTrabajo: UnidadDeTrabajoFichaPort<RepositoriosCierreFicha>,
        cargarReservaConFicha: CargarReservaConFichaPort,
        clock: ClockPort,
      ) =>
        new CerrarFichaOperativaUseCase({
          unidadDeTrabajo,
          cargarReservaConFicha,
          clock,
        }),
    },
  ],
  exports: [
    LeerFichaOperativaUseCase,
    GuardarFichaOperativaUseCase,
    CerrarFichaOperativaUseCase,
    CerrarFichasVencidasService,
  ],
})
export class FichaEventoModule {}
