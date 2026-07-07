/**
 * Adaptador de la UNIDAD DE TRABAJO transaccional del COBRO de la FIANZA (US-030 / UC-22 pasos
 * 5-9). Abre UN `prisma.$transaction`, fija el contexto RLS con `fijarTenant(tx, tenantId)`
 * (`SET LOCAL app.tenant_id`) como PRIMERA operación y expone los repositorios tx-bound
 * (`RepositoriosCobroFianza`). La relectura de la RESERVA usa `SELECT ... FOR UPDATE` (lock de fila
 * PostgreSQL, NUNCA Redis/locks distribuidos) para serializar el doble cobro (design.md §D-1). Si
 * el `trabajo` lanza, la tx REVIERTE por completo (atomicidad estado↔PAGO).
 */
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../shared/prisma/prisma.service';
import type {
  RepositoriosCobroFianza,
  UnidadDeTrabajoCobroFianzaPort,
} from '../application/registrar-cobro-fianza.use-case';
import {
  AuditoriaCobroFianzaPrismaRepository,
  DocumentoCobroFianzaPrismaRepository,
  FacturaCobroFianzaPrismaRepository,
  PagoCobroFianzaPrismaRepository,
  ReservaCobroFianzaPrismaRepository,
} from './cobro-fianza-repository.prisma.adapter';

@Injectable()
export class CobroFianzaUoWPrismaAdapter implements UnidadDeTrabajoCobroFianzaPort {
  constructor(private readonly prisma: PrismaService) {}

  async ejecutar(
    tenantId: string,
    trabajo: (repos: RepositoriosCobroFianza) => Promise<unknown>,
  ): Promise<unknown> {
    return this.prisma.$transaction(async (tx) => {
      await this.prisma.fijarTenant(tx, tenantId);
      const repos: RepositoriosCobroFianza = {
        facturas: new FacturaCobroFianzaPrismaRepository(tx),
        reservas: new ReservaCobroFianzaPrismaRepository(tx),
        documentos: new DocumentoCobroFianzaPrismaRepository(tx),
        pagos: new PagoCobroFianzaPrismaRepository(tx),
        auditoria: new AuditoriaCobroFianzaPrismaRepository(tx),
      };
      return trabajo(repos);
    });
  }
}
