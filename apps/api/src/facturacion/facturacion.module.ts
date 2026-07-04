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
import { ComunicacionesModule } from '../comunicaciones/comunicaciones.module';
import { ENVIAR_EMAIL_PORT } from '../comunicaciones/comunicaciones.tokens';
import type { EnviarEmailPort } from '../comunicaciones/domain/enviar-email.port';
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
import {
  GenerarBorradoresLiquidacionFianzaUseCase,
  type CargarExtrasPendientesPort,
  type CargarFianzaDefaultPort,
  type CargarReservaLiquidablePort,
  type UnidadDeTrabajoBorradoresPort,
} from './application/generar-borradores-liquidacion-fianza.use-case';
import {
  ListarFacturasReservaUseCase,
  type ListarFacturasReservaPort,
} from './application/listar-facturas-reserva.use-case';
import {
  AprobarYEnviarLiquidacionUseCase,
  type CargarReservaEmisionPort,
  type EnviarE4EmisionPort,
  type UnidadDeTrabajoEmisionPort,
} from './application/aprobar-y-enviar-liquidacion.use-case';
import {
  EnviarReciboFianzaSeparadoUseCase,
  type CargarReservaFianzaPort,
  type EnviarReciboFianzaPort,
  type UnidadDeTrabajoFianzaPort,
} from './application/enviar-recibo-fianza-separado.use-case';
import {
  ReenviarLiquidacionUseCase,
  type CargarLiquidacionReenvioPort,
  type CargarReservaReenvioPort,
  type ReenviarE4Port,
  type RegistrarAuditoriaReenvioPort,
  type RegistrarComunicacionReenvioPort,
} from './application/reenviar-liquidacion.use-case';
import type { FacturaSenal } from './application/generar-factura-senal.use-case';
import {
  EmisionUoWPrismaAdapter,
  FianzaSeparadaUoWPrismaAdapter,
} from './infrastructure/emision-uow.prisma.adapter';
import {
  CargarLiquidacionReenvioPrismaAdapter,
  CargarReservaEmisionPrismaAdapter,
  CargarReservaFianzaPrismaAdapter,
  CargarReservaReenvioPrismaAdapter,
} from './infrastructure/lecturas-emision.prisma.adapter';
import {
  EnviarE4EmisionAdapter,
  EnviarReciboFianzaAdapter,
  ReenviarE4Adapter,
} from './infrastructure/emision-email.adapter';
import {
  RegistrarAuditoriaReenvioPrismaAdapter,
  RegistrarComunicacionReenvioPrismaAdapter,
} from './infrastructure/reenvio-comunicacion.prisma.adapter';
import { FacturacionUoWPrismaAdapter } from './infrastructure/facturacion-uow.prisma.adapter';
import { BorradoresUoWPrismaAdapter } from './infrastructure/borradores-uow.prisma.adapter';
import {
  CargarExtrasPendientesPrismaAdapter,
  CargarFianzaDefaultPrismaAdapter,
  CargarReservaLiquidablePrismaAdapter,
} from './infrastructure/lecturas-borradores.prisma.adapter';
import { ListarFacturasReservaPrismaAdapter } from './infrastructure/listar-facturas-reserva.prisma.adapter';
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
  CARGAR_EXTRAS_PENDIENTES_PORT,
  CARGAR_FACTURA_PARA_PDF_PORT,
  CARGAR_FACTURA_PORT,
  CARGAR_FIANZA_DEFAULT_PORT,
  CARGAR_RESERVA_FACTURABLE_PORT,
  CARGAR_RESERVA_LIQUIDABLE_PORT,
  CARGAR_TENANT_FISCAL_PORT,
  FACTURACION_CLOCK_PORT,
  GENERAR_PDF_FACTURA_PORT,
  LISTAR_FACTURAS_RESERVA_PORT,
  UNIDAD_DE_TRABAJO_BORRADORES_PORT,
  UNIDAD_DE_TRABAJO_FACTURACION_PORT,
  UNIDAD_DE_TRABAJO_EMISION_PORT,
  CARGAR_RESERVA_EMISION_PORT,
  ENVIAR_E4_EMISION_PORT,
  UNIDAD_DE_TRABAJO_FIANZA_PORT,
  CARGAR_RESERVA_FIANZA_PORT,
  ENVIAR_RECIBO_FIANZA_PORT,
  CARGAR_RESERVA_REENVIO_PORT,
  CARGAR_LIQUIDACION_REENVIO_PORT,
  REENVIAR_E4_PORT,
  REGISTRAR_COMUNICACION_REENVIO_PORT,
  REGISTRAR_AUDITORIA_REENVIO_PORT,
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
  imports: [PrismaModule, ComunicacionesModule],
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

    // --- US-027: adaptadores de los borradores de liquidación/fianza ---
    {
      provide: UNIDAD_DE_TRABAJO_BORRADORES_PORT,
      inject: [PrismaService],
      useFactory: (prisma: PrismaService) => new BorradoresUoWPrismaAdapter(prisma),
    },
    {
      provide: CARGAR_RESERVA_LIQUIDABLE_PORT,
      inject: [PrismaService],
      useFactory: (prisma: PrismaService): CargarReservaLiquidablePort =>
        new CargarReservaLiquidablePrismaAdapter(prisma).cargar,
    },
    {
      provide: CARGAR_EXTRAS_PENDIENTES_PORT,
      inject: [PrismaService],
      useFactory: (prisma: PrismaService): CargarExtrasPendientesPort =>
        new CargarExtrasPendientesPrismaAdapter(prisma).cargar,
    },
    {
      provide: CARGAR_FIANZA_DEFAULT_PORT,
      inject: [PrismaService],
      useFactory: (prisma: PrismaService): CargarFianzaDefaultPort =>
        new CargarFianzaDefaultPrismaAdapter(prisma).cargar,
    },
    {
      provide: LISTAR_FACTURAS_RESERVA_PORT,
      inject: [PrismaService],
      useFactory: (prisma: PrismaService): ListarFacturasReservaPort =>
        new ListarFacturasReservaPrismaAdapter(prisma).listar,
    },

    // --- US-028: adaptadores de la emisión / envío separado / reenvío ---
    {
      provide: UNIDAD_DE_TRABAJO_EMISION_PORT,
      inject: [PrismaService],
      useFactory: (prisma: PrismaService) => new EmisionUoWPrismaAdapter(prisma),
    },
    {
      provide: CARGAR_RESERVA_EMISION_PORT,
      inject: [PrismaService],
      useFactory: (prisma: PrismaService): CargarReservaEmisionPort =>
        new CargarReservaEmisionPrismaAdapter(prisma).cargar,
    },
    {
      provide: ENVIAR_E4_EMISION_PORT,
      inject: [ENVIAR_EMAIL_PORT],
      useFactory: (enviarEmail: EnviarEmailPort): EnviarE4EmisionPort =>
        new EnviarE4EmisionAdapter(enviarEmail).enviar,
    },
    {
      provide: UNIDAD_DE_TRABAJO_FIANZA_PORT,
      inject: [PrismaService],
      useFactory: (prisma: PrismaService) => new FianzaSeparadaUoWPrismaAdapter(prisma),
    },
    {
      provide: CARGAR_RESERVA_FIANZA_PORT,
      inject: [PrismaService],
      useFactory: (prisma: PrismaService): CargarReservaFianzaPort =>
        new CargarReservaFianzaPrismaAdapter(prisma).cargar,
    },
    {
      provide: ENVIAR_RECIBO_FIANZA_PORT,
      inject: [ENVIAR_EMAIL_PORT],
      useFactory: (enviarEmail: EnviarEmailPort): EnviarReciboFianzaPort =>
        new EnviarReciboFianzaAdapter(enviarEmail).enviar,
    },
    {
      provide: CARGAR_RESERVA_REENVIO_PORT,
      inject: [PrismaService],
      useFactory: (prisma: PrismaService): CargarReservaReenvioPort =>
        new CargarReservaReenvioPrismaAdapter(prisma).cargar,
    },
    {
      provide: CARGAR_LIQUIDACION_REENVIO_PORT,
      inject: [PrismaService],
      useFactory: (prisma: PrismaService): CargarLiquidacionReenvioPort =>
        new CargarLiquidacionReenvioPrismaAdapter(prisma).cargar,
    },
    {
      provide: REENVIAR_E4_PORT,
      inject: [ENVIAR_EMAIL_PORT],
      useFactory: (enviarEmail: EnviarEmailPort): ReenviarE4Port =>
        new ReenviarE4Adapter(enviarEmail).reenviar,
    },
    {
      provide: REGISTRAR_COMUNICACION_REENVIO_PORT,
      inject: [PrismaService],
      useFactory: (prisma: PrismaService): RegistrarComunicacionReenvioPort =>
        new RegistrarComunicacionReenvioPrismaAdapter(prisma).registrar,
    },
    {
      provide: REGISTRAR_AUDITORIA_REENVIO_PORT,
      inject: [PrismaService],
      useFactory: (prisma: PrismaService): RegistrarAuditoriaReenvioPort =>
        new RegistrarAuditoriaReenvioPrismaAdapter(prisma).registrar,
    },

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
    {
      provide: GenerarBorradoresLiquidacionFianzaUseCase,
      inject: [
        UNIDAD_DE_TRABAJO_BORRADORES_PORT,
        CARGAR_RESERVA_LIQUIDABLE_PORT,
        CARGAR_EXTRAS_PENDIENTES_PORT,
        CARGAR_FIANZA_DEFAULT_PORT,
      ],
      useFactory: (
        unidadDeTrabajo: UnidadDeTrabajoBorradoresPort,
        cargarReserva: CargarReservaLiquidablePort,
        cargarExtrasPendientes: CargarExtrasPendientesPort,
        cargarFianzaDefault: CargarFianzaDefaultPort,
      ) =>
        new GenerarBorradoresLiquidacionFianzaUseCase({
          unidadDeTrabajo,
          cargarReserva,
          cargarExtrasPendientes,
          cargarFianzaDefault,
        }),
    },
    {
      provide: ListarFacturasReservaUseCase,
      inject: [LISTAR_FACTURAS_RESERVA_PORT],
      useFactory: (listarFacturas: ListarFacturasReservaPort) =>
        new ListarFacturasReservaUseCase({ listarFacturas }),
    },
    {
      provide: AprobarYEnviarLiquidacionUseCase,
      inject: [
        UNIDAD_DE_TRABAJO_EMISION_PORT,
        CARGAR_RESERVA_EMISION_PORT,
        ENVIAR_E4_EMISION_PORT,
        FACTURACION_CLOCK_PORT,
      ],
      useFactory: (
        unidadDeTrabajo: UnidadDeTrabajoEmisionPort,
        cargarReserva: CargarReservaEmisionPort,
        enviarE4: EnviarE4EmisionPort,
        clock: ClockPort,
      ) =>
        new AprobarYEnviarLiquidacionUseCase({
          unidadDeTrabajo,
          cargarReserva,
          enviarE4,
          clock,
        }),
    },
    {
      provide: EnviarReciboFianzaSeparadoUseCase,
      inject: [
        UNIDAD_DE_TRABAJO_FIANZA_PORT,
        CARGAR_RESERVA_FIANZA_PORT,
        ENVIAR_RECIBO_FIANZA_PORT,
        FACTURACION_CLOCK_PORT,
      ],
      useFactory: (
        unidadDeTrabajo: UnidadDeTrabajoFianzaPort,
        cargarReserva: CargarReservaFianzaPort,
        enviarRecibo: EnviarReciboFianzaPort,
        clock: ClockPort,
      ) =>
        new EnviarReciboFianzaSeparadoUseCase({
          unidadDeTrabajo,
          cargarReserva,
          enviarRecibo,
          clock,
        }),
    },
    {
      provide: ReenviarLiquidacionUseCase,
      inject: [
        CARGAR_RESERVA_REENVIO_PORT,
        CARGAR_LIQUIDACION_REENVIO_PORT,
        REENVIAR_E4_PORT,
        REGISTRAR_COMUNICACION_REENVIO_PORT,
        REGISTRAR_AUDITORIA_REENVIO_PORT,
        FACTURACION_CLOCK_PORT,
      ],
      useFactory: (
        cargarReserva: CargarReservaReenvioPort,
        cargarLiquidacion: CargarLiquidacionReenvioPort,
        reenviarE4: ReenviarE4Port,
        registrarComunicacion: RegistrarComunicacionReenvioPort,
        registrarAuditoria: RegistrarAuditoriaReenvioPort,
        clock: ClockPort,
      ) =>
        new ReenviarLiquidacionUseCase({
          cargarReserva,
          cargarLiquidacion,
          reenviarE4,
          registrarComunicacion,
          registrarAuditoria,
          clock,
        }),
    },
  ],
  exports: [
    GenerarFacturaSenalUseCase,
    GenerarBorradoresLiquidacionFianzaUseCase,
    AprobarYEnviarLiquidacionUseCase,
    EnviarReciboFianzaSeparadoUseCase,
    ReenviarLiquidacionUseCase,
  ],
})
export class FacturacionModule {}
