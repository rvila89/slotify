/**
 * Adaptador de la UNIDAD DE TRABAJO transaccional del COBRO de la liquidación (US-029 / UC-21
 * pasos 7-10). Abre UN `prisma.$transaction`, fija el contexto RLS con `fijarTenant(tx, tenantId)`
 * (`SET LOCAL app.tenant_id`) como PRIMERA operación y expone los repositorios tx-bound
 * (`RepositoriosCobro`). La relectura de la RESERVA usa `SELECT ... FOR UPDATE` (lock de fila
 * PostgreSQL, NUNCA Redis/locks distribuidos) para serializar el doble cobro (design.md §D-2).
 * Si el `trabajo` lanza, la tx REVIERTE por completo (atomicidad estado↔PAGO).
 */
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../shared/prisma/prisma.service';
import type {
  RepositoriosCobro,
  UnidadDeTrabajoCobroPort,
} from '../application/registrar-cobro-liquidacion.use-case';
import {
  AuditoriaCobroPrismaRepository,
  DocumentoCobroPrismaRepository,
  FacturaCobroPrismaRepository,
  PagoCobroPrismaRepository,
  ReservaCobroPrismaRepository,
} from './cobro-liquidacion-repository.prisma.adapter';

@Injectable()
export class CobroLiquidacionUoWPrismaAdapter implements UnidadDeTrabajoCobroPort {
  constructor(private readonly prisma: PrismaService) {}

  async ejecutar(
    tenantId: string,
    trabajo: (repos: RepositoriosCobro) => Promise<unknown>,
  ): Promise<unknown> {
    return this.prisma.$transaction(async (tx) => {
      await this.prisma.fijarTenant(tx, tenantId);
      const repos: RepositoriosCobro = {
        facturas: new FacturaCobroPrismaRepository(tx),
        reservas: new ReservaCobroPrismaRepository(tx),
        documentos: new DocumentoCobroPrismaRepository(tx),
        pagos: new PagoCobroPrismaRepository(tx),
        auditoria: new AuditoriaCobroPrismaRepository(tx),
      };
      return trabajo(repos);
    });
  }
}
