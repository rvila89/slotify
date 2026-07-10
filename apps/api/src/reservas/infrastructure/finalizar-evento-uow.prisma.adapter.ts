/**
 * Adaptador de la UNIDAD DE TRABAJO atómica de la FINALIZACIÓN MANUAL del evento
 * (US-034 / UC-25, §D-2/§D-8/§D-9). Implementa `UnidadDeTrabajoFinalizacionPort`.
 *
 * Abre UN único `prisma.$transaction` bajo el contexto RLS del `tenantId` del Gestor
 * (`fijarTenant(tx, tenantId)` = `SET LOCAL app.tenant_id` como PRIMERA operación) y expone
 * los repositorios tx-bound. La transición + el AUDIT_LOG (transición + alerta de dato
 * anómalo) viven DENTRO de esa transacción (all-or-nothing).
 *
 * SERIALIZACIÓN (D-8, sin locks distribuidos — hook `no-distributed-lock`): `finalizarEvento`
 * toma `SELECT … FOR UPDATE` sobre la fila RESERVA (serializa la doble finalización
 * concurrente) y aplica un `UPDATE … WHERE estado = estadoOrigen` que devuelve las filas
 * afectadas. La segunda petición concurrente queda a la espera del lock; al liberarse, re-lee
 * `estado = post_evento`, su UPDATE afecta 0 filas y el use-case lo traduce a conflicto. La
 * exclusión mutua vive SOLO en PostgreSQL sobre la propia fila RESERVA (NO se toca
 * FECHA_BLOQUEADA ni la cola).
 */
import { Injectable } from '@nestjs/common';
import { AccionAudit, EstadoReserva, Prisma } from '@prisma/client';
import { PrismaService } from '../../shared/prisma/prisma.service';
import type {
  AuditLogPort,
  RegistroAuditoria,
} from '../../shared/audit/audit-log.port';
import type {
  MutacionFinalizacionParams,
  MutacionFinalizacionResultado,
  RepositoriosFinalizacion,
  UnidadDeTrabajoFinalizacionPort,
} from '../application/finalizar-evento.use-case';

/** Fila cruda del `SELECT … FOR UPDATE` sobre la RESERVA (solo el estado bajo lock). */
interface FilaReservaBloqueada {
  estado: EstadoReserva;
}

/**
 * Repositorio de RESERVA tx-bound: `SELECT … FOR UPDATE` de la fila (serialización) y
 * `UPDATE … WHERE estado = estadoOrigen` con la marca de NPS programada (D-6). Devuelve las
 * filas afectadas (`0` ⇒ bajo el lock el estado ya no era el de origen: carrera perdida).
 */
class ReservaFinalizacionPrismaRepository {
  constructor(private readonly tx: Prisma.TransactionClient) {}

  async finalizarEvento(
    params: MutacionFinalizacionParams,
  ): Promise<MutacionFinalizacionResultado> {
    // (1) SELECT … FOR UPDATE: serializa la doble finalización sobre la propia fila
    //     RESERVA (sin locks distribuidos). La segunda petición espera aquí.
    await this.tx.$queryRaw<FilaReservaBloqueada[]>(Prisma.sql`
      SELECT estado
      FROM reserva
      WHERE id_reserva = ${params.reservaId}
        AND tenant_id = ${params.tenantId}
      FOR UPDATE
    `);

    // (2) UPDATE condicional por el estado de origen: bajo el lock, exactamente una gana.
    //     La marca de NPS programada (D-6) NO introduce esquema nuevo: es una marca
    //     derivada del paso a post_evento; se refleja en el AUDIT_LOG de la transición.
    const { count } = await this.tx.reserva.updateMany({
      where: {
        idReserva: params.reservaId,
        tenantId: params.tenantId,
        estado: params.estadoOrigen as EstadoReserva,
      },
      // US-037 (D-2=A): sella `fecha_post_evento` con el instante de la transición, en la MISMA
      // UPDATE que fija `estado = post_evento` (fuente de verdad del reloj T+7d del archivado).
      data: {
        estado: params.estadoDestino as EstadoReserva,
        fechaPostEvento: params.fechaPostEvento,
      },
    });

    return { filasAfectadas: count };
  }
}

/**
 * Repositorio de AUDIT_LOG tx-bound: escribe DENTRO de la transacción (comparte el destino
 * del rollback). La transición se registra con `usuario_id` poblado (origen Usuario, D-5).
 */
class AuditLogFinalizacionPrismaRepository implements AuditLogPort {
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
export class UnidadDeTrabajoFinalizacionPrismaAdapter
  implements UnidadDeTrabajoFinalizacionPort
{
  constructor(private readonly prisma: PrismaService) {}

  async ejecutar(
    tenantId: string,
    trabajo: (repos: RepositoriosFinalizacion) => Promise<unknown>,
  ): Promise<unknown> {
    return this.prisma.$transaction(async (tx) => {
      // RLS: primera operación de la transacción (SET LOCAL app.tenant_id).
      await this.prisma.fijarTenant(tx, tenantId);
      const repos: RepositoriosFinalizacion = {
        reservas: new ReservaFinalizacionPrismaRepository(tx),
        auditoria: new AuditLogFinalizacionPrismaRepository(tx),
      };
      return trabajo(repos);
    });
  }
}
