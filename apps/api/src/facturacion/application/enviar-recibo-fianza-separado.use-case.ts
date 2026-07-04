/**
 * Caso de uso de APLICACIÓN: enviar el recibo de fianza por separado (US-028 / UC-22, D-3).
 *
 * Edge case sin liquidación: el Gestor envía al cliente SOLO el recibo de fianza. Precondición:
 * la FACTURA `tipo='fianza'` está en `estado='borrador'`. Al confirmarse el envío (misma
 * atomicidad estado↔email de D-1): emite la fianza (`estado='enviada'`, `numero_factura`
 * PROPIO secuencial, `fecha_emision`), avanza `RESERVA.fianza_status='recibo_enviado'` SIN
 * tocar `liquidacion_status`, y registra la COMUNICACION con `codigo_email='manual'` (NO E4):
 * queda fuera del índice de idempotencia parcial `(reserva_id, codigo_email)` y no colisiona
 * con un posterior E4 de la misma reserva.
 *
 * Hexagonal (hook `no-infra-in-domain`): depende SOLO de puertos inyectados; no importa Prisma.
 */
import { siguienteNumeroFactura } from '../domain/numeracion-factura';
import type { EstadoFactura, TipoFactura } from '../domain/factura';

/** Reloj inyectable para determinismo. */
export interface ClockPort {
  ahora(): Date;
}

/** Sub-estados de la RESERVA relevantes. */
export type LiquidacionStatus = 'pendiente' | 'facturada' | 'cobrada';
export type FianzaStatus =
  | 'pendiente'
  | 'recibo_enviado'
  | 'cobrada'
  | 'devuelta'
  | 'retenida_parcial';

/** Comando del envío separado del recibo de fianza. */
export interface EnviarReciboFianzaSeparadoComando {
  tenantId: string;
  usuarioId: string;
  reservaId: string;
}

/** FACTURA de fianza emitible (borrador). */
export interface FacturaFianzaEmitible {
  idFactura: string;
  tenantId: string;
  reservaId: string;
  numeroFactura: string | null;
  tipo: TipoFactura;
  estado: EstadoFactura;
  total: string;
  baseImponible: string;
  ivaPorcentaje: string;
  ivaImporte: string;
  pdfUrl: string | null;
  fechaEmision: Date | null;
}

/** Proyección de la RESERVA para el envío separado. */
export interface ReservaFianza {
  idReserva: string;
  tenantId: string;
  clienteId: string;
  codigo: string;
  liquidacionStatus: LiquidacionStatus;
  fianzaStatus: FianzaStatus;
  clienteEmail: string;
}

/** Parámetros de emisión de la fianza (borrador → enviada). */
export interface EmitirFianzaParams {
  idFactura: string;
  tipo: 'fianza';
  numeroFactura: string;
  estado: 'enviada';
  fechaEmision: Date;
}

/** Repositorio tx-bound de FACTURA (fianza). */
export interface FacturasFianzaPort {
  buscarPorReservaYTipo(
    reservaId: string,
    tipo: 'liquidacion' | 'fianza',
  ): Promise<FacturaFianzaEmitible | null>;
  ultimoNumeroDelAnio(tenantId: string, anio: number): Promise<string | null>;
  emitir(params: EmitirFianzaParams): Promise<void>;
}

/** Repositorio tx-bound de la RESERVA (avance de fianza; NO se toca liquidación). */
export interface ReservasFianzaPort {
  avanzarFianzaStatus(params: {
    reservaId: string;
    estado: 'recibo_enviado';
  }): Promise<void>;
  avanzarLiquidacionStatus(params: {
    reservaId: string;
    estado: 'facturada';
  }): Promise<void>;
}

/** Proyección de la COMUNICACION creada. */
export interface ComunicacionFianza {
  idComunicacion: string;
  estado: string;
  fechaEnvio: Date | null;
}

/** Repositorio tx-bound de COMUNICACION (manual). */
export interface ComunicacionesFianzaPort {
  crear(params: {
    tenantId: string;
    reservaId: string;
    clienteId: string;
    codigoEmail: 'manual';
    estado: 'enviado';
    fechaEnvio: Date;
    destinatarioEmail: string;
  }): Promise<ComunicacionFianza>;
}

