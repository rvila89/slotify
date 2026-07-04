/**
 * Adaptador de la UNIDAD DE TRABAJO transaccional del CIERRE de la ficha operativa
 * (US-025 / UC-20, §D-6).
 *
 * Implementa `UnidadDeTrabajoFichaPort<RepositoriosCierreFicha>`: abre UN único
 * `prisma.$transaction`, fija el contexto RLS (`SET LOCAL app.tenant_id`) como PRIMERA
 * operación, y expone los repositorios ligados a esa transacción. El cierre fija
 * `ficha_cerrada = true`, `fecha_cierre = now()` en FICHA_OPERATIVA y transiciona
 * `RESERVA.pre_evento_status` a `cerrado`, todo atómico.
 */
import { Injectable } from '@nestjs/common';
import { AccionAudit, Prisma } from '@prisma/client';
import { PrismaService } from '../../shared/prisma/prisma.service';
import type { RegistroAuditoria } from '../../shared/audit/audit-log.port';
import type {
  DatosCierreFicha,
  FichaCierreRepositoryPort,
  FichaOperativa,
  RepositoriosCierreFicha,
  UnidadDeTrabajoFichaPort,
} from '../domain/ficha-operativa.ports';
import { proyectarFicha } from './ficha-operativa.mapper';

/** Repositorio de FICHA_OPERATIVA (cierre) ligado a la transacción. */
class FichaCierrePrismaRepository implements FichaCierreRepositoryPort {
  constructor(private readonly tx: Prisma.TransactionClient) {}

  async cerrar(reservaId: string, datos: DatosCierreFicha): Promise<FichaOperativa> {
    const fila = await this.tx.fichaOperativa.update({
      where: { reservaId },
      data: {
        fichaCerrada: datos.fichaCerrada,
        fechaCierre: datos.fechaCierre,
      },
    });
    await this.tx.reserva.update({
      where: { idReserva: reservaId },
      data: { preEventoStatus: datos.preEventoStatus },
    });
    return proyectarFicha(fila, datos.preEventoStatus);
  }
}

/** Repositorio de AUDIT_LOG ligado a la transacción del cierre (comparte rollback). */
class AuditLogCierrePrismaRepository {
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
export class CierreFichaUoWPrismaAdapter
  implements UnidadDeTrabajoFichaPort<RepositoriosCierreFicha>
{
  constructor(private readonly prisma: PrismaService) {}

  async ejecutar<T>(
    tenantId: string,
    trabajo: (repos: RepositoriosCierreFicha) => Promise<T>,
  ): Promise<unknown> {
    return this.prisma.$transaction(async (tx) => {
      await this.prisma.fijarTenant(tx, tenantId);
      const repos: RepositoriosCierreFicha = {
        ficha: new FichaCierrePrismaRepository(tx),
        auditoria: new AuditLogCierrePrismaRepository(tx),
      };
      return trabajo(repos);
    });
  }
}
