/**
 * Adaptador Prisma del puerto de lectura `PipelineQueryPort` (`GET /reservas` →
 * `ReservaListResponse`, US-049 / UC-37 / UC-38).
 *
 * Lectura PURA (no muta): proyecta las RESERVAS ACTIVAS del tenant + su CLIENTE al
 * read-model de la aplicación. Fija el contexto RLS (`SET LOCAL app.tenant_id`) como
 * PRIMERA operación de la transacción de lectura y filtra SIEMPRE por `tenant_id`
 * (defensa en profundidad): ninguna reserva de otro tenant es visible.
 *
 * Reglas del pipeline:
 *  - EXCLUYE los estados terminales de consulta (`2x`/`2y`/`2z`) y los cerrados
 *    (`reserva_completada`/`reserva_cancelada`), incluso sin filtro de estado.
 *  - ORDEN por `fechaCreacion` descendente.
 *  - PAGINACIÓN saneada: `page >= 1`, `limit` entre 1 y 100.
 *  - FILTROS de query: `estado`, `subEstado`, `fechaDesde`/`fechaHasta` (sobre
 *    `fechaEvento`) y `search` (código, notas o nombre/apellidos del cliente).
 *
 * Los importes `Decimal(10,2)` se serializan a `string` con 2 decimales (contrato
 * `Importe`, sin coma flotante); las fechas viajan como `Date` (el mapeo HTTP lo hace el
 * controlador).
 */
import { Injectable } from '@nestjs/common';
import { EstadoReserva, Prisma, SubEstadoConsulta } from '@prisma/client';
import { PrismaService } from '../../shared/prisma/prisma.service';
import type {
  PipelinePaginaLectura,
  PipelineQueryFiltros,
  PipelineQueryPort,
  PipelineReservaLectura,
} from '../application/listar-reservas.use-case';
import type { EstadoReserva as EstadoReservaDominio } from '../domain/maquina-estados';
import { duracionHorasPrismaANumero } from './duracion-horas.mapper';
import {
  subEstadoDominioAPrisma,
  subEstadoPrismaADominio,
  type SubEstadoConsultaPrisma,
} from './sub-estado-consulta.mapper';

/** Sub-estados terminales de consulta que NUNCA aparecen en el pipeline. */
const SUB_ESTADOS_TERMINALES: ReadonlyArray<SubEstadoConsulta> = [
  SubEstadoConsulta.s2x,
  SubEstadoConsulta.s2y,
  SubEstadoConsulta.s2z,
];

/** Estados principales cerrados que NUNCA aparecen en el pipeline. */
const ESTADOS_CERRADOS: ReadonlyArray<EstadoReserva> = [
  EstadoReserva.reserva_completada,
  EstadoReserva.reserva_cancelada,
];

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
export class ListarReservasPrismaAdapter implements PipelineQueryPort {
  constructor(private readonly prisma: PrismaService) {}

  async listarActivas(
    filtros: PipelineQueryFiltros,
  ): Promise<PipelinePaginaLectura> {
    const page = sanearPage(filtros.page);
    const limit = sanearLimit(filtros.limit);
    const where = this.construirWhere(filtros);

    const { items, total } = await this.prisma.$transaction(async (tx) => {
      await this.prisma.fijarTenant(tx, filtros.tenantId);
      const [filas, totalActivas] = await Promise.all([
        tx.reserva.findMany({
          where,
          include: {
            cliente: true,
            // US-047 D-1/D-5: se cargan SOLO las COMUNICACION E1 en `borrador` de cada
            // reserva (subconsulta del propio query del pipeline, sin N+1 ni endpoint
            // extra). Su presencia deriva `tieneBorradorE1Pendiente`. El aislamiento por
            // tenant lo garantiza el RLS ya fijado + el `tenant_id` de la reserva padre.
            comunicaciones: {
              where: { codigoEmail: 'E1', estado: 'borrador' },
              select: { idComunicacion: true, codigoEmail: true, estado: true },
            },
          },
          orderBy: { fechaCreacion: 'desc' },
          skip: (page - 1) * limit,
          take: limit,
        }),
        tx.reserva.count({ where }),
      ]);
      return { items: filas, total: totalActivas };
    });

    return {
      items: items.map((fila) => this.aLectura(fila)),
      total,
      page,
      limit,
    };
  }

