/**
 * Módulo `facturacion` (US-022 / UC-18, hexagonal) — capability de la FACTURA como agregado
 * raíz. Compone los casos de uso (generar señal post-commit, obtener, aprobar, rechazar,
 * regenerar PDF) enlazando sus puertos a los adaptadores de infraestructura por token
 * (Symbol). El dominio/aplicación dependen solo de interfaces; la infra las implementa.
 *
 * Exporta `GenerarFacturaSenalUseCase` para que `ConfirmacionModule` dispare la generación
 * de la factura de señal como efecto POST-COMMIT de la confirmación (US-021, §D-1).
 */
import { Module } from '@nestjs/common';
import { PrismaModule } from '../shared/prisma/prisma.module';
import { PrismaService } from '../shared/prisma/prisma.service';
import {
  GenerarFacturaSenalUseCase,
  type CargarClienteFiscalPort,
  type CargarReservaFacturablePort,
  type CargarTenantFiscalPort,
  type ClockPort,
  type GenerarPdfFacturaPort,
  type UnidadDeTrabajoFacturacionPort,
} from './application/generar-factura-senal.use-case';
import {
  ObtenerFacturaSenalUseCase,
} from './application/obtener-factura-senal.use-case';
import {
  AprobarFacturaUseCase,
  type AprobarFacturaParams,
  type RegistroAuditoriaAprobacion,
} from './application/aprobar-factura.use-case';
import {
  RechazarFacturaUseCase,
  type RegistroAuditoriaRechazo,
} from './application/rechazar-factura.use-case';
import {
  RegenerarPdfFacturaUseCase,
  type CargarFacturaParaPdfPort,
} from './application/regenerar-pdf-factura.use-case';
import type { FacturaSenal } from './application/generar-factura-senal.use-case';
import { FacturacionUoWPrismaAdapter } from './infrastructure/facturacion-uow.prisma.adapter';
import {
  CamposFiscalesFaltantesFacturaPrismaAdapter,
  CargarClienteFiscalPrismaAdapter,
  CargarFacturaParaPdfPrismaAdapter,
  CargarFacturaPrismaAdapter,
  CargarReservaFacturablePrismaAdapter,
  CargarTenantFiscalPrismaAdapter,
} from './infrastructure/lecturas-facturacion.prisma.adapter';
import { PdfFacturaFakeAdapter } from './infrastructure/pdf-factura.fake.adapter';
import {
  AprobarFacturaPrismaAdapter,
  AuditoriaAprobacionPrismaAdapter,
} from './infrastructure/mutaciones-factura.prisma.adapter';
import { SistemaClockAdapter } from './infrastructure/sistema-clock.adapter';
import { FacturaController } from './interface/factura.controller';
import {
  APROBAR_FACTURA_PORT,
  AUDITORIA_APROBACION_PORT,
  CAMPOS_FISCALES_FALTANTES_PORT,
  CARGAR_CLIENTE_FISCAL_PORT,
  CARGAR_FACTURA_PARA_PDF_PORT,
  CARGAR_FACTURA_PORT,
  CARGAR_RESERVA_FACTURABLE_PORT,
  CARGAR_TENANT_FISCAL_PORT,
  FACTURACION_CLOCK_PORT,
  GENERAR_PDF_FACTURA_PORT,
  UNIDAD_DE_TRABAJO_FACTURACION_PORT,
} from './facturacion.tokens';

/** Firma del puerto de auditoría de aprobación/rechazo (acepta ambos registros). */
type AuditoriaAprobacionFn = (
  registro: RegistroAuditoriaAprobacion | RegistroAuditoriaRechazo,
) => Promise<void>;
/** Firma del puerto de aprobación (transición). */
type AprobarFn = (params: AprobarFacturaParams) => Promise<void>;
/** Firma del puerto de campos fiscales faltantes. */
type CamposFaltantesFn = (params: {
  tenantId: string;
  facturaId: string;
}) => Promise<ReadonlyArray<string>>;
/** Firma del puerto de carga de factura por id. */
type CargarFacturaFn = (params: {
  tenantId: string;
  facturaId: string;
}) => Promise<FacturaSenal | null>;

