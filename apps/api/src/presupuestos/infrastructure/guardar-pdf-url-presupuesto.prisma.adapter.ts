/**
 * Adaptador Prisma del puerto `GuardarPdfUrlPresupuestoPort` (US-014/US-015): persiste
 * la `pdf_url` en la fila del PRESUPUESTO tras generar el PDF post-commit, para que el
 * REENVÍO sin cambios (que lee `vigente.pdf_url`) disponga del adjunto. Espejo de
 * `FacturaPrismaRepository.guardarPdfUrl` (US-022).
 *
 * Best-effort: el use-case invoca este puerto FUERA de la tx crítica y traga cualquier
 * fallo (no revierte la pre_reserva/versión). Aquí solo se garantiza el aislamiento por
 * tenant (`fijarTenant` → RLS) y el filtro por `tenant_id` en el UPDATE.
 */
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../shared/prisma/prisma.service';
import type { GuardarPdfUrlPresupuestoPort } from '../application/generar-presupuesto.use-case';

@Injectable()
export class GuardarPdfUrlPresupuestoPrismaAdapter {
  constructor(private readonly prisma: PrismaService) {}

  readonly guardar: GuardarPdfUrlPresupuestoPort = async (params: {
    tenantId: string;
    idPresupuesto: string;
    pdfUrl: string;
  }): Promise<void> => {
    await this.prisma.$transaction(async (tx) => {
      // RLS: primera operación de la tx (SET LOCAL app.tenant_id).
      await this.prisma.fijarTenant(tx, params.tenantId);
      await tx.presupuesto.updateMany({
        where: { idPresupuesto: params.idPresupuesto, tenantId: params.tenantId },
        data: { pdfUrl: params.pdfUrl },
      });
    });
  };
}
