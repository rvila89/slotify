/**
 * Módulo tarifas (US-016, hexagonal). Enlaza los puertos del motor de tarifa a
 * sus adaptadores Prisma y compone `CalculadoraTarifaService` (dominio puro) vía
 * factory, inyectando los puertos por token (Symbol).
 */
import { Module } from '@nestjs/common';
import { PrismaModule } from '../shared/prisma/prisma.module';
import {
  CalculadoraTarifaService,
  TemporadaCalendarioPort,
  TarifaRepositoryPort,
  ExtraRepositoryPort,
  ClockPort,
} from './domain/calculadora-tarifa.service';
import { TemporadaCalendarioPrismaAdapter } from './infrastructure/temporada-calendario.prisma.adapter';
import { TarifaPrismaAdapter } from './infrastructure/tarifa.prisma.adapter';
import { ExtraPrismaAdapter } from './infrastructure/extra.prisma.adapter';
import { SistemaClockAdapter } from './infrastructure/sistema-clock.adapter';
import { TarifasController } from './interface/tarifas.controller';
import {
  TEMPORADA_CALENDARIO_PORT,
  TARIFA_REPOSITORY_PORT,
  EXTRA_REPOSITORY_PORT,
  CLOCK_PORT,
} from './tarifas.tokens';

@Module({
  imports: [PrismaModule],
  controllers: [TarifasController],
  providers: [
    { provide: TEMPORADA_CALENDARIO_PORT, useClass: TemporadaCalendarioPrismaAdapter },
    { provide: TARIFA_REPOSITORY_PORT, useClass: TarifaPrismaAdapter },
    { provide: EXTRA_REPOSITORY_PORT, useClass: ExtraPrismaAdapter },
    { provide: CLOCK_PORT, useClass: SistemaClockAdapter },
    {
      provide: CalculadoraTarifaService,
      inject: [
        TEMPORADA_CALENDARIO_PORT,
        TARIFA_REPOSITORY_PORT,
        EXTRA_REPOSITORY_PORT,
        CLOCK_PORT,
      ],
      useFactory: (
        temporadaCalendario: TemporadaCalendarioPort,
        tarifaRepository: TarifaRepositoryPort,
        extraRepository: ExtraRepositoryPort,
        clock: ClockPort,
      ) =>
        new CalculadoraTarifaService({
          temporadaCalendario,
          tarifaRepository,
          extraRepository,
          clock,
        }),
    },
  ],
  exports: [CalculadoraTarifaService],
})
export class TarifasModule {}
