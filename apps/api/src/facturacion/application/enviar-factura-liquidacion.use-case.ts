/**
 * Caso de uso de APLICACIÓN: enviar la factura de liquidación (60%) por E4 — flujo STANDALONE
 * espejo de la señal (fix-liquidacion-fianza-independientes §D-1 / UC-21). Acción ÚNICA y
 * ATÓMICA estado↔E4 que FUNDE "aprobar + enviar" sobre la factura de liquidación en `borrador`.
 *
 * **E4 = SOLO liquidación**: no emite, adjunta ni toca la fianza (la fianza deja de ser una
 * FACTURA). No hay recibo de fianza ni avance de `fianza_status`.
 *
 * Orquesta:
 *   0. Carga la RESERVA (RLS). Cross-tenant/inexistente → `FacturaLiquidacionNoEncontradaError`.
 *   1. En UNA unidad de trabajo (tx + RLS) con reintento ante `P2002` (numeración de US-022,
 *      nunca locks distribuidos):
 *        a. Guardas: la liquidación debe existir en `borrador` (→ 404 si no existe; → 409
 *           `FacturaNoBorradorError` si ya `enviada`/`cobrada`); `pdf_url` presente (null →
 *           `EmisionEnvioFallidoError`, 502).
 *        b. Numera la liquidación (`F-YYYY-NNNN`) y envía E4 SÍNCRONO/CONFIRMADO con SOLO el
 *           PDF de la liquidación. Si E4 falla → PROPAGA `EmisionEnvioFallidoError` y la tx
 *           REVIERTE (rollback total).
 *        c. Solo tras confirmar E4: emite la liquidación (`borrador → enviada`, asigna número
 *           y `fecha_emision`), avanza `liquidacion_status='facturada'`, marca los
 *           RESERVA_EXTRA con el `factura_id`, registra la COMUNICACION E4 `enviado` y el
 *           AUDIT_LOG `actualizar` (`estado: borrador → enviada`).
 *
 * Hexagonal (hook `no-infra-in-domain`): depende SOLO de puertos inyectados; no importa Prisma
 * ni `@nestjs/*`.
 */
import { siguienteNumeroFactura } from '../domain/numeracion-factura';
import type { EstadoFactura, TipoFactura } from '../domain/factura';

// ---------------------------------------------------------------------------
// Tipos de comando / proyecciones / puertos
// ---------------------------------------------------------------------------

/** Comando de la acción "Aprobar y enviar" la liquidación (standalone). */
export interface EnviarFacturaLiquidacionComando {
  /** Tenant del JWT (nunca del path/body). */
  tenantId: string;
  /** Gestor que ejecuta la acción (auditoría). */
  usuarioId: string;
  /** RESERVA cuya liquidación se emite. */
  reservaId: string;
}

/** Sub-estados de liquidación de la RESERVA relevantes. */
export type LiquidacionStatus = 'pendiente' | 'facturada' | 'cobrada';
/** Sub-estados de fianza de la RESERVA (solo proyección; nunca se mutan aquí). */
export type FianzaStatus = 'pendiente' | 'cobrada' | 'devuelta';

/** Proyección de la RESERVA para la emisión (cliente, importe de la fianza para E4). */
export interface ReservaLiquidacionEmision {
  idReserva: string;
  tenantId: string;
  clienteId: string;
  codigo: string;
  liquidacionStatus: LiquidacionStatus;
  fianzaStatus: FianzaStatus;
  clienteEmail: string;
  /** Idioma de la reserva (`'ca'`/`'es'`); elige la plantilla E4 del catálogo. */
  idioma?: string;
  /** Nombre de pila del cliente (saludo del email + nombre del adjunto). */
  clienteNombre?: string;
  /** Apellidos del cliente (nombre del adjunto PDF). */
  clienteApellidos?: string;
  /** Importe de la fianza (Decimal string) para el recordatorio del email E4. */
  fianzaEur: string | null;
}

