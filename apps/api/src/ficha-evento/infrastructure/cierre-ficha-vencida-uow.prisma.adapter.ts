/**
 * Adaptador de la UNIDAD DE TRABAJO atómica del CIERRE AUTOMÁTICO de UNA ficha en T-1d
 * (US-026 / UC-20 FA-01, §D-3/§D-4/§D-6/§D-7). Implementa `CierreFichaVencidaPort`.
 *
 * Por cada RESERVA candidata abre UN único `prisma.$transaction` bajo el contexto RLS
 * del `tenantId` de LA candidata (`SET LOCAL app.tenant_id` como PRIMERA operación,
 * D-5: cross-tenant read en el adaptador de candidatas, RLS write aquí). Dentro de esa
 * transacción, all-or-nothing:
 *   1. RE-LECTURA de `pre_evento_status` de la RESERVA (idempotencia sin locks
 *      distribuidos, hook `no-distributed-lock`): la serialización la da el motor de
 *      PostgreSQL sobre la fila de RESERVA/FICHA_OPERATIVA.
 *   2. RE-EVALUACIÓN de la guarda declarativa `resolverCierreAutomatico`: si el destino
 *      es `null` (ya `cerrado`, por otro pase o por el cierre manual de US-025) → no muta
 *      nada, `cerrada = false` (C-1/C-2, idempotencia).
 *   3. Triplete de mutación (reuso de US-025, forzado por Sistema): FICHA_OPERATIVA
 *      `ficha_cerrada = true`, `fecha_cierre = now()` y `RESERVA.pre_evento_status →
 *      cerrado`, todo atómico.
 *   4. AUDIT_LOG de la TRANSICIÓN (`accion='transicion'`, `entidad='RESERVA'`), origen
 *      Sistema (`usuario_id` NO poblado por un usuario → null), causa `A10` en
 *      `datos_nuevos`, `pre_evento_status` previo en `datos_anteriores`. Exactamente 1
 *      entrada por cierre efectivo (D-7); sin duplicar.
 */
import { Injectable } from '@nestjs/common';
import { AccionAudit, Prisma } from '@prisma/client';
import { PrismaService } from '../../shared/prisma/prisma.service';
import type {
  CierreFichaVencidaPort,
  FichaCandidataCierre,
  ResultadoCierreFicha,
} from '../application/cerrar-fichas-vencidas.service';
import {
  resolverCierreAutomatico,
  type PreEventoStatus,
} from '../domain/maquina-estados-pre-evento';

/** Fila cruda del `SELECT … FOR UPDATE` sobre la RESERVA (columna snake_case). */
interface FilaReservaBloqueada {
  pre_evento_status: PreEventoStatus;
}

@Injectable()
export class CierreFichaVencidaUoWPrismaAdapter implements CierreFichaVencidaPort {
  constructor(private readonly prisma: PrismaService) {}

  async cerrarFicha(
    candidata: FichaCandidataCierre,
  ): Promise<ResultadoCierreFicha> {
    return this.prisma.$transaction(async (tx) => {
      // RLS write (D-5): fija el tenant de la candidata como PRIMERA operación.
      await this.prisma.fijarTenant(tx, candidata.tenantId);

      // (1) SELECT … FOR UPDATE de la RESERVA: serializa la transición frente a un
      // segundo barrido (C-1) y al cierre manual de US-025 (C-2). La exclusión mutua
      // vive SOLO en PostgreSQL (sin Redis/locks distribuidos).
      const filas = await tx.$queryRaw<FilaReservaBloqueada[]>(Prisma.sql`
        SELECT pre_evento_status
        FROM reserva
        WHERE id_reserva = ${candidata.reservaId}
          AND tenant_id = ${candidata.tenantId}
        FOR UPDATE
      `);

      const noCerrada = (anterior: PreEventoStatus): ResultadoCierreFicha => ({
        reservaId: candidata.reservaId,
        cerrada: false,
        preEventoStatusAnterior: anterior,
      });

      if (filas.length === 0) {
        return noCerrada(candidata.preEventoStatus);
      }

      // (2) RE-EVALUACIÓN bajo lock de la guarda declarativa A10. Si ya `cerrado`
      // (destino null) → no muta nada (idempotencia / cierre manual US-025 concurrente).
      const preEventoStatusAnterior = filas[0].pre_evento_status;
      const destino = resolverCierreAutomatico(preEventoStatusAnterior);
      if (destino === null) {
        return noCerrada(preEventoStatusAnterior);
      }

      // (3) Triplete de cierre (reuso de la mutación de US-025), forzado por Sistema.
      await tx.fichaOperativa.update({
        where: { reservaId: candidata.reservaId },
        data: { fichaCerrada: true, fechaCierre: new Date() },
      });
      await tx.reserva.update({
        where: { idReserva: candidata.reservaId },
        data: { preEventoStatus: destino },
      });

      // (4) AUDIT_LOG de la TRANSICIÓN, origen Sistema (usuario_id null), causa A10.
      await tx.auditLog.create({
        data: {
          tenantId: candidata.tenantId,
          usuarioId: null,
          entidad: 'RESERVA',
          entidadId: candidata.reservaId,
          accion: AccionAudit.transicion,
          datosAnteriores: {
            preEventoStatus: preEventoStatusAnterior,
          } as Prisma.InputJsonValue,
          datosNuevos: {
            preEventoStatus: destino,
            fichaCerrada: true,
            causa: 'A10',
          } as Prisma.InputJsonValue,
        },
      });

      return {
        reservaId: candidata.reservaId,
        cerrada: true,
        preEventoStatusAnterior,
      };
    });
  }
}
