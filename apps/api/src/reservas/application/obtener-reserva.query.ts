/**
 * QUERY de APLICACIÓN: leer el detalle de una RESERVA por id dentro del tenant
 * (`GET /reservas/{id}` → `ReservaDetalle`, UC-04 / ficha de consulta US-005).
 *
 * Es una operación de SOLO LECTURA (CQRS-lite): no abre transacción de escritura ni
 * toca la máquina de estados; solo proyecta la RESERVA + su CLIENTE a la forma del
 * contrato. El aislamiento multi-tenant lo garantiza el adaptador (RLS / filtrado por
 * `tenant_id`): una RESERVA de otro tenant es INVISIBLE (→ `null` → 404).
 *
 * Hexagonal: depende SOLO del puerto inyectado (`ReservaDetalleQueryPort`); no importa
 * Prisma ni `@nestjs/*`. La forma del read-model (`ReservaDetalleLectura`) es el
 * contrato entre la aplicación y la infraestructura, en español/camelCase.
 */
import type { EstadoReserva, SubEstadoConsulta } from '../domain/maquina-estados';

/** Proyección del CLIENTE embebido en el detalle de la reserva (contrato `Cliente`). */
export interface ClienteLectura {
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
}

/**
 * Read-model del detalle de una RESERVA (contrato `ReservaDetalle` = `Reserva` +
 * `cliente`). Los importes viajan como `string` (`Decimal(10,2)`, sin coma flotante)
 * o `null`; las fechas como `Date` o `null` (el mapeo HTTP a `date`/`date-time` vive
 * en el controlador). Los derivados por sub-estado (`ttlExpiracion` en 2b,
 * `posicionCola`/`consultaBloqueanteId` en 2d) son columnas reales de la RESERVA, no
 * se recalculan aquí.
 */
export interface ReservaDetalleLectura {
  idReserva: string;
  codigo: string;
  clienteId: string;
  estado: EstadoReserva;
  subEstado: SubEstadoConsulta | null;
  canalEntrada: string;
  fechaEvento: Date | null;
  duracionHoras: number | null;
  tipoEvento: string | null;
  horario?: string | null;
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
  // fix-liquidacion-fianza-independientes: marca de subida del comprobante (fianza pasiva);
  // se retiran `fianzaDevueltaEur` (devolución completa) e `ibanDevolucion` (captura de IBAN).
  fianzaComprobanteFecha: Date | null;
  condPartFirmadas: boolean | null;
  condPartFechaEnvio: Date | null;
  condPartFechaFirma: Date | null;
  preEventoStatus: string;
  liquidacionStatus: string;
  fianzaStatus: string;
  posicionCola: number | null;
  consultaBloqueanteId: string | null;
  notas: string | null;
  comentarios: string | null;
  fechaCreacion: Date;
  /**
   * US-047: `true` cuando la reserva tiene una COMUNICACION E1 en estado `borrador`
   * pendiente de revisar/enviar. Se deriva de la subconsulta de comunicaciones (igual
   * que en el pipeline `GET /reservas`), para que la ficha bloquee las acciones que
   * dependen de un E1 ya enviado. OPCIONAL/aditivo (contrato `Reserva`): solo lo
   * proyecta la lectura del detalle (`GET /reservas/{id}`); los use-cases de transición
   * que reutilizan este read-model pueden omitirlo.
   */
  tieneBorradorE1Pendiente?: boolean;
  cliente: ClienteLectura;
}

/** Puerto de lectura del detalle de la RESERVA (implementado por un adaptador Prisma). */
export interface ReservaDetalleQueryPort {
  /**
   * Lee la RESERVA por id bajo el contexto RLS del tenant; `null` si no existe o
   * pertenece a otro tenant (cross-tenant invisible → 404).
   */
  buscarDetalle(params: {
    tenantId: string;
    reservaId: string;
  }): Promise<ReservaDetalleLectura | null>;
}

/** La RESERVA no existe para el tenant (RLS): cross-tenant es invisible → 404. */
export class ReservaDetalleNoEncontradaError extends Error {
  readonly codigo = 'RESERVA_NO_ENCONTRADA' as const;
  readonly reservaId: string;

  constructor(reservaId: string) {
    super('La reserva no existe para el tenant');
    this.name = 'ReservaDetalleNoEncontradaError';
    this.reservaId = reservaId;
  }
}

/** Dependencias del query (puerto inyectado). */
export interface ObtenerReservaDeps {
  reservaDetalle: ReservaDetalleQueryPort;
}

/** Comando de lectura: tenant del JWT + id de la RESERVA del path. */
export interface ObtenerReservaComando {
  tenantId: string;
  reservaId: string;
}

export class ObtenerReservaUseCase {
  constructor(private readonly deps: ObtenerReservaDeps) {}

  async ejecutar(
    comando: ObtenerReservaComando,
  ): Promise<ReservaDetalleLectura> {
    const detalle = await this.deps.reservaDetalle.buscarDetalle({
      tenantId: comando.tenantId,
      reservaId: comando.reservaId,
    });
    if (detalle === null) {
      throw new ReservaDetalleNoEncontradaError(comando.reservaId);
    }
    return detalle;
  }
}