/** FACTURA de liquidación emitible en su estado de partida (borrador). */
export interface FacturaLiquidacionEmitible {
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

/** Parámetros de emisión de la liquidación (transición borrador → enviada con numeración). */
export interface EmitirFacturaLiquidacionParams {
  idFactura: string;
  tipo: 'liquidacion';
  numeroFactura: string;
  estado: 'enviada';
  fechaEmision: Date;
  total: string;
  baseImponible: string;
  ivaPorcentaje: string;
  ivaImporte: string;
}

/** Repositorio tx-bound de FACTURA (emisión + numeración). */
export interface FacturasLiquidacionEmisionPort {
  buscarPorReservaYTipo(
    reservaId: string,
    tipo: 'liquidacion',
  ): Promise<FacturaLiquidacionEmitible | null>;
  ultimoNumeroDelAnio(tenantId: string, anio: number): Promise<string | null>;
  emitir(params: EmitirFacturaLiquidacionParams): Promise<void>;
}

/** Repositorio tx-bound de la RESERVA (avance del sub-proceso de liquidación). */
export interface ReservasLiquidacionEmisionPort {
  avanzarLiquidacionStatus(params: {
    reservaId: string;
    estado: 'facturada';
  }): Promise<void>;
}

/** Repositorio tx-bound de RESERVA_EXTRA (marcado con el factura_id de la liquidación). */
export interface ExtrasLiquidacionEmisionPort {
  marcarConFactura(params: { reservaId: string; facturaId: string }): Promise<void>;
}

/** Proyección de la COMUNICACION creada. */
export interface ComunicacionLiquidacionEmision {
  idComunicacion: string;
  estado: string;
  fechaEnvio: Date | null;
}

/** Repositorio tx-bound de COMUNICACION (E4). */
export interface ComunicacionesLiquidacionEmisionPort {
  crear(params: {
    tenantId: string;
    reservaId: string;
    clienteId: string;
    codigoEmail: 'E4';
    estado: 'enviado';
    fechaEnvio: Date;
    destinatarioEmail: string;
  }): Promise<ComunicacionLiquidacionEmision>;
}

/** Registro de auditoría de la emisión. */
export interface RegistroAuditoriaLiquidacionEmision {
  tenantId: string;
  usuarioId?: string | null;
  entidad: 'FACTURA' | 'RESERVA' | 'COMUNICACION';
  entidadId: string;
  accion: 'actualizar' | 'crear';
  datosAnteriores?: Record<string, unknown> | null;
  datosNuevos?: Record<string, unknown> | null;
}

/** Repositorio tx-bound de AUDIT_LOG. */
export interface AuditoriaLiquidacionEmisionPort {
  registrar(registro: RegistroAuditoriaLiquidacionEmision): Promise<void>;
}

/** Conjunto de repositorios disponibles dentro de la unidad de trabajo. */
export interface RepositoriosLiquidacionEmision {
  facturas: FacturasLiquidacionEmisionPort;
  reservas: ReservasLiquidacionEmisionPort;
  extras: ExtrasLiquidacionEmisionPort;
  comunicaciones: ComunicacionesLiquidacionEmisionPort;
  auditoria: AuditoriaLiquidacionEmisionPort;
}

/**
 * Unidad de trabajo transaccional (tx + RLS). El envío de E4 vive DENTRO del `trabajo`: si
 * falla, el `trabajo` propaga y la tx REVIERTE (atomicidad estado↔E4). El adaptador propaga
 * `P2002` para el reintento de numeración del use-case.
 */
export interface UnidadDeTrabajoLiquidacionEmisionPort {
  ejecutar(
    tenantId: string,
    trabajo: (repos: RepositoriosLiquidacionEmision) => Promise<unknown>,
  ): Promise<unknown>;
}

/** Lectura de la RESERVA (fuera de la tx; RLS: cross-tenant → null). */
export interface CargarReservaLiquidacionEmisionPort {
  (params: {
    tenantId: string;
    reservaId: string;
  }): Promise<ReservaLiquidacionEmision | null | undefined>;
}

/** Adjunto de E4 por referencia a `pdf_url`. */
export interface AdjuntoLiquidacionEmision {
  clave: string;
  nombre: string;
  pdfUrl: string;
}

/** Parámetros del envío de E4 (síncrono y confirmado). */
export interface EnviarE4EmisionParams {
  tenantId: string;
  reservaId: string;
  clienteId: string;
  destinatario: string;
  codigoReserva: string;
  /** Idioma de la reserva (`'ca'`/`'es'`); el adapter selecciona la plantilla E4. */
  idioma?: string;
  /** Nombre de pila del cliente para el saludo de la plantilla. */
  nombre?: string;
  /** Importe de la fianza (Decimal string) para el recordatorio del email. */
  fianzaEur?: string | null;
  adjuntos: AdjuntoLiquidacionEmision[];
  /** Índice laxo: permite que el doble de test tipe los params como `Record`. */
  [extra: string]: unknown;
}

/** Puerto de envío de E4 SÍNCRONO/CONFIRMADO (puerto directo). */
export interface EnviarE4EmisionPort {
  (params: EnviarE4EmisionParams): Promise<{
    idComunicacion: string;
    estado: 'enviado';
    fechaEnvio: Date;
  }>;
}

/** Reloj inyectable para determinismo. */
export interface ClockPort {
  ahora(): Date;
}

/** Dependencias del caso de uso (puertos inyectados). */
export interface EnviarFacturaLiquidacionDeps {
  unidadDeTrabajo: UnidadDeTrabajoLiquidacionEmisionPort;
  cargarReserva: CargarReservaLiquidacionEmisionPort;
  enviarE4: EnviarE4EmisionPort;
  clock: ClockPort;
}

/** Resultado de la emisión: factura de liquidación emitida + status actualizado. */
export interface EnviarFacturaLiquidacionResultado {
  liquidacion: FacturaLiquidacionEmitible;
  liquidacionStatus: 'facturada';
}

// ---------------------------------------------------------------------------
// Errores de dominio tipados, en español
// ---------------------------------------------------------------------------

/** La liquidación (o la reserva) no existe para el tenant (RLS) → HTTP 404. */
export class FacturaLiquidacionNoEncontradaError extends Error {
  readonly codigo = 'FACTURA_LIQUIDACION_NO_ENCONTRADA' as const;
  readonly reservaId: string;

