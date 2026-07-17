/**
 * Módulo `documentacion-evento` (US-033, hexagonal) — capability `documentacion-evento`.
 *
 * Compone el caso de uso `SubirDocumentoEventoUseCase` y la query
 * `ObtenerChecklistDocumentacionEventoQuery` enlazando sus puertos a los adaptadores de
 * infraestructura por token (Symbol):
 *   - Unidad de trabajo transaccional de la subida (UoW Prisma con RLS `SET LOCAL`).
 *   - Lectura de RESERVA bajo RLS (guarda de estado / 404 cross-tenant).
 *   - Almacenamiento durable del binario (`ALMACEN_DOCUMENTOS_PORT` del épico #6, clave
 *     versionada por reserva+tipo).
 *   - Listado de DOCUMENTOs del evento para el checklist (RLS).
 *
 * El fichero se recibe por `multipart/form-data` con almacenamiento EN MEMORIA
 * (`MulterModule` por defecto, sin `dest`) para exponer el `buffer` al caso de uso. El
 * dominio/aplicación dependen solo de interfaces; los adaptadores viven en infraestructura.
 * Mismo patrón que `ConfirmacionModule`.
 */
import { Module } from '@nestjs/common';
import { MulterModule } from '@nestjs/platform-express';
import { PrismaModule } from '../shared/prisma/prisma.module';
import { PrismaService } from '../shared/prisma/prisma.service';
import { DocumentosModule } from '../documentos/documentos.module';
import { ALMACEN_DOCUMENTOS_PORT } from '../documentos/documentos.tokens';
import type { AlmacenDocumentosPort } from '../documentos/domain/almacen-documentos.port';
import {
  SubirDocumentoEventoUseCase,
  type AlmacenarDocumentoEventoPort,
  type CargarReservaDocumentacionEventoPort,
  type UnidadDeTrabajoDocumentacionEventoPort,
} from './application/subir-documento-evento.use-case';
import {
  ObtenerChecklistDocumentacionEventoQuery,
  type CargarReservaChecklistPort,
  type ListarDocumentosEventoPort,
} from './application/obtener-checklist-documentacion-evento.query';
import { SubirDocumentoEventoUoWPrismaAdapter } from './infrastructure/subir-documento-evento-uow.prisma.adapter';
import { CargarReservaDocumentacionEventoPrismaAdapter } from './infrastructure/cargar-reserva-documentacion-evento.prisma.adapter';
import { AlmacenarDocumentoEventoAdapter } from './infrastructure/almacenar-documento-evento.adapter';
import { ListarDocumentosEventoPrismaAdapter } from './infrastructure/listar-documentos-evento.prisma.adapter';
import { DocumentosEventoController } from './interface/documentos-evento.controller';
import {
  ALMACENAR_DOCUMENTO_EVENTO_PORT,
  CARGAR_RESERVA_DOCUMENTACION_EVENTO_PORT,
  LISTAR_DOCUMENTOS_EVENTO_PORT,
  UNIDAD_DE_TRABAJO_DOCUMENTACION_EVENTO_PORT,
} from './documentacion-evento.tokens';

@Module({
  imports: [
    PrismaModule,
    // US-033: expone `ALMACEN_DOCUMENTOS_PORT` (almacén de objetos durable, épico #6) para
    // subir el binario con clave versionada por reserva+tipo.
    DocumentosModule,
    // Sin `dest`/`storage`: multer usa MemoryStorage por defecto y expone `file.buffer`
    // (autoritativo para validar formato/tamaño y almacenar el binario en el use-case).
    MulterModule.register({}),
  ],
  controllers: [DocumentosEventoController],
  providers: [
    {
      provide: UNIDAD_DE_TRABAJO_DOCUMENTACION_EVENTO_PORT,
      inject: [PrismaService],
      useFactory: (prisma: PrismaService) =>
        new SubirDocumentoEventoUoWPrismaAdapter(prisma),
    },
    {
      provide: CARGAR_RESERVA_DOCUMENTACION_EVENTO_PORT,
      inject: [PrismaService],
      useFactory: (prisma: PrismaService): CargarReservaDocumentacionEventoPort =>
        new CargarReservaDocumentacionEventoPrismaAdapter(prisma).cargar,
    },
    {
      provide: ALMACENAR_DOCUMENTO_EVENTO_PORT,
      inject: [ALMACEN_DOCUMENTOS_PORT],
      useFactory: (almacen: AlmacenDocumentosPort): AlmacenarDocumentoEventoPort =>
        new AlmacenarDocumentoEventoAdapter(almacen).almacenar,
    },
    {
      provide: LISTAR_DOCUMENTOS_EVENTO_PORT,
      inject: [PrismaService],
      useFactory: (prisma: PrismaService): ListarDocumentosEventoPort =>
        new ListarDocumentosEventoPrismaAdapter(prisma).listar,
    },
    {
      provide: SubirDocumentoEventoUseCase,
      inject: [
        UNIDAD_DE_TRABAJO_DOCUMENTACION_EVENTO_PORT,
        CARGAR_RESERVA_DOCUMENTACION_EVENTO_PORT,
        ALMACENAR_DOCUMENTO_EVENTO_PORT,
      ],
      useFactory: (
        unidadDeTrabajo: UnidadDeTrabajoDocumentacionEventoPort,
        cargarReserva: CargarReservaDocumentacionEventoPort,
        almacenarDocumento: AlmacenarDocumentoEventoPort,
      ) =>
        new SubirDocumentoEventoUseCase({
          unidadDeTrabajo,
          cargarReserva,
          almacenarDocumento,
        }),
    },
    {
      provide: ObtenerChecklistDocumentacionEventoQuery,
      inject: [
        CARGAR_RESERVA_DOCUMENTACION_EVENTO_PORT,
        LISTAR_DOCUMENTOS_EVENTO_PORT,
      ],
      useFactory: (
        cargarReserva: CargarReservaChecklistPort,
        listarDocumentosEvento: ListarDocumentosEventoPort,
      ) =>
        new ObtenerChecklistDocumentacionEventoQuery({
          cargarReserva,
          listarDocumentosEvento,
        }),
    },
  ],
  exports: [SubirDocumentoEventoUseCase, ObtenerChecklistDocumentacionEventoQuery],
})
export class DocumentacionEventoModule {}
