/**
 * Adaptador Prisma TX-BOUND del puerto `DocumentoRepositoryPort` (épico #6, US-023 / GAP 1 —
 * `condiciones-particulares-e3-us023`).
 *
 * Opera sobre el cliente transaccional (`Prisma.TransactionClient`) que la unidad de trabajo del
 * envío E3 abre bajo el contexto RLS (`SET LOCAL app.tenant_id`): la persistencia del DOCUMENTO
 * se consolida o revierte junto al resto de la tx (factura, COMUNICACION, AUDIT_LOG). La búsqueda
 * de idempotencia filtra por `reserva + tipo` (bajo RLS ya solo ve el tenant activo, además se
 * filtra por `tenant_id` explícitamente por defensa en profundidad). Nada de locks distribuidos.
 */
import { TipoDocumento as TipoDocumentoPrisma, type Prisma } from '@prisma/client';
import type {
  DocumentoPersistido,
  DocumentoRepositoryPort,
} from '../domain/documento.repository.port';

/** Mapea una fila DOCUMENTO de Prisma a la proyección de dominio `DocumentoPersistido`. */
const aDocumentoPersistido = (fila: {
  idDocumento: string;
  tenantId: string;
  reservaId: string | null;
  url: string;
  mimeType: string;
}): DocumentoPersistido => ({
  idDocumento: fila.idDocumento,
  tipo: 'condiciones_particulares',
  reservaId: fila.reservaId ?? '',
  tenantId: fila.tenantId,
  url: fila.url,
  mimeType: fila.mimeType,
});

/** Repositorio TX-BOUND de DOCUMENTO de condiciones (idempotente por reserva + tipo). */
export class DocumentoPrismaAdapter implements DocumentoRepositoryPort {
  constructor(private readonly tx: Prisma.TransactionClient) {}

  async buscarPorReservaYTipo(params: {
    reservaId: string;
    tenantId: string;
    tipo: 'condiciones_particulares';
  }): Promise<DocumentoPersistido | null> {
    const fila = await this.tx.documento.findFirst({
      where: {
        reservaId: params.reservaId,
        tenantId: params.tenantId,
        tipo: TipoDocumentoPrisma[params.tipo],
      },
      select: {
        idDocumento: true,
        tenantId: true,
        reservaId: true,
        url: true,
        mimeType: true,
      },
    });
    return fila === null ? null : aDocumentoPersistido(fila);
  }

  async crear(params: {
    reservaId: string;
    tenantId: string;
    tipo: 'condiciones_particulares';
    url: string;
    mimeType: string;
    nombreArchivo?: string;
    tamanoBytes?: number;
  }): Promise<DocumentoPersistido> {
    const fila = await this.tx.documento.create({
      data: {
        tenantId: params.tenantId,
        reservaId: params.reservaId,
        tipo: TipoDocumentoPrisma[params.tipo],
        nombreArchivo: params.nombreArchivo ?? 'condicions-particulars.pdf',
        url: params.url,
        mimeType: params.mimeType,
        ...(params.tamanoBytes !== undefined ? { tamanoBytes: params.tamanoBytes } : {}),
      },
      select: {
        idDocumento: true,
        tenantId: true,
        reservaId: true,
        url: true,
        mimeType: true,
      },
    });
    return aDocumentoPersistido(fila);
  }
}
