/**
 * Adaptador Prisma GENÉRICO del puerto de auditoría compartido (`AuditLogPort`).
 *
 * Persiste cualquier `RegistroAuditoria` en la tabla `AUDIT_LOG` fijando el
 * contexto RLS (`SET LOCAL app.tenant_id`) dentro de la transacción de escritura.
 * Lo reutiliza la capability `auth` (eventos `login`/`logout`); reservas conserva
 * su adaptador especializado de liberación. Ambos implementan EL MISMO puerto.
 */
import { Injectable } from '@nestjs/common';
import { AccionAudit, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import type { AuditLogPort, RegistroAuditoria } from './audit-log.port';

@Injectable()
export class AuditLogPrismaAdapter implements AuditLogPort<RegistroAuditoria> {
  constructor(private readonly prisma: PrismaService) {}

  async registrar(registro: RegistroAuditoria): Promise<void> {
    const datosNuevos: Prisma.InputJsonValue | undefined =
      registro.datosNuevos as Prisma.InputJsonValue | undefined;
    const datosAnteriores: Prisma.InputJsonValue | undefined =
      registro.datosAnteriores as Prisma.InputJsonValue | undefined;

    await this.prisma.$transaction(async (tx) => {
      await this.prisma.fijarTenant(tx, registro.tenantId);
      await tx.auditLog.create({
        data: {
          tenantId: registro.tenantId,
          usuarioId: registro.usuarioId ?? null,
          entidad: registro.entidad ?? 'Sistema',
          entidadId: registro.entidadId ?? registro.usuarioId ?? '-',
          accion: registro.accion as AccionAudit,
          ...(datosNuevos !== undefined ? { datosNuevos } : {}),
          ...(datosAnteriores !== undefined ? { datosAnteriores } : {}),
        },
      });
    });
  }
}
