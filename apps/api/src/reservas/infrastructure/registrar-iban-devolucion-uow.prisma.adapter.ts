/**
 * Adaptador de la UNIDAD DE TRABAJO de la escritura del IBAN de devolución
 * (US-035 / UC-26 FA-01, UC-27, §D-1/§D-2). Implementa `UnidadDeTrabajoIbanDevolucionPort`.
 *
 * Abre UN único `prisma.$transaction` bajo el contexto RLS del `tenantId` del Gestor
 * (`fijarTenant(tx, tenantId)` = `SET LOCAL app.tenant_id` como PRIMERA operación) y expone
 * los repositorios tx-bound. El `UPDATE CLIENTE.iban_devolucion` + el AUDIT_LOG
 * (`accion='actualizar'`, `entidad='CLIENTE'`) viven DENTRO de esa transacción
 * (all-or-nothing). NO toca FECHA_BLOQUEADA, la cola ni el bloqueo atómico (no aplica).
 */
import { Injectable } from '@nestjs/common';
import { AccionAudit, Prisma } from '@prisma/client';
import { PrismaService } from '../../shared/prisma/prisma.service';
import type { RegistroAuditoria } from '../../shared/audit/audit-log.port';
import type {
  ActualizarIbanDevolucionParams,
  ActualizarIbanDevolucionResultado,
  RepositoriosIbanDevolucion,
  UnidadDeTrabajoIbanDevolucionPort,
} from '../application/registrar-iban-devolucion.use-case';

/**
 * Repositorio de CLIENTE tx-bound: `UPDATE cliente SET iban_devolucion=? WHERE id=? AND
 * tenant=?` bajo RLS. Devuelve las filas afectadas (`1` == se aplicó; `0` == cliente no
 * visible bajo RLS o inexistente).
 */
class ClienteIbanDevolucionPrismaRepository {
  constructor(private readonly tx: Prisma.TransactionClient) {}

  async actualizarIbanDevolucion(
    params: ActualizarIbanDevolucionParams,
  ): Promise<ActualizarIbanDevolucionResultado> {
    const { count } = await this.tx.cliente.updateMany({
      where: { idCliente: params.clienteId, tenantId: params.tenantId },
      data: { ibanDevolucion: params.ibanDevolucion },
    });
    return { filasAfectadas: count };
  }
}

/**
 * Repositorio de AUDIT_LOG tx-bound: escribe DENTRO de la transacción (comparte el destino
 * del rollback). El cambio de IBAN se registra con `usuario_id` poblado (origen Usuario) y
 * `entidad='CLIENTE'` (D-1: el campo mutado pertenece al cliente).
 */
class AuditLogIbanDevolucionPrismaRepository {
  constructor(private readonly tx: Prisma.TransactionClient) {}

  async registrar(registro: RegistroAuditoria): Promise<void> {
    const datosAnteriores = registro.datosAnteriores as
      | Prisma.InputJsonValue
      | undefined;
    const datosNuevos = registro.datosNuevos as Prisma.InputJsonValue | undefined;
    await this.tx.auditLog.create({
      data: {
        tenantId: registro.tenantId,
        usuarioId: registro.usuarioId ?? null,
        entidad: registro.entidad ?? 'CLIENTE',
        entidadId: registro.entidadId ?? '-',
        accion: registro.accion as AccionAudit,
        ...(datosAnteriores !== undefined ? { datosAnteriores } : {}),
        ...(datosNuevos !== undefined ? { datosNuevos } : {}),
      },
    });
  }
}

@Injectable()
export class RegistrarIbanDevolucionUoWPrismaAdapter
  implements UnidadDeTrabajoIbanDevolucionPort
{
  constructor(private readonly prisma: PrismaService) {}

  async ejecutar(
    tenantId: string,
    trabajo: (repos: RepositoriosIbanDevolucion) => Promise<unknown>,
  ): Promise<unknown> {
    return this.prisma.$transaction(async (tx) => {
      // RLS: primera operación de la transacción (SET LOCAL app.tenant_id).
      await this.prisma.fijarTenant(tx, tenantId);
      const repos: RepositoriosIbanDevolucion = {
        clientes: new ClienteIbanDevolucionPrismaRepository(tx),
        auditoria: new AuditLogIbanDevolucionPrismaRepository(tx),
      };
      return trabajo(repos);
    });
  }
}
