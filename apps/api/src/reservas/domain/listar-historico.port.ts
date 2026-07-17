/**
 * Puerto de LECTURA del histórico de reservas CERRADAS — DOMINIO PURO (US-042 / UC-32).
 *
 * Define el puerto de consulta `HistoricoQueryPort` (implementado por un adaptador Prisma
 * en infraestructura) + los read-models de la fila LIGERA de RESERVA cerrada y su página.
 *
 * A diferencia del pipeline (US-049), la fila del histórico NO lleva los derivados del
 * pipeline (`progressLogistica`/`progressLiquidacion`) ni los transitorios de consulta/
 * cola/visita (`ttlExpiracion`, `posicionCola`, `consultaBloqueanteId`, ...). Es una
 * proyección de solo lectura sobre estados terminales e inmutables (design.md §D-1).
 *
 * Hexagonal (hook `no-infra-in-domain`): este módulo NO importa `@nestjs/*`, Prisma ni
 * infraestructura. Solo depende de tipos primitivos y de dominio.
 */

/** Estados CERRADOS admitidos por el histórico (nunca activos ni terminales de consulta). */
export type EstadoHistorico = 'reserva_completada' | 'reserva_cancelada';

/**
 * Read-model de una RESERVA cerrada del histórico (join a CLIENTE para presentación).
 * `fechaEvento` viaja como `Date | null` (columna DATE; el mapeo a `YYYY-MM-DD` lo hace la
 * capa de aplicación). Los importes viajan como `string` (`Decimal(10,2)`) o `null`.
 */
export interface HistoricoReservaLectura {
  idReserva: string;
  codigo: string;
  clienteId: string;
  clienteNombre: string | null;
  clienteApellidos: string | null;
  estado: EstadoHistorico;
  fechaEvento: Date | null;
  tipoEvento: string | null;
  importeTotal: string | null;
}

/** Página de lectura devuelta por el adaptador (items ya filtrados/ordenados + totales). */
export interface HistoricoPaginaLectura {
  items: HistoricoReservaLectura[];
  total: number;
  page: number;
  limit: number;
}

/**
 * Filtros de query aplicables sobre el conjunto CERRADO del tenant. Todos se combinan con
 * AND en el adaptador; el filtro base inmutable (`tenantId` + `estadoFinal`) se aplica
 * siempre antes que los filtros del usuario. Los importes son `string` (`Decimal(10,2)`).
 */
export interface HistoricoQueryFiltros {
  tenantId: string;
  estadoFinal: EstadoHistorico;
  q?: string;
  fechaDesde?: Date;
  fechaHasta?: Date;
  tipoEvento?: string;
  importeMin?: string;
  importeMax?: string;
  page: number;
  limit: number;
}

/**
 * Puerto de lectura del histórico (implementado por un adaptador Prisma). El adaptador
 * garantiza: filtro por `tenant_id` explícito + RLS, restricción al estado cerrado
 * (`estadoFinal`), búsqueda full-text `q`, filtros estructurados AND, orden por
 * `fechaEvento` DESC y paginación.
 */
export interface HistoricoQueryPort {
  listarCerradas(filtros: HistoricoQueryFiltros): Promise<HistoricoPaginaLectura>;
}
