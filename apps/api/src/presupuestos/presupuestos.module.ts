/**
 * Módulo presupuestos (US-014, hexagonal) — capability `presupuestos`.
 *
 * Compone el caso de uso `GenerarPresupuestoUseCase` (aplicación) enlazando sus
 * puertos a los adaptadores de infraestructura por token (Symbol):
 *   - Motor de tarifa (US-016) importado de `TarifasModule` (`CalculadoraTarifaService`).
 *   - Unidad de trabajo transaccional de la activación de pre_reserva (UoW Prisma).
 *   - Lectura de RESERVA/CLIENTE, settings del tenant, reloj del sistema.
 *   - Generación del PDF (fake en MVP/test) y disparo del E2 post-commit reutilizando
 *     el motor de email de US-045 (`DespacharEmailService`, de `ComunicacionesModule`).
 *
 * El dominio/aplicación dependen solo de interfaces; los adaptadores (Prisma/PDF/email)
 * viven en infraestructura. Mismo patrón que `ReservasModule`.
 */
import { Module } from '@nestjs/common';
import { PrismaModule } from '../shared/prisma/prisma.module';
import { PrismaService } from '../shared/prisma/prisma.service';
import { TarifasModule } from '../tarifas/tarifas.module';
import { CalculadoraTarifaService } from '../tarifas/domain/calculadora-tarifa.service';
import { ComunicacionesModule } from '../comunicaciones/comunicaciones.module';
import { DespacharEmailService } from '../comunicaciones/application/despachar-email.service';
import {
  GenerarPresupuestoUseCase,
  type CargarClientePort,
  type CargarReservaPort,
  type ClockPort,
  type DispararE2Port,
  type GenerarPdfPresupuestoPort,
  type TenantSettingsPresupuestoPort,
  type UnidadDeTrabajoActivarPrereservaPort,
} from './application/generar-presupuesto.use-case';
import { ActivarPrereservaUoWPrismaAdapter } from './infrastructure/activar-prereserva-uow.prisma.adapter';
import { CargarReservaPrismaAdapter } from './infrastructure/cargar-reserva.prisma.adapter';
import { CargarClientePrismaAdapter } from './infrastructure/cargar-cliente.prisma.adapter';
import { TenantSettingsPresupuestoPrismaAdapter } from './infrastructure/tenant-settings-presupuesto.prisma.adapter';
import { PdfPresupuestoFakeAdapter } from './infrastructure/pdf-presupuesto.fake.adapter';
import { DispararE2Adapter } from './infrastructure/disparar-e2.adapter';
import { SistemaClockAdapter } from './infrastructure/sistema-clock.adapter';
import { GenerarPresupuestoController } from './interface/generar-presupuesto.controller';
import {
  CARGAR_CLIENTE_PRESUPUESTO_PORT,
  CARGAR_RESERVA_PRESUPUESTO_PORT,
  DISPARAR_E2_PORT,
  GENERAR_PDF_PRESUPUESTO_PORT,
  PRESUPUESTOS_CLOCK_PORT,
  TENANT_SETTINGS_PRESUPUESTO_PORT,
  UNIDAD_DE_TRABAJO_ACTIVAR_PRERESERVA_PORT,
} from './presupuestos.tokens';

@Module({
  imports: [PrismaModule, TarifasModule, ComunicacionesModule],
  controllers: [GenerarPresupuestoController],
  providers: [
    {
      provide: UNIDAD_DE_TRABAJO_ACTIVAR_PRERESERVA_PORT,
      inject: [PrismaService],
      useFactory: (prisma: PrismaService) =>
        new ActivarPrereservaUoWPrismaAdapter(prisma),
    },
    {
      provide: CARGAR_RESERVA_PRESUPUESTO_PORT,
      inject: [PrismaService],
      useFactory: (prisma: PrismaService): CargarReservaPort =>
        new CargarReservaPrismaAdapter(prisma).cargar,
    },
    {
      provide: CARGAR_CLIENTE_PRESUPUESTO_PORT,
      inject: [PrismaService],
      useFactory: (prisma: PrismaService): CargarClientePort =>
        new CargarClientePrismaAdapter(prisma).cargar,
    },
    {
      provide: TENANT_SETTINGS_PRESUPUESTO_PORT,
      useClass: TenantSettingsPresupuestoPrismaAdapter,
    },
    {
      provide: GENERAR_PDF_PRESUPUESTO_PORT,
      useFactory: (): GenerarPdfPresupuestoPort =>
        new PdfPresupuestoFakeAdapter().generar,
    },
    {
      provide: DISPARAR_E2_PORT,
      inject: [DespacharEmailService, PrismaService],
      useFactory: (motor: DespacharEmailService, prisma: PrismaService) =>
        new DispararE2Adapter(motor, prisma),
    },
    { provide: PRESUPUESTOS_CLOCK_PORT, useClass: SistemaClockAdapter },
    {
      provide: GenerarPresupuestoUseCase,
      inject: [
        CalculadoraTarifaService,
        UNIDAD_DE_TRABAJO_ACTIVAR_PRERESERVA_PORT,
        TENANT_SETTINGS_PRESUPUESTO_PORT,
        CARGAR_RESERVA_PRESUPUESTO_PORT,
        CARGAR_CLIENTE_PRESUPUESTO_PORT,
        GENERAR_PDF_PRESUPUESTO_PORT,
        PRESUPUESTOS_CLOCK_PORT,
        DISPARAR_E2_PORT,
      ],
      useFactory: (
        motorTarifa: CalculadoraTarifaService,
        unidadDeTrabajo: UnidadDeTrabajoActivarPrereservaPort,
        tenantSettings: TenantSettingsPresupuestoPort,
        cargarReserva: CargarReservaPort,
        cargarCliente: CargarClientePort,
        generarPdf: GenerarPdfPresupuestoPort,
        clock: ClockPort,
        dispararE2: DispararE2Port,
      ) =>
        new GenerarPresupuestoUseCase({
          motorTarifa,
          unidadDeTrabajo,
          tenantSettings,
          cargarReserva,
          cargarCliente,
          generarPdf,
          clock,
          dispararE2,
        }),
    },
  ],
  exports: [GenerarPresupuestoUseCase],
})
export class PresupuestosModule {}
