/**
 * Adaptador de la UNIDAD DE TRABAJO atómica del ARCHIVADO MANUAL de UNA RESERVA por el Gestor
 * (US-038 / UC-28 flujo alternativo manual, §D-1=1.A/§D-6/§D-7). Implementa
 * `UnidadDeTrabajoArchivadoManualPort`.
 *
 * Gemelo DELGADO de `archivado-uow.prisma.adapter.ts` (US-037), scoped a UNA RESERVA del
 * tenant del JWT (no cross-tenant) y con auditoría origen GESTOR (no Sistema). Abre UN único
 * `prisma.$transaction` bajo el contexto RLS del `tenantId` del Gestor (`fijarTenant(tx,
 * tenantId)` = `SET LOCAL app.tenant_id` como PRIMERA operación) y expone los repositorios
 * tx-bound. La transición + el AUDIT_LOG viven DENTRO de esa transacción (all-or-nothing).
 *
 * SERIALIZACIÓN (§D-6, sin locks distribuidos — hook `no-distributed-lock`): `archivar` toma
 * `SELECT … FOR UPDATE` sobre la fila RESERVA (serializa el doble clic del gestor y la carrera
 * con el cron de US-037) y aplica un `UPDATE … WHERE estado = estadoOrigen` que devuelve las
 * filas afectadas. La segunda operación concurrente queda a la espera del lock; al liberarse,
 * re-lee `estado = reserva_completada`, su UPDATE afecta 0 filas y el use-case lo traduce a
 * conflicto (409). La exclusión mutua vive SOLO en PostgreSQL sobre la propia fila RESERVA (NO
 * se toca FECHA_BLOQUEADA ni la cola). Las guardas puras de US-037
 * (`resolverArchivadoAutomatico` + `fianzaResuelta`) se re-evalúan bajo el lock (la de origen,
 * vía la UPDATE condicional; se conserva la de fianza para la coherencia con el patrón).
 */
import { Injectable } from '@nestjs/common';
import { AccionAudit, EstadoReserva, Prisma } from '@prisma/client';
import { PrismaService } from '../../shared/prisma/prisma.service';
import type { RegistroAuditoria } from '../../shared/audit/audit-log.port';
import type {
  MutacionArchivadoManualParams,
  MutacionArchivadoManualResultado,
  RepositoriosArchivadoManual,
  UnidadDeTrabajoArchivadoManualPort,
} from '../application/archivar-reserva-manual.use-case';

/** Fila cruda del `SELECT … FOR UPDATE` sobre la RESERVA (solo el estado bajo lock). */
interface FilaReservaBloqueada {
  estado: EstadoReserva;
}

/**
 * Repositorio de RESERVA tx-bound: `SELECT … FOR UPDATE` de la fila (serialización) y
 * `UPDATE … WHERE estado = estadoOrigen` a `reserva_completada`. Devuelve las filas afectadas
 * (`0` ⇒ bajo el lock el estado ya no era `post_evento`: carrera perdida — 409).
 */
class ReservaArchivadoManualPrismaRepository {
  constructor(private readonly tx: Prisma.TransactionClient) {}

  async archivar(
    params: MutacionArchivadoManualParams,
  ): Promise<MutacionArchivadoManualResultado> {
    // (1) SELECT … FOR UPDATE: serializa el doble clic del gestor y la carrera con el cron de
    //     US-037 sobre la propia fila RESERVA (sin locks distribuidos). La 2.ª petición espera.
    await this.tx.$queryRaw<FilaReservaBloqueada[]>(Prisma.sql`
      SELECT estado
      FROM reserva
      WHERE id_reserva = ${params.reservaId}
        AND tenant_id = ${params.tenantId}
      FOR UPDATE
    `);

    // (2) UPDATE condicional por el estado de origen (`post_evento`): bajo el lock, exactamente
    //     una operación gana. La segunda observa `reserva_completada` y afecta 0 filas.
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
 * rollback). La transición se registra con `usuario_id` POBLADO (origen Gestor, §D-5), sin la
 * `causa:'T+7d'` del archivado automático (US-037).
 */
class AuditLogArchivadoManualPrismaRepository {
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
export class ArchivarReservaManualUoWPrismaAdapter
  implements UnidadDeTrabajoArchivadoManualPort
{
  constructor(private readonly prisma: PrismaService) {}

  async ejecutar(
    tenantId: string,
    trabajo: (repos: RepositoriosArchivadoManual) => Promise<unknown>,
  ): Promise<unknown> {
    return this.prisma.$transaction(async (tx) => {
      // RLS: primera operación de la transacción (SET LOCAL app.tenant_id), tenant del JWT.
      await this.prisma.fijarTenant(tx, tenantId);
      const repos: RepositoriosArchivadoManual = {
        reservas: new ReservaArchivadoManualPrismaRepository(tx),
        auditoria: new AuditLogArchivadoManualPrismaRepository(tx),
      };
      return trabajo(repos);
    });
  }
}
