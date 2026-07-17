/**
 * QUERY de APLICACIÓN: listar el HISTÓRICO de reservas CERRADAS del tenant
 * (`GET /historico` → `ReservaHistoricoListResponse`, US-042 / UC-32).
 *
 * SOLO LECTURA (CQRS-lite, hermano de `ListarReservasUseCase`): NO abre transacción de
 * escritura, NO toca la máquina de estados, NO registra AUDIT_LOG y NO produce bloqueos
 * (design.md §D-6: lectura pura sobre estados terminales e inmutables). Proyecta cada
 * RESERVA cerrada a la fila LIGERA del contrato `ReservaHistorico`, SIN los derivados del
 * pipeline (`progressLogistica`/`progressLiquidacion`) ni los transitorios de consulta/cola.
 *
 * Normaliza `estadoFinal`: AUSENTE ⇒ solo `reserva_completada`; opt-in explícito de
 * `reserva_cancelada`. El aislamiento multi-tenant (filtro por `tenant_id` + RLS), la
 * restricción al estado cerrado, la búsqueda full-text, el AND de filtros estructurados, el
 * orden por `fechaEvento` DESC y la paginación los aplica el ADAPTADOR detrás del puerto
 * `HistoricoQueryPort`; el use-case orquesta y proyecta.
 *
 * Hexagonal (hook `no-infra-in-domain`): depende SOLO del puerto inyectado; no importa
 * Prisma ni `@nestjs/*`. El puerto y sus read-models viven en `domain/`; se re-exportan
 * desde aquí como API de la capa de aplicación.
 */
import type {
  EstadoHistorico,
  HistoricoPaginaLectura,
  HistoricoQueryPort,
  HistoricoReservaLectura,
} from '../domain/listar-historico.port';

// Re-export de los tipos del puerto de dominio como API de la capa de aplicación
// (los controllers/tests importan desde aquí sin acoplarse a la ruta de `domain/`).
export type {
  EstadoHistorico,
  HistoricoPaginaLectura,
  HistoricoQueryFiltros,
  HistoricoQueryPort,
  HistoricoReservaLectura,
} from '../domain/listar-historico.port';

/** Estado cerrado por defecto cuando `estadoFinal` está ausente (nunca canceladas). */
const ESTADO_FINAL_POR_DEFECTO: EstadoHistorico = 'reserva_completada';

/** Metadatos de paginación del contrato (`PaginationMetadata`). */
export interface HistoricoListMetadata {
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

/** Fila LIGERA proyectada a la forma del contrato `ReservaHistorico`. */
export interface ReservaHistorico {
  idReserva: string;
  codigo: string;
  clienteId: string;
  clienteNombre: string | null;
  clienteApellidos: string | null;
  estado: EstadoHistorico;
  fechaEvento: string | null;
  tipoEvento: string | null;
  importeTotal: string | null;
}

/** Envoltorio de respuesta (`ReservaHistoricoListResponse`). */
export interface HistoricoListResponse {
  data: ReservaHistorico[];
  metadata: HistoricoListMetadata;
}

/** Dependencias del query (puerto inyectado). */
export interface ListarHistoricoDeps {
  historico: HistoricoQueryPort;
}

/** Comando de lectura: tenant del JWT + filtros/paginación de query. */
export interface ListarHistoricoComando {
  tenantId: string;
  estadoFinal?: EstadoHistorico;
  q?: string;
  fechaDesde?: Date;
  fechaHasta?: Date;
  tipoEvento?: string;
  importeMin?: string;
  importeMax?: string;
  page: number;
  limit: number;
}

/** Calcula el número total de páginas (0 si no hay datos ni límite válido). */
const calcularTotalPaginas = (total: number, limit: number): number =>
  limit <= 0 ? 0 : Math.ceil(total / limit);

/**
 * Serializa un `Date` (columna DATE) al `date` del contrato (`YYYY-MM-DD`) en UTC; `null`
 * si la fecha del evento no está fijada. Mismo criterio que el resto del backend
 * (`toISOString().slice(0, 10)`): NUNCA emite un date-time ISO completo.
 */
const aFechaDate = (fecha: Date | null): string | null =>
  fecha === null ? null : fecha.toISOString().slice(0, 10);

export class ListarHistoricoUseCase {
  constructor(private readonly deps: ListarHistoricoDeps) {}

  async ejecutar(comando: ListarHistoricoComando): Promise<HistoricoListResponse> {
    const pagina = await this.deps.historico.listarCerradas({
      tenantId: comando.tenantId,
      // AUSENTE ⇒ solo `reserva_completada`; opt-in explícito de canceladas.
      estadoFinal: comando.estadoFinal ?? ESTADO_FINAL_POR_DEFECTO,
      q: comando.q,
      fechaDesde: comando.fechaDesde,
      fechaHasta: comando.fechaHasta,
      tipoEvento: comando.tipoEvento,
      importeMin: comando.importeMin,
      importeMax: comando.importeMax,
      page: comando.page,
      limit: comando.limit,
    });

    return {
      data: pagina.items.map((fila) => this.proyectar(fila)),
      metadata: this.aMetadata(pagina),
    };
  }

  /** Proyecta una fila del read-model a la fila LIGERA del contrato `ReservaHistorico`. */
  private proyectar(fila: HistoricoReservaLectura): ReservaHistorico {
    return {
      idReserva: fila.idReserva,
      codigo: fila.codigo,
      clienteId: fila.clienteId,
      clienteNombre: fila.clienteNombre,
      clienteApellidos: fila.clienteApellidos,
      estado: fila.estado,
      // `fechaEvento` es una columna DATE: se emite como `date` (YYYY-MM-DD), no ISO.
      fechaEvento: aFechaDate(fila.fechaEvento),
      tipoEvento: fila.tipoEvento,
      importeTotal: fila.importeTotal,
    };
  }

  /** Deriva la metadata de paginación (`totalPages` calculado a partir de total/limit). */
  private aMetadata(pagina: HistoricoPaginaLectura): HistoricoListMetadata {
    return {
      total: pagina.total,
      page: pagina.page,
      limit: pagina.limit,
      totalPages: calcularTotalPaginas(pagina.total, pagina.limit),
    };
  }
}
