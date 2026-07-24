/**
 * Adaptadores de las UNIDADES DE TRABAJO transaccionales de la EMISIÓN (UC-21 liquidación, UC-18
 * señal).
 *
 * Abren UN `prisma.$transaction`, fijan el contexto RLS con `fijarTenant(tx, tenantId)`
 * (`SET LOCAL app.tenant_id`) como PRIMERA operación y exponen los repositorios tx-bound. El
 * envío de E3/E4 vive DENTRO del `trabajo` (síncrono y confirmado): si falla, el `trabajo`
 * propaga y la tx REVIERTE por completo (atomicidad estado↔email). El `P2002` de la numeración
 * sube al use-case para el reintento. Nada de Redis/locks distribuidos.
 *
 * fix-liquidacion-fianza-independientes: la emisión de liquidación pasa a ser standalone (E4 =
 * solo liquidación); desaparece la UoW del envío separado del recibo de fianza.
 */
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../shared/prisma/prisma.service';
import type {
  RepositoriosLiquidacionEmision,
  UnidadDeTrabajoLiquidacionEmisionPort,
} from '../application/enviar-factura-liquidacion.use-case';
import type {
  RepositoriosSenalEmision,
  UnidadDeTrabajoSenalEmisionPort,
} from '../application/enviar-factura-senal.use-case';
import {
  AuditoriaLiquidacionEmisionPrismaRepository,
  ComunicacionLiquidacionEmisionPrismaRepository,
  ExtraLiquidacionEmisionPrismaRepository,
  FacturaLiquidacionEmisionPrismaRepository,
  ReservaLiquidacionEmisionPrismaRepository,
} from './emision-repository.prisma.adapter';
import {
  AuditoriaSenalEmisionPrismaRepository,
  ComunicacionSenalEmisionPrismaRepository,
  FacturaSenalEmisionPrismaRepository,
  ReservaSenalEmisionPrismaRepository,
} from './senal-emision-repository.prisma.adapter';

@Injectable()
export class EmisionUoWPrismaAdapter implements UnidadDeTrabajoLiquidacionEmisionPort {
  constructor(private readonly prisma: PrismaService) {}

  async ejecutar(
    tenantId: string,
    trabajo: (repos: RepositoriosLiquidacionEmision) => Promise<unknown>,
  ): Promise<unknown> {
    return this.prisma.$transaction(async (tx) => {
      await this.prisma.fijarTenant(tx, tenantId);
      const repos: RepositoriosLiquidacionEmision = {
        facturas: new FacturaLiquidacionEmisionPrismaRepository(tx),
        reservas: new ReservaLiquidacionEmisionPrismaRepository(tx),
        extras: new ExtraLiquidacionEmisionPrismaRepository(tx),
        comunicaciones: new ComunicacionLiquidacionEmisionPrismaRepository(tx),
        auditoria: new AuditoriaLiquidacionEmisionPrismaRepository(tx),
      };
      return trabajo(repos);
    });
  }
}

@Injectable()
export class SenalEmisionUoWPrismaAdapter implements UnidadDeTrabajoSenalEmisionPort {
  constructor(private readonly prisma: PrismaService) {}

  async ejecutar(
    tenantId: string,
    trabajo: (repos: RepositoriosSenalEmision) => Promise<unknown>,
  ): Promise<unknown> {
    return this.prisma.$transaction(async (tx) => {
      await this.prisma.fijarTenant(tx, tenantId);
      const repos: RepositoriosSenalEmision = {
        facturas: new FacturaSenalEmisionPrismaRepository(tx),
        reservas: new ReservaSenalEmisionPrismaRepository(tx),
        comunicaciones: new ComunicacionSenalEmisionPrismaRepository(tx),
        auditoria: new AuditoriaSenalEmisionPrismaRepository(tx),
      };
      return trabajo(repos);
    });
  }
}
