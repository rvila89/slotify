/**
 * Puerto de LECTURA del pipeline de reservas activas — DOMINIO PURO (US-049 / UC-37 /
 * UC-38).
 *
 * Define el puerto de consulta `PipelineQueryPort` (implementado por un adaptador Prisma
 * en infraestructura) + los read-models de la fila de RESERVA activa y su página, y las
 * FUNCIONES PURAS de derivación de los tres campos de presentación del pipeline:
 * `progressLogistica`, `progressLiquidacion` (mapa declarativo estado→progreso) y
 * `nombreEvento` (concatenación del cliente con fallback al `codigo`).
 *
 * El progreso se modela como ESTRUCTURA DE DATOS declarativa (skill `state-machine`,
 * NO condicionales dispersos): un mapa `status → progreso`. Las reservas en estados de
 * consulta (`2a`/`2b`/`2c`/`2d`/`2v`) y en `pre_reserva` arrancan SIEMPRE en `0` (aún no
 * hay sub-proceso de pre-evento ni liquidación en curso), con independencia del valor
 * bruto de `preEventoStatus`/`liquidacionStatus`.
 *
 * Hexagonal (hook `no-infra-in-domain`): este módulo NO importa `@nestjs/*`, Prisma ni
 * infraestructura. Solo depende de los tipos de dominio (`EstadoReserva`,
 * `SubEstadoConsulta`).
 */
import type { EstadoReserva, SubEstadoConsulta } from './maquina-estados';

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

// ---------------------------------------------------------------------------
// Derivación declarativa del progreso del pipeline (mapa status → 0/50/100)
// ---------------------------------------------------------------------------

/**
 * Mapa declarativo `preEventoStatus → progressLogistica` (skill `state-machine`, NO
 * condicionales dispersos): `pendiente = 0`, `en_curso = 50`, `cerrado = 100`. Un status
 * ausente del mapa cae a `0` (defensivo).
 */
const MAPA_PROGRESO_LOGISTICA: Readonly<Record<string, number>> = {
  pendiente: 0,
  en_curso: 50,
  cerrado: 100,
};

/**
 * Mapa declarativo `liquidacionStatus → progressLiquidacion` (skill `state-machine`, NO
 * condicionales dispersos): `pendiente = 0`, `facturada = 50`, `cobrada = 100`. Un status
 * ausente del mapa cae a `0` (defensivo).
 */
const MAPA_PROGRESO_LIQUIDACION: Readonly<Record<string, number>> = {
  pendiente: 0,
  facturada: 50,
  cobrada: 100,
};

/**
 * Determina si la reserva está en una fase PREVIA al sub-proceso de pre-evento /
 * liquidación: cualquier sub-estado de `consulta` (`2a`/`2b`/`2c`/`2d`/`2v`) o
 * `pre_reserva`. En estas fases ambos progresos son SIEMPRE `0`, con independencia del
 * valor bruto de `preEventoStatus`/`liquidacionStatus`.
 */
const esFasePreviaAlProgreso = (estado: EstadoReserva): boolean =>
  estado === 'consulta' || estado === 'pre_reserva';

/**
 * Función PURA: deriva `progressLogistica` (entero 0-100) desde `preEventoStatus`. Para
 * reservas en consulta o `pre_reserva` devuelve `0` (aún no hay pre-evento en curso).
 */
export const derivarProgressLogistica = (
  estado: EstadoReserva,
  preEventoStatus: string,
): number =>
  esFasePreviaAlProgreso(estado)
    ? 0
    : MAPA_PROGRESO_LOGISTICA[preEventoStatus] ?? 0;

/**
 * Función PURA: deriva `progressLiquidacion` (entero 0-100) desde `liquidacionStatus`.
 * Para reservas en consulta o `pre_reserva` devuelve `0` (aún no hay liquidación).
 */
export const derivarProgressLiquidacion = (
  estado: EstadoReserva,
  liquidacionStatus: string,
): number =>
  esFasePreviaAlProgreso(estado)
    ? 0
    : MAPA_PROGRESO_LIQUIDACION[liquidacionStatus] ?? 0;

/**
 * Función PURA: deriva `nombreEvento` como `{cliente.nombre} {cliente.apellidos}` del
 * CLIENTE asociado. Cuando no hay cliente resoluble (`null`) o el nombre resultante queda
 * vacío, usa el `codigo` de la reserva como fallback.
 */
export const derivarNombreEvento = (
  cliente: PipelineClienteLectura | null,
  codigo: string,
): string => {
  if (cliente === null) {
    return codigo;
  }
  const nombreCompleto = [cliente.nombre, cliente.apellidos]
    .filter((parte): parte is string => parte !== null && parte.trim() !== '')
    .join(' ')
    .trim();
  return nombreCompleto === '' ? codigo : nombreCompleto;
};
