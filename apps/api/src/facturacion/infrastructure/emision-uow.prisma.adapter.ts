/**
 * Adaptadores de las UNIDADES DE TRABAJO transaccionales de la EMISIÓN (US-028 / UC-21, UC-22).
 *
 * Abren UN `prisma.$transaction`, fijan el contexto RLS con `fijarTenant(tx, tenantId)`
 * (`SET LOCAL app.tenant_id`) como PRIMERA operación y exponen los repositorios tx-bound. El
 * envío de E4/recibo vive DENTRO del `trabajo` (síncrono y confirmado): si falla, el `trabajo`
 * propaga y la tx REVIERTE por completo (atomicidad estado↔email, design.md §D-1). El `P2002`
 * de la numeración sube al use-case para el reintento. Nada de Redis/locks distribuidos.
 */
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../shared/prisma/prisma.service';
import type {
  RepositoriosEmision,
  UnidadDeTrabajoEmisionPort,
} from '../application/aprobar-y-enviar-liquidacion.use-case';
import type {
  RepositoriosFianzaSeparada,
  UnidadDeTrabajoFianzaPort,
} from '../application/enviar-recibo-fianza-separado.use-case';
import type {
  RepositoriosSenalEmision,
  UnidadDeTrabajoSenalEmisionPort,
} from '../application/enviar-factura-senal.use-case';
import {
  AuditoriaEmisionPrismaRepository,
  ComunicacionEmisionPrismaRepository,
  ExtraEmisionPrismaRepository,
  FacturaEmisionPrismaRepository,
  ReservaEmisionPrismaRepository,
} from './emision-repository.prisma.adapter';
import {
  AuditoriaFianzaPrismaRepository,
  ComunicacionFianzaPrismaRepository,
  FacturaFianzaPrismaRepository,
  ReservaFianzaPrismaRepository,
} from './fianza-separada-repository.prisma.adapter';
import {
  AuditoriaSenalEmisionPrismaRepository,
  ComunicacionSenalEmisionPrismaRepository,
  FacturaSenalEmisionPrismaRepository,
  ReservaSenalEmisionPrismaRepository,
} from './senal-emision-repository.prisma.adapter';

@Injectable()
export class EmisionUoWPrismaAdapter implements UnidadDeTrabajoEmisionPort {
  constructor(private readonly prisma: PrismaService) {}

  async ejecutar(
    tenantId: string,
    trabajo: (repos: RepositoriosEmision) => Promise<unknown>,
  ): Promise<unknown> {
    return this.prisma.$transaction(async (tx) => {
      await this.prisma.fijarTenant(tx, tenantId);
      const repos: RepositoriosEmision = {
        facturas: new FacturaEmisionPrismaRepository(tx),
        reservas: new ReservaEmisionPrismaRepository(tx),
        extras: new ExtraEmisionPrismaRepository(tx),
        comunicaciones: new ComunicacionEmisionPrismaRepository(tx),
        auditoria: new AuditoriaEmisionPrismaRepository(tx),
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

@Injectable()
export class FianzaSeparadaUoWPrismaAdapter implements UnidadDeTrabajoFianzaPort {
  constructor(private readonly prisma: PrismaService) {}

  async ejecutar(
    tenantId: string,
    trabajo: (repos: RepositoriosFianzaSeparada) => Promise<unknown>,
  ): Promise<unknown> {
    return this.prisma.$transaction(async (tx) => {
      await this.prisma.fijarTenant(tx, tenantId);
      const repos: RepositoriosFianzaSeparada = {
        facturas: new FacturaFianzaPrismaRepository(tx),
        reservas: new ReservaFianzaPrismaRepository(tx),
        comunicaciones: new ComunicacionFianzaPrismaRepository(tx),
        auditoria: new AuditoriaFianzaPrismaRepository(tx),
      };
      return trabajo(repos);
    });
  }
}
