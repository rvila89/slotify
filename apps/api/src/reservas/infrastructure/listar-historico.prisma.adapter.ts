/**
 * Adaptador Prisma del puerto de lectura `HistoricoQueryPort` (`GET /historico` →
 * `ReservaHistoricoListResponse`, US-042 / UC-32).
 *
 * Lectura PURA (no muta): proyecta las RESERVAS CERRADAS del tenant + su CLIENTE a la fila
 * LIGERA del read-model de la aplicación. Fija el contexto RLS (`SET LOCAL app.tenant_id`)
 * como PRIMERA operación de la transacción de lectura y filtra SIEMPRE por `tenant_id`
 * EXPLÍCITO en el WHERE (defensa en profundidad): en dev/test el superuser puede saltarse
 * RLS, así que NO se confía solo en la política — el `tenant_id` va en el WHERE parametrizado.
 *
 * Reglas del histórico:
 *  - Restringe al estado cerrado indicado (`estadoFinal`): por defecto `reserva_completada`,
 *    opt-in de `reserva_cancelada`. NUNCA devuelve estados activos ni terminales de consulta.
 *  - BÚSQUEDA `q`: full-text nativo de PostgreSQL sobre `CLIENTE.nombre`, `CLIENTE.apellidos`,
 *    `CLIENTE.email`, `RESERVA.codigo` y `RESERVA.notas` (y solo esos), vía
 *    `to_tsvector('spanish', ...) @@ plainto_tsquery('spanish', $termino)`, PARAMETRIZADA
 *    (nunca interpolación de strings → sin inyección). Índice GIN funcional de apoyo
 *    (migración). El aislamiento por `tenant_id` precede al match full-text en el plan.
 *  - FILTROS estructurados AND: rango `fechaEvento` (inclusivo), `tipoEvento` (exacto),
 *    rango `importeTotal` (inclusivo).
 *  - ORDEN por `fechaEvento` descendente (NULLS LAST) y `id_reserva` como desempate estable.
 *  - PAGINACIÓN saneada: `page >= 1`, `limit` entre 1 y 100 (LIMIT/OFFSET).
 *
 * SQL crudo vía `$queryRaw`/`Prisma.sql` (no el `where` de Prisma) porque el full-text
 * `to_tsvector`/`plainto_tsquery` no es expresable con el query builder de Prisma. Todas
 * las condiciones del usuario van como PARÁMETROS (`Prisma.sql`), nunca concatenadas.
 */
import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../shared/prisma/prisma.service';
import type {
  HistoricoPaginaLectura,
  HistoricoQueryFiltros,
  HistoricoQueryPort,
  HistoricoReservaLectura,
} from '../application/listar-historico.use-case';

/** Fila cruda del SELECT del histórico (columnas snake_case + alias del cliente). */
interface FilaHistorico {
  id_reserva: string;
  codigo: string;
  cliente_id: string;
  cliente_nombre: string | null;
  cliente_apellidos: string | null;
  estado: 'reserva_completada' | 'reserva_cancelada';
  fecha_evento: Date | null;
  tipo_evento: string | null;
  importe_total: Prisma.Decimal | null;
}

/** Sanea `page` (mínimo 1). */
const sanearPage = (page: number): number =>
  Number.isFinite(page) && page >= 1 ? Math.floor(page) : 1;

/** Sanea `limit` (entre 1 y 100). */
const sanearLimit = (limit: number): number => {
  if (!Number.isFinite(limit) || limit < 1) {
    return 1;
  }
  return Math.min(Math.floor(limit), 100);
};

/** Serializa un `Decimal(10,2)` a string con 2 decimales (contrato `Importe`); null si ausente. */
const aImporte = (valor: Prisma.Decimal | null): string | null =>
  valor === null ? null : valor.toFixed(2);

@Injectable()
export class ListarHistoricoPrismaAdapter implements HistoricoQueryPort {
  constructor(private readonly prisma: PrismaService) {}