@Module({
  imports: [PrismaModule],
  controllers: [FacturaController],
  providers: [
    // --- Adaptadores por token (Symbol) ---
    {
      provide: UNIDAD_DE_TRABAJO_FACTURACION_PORT,
      inject: [PrismaService],
      useFactory: (prisma: PrismaService) => new FacturacionUoWPrismaAdapter(prisma),
    },
    {
      provide: CARGAR_RESERVA_FACTURABLE_PORT,
      inject: [PrismaService],
      useFactory: (prisma: PrismaService): CargarReservaFacturablePort =>
        new CargarReservaFacturablePrismaAdapter(prisma).cargar,
    },
    {
      provide: CARGAR_CLIENTE_FISCAL_PORT,
      inject: [PrismaService],
      useFactory: (prisma: PrismaService): CargarClienteFiscalPort =>
        new CargarClienteFiscalPrismaAdapter(prisma).cargar,
    },
    {
      provide: CARGAR_TENANT_FISCAL_PORT,
      inject: [PrismaService],
      useFactory: (prisma: PrismaService): CargarTenantFiscalPort =>
        new CargarTenantFiscalPrismaAdapter(prisma).cargar,
    },
    {
      provide: CARGAR_FACTURA_PARA_PDF_PORT,
      inject: [PrismaService],
      useFactory: (prisma: PrismaService): CargarFacturaParaPdfPort =>
        new CargarFacturaParaPdfPrismaAdapter(prisma).cargar,
    },
    {
      provide: CARGAR_FACTURA_PORT,
      inject: [PrismaService],
      useFactory: (prisma: PrismaService): CargarFacturaFn =>
        new CargarFacturaPrismaAdapter(prisma).cargar,
    },
    {
      provide: CAMPOS_FISCALES_FALTANTES_PORT,
      inject: [PrismaService],
      useFactory: (prisma: PrismaService): CamposFaltantesFn =>
        new CamposFiscalesFaltantesFacturaPrismaAdapter(prisma).obtener,
    },
    {
      provide: GENERAR_PDF_FACTURA_PORT,
      useFactory: (): GenerarPdfFacturaPort => new PdfFacturaFakeAdapter().generar,
    },
    {
      provide: APROBAR_FACTURA_PORT,
      inject: [PrismaService],
      useFactory: (prisma: PrismaService): AprobarFn =>
        new AprobarFacturaPrismaAdapter(prisma).aprobar,
    },
    {
      provide: AUDITORIA_APROBACION_PORT,
      inject: [PrismaService],
      useFactory: (prisma: PrismaService): AuditoriaAprobacionFn =>
        new AuditoriaAprobacionPrismaAdapter(prisma).registrar,
    },
    { provide: FACTURACION_CLOCK_PORT, useClass: SistemaClockAdapter },

    // --- Casos de uso ---
    {
      provide: GenerarFacturaSenalUseCase,
      inject: [
        UNIDAD_DE_TRABAJO_FACTURACION_PORT,
        CARGAR_RESERVA_FACTURABLE_PORT,
        CARGAR_CLIENTE_FISCAL_PORT,
        CARGAR_TENANT_FISCAL_PORT,
        GENERAR_PDF_FACTURA_PORT,
        FACTURACION_CLOCK_PORT,
      ],
      useFactory: (
        unidadDeTrabajo: UnidadDeTrabajoFacturacionPort,
        cargarReserva: CargarReservaFacturablePort,
        cargarCliente: CargarClienteFiscalPort,
        cargarTenant: CargarTenantFiscalPort,
        generarPdf: GenerarPdfFacturaPort,
        clock: ClockPort,
      ) =>
        new GenerarFacturaSenalUseCase({
          unidadDeTrabajo,
          cargarReserva,
          cargarCliente,
          cargarTenant,
          generarPdf,
          clock,
        }),
    },
    {
      provide: ObtenerFacturaSenalUseCase,
      inject: [
        UNIDAD_DE_TRABAJO_FACTURACION_PORT,
        CARGAR_RESERVA_FACTURABLE_PORT,
        CARGAR_CLIENTE_FISCAL_PORT,
        CARGAR_FACTURA_PARA_PDF_PORT,
      ],
      useFactory: (
        unidadDeTrabajo: UnidadDeTrabajoFacturacionPort,
        cargarReserva: CargarReservaFacturablePort,
        cargarCliente: CargarClienteFiscalPort,
        cargarFacturaParaPdf: CargarFacturaParaPdfPort,
      ) =>
        new ObtenerFacturaSenalUseCase({
          unidadDeTrabajo,
          cargarReserva,
          cargarCliente,
          cargarFacturaParaPdf,
        }),
    },
    {
      provide: AprobarFacturaUseCase,
      inject: [
        CARGAR_FACTURA_PORT,
        CAMPOS_FISCALES_FALTANTES_PORT,
        APROBAR_FACTURA_PORT,
        AUDITORIA_APROBACION_PORT,
        FACTURACION_CLOCK_PORT,
      ],
      useFactory: (
        cargarFactura: CargarFacturaFn,
        camposFiscalesFaltantes: CamposFaltantesFn,
        aprobar: AprobarFn,
        registrarAuditoria: AuditoriaAprobacionFn,
        clock: ClockPort,
      ) =>
        new AprobarFacturaUseCase({
          cargarFactura,
          camposFiscalesFaltantes,
          aprobar,
          registrarAuditoria,
          clock,
        }),
    },
    {
      provide: RechazarFacturaUseCase,
      inject: [CARGAR_FACTURA_PORT, AUDITORIA_APROBACION_PORT, FACTURACION_CLOCK_PORT],
      useFactory: (
        cargarFactura: CargarFacturaFn,
        registrarAuditoria: AuditoriaAprobacionFn,
        clock: ClockPort,
      ) =>
        new RechazarFacturaUseCase({
          cargarFactura,
          registrarAuditoria,
          clock,
        }),
    },
    {
      provide: RegenerarPdfFacturaUseCase,
      inject: [
        CARGAR_FACTURA_PARA_PDF_PORT,
        CARGAR_CLIENTE_FISCAL_PORT,
        CARGAR_TENANT_FISCAL_PORT,
        GENERAR_PDF_FACTURA_PORT,
        UNIDAD_DE_TRABAJO_FACTURACION_PORT,
      ],
      useFactory: (
        cargarFacturaParaPdf: CargarFacturaParaPdfPort,
        cargarCliente: CargarClienteFiscalPort,
        cargarTenant: CargarTenantFiscalPort,
        generarPdf: GenerarPdfFacturaPort,
        unidadDeTrabajo: UnidadDeTrabajoFacturacionPort,
      ) =>
        new RegenerarPdfFacturaUseCase({
          cargarFacturaParaPdf,
          cargarCliente,
          cargarTenant,
          generarPdf,
          unidadDeTrabajo,
        }),
    },
  ],
  exports: [GenerarFacturaSenalUseCase],
})
export class FacturacionModule {}
