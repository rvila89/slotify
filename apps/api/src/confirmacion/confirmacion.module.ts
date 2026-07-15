/**
 * Módulo confirmacion (US-021, hexagonal) — capability `confirmacion`.
 *
 * Compone el caso de uso `ConfirmarPagoSenalUseCase` (aplicación) enlazando sus puertos a
 * los adaptadores de infraestructura por token (Symbol):
 *   - Unidad de trabajo transaccional de la confirmación (UoW Prisma) que REUTILIZA la
 *     primitiva atómica de bloqueo de US-040 (`bloquearFecha(fase='reserva_confirmada')`)
 *     para el upgrade blando→firme.
 *   - Lectura de RESERVA, settings del tenant (`pct_senal`), reloj del sistema.
 *   - Almacenamiento del justificante (fake en MVP/test) y presentación de la factura de
 *     señal en borrador post-commit (stub; US-022 lo materializará).
 *
 * El fichero justificante se recibe por `multipart/form-data` con almacenamiento EN
 * MEMORIA (`MulterModule` por defecto, sin `dest`) para exponer el `buffer` al caso de uso.
 * El dominio/aplicación dependen solo de interfaces; los adaptadores viven en
 * infraestructura. Mismo patrón que `PresupuestosModule`.
 */
import { Module } from '@nestjs/common';
import { MulterModule } from '@nestjs/platform-express';
import { PrismaModule } from '../shared/prisma/prisma.module';
import { PrismaService } from '../shared/prisma/prisma.service';
import { FacturacionModule } from '../facturacion/facturacion.module';
import { DocumentosModule } from '../documentos/documentos.module';
import { ALMACEN_DOCUMENTOS_PORT } from '../documentos/documentos.tokens';
import type { AlmacenDocumentosPort } from '../documentos/domain/almacen-documentos.port';
import { GenerarFacturaSenalUseCase } from '../facturacion/application/generar-factura-senal.use-case';
import { GenerarBorradoresLiquidacionFianzaUseCase } from '../facturacion/application/generar-borradores-liquidacion-fianza.use-case';
import {
  ObtenerReservaUseCase,
  type ReservaDetalleQueryPort,
} from '../reservas/application/obtener-reserva.query';
import { ReservaDetalleQueryPrismaAdapter } from '../reservas/infrastructure/reserva-detalle-query.prisma.adapter';
import {
  ConfirmarPagoSenalUseCase,
  type AlmacenarJustificantePort,
  type CargarReservaConfirmacionPort,
  type ClockPort,
  type GenerarBorradoresLiquidacionFianzaPort,
  type PresentarFacturaSenalBorradorPort,
  type TenantSettingsConfirmacionPort,
  type UnidadDeTrabajoConfirmacionPort,
} from './application/confirmar-pago-senal.use-case';
import { ConfirmarPagoSenalUoWPrismaAdapter } from './infrastructure/confirmar-pago-senal-uow.prisma.adapter';
import { CargarReservaConfirmacionPrismaAdapter } from './infrastructure/cargar-reserva-confirmacion.prisma.adapter';
import { TenantSettingsConfirmacionPrismaAdapter } from './infrastructure/tenant-settings-confirmacion.prisma.adapter';
import { AlmacenarJustificanteFakeAdapter } from './infrastructure/almacenar-justificante.fake.adapter';
import { PresentarFacturaSenalFacturacionAdapter } from './infrastructure/presentar-factura-senal.facturacion.adapter';
import { GenerarBorradoresLiquidacionFianzaFacturacionAdapter } from './infrastructure/generar-borradores-liquidacion-fianza.facturacion.adapter';
import { SistemaClockAdapter } from './infrastructure/sistema-clock.adapter';
import { ConfirmarPagoSenalController } from './interface/confirmar-pago-senal.controller';
import {
  ALMACENAR_JUSTIFICANTE_PORT,
  CARGAR_RESERVA_CONFIRMACION_PORT,
  CONFIRMACION_CLOCK_PORT,
  GENERAR_BORRADORES_LIQUIDACION_FIANZA_PORT,
  PRESENTAR_FACTURA_SENAL_BORRADOR_PORT,
  TENANT_SETTINGS_CONFIRMACION_PORT,
  UNIDAD_DE_TRABAJO_CONFIRMACION_PORT,
} from './confirmacion.tokens';
// US-024: registro de la firma de las condiciones particulares (UC-19 segundo flujo).
import {
  RegistrarFirmaCondicionesUseCase,
  type AlmacenarCondicionesFirmadasPort,
  type CargarReservaFirmaCondicionesPort,
  type ClockPort as FirmaCondicionesClockPort,
  type UnidadDeTrabajoFirmaCondicionesPort,
} from './application/registrar-firma-condiciones.use-case';
import { RegistrarFirmaCondicionesUoWPrismaAdapter } from './infrastructure/registrar-firma-condiciones-uow.prisma.adapter';
import { CargarReservaFirmaCondicionesPrismaAdapter } from './infrastructure/cargar-reserva-firma-condiciones.prisma.adapter';
import { AlmacenarCondicionesFirmadasAdapter } from './infrastructure/almacenar-condiciones-firmadas.adapter';
import { RegistrarFirmaCondicionesController } from './interface/registrar-firma-condiciones.controller';
import {
  ALMACENAR_CONDICIONES_FIRMADAS_PORT,
  CARGAR_RESERVA_FIRMA_CONDICIONES_PORT,
  FIRMA_CONDICIONES_CLOCK_PORT,
  RESERVA_DETALLE_FIRMA_CONDICIONES_PORT,
  UNIDAD_DE_TRABAJO_FIRMA_CONDICIONES_PORT,
} from './registrar-firma-condiciones.tokens';

