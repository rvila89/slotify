/**
 * Adaptador de la UNIDAD DE TRABAJO transaccional de la transición «pendiente de
 * invitados» (`2.b → 2.c`) (US-007 / UC-06).
 *
 * Implementa `UnidadDeTrabajoPendienteInvitadosPort`: abre UN único
 * `prisma.$transaction`, fija el contexto RLS con `fijarTenant(tx, tenantId)`
 * (`SET LOCAL app.tenant_id`) como PRIMERA operación, y expone los repositorios
 * tx-bound. Las CUATRO operaciones de §D-4/§D-5 (UPDATE RESERVA 2b→2c + nuevo TTL;
 * UPDATE FECHA_BLOQUEADA al mismo TTL; vaciado de cola 2d→2y; AUDIT_LOG principal +
 * por descartada) viven dentro de esa única transacción: un fallo en cualquiera
 * propaga y revierte el conjunto (all-or-nothing).
 *
 * SERIALIZACIÓN (atomic-date-lock): `leerBloqueoVigente` ejecuta `SELECT … FOR
 * UPDATE` sobre la fila de `FECHA_BLOQUEADA` de la fecha de la RESERVA. Ese lock de
 * UNA fila serializa esta transición frente a cualquier otra operación sobre la cola
 * o el bloqueo de la misma fecha (segunda transición, salida/promoción de cola): la
 * exclusión mutua vive SOLO en PostgreSQL; nada de Redis/locks distribuidos.
 */
import { Injectable } from '@nestjs/common';
import { AccionAudit, Prisma, SubEstadoConsulta } from '@prisma/client';
import { PrismaService } from '../../shared/prisma/prisma.service';
import type {
  AuditLogPort,
  RegistroAuditoria,
} from '../../shared/audit/audit-log.port';
import type {
  ActualizarReservaPendienteInvitadosParams,
  BloqueoVigente,
  ColaPendienteInvitadosRepositoryPort,
  FechaBloqueadaPendienteInvitadosRepositoryPort,
  RepositoriosPendienteInvitados,
  ReservaPendienteInvitados,
  ReservaPendienteInvitadosRepositoryPort,
  UnidadDeTrabajoPendienteInvitadosPort,
} from '../application/transicion-pendiente-invitados.use-case';
import type { EstadoReserva as EstadoReservaDominio } from '../domain/maquina-estados';
import {
  subEstadoDominioAPrisma,
  subEstadoPrismaADominio,
  type SubEstadoConsultaPrisma,
} from './sub-estado-consulta.mapper';

const formatearFecha = (fecha: Date): string => fecha.toISOString().slice(0, 10);

/**
 * Mapea una fila Prisma de RESERVA a la proyección de dominio.
 *
 * Frontera de persistencia: el enum Prisma `EstadoReserva` y el tipo de dominio
 * `EstadoReserva` comparten literales VERBATIM (`consulta`, `pre_reserva`, …), por
 * lo que `estado` se castea directamente (mismo patrón que los adaptadores hermanos
 * `transicion-fecha-uow`/`reserva-detalle-query`). El `subEstado` SÍ difiere (`s2a` ↔
 * `2a`), así que pasa por `subEstadoPrismaADominio` (mapper, una sola fuente de
 * verdad), no por un cast directo.
 */
const aReservaDominio = (fila: {
  idReserva: string;
  tenantId: string;
  clienteId: string;
  estado: string;
  subEstado: SubEstadoConsulta | null;
  ttlExpiracion: Date | null;
  fechaEvento: Date | null;
  posicionCola: number | null;
  consultaBloqueanteId: string | null;
}): ReservaPendienteInvitados => ({
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
  posicionCola: fila.posicionCola,
  consultaBloqueanteId: fila.consultaBloqueanteId,
});