  constructor(reservaId: string) {
    super('No hay factura de liquidación en borrador para la reserva');
    this.name = 'FacturaLiquidacionNoEncontradaError';
    this.reservaId = reservaId;
  }
}

/** La liquidación no está en `borrador` (ya emitida/facturada) → HTTP 409. */
export class FacturaNoBorradorError extends Error {
  readonly codigo = 'FACTURA_NO_BORRADOR' as const;
  readonly motivo: string;

  constructor(motivo = 'La factura de liquidación no está en borrador') {
    super(motivo);
    this.name = 'FacturaNoBorradorError';
    this.motivo = motivo;
  }
}

/** Ya existe una COMUNICACION E4 `enviado` para la reserva (idempotencia) → HTTP 409. */
export class E4YaEnviadoError extends Error {
  readonly codigo = 'E4_YA_ENVIADO' as const;
  readonly reservaId: string;

  constructor(reservaId: string) {
    super('La factura de liquidación ya se envió por E4 para la reserva');
    this.name = 'E4YaEnviadoError';
    this.reservaId = reservaId;
  }
}

/** Fallo recuperable de PDF/email (rollback total) → HTTP 502/503. */
export class EmisionEnvioFallidoError extends Error {
  readonly codigo = 'EMISION_ENVIO_FALLIDO' as const;
  readonly causa: unknown;

  constructor(causa: unknown) {
    super('Fallo en la emisión o el envío de la liquidación (recuperable)');
    this.name = 'EmisionEnvioFallidoError';
    this.causa = causa;
  }
}

// ---------------------------------------------------------------------------
// Constantes y helpers puros
// ---------------------------------------------------------------------------

/** Máximo de reintentos ante colisión de numeración (`P2002`). */
const MAX_REINTENTOS_NUMERACION = 10;

/** ¿El error es una violación de unicidad (`P2002`) de la numeración concurrente? */
const esColisionUnicidad = (error: unknown): boolean =>
  typeof error === 'object' &&
  error !== null &&
  'code' in error &&
  (error as { code?: string }).code === 'P2002';

/** Errores de negocio que NO son reintentables (deben propagar tal cual). */
const esErrorNoReintentable = (error: unknown): boolean =>
  error instanceof EmisionEnvioFallidoError ||
  error instanceof FacturaLiquidacionNoEncontradaError ||
  error instanceof FacturaNoBorradorError ||
  error instanceof E4YaEnviadoError;

// ---------------------------------------------------------------------------
// Caso de uso
// ---------------------------------------------------------------------------

export class EnviarFacturaLiquidacionUseCase {
  constructor(private readonly deps: EnviarFacturaLiquidacionDeps) {}

