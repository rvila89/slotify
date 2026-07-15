/**
 * Adaptador de la UNIDAD DE TRABAJO transaccional del registro de la firma de las
 * condiciones particulares (US-024 / UC-19 segundo flujo).
 *
 * Implementa `UnidadDeTrabajoFirmaCondicionesPort`: abre UN único `prisma.$transaction`,
 * fija el contexto RLS con `fijarTenant(tx, tenantId)` (`SET LOCAL app.tenant_id`) como
 * PRIMERA operación, y expone los repositorios tx-bound. Las TRES escrituras (crear
 * DOCUMENTO firmado + marcar RESERVA `cond_part_firmadas` + AUDIT_LOG `actualizar`)
 * viven dentro de esa única transacción: un fallo en cualquiera propaga y revierte el
 * conjunto (all-or-nothing).
 *
 * DOCUMENTO: REUTILIZA `DocumentoPrismaAdapter` (US-023) llamando SOLO a `crear` (NO
 * idempotente, §D-documento-repo): siempre crea una fila NUEVA; el DOCUMENTO original no
 * firmado permanece. AUDIT_LOG: `accion='actualizar'` (NUNCA `transicion`, §D-no-transicion).
 */
import { Injectable } from '@nestjs/common';
import { AccionAudit, type Prisma } from '@prisma/client';
import { PrismaService } from '../../shared/prisma/prisma.service';
import { DocumentoPrismaAdapter } from '../../documentos/infrastructure/documento.prisma.adapter';
import type {
  CrearDocumentoFirmadoParams,
  DocumentoFirmadoCreado,
  MarcarFirmaCondicionesParams,
  RegistroAuditoriaFirmaCondiciones,
  RepositoriosFirmaCondiciones,
  UnidadDeTrabajoFirmaCondicionesPort,
} from '../application/registrar-firma-condiciones.use-case';

/**
 * Repositorio tx-bound de DOCUMENTO firmado: envuelve el `DocumentoPrismaAdapter` de
 * US-023 y expone SOLO `crear` (no idempotente) con la forma del puerto de US-024.
 */
class DocumentoFirmadoPrismaRepository {
  private readonly documentos: DocumentoPrismaAdapter;

  constructor(tx: Prisma.TransactionClient) {
    this.documentos = new DocumentoPrismaAdapter(tx);
  }

  async crear(params: CrearDocumentoFirmadoParams): Promise<DocumentoFirmadoCreado> {
    const doc = await this.documentos.crear({
      reservaId: params.reservaId,
      tenantId: params.tenantId,
      tipo: 'condiciones_particulares',
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

/**
 * Repositorio tx-bound de la RESERVA: marca la firma (`cond_part_firmadas=true` +
 * `cond_part_firmadas_fecha`). NO toca `estado` ni los sub-procesos (§D-no-transicion).
 */
class ReservaFirmaCondicionesPrismaRepository {
  constructor(private readonly tx: Prisma.TransactionClient) {}

  async marcarFirmada(params: MarcarFirmaCondicionesParams): Promise<void> {
    await this.tx.reserva.update({
      where: { idReserva: params.idReserva },
      data: {
        condPartFirmadas: params.condPartFirmadas,
        condPartFirmadasFecha: params.condPartFirmadasFecha,
      },
    });
  }
}

/** Repositorio de AUDIT_LOG tx-bound: `accion='actualizar'` (rollback con la tx). */
class AuditoriaFirmaCondicionesPrismaRepository {
  constructor(private readonly tx: Prisma.TransactionClient) {}

  async registrar(registro: RegistroAuditoriaFirmaCondiciones): Promise<void> {
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
export class RegistrarFirmaCondicionesUoWPrismaAdapter
  implements UnidadDeTrabajoFirmaCondicionesPort
{
  constructor(private readonly prisma: PrismaService) {}

  async ejecutar(
    tenantId: string,
    trabajo: (repos: RepositoriosFirmaCondiciones) => Promise<unknown>,
  ): Promise<unknown> {
    return this.prisma.$transaction(async (tx) => {
      // RLS: primera operación de la transacción (SET LOCAL app.tenant_id).
      await this.prisma.fijarTenant(tx, tenantId);
      const repos: RepositoriosFirmaCondiciones = {
        documentos: new DocumentoFirmadoPrismaRepository(tx),
        reservas: new ReservaFirmaCondicionesPrismaRepository(tx),
        auditoria: new AuditoriaFirmaCondicionesPrismaRepository(tx),
      };
      return trabajo(repos);
    });
  }
}
