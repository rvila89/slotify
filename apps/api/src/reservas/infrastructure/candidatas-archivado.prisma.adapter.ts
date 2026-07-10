/**
 * Adaptador Prisma del puerto `CandidatasArchivadoPort` (US-037 / UC-28, §D-2=A/§D-8).
 *
 * Lectura CROSS-TENANT de las RESERVA candidatas al archivado automático en T+7d:
 * `estado = 'post_evento'` AND `date(fecha_post_evento) <= CURRENT_DATE - 7`. Es un punto
 * cross-tenant legítimo (D-8): el barrido del proceso de Sistema evalúa candidatas de TODOS
 * los tenants en una sola pasada, con el rol técnico del proceso (sin `SET LOCAL
 * app.tenant_id`). Cada fila trae su `tenant_id`; las MUTACIONES posteriores (adaptador de
 * UoW) SÍ fijan el tenant de la fila (RLS write por tenant), nunca cruzan tenant.
 *
 * SELECCIÓN POR FECHA DE CALENDARIO (D-2=A), NO por instante ni por string formateado: la
 * semántica de T+7d es "≥ 7 días naturales desde que la RESERVA entró en `post_evento`",
 * una fecha de calendario. El "hoy" lo calcula UNA sola vez por pase el motor como
 * `CURRENT_DATE` y se compara `date(fecha_post_evento) <= CURRENT_DATE - 7` con el operador
 * de intervalo de PostgreSQL. Así el off-by-one de presentación (memoria "TTL display
 * off-by-one por TZ", deuda ajena a este change) no afecta a qué se archiva: la lógica no
 * depende de ningún string formateado, y un `post_evento` sellado "al borde del día"
 * (23:00 UTC) del día -7 sigue entrando porque su FECHA DE CALENDARIO manda.
 *
 * `fecha_post_evento IS NULL` (residual pre-migración aún NO backfilleado) queda FUERA por
 * construcción: nunca se archiva hasta que se le asigne la fecha.
 */
import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../shared/prisma/prisma.service';
import type {
  CandidatasArchivadoPort,
  ReservaCompletableCandidata,
} from '../application/archivar-reservas-completadas.service';
import type { FianzaStatusDominio } from '../domain/maquina-estados';

/** Fila cruda del SELECT de candidatas (columnas snake_case). */
interface FilaCandidata {
  id_reserva: string;
  codigo: string;
  tenant_id: string;
  fecha_post_evento: Date;
  fianza_status: FianzaStatusDominio;
  fianza_eur: Prisma.Decimal | null;
}

@Injectable()
export class CandidatasArchivadoPrismaAdapter implements CandidatasArchivadoPort {
  constructor(private readonly prisma: PrismaService) {}

  async listarCandidatas(): Promise<ReservaCompletableCandidata[]> {
    // CROSS-TENANT: sin `fijarTenant` (rol técnico del proceso de Sistema, D-8). La
    // candidatura se decide por FECHA DE CALENDARIO (D-2=A):
    // `date(fecha_post_evento) <= CURRENT_DATE - 7 días`, calculado por el motor UNA vez por
    // pase, NUNCA por un string formateado. `estado = 'post_evento'` (filtro estricto): las
    // ya en `reserva_completada` (pase previo o gestor US-038) quedan fuera por construcción
    // → idempotencia. `fecha_post_evento IS NULL` (residual) queda fuera.
    const filas = await this.prisma.$queryRaw<FilaCandidata[]>(Prisma.sql`
      SELECT id_reserva, codigo, tenant_id, fecha_post_evento, fianza_status, fianza_eur
      FROM reserva
      WHERE estado = 'post_evento'
        AND fecha_post_evento IS NOT NULL
        AND date(fecha_post_evento) <= (CURRENT_DATE - INTERVAL '7 days')
    `);

    return filas.map((fila) => ({
      reservaId: fila.id_reserva,
      codigo: fila.codigo,
      tenantId: fila.tenant_id,
      fechaPostEvento: fila.fecha_post_evento,
      fianzaStatus: fila.fianza_status,
      fianzaEur: fila.fianza_eur === null ? null : Number(fila.fianza_eur),
    }));
  }
}
