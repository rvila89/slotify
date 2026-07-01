/**
 * Adaptador de la UNIDAD DE TRABAJO atómica de EXPIRACIÓN por TTL de UNA RESERVA
 * (US-012 / UC-09, §D-3/§D-4/§D-6/§D-9). Implementa `ExpiracionReservaPort`.
 *
 * Por cada RESERVA candidata abre UN único `prisma.$transaction` bajo el contexto RLS
 * del `tenantId` de LA candidata (`SET LOCAL app.tenant_id` como PRIMERA operación,
 * D-6: cross-tenant read en el adaptador de candidatas, RLS write aquí). Dentro de esa
 * transacción, all-or-nothing:
 *   1. `SELECT … FOR UPDATE` sobre la fila bloqueante de `FECHA_BLOQUEADA` (o, si ya
 *      no hay fila —expiración parcial—, sobre la RESERVA) → punto de SERIALIZACIÓN
 *      (RC-1/RC-2/RC-3). La exclusión mutua vive SOLO en PostgreSQL (atomic-date-lock);
 *      NADA de Redis/locks distribuidos.
 *   2. RE-LECTURA del estado/sub_estado de la RESERVA bajo el lock y RE-EVALUACIÓN de
 *      la guarda de origen declarativa `resolverExpiracionTtl` + del INSTANTE del TTL
 *      (`ttl_expiracion < now()`, D-7). Si ya no es candidata (otra TX la expiró, o
 *      US-006 extendió el TTL) → no muta nada, `expirada=false` (idempotencia + RC-1/2).
 *   3. UPDATE de la RESERVA al estado terminal resuelto (`2x` / `reserva_cancelada`
 *      con sub_estado NULL).
 *   4. Liberación IDEMPOTENTE de `FECHA_BLOQUEADA` (DELETE devolviendo rows-affected;
 *      0 filas = éxito silencioso, US-041) EN LA MISMA TRANSACCIÓN que la transición.
 *   5. AUDIT_LOG de la TRANSICIÓN (`accion='transicion'`, `entidad='RESERVA'`) y de la
 *      LIBERACIÓN (`accion='eliminar'`, `entidad='FECHA_BLOQUEADA'`, causa `TTL`), sin
 *      duplicar (D-9). Deja constancia para la ALERTA INTERNA al gestor (D-10), sin
 *      email al cliente (fuera de MVP).
 *
 * Tras el COMMIT, si el DELETE afectó a 1 fila y hay cola activa apuntando a la RESERVA
 * liberada, dispara el seam `PromocionColaPort.promoverPrimeroEnCola()` EXACTAMENTE una
 * vez (D-8: solo el trigger; la reordenación FIFO/re-bloqueo A15 es de US-018).
 */
import { Injectable } from '@nestjs/common';
import { AccionAudit, Prisma, SubEstadoConsulta } from '@prisma/client';
import { PrismaService } from '../../shared/prisma/prisma.service';
import type {
  ExpiracionReservaPort,
  ReservaCandidata,
  ResultadoExpiracionReserva,
} from '../application/expirar-consultas-vencidas.service';
import type { PromocionColaPort } from '../domain/liberar-fecha.service';
import {
  resolverExpiracionTtl,
  type EstadoReserva as EstadoReservaDominio,
  type SubEstadoConsulta as SubEstadoConsultaDominio,
} from '../domain/maquina-estados';
import {
  subEstadoDominioAPrisma,
  subEstadoPrismaADominio,
  type SubEstadoConsultaPrisma,
} from './sub-estado-consulta.mapper';

const formatearFecha = (fecha: Date): string => fecha.toISOString().slice(0, 10);

/** Fila cruda del `SELECT … FOR UPDATE` sobre la RESERVA (columnas snake_case). */
interface FilaReservaBloqueada {
  estado: EstadoReservaDominio;
  sub_estado: SubEstadoConsultaPrisma | null;
  ttl_expiracion: Date | null;
}

@Injectable()
export class ExpiracionReservaUoWPrismaAdapter implements ExpiracionReservaPort {
  constructor(
    private readonly prisma: PrismaService,
    private readonly promocion: PromocionColaPort,
  ) {}

