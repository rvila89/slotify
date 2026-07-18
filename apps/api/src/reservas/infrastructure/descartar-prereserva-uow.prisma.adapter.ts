/**
 * Adaptador de la UNIDAD DE TRABAJO atómica del DESCARTE DE PRE-RESERVA →
 * `reserva_cancelada` (change `presupuesto-prereserva-cta-descarte-y-e2`, workstream B).
 * Implementa `DescartePreReservaUoWPort`. Modelado sobre `descartar-consulta-uow.prisma.adapter.ts`
 * (US-013).
 *
 * Abre UN único `prisma.$transaction` bajo el contexto RLS del `tenantId` del comando
 * (`fijarTenant(tx, tenantId)` = `SET LOCAL app.tenant_id` como PRIMERA operación). Dentro de
 * esa transacción, all-or-nothing:
 *   1. `SELECT … FOR UPDATE` sobre la fila RESERVA — serializa el doble descarte (C-1) y la
 *      carrera con el barrido de TTL de US-012. Punto de serialización; la exclusión mutua vive
 *      SOLO en PostgreSQL (atomic-date-lock, sin locks distribuidos). `null` ⇒ RESERVA
 *      inexistente/otro tenant → `ReservaNoEncontradaError` (404).
 *   2. Re-evaluar BAJO EL LOCK la guarda de origen pura `esOrigenValidoParaDescartarPreReserva`
 *      (`maquina-estados.ts`, dominio). Origen distinto de `pre_reserva`:
 *        - estado terminal (`reserva_cancelada`/`reserva_completada`) o carrera perdida →
 *          `DescartePreReservaEstadoTerminalError` (409), rollback SIN efectos.
 *        - `consulta`/`reserva_confirmada`/posteriores → `DescartePreReservaOrigenInvalidoError`
 *          (422). (En la práctica el orquestador ya filtró estos estados; la re-guarda cubre la
 *          carrera y el acceso directo a la UoW.)
 *   3. UPDATE de la RESERVA a `reserva_cancelada`, `sub_estado = NULL`, `ttl_expiracion = NULL`.
 *   4. `liberarFecha()` DENTRO de la tx (misma mecánica que US-041: `SELECT … FOR UPDATE` de la
 *      fila FECHA_BLOQUEADA de (tenant, fecha) + `DELETE`). Si había cola apuntando a la
 *      descartada, se marca para disparar la promoción A15 POST-COMMIT.
 *   5. AUDIT_LOG `accion='transicion'`, `entidad='RESERVA'`, `datos_anteriores.estado =
 *      'pre_reserva'`, `datos_nuevos.estado='reserva_cancelada'` + `motivo` opcional. NO duplica
 *      la traza de `liberarFecha()` ni la de la promoción.
 * Tras el COMMIT, si había cola, dispara el seam `PromocionColaPort.promoverPrimeroEnCola`
 * EXACTAMENTE una vez (mismo patrón post-commit que US-013). NO se envía ningún email.
 */
import { Injectable } from '@nestjs/common';
import { AccionAudit, EstadoReserva as EstadoReservaPrisma, Prisma } from '@prisma/client';
import { PrismaService } from '../../shared/prisma/prisma.service';
import type { PromocionColaPort } from '../domain/liberar-fecha.service';
import {
  esOrigenValidoParaDescartarPreReserva,
  type EstadoReserva,
} from '../domain/maquina-estados';
import {
  DescartePreReservaEstadoTerminalError,
  DescartePreReservaOrigenInvalidoError,
  ReservaNoEncontradaError,
  type DescartarPreReservaComando,
  type DescartePreReservaUoWPort,
  type ResultadoDescartePreReserva,
} from '../application/descartar-prereserva.use-case';

/** Estados TERMINALES: una carrera perdida / reserva ya cerrada → 409 (no 422). */
const ESTADOS_TERMINALES: ReadonlySet<EstadoReserva> = new Set<EstadoReserva>([
  'reserva_cancelada',
  'reserva_completada',
]);

const formatearFecha = (fecha: Date): string => fecha.toISOString().slice(0, 10);

/** Fila cruda de la RESERVA bajo `SELECT … FOR UPDATE` (columnas snake_case). */
interface FilaReservaBloqueada {
  estado: EstadoReserva;
  sub_estado: string | null;
  fecha_evento: Date | null;
}

/** Plan de disparo post-commit de la promoción A15 (fuera de la transacción). */
interface PlanPromocionPostCommit {
  disparar: boolean;
  tenantId: string;
  fecha: Date | null;
}

@Injectable()
export class DescartarPreReservaUoWPrismaAdapter implements DescartePreReservaUoWPort {
  constructor(
    private readonly prisma: PrismaService,
    private readonly promocion: PromocionColaPort,
  ) {}

