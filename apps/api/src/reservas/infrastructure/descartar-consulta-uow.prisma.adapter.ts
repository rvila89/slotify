/**
 * Adaptador de la UNIDAD DE TRABAJO atómica del DESCARTE POR CLIENTE → 2.z (US-013 / UC-10 /
 * A17). Implementa `DescarteConsultaUoWPort`.
 *
 * Abre UN único `prisma.$transaction` bajo el contexto RLS del `tenantId` del comando
 * (`fijarTenant(tx, tenantId)` = `SET LOCAL app.tenant_id` como PRIMERA operación). Dentro de
 * esa transacción, all-or-nothing (§D-3), en este orden:
 *   1. `SELECT … FOR UPDATE` sobre la fila RESERVA (siempre) — serializa el doble descarte
 *      (RC-3) y la carrera con el barrido de TTL de US-012 (RC-1). Punto de serialización;
 *      la exclusión mutua vive SOLO en PostgreSQL (atomic-date-lock, sin locks distribuidos).
 *      `null` ⇒ RESERVA inexistente/otro tenant → `ReservaNoEncontradaDescarteError` (404).
 *   2. Re-evaluar BAJO EL LOCK la guarda de origen pura `resolverDescarteCliente`
 *      (`maquina-estados.ts`, dominio). `null` ⇒ terminal / no-origen (o carrera perdida) →
 *      `DescarteEstadoTerminalError` (409), rollback SIN efectos.
 *   3. UPDATE de la RESERVA a `2z`. Si el origen es `2d`, además `posicion_cola → NULL` y
 *      `consulta_bloqueante_id → NULL` (sale de la cola). Anexa el motivo a `notas` si viaja.
 *   4. Según el ORIGEN (tabla design.md §D-1):
 *      - `2b`/`2c`/`2v`: `SELECT … FOR UPDATE` de la fila FECHA_BLOQUEADA de (tenant, fecha) y
 *        `DELETE` — MISMA mecánica atómica que `liberarFecha()` (US-040/US-041) DENTRO de la
 *        transacción. Si además había cola apuntando a la descartada (2b/2v con cola), se marca
 *        para disparar la promoción A15 POST-COMMIT.
 *      - `2d`: decrementa en 1 la `posicion_cola` de las RESERVA en `2d` con el MISMO
 *        `consulta_bloqueante_id` y `posicion_cola > P` (cierra el hueco, patrón US-018/US-019).
 *        La bloqueante NO se toca; NO libera fecha; NO promueve.
 *      - `2a`: solo marca `2z`; sin fecha, sin cola.
 *   5. AUDIT_LOG `accion='transicion'`, `entidad='RESERVA'`, `datos_anteriores.sub_estado =
 *      <origen>`, `datos_nuevos.sub_estado='2z'` (en `2d`, `datos_nuevos` refleja la salida de
 *      cola: posicion_cola/consulta_bloqueante_id → NULL, coherente con US-014/US-018). NO
 *      duplica la traza de `liberarFecha()` (que registran sus seams) ni la de la promoción.
 * Tras el COMMIT, si el descarte era de una bloqueante con cola (2b/2v), dispara el seam
 * `PromocionColaPort.promoverPrimeroEnCola({ tenantId, fecha })` EXACTAMENTE una vez (mismo
 * patrón post-commit que `liberarFecha()`). NO se envía ningún email al cliente.
 */
import { Injectable } from '@nestjs/common';
import { AccionAudit, Prisma, SubEstadoConsulta as SubEstadoPrisma } from '@prisma/client';
import { PrismaService } from '../../shared/prisma/prisma.service';
import type { PromocionColaPort } from '../domain/liberar-fecha.service';
import {
  resolverDescarteCliente,
  type EstadoReserva,
  type SubEstadoConsulta,
} from '../domain/maquina-estados';
import {
  DescarteEstadoTerminalError,
  ReservaNoEncontradaDescarteError,
  type DescarteConsultaUoWPort,
  type DescartarConsultaComando,
  type ResultadoDescarteConsulta,
} from '../application/descartar-consulta-por-cliente.use-case';
import {
  subEstadoDominioAPrisma,
  subEstadoPrismaADominio,
  type SubEstadoConsultaPrisma,
} from './sub-estado-consulta.mapper';

/** Sub_estados con bloqueo asociado que el descarte libera (design.md §D-1). */
const SUBESTADOS_CON_BLOQUEO: ReadonlySet<SubEstadoConsulta> = new Set<SubEstadoConsulta>([
  '2b',
  '2c',
  '2v',
]);

const formatearFecha = (fecha: Date): string => fecha.toISOString().slice(0, 10);

