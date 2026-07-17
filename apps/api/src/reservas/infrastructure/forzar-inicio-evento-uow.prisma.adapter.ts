/**
 * Adaptador de la UNIDAD DE TRABAJO atómica del FORZADO MANUAL del inicio de evento
 * (US-032 / UC-23 FA-01, §D-3). Implementa `UnidadDeTrabajoForzarInicioPort`.
 *
 * Abre UN único `prisma.$transaction` bajo el contexto RLS del `tenantId` del Gestor
 * (`fijarTenant(tx, tenantId)` = `SET LOCAL app.tenant_id` como PRIMERA operación) y expone
 * los repositorios tx-bound. La transición forzada + el AUDIT_LOG (origen Usuario) viven
 * DENTRO de esa transacción (all-or-nothing).
 *
 * SERIALIZACIÓN (D-3, sin locks distribuidos — hook `no-distributed-lock`): `forzarInicioEvento`
 * toma `SELECT … FOR UPDATE` sobre la fila RESERVA (serializa la doble sesión del gestor y la
 * carrera cron↔gestor) y aplica un `UPDATE … WHERE estado = 'reserva_confirmada'` que devuelve
 * las filas afectadas. La segunda petición concurrente (u el cron de US-031) queda a la espera
 * del lock; al liberarse, re-lee `estado = evento_en_curso`, su UPDATE afecta 0 filas y el
 * use-case lo traduce a conflicto. La exclusión mutua vive SOLO en PostgreSQL sobre la propia
 * fila RESERVA (NO se toca FECHA_BLOQUEADA ni la cola).
 *
 * D-5: la UPDATE muta EXCLUSIVAMENTE `estado`; NO toca `pre_evento_status`/`liquidacion_status`/
 * `fianza_status` (los sub-procesos incumplidos NO se resuelven).
 */
import { Injectable } from '@nestjs/common';
import { AccionAudit, EstadoReserva, Prisma } from '@prisma/client';
import { PrismaService } from '../../shared/prisma/prisma.service';
import type {
  AuditLogPort,
  RegistroAuditoria,
} from '../../shared/audit/audit-log.port';
import type {
  MutacionForzarInicioParams,
  MutacionForzarInicioResultado,
  RepositoriosForzarInicio,
  UnidadDeTrabajoForzarInicioPort,
} from '../application/forzar-inicio-evento.use-case';

/** Fila cruda del `SELECT … FOR UPDATE` sobre la RESERVA (solo el estado bajo lock). */
interface FilaReservaBloqueada {
  estado: EstadoReserva;
}

/**
 * Repositorio de RESERVA tx-bound: `SELECT … FOR UPDATE` de la fila (serialización) y
 * `UPDATE … WHERE estado = estadoOrigen` que muta EXCLUSIVAMENTE `estado` (D-5). Devuelve las
 * filas afectadas (`0` ⇒ bajo el lock el estado ya no era `reserva_confirmada`: carrera perdida).
 */
class ReservaForzarInicioPrismaRepository {
  constructor(private readonly tx: Prisma.TransactionClient) {}

  async forzarInicioEvento(
    params: MutacionForzarInicioParams,
  ): Promise<MutacionForzarInicioResultado> {
    // (1) SELECT … FOR UPDATE: serializa la doble sesión / carrera cron↔gestor sobre la propia
    //     fila RESERVA (sin locks distribuidos). La segunda petición espera aquí.
    await this.tx.$queryRaw<FilaReservaBloqueada[]>(Prisma.sql`
      SELECT estado
      FROM reserva
      WHERE id_reserva = ${params.reservaId}
        AND tenant_id = ${params.tenantId}
      FOR UPDATE
    `);

    // (2) UPDATE condicional por el estado de origen: bajo el lock, exactamente una gana.
    //     Muta SOLO `estado` (D-5): NO toca los tres *_status incumplidos.
    const { count } = await this.tx.reserva.updateMany({
      where: {
        idReserva: params.reservaId,
        tenantId: params.tenantId,
        estado: params.estadoOrigen as EstadoReserva,
      },
      data: {
        estado: params.estadoDestino as EstadoReserva,
      },
    });

    return { filasAfectadas: count };
  }
}

/**
 * Repositorio de AUDIT_LOG tx-bound: escribe DENTRO de la transacción (comparte el destino del
 * rollback). La transición forzada se registra con `usuario_id` poblado (origen Usuario, D-4).
 */
class AuditLogForzarInicioPrismaRepository implements AuditLogPort {
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
        entidad: registro.entidad ?? 'RESERVA',
        entidadId: registro.entidadId ?? '-',
        accion: registro.accion as AccionAudit,
        ...(datosAnteriores !== undefined ? { datosAnteriores } : {}),
        ...(datosNuevos !== undefined ? { datosNuevos } : {}),
      },
    });
  }
}

@Injectable()
export class UnidadDeTrabajoForzarInicioPrismaAdapter
  implements UnidadDeTrabajoForzarInicioPort
{
  constructor(private readonly prisma: PrismaService) {}

  async ejecutar(
    tenantId: string,
    trabajo: (repos: RepositoriosForzarInicio) => Promise<unknown>,
  ): Promise<unknown> {
    return this.prisma.$transaction(async (tx) => {
      // RLS: primera operación de la transacción (SET LOCAL app.tenant_id).
      await this.prisma.fijarTenant(tx, tenantId);
      const repos: RepositoriosForzarInicio = {
        reservas: new ReservaForzarInicioPrismaRepository(tx),
        auditoria: new AuditLogForzarInicioPrismaRepository(tx),
      };
      return trabajo(repos);
    });
  }
}
