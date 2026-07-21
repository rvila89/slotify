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
import { DocumentosModule } from '../documentos/documentos.module';
import { ObtenerConfiguracionDocumentoService } from '../documentos/application/obtener-configuracion-documento.service';
import {
  ALMACEN_DOCUMENTOS_PORT,
  GENERAR_PDF_CONDICIONES_PORT,
} from '../documentos/documentos.tokens';
import type { AlmacenDocumentosPort } from '../documentos/domain/almacen-documentos.port';
import type { GenerarPdfCondicionesPort } from '../documentos/domain/generar-pdf-condiciones.port';
import { renderizarDocumentoPresupuestoABytes } from '../documentos/presentation/documento-presupuesto.render';
import {
  GenerarPresupuestoUseCase,
  type CargarClientePort,
  type CargarReservaPort,
  type ClockPort,
  type DispararE2Port,
  type GenerarPdfPresupuestoPort,
  type GuardarPdfUrlPresupuestoPort,
  type TenantSettingsPresupuestoPort,
  type UnidadDeTrabajoActivarPrereservaPort,
} from './application/generar-presupuesto.use-case';
import { ActivarPrereservaUoWPrismaAdapter } from './infrastructure/activar-prereserva-uow.prisma.adapter';
import { CargarReservaPrismaAdapter } from './infrastructure/cargar-reserva.prisma.adapter';
import { CargarClientePrismaAdapter } from './infrastructure/cargar-cliente.prisma.adapter';
import { TenantSettingsPresupuestoPrismaAdapter } from './infrastructure/tenant-settings-presupuesto.prisma.adapter';
import {
  PdfPresupuestoRealAdapter,
  type CargarDatosDocumentoPresupuestoPort,
} from './infrastructure/pdf-presupuesto.real.adapter';
import { CargarDatosDocumentoPresupuestoPrismaAdapter } from './infrastructure/cargar-datos-documento-presupuesto.prisma.adapter';
import { DispararE2Adapter } from './infrastructure/disparar-e2.adapter';
import { GuardarPdfUrlPresupuestoPrismaAdapter } from './infrastructure/guardar-pdf-url-presupuesto.prisma.adapter';
import { SistemaClockAdapter } from './infrastructure/sistema-clock.adapter';
import { GenerarPresupuestoController } from './interface/generar-presupuesto.controller';
import { EditarPresupuestoController } from './interface/editar-presupuesto.controller';
import {
  EditarPresupuestoUseCase,
  ReenviarPresupuestoUseCase,
  type CargarExtraCatalogoPort,
  type CargarLineasExistentesPort,
  type CargarPresupuestoVigentePort,
  type CargarReservaEdicionPort,
  type ClockPort as EdicionClockPort,
  type DispararE2EdicionPort,
  type GenerarPdfEdicionPort,
  type ReenviarE2Port,
  type TenantSettingsPresupuestoPort as EdicionTenantSettingsPort,
  type UnidadDeTrabajoEditarPresupuestoPort,
} from './application/editar-presupuesto.use-case';
import {
  CargarExtraCatalogoPrismaAdapter,
  CargarLineasExistentesPrismaAdapter,
  CargarPresupuestoVigentePrismaAdapter,
  CargarReservaEdicionPrismaAdapter,
} from './infrastructure/editar-presupuesto-lecturas.prisma.adapter';
import { EditarPresupuestoUoWPrismaAdapter } from './infrastructure/editar-presupuesto-uow.prisma.adapter';
import {
  ReenviarE2PresupuestoAdapter,
  RegistrarAuditoriaReenvioPresupuestoAdapter,
  RegistrarE2ReenvioPresupuestoAdapter,
} from './infrastructure/reenviar-presupuesto.prisma.adapter';
import {
  CARGAR_CLIENTE_PRESUPUESTO_PORT,
  CARGAR_DATOS_DOCUMENTO_PRESUPUESTO_PORT,
  CARGAR_EXTRA_CATALOGO_PORT,
  CARGAR_LINEAS_EXISTENTES_PORT,
  CARGAR_PRESUPUESTO_VIGENTE_PORT,
  CARGAR_RESERVA_EDICION_PORT,
  CARGAR_RESERVA_PRESUPUESTO_PORT,
  DISPARAR_E2_PORT,
  GENERAR_PDF_PRESUPUESTO_PORT,
  GUARDAR_PDF_URL_PRESUPUESTO_PORT,
  PRESUPUESTOS_CLOCK_PORT,
  REENVIAR_E2_PRESUPUESTO_PORT,
  REGISTRAR_AUDITORIA_REENVIO_PORT,
  REGISTRAR_E2_REENVIO_PORT,
  TENANT_SETTINGS_PRESUPUESTO_PORT,
  UNIDAD_DE_TRABAJO_ACTIVAR_PRERESERVA_PORT,
  UNIDAD_DE_TRABAJO_EDITAR_PRESUPUESTO_PORT,
} from './presupuestos.tokens';

