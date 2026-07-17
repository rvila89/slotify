/**
 * Adaptador Prisma del puerto `ListarDocumentosEventoPort` (US-033, checklist GET).
 *
 * Lista los DOCUMENTOs del evento de una reserva bajo el contexto RLS del tenant. Se usa FUERA
 * de la transacción crítica (la query de checklist es de solo lectura). REUTILIZA
 * `DocumentoPrismaAdapter.listarPorReservaYTipos` (puerto generalizado en US-033) dentro de una
 * transacción propia que fija el tenant (`SET LOCAL app.tenant_id`). Hexagonal: solo
 * `@Injectable` como acople de framework.
 */
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../shared/prisma/prisma.service';
import { DocumentoPrismaAdapter } from '../../documentos/infrastructure/documento.prisma.adapter';
import type {
  DocumentoEventoPersistido,
  ListarDocumentosEventoPort,
  TipoDocumentacionEvento,
} from '../application/obtener-checklist-documentacion-evento.query';

@Injectable()
export class ListarDocumentosEventoPrismaAdapter {
  constructor(private readonly prisma: PrismaService) {}

  readonly listar: ListarDocumentosEventoPort = async (params) => {
    const filas = await this.prisma.$transaction(async (tx) => {
      await this.prisma.fijarTenant(tx, params.tenantId);
      const documentos = new DocumentoPrismaAdapter(tx);
      return documentos.listarPorReservaYTipos({
        reservaId: params.reservaId,
        tenantId: params.tenantId,
        tipos: params.tipos,
      });
    });
    return filas.map(
      (fila): DocumentoEventoPersistido => ({
        idDocumento: fila.idDocumento,
        tipo: fila.tipo as TipoDocumentacionEvento,
        reservaId: fila.reservaId,
        tenantId: fila.tenantId,
        url: fila.url,
        mimeType: fila.mimeType,
        nombreArchivo: fila.nombreArchivo ?? '',
        tamanoBytes: fila.tamanoBytes ?? 0,
        fechaCreacion: fila.fechaCreacion ?? new Date(0),
      }),
    );
  };
}
