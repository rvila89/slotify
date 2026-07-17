/**
 * QUERY de APLICACIÓN: listar el PIPELINE de reservas ACTIVAS del tenant
 * (`GET /reservas` → `ReservaListResponse`, US-049 / UC-37 / UC-38).
 *
 * SOLO LECTURA (CQRS-lite, hermano de `ObtenerReservaUseCase`): NO abre transacción de
 * escritura, NO toca la máquina de estados, NO registra AUDIT_LOG y NO produce bloqueos.
 * Proyecta cada RESERVA activa a la forma del contrato `Reserva`, derivando los tres
 * campos de presentación del pipeline: `nombreEvento`, `progressLogistica` y
 * `progressLiquidacion` mediante las FUNCIONES PURAS del puerto de dominio
 * (`listar-reservas.port`, mapa declarativo estado→progreso).
 *
 * El aislamiento multi-tenant (RLS / filtrado por `tenant_id`), la exclusión de estados
 * terminales (`2x`/`2y`/`2z`) y cerrados (`reserva_completada`/`reserva_cancelada`), el
 * orden por `fechaCreacion` DESC, la paginación y los filtros de query los aplica el
 * ADAPTADOR detrás del puerto `PipelineQueryPort`; el use-case orquesta y proyecta.
 *
 * Hexagonal (hook `no-infra-in-domain`): depende SOLO del puerto inyectado; no importa
 * Prisma ni `@nestjs/*`. El puerto y sus read-models viven en `domain/`; se re-exportan
 * desde aquí como API de la capa de aplicación.
 */
import type { EstadoReserva, SubEstadoConsulta } from '../domain/maquina-estados';
import {
  derivarNombreEvento,
  derivarProgressLiquidacion,
  derivarProgressLogistica,
  type PipelinePaginaLectura,
  type PipelineQueryPort,
  type PipelineReservaLectura,
} from '../domain/listar-reservas.port';

// Re-export de los tipos del puerto de dominio como API de la capa de aplicación
// (los controllers/tests importan desde aquí sin acoplarse a la ruta de `domain/`).
export type {
  PipelineClienteLectura,
  PipelinePaginaLectura,
  PipelineQueryFiltros,
  PipelineQueryPort,
  PipelineReservaLectura,
} from '../domain/listar-reservas.port';

/** Metadatos de paginación del contrato (`PaginationMetadata`). */
export interface ReservaListMetadata {
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

/** Elemento proyectado a la forma del contrato `Reserva` con los derivados del pipeline. */
export interface ReservaPipelineItem {
  idReserva: string;
  codigo: string;
  estado: EstadoReserva;
  subEstado: SubEstadoConsulta | null;
  fechaCreacion: string;
  fechaEvento: string | null;
  numInvitadosFinal: number | null;
  numAdultosNinosMayores4: number | null;
  numNinosMenores4: number | null;
  notas: string | null;
  nombreEvento: string;
  progressLogistica: number;
  progressLiquidacion: number;
  /**
   * `true` si la reserva tiene un borrador E1 pendiente de revisar/enviar (US-047).
   * Permite a la UI del pipeline señalar la acción manual del Gestor.
   */
  tieneBorradorE1Pendiente: boolean;
}

/** Envoltorio de respuesta (`ReservaListResponse`). */
export interface ReservaListResponse {
  data: ReservaPipelineItem[];
  metadata: ReservaListMetadata;
}

/** Dependencias del query (puerto inyectado). */
export interface ListarReservasDeps {
  pipeline: PipelineQueryPort;
}

/** Comando de lectura: tenant del JWT + filtros/paginación de query. */
export interface ListarReservasComando {
  tenantId: string;
  estado?: EstadoReserva;
  subEstado?: SubEstadoConsulta;
  fechaDesde?: Date;
  fechaHasta?: Date;
  search?: string;
  page: number;
  limit: number;
}

/** Calcula el número total de páginas (mínimo 1 cuando hay datos; 0 si no los hay). */
const calcularTotalPaginas = (total: number, limit: number): number =>
  limit <= 0 ? 0 : Math.ceil(total / limit);

/**
 * Serializa un `Date` (columna DATE) al `date` del contrato (`YYYY-MM-DD`) en UTC;
 * `null` si la fecha del evento aún no está fijada. Mismo criterio que el resto del
 * backend (`toISOString().slice(0, 10)`): NUNCA emite un date-time ISO completo.
 */
const aFechaDate = (fecha: Date | null): string | null =>
  fecha === null ? null : fecha.toISOString().slice(0, 10);

export class ListarReservasUseCase {
  constructor(private readonly deps: ListarReservasDeps) {}

  async ejecutar(comando: ListarReservasComando): Promise<ReservaListResponse> {
    const pagina = await this.deps.pipeline.listarActivas({
      tenantId: comando.tenantId,
      estado: comando.estado,
      subEstado: comando.subEstado,
      fechaDesde: comando.fechaDesde,
      fechaHasta: comando.fechaHasta,
      search: comando.search,
      page: comando.page,
      limit: comando.limit,
    });

    return {
      data: pagina.items.map((fila) => this.proyectar(fila)),
      metadata: this.aMetadata(pagina),
    };
  }

  /** Proyecta una fila del read-model a la forma del contrato `Reserva` con derivados. */
  private proyectar(fila: PipelineReservaLectura): ReservaPipelineItem {
    return {
      idReserva: fila.idReserva,
      codigo: fila.codigo,
      estado: fila.estado,
      subEstado: fila.subEstado,
      fechaCreacion: fila.fechaCreacion.toISOString(),
      // `fechaEvento` es una columna DATE: se emite como `date` (YYYY-MM-DD), no ISO.
      fechaEvento: aFechaDate(fila.fechaEvento),
      numInvitadosFinal: fila.numInvitadosFinal,
      numAdultosNinosMayores4: fila.numAdultosNinosMayores4,
      numNinosMenores4: fila.numNinosMenores4,
      notas: fila.notas,
      nombreEvento: derivarNombreEvento(fila.cliente, fila.codigo),
      progressLogistica: derivarProgressLogistica(fila.estado, fila.preEventoStatus),
      progressLiquidacion: derivarProgressLiquidacion(
        fila.estado,
        fila.liquidacionStatus,
      ),
      tieneBorradorE1Pendiente: fila.tieneBorradorE1Pendiente,
    };
  }

  /** Deriva la metadata de paginación (`totalPages` calculado a partir de total/limit). */
  private aMetadata(pagina: PipelinePaginaLectura): ReservaListMetadata {
    return {
      total: pagina.total,
      page: pagina.page,
      limit: pagina.limit,
      totalPages: calcularTotalPaginas(pagina.total, pagina.limit),
    };
  }
}
