/**
 * Adaptador Prisma del puerto de lectura `CalendarioQueryPort`
 * (`GET /calendario` → `CalendarioResponse`, US-039 / UC-29).
 *
 * LECTURA PURA (no muta `RESERVA` ni `FECHA_BLOQUEADA`, §D-7): agrega
 * `RESERVA ⋈ FECHA_BLOQUEADA` del tenant en el rango `[desde, hasta]`. Cada fila de
 * `FECHA_BLOQUEADA` representa UNA fecha ocupada; las consultas terminales
 * (`2x`/`2y`/`2z`) NO tienen fila de bloqueo (su bloqueo ya fue liberado), así que el
 * JOIN las excluye de forma natural (§D-2). El conteo de cola `enCola` se calcula con
 * una subconsulta correlacionada: `COUNT(RESERVA WHERE sub_estado='s2d' AND
 * consulta_bloqueante_id = <bloqueante>)` (§D-3).
 *
 * MULTI-TENANCY + RLS (§D-4): fija el contexto RLS (`SET LOCAL app.tenant_id`) como
 * PRIMERA operación de la transacción de lectura y filtra SIEMPRE por `tenant_id` en el
 * `WHERE` (defensa en profundidad). Ninguna fila de otro tenant es alcanzable. El color
 * se deriva en memoria con la función pura de dominio `derivarColor`; una fila cuyo
 * `(estado, subEstado)` derive `null` se descarta (no es celda coloreada).
 */
import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../shared/prisma/prisma.service';
import { derivarColor } from '../domain/derivacion-color';
import type {
  AgregarPorRangoParams,
  CalendarioFechaLectura,
  CalendarioQueryPort,
} from '../application/obtener-calendario.query';
import type {
  EstadoReserva as EstadoReservaDominio,
  SubEstadoConsulta,
} from '../../reservas/domain/maquina-estados';
import { subEstadoPrismaADominio, type SubEstadoConsultaPrisma } from '../../reservas/infrastructure/sub-estado-consulta.mapper';

/** Formatea un `Date` a `YYYY-MM-DD` para el binding `::date`. */
const formatearFecha = (fecha: Date): string => fecha.toISOString().slice(0, 10);

/** Fila cruda de la agregación RESERVA ⋈ FECHA_BLOQUEADA + conteo de cola. */
interface FilaAgregada {
  fecha: Date;
  estado: string;
  sub_estado: string | null;
  reserva_id: string;
  cliente: string;
  ttl_expiracion: Date | null;
  en_cola: bigint;
}

@Injectable()
export class CalendarioQueryPrismaAdapter implements CalendarioQueryPort {
  constructor(private readonly prisma: PrismaService) {}

  async agregarPorRango(
    params: AgregarPorRangoParams,
  ): Promise<CalendarioFechaLectura[]> {
    const { tenantId, desde, hasta } = params;
    const desdeIso = formatearFecha(desde);
    const hastaIso = formatearFecha(hasta);

    const filas = await this.prisma.$transaction(async (tx) => {
      // RLS: primera operación de la transacción de lectura (SET LOCAL app.tenant_id).
      await this.prisma.fijarTenant(tx, tenantId);
      // Una entrada por fecha ocupada (fila de FECHA_BLOQUEADA del tenant en rango).
      // El JOIN con RESERVA aporta estado/sub_estado para derivar el color. La cola se
      // cuenta por subconsulta correlacionada (sub_estado='s2d' apuntando a la
      // bloqueante). Se filtra SIEMPRE por tenant_id (defensa en profundidad sobre RLS).
      return tx.$queryRaw<FilaAgregada[]>(Prisma.sql`
        SELECT
          fb.fecha            AS fecha,
          r.estado            AS estado,
          r.sub_estado        AS sub_estado,
          r.id_reserva        AS reserva_id,
          TRIM(CONCAT(c.nombre, ' ', COALESCE(c.apellidos, ''))) AS cliente,
          fb.ttl_expiracion   AS ttl_expiracion,
          (
            SELECT COUNT(*)
            FROM reserva cola
            WHERE cola.tenant_id = ${tenantId}
              AND cola.sub_estado = 's2d'
              AND cola.consulta_bloqueante_id = r.id_reserva
          )                   AS en_cola
        FROM fecha_bloqueada fb
        INNER JOIN reserva r
          ON r.id_reserva = fb.reserva_id
          AND r.tenant_id = fb.tenant_id
        INNER JOIN cliente c
          ON c.id_cliente = r.cliente_id
          AND c.tenant_id = r.tenant_id
        WHERE fb.tenant_id = ${tenantId}
          AND fb.fecha >= ${desdeIso}::date
          AND fb.fecha <= ${hastaIso}::date
        ORDER BY fb.fecha ASC
      `);
    });

    return filas.flatMap((fila) => this.aFechaLectura(fila));
  }

  /**
   * Mapea una fila agregada al read-model, derivando el color con la función pura de
   * dominio. Si el color es `null` (no debería ocurrir: las terminales no tienen fila
   * de bloqueo), la fecha se descarta — defensa en profundidad coherente con §D-2.
   */
  private aFechaLectura(fila: FilaAgregada): CalendarioFechaLectura[] {
    const estado = fila.estado as EstadoReservaDominio;
    const subEstado: SubEstadoConsulta | null =
      fila.sub_estado === null
        ? null
        : subEstadoPrismaADominio(fila.sub_estado as SubEstadoConsultaPrisma);

    const color = derivarColor(estado, subEstado);
    if (color === null) {
      return [];
    }

    return [
      {
        fecha: fila.fecha,
        color,
        estado,
        subEstado,
        reservaId: fila.reserva_id,
        cliente: fila.cliente,
        ttlExpiracion: fila.ttl_expiracion,
        enCola: Number(fila.en_cola),
      },
    ];
  }
}