@Module({
  imports: [
    PrismaModule,
    // US-022: el disparo post-commit de la factura de señal reutiliza el
    // GenerarFacturaSenalUseCase que exporta FacturacionModule.
    FacturacionModule,
    // US-024: expone `ALMACEN_DOCUMENTOS_PORT` (almacén de objetos, épico #6) para
    // subir la copia firmada con clave versionada por reserva.
    DocumentosModule,
    // Sin `dest`/`storage`: multer usa MemoryStorage por defecto y expone `file.buffer`
    // (autoritativo para validar formato/tamaño y almacenar el binario en el use-case).
    MulterModule.register({}),
  ],
  controllers: [ConfirmarPagoSenalController, RegistrarFirmaCondicionesController],
  providers: [
    {
      provide: UNIDAD_DE_TRABAJO_CONFIRMACION_PORT,
      inject: [PrismaService],
      useFactory: (prisma: PrismaService) =>
        new ConfirmarPagoSenalUoWPrismaAdapter(prisma),
    },
    {
      provide: CARGAR_RESERVA_CONFIRMACION_PORT,
      inject: [PrismaService],
      useFactory: (prisma: PrismaService): CargarReservaConfirmacionPort =>
        new CargarReservaConfirmacionPrismaAdapter(prisma).cargar,
    },
    {
      provide: TENANT_SETTINGS_CONFIRMACION_PORT,
      useClass: TenantSettingsConfirmacionPrismaAdapter,
    },
    {
      provide: ALMACENAR_JUSTIFICANTE_PORT,
      useFactory: (): AlmacenarJustificantePort =>
        new AlmacenarJustificanteFakeAdapter().almacenar,
    },
    {
      provide: PRESENTAR_FACTURA_SENAL_BORRADOR_PORT,
      inject: [GenerarFacturaSenalUseCase],
      useFactory: (
        generarFactura: GenerarFacturaSenalUseCase,
      ): PresentarFacturaSenalBorradorPort =>
        new PresentarFacturaSenalFacturacionAdapter(generarFactura).presentar,
    },
    {
      provide: GENERAR_BORRADORES_LIQUIDACION_FIANZA_PORT,
      inject: [GenerarBorradoresLiquidacionFianzaUseCase],
      useFactory: (
        generarBorradores: GenerarBorradoresLiquidacionFianzaUseCase,
      ): GenerarBorradoresLiquidacionFianzaPort =>
        new GenerarBorradoresLiquidacionFianzaFacturacionAdapter(generarBorradores).generar,
    },
    { provide: CONFIRMACION_CLOCK_PORT, useClass: SistemaClockAdapter },
    // ----------------------------------------------------------------------
    // US-024: registro de la firma de las condiciones particulares.
    // ----------------------------------------------------------------------
    {
      provide: UNIDAD_DE_TRABAJO_FIRMA_CONDICIONES_PORT,
      inject: [PrismaService],
      useFactory: (prisma: PrismaService) =>
        new RegistrarFirmaCondicionesUoWPrismaAdapter(prisma),
    },
    {
      provide: CARGAR_RESERVA_FIRMA_CONDICIONES_PORT,
      inject: [PrismaService],
      useFactory: (prisma: PrismaService): CargarReservaFirmaCondicionesPort =>
        new CargarReservaFirmaCondicionesPrismaAdapter(prisma).cargar,
    },
    {
      provide: ALMACENAR_CONDICIONES_FIRMADAS_PORT,
      inject: [ALMACEN_DOCUMENTOS_PORT],
      useFactory: (almacen: AlmacenDocumentosPort): AlmacenarCondicionesFirmadasPort =>
        new AlmacenarCondicionesFirmadasAdapter(almacen).almacenar,
    },
    { provide: FIRMA_CONDICIONES_CLOCK_PORT, useClass: SistemaClockAdapter },
    {
      provide: RESERVA_DETALLE_FIRMA_CONDICIONES_PORT,
      useClass: ReservaDetalleQueryPrismaAdapter,
    },
    {
      provide: ObtenerReservaUseCase,
      inject: [RESERVA_DETALLE_FIRMA_CONDICIONES_PORT],
      useFactory: (reservaDetalle: ReservaDetalleQueryPort) =>
        new ObtenerReservaUseCase({ reservaDetalle }),
    },
    {
      provide: RegistrarFirmaCondicionesUseCase,
      inject: [
        UNIDAD_DE_TRABAJO_FIRMA_CONDICIONES_PORT,
        CARGAR_RESERVA_FIRMA_CONDICIONES_PORT,
        ALMACENAR_CONDICIONES_FIRMADAS_PORT,
        FIRMA_CONDICIONES_CLOCK_PORT,
      ],
      useFactory: (
        unidadDeTrabajo: UnidadDeTrabajoFirmaCondicionesPort,
        cargarReserva: CargarReservaFirmaCondicionesPort,
        almacenarCondiciones: AlmacenarCondicionesFirmadasPort,
        clock: FirmaCondicionesClockPort,
      ) =>
        new RegistrarFirmaCondicionesUseCase({
          unidadDeTrabajo,
          cargarReserva,
          almacenarCondiciones,
          clock,
        }),
    },
    {
      provide: ConfirmarPagoSenalUseCase,
      inject: [
        UNIDAD_DE_TRABAJO_CONFIRMACION_PORT,
        TENANT_SETTINGS_CONFIRMACION_PORT,
        CARGAR_RESERVA_CONFIRMACION_PORT,
        ALMACENAR_JUSTIFICANTE_PORT,
        PRESENTAR_FACTURA_SENAL_BORRADOR_PORT,
        GENERAR_BORRADORES_LIQUIDACION_FIANZA_PORT,
        CONFIRMACION_CLOCK_PORT,
      ],
      useFactory: (
        unidadDeTrabajo: UnidadDeTrabajoConfirmacionPort,
        tenantSettings: TenantSettingsConfirmacionPort,
        cargarReserva: CargarReservaConfirmacionPort,
        almacenarJustificante: AlmacenarJustificantePort,
        presentarFacturaSenalBorrador: PresentarFacturaSenalBorradorPort,
        generarBorradoresLiquidacionFianza: GenerarBorradoresLiquidacionFianzaPort,
        clock: ClockPort,
      ) =>
        new ConfirmarPagoSenalUseCase({
          unidadDeTrabajo,
          tenantSettings,
          cargarReserva,
          almacenarJustificante,
          presentarFacturaSenalBorrador,
          generarBorradoresLiquidacionFianza,
          clock,
        }),
    },
  ],
  exports: [ConfirmarPagoSenalUseCase],
})
export class ConfirmacionModule {}
