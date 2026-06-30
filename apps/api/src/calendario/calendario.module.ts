/**
 * Módulo calendario (US-039 / UC-29, hexagonal). Compone el read-model del calendario
 * de disponibilidad: enlaza el puerto de lectura `CalendarioQueryPort` a su adaptador
 * Prisma (token `Symbol`) e inyecta el use-case `ObtenerCalendarioUseCase` vía factory.
 * Expone el controlador `GET /calendario`. LECTURA PURA: no muta estado.
 */
import { Module } from '@nestjs/common';
import { PrismaModule } from '../shared/prisma/prisma.module';
import { PrismaService } from '../shared/prisma/prisma.service';
import { ConsultarCalendarioController } from './interface/consultar-calendario.controller';
import {
  ObtenerCalendarioUseCase,
  type CalendarioQueryPort,
} from './application/obtener-calendario.query';
import { CalendarioQueryPrismaAdapter } from './infrastructure/calendario-query.prisma.adapter';

/** Token (Symbol) del puerto de lectura del calendario (wiring, fuera del dominio). */
export const CALENDARIO_QUERY_PORT = Symbol('CalendarioQueryPort');

@Module({
  imports: [PrismaModule],
  controllers: [ConsultarCalendarioController],
  providers: [
    {
      provide: CALENDARIO_QUERY_PORT,
      inject: [PrismaService],
      useFactory: (prisma: PrismaService) =>
        new CalendarioQueryPrismaAdapter(prisma),
    },
    {
      provide: ObtenerCalendarioUseCase,
      inject: [CALENDARIO_QUERY_PORT],
      useFactory: (calendario: CalendarioQueryPort) =>
        new ObtenerCalendarioUseCase({ calendario }),
    },
  ],
  exports: [ObtenerCalendarioUseCase],
})
export class CalendarioModule {}