@Module({
  imports: [PrismaModule, TarifasModule, ComunicacionesModule, DocumentosModule],
  controllers: [GenerarPresupuestoController, EditarPresupuestoController],
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
      provide: CARGAR_DATOS_DOCUMENTO_PRESUPUESTO_PORT,
      useClass: CargarDatosDocumentoPresupuestoPrismaAdapter,
    },
    {
      // Épico #6 6.1b: PDF REAL con react-pdf (sustituye al fake en producción). El
      // render es la función de la capa de plantilla de `documentos`; el adaptador
      // carga config + datos, renderiza a bytes, sube por el almacén y devuelve la URL.
      provide: GENERAR_PDF_PRESUPUESTO_PORT,
      inject: [
        ObtenerConfiguracionDocumentoService,
        CARGAR_DATOS_DOCUMENTO_PRESUPUESTO_PORT,
        ALMACEN_DOCUMENTOS_PORT,
      ],
      useFactory: (
        configService: ObtenerConfiguracionDocumentoService,
        cargarDatos: CargarDatosDocumentoPresupuestoPort,
        almacen: AlmacenDocumentosPort,
      ): GenerarPdfPresupuestoPort =>
        new PdfPresupuestoRealAdapter(
          configService,
          cargarDatos,
          almacen,
          // 6.5: el render resuelve el logo por bytes/data-URI desde el mismo almacén.
          (config, datos) =>
            renderizarDocumentoPresupuestoABytes(config, datos, almacen),
        ).generar,
    },
    {
      provide: DISPARAR_E2_PORT,
      inject: [DespacharEmailService, PrismaService, GENERAR_PDF_CONDICIONES_PORT],
      useFactory: (
        motor: DespacharEmailService,
        prisma: PrismaService,
        generarCondiciones: GenerarPdfCondicionesPort,
      ) => new DispararE2Adapter(motor, prisma, generarCondiciones),
    },
    { provide: PRESUPUESTOS_CLOCK_PORT, useClass: SistemaClockAdapter },
    {
      provide: GUARDAR_PDF_URL_PRESUPUESTO_PORT,
      inject: [PrismaService],
      useFactory: (prisma: PrismaService): GuardarPdfUrlPresupuestoPort =>
        new GuardarPdfUrlPresupuestoPrismaAdapter(prisma).guardar,
    },
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
        GUARDAR_PDF_URL_PRESUPUESTO_PORT,
        // Mejora B: guarda dura de condiciones PRE-TX (mismo adapter de PDF de condiciones).
        GENERAR_PDF_CONDICIONES_PORT,
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
        guardarPdfUrl: GuardarPdfUrlPresupuestoPort,
        generarCondicionesPort: GenerarPdfCondicionesPort,
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
          guardarPdfUrl,
          generarCondicionesPort,
        }),
    },
    // -----------------------------------------------------------------------
    // US-015 — Edición / reenvío del presupuesto en pre_reserva
    // -----------------------------------------------------------------------
    {
      provide: UNIDAD_DE_TRABAJO_EDITAR_PRESUPUESTO_PORT,
      inject: [PrismaService],
      useFactory: (prisma: PrismaService) =>
        new EditarPresupuestoUoWPrismaAdapter(prisma),
    },
    {
      provide: CARGAR_RESERVA_EDICION_PORT,
      inject: [PrismaService],
      useFactory: (prisma: PrismaService): CargarReservaEdicionPort =>
        new CargarReservaEdicionPrismaAdapter(prisma).cargar,
    },
    {
      provide: CARGAR_PRESUPUESTO_VIGENTE_PORT,
      inject: [PrismaService],
      useFactory: (prisma: PrismaService): CargarPresupuestoVigentePort =>
        new CargarPresupuestoVigentePrismaAdapter(prisma).cargar,
    },
    {
      provide: CARGAR_EXTRA_CATALOGO_PORT,
      inject: [PrismaService],
      useFactory: (prisma: PrismaService): CargarExtraCatalogoPort =>
        new CargarExtraCatalogoPrismaAdapter(prisma).cargar,
    },
    {
      provide: CARGAR_LINEAS_EXISTENTES_PORT,
      inject: [PrismaService],
      useFactory: (prisma: PrismaService): CargarLineasExistentesPort =>
        new CargarLineasExistentesPrismaAdapter(prisma).cargar,
    },
    {
      provide: REENVIAR_E2_PRESUPUESTO_PORT,
      inject: [DespacharEmailService, PrismaService],
      useFactory: (
        motor: DespacharEmailService,
        prisma: PrismaService,
      ): ReenviarE2Port =>
        new ReenviarE2PresupuestoAdapter(motor, prisma).reenviar,
    },
    {
      provide: REGISTRAR_E2_REENVIO_PORT,
      inject: [PrismaService],
      useFactory: (prisma: PrismaService) =>
        new RegistrarE2ReenvioPresupuestoAdapter(prisma).registrar,
    },
    {
      provide: REGISTRAR_AUDITORIA_REENVIO_PORT,
      inject: [PrismaService],
      useFactory: (prisma: PrismaService) =>
        new RegistrarAuditoriaReenvioPresupuestoAdapter(prisma).registrar,
    },
    {
      provide: EditarPresupuestoUseCase,
      inject: [
        CalculadoraTarifaService,
        UNIDAD_DE_TRABAJO_EDITAR_PRESUPUESTO_PORT,
        TENANT_SETTINGS_PRESUPUESTO_PORT,
        CARGAR_RESERVA_EDICION_PORT,
        CARGAR_PRESUPUESTO_VIGENTE_PORT,
        CARGAR_EXTRA_CATALOGO_PORT,
        CARGAR_LINEAS_EXISTENTES_PORT,
        GENERAR_PDF_PRESUPUESTO_PORT,
        PRESUPUESTOS_CLOCK_PORT,
        DISPARAR_E2_PORT,
        GUARDAR_PDF_URL_PRESUPUESTO_PORT,
      ],
      useFactory: (
        motorTarifa: CalculadoraTarifaService,
        unidadDeTrabajo: UnidadDeTrabajoEditarPresupuestoPort,
        tenantSettings: EdicionTenantSettingsPort,
        cargarReserva: CargarReservaEdicionPort,
        cargarPresupuestoVigente: CargarPresupuestoVigentePort,
        cargarExtraCatalogo: CargarExtraCatalogoPort,
        cargarLineasExistentes: CargarLineasExistentesPort,
        generarPdf: GenerarPdfPresupuestoPort,
        clock: EdicionClockPort,
        dispararE2: DispararE2EdicionPort,
        guardarPdfUrl: GuardarPdfUrlPresupuestoPort,
      ) =>
        new EditarPresupuestoUseCase({
          motorTarifa,
          unidadDeTrabajo,
          tenantSettings,
          cargarReserva,
          cargarPresupuestoVigente,
          cargarExtraCatalogo,
          cargarLineasExistentes,
          generarPdf,
          clock,
          dispararE2,
          guardarPdfUrl,
        }),
    },
    {
      provide: ReenviarPresupuestoUseCase,
      inject: [
        CARGAR_RESERVA_EDICION_PORT,
        CARGAR_PRESUPUESTO_VIGENTE_PORT,
        REENVIAR_E2_PRESUPUESTO_PORT,
        REGISTRAR_E2_REENVIO_PORT,
        REGISTRAR_AUDITORIA_REENVIO_PORT,
        PRESUPUESTOS_CLOCK_PORT,
        GENERAR_PDF_PRESUPUESTO_PORT,
      ],
      useFactory: (
        cargarReserva: CargarReservaEdicionPort,
        cargarPresupuestoVigente: CargarPresupuestoVigentePort,
        reenviarE2: ReenviarE2Port,
        registrarE2Reenvio: RegistrarE2ReenvioPresupuestoAdapter['registrar'],
        registrarAuditoria: RegistrarAuditoriaReenvioPresupuestoAdapter['registrar'],
        clock: EdicionClockPort,
        generarPdf: GenerarPdfEdicionPort,
      ) =>
        new ReenviarPresupuestoUseCase({
          cargarReserva,
          cargarPresupuestoVigente,
          reenviarE2,
          registrarE2Reenvio,
          registrarAuditoria,
          clock,
          generarPdf,
        }),
    },
  ],
  exports: [
    GenerarPresupuestoUseCase,
    EditarPresupuestoUseCase,
    ReenviarPresupuestoUseCase,
  ],
})
export class PresupuestosModule {}
