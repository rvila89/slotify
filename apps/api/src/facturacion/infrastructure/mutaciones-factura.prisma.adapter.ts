/**
 * Adaptadores Prisma de MUTACIÓN puntual de la FACTURA (US-022 / UC-18): aprobación
 * (transición `borrador → enviada` + `fecha_emision`) y auditoría de aprobación/rechazo.
 *
 * Cada operación abre su propio `$transaction` + `fijarTenant` (RLS). La aprobación fija
 * `estado='enviada'` y `fecha_emision`; el rechazo NO muta el estado (solo audita). El
 * AUDIT_LOG usa `accion='actualizar'` (tabla enum `AccionAudit`).
 */
import { Injectable } from '@nestjs/common';
import { AccionAudit, EstadoFactura, Prisma } from '@prisma/client';
import { PrismaService } from '../../shared/prisma/prisma.service';
import type {
  AprobarFacturaParams,
  RegistroAuditoriaAprobacion,
} from '../application/aprobar-factura.use-case';
import type { RegistroAuditoriaRechazo } from '../application/rechazar-factura.use-case';

@Injectable()
export class AprobarFacturaPrismaAdapter {
  constructor(private readonly prisma: PrismaService) {}

  readonly aprobar = async (params: AprobarFacturaParams): Promise<void> => {
    await this.prisma.$transaction(async (tx) => {
      await tx.factura.update({
        where: { idFactura: params.facturaId },
        data: { estado: EstadoFactura.enviada, fechaEmision: params.fechaEmision },
      });
    });
  };
}

@Injectable()
export class AuditoriaAprobacionPrismaAdapter {
  constructor(private readonly prisma: PrismaService) {}

  readonly registrar = async (
    registro: RegistroAuditoriaAprobacion | RegistroAuditoriaRechazo,
  ): Promise<void> => {
    const motivo = 'motivo' in registro ? registro.motivo : undefined;
    await this.prisma.$transaction(async (tx) => {
      await this.prisma.fijarTenant(tx, registro.tenantId);
      await tx.auditLog.create({
        data: {
          tenantId: registro.tenantId,
          usuarioId: registro.usuarioId ?? null,
          entidad: registro.entidad,
          entidadId: registro.entidadId,
          accion: AccionAudit.actualizar,
          datosAnteriores: registro.datosAnteriores as Prisma.InputJsonValue,
          datosNuevos: (motivo
            ? { ...registro.datosNuevos, motivo }
            : registro.datosNuevos) as Prisma.InputJsonValue,
        },
      });
    });
  };
}
