/**
 * Adaptador Prisma TX-BOUND del puerto `DocumentoRepositoryPort` (épico #6, US-023 / GAP 1 —
 * `condiciones-particulares-e3-us023`; GENERALIZADO en US-033 / GAP D-documento-repo).
 *
 * Opera sobre el cliente transaccional (`Prisma.TransactionClient`) que la unidad de trabajo abre
 * bajo el contexto RLS (`SET LOCAL app.tenant_id`): la persistencia del DOCUMENTO se consolida o
 * revierte junto al resto de la tx (US-023: factura, COMUNICACION, AUDIT_LOG; US-033: AUDIT_LOG
 * `crear`). La búsqueda/listado filtra por `reserva + tipo(s)` (bajo RLS ya solo ve el tenant
 * activo, además se filtra por `tenant_id` explícitamente por defensa en profundidad). Nada de
 * locks distribuidos.
 *
 * Generalización US-033: `tipo` es el UNION de dominio `TipoDocumentoDominio`; el adaptador lo
 * mapea al enum `TipoDocumento` de Prisma. `aDocumentoPersistido` devuelve el tipo REAL de la fila
 * (ya no hardcodea `'condiciones_particulares'`) e incluye `nombreArchivo`, `tamanoBytes` y
 * `fechaCreacion` (referencia del checklist). Se añade `listarPorReservaYTipos` para el checklist.
 */
import { TipoDocumento as TipoDocumentoPrisma, type Prisma } from '@prisma/client';
import type {
  DocumentoPersistido,
  DocumentoRepositoryPort,
  TipoDocumentoDominio,
} from '../domain/documento.repository.port';

/** Mapea una fila DOCUMENTO de Prisma a la proyección de dominio `DocumentoPersistido`. */
const aDocumentoPersistido = (fila: {
  idDocumento: string;
  tenantId: string;
  reservaId: string | null;
  tipo: TipoDocumentoPrisma;
  url: string;
  mimeType: string;
  nombreArchivo: string;
  tamanoBytes: number | null;
  fechaCreacion: Date;
}): DocumentoPersistido => ({
  idDocumento: fila.idDocumento,
  tipo: fila.tipo as TipoDocumentoDominio,
  reservaId: fila.reservaId ?? '',
  tenantId: fila.tenantId,
  url: fila.url,
  mimeType: fila.mimeType,
  nombreArchivo: fila.nombreArchivo,
  ...(fila.tamanoBytes !== null ? { tamanoBytes: fila.tamanoBytes } : {}),
  fechaCreacion: fila.fechaCreacion,
});

/** Selección común de columnas de la fila DOCUMENTO. */
const SELECT_DOCUMENTO = {
  idDocumento: true,
  tenantId: true,
  reservaId: true,
  tipo: true,
  url: true,
  mimeType: true,
  nombreArchivo: true,
  tamanoBytes: true,
  fechaCreacion: true,
} as const;

/** Repositorio TX-BOUND de DOCUMENTO (US-023 idempotente por reserva+tipo; US-033 no idempotente). */
export class DocumentoPrismaAdapter implements DocumentoRepositoryPort {
  constructor(private readonly tx: Prisma.TransactionClient) {}

  async buscarPorReservaYTipo(params: {
    reservaId: string;
    tenantId: string;
    tipo: TipoDocumentoDominio;
  }): Promise<DocumentoPersistido | null> {
    const fila = await this.tx.documento.findFirst({
      where: {
        reservaId: params.reservaId,
        tenantId: params.tenantId,
        tipo: TipoDocumentoPrisma[params.tipo],
      },
      select: SELECT_DOCUMENTO,
    });
    return fila === null ? null : aDocumentoPersistido(fila);
  }

  async crear(params: {
    reservaId: string;
    tenantId: string;
    tipo: TipoDocumentoDominio;
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
        nombreArchivo: params.nombreArchivo ?? 'documento',
        url: params.url,
        mimeType: params.mimeType,
        ...(params.tamanoBytes !== undefined ? { tamanoBytes: params.tamanoBytes } : {}),
      },
      select: SELECT_DOCUMENTO,
    });
    return aDocumentoPersistido(fila);
  }

  async listarPorReservaYTipos(params: {
    reservaId: string;
    tenantId: string;
    tipos: ReadonlyArray<TipoDocumentoDominio>;
  }): Promise<DocumentoPersistido[]> {
    const filas = await this.tx.documento.findMany({
      where: {
        reservaId: params.reservaId,
        tenantId: params.tenantId,
        tipo: { in: params.tipos.map((t) => TipoDocumentoPrisma[t]) },
      },
      select: SELECT_DOCUMENTO,
      orderBy: { fechaCreacion: 'desc' },
    });
    return filas.map(aDocumentoPersistido);
  }
}
