/**
 * Adaptador Prisma del puerto de lectura `DashboardQueryPort`
 * (`GET /dashboard` → `DashboardResponse`, US-044 / UC-34).
 *
 * LECTURA PURA (design.md §D-5): agrega las reservas del tenant sin mutar estado. El
 * use-case aplica las ventanas temporales y los criterios de cada widget; el adaptador
 * se limita a entregar el dataset ya restringido a `activo = true` del tenant (§D-4).
 *
 * MULTI-TENANCY + RLS (§D-4): fija el contexto RLS (`SET LOCAL app.tenant_id`) como
 * PRIMERA operación de la transacción de lectura y filtra SIEMPRE por `tenant_id` +
 * `activo` en el `WHERE` (defensa en profundidad sobre RLS). Ninguna fila de otro
 * tenant es alcanzable. El sub-estado se traduce del literal Prisma (`s2a`) al valor de
 * dominio (`2a`); las fechas DATE se emiten como `YYYY-MM-DD`.
 */
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../shared/prisma/prisma.service';
import type {
  AgregarDashboardParams,
  DashboardQueryPort,
} from '../domain/dashboard-query.port';
import type {
  DashboardDataset,
  DashboardReservaLectura,
} from '../domain/dashboard.types';
import type { EstadoReserva } from '../../reservas/domain/maquina-estados';
import {
  subEstadoPrismaADominio,
  type SubEstadoConsultaPrisma,
} from '../../reservas/infrastructure/sub-estado-consulta.mapper';

/** Formatea un `Date` (DATE) a `YYYY-MM-DD` en UTC; `null` si ausente. */
const aFechaUtc = (fecha: Date | null): string | null =>
  fecha === null ? null : fecha.toISOString().slice(0, 10);

@Injectable()
export class DashboardQueryPrismaAdapter implements DashboardQueryPort {
  constructor(private readonly prisma: PrismaService) {}

  async agregar(params: AgregarDashboardParams): Promise<DashboardDataset> {
    const { tenantId } = params;

    const filas = await this.prisma.$transaction(async (tx) => {
      // RLS: primera operación de la transacción de lectura (SET LOCAL app.tenant_id).
      await this.prisma.fijarTenant(tx, tenantId);
      // Filtra SIEMPRE por tenant + activo (defensa en profundidad sobre RLS, §D-4).
      return tx.reserva.findMany({
        where: { tenantId, activo: true },
        select: {
          idReserva: true,
          tenantId: true,
          codigo: true,
          estado: true,
          subEstado: true,
          fechaEvento: true,
          activo: true,
          preEventoStatus: true,
          liquidacionStatus: true,
          fianzaStatus: true,
          visitaProgramadaFecha: true,
          posicionCola: true,
          fechaCreacion: true,
          cliente: { select: { nombre: true, apellidos: true } },
        },
      });
    });

    const reservas: DashboardReservaLectura[] = filas.map((f) => ({
      reservaId: f.idReserva,
      tenantId: f.tenantId,
      codigo: f.codigo,
      clienteNombre: `${f.cliente.nombre}${f.cliente.apellidos ? ` ${f.cliente.apellidos}` : ''}`.trim(),
      estado: f.estado as EstadoReserva,
      subEstado:
        f.subEstado === null
          ? null
          : subEstadoPrismaADominio(f.subEstado as SubEstadoConsultaPrisma),
      fechaEvento: aFechaUtc(f.fechaEvento),
      activo: f.activo,
      preEventoStatus: f.preEventoStatus,
      liquidacionStatus: f.liquidacionStatus,
      fianzaStatus: f.fianzaStatus,
      visitaProgramadaFecha: aFechaUtc(f.visitaProgramadaFecha),
      posicionCola: f.posicionCola,
      fechaCreacion: f.fechaCreacion,
    }));

    return { reservas };
  }
}
