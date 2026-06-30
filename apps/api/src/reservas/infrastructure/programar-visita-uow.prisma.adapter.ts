/**
 * Adaptador de la UNIDAD DE TRABAJO transaccional de la transición «programar visita»
 * (`2.a`/`2.b`/`2.c` → `2.v`) (US-008 / UC-07).
 *
 * Implementa `UnidadDeTrabajoProgramarVisitaPort`: abre UN único `prisma.$transaction`,
 * fija el contexto RLS con `fijarTenant(tx, tenantId)` (`SET LOCAL app.tenant_id`)
 * como PRIMERA operación, y expone los repositorios tx-bound. Las TRES operaciones de
 * §D-3/§D-4 (UPDATE RESERVA → 2.v + campos de visita + TTL; INSERT-o-UPDATE de
 * FECHA_BLOQUEADA con el mismo TTL; AUDIT_LOG `transicion`) viven dentro de esa única
 * transacción: un fallo en cualquiera propaga y revierte el conjunto (all-or-nothing).
 *
 * SERIALIZACIÓN (atomic-date-lock): `leerBloqueoVigente` ejecuta `SELECT … FOR UPDATE`
 * sobre la fila de `FECHA_BLOQUEADA` de la fecha del evento (origen 2.b/2.c). Ese lock
 * de UNA fila serializa la transición frente a cualquier otra mutación de esa fecha
 * (segunda transición, barrido A4). En origen 2.a (sin fila) el INSERT del upsert lo
 * serializa el `UNIQUE(tenant_id, fecha)`: una transición gana, la otra recibe `P2002`
 * y revierte. La exclusión mutua vive SOLO en PostgreSQL; nada de Redis/locks
 * distribuidos.
 */
import { Injectable } from '@nestjs/common';
import { AccionAudit, Prisma, SubEstadoConsulta, TipoBloqueo } from '@prisma/client';
import { PrismaService } from '../../shared/prisma/prisma.service';
import type {
  AuditLogPort,
  RegistroAuditoria,
} from '../../shared/audit/audit-log.port';
import type {
  ActualizarReservaProgramarVisitaParams,
  BloqueoVisitaVigente,
  FechaBloqueadaProgramarVisitaRepositoryPort,
  RepositoriosProgramarVisita,
  ReservaProgramarVisita,
  ReservaProgramarVisitaRepositoryPort,
  UnidadDeTrabajoProgramarVisitaPort,
  UpsertTtlBloqueoVisitaParams,
} from '../application/programar-visita.use-case';
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
}): ReservaProgramarVisita => ({
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

/** Repositorio de RESERVA tx-bound: lee el origen y aplica el UPDATE a `2.v`. */
class ReservaProgramarVisitaPrismaRepository
  implements ReservaProgramarVisitaRepositoryPort
{
  constructor(private readonly tx: Prisma.TransactionClient) {}

  async buscarPorId(params: {
    tenantId: string;
    reservaId: string;
  }): Promise<ReservaProgramarVisita | null> {
    const fila = await this.tx.reserva.findFirst({
      where: { idReserva: params.reservaId, tenantId: params.tenantId },
    });
    return fila === null ? null : aReservaDominio(fila);
  }

  async actualizar(
    p: ActualizarReservaProgramarVisitaParams,
  ): Promise<ReservaProgramarVisita> {
    const fila = await this.tx.reserva.update({
      where: { idReserva: p.idReserva },
      data: {
        subEstado: subEstadoDominioAPrisma(p.subEstado) as SubEstadoConsulta,
        ttlExpiracion: p.ttlExpiracion,
        visitaProgramadaFecha: p.visitaProgramadaFecha,
        visitaProgramadaHora: p.visitaProgramadaHora,
        visitaRealizada: p.visitaRealizada,
      },
    });
    return aReservaDominio(fila);
  }
}

/** Fila cruda del `SELECT … FOR UPDATE` sobre la fila bloqueante. */
interface FilaBloqueo {
  id_bloqueo: string;
  ttl_expiracion: Date | null;
}

/**
 * Repositorio tx-bound de FECHA_BLOQUEADA para la transición a `2.v`.
 * `leerBloqueoVigente` bloquea la fila con `SELECT … FOR UPDATE` (serialización,
 * origen 2.b/2.c); `upsertTtl` INSERTA (origen 2.a, serializado por el UNIQUE) o
 * ACTUALIZA el `ttl_expiracion` de la fila existente (§D-2). El `P2002` del INSERT se
 * propaga CRUDO: la transacción revierte (no se duplica la fila de la misma fecha).
 */
class FechaBloqueadaProgramarVisitaPrismaRepository
  implements FechaBloqueadaProgramarVisitaRepositoryPort
{
  constructor(private readonly tx: Prisma.TransactionClient) {}

  async leerBloqueoVigente(params: {
    tenantId: string;
    fecha: Date;
    reservaId: string;
  }): Promise<BloqueoVisitaVigente | null> {
    const fechaIso = formatearFecha(params.fecha);
    // `SELECT … FOR UPDATE` sobre la fila bloqueante de (tenant, fecha): punto de
    // serialización de toda operación sobre esa fecha (sin locks distribuidos).
    const filas = await this.tx.$queryRaw<FilaBloqueo[]>(Prisma.sql`
      SELECT id_bloqueo, ttl_expiracion
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
      ttlExpiracion: filas[0].ttl_expiracion,
    };
  }

  async upsertTtl(params: UpsertTtlBloqueoVisitaParams): Promise<void> {
    if (params.accion === 'update') {
      // UPDATE de la fila existente (origen 2.b/2.c): mismo TTL, tipo blando.
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
      return;
    }
    // INSERT de una nueva fila (origen 2.a): el UNIQUE(tenant_id, fecha) serializa
    // con cualquier bloqueo concurrente de la misma fecha (P2002 → rollback de la tx).
    await this.tx.fechaBloqueada.create({
      data: {
        tenantId: params.tenantId,
        fecha: params.fecha,
        reservaId: params.reservaId,
        tipoBloqueo: TipoBloqueo.blando,
        ttlExpiracion: params.ttlExpiracion,
      },
    });
  }
}

/**
 * Repositorio de AUDIT_LOG tx-bound: escribe DENTRO de la transacción para compartir
 * el destino del rollback. Registra la transición `origen → 2.v` con
 * `datosAnteriores`/`datosNuevos`.
 */
class AuditLogProgramarVisitaPrismaRepository implements AuditLogPort {
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
export class UnidadDeTrabajoProgramarVisitaPrismaAdapter
  implements UnidadDeTrabajoProgramarVisitaPort
{
  constructor(private readonly prisma: PrismaService) {}

  async ejecutar(
    tenantId: string,
    trabajo: (repos: RepositoriosProgramarVisita) => Promise<unknown>,
  ): Promise<unknown> {
    return this.prisma.$transaction(async (tx) => {
      // RLS: primera operación de la transacción (SET LOCAL app.tenant_id).
      await this.prisma.fijarTenant(tx, tenantId);
      const repos: RepositoriosProgramarVisita = {
        reservas: new ReservaProgramarVisitaPrismaRepository(tx),
        fechaBloqueada: new FechaBloqueadaProgramarVisitaPrismaRepository(tx),
        auditoria: new AuditLogProgramarVisitaPrismaRepository(tx),
      };
      return trabajo(repos);
    });
  }
}
