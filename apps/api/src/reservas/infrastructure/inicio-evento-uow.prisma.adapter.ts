/**
 * Adaptador de la UNIDAD DE TRABAJO atómica del INICIO AUTOMÁTICO de UN evento en T-0
 * (US-031 / UC-23, §D-3/§D-4/§D-6/§D-7). Implementa `InicioEventoPort`.
 *
 * Por cada RESERVA candidata abre UN único `prisma.$transaction` bajo el contexto RLS del
 * `tenantId` de LA candidata (`SET LOCAL app.tenant_id` como PRIMERA operación, D-5:
 * cross-tenant read en el adaptador de candidatas, RLS write aquí). Dentro de esa
 * transacción, all-or-nothing:
 *   1. `SELECT … FOR UPDATE` de la fila RESERVA: serializa la transición frente a un
 *      segundo barrido (RC-1) y al gestor US-032 (RC-2, simulado hasta que aterrice). La
 *      exclusión mutua vive SOLO en PostgreSQL (sin Redis/locks distribuidos, hook
 *      `no-distributed-lock`). Re-lee `estado`, `sub_estado`, los tres `*_status` y
 *      `cond_part_firmadas`.
 *   2. RE-EVALUACIÓN bajo lock de la guarda de ORIGEN declarativa `resolverInicioEvento`:
 *      si el destino es `null` (ya `evento_en_curso`, por otro pase o por el gestor
 *      US-032) → no muta nada, `iniciado = false`, `precondicionesIncumplidas = null`
 *      (idempotencia / RC — la UPDATE que no se ejecuta ≡ 0 filas afectadas).
 *   3. RE-EVALUACIÓN de las TRES precondiciones (`preconditionesEventoCumplidas`) en la
 *      misma lectura: si NO cumplen → no muta, `iniciado = false` con la lista de
 *      incumplidas (para la alerta crítica del use-case).
 *   4. Si origen válido Y precondiciones cumplidas: `RESERVA.estado → evento_en_curso` +
 *      AUDIT_LOG de la TRANSICIÓN (`accion='transicion'`, `entidad='RESERVA'`), origen
 *      Sistema (`usuario_id` NO poblado → null), `datos_anteriores={estado:
 *      reserva_confirmada}`, `datos_nuevos={estado:evento_en_curso, causa:'T-0'}`.
 *      Exactamente 1 entrada por inicio efectivo (D-7); sin duplicar.
 * `cond_part_firmadas = false` se refleja en `condPartNoFirmadas` con INDEPENDENCIA del
 * resultado (la A29 la emite el use-case).
 */
import { Injectable } from '@nestjs/common';
import { AccionAudit, Prisma } from '@prisma/client';
import { PrismaService } from '../../shared/prisma/prisma.service';
import type {
  EventoCandidato,
  InicioEventoPort,
  ResultadoInicioEvento,
} from '../application/iniciar-eventos-del-dia.service';
import {
  preconditionesEventoCumplidas,
  resolverInicioEvento,
  type EstadoReserva,
  type FianzaStatusDominio,
  type LiquidacionStatusDominio,
  type PreEventoStatusDominio,
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
  pre_evento_status: PreEventoStatusDominio;
  liquidacion_status: LiquidacionStatusDominio;
  fianza_status: FianzaStatusDominio;
  cond_part_firmadas: boolean;
}

@Injectable()
export class InicioEventoUoWPrismaAdapter implements InicioEventoPort {
  constructor(private readonly prisma: PrismaService) {}

  async iniciarEvento(candidata: EventoCandidato): Promise<ResultadoInicioEvento> {
    return this.prisma.$transaction(async (tx) => {
      // RLS write (D-5): fija el tenant de la candidata como PRIMERA operación.
      await this.prisma.fijarTenant(tx, candidata.tenantId);

      // (1) SELECT … FOR UPDATE de la RESERVA: serializa la transición (RC-1/RC-2). La
      // exclusión mutua vive SOLO en PostgreSQL (sin Redis/locks distribuidos).
      const filas = await tx.$queryRaw<FilaReservaBloqueada[]>(Prisma.sql`
        SELECT estado, sub_estado, pre_evento_status, liquidacion_status,
               fianza_status, cond_part_firmadas
        FROM reserva
        WHERE id_reserva = ${candidata.reservaId}
          AND tenant_id = ${candidata.tenantId}
        FOR UPDATE
      `);

      // A29 se refleja con independencia del resultado: se toma de la lectura bajo lock si
      // la fila existe; en su defecto, de la proyección de la candidata.
      const condPartNoFirmadas =
        filas.length > 0
          ? filas[0].cond_part_firmadas === false
          : candidata.condPartFirmadas === false;

      const noIniciado = (
        precondicionesIncumplidas: string[] | null,
      ): ResultadoInicioEvento => ({
        reservaId: candidata.reservaId,
        iniciado: false,
        precondicionesIncumplidas,
        condPartNoFirmadas,
      });

      if (filas.length === 0) {
        return noIniciado(null);
      }

      const fila = filas[0];
      const subEstadoDominio: SubEstadoConsulta | null =
        fila.sub_estado === null ? null : subEstadoPrismaADominio(fila.sub_estado);

      // (2) RE-EVALUACIÓN bajo lock de la guarda de ORIGEN. Si ya no es candidata
      // (`evento_en_curso` u otro estado) → destino null → no-op idempotente (RC).
      const destino = resolverInicioEvento(fila.estado, subEstadoDominio);
      if (destino === null) {
        return noIniciado(null);
      }

      // (3) RE-EVALUACIÓN de las tres precondiciones en la misma lectura de la fila.
      const precondiciones = preconditionesEventoCumplidas({
        preEventoStatus: fila.pre_evento_status,
        liquidacionStatus: fila.liquidacion_status,
        fianzaStatus: fila.fianza_status,
      });
      if (!precondiciones.cumple) {
        return noIniciado(precondiciones.faltantes);
      }

      // (4) Transición atómica reserva_confirmada → evento_en_curso, forzada por Sistema.
      await tx.reserva.update({
        where: { idReserva: candidata.reservaId },
        data: { estado: destino.estado },
      });

      // AUDIT_LOG de la TRANSICIÓN, origen Sistema (usuario_id null), causa T-0.
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
            causa: 'T-0',
          } as Prisma.InputJsonValue,
        },
      });

      return {
        reservaId: candidata.reservaId,
        iniciado: true,
        precondicionesIncumplidas: null,
        condPartNoFirmadas,
      };
    });
  }
}
