/**
 * Adaptador de la UNIDAD DE TRABAJO transaccional de `facturacion` (US-022 / UC-18).
 *
 * Implementa `UnidadDeTrabajoFacturacionPort`: abre UN `prisma.$transaction`, fija el
 * contexto RLS con `fijarTenant(tx, tenantId)` (`SET LOCAL app.tenant_id`) como PRIMERA
 * operación y expone los repositorios tx-bound (FACTURA + AUDIT_LOG). Un fallo dentro del
 * `trabajo` revierte todo (all-or-nothing) y PROPAGA el error — el `P2002` del
 * `UNIQUE(tenant_id, numero_factura)` sube al bucle de reintento del use-case (§D-8). La
 * exclusión mutua de la numeración es del motor SQL (constraint + reintento aplicativo);
 * nada de Redis/locks distribuidos.
 */
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../shared/prisma/prisma.service';
import type {
  RepositoriosFacturacion,
  UnidadDeTrabajoFacturacionPort,
} from '../application/generar-factura-senal.use-case';
import {
  AuditoriaFacturacionPrismaRepository,
  FacturaPrismaRepository,
} from './facturacion-repository.prisma.adapter';

@Injectable()
export class FacturacionUoWPrismaAdapter implements UnidadDeTrabajoFacturacionPort {
  constructor(private readonly prisma: PrismaService) {}

  async ejecutar(
    tenantId: string,
    trabajo: (repos: RepositoriosFacturacion) => Promise<unknown>,
  ): Promise<unknown> {
    return this.prisma.$transaction(async (tx) => {
      // RLS: primera operación de la transacción.
      await this.prisma.fijarTenant(tx, tenantId);
      const repos: RepositoriosFacturacion = {
        facturas: new FacturaPrismaRepository(tx),
        auditoria: new AuditoriaFacturacionPrismaRepository(tx),
      };
      return trabajo(repos);
    });
  }
}