/** Repositorio de RESERVA tx-bound: lee el origen y aplica el UPDATE `2b→2c`. */
class ReservaPendienteInvitadosPrismaRepository
  implements ReservaPendienteInvitadosRepositoryPort
{
  constructor(private readonly tx: Prisma.TransactionClient) {}

  async buscarPorId(params: {
    tenantId: string;
    reservaId: string;
  }): Promise<ReservaPendienteInvitados | null> {
    const fila = await this.tx.reserva.findFirst({
      where: { idReserva: params.reservaId, tenantId: params.tenantId },
    });
    return fila === null ? null : aReservaDominio(fila);
  }

  async actualizar(
    p: ActualizarReservaPendienteInvitadosParams,
  ): Promise<ReservaPendienteInvitados> {
    const fila = await this.tx.reserva.update({
      where: { idReserva: p.idReserva },
      data: {
        subEstado: subEstadoDominioAPrisma(p.subEstado) as SubEstadoConsulta,
        ttlExpiracion: p.ttlExpiracion,
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
 * Repositorio tx-bound de FECHA_BLOQUEADA para la transición a `2.c`. NO inserta (la
 * fila ya existe): `leerBloqueoVigente` la bloquea con `SELECT … FOR UPDATE`
 * (serialización, §D-5) y `extenderTtl` UPDATEa su `ttl_expiracion`.
 */
class FechaBloqueadaPendienteInvitadosPrismaRepository
  implements FechaBloqueadaPendienteInvitadosRepositoryPort
{
  constructor(private readonly tx: Prisma.TransactionClient) {}

  async leerBloqueoVigente(params: {
    tenantId: string;
    fecha: Date;
    reservaId: string;
  }): Promise<BloqueoVigente | null> {
    const fechaIso = formatearFecha(params.fecha);
    // `SELECT … FOR UPDATE` sobre la fila bloqueante de (tenant, fecha): punto de
    // serialización único de toda operación sobre esa fecha (sin locks distribuidos).
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

/** Repositorio tx-bound del vaciado de cola A16 (`2.d → 2.y`). */
class ColaPendienteInvitadosPrismaRepository
  implements ColaPendienteInvitadosRepositoryPort
{
  constructor(private readonly tx: Prisma.TransactionClient) {}

  async vaciarCola(params: {
    tenantId: string;
    consultaBloqueanteId: string;
  }): Promise<ReadonlyArray<string>> {
    // Filas en cola (2.d) apuntando a esta bloqueante. Se leen sus ids ANTES del
    // UPDATE masivo para auditar cada descarte (la cláusula NULLea el vínculo).
    const enCola = await this.tx.reserva.findMany({
      where: {
        tenantId: params.tenantId,
        consultaBloqueanteId: params.consultaBloqueanteId,
        subEstado: SubEstadoConsulta.s2d,
      },
      select: { idReserva: true },
    });
    const ids = enCola.map((r) => r.idReserva);
    if (ids.length === 0) {
      return [];
    }
    // UPDATE masivo 2.d → 2.y (terminal) con posicion_cola/consulta_bloqueante_id NULL.
    await this.tx.reserva.updateMany({
      where: { idReserva: { in: ids } },
      data: {
        subEstado: SubEstadoConsulta.s2y,
        posicionCola: null,
        consultaBloqueanteId: null,
      },
    });
    return ids;
  }
}

/**
 * Repositorio de AUDIT_LOG tx-bound: escribe DENTRO de la transacción para compartir
 * el destino del rollback. Soporta `datosAnteriores`/`datosNuevos` (la transición
 * registra ambos: `2b → 2c` principal y `2d → 2y` de cada descartada).
 */
class AuditLogPendienteInvitadosPrismaRepository implements AuditLogPort {
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
export class UnidadDeTrabajoPendienteInvitadosPrismaAdapter
  implements UnidadDeTrabajoPendienteInvitadosPort
{
  constructor(private readonly prisma: PrismaService) {}

  async ejecutar(
    tenantId: string,
    trabajo: (repos: RepositoriosPendienteInvitados) => Promise<unknown>,
  ): Promise<unknown> {
    return this.prisma.$transaction(async (tx) => {
      // RLS: primera operación de la transacción (SET LOCAL app.tenant_id).
      await this.prisma.fijarTenant(tx, tenantId);
      const repos: RepositoriosPendienteInvitados = {
        reservas: new ReservaPendienteInvitadosPrismaRepository(tx),
        fechaBloqueada: new FechaBloqueadaPendienteInvitadosPrismaRepository(tx),
        cola: new ColaPendienteInvitadosPrismaRepository(tx),
        auditoria: new AuditLogPendienteInvitadosPrismaRepository(tx),
      };
      return trabajo(repos);
    });
  }
}
