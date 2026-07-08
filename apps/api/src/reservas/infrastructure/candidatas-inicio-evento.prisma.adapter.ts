/**
 * Adaptador Prisma del puerto `CandidatasInicioEventoPort` (US-031 / UC-23, §D-4/§D-5).
 *
 * Lectura CROSS-TENANT de las RESERVA candidatas al inicio automático de evento en T-0:
 * `estado = 'reserva_confirmada'` AND `date(fecha_evento) = date(hoy)`. Es un punto
 * cross-tenant legítimo (D-5): el barrido del proceso de Sistema evalúa candidatas de
 * TODOS los tenants en una sola pasada, con el rol técnico del proceso (sin `SET LOCAL
 * app.tenant_id`). Cada fila trae su `tenant_id`; las MUTACIONES posteriores (adaptador de
 * UoW) SÍ fijan el tenant de la fila (RLS write por tenant), nunca cruzan tenant.
 *
 * SELECCIÓN POR FECHA DE CALENDARIO (D-4), NO por instante ni por string formateado: la
 * semántica de T-0 es "el día de `fecha_evento`", una fecha de calendario. La columna
 * `fecha_evento` es `DATE` en el esquema; el "hoy" se calcula UNA sola vez por pase como
 * `CURRENT_DATE` del motor y se compara `= date(fecha_evento)`. Así el off-by-one de
 * presentación (memoria "TTL display off-by-one por TZ", deuda ajena a este change) no
 * afecta a qué se inicia: la lógica no depende de ningún string formateado. Un evento de
 * hoy "al borde del día" (23:00 UTC) sigue entrando porque su FECHA DE CALENDARIO manda.
 */
import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../shared/prisma/prisma.service';
import type {
  CandidatasInicioEventoPort,
  EventoCandidato,
} from '../application/iniciar-eventos-del-dia.service';
import type {
  FianzaStatusDominio,
  LiquidacionStatusDominio,
  PreEventoStatusDominio,
} from '../domain/maquina-estados';

/** Fila cruda del SELECT de candidatas (columnas snake_case). */
interface FilaCandidata {
  id_reserva: string;
  tenant_id: string;
  fecha_evento: Date;
  pre_evento_status: PreEventoStatusDominio;
  liquidacion_status: LiquidacionStatusDominio;
  fianza_status: FianzaStatusDominio;
  cond_part_firmadas: boolean;
}

@Injectable()
export class CandidatasInicioEventoPrismaAdapter implements CandidatasInicioEventoPort {
  constructor(private readonly prisma: PrismaService) {}

  async listarCandidatas(): Promise<EventoCandidato[]> {
    // CROSS-TENANT: sin `fijarTenant` (rol técnico del proceso de Sistema, D-5). La
    // candidatura se decide por FECHA DE CALENDARIO (D-4): `date(fecha_evento) =
    // CURRENT_DATE`, calculado por el motor UNA vez por pase, NUNCA por un string
    // formateado. `estado = 'reserva_confirmada'` (filtro estricto): las ya en
    // `evento_en_curso` (por un pase previo o el gestor US-032) quedan fuera por
    // construcción → idempotencia. Se leen los tres `*_status` y `cond_part_firmadas`
    // para la re-evaluación bajo lock y la A29.
    const filas = await this.prisma.$queryRaw<FilaCandidata[]>(Prisma.sql`
      SELECT id_reserva, tenant_id, fecha_evento,
             pre_evento_status, liquidacion_status, fianza_status, cond_part_firmadas
      FROM reserva
      WHERE estado = 'reserva_confirmada'
        AND fecha_evento IS NOT NULL
        AND fecha_evento = CURRENT_DATE
    `);

    return filas.map((fila) => ({
      reservaId: fila.id_reserva,
      tenantId: fila.tenant_id,
      fechaEvento: fila.fecha_evento,
      preEventoStatus: fila.pre_evento_status,
      liquidacionStatus: fila.liquidacion_status,
      fianzaStatus: fila.fianza_status,
      condPartFirmadas: fila.cond_part_firmadas,
    }));
  }
}
