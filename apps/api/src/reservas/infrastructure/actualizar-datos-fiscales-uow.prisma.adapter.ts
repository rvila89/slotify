/**
 * Adaptador de la UNIDAD DE TRABAJO de la escritura de datos fiscales del CLIENTE
 * (US-014 #5, Parte B / UC-14, §D-2/§D-3/§D-4). Implementa `UnidadDeTrabajoDatosFiscalesPort`.
 *
 * Abre UN único `prisma.$transaction` bajo el contexto RLS del `tenantId` del Gestor
 * (`fijarTenant(tx, tenantId)` = `SET LOCAL app.tenant_id` como PRIMERA operación) y expone los
 * repositorios tx-bound. El UPDATE PARCIAL de los campos fiscales del CLIENTE + el AUDIT_LOG
 * (`accion='actualizar'`, `entidad='CLIENTE'`) viven DENTRO de esa transacción (all-or-nothing).
 * Alcance estricto (D-3): NO toca RESERVA, FECHA_BLOQUEADA ni el bloqueo atómico.
 */
import { Injectable } from '@nestjs/common';
import { AccionAudit, Prisma } from '@prisma/client';
import { PrismaService } from '../../shared/prisma/prisma.service';
import type {
  ActualizarDatosFiscalesParams,
  ActualizarDatosFiscalesResultado,
  RegistroAuditoriaDatosFiscales,
  RepositoriosDatosFiscales,
  UnidadDeTrabajoDatosFiscalesPort,
} from '../application/actualizar-datos-fiscales-cliente.use-case';

/**
 * Repositorio de CLIENTE tx-bound: `UPDATE cliente SET <columnas fiscales presentes>=? WHERE id=?
 * AND tenant=?` bajo RLS. Solo las columnas PRESENTES en `params.datos` viajan al `data` (PATCH
 * parcial, D-2): los campos ausentes NO se tocan. Devuelve las filas afectadas (`1` == se aplicó;
 * `0` == cliente no visible bajo RLS o inexistente).
 */
class ClienteDatosFiscalesPrismaRepository {
  constructor(private readonly tx: Prisma.TransactionClient) {}

  async actualizarDatosFiscales(
    params: ActualizarDatosFiscalesParams,
  ): Promise<ActualizarDatosFiscalesResultado> {
    // Solo las columnas presentes (PATCH parcial): un campo ausente no aparece en `data`.
    const data: Prisma.ClienteUpdateManyMutationInput = {};
    if (params.datos.dniNif !== undefined) data.dniNif = params.datos.dniNif;
    if (params.datos.direccion !== undefined) data.direccion = params.datos.direccion;
    if (params.datos.codigoPostal !== undefined) {
      data.codigoPostal = params.datos.codigoPostal;
    }
    if (params.datos.poblacion !== undefined) data.poblacion = params.datos.poblacion;
    if (params.datos.provincia !== undefined) data.provincia = params.datos.provincia;

    const { count } = await this.tx.cliente.updateMany({
      where: { idCliente: params.clienteId, tenantId: params.tenantId },
      data,
    });
    return { filasAfectadas: count };
  }
}

/**
 * Repositorio de AUDIT_LOG tx-bound: escribe DENTRO de la transacción (comparte el destino del
 * rollback). El cambio se registra con `usuario_id` poblado (origen Usuario) y `entidad='CLIENTE'`
 * (D-1: los campos mutados pertenecen al cliente).
 */
class AuditLogDatosFiscalesPrismaRepository {
  constructor(private readonly tx: Prisma.TransactionClient) {}

  async registrar(registro: RegistroAuditoriaDatosFiscales): Promise<void> {
    const datosAnteriores = registro.datosAnteriores as
      | Prisma.InputJsonValue
      | undefined;
    const datosNuevos = registro.datosNuevos as Prisma.InputJsonValue | undefined;
    await this.tx.auditLog.create({
      data: {
        tenantId: registro.tenantId,
        usuarioId: registro.usuarioId ?? null,
        entidad: registro.entidad,
        entidadId: registro.entidadId,
        accion: registro.accion as AccionAudit,
        ...(datosAnteriores !== undefined ? { datosAnteriores } : {}),
        ...(datosNuevos !== undefined ? { datosNuevos } : {}),
      },
    });
  }
}

@Injectable()
export class ActualizarDatosFiscalesUoWPrismaAdapter
  implements UnidadDeTrabajoDatosFiscalesPort
{
  constructor(private readonly prisma: PrismaService) {}

  async ejecutar(
    tenantId: string,
    trabajo: (repos: RepositoriosDatosFiscales) => Promise<unknown>,
  ): Promise<unknown> {
    return this.prisma.$transaction(async (tx) => {
      // RLS: primera operación de la transacción (SET LOCAL app.tenant_id).
      await this.prisma.fijarTenant(tx, tenantId);
      const repos: RepositoriosDatosFiscales = {
        clientes: new ClienteDatosFiscalesPrismaRepository(tx),
        auditoria: new AuditLogDatosFiscalesPrismaRepository(tx),
      };
      return trabajo(repos);
    });
  }
}