  async listarCerradas(
    filtros: HistoricoQueryFiltros,
  ): Promise<HistoricoPaginaLectura> {
    const page = sanearPage(filtros.page);
    const limit = sanearLimit(filtros.limit);
    const offset = (page - 1) * limit;

    // Filtro base inmutable (tenant + estado cerrado) + filtros del usuario, todos AND y
    // PARAMETRIZADOS. Se aplica ANTES que cualquier otra condición.
    const condiciones: Prisma.Sql[] = [
      Prisma.sql`r.tenant_id = ${filtros.tenantId}`,
      Prisma.sql`r.estado = ${filtros.estadoFinal}::"EstadoReserva"`,
    ];

    const termino = filtros.q?.trim();
    if (termino) {
      // Full-text PARAMETRIZADO: el término viaja como parámetro de `plainto_tsquery`,
      // nunca concatenado. Se evalúan DOS documentos `tsvector` por-tabla (un índice GIN
      // funcional solo puede referenciar columnas de UNA tabla; un tsvector que mezclase
      // reserva y cliente no sería indexable). Ambas expresiones son EXACTAMENTE las de los
      // índices GIN de la migración (`idx_reserva_fts_historico` sobre codigo+notas,
      // `idx_cliente_fts_historico` sobre nombre+apellidos+email), para que el planificador
      // pueda usarlos. Un match en cualquiera de las dos tablas basta (OR).
      condiciones.push(Prisma.sql`(
        to_tsvector('spanish',
          coalesce(r.codigo, '') || ' ' || coalesce(r.notas, '')
        ) @@ plainto_tsquery('spanish', ${termino})
        OR
        to_tsvector('spanish',
          coalesce(c.nombre, '') || ' ' || coalesce(c.apellidos, '') || ' ' ||
          translate(coalesce(c.email, ''), '@._-', '    ')
        ) @@ plainto_tsquery('spanish', ${termino})
      )`);
    }

    if (filtros.fechaDesde) {
      condiciones.push(Prisma.sql`r.fecha_evento >= ${filtros.fechaDesde}::date`);
    }
    if (filtros.fechaHasta) {
      condiciones.push(Prisma.sql`r.fecha_evento <= ${filtros.fechaHasta}::date`);
    }
    if (filtros.tipoEvento) {
      condiciones.push(
        Prisma.sql`r.tipo_evento = ${filtros.tipoEvento}::"TipoEvento"`,
      );
    }
    if (filtros.importeMin !== undefined) {
      condiciones.push(
        Prisma.sql`r.importe_total >= ${filtros.importeMin}::numeric`,
      );
    }
    if (filtros.importeMax !== undefined) {
      condiciones.push(
        Prisma.sql`r.importe_total <= ${filtros.importeMax}::numeric`,
      );
    }

    const where = Prisma.join(condiciones, ' AND ');

    const { items, total } = await this.prisma.$transaction(async (tx) => {
      await this.prisma.fijarTenant(tx, filtros.tenantId);

      const filas = await tx.$queryRaw<FilaHistorico[]>(Prisma.sql`
        SELECT
          r.id_reserva      AS id_reserva,
          r.codigo          AS codigo,
          r.cliente_id      AS cliente_id,
          c.nombre          AS cliente_nombre,
          c.apellidos       AS cliente_apellidos,
          r.estado          AS estado,
          r.fecha_evento    AS fecha_evento,
          r.tipo_evento     AS tipo_evento,
          r.importe_total   AS importe_total
        FROM reserva r
        JOIN cliente c ON c.id_cliente = r.cliente_id
        WHERE ${where}
        ORDER BY r.fecha_evento DESC NULLS LAST, r.id_reserva DESC
        LIMIT ${limit} OFFSET ${offset}
      `);

      const conteo = await tx.$queryRaw<{ total: bigint }[]>(Prisma.sql`
        SELECT count(*)::bigint AS total
        FROM reserva r
        JOIN cliente c ON c.id_cliente = r.cliente_id
        WHERE ${where}
      `);

      return { items: filas, total: Number(conteo[0]?.total ?? 0n) };
    });

    return {
      items: items.map((fila) => this.aLectura(fila)),
      total,
      page,
      limit,
    };
  }

  /** Proyecta la fila cruda del SELECT al read-model LIGERO del histórico. */
  private aLectura(fila: FilaHistorico): HistoricoReservaLectura {
    return {
      idReserva: fila.id_reserva,
      codigo: fila.codigo,
      clienteId: fila.cliente_id,
      clienteNombre: fila.cliente_nombre,
      clienteApellidos: fila.cliente_apellidos,
      estado: fila.estado,
      fechaEvento: fila.fecha_evento,
      tipoEvento: fila.tipo_evento,
      importeTotal: aImporte(fila.importe_total),
    };
  }
}
