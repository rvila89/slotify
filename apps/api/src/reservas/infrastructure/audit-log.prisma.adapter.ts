/**
 * Adaptador Prisma del puerto `AuditLogPort` (US-041 / UC-31, §D-8).
 *
 * Persiste en `AUDIT_LOG` toda tentativa de liberación con su causa y resultado.
 * El modelo `AuditLog` no tiene columnas `causa`/`resultado` dedicadas: se guardan
 * en `datos_nuevos` (JSON), junto con la fecha y la reserva afectada, manteniendo
 * `accion`/`entidad`/`entidad_id` en sus columnas tipadas. Fija el contexto RLS
 * dentro de la transacción de escritura.
 */
import { Injectable } from '@nestjs/common';
import { AccionAudit, Prisma } from '@prisma/client';
import { PrismaService } from '../../shared/prisma/prisma.service';
import {
  AuditLogPort,
  RegistroAuditoriaLiberacion,
} from '../domain/liberar-fecha.service';

@Injectable()
export class AuditLogPrismaAdapter implements AuditLogPort<RegistroAuditoriaLiberacion> {
  constructor(private readonly prisma: PrismaService) {}

  async registrar(registro: RegistroAuditoriaLiberacion): Promise<void> {
    const datosNuevos: Prisma.InputJsonValue = {
      causa: registro.causa,
      resultado: registro.resultado,
      fecha: registro.fecha.toISOString().slice(0, 10),
      reservaId: registro.reservaId,
    };
    await this.prisma.$transaction(async (tx) => {
      await this.prisma.fijarTenant(tx, registro.tenantId);
      await tx.auditLog.create({
        data: {
          tenantId: registro.tenantId,
          entidad: registro.entidad,
          entidadId: registro.entidadId,
          accion: AccionAudit.eliminar,
          datosNuevos,
        },
      });
    });
  }
}
