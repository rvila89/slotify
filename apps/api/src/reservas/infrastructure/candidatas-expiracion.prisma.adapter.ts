/**
 * Adaptador Prisma del puerto `CandidatasExpiracionPort` (US-012 / UC-09, §D-4/§D-6/§D-7).
 *
 * Lectura CROSS-TENANT de las RESERVA candidatas a expirar: `ttl_expiracion < now()`
 * AND (`sub_estado ∈ {s2b, s2c, s2v}` OR `estado = 'pre_reserva'`). Es el ÚNICO punto
 * cross-tenant legítimo del sistema (D-6): el barrido del proceso de Sistema evalúa
 * candidatas de TODOS los tenants en una sola pasada, con el rol técnico del proceso
 * (sin `SET LOCAL app.tenant_id`). Cada fila trae su `tenant_id`; las MUTACIONES
 * posteriores (adaptador de UoW) SÍ fijan el tenant de la fila (RLS write por tenant),
 * nunca cruzan tenant.
 *
 * SELECCIÓN POR INSTANTE (D-7): la candidatura se decide por `ttl_expiracion < now()`
 * comparando `timestamptz` en SQL (`now()` del motor), NUNCA por una fecha formateada
 * como string. Así el off-by-one de presentación (memoria "TTL display off-by-one por
 * TZ") no afecta a qué se expira.
 */
import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../shared/prisma/prisma.service';
import type {
  CandidatasExpiracionPort,
  ReservaCandidata,
} from '../application/expirar-consultas-vencidas.service';
import type {
  EstadoReserva as EstadoReservaDominio,
} from '../domain/maquina-estados';
import {
  subEstadoPrismaADominio,
  type SubEstadoConsultaPrisma,
} from './sub-estado-consulta.mapper';

/** Fila cruda del SELECT de candidatas (columnas snake_case). */
interface FilaCandidata {
  id_reserva: string;
  tenant_id: string;
  fecha_evento: Date | null;
  estado: EstadoReservaDominio;
  sub_estado: SubEstadoConsultaPrisma | null;
  ttl_expiracion: Date | null;
}

@Injectable()
export class CandidatasExpiracionPrismaAdapter implements CandidatasExpiracionPort {
  constructor(private readonly prisma: PrismaService) {}

  async listarCandidatas(): Promise<ReservaCandidata[]> {
    // CROSS-TENANT: sin `fijarTenant` (rol técnico del proceso de Sistema, D-6). La
    // comparación del TTL es por INSTANTE (D-7): `ttl_expiracion` (TIMESTAMP en UTC,
    // como lo persiste Prisma) frente a `now() AT TIME ZONE 'UTC'` (instante actual en
    // UTC), NUNCA por fecha formateada. Se excluyen filas sin `fecha_evento` (no hay
    // fecha que liberar) y las que no tienen `ttl_expiracion`.
    const filas = await this.prisma.$queryRaw<FilaCandidata[]>(Prisma.sql`
      SELECT id_reserva, tenant_id, fecha_evento, estado, sub_estado, ttl_expiracion
      FROM reserva
      WHERE ttl_expiracion IS NOT NULL
        AND ttl_expiracion < (now() AT TIME ZONE 'UTC')
        AND fecha_evento IS NOT NULL
        AND (sub_estado IN ('s2b', 's2c', 's2v') OR estado = 'pre_reserva')
    `);

    return filas.map((fila) => ({
      reservaId: fila.id_reserva,
      tenantId: fila.tenant_id,
      fecha: fila.fecha_evento as Date,
      estado: fila.estado,
      subEstado:
        fila.sub_estado === null
          ? null
          : subEstadoPrismaADominio(fila.sub_estado),
      ttlExpiracion: fila.ttl_expiracion,
    }));
  }
}