/** Repositorio tx-bound de AUDIT_LOG. */
export interface AuditoriaFianzaPort {
  registrar(registro: {
    tenantId: string;
    usuarioId?: string | null;
    entidad: 'FACTURA' | 'RESERVA' | 'COMUNICACION';
    entidadId: string;
    accion: 'actualizar' | 'crear';
    datosAnteriores?: Record<string, unknown> | null;
    datosNuevos?: Record<string, unknown> | null;
  }): Promise<void>;
}

/** Conjunto de repositorios disponibles dentro de la unidad de trabajo. */
export interface RepositoriosFianzaSeparada {
  facturas: FacturasFianzaPort;
  reservas: ReservasFianzaPort;
  comunicaciones: ComunicacionesFianzaPort;
  auditoria: AuditoriaFianzaPort;
}

/** Unidad de trabajo transaccional (tx + RLS); el envío vive dentro (atomicidad D-1). */
export interface UnidadDeTrabajoFianzaPort {
  ejecutar(
    tenantId: string,
    trabajo: (repos: RepositoriosFianzaSeparada) => Promise<unknown>,
  ): Promise<unknown>;
}

/** Lectura de la RESERVA (RLS: cross-tenant → null). */
export interface CargarReservaFianzaPort {
  (params: {
    tenantId: string;
    reservaId: string;
  }): Promise<ReservaFianza | null | undefined>;
}

/** Adjunto por referencia a `pdf_url`. */
export interface AdjuntoFianza {
  clave: string;
  nombre: string;
  pdfUrl: string;
}

/** Parámetros del envío del recibo (email `manual`). */
export interface EnviarReciboFianzaParams {
  tenantId: string;
  reservaId: string;
  destinatario: string;
  codigoReserva: string;
  codigoEmail: 'manual';
  adjuntos: AdjuntoFianza[];
  /** Índice laxo: permite que el doble de test tipe los params como `Record`. */
  [extra: string]: unknown;
}

/** Puerto de envío del recibo (email `manual`, síncrono/confirmado). */
export interface EnviarReciboFianzaPort {
  (
    params: EnviarReciboFianzaParams,
  ): Promise<{ idComunicacion: string; estado: 'enviado'; fechaEnvio: Date }>;
}

/** Dependencias del caso de uso (puertos inyectados). */
export interface EnviarReciboFianzaSeparadoDeps {
  unidadDeTrabajo: UnidadDeTrabajoFianzaPort;
  cargarReserva: CargarReservaFianzaPort;
  enviarRecibo: EnviarReciboFianzaPort;
  clock: ClockPort;
}

/** Resultado del envío separado: la fianza emitida + status. */
export interface EnviarReciboFianzaSeparadoResultado {
  fianza: FacturaFianzaEmitible;
  fianzaStatus: 'recibo_enviado';
}

// ---------------------------------------------------------------------------
// Errores de dominio tipados, en español
// ---------------------------------------------------------------------------

/** El recibo de fianza (o la reserva) no existe para el tenant (RLS) → HTTP 404. */
export class FacturaFianzaNoEncontradaError extends Error {
  readonly codigo = 'FACTURA_FIANZA_NO_ENCONTRADA' as const;
  readonly reservaId: string;

  constructor(reservaId: string) {
    super('No hay recibo de fianza en borrador para la reserva');
    this.name = 'FacturaFianzaNoEncontradaError';
    this.reservaId = reservaId;
  }
}

/** El recibo de fianza no está en `borrador` (ya enviado) → HTTP 409. */
export class FacturaNoBorradorError extends Error {
  readonly codigo = 'FACTURA_NO_BORRADOR' as const;
  readonly motivo: string;

  constructor(motivo = 'El recibo de fianza no está en borrador') {
    super(motivo);
    this.name = 'FacturaNoBorradorError';
    this.motivo = motivo;
  }
}

/** Fallo recuperable de PDF/email (rollback total) → HTTP 502/503. */
export class EmisionEnvioFallidoError extends Error {
  readonly codigo = 'EMISION_ENVIO_FALLIDO' as const;
  readonly causa: unknown;

  constructor(causa: unknown) {
    super('Fallo en el envío del recibo de fianza (recuperable)');
    this.name = 'EmisionEnvioFallidoError';
    this.causa = causa;
  }
}

/** Máximo de reintentos ante colisión de numeración (`P2002`). */
const MAX_REINTENTOS_NUMERACION = 10;

/** ¿El error es una violación de unicidad (`P2002`) de la numeración concurrente? */
const esColisionUnicidad = (error: unknown): boolean =>
  typeof error === 'object' &&
  error !== null &&
  'code' in error &&
  (error as { code?: string }).code === 'P2002';

