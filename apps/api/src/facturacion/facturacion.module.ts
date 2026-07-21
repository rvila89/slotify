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
import { DocumentosModule } from '../documentos/documentos.module';
import { ALMACEN_DOCUMENTOS_PORT } from '../documentos/documentos.tokens';
import type { AlmacenDocumentosPort } from '../documentos/domain/almacen-documentos.port';
import { renderizarDocumentoFacturaABytes } from '../documentos/presentation/documento-factura.render';
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
  EnviarFacturaSenalUseCase,
  type CargarReservaSenalEmisionPort,
  type ClockPort as ClockSenalPort,
  type EnviarE3EmisionPort,
  type UnidadDeTrabajoSenalEmisionPort,
} from './application/enviar-factura-senal.use-case';
import {
  ReenviarLiquidacionUseCase,
  type CargarLiquidacionReenvioPort,
  type CargarReservaReenvioPort,
  type ReenviarE4Port,
  type RegistrarAuditoriaReenvioPort,
  type RegistrarComunicacionReenvioPort,
} from './application/reenviar-liquidacion.use-case';
import {
  ReenviarE3UseCase,
  type BuscarDocumentoCondicionesPort,
  type BuscarE3PreviaPort,
  type CargarFacturaSenalReenvioPort,
  type CargarReservaReenvioE3Port,
  type FijarCondicionesEnviadasReenvioPort,
  type ReenviarE3Port,
  type RegistrarAuditoriaReenvioE3Port,
  type RegistrarComunicacionReenvioE3Port,
} from './application/reenviar-e3.use-case';
import {
  RegistrarCobroLiquidacionUseCase,
  type UnidadDeTrabajoCobroPort,
} from './application/registrar-cobro-liquidacion.use-case';
import { CobroLiquidacionUoWPrismaAdapter } from './infrastructure/cobro-liquidacion-uow.prisma.adapter';
import {
  RegistrarCobroFianzaUseCase,
  type UnidadDeTrabajoCobroFianzaPort,
} from './application/registrar-cobro-fianza.use-case';
import { CobroFianzaUoWPrismaAdapter } from './infrastructure/cobro-fianza-uow.prisma.adapter';
import {
  RegistrarDevolucionFianzaUseCase,
  type UnidadDeTrabajoDevolucionFianzaPort,
} from './application/registrar-devolucion-fianza.use-case';
import { DevolucionFianzaUoWPrismaAdapter } from './infrastructure/devolucion-fianza-uow.prisma.adapter';
import { RegistrarDevolucionFianzaController } from './interface/registrar-devolucion-fianza.controller';
import type { FacturaSenal } from './application/generar-factura-senal.use-case';
import {
  EmisionUoWPrismaAdapter,
  FianzaSeparadaUoWPrismaAdapter,
  SenalEmisionUoWPrismaAdapter,
} from './infrastructure/emision-uow.prisma.adapter';
import {
  BuscarDocumentoCondicionesPrismaAdapter,
  BuscarE3PreviaPrismaAdapter,
  CargarFacturaSenalReenvioPrismaAdapter,
  CargarLiquidacionReenvioPrismaAdapter,
  CargarReservaEmisionPrismaAdapter,
  CargarReservaFianzaPrismaAdapter,
  CargarReservaReenvioPrismaAdapter,
  CargarReservaReenvioE3PrismaAdapter,
  CargarReservaSenalEmisionPrismaAdapter,
} from './infrastructure/lecturas-emision.prisma.adapter';
import {
  EnviarE3EmisionAdapter,
  EnviarE4EmisionAdapter,
  EnviarReciboFianzaAdapter,
  ReenviarE3Adapter,
  ReenviarE4Adapter,
} from './infrastructure/emision-email.adapter';
import {
  FijarCondicionesEnviadasReenvioPrismaAdapter,
  RegistrarAuditoriaReenvioPrismaAdapter,
  RegistrarAuditoriaReenvioE3PrismaAdapter,
  RegistrarComunicacionReenvioPrismaAdapter,
  RegistrarComunicacionReenvioE3PrismaAdapter,
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
import { CargarDatosDocumentoFacturaPrismaAdapter } from './infrastructure/cargar-datos-documento-factura.prisma.adapter';
import { PdfFacturaRealAdapter } from './infrastructure/pdf-factura.real.adapter';
import type { CargarDatosDocumentoFacturaPort } from './domain/cargar-datos-documento-factura.port';
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
  CARGAR_DATOS_DOCUMENTO_FACTURA_PORT,
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
  UNIDAD_DE_TRABAJO_COBRO_PORT,
  UNIDAD_DE_TRABAJO_COBRO_FIANZA_PORT,
  UNIDAD_DE_TRABAJO_DEVOLUCION_FIANZA_PORT,
  UNIDAD_DE_TRABAJO_SENAL_EMISION_PORT,
  CARGAR_RESERVA_SENAL_EMISION_PORT,
  ENVIAR_E3_EMISION_PORT,
  CARGAR_RESERVA_REENVIO_E3_PORT,
  CARGAR_FACTURA_SENAL_REENVIO_PORT,
  BUSCAR_E3_PREVIA_PORT,
  BUSCAR_DOCUMENTO_CONDICIONES_PORT,
  REENVIAR_E3_PORT,
  REGISTRAR_COMUNICACION_REENVIO_E3_PORT,
  FIJAR_CONDICIONES_ENVIADAS_REENVIO_PORT,
  REGISTRAR_AUDITORIA_REENVIO_E3_PORT,
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
  imports: [PrismaModule, ComunicacionesModule, DocumentosModule],
  controllers: [FacturaController, RegistrarDevolucionFianzaController],
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
    // 6.3: carga de los datos del documento de factura (config + presupuesto aceptado + cliente).
    {
      provide: CARGAR_DATOS_DOCUMENTO_FACTURA_PORT,
      inject: [PrismaService],
      useFactory: (prisma: PrismaService): CargarDatosDocumentoFacturaPort =>
        new CargarDatosDocumentoFacturaPrismaAdapter(prisma),
    },
    // 6.3: adaptador REAL de PDF de factura (render react-pdf + almacén). Sustituye al fake.
    {
      provide: GENERAR_PDF_FACTURA_PORT,
      inject: [CARGAR_DATOS_DOCUMENTO_FACTURA_PORT, ALMACEN_DOCUMENTOS_PORT],
      useFactory: (
        cargarDatos: CargarDatosDocumentoFacturaPort,
        almacen: AlmacenDocumentosPort,
      ): GenerarPdfFacturaPort =>
        new PdfFacturaRealAdapter(
          cargarDatos,
          almacen,
          // 6.5: el render resuelve el logo por bytes/data-URI desde el mismo almacén.
          (modelo) => renderizarDocumentoFacturaABytes(modelo, almacen),
        ).generar,
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

    // --- 6.4b / US-023: adaptadores del envío de la factura de señal (40%) + E3 ---
    {
      provide: UNIDAD_DE_TRABAJO_SENAL_EMISION_PORT,
      inject: [PrismaService],
      useFactory: (prisma: PrismaService) => new SenalEmisionUoWPrismaAdapter(prisma),
    },
    {
      provide: CARGAR_RESERVA_SENAL_EMISION_PORT,
      inject: [PrismaService],
      useFactory: (prisma: PrismaService): CargarReservaSenalEmisionPort =>
        new CargarReservaSenalEmisionPrismaAdapter(prisma).cargar,
    },
    {
      provide: ENVIAR_E3_EMISION_PORT,
      inject: [ENVIAR_EMAIL_PORT],
      useFactory: (enviarEmail: EnviarEmailPort): EnviarE3EmisionPort =>
        new EnviarE3EmisionAdapter(enviarEmail).enviar,
    },

    // --- US-023 (GAP 3): adaptadores del reenvío de E3 (señal + condiciones) ---
    {
      provide: CARGAR_RESERVA_REENVIO_E3_PORT,
      inject: [PrismaService],
      useFactory: (prisma: PrismaService): CargarReservaReenvioE3Port =>
        new CargarReservaReenvioE3PrismaAdapter(prisma).cargar,
    },
    {
      provide: CARGAR_FACTURA_SENAL_REENVIO_PORT,
      inject: [PrismaService],
      useFactory: (prisma: PrismaService): CargarFacturaSenalReenvioPort =>
        new CargarFacturaSenalReenvioPrismaAdapter(prisma).cargar,
    },
    {
      provide: BUSCAR_E3_PREVIA_PORT,
      inject: [PrismaService],
      useFactory: (prisma: PrismaService): BuscarE3PreviaPort =>
        new BuscarE3PreviaPrismaAdapter(prisma).buscar,
    },
    {
      provide: BUSCAR_DOCUMENTO_CONDICIONES_PORT,
      inject: [PrismaService],
      useFactory: (prisma: PrismaService): BuscarDocumentoCondicionesPort =>
        new BuscarDocumentoCondicionesPrismaAdapter(prisma).buscar,
    },
    {
      provide: REENVIAR_E3_PORT,
      inject: [ENVIAR_EMAIL_PORT],
      useFactory: (enviarEmail: EnviarEmailPort): ReenviarE3Port =>
        new ReenviarE3Adapter(enviarEmail).reenviar,
    },
    {
      provide: REGISTRAR_COMUNICACION_REENVIO_E3_PORT,
      inject: [PrismaService],
      useFactory: (prisma: PrismaService): RegistrarComunicacionReenvioE3Port =>
        new RegistrarComunicacionReenvioE3PrismaAdapter(prisma).registrar,
    },
    {
      provide: FIJAR_CONDICIONES_ENVIADAS_REENVIO_PORT,
      inject: [PrismaService],
      useFactory: (prisma: PrismaService): FijarCondicionesEnviadasReenvioPort =>
        new FijarCondicionesEnviadasReenvioPrismaAdapter(prisma).fijar,
    },
    {
      provide: REGISTRAR_AUDITORIA_REENVIO_E3_PORT,
      inject: [PrismaService],
      useFactory: (prisma: PrismaService): RegistrarAuditoriaReenvioE3Port =>
        new RegistrarAuditoriaReenvioE3PrismaAdapter(prisma).registrar,
    },

    // --- US-029: unidad de trabajo del cobro de la liquidación (FOR UPDATE sobre RESERVA) ---
    {
      provide: UNIDAD_DE_TRABAJO_COBRO_PORT,
      inject: [PrismaService],
      useFactory: (prisma: PrismaService) => new CobroLiquidacionUoWPrismaAdapter(prisma),
    },

    // --- US-030: unidad de trabajo del cobro de la fianza (FOR UPDATE sobre RESERVA) ---
    {
      provide: UNIDAD_DE_TRABAJO_COBRO_FIANZA_PORT,
      inject: [PrismaService],
      useFactory: (prisma: PrismaService) => new CobroFianzaUoWPrismaAdapter(prisma),
    },

    // --- US-036: unidad de trabajo de la devolución de la fianza (FOR UPDATE sobre RESERVA) ---
    {
      provide: UNIDAD_DE_TRABAJO_DEVOLUCION_FIANZA_PORT,
      inject: [PrismaService],
      useFactory: (prisma: PrismaService) => new DevolucionFianzaUoWPrismaAdapter(prisma),
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
    {
      provide: EnviarFacturaSenalUseCase,
      inject: [
        UNIDAD_DE_TRABAJO_SENAL_EMISION_PORT,
        CARGAR_RESERVA_SENAL_EMISION_PORT,
        ENVIAR_E3_EMISION_PORT,
        FACTURACION_CLOCK_PORT,
      ],
      // Mejora B: E3 ya no envía condiciones (van en E2); el use-case no inyecta el PDF
      // de condiciones ni toca la RESERVA.
      useFactory: (
        unidadDeTrabajo: UnidadDeTrabajoSenalEmisionPort,
        cargarReserva: CargarReservaSenalEmisionPort,
        enviarE3: EnviarE3EmisionPort,
        clock: ClockSenalPort,
      ) =>
        new EnviarFacturaSenalUseCase({
          unidadDeTrabajo,
          cargarReserva,
          enviarE3,
          clock,
        }),
    },
    {
      provide: ReenviarE3UseCase,
      inject: [
        CARGAR_RESERVA_REENVIO_E3_PORT,
        CARGAR_FACTURA_SENAL_REENVIO_PORT,
        BUSCAR_E3_PREVIA_PORT,
        BUSCAR_DOCUMENTO_CONDICIONES_PORT,
        REENVIAR_E3_PORT,
        REGISTRAR_COMUNICACION_REENVIO_E3_PORT,
        FIJAR_CONDICIONES_ENVIADAS_REENVIO_PORT,
        REGISTRAR_AUDITORIA_REENVIO_E3_PORT,
        FACTURACION_CLOCK_PORT,
      ],
      useFactory: (
        cargarReserva: CargarReservaReenvioE3Port,
        cargarFacturaSenal: CargarFacturaSenalReenvioPort,
        buscarE3Previa: BuscarE3PreviaPort,
        buscarDocumentoCondiciones: BuscarDocumentoCondicionesPort,
        reenviarE3: ReenviarE3Port,
        registrarComunicacion: RegistrarComunicacionReenvioE3Port,
        fijarCondicionesEnviadas: FijarCondicionesEnviadasReenvioPort,
        registrarAuditoria: RegistrarAuditoriaReenvioE3Port,
        clock: ClockPort,
      ) =>
        new ReenviarE3UseCase({
          cargarReserva,
          cargarFacturaSenal,
          buscarE3Previa,
          buscarDocumentoCondiciones,
          reenviarE3,
          registrarComunicacion,
          fijarCondicionesEnviadas,
          registrarAuditoria,
          clock,
        }),
    },
    {
      provide: RegistrarCobroLiquidacionUseCase,
      inject: [UNIDAD_DE_TRABAJO_COBRO_PORT, FACTURACION_CLOCK_PORT],
      useFactory: (unidadDeTrabajo: UnidadDeTrabajoCobroPort, clock: ClockPort) =>
        new RegistrarCobroLiquidacionUseCase({ unidadDeTrabajo, clock }),
    },
    {
      provide: RegistrarCobroFianzaUseCase,
      inject: [UNIDAD_DE_TRABAJO_COBRO_FIANZA_PORT],
      useFactory: (unidadDeTrabajo: UnidadDeTrabajoCobroFianzaPort) =>
        new RegistrarCobroFianzaUseCase({ unidadDeTrabajo }),
    },
    {
      provide: RegistrarDevolucionFianzaUseCase,
      inject: [UNIDAD_DE_TRABAJO_DEVOLUCION_FIANZA_PORT],
      useFactory: (unidadDeTrabajo: UnidadDeTrabajoDevolucionFianzaPort) =>
        new RegistrarDevolucionFianzaUseCase({ unidadDeTrabajo }),
    },
  ],
  exports: [
    GenerarFacturaSenalUseCase,
    GenerarBorradoresLiquidacionFianzaUseCase,
    AprobarYEnviarLiquidacionUseCase,
    EnviarReciboFianzaSeparadoUseCase,
    EnviarFacturaSenalUseCase,
    ReenviarLiquidacionUseCase,
    ReenviarE3UseCase,
    RegistrarCobroLiquidacionUseCase,
    RegistrarCobroFianzaUseCase,
    RegistrarDevolucionFianzaUseCase,
  ],
})
export class FacturacionModule {}
