/**
 * Adaptador de la UNIDAD DE TRABAJO transaccional de los BORRADORES de liquidación y fianza
 * (US-027 / UC-21, UC-22).
 *
 * Implementa `UnidadDeTrabajoBorradoresPort`: abre UN `prisma.$transaction`, fija el contexto
 * RLS con `fijarTenant(tx, tenantId)` (`SET LOCAL app.tenant_id`) como PRIMERA operación y
 * expone los repositorios tx-bound (FACTURA borradores + AUDIT_LOG). Los dos borradores + sus
 * AUDIT_LOG viven en la MISMA tx (atómicos entre sí, design.md §D-1). Un fallo dentro del
 * `trabajo` revierte todo y PROPAGA el error — el `P2002` del `UNIQUE(reserva_id, tipo)` sube
 * al use-case para la recuperación por idempotencia. Nada de Redis/locks distribuidos.
 */
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../shared/prisma/prisma.service';
import type {
  RepositoriosBorradores,
  UnidadDeTrabajoBorradoresPort,
} from '../application/generar-borradores-liquidacion-fianza.use-case';
import {
  AuditoriaBorradorPrismaRepository,
  FacturaBorradorPrismaRepository,
} from './borradores-repository.prisma.adapter';

@Injectable()
export class BorradoresUoWPrismaAdapter implements UnidadDeTrabajoBorradoresPort {
  constructor(private readonly prisma: PrismaService) {}

  async ejecutar(
    tenantId: string,
    trabajo: (repos: RepositoriosBorradores) => Promise<unknown>,
  ): Promise<unknown> {
    return this.prisma.$transaction(async (tx) => {
      // RLS: primera operación de la transacción.
      await this.prisma.fijarTenant(tx, tenantId);
      const repos: RepositoriosBorradores = {
        facturas: new FacturaBorradorPrismaRepository(tx),
        auditoria: new AuditoriaBorradorPrismaRepository(tx),
      };
      return trabajo(repos);
    });
  }
}