  async expirarReserva(
    candidata: ReservaCandidata,
  ): Promise<ResultadoExpiracionReserva> {
    const noExpirada = (): ResultadoExpiracionReserva => ({
      reservaId: candidata.reservaId,
      expirada: false,
      estadoFinal: candidata.estado,
      subEstadoFinal: candidata.subEstado,
      fechaLiberada: false,
      promocionDisparada: false,
    });

    // ---- Transacción ATÓMICA por RESERVA bajo el contexto RLS de SU tenant. ----
    const resultadoTx = await this.prisma.$transaction(async (tx) => {
      // RLS write (D-6): fija el tenant de la candidata como PRIMERA operación.
      await this.prisma.fijarTenant(tx, candidata.tenantId);

      // (1) SELECT … FOR UPDATE de la RESERVA: serializa la transición frente a un
      // segundo barrido (RC-1) y a la extensión de US-006 (RC-2), que bloquea la
      // fila bloqueante de esa misma fecha. Bloqueamos la RESERVA (siempre existe,
      // incluso en expiración parcial sin FECHA_BLOQUEADA).
      const filas = await tx.$queryRaw<FilaReservaBloqueada[]>(Prisma.sql`
        SELECT estado, sub_estado, ttl_expiracion
        FROM reserva
        WHERE id_reserva = ${candidata.reservaId}
          AND tenant_id = ${candidata.tenantId}
        FOR UPDATE
      `);
      if (filas.length === 0) {
        return { expirada: false as const };
      }
      const fila = filas[0];

      // Además, tomar el lock sobre la fila bloqueante de la fecha (si existe): es el
      // punto de serialización compartido con la extensión de US-006 y el nuevo
      // bloqueo (RC-2/RC-3). No falla si no hay fila (expiración parcial).
      const fechaIso = formatearFecha(candidata.fecha);
      await tx.$queryRaw(Prisma.sql`
        SELECT id_bloqueo FROM fecha_bloqueada
        WHERE tenant_id = ${candidata.tenantId} AND fecha = ${fechaIso}::date
        FOR UPDATE
      `);

      // (2) RE-EVALUACIÓN bajo lock: guarda de origen declarativa + INSTANTE del TTL.
      const estado = fila.estado;
      const subEstado: SubEstadoConsultaDominio | null =
        fila.sub_estado === null ? null : subEstadoPrismaADominio(fila.sub_estado);
      const destino = resolverExpiracionTtl(estado, subEstado);
      const ttl = fila.ttl_expiracion;
      // Comparación por INSTANTE (`timestamptz`), nunca por fecha formateada (D-7).
      const vencido = ttl !== null && ttl.getTime() < Date.now();
      if (destino === null || !vencido) {
        // Ya no es candidata (idempotencia / TTL extendido US-006): no muta nada.
        return { expirada: false as const };
      }

      // (3) UPDATE de la RESERVA al estado terminal resuelto.
      await tx.reserva.update({
        where: { idReserva: candidata.reservaId },
        data: {
          estado: destino.estado,
          subEstado:
            destino.subEstado === null
              ? null
              : (subEstadoDominioAPrisma(destino.subEstado) as SubEstadoConsulta),
        },
      });

      // (4) Liberación IDEMPOTENTE de FECHA_BLOQUEADA en la MISMA transacción
      // (DELETE devolviendo rows-affected; 0 filas = éxito silencioso, US-041).
      const filasFecha = await tx.$queryRaw<{ reserva_id: string }[]>(Prisma.sql`
        SELECT reserva_id FROM fecha_bloqueada
        WHERE tenant_id = ${candidata.tenantId} AND fecha = ${fechaIso}::date
        FOR UPDATE
      `);
      const reservaIdLiberada =
        filasFecha.length > 0 ? filasFecha[0].reserva_id : null;
      const filasAfectadas = await tx.$executeRaw(Prisma.sql`
        DELETE FROM fecha_bloqueada
        WHERE tenant_id = ${candidata.tenantId} AND fecha = ${fechaIso}::date
      `);
      const fechaLiberada = filasAfectadas > 0;

      // (5) AUDIT_LOG de la TRANSICIÓN (accion='transicion', entidad='RESERVA'), en la
      // misma transacción. Deja constancia para la ALERTA INTERNA al gestor (D-10).
      await tx.auditLog.create({
        data: {
          tenantId: candidata.tenantId,
          entidad: 'RESERVA',
          entidadId: candidata.reservaId,
          accion: AccionAudit.transicion,
          datosAnteriores: {
            estado,
            subEstado,
          } as Prisma.InputJsonValue,
          datosNuevos: {
            estado: destino.estado,
            subEstado: destino.subEstado,
            causa: 'TTL',
            alertaInterna: 'Consulta expirada. Fecha liberada.',
          } as Prisma.InputJsonValue,
        },
      });

      // AUDIT_LOG de la LIBERACIÓN (accion='eliminar', entidad='FECHA_BLOQUEADA',
      // causa TTL), solo si el DELETE afectó a una fila (semántica de US-041, sin
      // duplicar). En expiración parcial (0 filas) no se audita la liberación.
      if (fechaLiberada) {
        await tx.auditLog.create({
          data: {
            tenantId: candidata.tenantId,
            entidad: 'FECHA_BLOQUEADA',
            entidadId: reservaIdLiberada ?? fechaIso,
            accion: AccionAudit.eliminar,
            datosNuevos: {
              causa: 'TTL',
              resultado: 'liberada',
              fecha: fechaIso,
              reservaId: reservaIdLiberada,
            } as Prisma.InputJsonValue,
          },
        });
      }

      return {
        expirada: true as const,
        estadoFinal: destino.estado,
        subEstadoFinal: destino.subEstado,
        fechaLiberada,
        reservaIdLiberada,
      };
    });

    if (!resultadoTx.expirada) {
      return noExpirada();
    }

    // ---- POST-COMMIT: disparo del seam de promoción EXACTAMENTE una vez (D-8). ----
    // Solo si el DELETE liberó una fila y hay cola activa apuntando a la reserva
    // liberada. La reordenación FIFO/re-bloqueo (A15) es de US-018 (stub no-op).
    let promocionDisparada = false;
    if (resultadoTx.fechaLiberada && resultadoTx.reservaIdLiberada !== null) {
      const enCola = await this.prisma.$transaction(async (tx) => {
        await this.prisma.fijarTenant(tx, candidata.tenantId);
        return tx.reserva.count({
          where: {
            tenantId: candidata.tenantId,
            subEstado: SubEstadoConsulta.s2d,
            consultaBloqueanteId: resultadoTx.reservaIdLiberada as string,
          },
        });
      });
      if (enCola > 0) {
        await this.promocion.promoverPrimeroEnCola({
          tenantId: candidata.tenantId,
          fecha: candidata.fecha,
        });
        promocionDisparada = true;
      }
    }

    return {
      reservaId: candidata.reservaId,
      expirada: true,
      estadoFinal: resultadoTx.estadoFinal,
      subEstadoFinal: resultadoTx.subEstadoFinal,
      fechaLiberada: resultadoTx.fechaLiberada,
      promocionDisparada,
    };
  }
}
