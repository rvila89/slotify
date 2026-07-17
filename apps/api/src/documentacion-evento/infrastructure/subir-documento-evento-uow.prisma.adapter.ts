/**
 * Adaptador de la UNIDAD DE TRABAJO transaccional de la subida de documentación del evento
 * (US-033 / UC-24).
 *
 * Implementa `UnidadDeTrabajoDocumentacionEventoPort`: abre UN único `prisma.$transaction`,
 * fija el contexto RLS con `fijarTenant(tx, tenantId)` (`SET LOCAL app.tenant_id`) como
 * PRIMERA operación, y expone los repositorios tx-bound. Las escrituras (crear DOCUMENTO +
 * AUDIT_LOG `crear`) y la lectura del checklist viven dentro de esa transacción: un fallo en
 * cualquiera propaga y revierte el conjunto (all-or-nothing).
 *
 * DOCUMENTO: REUTILIZA `DocumentoPrismaAdapter` (puerto generalizado en US-033) llamando SOLO
 * a `crear` (NO idempotente, §D-no-idempotencia) y `listarPorReservaYTipos` (checklist).
 * AUDIT_LOG: `accion='crear'`, `entidad='DOCUMENTO'` (NUNCA `transicion`, §D-no-transicion).
 */
import { Injectable } from '@nestjs/common';
import { AccionAudit, type Prisma } from '@prisma/client';
import { PrismaService } from '../../shared/prisma/prisma.service';
import { DocumentoPrismaAdapter } from '../../documentos/infrastructure/documento.prisma.adapter';
import type { DocumentoPersistido } from '../../documentos/domain/documento.repository.port';
import type {
  CrearDocumentoEventoParams,
  DocumentoEventoPersistido,
  RegistroAuditoriaDocumentacionEvento,
  RepositoriosDocumentacionEvento,
  TipoDocumentacionEvento,
  UnidadDeTrabajoDocumentacionEventoPort,
} from '../application/subir-documento-evento.use-case';

/** Proyecta una fila DOCUMENTO del puerto generalizado a la del evento (campos requeridos). */
const aDocumentoEventoPersistido = (
  fila: DocumentoPersistido,
): DocumentoEventoPersistido => ({
  idDocumento: fila.idDocumento,
  tipo: fila.tipo as TipoDocumentacionEvento,
  reservaId: fila.reservaId,
  tenantId: fila.tenantId,
  url: fila.url,
  mimeType: fila.mimeType,
  nombreArchivo: fila.nombreArchivo ?? '',
  tamanoBytes: fila.tamanoBytes ?? 0,
  fechaCreacion: fila.fechaCreacion ?? new Date(0),
});

/**
 * Repositorio tx-bound de DOCUMENTO del evento: envuelve `DocumentoPrismaAdapter` y expone
 * `crear` (no idempotente) + `listarPorReservaYTipos` con la forma del puerto de US-033.
 */
class DocumentoEventoPrismaRepository {
  private readonly documentos: DocumentoPrismaAdapter;

  constructor(tx: Prisma.TransactionClient) {
    this.documentos = new DocumentoPrismaAdapter(tx);
  }

  async crear(params: CrearDocumentoEventoParams): Promise<DocumentoEventoPersistido> {
    const doc = await this.documentos.crear({
      reservaId: params.reservaId,
      tenantId: params.tenantId,
      tipo: params.tipo,
      url: params.url,
      mimeType: params.mimeType,
      nombreArchivo: params.nombreArchivo,
      tamanoBytes: params.tamanoBytes,
    });
    return aDocumentoEventoPersistido(doc);
  }

  async listarPorReservaYTipos(params: {
    reservaId: string;
    tenantId: string;
    tipos: ReadonlyArray<TipoDocumentacionEvento>;
  }): Promise<DocumentoEventoPersistido[]> {
    const filas = await this.documentos.listarPorReservaYTipos(params);
    return filas.map(aDocumentoEventoPersistido);
  }
}

/** Repositorio de AUDIT_LOG tx-bound: `accion='crear'` (rollback con la tx). */
class AuditoriaDocumentacionEventoPrismaRepository {
  constructor(private readonly tx: Prisma.TransactionClient) {}

  async registrar(registro: RegistroAuditoriaDocumentacionEvento): Promise<void> {
    await this.tx.auditLog.create({
      data: {
        tenantId: registro.tenantId,
        usuarioId: registro.usuarioId ?? null,
        entidad: registro.entidad,
        entidadId: registro.entidadId,
        accion: AccionAudit.crear,
        datosNuevos: registro.datosNuevos as unknown as Prisma.InputJsonValue,
      },
    });
  }
}

@Injectable()
export class SubirDocumentoEventoUoWPrismaAdapter
  implements UnidadDeTrabajoDocumentacionEventoPort
{
  constructor(private readonly prisma: PrismaService) {}

  async ejecutar(
    tenantId: string,
    trabajo: (repos: RepositoriosDocumentacionEvento) => Promise<unknown>,
  ): Promise<unknown> {
    return this.prisma.$transaction(async (tx) => {
      // RLS: primera operación de la transacción (SET LOCAL app.tenant_id).
      await this.prisma.fijarTenant(tx, tenantId);
      const repos: RepositoriosDocumentacionEvento = {
        documentos: new DocumentoEventoPrismaRepository(tx),
        auditoria: new AuditoriaDocumentacionEventoPrismaRepository(tx),
      };
      return trabajo(repos);
    });
  }
}
