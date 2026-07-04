/**
 * Adaptador Prisma del puerto `CandidatasCierreFichaPort` (US-026 / UC-20 FA-01,
 * §D-4/§D-5).
 *
 * Lectura CROSS-TENANT de las RESERVA candidatas al cierre A10 en T-1d:
 * `estado = 'reserva_confirmada'` AND `pre_evento_status != 'cerrado'` AND
 * `date(fecha_evento) = date(hoy) + 1 día`. Es un punto cross-tenant legítimo (D-5): el
 * barrido del proceso de Sistema evalúa candidatas de TODOS los tenants en una sola
 * pasada, con el rol técnico del proceso (sin `SET LOCAL app.tenant_id`). Cada fila trae
 * su `tenant_id`; las MUTACIONES posteriores (adaptador de UoW) SÍ fijan el tenant de la
 * fila (RLS write por tenant), nunca cruzan tenant.
 *
 * SELECCIÓN POR FECHA DE CALENDARIO (D-4), NO por instante ni por string formateado: la
 * semántica de A10 es "T-1d anterior al `fecha_evento`", una fecha de calendario. La
 * columna `fecha_evento` es `DATE` en el esquema; el "mañana" se calcula UNA sola vez
 * por pase como `CURRENT_DATE + INTERVAL '1 day'` del motor y se compara `= date(...)`.
 * Así el off-by-one de presentación (memoria "TTL display off-by-one por TZ", deuda
 * ajena a este change) no afecta a qué se cierra: la lógica no depende de ningún string
 * formateado. Un evento de mañana "al borde del día" (23:00) sigue entrando porque su
 * FECHA DE CALENDARIO es la que manda.
 */
import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../shared/prisma/prisma.service';
import type {
  CandidatasCierreFichaPort,
  FichaCandidataCierre,
} from '../application/cerrar-fichas-vencidas.service';
import type { PreEventoStatus } from '../domain/maquina-estados-pre-evento';

/** Fila cruda del SELECT de candidatas (columnas snake_case). */
interface FilaCandidata {
  id_reserva: string;
  tenant_id: string;
  fecha_evento: Date;
  pre_evento_status: PreEventoStatus;
}

@Injectable()
export class CandidatasCierreFichaPrismaAdapter implements CandidatasCierreFichaPort {
  constructor(private readonly prisma: PrismaService) {}

  async listarCandidatas(): Promise<FichaCandidataCierre[]> {
    // CROSS-TENANT: sin `fijarTenant` (rol técnico del proceso de Sistema, D-5). La
    // candidatura se decide por FECHA DE CALENDARIO (D-4): `date(fecha_evento) =
    // CURRENT_DATE + 1 día`, calculado por el motor UNA vez por pase, NUNCA por un string
    // formateado. `estado = 'reserva_confirmada'` (filtro estricto) AND
    // `pre_evento_status != 'cerrado'` (las ya cerradas quedan fuera por construcción →
    // idempotencia). Se une con FICHA_OPERATIVA (1:1) para excluir reservas sin ficha.
    const filas = await this.prisma.$queryRaw<FilaCandidata[]>(Prisma.sql`
      SELECT r.id_reserva, r.tenant_id, r.fecha_evento, r.pre_evento_status
      FROM reserva r
      INNER JOIN ficha_operativa f ON f.reserva_id = r.id_reserva
      WHERE r.estado = 'reserva_confirmada'
        AND r.pre_evento_status <> 'cerrado'
        AND r.fecha_evento IS NOT NULL
        AND r.fecha_evento = (CURRENT_DATE + INTERVAL '1 day')::date
    `);

    return filas.map((fila) => ({
      reservaId: fila.id_reserva,
      tenantId: fila.tenant_id,
      fechaEvento: fila.fecha_evento,
      preEventoStatus: fila.pre_evento_status,
    }));
  }
}
