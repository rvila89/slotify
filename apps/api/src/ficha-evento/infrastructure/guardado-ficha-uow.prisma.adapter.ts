/**
 * Adaptador de la UNIDAD DE TRABAJO transaccional del GUARDADO parcial de la ficha
 * operativa (US-025 / UC-20, §D-2/§D-4).
 *
 * Implementa `UnidadDeTrabajoFichaPort<RepositoriosGuardadoFicha>`: abre UN único
 * `prisma.$transaction`, fija el contexto RLS con `fijarTenant(tx, tenantId)`
 * (`SET LOCAL app.tenant_id`) como PRIMERA operación, y expone los repositorios
 * LIGADOS a esa transacción (ficha + auditoría). Si el `trabajo` rechaza, la
 * transacción revierte por completo (all-or-nothing).
 *
 * Los repositorios tx-bound se construyen con el cliente transaccional: no son
 * providers de Nest, viven y mueren con la transacción.
 */
import { Injectable } from '@nestjs/common';
import { AccionAudit, Prisma } from '@prisma/client';
import { PrismaService } from '../../shared/prisma/prisma.service';
import type { RegistroAuditoria } from '../../shared/audit/audit-log.port';
import type {
  CamposFichaOperativa,
  FichaGuardadoRepositoryPort,
  FichaOperativa,
  PreEventoStatus,
  RepositoriosGuardadoFicha,
  UnidadDeTrabajoFichaPort,
} from '../domain/ficha-operativa.ports';
import { proyectarFicha } from './ficha-operativa.mapper';

/** Repositorio de FICHA_OPERATIVA (guardado) ligado a la transacción. */
class FichaGuardadoPrismaRepository implements FichaGuardadoRepositoryPort {
  constructor(private readonly tx: Prisma.TransactionClient) {}

  async guardarCampos(
    reservaId: string,
    campos: CamposFichaOperativa,
  ): Promise<FichaOperativa> {
    const fila = await this.tx.fichaOperativa.update({
      where: { reservaId },
      data: { ...campos },
    });
    const reserva = await this.tx.reserva.findUniqueOrThrow({
      where: { idReserva: reservaId },
      select: { preEventoStatus: true },
    });
    return proyectarFicha(fila, reserva.preEventoStatus);
  }

  async transicionarPreEvento(
    reservaId: string,
    destino: PreEventoStatus,
  ): Promise<void> {
    await this.tx.reserva.update({
      where: { idReserva: reservaId },
      data: { preEventoStatus: destino },
    });
  }

  async tocarFechaCierre(reservaId: string, fechaCierre: Date): Promise<void> {
    await this.tx.fichaOperativa.update({
      where: { reservaId },
      data: { fechaCierre },
    });
  }
}

/** Repositorio de AUDIT_LOG ligado a la transacción del guardado (comparte rollback). */
class AuditLogFichaPrismaRepository {
  constructor(private readonly tx: Prisma.TransactionClient) {}

  async registrar(registro: RegistroAuditoria): Promise<void> {
    const datosNuevos = registro.datosNuevos as Prisma.InputJsonValue | undefined;
    await this.tx.auditLog.create({
      data: {
        tenantId: registro.tenantId,
        usuarioId: registro.usuarioId ?? null,
        entidad: registro.entidad ?? 'Sistema',
        entidadId: registro.entidadId ?? registro.usuarioId ?? '-',
        accion: registro.accion as AccionAudit,
        ...(datosNuevos !== undefined ? { datosNuevos } : {}),
      },
    });
  }
}

@Injectable()
export class GuardadoFichaUoWPrismaAdapter
  implements UnidadDeTrabajoFichaPort<RepositoriosGuardadoFicha>
{
  constructor(private readonly prisma: PrismaService) {}

  async ejecutar<T>(
    tenantId: string,
    trabajo: (repos: RepositoriosGuardadoFicha) => Promise<T>,
  ): Promise<unknown> {
    return this.prisma.$transaction(async (tx) => {
      await this.prisma.fijarTenant(tx, tenantId);
      const repos: RepositoriosGuardadoFicha = {
        ficha: new FichaGuardadoPrismaRepository(tx),
        auditoria: new AuditLogFichaPrismaRepository(tx),
      };
      return trabajo(repos);
    });
  }
}