  async descartar(
    comando: DescartarPreReservaComando,
  ): Promise<ResultadoDescartePreReserva> {
    const { tenantId, usuarioId, reservaId, motivo } = comando;

    const { resultado, planPromocion } = await this.prisma.$transaction(
      async (tx) => {
        // (0) RLS write: fija el tenant del JWT como PRIMERA operación de la transacción.
        await this.prisma.fijarTenant(tx, tenantId);

        // (1) SELECT … FOR UPDATE de la fila RESERVA — serializa C-1 sobre la propia fila.
        //     NULL ⇒ inexistente o de otro tenant bajo RLS → 404.
        const filas = await tx.$queryRaw<FilaReservaBloqueada[]>(Prisma.sql`
          SELECT estado, sub_estado, fecha_evento
          FROM reserva
          WHERE id_reserva = ${reservaId}
            AND tenant_id = ${tenantId}
          FOR UPDATE
        `);
        if (filas.length === 0) {
          throw new ReservaNoEncontradaError();
        }
        const fila = filas[0];

        // (2) Guarda de ORIGEN re-evaluada BAJO EL LOCK (dominio puro). Distinto de
        //     `pre_reserva`: terminal / carrera → 409; el resto → 422. Rollback sin efectos.
        if (!esOrigenValidoParaDescartarPreReserva(fila.estado, null)) {
          if (ESTADOS_TERMINALES.has(fila.estado)) {
            throw new DescartePreReservaEstadoTerminalError();
          }
          throw new DescartePreReservaOrigenInvalidoError();
        }

        // (3) Transición de la RESERVA a reserva_cancelada (sub_estado NULL, ttl NULL).
        await tx.reserva.update({
          where: { idReserva: reservaId },
          data: {
            estado: EstadoReservaPrisma.reserva_cancelada,
            subEstado: null,
            ttlExpiracion: null,
          },
        });

        // (4) Liberar la FECHA_BLOQUEADA DENTRO de la tx (misma mecánica que liberarFecha()).
        let fechaLiberada = false;
        let hayColaBloqueante = false;
        if (fila.fecha_evento !== null) {
          fechaLiberada = await this.liberarFechaEnTx(tx, tenantId, fila.fecha_evento);
          hayColaBloqueante = await this.hayColaApuntando(tx, tenantId, reservaId);
        }

        // (5) AUDIT_LOG de la transición (origen Gestor) + motivo opcional en datos_nuevos.
        const motivoAuditado = motivo !== undefined && motivo !== null;
        await tx.auditLog.create({
          data: {
            tenantId,
            usuarioId: usuarioId ?? null,
            entidad: 'RESERVA',
            entidadId: reservaId,
            accion: AccionAudit.transicion,
            datosAnteriores: {
              estado: 'pre_reserva',
            } as Prisma.InputJsonValue,
            datosNuevos: {
              estado: 'reserva_cancelada',
              origen: 'descarte_prereserva',
              ...(motivoAuditado ? { motivo } : {}),
            } as Prisma.InputJsonValue,
          },
        });

        const resultadoDescarte: ResultadoDescartePreReserva = {
          reservaId,
          estadoAnterior: 'pre_reserva',
          estadoNuevo: 'reserva_cancelada',
          fechaLiberada,
          // La promoción se dispara POST-COMMIT; el flag refleja SI corresponde dispararla.
          promocionDisparada: hayColaBloqueante,
          motivoAuditado,
        };

        const planPromocion: PlanPromocionPostCommit = {
          disparar: hayColaBloqueante,
          tenantId,
          fecha: fila.fecha_evento,
        };

        return { resultado: resultadoDescarte, planPromocion };
      },
    );

    // Post-commit: dispara la promoción A15 EXACTAMENTE una vez (había cola), mismo patrón que
    // liberarFecha() / US-013. Su transacción/auditoría propias las gestiona el seam.
    if (planPromocion.disparar && planPromocion.fecha !== null) {
      await this.promocion.promoverPrimeroEnCola({
        tenantId: planPromocion.tenantId,
        fecha: planPromocion.fecha,
      });
    }

    return resultado;
  }

  /**
   * Liberación atómica de FECHA_BLOQUEADA DENTRO de la transacción del descarte (misma mecánica
   * que `liberarFecha()`, US-041 §D-1): `SELECT … FOR UPDATE` + `DELETE` de (tenant, fecha).
   * Devuelve `true` si eliminó una fila. La `UNIQUE(tenant_id, fecha)` garantiza que no coexisten
   * dos bloqueos activos.
   */
  private async liberarFechaEnTx(
    tx: Prisma.TransactionClient,
    tenantId: string,
    fecha: Date,
  ): Promise<boolean> {
    const fechaIso = formatearFecha(fecha);
    await tx.$queryRaw`
      SELECT id_bloqueo FROM fecha_bloqueada
      WHERE tenant_id = ${tenantId} AND fecha = ${fechaIso}::date
      FOR UPDATE
    `;
    const filasAfectadas = await tx.$executeRaw`
      DELETE FROM fecha_bloqueada
      WHERE tenant_id = ${tenantId} AND fecha = ${fechaIso}::date
    `;
    return filasAfectadas > 0;
  }

  /**
   * ¿Hay cola activa (`2d`) apuntando a la pre-reserva descartada como bloqueante? (→ promoción
   * A15). Bajo el lock de la transacción del descarte.
   */
  private async hayColaApuntando(
    tx: Prisma.TransactionClient,
    tenantId: string,
    reservaBloqueanteId: string,
  ): Promise<boolean> {
    const count = await tx.reserva.count({
      where: {
        tenantId,
        subEstado: 's2d',
        consultaBloqueanteId: reservaBloqueanteId,
      },
    });
    return count > 0;
  }
}