  async ejecutar(
    comando: EnviarFacturaLiquidacionComando,
  ): Promise<EnviarFacturaLiquidacionResultado> {
    // (0) Carga la RESERVA (RLS). Cross-tenant/inexistente → 404.
    const reserva = await this.deps.cargarReserva({
      tenantId: comando.tenantId,
      reservaId: comando.reservaId,
    });
    if (reserva === null || reserva === undefined) {
      throw new FacturaLiquidacionNoEncontradaError(comando.reservaId);
    }

    // (1) Unidad de trabajo con reintento ante colisión de numeración (P2002). El envío de
    //     E4 vive DENTRO de la tx: si falla, la tx revierte (rollback total).
    let ultimoError: unknown = null;
    for (let intento = 0; intento < MAX_REINTENTOS_NUMERACION; intento += 1) {
      try {
        return (await this.deps.unidadDeTrabajo.ejecutar(comando.tenantId, (repos) =>
          this.emitir(comando, reserva, repos),
        )) as EnviarFacturaLiquidacionResultado;
      } catch (error) {
        if (esErrorNoReintentable(error)) {
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

  // -------------------------------------------------------------------------
  // Cuerpo transaccional
  // -------------------------------------------------------------------------

  private async emitir(
    comando: EnviarFacturaLiquidacionComando,
    reserva: ReservaLiquidacionEmision,
    repos: RepositoriosLiquidacionEmision,
  ): Promise<EnviarFacturaLiquidacionResultado> {
    // Guarda: la liquidación debe existir y estar en `borrador`.
    const liquidacion = await repos.facturas.buscarPorReservaYTipo(
      comando.reservaId,
      'liquidacion',
    );
    if (liquidacion === null) {
      throw new FacturaLiquidacionNoEncontradaError(comando.reservaId);
    }
    if (liquidacion.estado !== 'borrador') {
      throw new FacturaNoBorradorError();
    }

    // Guarda de datos: el PDF de la liquidación es el adjunto imprescindible.
    if (liquidacion.pdfUrl === null) {
      throw new EmisionEnvioFallidoError(
        new Error('La factura de liquidación no tiene PDF disponible'),
      );
    }

    // Usamos el desglose del borrador tal cual (sin descuento).
    const desglose = {
      total: liquidacion.total,
      baseImponible: liquidacion.baseImponible,
      ivaPorcentaje: liquidacion.ivaPorcentaje,
      ivaImporte: liquidacion.ivaImporte,
    };

    // Numeración consecutiva (F-YYYY-NNNN) — US-022, reintento ante P2002 arriba.
    const ahora = this.deps.clock.ahora();
    const anio = ahora.getUTCFullYear();
    const ultimoNumero = await repos.facturas.ultimoNumeroDelAnio(comando.tenantId, anio);
    const numeroLiquidacion = siguienteNumeroFactura({ anio, ultimoNumero });

    // (1b) Envío E4 SÍNCRONO y CONFIRMADO: adjunta SOLO la factura de liquidación (E4 = solo
    //      liquidación; no toca la fianza). Si falla → PROPAGA para que la tx revierta.
    const adjuntos: AdjuntoLiquidacionEmision[] = [
      {
        clave: 'liquidacion',
        nombre:
          `${numeroLiquidacion ?? 'Liquidación'} ${reserva.clienteNombre ?? ''} ${reserva.clienteApellidos ?? ''}`.trim() +
          '.pdf',
        pdfUrl: liquidacion.pdfUrl,
      },
    ];
    let comunicacionEnviada: {
      idComunicacion: string;
      estado: 'enviado';
      fechaEnvio: Date;
    };
    try {
      comunicacionEnviada = await this.deps.enviarE4({
        tenantId: comando.tenantId,
        reservaId: comando.reservaId,
        clienteId: reserva.clienteId,
        destinatario: reserva.clienteEmail,
        codigoReserva: reserva.codigo,
        idioma: reserva.idioma,
        nombre: reserva.clienteNombre,
        fianzaEur: reserva.fianzaEur,
        adjuntos,
      });
    } catch (error) {
      throw new EmisionEnvioFallidoError(error);
    }

    // (1c) Consolidación SOLO tras confirmar E4: emisión, avance de status, marcado de extras,
    //      COMUNICACION y AUDIT_LOG.
    await repos.facturas.emitir({
      idFactura: liquidacion.idFactura,
      tipo: 'liquidacion',
      numeroFactura: numeroLiquidacion,
      estado: 'enviada',
      fechaEmision: ahora,
      total: desglose.total,
      baseImponible: desglose.baseImponible,
      ivaPorcentaje: desglose.ivaPorcentaje,
      ivaImporte: desglose.ivaImporte,
    });
    await repos.auditoria.registrar({
      tenantId: comando.tenantId,
      usuarioId: comando.usuarioId,
      entidad: 'FACTURA',
      entidadId: liquidacion.idFactura,
      accion: 'actualizar',
      datosAnteriores: { estado: 'borrador' },
      datosNuevos: {
        estado: 'enviada',
        numeroFactura: numeroLiquidacion,
        total: desglose.total,
      },
    });

    await repos.reservas.avanzarLiquidacionStatus({
      reservaId: comando.reservaId,
      estado: 'facturada',
    });

    await repos.extras.marcarConFactura({
      reservaId: comando.reservaId,
      facturaId: liquidacion.idFactura,
    });

    await repos.comunicaciones.crear({
      tenantId: comando.tenantId,
      reservaId: comando.reservaId,
      clienteId: reserva.clienteId,
      codigoEmail: 'E4',
      estado: 'enviado',
      fechaEnvio: comunicacionEnviada.fechaEnvio,
      destinatarioEmail: reserva.clienteEmail,
    });

    const liquidacionEmitida: FacturaLiquidacionEmitible = {
      ...liquidacion,
      numeroFactura: numeroLiquidacion,
      estado: 'enviada',
      fechaEmision: ahora,
      total: desglose.total,
      baseImponible: desglose.baseImponible,
      ivaPorcentaje: desglose.ivaPorcentaje,
      ivaImporte: desglose.ivaImporte,
    };

    return { liquidacion: liquidacionEmitida, liquidacionStatus: 'facturada' };
  }
}
