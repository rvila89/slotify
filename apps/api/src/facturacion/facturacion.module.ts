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
import {
  CATALOGO_PLANTILLAS_PORT,
  ENVIAR_EMAIL_PORT,
} from '../comunicaciones/comunicaciones.tokens';
import type { EnviarEmailPort } from '../comunicaciones/domain/enviar-email.port';
import type { CatalogoPlantillasPort } from '../comunicaciones/domain/catalogo-plantillas.port';
import { DocumentosModule } from '../documentos/documentos.module';
import {
  ALMACEN_DOCUMENTOS_PORT,
  GENERAR_PDF_CONDICIONES_PORT,
} from '../documentos/documentos.tokens';
import type { AlmacenDocumentosPort } from '../documentos/domain/almacen-documentos.port';
import type { GenerarPdfCondicionesPort } from '../documentos/domain/generar-pdf-condiciones.port';
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
  type VerificarE3EnviadoPort,
} from './application/obtener-factura-senal.use-case';
import {
  ObtenerFacturaLiquidacionUseCase,
  type CargarFacturaLiquidacionPort,
  type VerificarE4EnviadoPort,
} from './application/obtener-factura-liquidacion.use-case';
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
  type CargarReservaLiquidablePort,
  type UnidadDeTrabajoBorradoresPort,
} from './application/generar-borradores-liquidacion-fianza.use-case';
import {
  ListarFacturasReservaUseCase,
  type ListarFacturasReservaPort,
} from './application/listar-facturas-reserva.use-case';
import {
  EnviarFacturaLiquidacionUseCase,
  type CargarReservaLiquidacionEmisionPort,
  type EnviarE4EmisionPort,
  type UnidadDeTrabajoLiquidacionEmisionPort,
} from './application/enviar-factura-liquidacion.use-case';
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
  SubirComprobanteFianzaUseCase,
  type AlmacenarComprobanteFianzaPort,
  type CargarReservaComprobanteFianzaPort,
  type UnidadDeTrabajoComprobanteFianzaPort,
} from './application/subir-comprobante-fianza.use-case';
import {
  DevolverFianzaUseCase,
  type DispararE10Port,
  type UnidadDeTrabajoDevolverFianzaPort,
} from './application/devolver-fianza.use-case';
import {
  ComprobanteFianzaUoWPrismaAdapter,
  CargarReservaComprobanteFianzaAdapter,
  AlmacenarComprobanteFianzaAdapter,
} from './infrastructure/comprobante-fianza.prisma.adapter';
import {
  DevolverFianzaUoWPrismaAdapter,
  DispararE10Adapter,
} from './infrastructure/devolver-fianza.prisma.adapter';
import { FianzaController } from './interface/fianza.controller';
import { ObtenerReservaUseCase } from '../reservas/application/obtener-reserva.query';
import { ReservaDetalleQueryPrismaAdapter } from '../reservas/infrastructure/reserva-detalle-query.prisma.adapter';
import { DespacharEmailService } from '../comunicaciones/application/despachar-email.service';
import type { FacturaSenal } from './application/generar-factura-senal.use-case';
import {
  EmisionUoWPrismaAdapter,
  SenalEmisionUoWPrismaAdapter,
} from './infrastructure/emision-uow.prisma.adapter';
import {
  BuscarE3PreviaPrismaAdapter,
  CargarFacturaSenalReenvioPrismaAdapter,
  CargarLiquidacionReenvioPrismaAdapter,
  CargarFacturaLiquidacionPrismaAdapter,
  CargarReservaEmisionPrismaAdapter,
  CargarReservaReenvioPrismaAdapter,
  CargarReservaReenvioE3PrismaAdapter,
  CargarReservaSenalEmisionPrismaAdapter,
  VerificarE3EnviadoPrismaAdapter,
  VerificarE4EnviadoPrismaAdapter,
} from './infrastructure/lecturas-emision.prisma.adapter';
import {
  EnviarE3EmisionAdapter,
  EnviarE4EmisionAdapter,
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
  CARGAR_FACTURA_LIQUIDACION_PORT,
  VERIFICAR_E4_ENVIADO_PORT,
  CARGAR_RESERVA_REENVIO_PORT,
  CARGAR_LIQUIDACION_REENVIO_PORT,
  REENVIAR_E4_PORT,
  REGISTRAR_COMUNICACION_REENVIO_PORT,
  REGISTRAR_AUDITORIA_REENVIO_PORT,
  UNIDAD_DE_TRABAJO_COBRO_PORT,
  UNIDAD_DE_TRABAJO_COMPROBANTE_FIANZA_PORT,
  CARGAR_RESERVA_COMPROBANTE_FIANZA_PORT,
  ALMACENAR_COMPROBANTE_FIANZA_PORT,
  UNIDAD_DE_TRABAJO_DEVOLVER_FIANZA_PORT,
  DISPARAR_E10_PORT,
  UNIDAD_DE_TRABAJO_SENAL_EMISION_PORT,
  CARGAR_RESERVA_SENAL_EMISION_PORT,
  ENVIAR_E3_EMISION_PORT,
  VERIFICAR_E3_ENVIADO_PORT,
  CARGAR_RESERVA_REENVIO_E3_PORT,
  CARGAR_FACTURA_SENAL_REENVIO_PORT,
  BUSCAR_E3_PREVIA_PORT,
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
  controllers: [FacturaController, FianzaController],
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
      useFactory: (prisma: PrismaService): CargarReservaLiquidacionEmisionPort =>
        new CargarReservaEmisionPrismaAdapter(prisma).cargar,
    },
    {
      provide: ENVIAR_E4_EMISION_PORT,
      inject: [ENVIAR_EMAIL_PORT, CATALOGO_PLANTILLAS_PORT],
      useFactory: (
        enviarEmail: EnviarEmailPort,
        catalogo: CatalogoPlantillasPort,
      ): EnviarE4EmisionPort => new EnviarE4EmisionAdapter(enviarEmail, catalogo).enviar,
    },
    {
      provide: CARGAR_FACTURA_LIQUIDACION_PORT,
      inject: [PrismaService],
      useFactory: (prisma: PrismaService): CargarFacturaLiquidacionPort =>
        new CargarFacturaLiquidacionPrismaAdapter(prisma).cargar,
    },
    {
      provide: VERIFICAR_E4_ENVIADO_PORT,
      inject: [PrismaService],
      useFactory: (prisma: PrismaService): VerificarE4EnviadoPort =>
        new VerificarE4EnviadoPrismaAdapter(prisma).verificar,
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
      inject: [ENVIAR_EMAIL_PORT, CATALOGO_PLANTILLAS_PORT],
      useFactory: (
        enviarEmail: EnviarEmailPort,
        catalogo: CatalogoPlantillasPort,
      ): ReenviarE4Port => new ReenviarE4Adapter(enviarEmail, catalogo).reenviar,
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
      inject: [ENVIAR_EMAIL_PORT, CATALOGO_PLANTILLAS_PORT],
      useFactory: (
        enviarEmail: EnviarEmailPort,
        catalogo: CatalogoPlantillasPort,
      ): EnviarE3EmisionPort =>
        new EnviarE3EmisionAdapter(enviarEmail, catalogo).enviar,
    },
    {
      provide: VERIFICAR_E3_ENVIADO_PORT,
      inject: [PrismaService],
      useFactory: (prisma: PrismaService): VerificarE3EnviadoPort =>
        new VerificarE3EnviadoPrismaAdapter(prisma).verificar,
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
      provide: REENVIAR_E3_PORT,
      inject: [ENVIAR_EMAIL_PORT, CATALOGO_PLANTILLAS_PORT],
      useFactory: (
        enviarEmail: EnviarEmailPort,
        catalogo: CatalogoPlantillasPort,
      ): ReenviarE3Port =>
        new ReenviarE3Adapter(enviarEmail, catalogo).reenviar,
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

    // --- fix-liquidacion-fianza-independientes: fianza pasiva (comprobante) ---
    {
      provide: UNIDAD_DE_TRABAJO_COMPROBANTE_FIANZA_PORT,
      inject: [PrismaService],
      useFactory: (prisma: PrismaService) => new ComprobanteFianzaUoWPrismaAdapter(prisma),
    },
    {
      provide: CARGAR_RESERVA_COMPROBANTE_FIANZA_PORT,
      inject: [PrismaService],
      useFactory: (prisma: PrismaService): CargarReservaComprobanteFianzaPort =>
        new CargarReservaComprobanteFianzaAdapter(prisma).cargar,
    },
    {
      provide: ALMACENAR_COMPROBANTE_FIANZA_PORT,
      inject: [ALMACEN_DOCUMENTOS_PORT],
      useFactory: (almacen: AlmacenDocumentosPort): AlmacenarComprobanteFianzaPort =>
        new AlmacenarComprobanteFianzaAdapter(almacen).almacenar,
    },

    // --- fix-liquidacion-fianza-independientes: devolución completa de la fianza + E10 ---
    {
      provide: UNIDAD_DE_TRABAJO_DEVOLVER_FIANZA_PORT,
      inject: [PrismaService],
      useFactory: (prisma: PrismaService) => new DevolverFianzaUoWPrismaAdapter(prisma),
    },
    {
      provide: DISPARAR_E10_PORT,
      inject: [DespacharEmailService, PrismaService],
      useFactory: (motor: DespacharEmailService, prisma: PrismaService): DispararE10Port =>
        new DispararE10Adapter(motor, prisma),
    },

    // --- Lectura del detalle de la RESERVA para las respuestas de fianza (read-DTO) ---
    {
      provide: ObtenerReservaUseCase,
      inject: [PrismaService],
      useFactory: (prisma: PrismaService) =>
        new ObtenerReservaUseCase({
          reservaDetalle: new ReservaDetalleQueryPrismaAdapter(prisma),
        }),
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
        VERIFICAR_E3_ENVIADO_PORT,
      ],
      useFactory: (
        unidadDeTrabajo: UnidadDeTrabajoFacturacionPort,
        cargarReserva: CargarReservaFacturablePort,
        cargarCliente: CargarClienteFiscalPort,
        cargarFacturaParaPdf: CargarFacturaParaPdfPort,
        verificarE3Enviado: VerificarE3EnviadoPort,
      ) =>
        new ObtenerFacturaSenalUseCase({
          unidadDeTrabajo,
          cargarReserva,
          cargarCliente,
          cargarFacturaParaPdf,
          verificarE3Enviado,
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
      ],
      useFactory: (
        unidadDeTrabajo: UnidadDeTrabajoBorradoresPort,
        cargarReserva: CargarReservaLiquidablePort,
        cargarExtrasPendientes: CargarExtrasPendientesPort,
      ) =>
        new GenerarBorradoresLiquidacionFianzaUseCase({
          unidadDeTrabajo,
          cargarReserva,
          cargarExtrasPendientes,
        }),
    },
    {
      provide: ListarFacturasReservaUseCase,
      inject: [LISTAR_FACTURAS_RESERVA_PORT],
      useFactory: (listarFacturas: ListarFacturasReservaPort) =>
        new ListarFacturasReservaUseCase({ listarFacturas }),
    },
    {
      provide: EnviarFacturaLiquidacionUseCase,
      inject: [
        UNIDAD_DE_TRABAJO_EMISION_PORT,
        CARGAR_RESERVA_EMISION_PORT,
        ENVIAR_E4_EMISION_PORT,
        FACTURACION_CLOCK_PORT,
      ],
      useFactory: (
        unidadDeTrabajo: UnidadDeTrabajoLiquidacionEmisionPort,
        cargarReserva: CargarReservaLiquidacionEmisionPort,
        enviarE4: EnviarE4EmisionPort,
        clock: ClockPort,
      ) =>
        new EnviarFacturaLiquidacionUseCase({
          unidadDeTrabajo,
          cargarReserva,
          enviarE4,
          clock,
        }),
    },
    {
      provide: ObtenerFacturaLiquidacionUseCase,
      inject: [
        CARGAR_RESERVA_FACTURABLE_PORT,
        CARGAR_FACTURA_LIQUIDACION_PORT,
        CARGAR_CLIENTE_FISCAL_PORT,
        VERIFICAR_E4_ENVIADO_PORT,
      ],
      useFactory: (
        cargarReserva: CargarReservaFacturablePort,
        cargarLiquidacion: CargarFacturaLiquidacionPort,
        cargarCliente: CargarClienteFiscalPort,
        verificarE4Enviado: VerificarE4EnviadoPort,
      ) =>
        new ObtenerFacturaLiquidacionUseCase({
          cargarReserva,
          cargarLiquidacion,
          cargarCliente,
          verificarE4Enviado,
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
        GENERAR_PDF_CONDICIONES_PORT,
        FACTURACION_CLOCK_PORT,
      ],
      // change condiciones-…-senal-…: E3 vuelve a llevar las condiciones (degradables); el
      // use-case genera el PDF PRE-TX y fija `cond_part_enviadas_fecha` en la tx.
      useFactory: (
        unidadDeTrabajo: UnidadDeTrabajoSenalEmisionPort,
        cargarReserva: CargarReservaSenalEmisionPort,
        enviarE3: EnviarE3EmisionPort,
        generarCondiciones: GenerarPdfCondicionesPort,
        clock: ClockSenalPort,
      ) =>
        new EnviarFacturaSenalUseCase({
          unidadDeTrabajo,
          cargarReserva,
          enviarE3,
          generarCondiciones,
          clock,
        }),
    },
    {
      provide: ReenviarE3UseCase,
      inject: [
        CARGAR_RESERVA_REENVIO_E3_PORT,
        CARGAR_FACTURA_SENAL_REENVIO_PORT,
        BUSCAR_E3_PREVIA_PORT,
        GENERAR_PDF_CONDICIONES_PORT,
        REENVIAR_E3_PORT,
        REGISTRAR_COMUNICACION_REENVIO_E3_PORT,
        FIJAR_CONDICIONES_ENVIADAS_REENVIO_PORT,
        REGISTRAR_AUDITORIA_REENVIO_E3_PORT,
        FACTURACION_CLOCK_PORT,
      ],
      // change condiciones-…-senal-…: el reenvío REGENERA el PDF de condiciones en blanco vía
      // `GenerarPdfCondicionesPort` en vez de buscar un DOCUMENTO persistido (stale).
      useFactory: (
        cargarReserva: CargarReservaReenvioE3Port,
        cargarFacturaSenal: CargarFacturaSenalReenvioPort,
        buscarE3Previa: BuscarE3PreviaPort,
        generarCondiciones: GenerarPdfCondicionesPort,
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
          generarCondiciones,
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
      provide: SubirComprobanteFianzaUseCase,
      inject: [
        UNIDAD_DE_TRABAJO_COMPROBANTE_FIANZA_PORT,
        CARGAR_RESERVA_COMPROBANTE_FIANZA_PORT,
        ALMACENAR_COMPROBANTE_FIANZA_PORT,
        FACTURACION_CLOCK_PORT,
      ],
      useFactory: (
        unidadDeTrabajo: UnidadDeTrabajoComprobanteFianzaPort,
        cargarReserva: CargarReservaComprobanteFianzaPort,
        almacenarComprobante: AlmacenarComprobanteFianzaPort,
        clock: ClockPort,
      ) =>
        new SubirComprobanteFianzaUseCase({
          unidadDeTrabajo,
          cargarReserva,
          almacenarComprobante,
          clock,
        }),
    },
    {
      provide: DevolverFianzaUseCase,
      inject: [
        UNIDAD_DE_TRABAJO_DEVOLVER_FIANZA_PORT,
        DISPARAR_E10_PORT,
        FACTURACION_CLOCK_PORT,
      ],
      useFactory: (
        unidadDeTrabajo: UnidadDeTrabajoDevolverFianzaPort,
        dispararE10: DispararE10Port,
        clock: ClockPort,
      ) =>
        new DevolverFianzaUseCase({ unidadDeTrabajo, dispararE10, clock }),
    },
  ],
  exports: [
    GenerarFacturaSenalUseCase,
    GenerarBorradoresLiquidacionFianzaUseCase,
    EnviarFacturaLiquidacionUseCase,
    ObtenerFacturaLiquidacionUseCase,
    EnviarFacturaSenalUseCase,
    ReenviarLiquidacionUseCase,
    ReenviarE3UseCase,
    RegistrarCobroLiquidacionUseCase,
    SubirComprobanteFianzaUseCase,
    DevolverFianzaUseCase,
  ],
})
export class FacturacionModule {}