/** Fila cruda de la RESERVA bajo `SELECT … FOR UPDATE` (columnas snake_case). */
interface FilaReservaBloqueada {
  estado: EstadoReserva;
  sub_estado: SubEstadoConsultaPrisma | null;
  fecha_evento: Date | null;
  posicion_cola: number | null;
  consulta_bloqueante_id: string | null;
  notas: string | null;
}

/** Plan de disparo post-commit de la promoción A15 (fuera de la transacción). */
interface PlanPromocionPostCommit {
  disparar: boolean;
  tenantId: string;
  fecha: Date | null;
}

@Injectable()
export class DescartarConsultaUoWPrismaAdapter implements DescarteConsultaUoWPort {
  constructor(
    private readonly prisma: PrismaService,
    private readonly promocion: PromocionColaPort,
  ) {}

  async descartar(
    comando: DescartarConsultaComando,
  ): Promise<ResultadoDescarteConsulta> {
    const { tenantId, usuarioId, reservaId, motivo } = comando;

    const { resultado, planPromocion } = await this.prisma.$transaction(
      async (tx) => {
        // (0) RLS write: fija el tenant del JWT como PRIMERA operación de la transacción.
        await this.prisma.fijarTenant(tx, tenantId);

        // (1) SELECT … FOR UPDATE de la fila RESERVA — serializa RC-1/RC-3 sobre la propia
        //     fila. NULL ⇒ inexistente o de otro tenant bajo RLS → 404.
        const filas = await tx.$queryRaw<FilaReservaBloqueada[]>(Prisma.sql`
          SELECT estado, sub_estado, fecha_evento, posicion_cola,
                 consulta_bloqueante_id, notas
          FROM reserva
          WHERE id_reserva = ${reservaId}
            AND tenant_id = ${tenantId}
          FOR UPDATE
        `);
        if (filas.length === 0) {
          throw new ReservaNoEncontradaDescarteError();
        }
        const fila = filas[0];

        // (2) Guarda de ORIGEN re-evaluada BAJO EL LOCK (dominio puro). NULL ⇒ terminal /
        //     no-origen / carrera perdida (RC-1/RC-3) → 409 sin efectos (rollback).
        const subEstadoOrigen: SubEstadoConsulta | null =
          fila.sub_estado === null
            ? null
            : subEstadoPrismaADominio(fila.sub_estado);
        const destino = resolverDescarteCliente(fila.estado, subEstadoOrigen);
        if (destino === null || subEstadoOrigen === null) {
          throw new DescarteEstadoTerminalError();
        }

        const enCola = subEstadoOrigen === '2d';
        const tieneBloqueo = SUBESTADOS_CON_BLOQUEO.has(subEstadoOrigen);

        // (3) Transición de la RESERVA a 2z (+ salida de cola si 2d) (+ notas si hay motivo).
        const notasActualizadas = motivo !== undefined && motivo !== null;
        const notasNuevas = notasActualizadas
          ? this.anexarMotivo(fila.notas, motivo as string)
          : undefined;

        await tx.reserva.update({
          where: { idReserva: reservaId },
          data: {
            subEstado: subEstadoDominioAPrisma(destino.subEstado) as SubEstadoPrisma,
            ...(enCola ? { posicionCola: null, consultaBloqueanteId: null } : {}),
            ...(notasActualizadas ? { notas: notasNuevas } : {}),
          },
        });

        // (4) Efectos por origen (tabla §D-1).
        let fechaLiberada = false;
        let reordenadas = 0;
        let hayColaBloqueante = false;

        if (tieneBloqueo && fila.fecha_evento !== null) {
          // 2b/2c/2v: liberar la FECHA_BLOQUEADA DENTRO de la tx (misma mecánica que
          // liberarFecha(): SELECT … FOR UPDATE + DELETE serializado). La UNIQUE(tenant,fecha)
          // garantiza RC-2 (no coexisten dos bloqueos activos).
          fechaLiberada = await this.liberarFechaEnTx(tx, tenantId, fila.fecha_evento);
          // ¿Había cola apuntando a la descartada? (2b/2v con cola → promoción A15).
          hayColaBloqueante = await this.hayColaApuntando(tx, tenantId, reservaId);
        }

        if (enCola && fila.posicion_cola !== null) {
          // 2d: decrementar la cola de la MISMA bloqueante para cerrar el hueco.
          reordenadas = await this.decrementarCola(
            tx,
            tenantId,
            fila.consulta_bloqueante_id,
            fila.posicion_cola,
          );
        }

        // (5) AUDIT_LOG de la transición (origen Gestor). No duplica liberarFecha()/promoción.
        await tx.auditLog.create({
          data: {
            tenantId,
            usuarioId: usuarioId ?? null,
            entidad: 'RESERVA',
            entidadId: reservaId,
            accion: AccionAudit.transicion,
            datosAnteriores: {
              sub_estado: subEstadoOrigen,
            } as Prisma.InputJsonValue,
            datosNuevos: {
              sub_estado: destino.subEstado,
              origen: 'descarte_cliente',
              ...(enCola
                ? { posicion_cola: null, consulta_bloqueante_id: null }
                : {}),
            } as Prisma.InputJsonValue,
          },
        });

        const resultadoDescarte: ResultadoDescarteConsulta = {
          reservaId,
          subEstadoAnterior: subEstadoOrigen,
          subEstadoNuevo: destino.subEstado,
          fechaLiberada,
          // La promoción se dispara POST-COMMIT; el flag refleja SI corresponde dispararla.
          promocionDisparada: hayColaBloqueante,
          reordenadas,
          notasActualizadas,
        };

        const planPromocion: PlanPromocionPostCommit = {
          disparar: hayColaBloqueante,
          tenantId,
          fecha: fila.fecha_evento,
        };

        return { resultado: resultadoDescarte, planPromocion };
      },
    );

    // Post-commit: dispara la promoción A15 EXACTAMENTE una vez (2b/2v con cola), mismo patrón
    // que liberarFecha(). Su transacción/auditoría propias las gestiona el seam.
    if (planPromocion.disparar && planPromocion.fecha !== null) {
      await this.promocion.promoverPrimeroEnCola({
        tenantId: planPromocion.tenantId,
        fecha: planPromocion.fecha,
      });
    }

    return resultado;
  }

