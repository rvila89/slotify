/**
 * Adaptador de la UNIDAD DE TRABAJO atómica del ARCHIVADO AUTOMÁTICO de UNA RESERVA en T+7d
 * (US-037 / UC-28, §D-6/§D-7/§D-8). Implementa `ArchivadoPort`.
 *
 * Por cada RESERVA candidata abre UN único `prisma.$transaction` bajo el contexto RLS del
 * `tenantId` de LA candidata (`fijarTenant(tx, tenantId)` = `SET LOCAL app.tenant_id` como
 * PRIMERA operación, D-8: cross-tenant read en el adaptador de candidatas, RLS write aquí).
 * Dentro de esa transacción, all-or-nothing:
 *   1. `SELECT … FOR UPDATE` de la fila RESERVA: serializa la transición frente a un segundo
 *      barrido (RC-1) y al gestor US-038 (RC-2, simulado hasta que aterrice). La exclusión
 *      mutua vive SOLO en PostgreSQL (sin Redis/locks distribuidos, hook
 *      `no-distributed-lock`). Re-lee `estado`, `sub_estado`, `fianza_status` y `fianza_eur`.
 *   2. RE-EVALUACIÓN bajo lock de la guarda de ORIGEN declarativa `resolverArchivadoAutomatico`:
 *      si el destino es `null` (ya `reserva_completada`, por otro pase o por el gestor
 *      US-038) → no muta nada, `archivada = false`, `fianzaPendiente = false` (idempotencia
 *      / RC — la UPDATE que no se ejecuta ≡ 0 filas afectadas).
 *   3. RE-EVALUACIÓN de la guarda de FIANZA (`fianzaResuelta`) en la misma lectura de la
 *      fila: si NO está resuelta → no muta, `archivada = false`, `fianzaPendiente = true`
 *      (el use-case decide emitir la alerta FA-01).
 *   4. Si origen válido Y fianza resuelta: `RESERVA.estado → reserva_completada` + AUDIT_LOG
 *      de la TRANSICIÓN (`accion='transicion'`, `entidad='RESERVA'`), origen Sistema
 *      (`usuario_id` NO poblado → null), `datos_anteriores={estado:post_evento}`,
 *      `datos_nuevos={estado:reserva_completada, causa:'T+7d'}`. Exactamente 1 entrada por
 *      archivado efectivo (D-7); sin duplicar.
 */
import { Injectable } from '@nestjs/common';
import { AccionAudit, Prisma } from '@prisma/client';
import { PrismaService } from '../../shared/prisma/prisma.service';
import type {
  ArchivadoPort,
  ReservaCompletableCandidata,
  ResultadoArchivado,
} from '../application/archivar-reservas-completadas.service';
import {
  fianzaResuelta,
  resolverArchivadoAutomatico,
  type EstadoReserva,
  type FianzaStatusDominio,
  type SubEstadoConsulta,
} from '../domain/maquina-estados';
import {
  subEstadoPrismaADominio,
  type SubEstadoConsultaPrisma,
} from './sub-estado-consulta.mapper';

/** Fila cruda del `SELECT … FOR UPDATE` sobre la RESERVA (columnas snake_case). */
interface FilaReservaBloqueada {
  estado: EstadoReserva;
  sub_estado: SubEstadoConsultaPrisma | null;
  fianza_status: FianzaStatusDominio;
  fianza_eur: Prisma.Decimal | null;
}

@Injectable()
export class ArchivadoUoWPrismaAdapter implements ArchivadoPort {
  constructor(private readonly prisma: PrismaService) {}

  async archivarReserva(
    candidata: ReservaCompletableCandidata,
  ): Promise<ResultadoArchivado> {
    return this.prisma.$transaction(async (tx) => {
      // RLS write (D-8): fija el tenant de la candidata como PRIMERA operación.
      await this.prisma.fijarTenant(tx, candidata.tenantId);

      // (1) SELECT … FOR UPDATE de la RESERVA: serializa la transición (RC-1/RC-2). La
      // exclusión mutua vive SOLO en PostgreSQL (sin Redis/locks distribuidos).
      const filas = await tx.$queryRaw<FilaReservaBloqueada[]>(Prisma.sql`
        SELECT estado, sub_estado, fianza_status, fianza_eur
        FROM reserva
        WHERE id_reserva = ${candidata.reservaId}
          AND tenant_id = ${candidata.tenantId}
        FOR UPDATE
      `);

      const noArchivada = (fianzaPendiente: boolean): ResultadoArchivado => ({
        reservaId: candidata.reservaId,
        archivada: false,
        fianzaPendiente,
      });

      if (filas.length === 0) {
        return noArchivada(false);
      }

      const fila = filas[0];
      const subEstadoDominio: SubEstadoConsulta | null =
        fila.sub_estado === null ? null : subEstadoPrismaADominio(fila.sub_estado);

      // (2) RE-EVALUACIÓN bajo lock de la guarda de ORIGEN. Si ya no es candidata
      // (`reserva_completada` u otro estado) → destino null → no-op idempotente (RC).
      const destino = resolverArchivadoAutomatico(fila.estado, subEstadoDominio);
      if (destino === null) {
        return noArchivada(false);
      }

      // (3) RE-EVALUACIÓN de la guarda de FIANZA en la misma lectura de la fila (el importe
      // se lee de la propia fila bajo el lock, no del input externo).
      const fianzaEur = fila.fianza_eur === null ? null : Number(fila.fianza_eur);
      const fianza = fianzaResuelta({
        fianzaStatus: fila.fianza_status,
        fianzaEur,
      });
      if (!fianza.resuelta) {
        return noArchivada(true);
      }

      // (4) Transición atómica post_evento → reserva_completada, forzada por Sistema.
      await tx.reserva.update({
        where: { idReserva: candidata.reservaId },
        data: { estado: destino.estado },
      });

      // AUDIT_LOG de la TRANSICIÓN, origen Sistema (usuario_id null), causa T+7d.
      await tx.auditLog.create({
        data: {
          tenantId: candidata.tenantId,
          usuarioId: null,
          entidad: 'RESERVA',
          entidadId: candidata.reservaId,
          accion: AccionAudit.transicion,
          datosAnteriores: { estado: fila.estado } as Prisma.InputJsonValue,
          datosNuevos: {
            estado: destino.estado,
            causa: 'T+7d',
          } as Prisma.InputJsonValue,
        },
      });

      return {
        reservaId: candidata.reservaId,
        archivada: true,
        fianzaPendiente: false,
      };
    });
  }
}