/** ¿El error es un fallo de emisión ya envuelto (no reintentable)? */
const esFalloEmision = (error: unknown): error is EmisionEnvioFallidoError =>
  error instanceof EmisionEnvioFallidoError;

// ---------------------------------------------------------------------------
// Caso de uso
// ---------------------------------------------------------------------------

export class EnviarReciboFianzaSeparadoUseCase {
  constructor(private readonly deps: EnviarReciboFianzaSeparadoDeps) {}

  async ejecutar(
    comando: EnviarReciboFianzaSeparadoComando,
  ): Promise<EnviarReciboFianzaSeparadoResultado> {
    const reserva = await this.deps.cargarReserva({
      tenantId: comando.tenantId,
      reservaId: comando.reservaId,
    });
    if (reserva === null || reserva === undefined) {
      throw new FacturaFianzaNoEncontradaError(comando.reservaId);
    }

    let ultimoError: unknown = null;
    for (let intento = 0; intento < MAX_REINTENTOS_NUMERACION; intento += 1) {
      try {
        return (await this.deps.unidadDeTrabajo.ejecutar(comando.tenantId, (repos) =>
          this.emitir(comando, reserva, repos),
        )) as EnviarReciboFianzaSeparadoResultado;
      } catch (error) {
        if (esFalloEmision(error)) {
          throw error;
        }
        if (esColisionUnicidad(error)) {
          ultimoError = error;
          continue;
        }
        throw error;
      }
    }
    throw ultimoError ?? new Error('No se pudo asignar un número de factura único');
  }

  private async emitir(
    comando: EnviarReciboFianzaSeparadoComando,
    reserva: ReservaFianza,
    repos: RepositoriosFianzaSeparada,
  ): Promise<EnviarReciboFianzaSeparadoResultado> {
    const fianza = await repos.facturas.buscarPorReservaYTipo(comando.reservaId, 'fianza');
    if (fianza === null) {
      throw new FacturaFianzaNoEncontradaError(comando.reservaId);
    }
    if (fianza.estado !== 'borrador') {
      throw new FacturaNoBorradorError();
    }

    const ahora = this.deps.clock.ahora();
    const anio = ahora.getUTCFullYear();
    const ultimoNumero = await repos.facturas.ultimoNumeroDelAnio(comando.tenantId, anio);
    const numeroFianza = siguienteNumeroFactura({ anio, ultimoNumero });

    // Envío SÍNCRONO y CONFIRMADO del recibo (email manual). Fallo → rollback.
    try {
      await this.deps.enviarRecibo({
        tenantId: comando.tenantId,
        reservaId: comando.reservaId,
        destinatario: reserva.clienteEmail,
        codigoReserva: reserva.codigo,
        codigoEmail: 'manual',
        adjuntos: [
          {
            clave: 'fianza',
            nombre: 'recibo-fianza.pdf',
            pdfUrl: fianza.pdfUrl ?? '',
          },
        ],
      });
    } catch (error) {
      throw new EmisionEnvioFallidoError(error);
    }

    // Consolidación tras confirmar el envío.
    await repos.facturas.emitir({
      idFactura: fianza.idFactura,
      tipo: 'fianza',
      numeroFactura: numeroFianza,
      estado: 'enviada',
      fechaEmision: ahora,
    });
    await repos.auditoria.registrar({
      tenantId: comando.tenantId,
      usuarioId: comando.usuarioId,
      entidad: 'FACTURA',
      entidadId: fianza.idFactura,
      accion: 'actualizar',
      datosAnteriores: { estado: 'borrador' },
      datosNuevos: { estado: 'enviada', numeroFactura: numeroFianza },
    });

    // Avance de fianza_status (liquidacion_status NO se toca).
    await repos.reservas.avanzarFianzaStatus({
      reservaId: comando.reservaId,
      estado: 'recibo_enviado',
    });

    // COMUNICACION `manual` (NO E4).
    await repos.comunicaciones.crear({
      tenantId: comando.tenantId,
      reservaId: comando.reservaId,
      clienteId: reserva.clienteId,
      codigoEmail: 'manual',
      estado: 'enviado',
      fechaEnvio: ahora,
      destinatarioEmail: reserva.clienteEmail,
    });

    return {
      fianza: {
        ...fianza,
        numeroFactura: numeroFianza,
        estado: 'enviada',
        fechaEmision: ahora,
      },
      fianzaStatus: 'recibo_enviado',
    };
  }
}