  /**
   * Anexa el motivo a las notas previas (design.md §D-5, Gate: APPEND, no sobrescritura):
   * `notas_previas + "\n[descarte cliente] " + motivo`. Sin notas previas, arranca con la
   * marca. Preserva el historial operativo.
   */
  private anexarMotivo(notasPrevias: string | null, motivo: string): string {
    const marca = `[descarte cliente] ${motivo}`;
    return notasPrevias !== null && notasPrevias.length > 0
      ? `${notasPrevias}\n${marca}`
      : marca;
  }

  /**
   * Liberación atómica de FECHA_BLOQUEADA DENTRO de la transacción del descarte (misma mecánica
   * que `liberarFecha()`, US-041 §D-1): `SELECT … FOR UPDATE` + `DELETE` de (tenant, fecha).
   * Devuelve `true` si eliminó una fila. RC-2 lo garantiza `UNIQUE(tenant_id, fecha)`.
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
   * ¿Hay cola activa (`2d`) apuntando a la RESERVA descartada como bloqueante? (2b/2v con cola
   * → promoción A15). Bajo el lock de la transacción del descarte.
   */
  private async hayColaApuntando(
    tx: Prisma.TransactionClient,
    tenantId: string,
    reservaBloqueanteId: string,
  ): Promise<boolean> {
    const count = await tx.reserva.count({
      where: {
        tenantId,
        subEstado: SubEstadoPrisma.s2d,
        consultaBloqueanteId: reservaBloqueanteId,
      },
    });
    return count > 0;
  }

  /**
   * Decremento de la cola de `2d` al descartar una posición intermedia (design.md §D-1, patrón
   * US-018/US-019): resta 1 a la `posicion_cola` de todas las RESERVA en `2d` con el mismo
   * `consulta_bloqueante_id` y `posicion_cola > P`, para cerrar el hueco preservando la
   * `UNIQUE(tenant_id, consulta_bloqueante_id, posicion_cola)`. Devuelve las filas reordenadas.
   * El `UPDATE … posicion_cola = posicion_cola - 1` en bloque es seguro: las posiciones
   * mayores que P se desplazan en orden y la contigüidad se preserva (nunca colisionan con P,
   * ya liberado por la salida de la descartada).
   */
  private async decrementarCola(
    tx: Prisma.TransactionClient,
    tenantId: string,
    consultaBloqueanteId: string | null,
    posicion: number,
  ): Promise<number> {
    if (consultaBloqueanteId === null) {
      return 0;
    }
    const afectadas = await tx.$executeRaw`
      UPDATE reserva
      SET posicion_cola = posicion_cola - 1
      WHERE tenant_id = ${tenantId}
        AND sub_estado = 's2d'
        AND consulta_bloqueante_id = ${consultaBloqueanteId}
        AND posicion_cola > ${posicion}
    `;
    return Number(afectadas);
  }
}
