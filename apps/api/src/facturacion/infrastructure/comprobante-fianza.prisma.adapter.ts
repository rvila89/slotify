/**
 * Adaptadores de la subida del COMPROBANTE de la fianza (fix-liquidacion-fianza-independientes /
 * UC-22), espejo de los adaptadores de `registrar-firma-condiciones` (US-024).
 *
 * - `ComprobanteFianzaUoWPrismaAdapter`: abre UN `prisma.$transaction`, fija RLS con
 *   `fijarTenant` (SET LOCAL app.tenant_id) como PRIMERA operación y expone los repos tx-bound.
 *   Las tres escrituras (crear DOCUMENTO `comprobante_fianza` + marcar RESERVA + AUDIT_LOG) viven
 *   en una única transacción (all-or-nothing).
 * - `CargarReservaComprobanteFianzaAdapter`: carga la RESERVA (estado + fianza_status) bajo RLS.
 * - `AlmacenarComprobanteFianzaAdapter`: sube el fichero al almacén de objetos con clave versionada.
 */
import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { AccionAudit, FianzaStatus as FianzaStatusPrisma, type Prisma } from '@prisma/client';
import { PrismaService } from '../../shared/prisma/prisma.service';
import { DocumentoPrismaAdapter } from '../../documentos/infrastructure/documento.prisma.adapter';
import type { AlmacenDocumentosPort } from '../../documentos/domain/almacen-documentos.port';
import type {
  AlmacenarComprobanteFianzaPort,
  CargarReservaComprobanteFianzaPort,
  ComprobanteFianzaSubido,
  CrearDocumentoComprobanteParams,
  DocumentoComprobanteCreado,
  MarcarComprobanteFianzaParams,
  RegistroAuditoriaComprobanteFianza,
  RepositoriosComprobanteFianza,
  ReservaComprobanteFianza,
  UnidadDeTrabajoComprobanteFianzaPort,
} from '../application/subir-comprobante-fianza.use-case';

/** Extensión de fichero inferida del mime (para la clave/URL legible). */
const extensionDeMime = (mimeType: string): string => {
  switch (mimeType) {
    case 'image/jpeg':
      return 'jpg';
    case 'image/png':
      return 'png';
    case 'application/pdf':
      return 'pdf';
    default:
      return 'bin';
  }
};

/** Repositorio tx-bound de DOCUMENTO comprobante: envuelve el `DocumentoPrismaAdapter` (crear). */
class DocumentoComprobantePrismaRepository {
  private readonly documentos: DocumentoPrismaAdapter;

  constructor(tx: Prisma.TransactionClient) {
    this.documentos = new DocumentoPrismaAdapter(tx);
  }

  async crear(params: CrearDocumentoComprobanteParams): Promise<DocumentoComprobanteCreado> {
    const doc = await this.documentos.crear({
      reservaId: params.reservaId,
      tenantId: params.tenantId,
      tipo: 'comprobante_fianza',
      url: params.url,
      mimeType: params.mimeType,
      nombreArchivo: params.nombreArchivo,
      ...(params.tamanoBytes !== undefined ? { tamanoBytes: params.tamanoBytes } : {}),
    });
    return {
      idDocumento: doc.idDocumento,
      tipo: doc.tipo,
      reservaId: doc.reservaId,
      tenantId: doc.tenantId,
      url: doc.url,
      mimeType: doc.mimeType,
    };
  }
}

/** Repositorio tx-bound de la RESERVA: marca la fianza como cobrada (comprobante recibido). */
class ReservaComprobantePrismaRepository {
  constructor(private readonly tx: Prisma.TransactionClient) {}

  async marcarComprobante(params: MarcarComprobanteFianzaParams): Promise<void> {
    await this.tx.reserva.update({
      where: { idReserva: params.idReserva },
      data: {
        fianzaStatus: FianzaStatusPrisma.cobrada,
        fianzaCobradaFecha: params.fianzaCobradaFecha,
        fianzaComprobanteFecha: params.fianzaComprobanteFecha,
      },
    });
  }
}

/** Repositorio de AUDIT_LOG tx-bound: `accion='actualizar'` (rollback con la tx). */
class AuditoriaComprobantePrismaRepository {
  constructor(private readonly tx: Prisma.TransactionClient) {}

  async registrar(registro: RegistroAuditoriaComprobanteFianza): Promise<void> {
    await this.tx.auditLog.create({
      data: {
        tenantId: registro.tenantId,
        usuarioId: registro.usuarioId ?? null,
        entidad: registro.entidad,
        entidadId: registro.entidadId,
        accion: AccionAudit.actualizar,
        datosAnteriores: registro.datosAnteriores as unknown as Prisma.InputJsonValue,
        datosNuevos: registro.datosNuevos as unknown as Prisma.InputJsonValue,
      },
    });
  }
}

@Injectable()
export class ComprobanteFianzaUoWPrismaAdapter
  implements UnidadDeTrabajoComprobanteFianzaPort
{
  constructor(private readonly prisma: PrismaService) {}

  async ejecutar(
    tenantId: string,
    trabajo: (repos: RepositoriosComprobanteFianza) => Promise<unknown>,
  ): Promise<unknown> {
    return this.prisma.$transaction(async (tx) => {
      await this.prisma.fijarTenant(tx, tenantId);
      const repos: RepositoriosComprobanteFianza = {
        documentos: new DocumentoComprobantePrismaRepository(tx),
        reservas: new ReservaComprobantePrismaRepository(tx),
        auditoria: new AuditoriaComprobantePrismaRepository(tx),
      };
      return trabajo(repos);
    });
  }
}

@Injectable()
export class CargarReservaComprobanteFianzaAdapter {
  constructor(private readonly prisma: PrismaService) {}

  readonly cargar: CargarReservaComprobanteFianzaPort = async (params) => {
    const fila = await this.prisma.$transaction(async (tx) => {
      await this.prisma.fijarTenant(tx, params.tenantId);
      return tx.reserva.findFirst({
        where: { idReserva: params.reservaId, tenantId: params.tenantId },
        select: { idReserva: true, tenantId: true, estado: true, fianzaStatus: true },
      });
    });
    if (fila === null) {
      return null;
    }
    const reserva: ReservaComprobanteFianza = {
      idReserva: fila.idReserva,
      tenantId: fila.tenantId,
      estado: fila.estado,
      fianzaStatus: fila.fianzaStatus,
    };
    return reserva;
  };
}

@Injectable()
export class AlmacenarComprobanteFianzaAdapter {
  constructor(private readonly almacen: AlmacenDocumentosPort) {}

  readonly almacenar: AlmacenarComprobanteFianzaPort = async (params: {
    tenantId: string;
    reservaId: string;
    comprobante: ComprobanteFianzaSubido;
  }) => {
    const extension = extensionDeMime(params.comprobante.mimeType);
    const clave = `comprobante-fianza/${params.tenantId}/${params.reservaId}/${randomUUID()}.${extension}`;
    return this.almacen.subir(new Uint8Array(params.comprobante.buffer), clave);
  };
}