  /**
   * Construye el `where` de Prisma: aislamiento por `tenant_id`, exclusión de terminales/
   * cerrados (siempre) y los filtros de query recibidos.
   */
  private construirWhere(
    filtros: PipelineQueryFiltros,
  ): Prisma.ReservaWhereInput {
    // La exclusión de terminales/cerrados se aplica SIEMPRE (invariante del pipeline),
    // con independencia de los filtros: se combina con el filtro de estado/subEstado vía
    // `AND` en vez de sustituirse. Así `?estado=reserva_completada` o `?subEstado=2x`
    // (valores terminales) devuelven lista vacía, porque el filtro pide un estado que la
    // exclusión veta.
    const where: Prisma.ReservaWhereInput = {
      tenantId: filtros.tenantId,
      estado: filtros.estado
        ? { equals: filtros.estado as EstadoReserva, notIn: [...ESTADOS_CERRADOS] }
        : { notIn: [...ESTADOS_CERRADOS] },
    };

    if (filtros.subEstado) {
      // Filtro EXPLÍCITO de sub-estado: pide un valor concreto no nulo (no admite NULL).
      // La exclusión de terminales se conserva por si se pide un valor terminal (→ vacío).
      where.subEstado = {
        equals: subEstadoDominioAPrisma(filtros.subEstado),
        notIn: [...SUB_ESTADOS_TERMINALES],
      };
    } else {
      // SIN filtro de sub-estado: el pipeline debe incluir las reservas con `sub_estado
      // IS NULL` (estados `pre_reserva`, `reserva_confirmada`, `evento_en_curso`,
      // `post_evento`). Como `NULL NOT IN (...)` evalúa a NULL (excluiría esas filas),
      // se admite NULL explícitamente vía `OR`. Se cuelga de `where.AND` (NO de `where.OR`,
      // reservado a `search`) para no pisar el filtro de búsqueda ni romper el AND implícito.
      where.AND = [
        ...(Array.isArray(where.AND) ? where.AND : where.AND ? [where.AND] : []),
        {
          OR: [
            { subEstado: null },
            { subEstado: { notIn: [...SUB_ESTADOS_TERMINALES] } },
          ],
        },
      ];
    }

    const fechaEvento = this.construirRangoFecha(filtros);
    if (fechaEvento) {
      where.fechaEvento = fechaEvento;
    }

    if (filtros.search && filtros.search.trim() !== '') {
      const search = filtros.search.trim();
      where.OR = [
        { codigo: { contains: search, mode: 'insensitive' } },
        { notas: { contains: search, mode: 'insensitive' } },
        { cliente: { nombre: { contains: search, mode: 'insensitive' } } },
        { cliente: { apellidos: { contains: search, mode: 'insensitive' } } },
      ];
    }

    return where;
  }

  /** Traduce `fechaDesde`/`fechaHasta` a un filtro de rango sobre `fechaEvento`. */
  private construirRangoFecha(
    filtros: PipelineQueryFiltros,
  ): Prisma.DateTimeNullableFilter | null {
    if (!filtros.fechaDesde && !filtros.fechaHasta) {
      return null;
    }
    return {
      ...(filtros.fechaDesde ? { gte: filtros.fechaDesde } : {}),
      ...(filtros.fechaHasta ? { lte: filtros.fechaHasta } : {}),
    };
  }

  /** Proyecta la fila de RESERVA + CLIENTE al read-model del pipeline. */
  private aLectura(
    fila: Prisma.ReservaGetPayload<{
      include: {
        cliente: true;
        comunicaciones: {
          select: { idComunicacion: true; codigoEmail: true; estado: true };
        };
      };
    }>,
  ): PipelineReservaLectura {
    // La subconsulta ya restringe a E1/borrador; se re-verifica el contenido para ser
    // robustos aunque el include no filtre (p. ej. en los dobles de test).
    const tieneBorradorE1Pendiente = fila.comunicaciones.some(
      (c) => c.codigoEmail === 'E1' && c.estado === 'borrador',
    );
    return {
      idReserva: fila.idReserva,
      codigo: fila.codigo,
      clienteId: fila.clienteId,
      estado: fila.estado as EstadoReservaDominio,
      subEstado:
        fila.subEstado === null
          ? null
          : subEstadoPrismaADominio(fila.subEstado as SubEstadoConsultaPrisma),
      canalEntrada: fila.canalEntrada,
      fechaEvento: fila.fechaEvento,
      duracionHoras: duracionHorasPrismaANumero(fila.duracionHoras),
      tipoEvento: fila.tipoEvento,
      numAdultosNinosMayores4: fila.numAdultosNinosMayores4,
      numNinosMenores4: fila.numNinosMenores4,
      numInvitadosFinal: fila.numInvitadosFinal,
      importeTotal: aImporte(fila.importeTotal),
      importeSenal: aImporte(fila.importeSenal),
      importeLiquidacion: aImporte(fila.importeLiquidacion),
      ttlExpiracion: fila.ttlExpiracion,
      visitaProgramadaFecha: fila.visitaProgramadaFecha,
      visitaProgramadaHora: fila.visitaProgramadaHora,
      visitaRealizada: fila.visitaRealizada,
      fianzaEur: aImporte(fila.fianzaEur),
      fianzaCobradaFecha: fila.fianzaCobradaFecha,
      fianzaDevueltaFecha: fila.fianzaDevueltaFecha,
      fianzaDevueltaEur: aImporte(fila.fianzaDevueltaEur),
      condPartFirmadas: fila.condPartFirmadas,
      condPartFechaEnvio: fila.condPartEnviadasFecha,
      condPartFechaFirma: fila.condPartFirmadasFecha,
      preEventoStatus: fila.preEventoStatus,
      liquidacionStatus: fila.liquidacionStatus,
      fianzaStatus: fila.fianzaStatus,
      posicionCola: fila.posicionCola,
      consultaBloqueanteId: fila.consultaBloqueanteId,
      notas: fila.notas,
      fechaCreacion: fila.fechaCreacion,
      tieneBorradorE1Pendiente,
      cliente: {
        idCliente: fila.cliente.idCliente,
        nombre: fila.cliente.nombre,
        apellidos: fila.cliente.apellidos,
        email: fila.cliente.email,
        telefono: fila.cliente.telefono,
        dniNif: fila.cliente.dniNif,
        direccion: fila.cliente.direccion,
        codigoPostal: fila.cliente.codigoPostal,
        poblacion: fila.cliente.poblacion,
        provincia: fila.cliente.provincia,
        ibanDevolucion: fila.cliente.ibanDevolucion,
      },
    };
  }
}
