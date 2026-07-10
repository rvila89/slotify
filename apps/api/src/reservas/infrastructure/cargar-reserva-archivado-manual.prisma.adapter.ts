/**
 * Adaptador de LECTURA de la RESERVA para el archivado manual (US-038 / UC-28 flujo
 * alternativo manual).
 *
 * Carga la proyección MÍNIMA de la RESERVA (`estado`, `sub_estado`, `fianza_eur`,
 * `fianza_status`) bajo el contexto RLS del tenant del Gestor: una RESERVA de otro tenant es
 * INVISIBLE (→ `null` → 404). NO lee `fecha_post_evento` (el manual NO aplica el filtro T+7d
 * de US-037). La lectura es previa a la transacción de la transición; la guarda de origen se
 * re-evalúa DENTRO de la transacción bajo el lock (§D-6).
 */
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../shared/prisma/prisma.service';
import type {
  ArchivarReservaManualComando,
  ReservaArchivable,
} from '../application/archivar-reserva-manual.use-case';
import type {
  EstadoReserva,
  FianzaStatusDominio,
  SubEstadoConsulta,
} from '../domain/maquina-estados';
import {
  subEstadoPrismaADominio,
  type SubEstadoConsultaPrisma,
} from './sub-estado-consulta.mapper';

@Injectable()
export class CargarReservaArchivadoManualPrismaAdapter {
  constructor(private readonly prisma: PrismaService) {}

  async cargar(
    comando: ArchivarReservaManualComando,
  ): Promise<ReservaArchivable | null> {
    return this.prisma.$transaction(async (tx) => {
      await this.prisma.fijarTenant(tx, comando.tenantId);
      const fila = await tx.reserva.findFirst({
        where: { idReserva: comando.reservaId, tenantId: comando.tenantId },
        select: {
          idReserva: true,
          tenantId: true,
          estado: true,
          subEstado: true,
          fianzaEur: true,
          fianzaStatus: true,
        },
      });
      if (fila === null) {
        return null;
      }
      return {
        idReserva: fila.idReserva,
        tenantId: fila.tenantId,
        estado: fila.estado as EstadoReserva,
        subEstado:
          fila.subEstado === null
            ? null
            : (subEstadoPrismaADominio(
                fila.subEstado as SubEstadoConsultaPrisma,
              ) as SubEstadoConsulta),
        // Importe como STRING (Decimal(10,2), sin coma flotante) o null.
        fianzaEur: fila.fianzaEur === null ? null : fila.fianzaEur.toString(),
        fianzaStatus: fila.fianzaStatus as FianzaStatusDominio,
      };
    });
  }
}
