/**
 * Adaptador de la UNIDAD DE TRABAJO transaccional del registro del resultado de la
 * visita — «cliente interesado» (`2.v` → `2.b`) (US-009 / UC-08).
 *
 * Implementa `UnidadDeTrabajoResultadoVisitaPort`: abre UN único `prisma.$transaction`,
 * fija el contexto RLS con `fijarTenant(tx, tenantId)` (`SET LOCAL app.tenant_id`)
 * como PRIMERA operación, y expone los repositorios tx-bound. Las TRES operaciones de
 * §D-2/§D-3 (UPDATE RESERVA → 2.b + visita_realizada + TTL fresco; UPDATE PURO del ttl
 * de la fila existente de FECHA_BLOQUEADA al mismo valor; AUDIT_LOG `transicion`) viven
 * dentro de esa única transacción: un fallo en cualquiera propaga y revierte el
 * conjunto (all-or-nothing).
 *
 * SERIALIZACIÓN (atomic-date-lock): `leerBloqueoVigente` ejecuta `SELECT … FOR UPDATE`
 * sobre la fila de `FECHA_BLOQUEADA` de la fecha del evento (que SIEMPRE existe al venir
 * de 2.v). Ese lock de UNA fila serializa la transición frente a cualquier otra mutación
 * de esa fecha (segundo registro concurrente, barrido A21/US-012): commit-first, uno
 * gana y el otro re-lee `2b` y cae en la guarda. La exclusión mutua vive SOLO en
 * PostgreSQL; nada de Redis/locks distribuidos.
 */
import { Injectable } from '@nestjs/common';
import { AccionAudit, Prisma, SubEstadoConsulta, TipoBloqueo } from '@prisma/client';
import { PrismaService } from '../../shared/prisma/prisma.service';
import type {
  AuditLogPort,
  RegistroAuditoria,
} from '../../shared/audit/audit-log.port';
import type {
  ActualizarReservaResultadoVisitaParams,
  ActualizarTtlBloqueoResultadoVisitaParams,
  BloqueoResultadoVisitaVigente,
  FechaBloqueadaResultadoVisitaRepositoryPort,
  RepositoriosResultadoVisita,
  ReservaResultadoVisita,
  ReservaResultadoVisitaRepositoryPort,
  UnidadDeTrabajoResultadoVisitaPort,
} from '../application/registrar-resultado-visita.use-case';
import type { EstadoReserva as EstadoReservaDominio } from '../domain/maquina-estados';
import {
  subEstadoDominioAPrisma,
  subEstadoPrismaADominio,
  type SubEstadoConsultaPrisma,
} from './sub-estado-consulta.mapper';

const formatearFecha = (fecha: Date): string => fecha.toISOString().slice(0, 10);

/** Mapea una fila Prisma de RESERVA a la proyección de dominio de la transición. */
const aReservaDominio = (fila: {
  idReserva: string;
  tenantId: string;
  clienteId: string;
  estado: string;
  subEstado: SubEstadoConsulta | null;
  ttlExpiracion: Date | null;
  fechaEvento: Date | null;
  visitaRealizada: boolean;
  visitaProgramadaFecha: Date | null;
  visitaProgramadaHora: string | null;
}): ReservaResultadoVisita => ({
  idReserva: fila.idReserva,
  tenantId: fila.tenantId,
  clienteId: fila.clienteId,
  estado: fila.estado as EstadoReservaDominio,
  subEstado:
    fila.subEstado === null
      ? null
      : subEstadoPrismaADominio(fila.subEstado as SubEstadoConsultaPrisma),
  ttlExpiracion: fila.ttlExpiracion,
  fechaEvento: fila.fechaEvento,
  visitaRealizada: fila.visitaRealizada,
  visitaProgramadaFecha: fila.visitaProgramadaFecha,
  visitaProgramadaHora: fila.visitaProgramadaHora,
});

/** Repositorio de RESERVA tx-bound: lee el origen y aplica el UPDATE a `2.b`. */
class ReservaResultadoVisitaPrismaRepository
  implements ReservaResultadoVisitaRepositoryPort
{
  constructor(private readonly tx: Prisma.TransactionClient) {}

  async buscarPorId(params: {
    tenantId: string;
    reservaId: string;
  }): Promise<ReservaResultadoVisita | null> {
    const fila = await this.tx.reserva.findFirst({
      where: { idReserva: params.reservaId, tenantId: params.tenantId },
    });
    return fila === null ? null : aReservaDominio(fila);
  }

  async actualizar(
    p: ActualizarReservaResultadoVisitaParams,
  ): Promise<ReservaResultadoVisita> {
    const fila = await this.tx.reserva.update({
      where: { idReserva: p.idReserva },
      data: {
        subEstado: subEstadoDominioAPrisma(p.subEstado) as SubEstadoConsulta,
        ttlExpiracion: p.ttlExpiracion,
        visitaRealizada: p.visitaRealizada,
      },
    });
    return aReservaDominio(fila);
  }
}

