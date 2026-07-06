/**
 * QUERY de APLICACIÓN: listar el PIPELINE de reservas ACTIVAS del tenant
 * (`GET /reservas` → `ReservaListResponse`, US-049 / UC-37 / UC-38).
 *
 * SOLO LECTURA (CQRS-lite, hermano de `ObtenerReservaUseCase`): NO abre transacción de
 * escritura, NO toca la máquina de estados, NO registra AUDIT_LOG y NO produce bloqueos.
 * Proyecta cada RESERVA activa a la forma del contrato `Reserva`, derivando los tres
 * campos de presentación del pipeline: `nombreEvento`, `progressLogistica` y
 * `progressLiquidacion` (mapa declarativo estado→progreso, función pura).
 *
 * El aislamiento multi-tenant (RLS / filtrado por `tenant_id`), la exclusión de estados
 * terminales (`2x`/`2y`/`2z`) y cerrados (`reserva_completada`/`reserva_cancelada`), el
 * orden por `fechaCreacion` DESC, la paginación y los filtros de query los aplica el
 * ADAPTADOR detrás del puerto `PipelineQueryPort`; el use-case orquesta y proyecta.
 *
 * Hexagonal (hook `no-infra-in-domain`): depende SOLO del puerto inyectado; no importa
 * Prisma ni `@nestjs/*`.
 *
 * ⚠️ FASE TDD-RED (US-049 §3): este archivo es un STUB de tipos + contrato para que la
 * batería `listar-reservas.use-case.spec.ts` COMPILE pero FALLE. `ejecutar()` lanza
 * `NotImplementedError` a propósito; la implementación real llega en §5 (backend).
 */
import type { EstadoReserva, SubEstadoConsulta } from '../domain/maquina-estados';

/** Proyección del CLIENTE embebido en la fila de pipeline (para derivar `nombreEvento`). */
export interface PipelineClienteLectura {
  idCliente: string;
  nombre: string;
  apellidos: string | null;
  email: string | null;
  telefono: string | null;
  dniNif: string | null;
  direccion: string | null;
  codigoPostal: string | null;
  poblacion: string | null;
  provincia: string | null;
  ibanDevolucion: string | null;
}

/**
 * Read-model de una RESERVA activa del pipeline (join a CLIENTE). Espejo del read-model
 * de detalle, pero `cliente` puede ser `null` (fallback de `nombreEvento` al `codigo`).
 * Los importes viajan como `string` (`Decimal(10,2)`) o `null`; las fechas como `Date`.
 */
export interface PipelineReservaLectura {
  idReserva: string;
  codigo: string;
  clienteId: string;
  estado: EstadoReserva;
  subEstado: SubEstadoConsulta | null;
  canalEntrada: string;
  fechaEvento: Date | null;
  duracionHoras: number | null;
  tipoEvento: string | null;
  numAdultosNinosMayores4: number | null;
  numNinosMenores4: number | null;
  numInvitadosFinal: number | null;
  importeTotal: string | null;
  importeSenal: string | null;
  importeLiquidacion: string | null;
  ttlExpiracion: Date | null;
  visitaProgramadaFecha: Date | null;
  visitaProgramadaHora: string | null;
  visitaRealizada: boolean | null;
  fianzaEur: string | null;
  fianzaCobradaFecha: Date | null;
  fianzaDevueltaFecha: Date | null;
  fianzaDevueltaEur: string | null;
  condPartFirmadas: boolean | null;
  condPartFechaEnvio: Date | null;
  condPartFechaFirma: Date | null;
  preEventoStatus: string;
  liquidacionStatus: string;
  fianzaStatus: string;
  posicionCola: number | null;
  consultaBloqueanteId: string | null;
  notas: string | null;
  fechaCreacion: Date;
  cliente: PipelineClienteLectura | null;
}

/** Página de lectura devuelta por el adaptador (items ya filtrados/ordenados + totales). */
export interface PipelinePaginaLectura {
  items: PipelineReservaLectura[];
  total: number;
  page: number;
  limit: number;
}

/** Filtros de query aplicables sobre el conjunto de activas del tenant. */
export interface PipelineQueryFiltros {
  tenantId: string;
  estado?: EstadoReserva;
  subEstado?: SubEstadoConsulta;
  fechaDesde?: Date;
  fechaHasta?: Date;
  search?: string;
  page: number;
  limit: number;
}

/**
 * Puerto de lectura del pipeline (implementado por un adaptador Prisma). El adaptador
 * garantiza: filtro por `tenant_id` + RLS, exclusión de terminales/cerrados, orden por
 * `fechaCreacion` DESC, paginación y filtros de query.
 */
export interface PipelineQueryPort {
  listarActivas(filtros: PipelineQueryFiltros): Promise<PipelinePaginaLectura>;
}

/** Metadatos de paginación del contrato (`PaginationMetadata`). */
export interface ReservaListMetadata {
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

/** Elemento proyectado a la forma del contrato `Reserva` con los derivados del pipeline. */
export interface ReservaPipelineItem {
  id: string;
  codigo: string;
  estado: EstadoReserva;
  subEstado: SubEstadoConsulta | null;
  fechaCreacion: string;
  nombreEvento: string;
  progressLogistica: number;
  progressLiquidacion: number;
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

/** STUB TDD-RED: se elimina cuando §5 implemente el use-case. */
class NotImplementedError extends Error {
  constructor() {
    super('ListarReservasUseCase no está implementado todavía (TDD-RED US-049)');
    this.name = 'NotImplementedError';
  }
}

export class ListarReservasUseCase {
  constructor(private readonly deps: ListarReservasDeps) {
    void this.deps;
  }

  async ejecutar(_comando: ListarReservasComando): Promise<ReservaListResponse> {
    void _comando;
    throw new NotImplementedError();
  }
}
