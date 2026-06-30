/**
 * Adaptador de la UNIDAD DE TRABAJO transaccional de la extensión manual del TTL del
 * bloqueo blando (`POST /reservas/{id}/extender-bloqueo`) (US-006 / UC-05).
 *
 * Implementa `UnidadDeTrabajoExtenderBloqueoPort`: abre UN único `prisma.$transaction`,
 * fija el contexto RLS con `fijarTenant(tx, tenantId)` (`SET LOCAL app.tenant_id`) como
 * PRIMERA operación, y expone los repositorios tx-bound. Las TRES operaciones de
 * §D-4/§D-8 (UPDATE `RESERVA.ttl_expiracion`; UPDATE `FECHA_BLOQUEADA.ttl_expiracion` al
 * mismo valor; AUDIT_LOG `actualizar`) viven dentro de esa única transacción: un fallo
 * en cualquiera propaga y revierte el conjunto (all-or-nothing).
 *
 * SERIALIZACIÓN (atomic-date-lock, §D-7): `leerBloqueoVigente` ejecuta `SELECT … FOR
 * UPDATE` sobre la fila de `FECHA_BLOQUEADA` de la fecha del evento. Ese lock de UNA
 * fila serializa la extensión frente a cualquier otra mutación de esa fecha (segunda
 * extensión, barrido A4/A5 US-012): la base del nuevo TTL se re-lee bajo el lock, sin
 * lost-update ni resucitar un bloqueo ya expirado-y-procesado. La exclusión mutua vive
 * SOLO en PostgreSQL; nada de Redis/locks distribuidos.
 */
import { Injectable } from '@nestjs/common';
import { AccionAudit, Prisma, SubEstadoConsulta } from '@prisma/client';
import { PrismaService } from '../../shared/prisma/prisma.service';
import type {
  AuditLogPort,
  RegistroAuditoria,
} from '../../shared/audit/audit-log.port';
import type {
  BloqueoExtensible,
  FechaBloqueadaExtenderBloqueoRepositoryPort,
  RepositoriosExtenderBloqueo,
  ReservaExtenderBloqueo,
  ReservaExtenderBloqueoRepositoryPort,
  UnidadDeTrabajoExtenderBloqueoPort,
} from '../application/extender-bloqueo.use-case';
import type { EstadoReserva as EstadoReservaDominio } from '../domain/maquina-estados';
import {
  subEstadoPrismaADominio,
  type SubEstadoConsultaPrisma,
} from './sub-estado-consulta.mapper';

const formatearFecha = (fecha: Date): string => fecha.toISOString().slice(0, 10);

/** Mapea una fila Prisma de RESERVA a la proyección de dominio de la extensión. */
const aReservaDominio = (fila: {
  idReserva: string;
  tenantId: string;
  clienteId: string;
  estado: string;
  subEstado: SubEstadoConsulta | null;
  ttlExpiracion: Date | null;
  fechaEvento: Date | null;
}): ReservaExtenderBloqueo => ({
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
});

/**
 * Repositorio de RESERVA tx-bound: lee el origen (y la base del TTL bajo el lock) y
 * aplica el UPDATE SOLO de `ttl_expiracion` (no toca estado/sub_estado, §D-8).
 */
class ReservaExtenderBloqueoPrismaRepository
  implements ReservaExtenderBloqueoRepositoryPort
{
  constructor(private readonly tx: Prisma.TransactionClient) {}

  async buscarPorId(params: {
    tenantId: string;
    reservaId: string;
  }): Promise<ReservaExtenderBloqueo | null> {
    const fila = await this.tx.reserva.findFirst({
      where: { idReserva: params.reservaId, tenantId: params.tenantId },
    });
    return fila === null ? null : aReservaDominio(fila);
  }

  async extenderTtl(params: {
    idReserva: string;
    ttlExpiracion: Date;
  }): Promise<ReservaExtenderBloqueo> {
    const fila = await this.tx.reserva.update({
      where: { idReserva: params.idReserva },
      data: { ttlExpiracion: params.ttlExpiracion },
    });
    return aReservaDominio(fila);
  }
}

/** Fila cruda del `SELECT … FOR UPDATE` sobre la fila bloqueante. */
interface FilaBloqueo {
  id_bloqueo: string;
  tipo_bloqueo: string;
  ttl_expiracion: Date | null;
}

/**
 * Repositorio tx-bound de FECHA_BLOQUEADA para la extensión del TTL.
 * `leerBloqueoVigente` bloquea la fila con `SELECT … FOR UPDATE` (serialización);
 * `extenderTtl` actualiza SOLO el `ttl_expiracion` de la fila existente (no toca
 * tipo_bloqueo ni fecha, §D-8).
 */
class FechaBloqueadaExtenderBloqueoPrismaRepository
  implements FechaBloqueadaExtenderBloqueoRepositoryPort
{
  constructor(private readonly tx: Prisma.TransactionClient) {}

  async leerBloqueoVigente(params: {
    tenantId: string;
    fecha: Date;
    reservaId: string;
  }): Promise<BloqueoExtensible | null> {
    const fechaIso = formatearFecha(params.fecha);
    // `SELECT … FOR UPDATE` sobre la fila bloqueante de (tenant, fecha, reserva):
    // punto de serialización de toda operación sobre esa fecha (sin locks distribuidos).
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
      tipoBloqueo: filas[0].tipo_bloqueo === 'firme' ? 'firme' : 'blando',
      ttlExpiracion: filas[0].ttl_expiracion,
    };
  }

  async extenderTtl(params: {
    tenantId: string;
    fecha: Date;
    reservaId: string;
    ttlExpiracion: Date;
  }): Promise<void> {
    await this.tx.fechaBloqueada.updateMany({
      where: {
        tenantId: params.tenantId,
        fecha: params.fecha,
        reservaId: params.reservaId,
      },
      data: { ttlExpiracion: params.ttlExpiracion },
    });
  }
}

/**
 * Repositorio de AUDIT_LOG tx-bound: escribe DENTRO de la transacción para compartir
 * el destino del rollback. Registra la prórroga con `accion='actualizar'` y
 * `datosAnteriores`/`datosNuevos`.
 */
class AuditLogExtenderBloqueoPrismaRepository implements AuditLogPort {
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
export class UnidadDeTrabajoExtenderBloqueoPrismaAdapter
  implements UnidadDeTrabajoExtenderBloqueoPort
{
  constructor(private readonly prisma: PrismaService) {}

  async ejecutar(
    tenantId: string,
    trabajo: (repos: RepositoriosExtenderBloqueo) => Promise<unknown>,
  ): Promise<unknown> {
    return this.prisma.$transaction(async (tx) => {
      // RLS: primera operación de la transacción (SET LOCAL app.tenant_id).
      await this.prisma.fijarTenant(tx, tenantId);
      const repos: RepositoriosExtenderBloqueo = {
        reservas: new ReservaExtenderBloqueoPrismaRepository(tx),
        fechaBloqueada: new FechaBloqueadaExtenderBloqueoPrismaRepository(tx),
        auditoria: new AuditLogExtenderBloqueoPrismaRepository(tx),
      };
      return trabajo(repos);
    });
  }
}
