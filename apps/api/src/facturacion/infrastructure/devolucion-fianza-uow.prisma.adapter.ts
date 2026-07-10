/**
 * Adaptador de la UNIDAD DE TRABAJO transaccional de la DEVOLUCIÓN de la FIANZA (US-036 / UC-27
 * pasos 4-8). Simétrico inverso del cobro de US-030. Abre UN `prisma.$transaction`, fija el
 * contexto RLS con `fijarTenant(tx, tenantId)` (`SET LOCAL app.tenant_id`) como PRIMERA operación y
 * expone los repositorios tx-bound (`RepositoriosDevolucionFianza`). La relectura de la RESERVA usa
 * `SELECT ... FOR UPDATE` (lock de fila PostgreSQL, NUNCA Redis/locks distribuidos) para serializar
 * el doble registro (design.md §D-1/§D-4). Si el `trabajo` lanza, la tx REVIERTE por completo.
 */
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../shared/prisma/prisma.service';
import type {
  RepositoriosDevolucionFianza,
  UnidadDeTrabajoDevolucionFianzaPort,
} from '../application/registrar-devolucion-fianza.use-case';
import {
  AuditoriaDevolucionFianzaPrismaRepository,
  DocumentoDevolucionFianzaPrismaRepository,
  ReservaDevolucionFianzaPrismaRepository,
} from './devolucion-fianza-repository.prisma.adapter';

@Injectable()
export class DevolucionFianzaUoWPrismaAdapter implements UnidadDeTrabajoDevolucionFianzaPort {
  constructor(private readonly prisma: PrismaService) {}

  async ejecutar(
    tenantId: string,
    trabajo: (repos: RepositoriosDevolucionFianza) => Promise<unknown>,
  ): Promise<unknown> {
    return this.prisma.$transaction(async (tx) => {
      await this.prisma.fijarTenant(tx, tenantId);
      const repos: RepositoriosDevolucionFianza = {
        reservas: new ReservaDevolucionFianzaPrismaRepository(tx),
        documentos: new DocumentoDevolucionFianzaPrismaRepository(tx),
        auditoria: new AuditoriaDevolucionFianzaPrismaRepository(tx),
      };
      return trabajo(repos);
    });
  }
}