/** Fila cruda del `SELECT … FOR UPDATE` sobre la fila bloqueante. */
interface FilaBloqueo {
  id_bloqueo: string;
  tipo_bloqueo: TipoBloqueo;
  ttl_expiracion: Date | null;
}

/**
 * Repositorio tx-bound de FECHA_BLOQUEADA para la transición a `2.b`.
 * `leerBloqueoVigente` bloquea la fila con `SELECT … FOR UPDATE` (serialización);
 * `actualizarTtl` hace un UPDATE PURO del `ttl_expiracion` de la fila existente,
 * conservando `tipo_bloqueo='blando'` (§D-3): nunca INSERT ni DELETE.
 */
class FechaBloqueadaResultadoVisitaPrismaRepository
  implements FechaBloqueadaResultadoVisitaRepositoryPort
{
  constructor(private readonly tx: Prisma.TransactionClient) {}

  async leerBloqueoVigente(params: {
    tenantId: string;
    fecha: Date;
    reservaId: string;
  }): Promise<BloqueoResultadoVisitaVigente | null> {
    const fechaIso = formatearFecha(params.fecha);
    // `SELECT … FOR UPDATE` sobre la fila bloqueante de (tenant, fecha): punto de
    // serialización de toda operación sobre esa fecha (sin locks distribuidos).
    const filas = await this.tx.$queryRaw<FilaBloqueo[]>(Prisma.sql`
      SELECT id_bloqueo, tipo_bloqueo, ttl_expiracion
      FROM fecha_bloqueada
      WHERE tenant_id = ${params.tenantId}
        AND fecha = ${fechaIso}::date
        AND reserva_id = ${params.reservaId}
      FOR UPDATE
    `);
    if (filas.length === 0) {
      return null;
    }
    return {
      idBloqueo: filas[0].id_bloqueo,
      tipoBloqueo: filas[0].tipo_bloqueo === TipoBloqueo.firme ? 'firme' : 'blando',
      ttlExpiracion: filas[0].ttl_expiracion,
    };
  }

  async actualizarTtl(
    params: ActualizarTtlBloqueoResultadoVisitaParams,
  ): Promise<void> {
    // UPDATE PURO de la fila existente: mismo TTL fresco, tipo permanece blando.
    await this.tx.fechaBloqueada.updateMany({
      where: {
        tenantId: params.tenantId,
        fecha: params.fecha,
        reservaId: params.reservaId,
      },
      data: {
        tipoBloqueo: TipoBloqueo.blando,
        ttlExpiracion: params.ttlExpiracion,
      },
    });
  }
}

/**
 * Repositorio de AUDIT_LOG tx-bound: escribe DENTRO de la transacción para compartir
 * el destino del rollback. Registra la transición `2v → 2b` con
 * `datosAnteriores`/`datosNuevos`.
 */
class AuditLogResultadoVisitaPrismaRepository implements AuditLogPort {
  constructor(private readonly tx: Prisma.TransactionClient) {}

  async registrar(registro: RegistroAuditoria): Promise<void> {
    const datosAnteriores = registro.datosAnteriores as
      | Prisma.InputJsonValue
      | undefined;
    const datosNuevos = registro.datosNuevos as Prisma.InputJsonValue | undefined;
    await this.tx.auditLog.create({
      data: {
        tenantId: registro.tenantId,
        usuarioId: registro.usuarioId ?? null,
        entidad: registro.entidad ?? 'Sistema',
        entidadId: registro.entidadId ?? registro.usuarioId ?? '-',
        accion: registro.accion as AccionAudit,
        ...(datosAnteriores !== undefined ? { datosAnteriores } : {}),
        ...(datosNuevos !== undefined ? { datosNuevos } : {}),
      },
    });
  }
}

@Injectable()
export class UnidadDeTrabajoResultadoVisitaPrismaAdapter
  implements UnidadDeTrabajoResultadoVisitaPort
{
  constructor(private readonly prisma: PrismaService) {}

  async ejecutar(
    tenantId: string,
    trabajo: (repos: RepositoriosResultadoVisita) => Promise<unknown>,
  ): Promise<unknown> {
    return this.prisma.$transaction(async (tx) => {
      // RLS: primera operación de la transacción (SET LOCAL app.tenant_id).
      await this.prisma.fijarTenant(tx, tenantId);
      const repos: RepositoriosResultadoVisita = {
        reservas: new ReservaResultadoVisitaPrismaRepository(tx),
        fechaBloqueada: new FechaBloqueadaResultadoVisitaPrismaRepository(tx),
        auditoria: new AuditLogResultadoVisitaPrismaRepository(tx),
      };
      return trabajo(repos);
    });
  }
}
