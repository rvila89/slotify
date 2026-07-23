/**
 * Caso de uso de APLICACIÓN: aprobar y enviar la factura de liquidación (US-028 / UC-21 pasos
 * 3–6). Acción ÚNICA y ATÓMICA estado↔E4 (design.md §D-1 opción A) que emite la liquidación
 * (y la fianza si sigue en borrador), envía el email E4 con ambos PDFs y avanza los
 * sub-procesos de la RESERVA.
 *
 * Orquesta:
 *   0. Carga la RESERVA (RLS) + carga los borradores. Guardas: la liquidación debe existir en
 *      `borrador` (→ FacturaNoBorrador si ya `enviada`; → NoEncontrada si no existe/reserva
 *      cross-tenant).
 *   1. (Opcional) Descuento negociado (D-2): recalcula total + desglose (dominio puro) y
 *      marca la actualización de `importe_liquidacion`.
 *   2. En UNA unidad de trabajo (tx + RLS) con reintento ante `P2002` (numeración de US-022,
 *      nunca locks distribuidos):
 *        a. Numera la liquidación (y la fianza si aplica) — `F-YYYY-NNNN` consecutivos.
 *        b. Envía E4 SÍNCRONO y CONFIRMADO con los adjuntos (fianza solo si no se envió por
 *           separado). Si E4 falla → PROPAGA `EmisionEnvioFallido` y la tx REVIERTE (rollback
 *           total: nada de número/estado/status/extras/COMUNICACION).
 *        c. SOLO tras confirmar E4: emite ambas facturas a `enviada`, avanza
 *           `liquidacion_status='facturada'` (+ `fianza_status='recibo_enviado'` si aplica),
 *           marca los RESERVA_EXTRA con el `factura_id`, actualiza `importe_liquidacion` si
 *           hubo descuento, registra la COMUNICACION E4 `enviado` y el AUDIT_LOG `actualizar`.
 *
 * Hexagonal (hook `no-infra-in-domain`): depende SOLO de puertos inyectados; no importa Prisma
 * ni `@nestjs/*`.
 */
import { siguienteNumeroFactura } from '../domain/numeracion-factura';
import {
  aplicarDescuentoLiquidacion,
  DescuentoInvalidoError,
} from '../domain/aplicar-descuento-liquidacion';
import type { EstadoFactura, TipoFactura } from '../domain/factura';

// ---------------------------------------------------------------------------
// Tipos de comando / proyecciones / puertos
// ---------------------------------------------------------------------------

/** Comando de la acción "Aprobar y enviar" la liquidación. */
export interface AprobarYEnviarLiquidacionComando {
  /** Tenant del JWT (nunca del path/body). */
  tenantId: string;
  /** Gestor que ejecuta la acción (auditoría). */
  usuarioId: string;
  /** RESERVA cuya liquidación se emite. */
  reservaId: string;
  /** Descuento negociado OPCIONAL (D-2), Importe string de 2 decimales. */
  descuento?: string;
  /** Motivo OPCIONAL del descuento (AUDIT_LOG). */
  motivo?: string;
}

/** Sub-estados de liquidación de la RESERVA relevantes. */
export type LiquidacionStatus = 'pendiente' | 'facturada' | 'cobrada';
/** Sub-estados de fianza de la RESERVA relevantes. */
export type FianzaStatus =
  | 'pendiente'
  | 'recibo_enviado'
  | 'cobrada'
  | 'devuelta'
  | 'retenida_parcial';

/** Proyección de la RESERVA para la emisión (origen, cliente, importe, status). */
export interface ReservaEmision {
  idReserva: string;
  tenantId: string;
  clienteId: string;
  codigo: string;
  liquidacionStatus: LiquidacionStatus;
  fianzaStatus: FianzaStatus;
  importeLiquidacion: string;
  clienteEmail: string;
  /** Nombre de pila del cliente (para el nombre del adjunto PDF del email E4). */
  clienteNombre?: string;
  /** Apellidos del cliente (para el nombre del adjunto PDF del email E4). */
  clienteApellidos?: string;
}

/** FACTURA emitible (liquidación o fianza) en su estado de partida (borrador). */
export interface FacturaEmitible {
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

/** Parámetros de emisión (transición borrador → enviada con numeración/desglose). */
export interface EmitirFacturaParams {
  idFactura: string;
  tipo: TipoFactura;
  numeroFactura: string;
  estado: 'enviada';
  fechaEmision: Date;
  total: string;
  baseImponible: string;
  ivaPorcentaje: string;
  ivaImporte: string;
}

/** Repositorio tx-bound de FACTURA (emisión + numeración). */
export interface FacturasEmisionPort {
  buscarPorReservaYTipo(
    reservaId: string,
    tipo: 'liquidacion' | 'fianza',
  ): Promise<FacturaEmitible | null>;
  ultimoNumeroDelAnio(tenantId: string, anio: number): Promise<string | null>;
  emitir(params: EmitirFacturaParams): Promise<void>;
}

/** Repositorio tx-bound de la RESERVA (avance de sub-procesos + importe). */
export interface ReservasEmisionPort {
  avanzarLiquidacionStatus(params: {
    reservaId: string;
    estado: 'facturada';
  }): Promise<void>;
  avanzarFianzaStatus(params: {
    reservaId: string;
    estado: 'recibo_enviado';
  }): Promise<void>;
  actualizarImporteLiquidacion(params: {
    reservaId: string;
    importeLiquidacion: string;
  }): Promise<void>;
}

/** Repositorio tx-bound de RESERVA_EXTRA (marcado con el factura_id de la liquidación). */
export interface ExtrasEmisionPort {
  marcarConFactura(params: { reservaId: string; facturaId: string }): Promise<void>;
}

/** Proyección de la COMUNICACION creada. */
export interface ComunicacionEmision {
  idComunicacion: string;
  estado: string;
  fechaEnvio: Date | null;
}

/** Repositorio tx-bound de COMUNICACION. */
export interface ComunicacionesEmisionPort {
  crear(params: {
    tenantId: string;
    reservaId: string;
    clienteId: string;
    codigoEmail: 'E4';
    estado: 'enviado';
    fechaEnvio: Date;
    destinatarioEmail: string;
  }): Promise<ComunicacionEmision>;
}

/** Registro de auditoría de la emisión. */
export interface RegistroAuditoriaEmision {
  tenantId: string;
  usuarioId?: string | null;
  entidad: 'FACTURA' | 'RESERVA' | 'COMUNICACION';
  entidadId: string;
  accion: 'actualizar' | 'crear';
  datosAnteriores?: Record<string, unknown> | null;
  datosNuevos?: Record<string, unknown> | null;
}

/** Repositorio tx-bound de AUDIT_LOG. */
export interface AuditoriaEmisionPort {
  registrar(registro: RegistroAuditoriaEmision): Promise<void>;
}

/** Conjunto de repositorios disponibles dentro de la unidad de trabajo. */
export interface RepositoriosEmision {
  facturas: FacturasEmisionPort;
  reservas: ReservasEmisionPort;
  extras: ExtrasEmisionPort;
  comunicaciones: ComunicacionesEmisionPort;
  auditoria: AuditoriaEmisionPort;
}

/**
 * Unidad de trabajo transaccional (tx + RLS). El envío de E4 vive DENTRO del `trabajo`: si
 * falla, el `trabajo` propaga y la tx REVIERTE (atomicidad estado↔E4, D-1). El adaptador
 * propaga `P2002` para el reintento de numeración del use-case.
 */
export interface UnidadDeTrabajoEmisionPort {
  ejecutar(
    tenantId: string,
    trabajo: (repos: RepositoriosEmision) => Promise<unknown>,
  ): Promise<unknown>;
}

/** Lectura de la RESERVA (fuera de la tx; RLS: cross-tenant → null). */
export interface CargarReservaEmisionPort {
  (params: {
    tenantId: string;
    reservaId: string;
  }): Promise<ReservaEmision | null | undefined>;
}

/** Adjunto de E4 por referencia a `pdf_url`. */
export interface AdjuntoEmision {
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
  adjuntos: AdjuntoEmision[];
  /** Índice laxo: permite que el doble de test tipe los params como `Record`. */
  [extra: string]: unknown;
}

/** Puerto de envío de E4 SÍNCRONO/CONFIRMADO (motor de US-045 cableado por facturacion). */
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
export interface AprobarYEnviarLiquidacionDeps {
  unidadDeTrabajo: UnidadDeTrabajoEmisionPort;
  cargarReserva: CargarReservaEmisionPort;
  enviarE4: EnviarE4EmisionPort;
  clock: ClockPort;
}

/** Resultado de la emisión: facturas emitidas + status actualizados. */
export interface AprobarYEnviarLiquidacionResultado {
  liquidacion: FacturaEmitible;
  fianza: FacturaEmitible | null;
  liquidacionStatus: 'facturada';
  fianzaStatus: 'recibo_enviado';
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

// Re-exporta el error de descuento para el mapeo HTTP del controlador (422).
export { DescuentoInvalidoError };

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

/** Marca centinela para no envolver dos veces un fallo de emisión/envío. */
const esFalloEmision = (error: unknown): error is EmisionEnvioFallidoError =>
  error instanceof EmisionEnvioFallidoError;

// ---------------------------------------------------------------------------
// Caso de uso
// ---------------------------------------------------------------------------

export class AprobarYEnviarLiquidacionUseCase {
  constructor(private readonly deps: AprobarYEnviarLiquidacionDeps) {}

  async ejecutar(
    comando: AprobarYEnviarLiquidacionComando,
  ): Promise<AprobarYEnviarLiquidacionResultado> {
    // (0) Carga la RESERVA (RLS). Cross-tenant/inexistente → 404.
    const reserva = await this.deps.cargarReserva({
      tenantId: comando.tenantId,
      reservaId: comando.reservaId,
    });
    if (reserva === null || reserva === undefined) {
      throw new FacturaLiquidacionNoEncontradaError(comando.reservaId);
    }

    // (2) Unidad de trabajo con reintento ante colisión de numeración (P2002). El envío de
    //     E4 vive DENTRO de la tx: si falla, la tx revierte (rollback total, D-1).
    let ultimoError: unknown = null;
    for (let intento = 0; intento < MAX_REINTENTOS_NUMERACION; intento += 1) {
      try {
        return (await this.deps.unidadDeTrabajo.ejecutar(comando.tenantId, (repos) =>
          this.emitir(comando, reserva, repos),
        )) as AprobarYEnviarLiquidacionResultado;
      } catch (error) {
        // El fallo de E4 NO es reintentable (rollback + error recuperable al Gestor).
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

  // -------------------------------------------------------------------------
  // Cuerpo transaccional
  // -------------------------------------------------------------------------

  private async emitir(
    comando: AprobarYEnviarLiquidacionComando,
    reserva: ReservaEmision,
    repos: RepositoriosEmision,
  ): Promise<AprobarYEnviarLiquidacionResultado> {
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

    // La fianza se emite en la misma operación SOLO si sigue en borrador (D-3: si ya se
    // envió por separado, no se re-emite ni retrocede su status).
    const fianza = await repos.facturas.buscarPorReservaYTipo(comando.reservaId, 'fianza');
    const fianzaEmitible = fianza !== null && fianza.estado === 'borrador' ? fianza : null;

    // (1) Descuento negociado (D-2): recalcula total + desglose (dominio puro).
    const hayDescuento =
      comando.descuento !== undefined && Number(comando.descuento) > 0;
    const desglose = hayDescuento
      ? aplicarDescuentoLiquidacion({ total: liquidacion.total }, comando.descuento as string)
      : {
          total: liquidacion.total,
          baseImponible: liquidacion.baseImponible,
          ivaPorcentaje: liquidacion.ivaPorcentaje,
          ivaImporte: liquidacion.ivaImporte,
        };

    // (2a) Numeración consecutiva (liquidación y, si aplica, fianza) — US-022.
    const ahora = this.deps.clock.ahora();
    const anio = ahora.getUTCFullYear();
    const ultimoNumero = await repos.facturas.ultimoNumeroDelAnio(comando.tenantId, anio);
    const numeroLiquidacion = siguienteNumeroFactura({ anio, ultimoNumero });
    const numeroFianza =
      fianzaEmitible !== null
        ? siguienteNumeroFactura({ anio, ultimoNumero: numeroLiquidacion })
        : null;

    // (2b) Envío E4 SÍNCRONO y CONFIRMADO (D-1): si falla, PROPAGA para que la tx revierta.
    //      Adjunta la fianza solo si se emite en esta operación (D-3).
    const adjuntos: AdjuntoEmision[] = [
      {
        clave: 'liquidacion',
        nombre: `${numeroLiquidacion ?? 'Liquidación'} ${reserva.clienteNombre ?? ''} ${reserva.clienteApellidos ?? ''}`.trim() + '.pdf',
        pdfUrl: liquidacion.pdfUrl ?? '',
      },
    ];
    if (fianzaEmitible !== null) {
      adjuntos.push({
        clave: 'fianza',
        nombre: `${numeroFianza ?? 'Fianza'} ${reserva.clienteNombre ?? ''} ${reserva.clienteApellidos ?? ''}`.trim() + '.pdf',
        pdfUrl: fianzaEmitible.pdfUrl ?? '',
      });
    }
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
        adjuntos,
      });
    } catch (error) {
      throw new EmisionEnvioFallidoError(error);
    }

    // (2c) Consolidación SOLO tras confirmar E4: emisión de facturas, avance de status,
    //      marcado de extras, actualización de importe, COMUNICACION y AUDIT_LOG.
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
      datosAnteriores: { estado: 'borrador', total: liquidacion.total },
      datosNuevos: {
        estado: 'enviada',
        numeroFactura: numeroLiquidacion,
        total: desglose.total,
        ...(comando.motivo ? { motivo: comando.motivo } : {}),
      },
    });

    if (fianzaEmitible !== null) {
      await repos.facturas.emitir({
        idFactura: fianzaEmitible.idFactura,
        tipo: 'fianza',
        numeroFactura: numeroFianza as string,
        estado: 'enviada',
        fechaEmision: ahora,
        total: fianzaEmitible.total,
        baseImponible: fianzaEmitible.baseImponible,
        ivaPorcentaje: fianzaEmitible.ivaPorcentaje,
        ivaImporte: fianzaEmitible.ivaImporte,
      });
      await repos.auditoria.registrar({
        tenantId: comando.tenantId,
        usuarioId: comando.usuarioId,
        entidad: 'FACTURA',
        entidadId: fianzaEmitible.idFactura,
        accion: 'actualizar',
        datosAnteriores: { estado: 'borrador' },
        datosNuevos: { estado: 'enviada', numeroFactura: numeroFianza },
      });
    }

    // Avance de sub-procesos: liquidación → facturada; fianza → recibo_enviado (solo si se
    // emitió aquí; si ya se envió por separado NO retrocede/re-avanza).
    await repos.reservas.avanzarLiquidacionStatus({
      reservaId: comando.reservaId,
      estado: 'facturada',
    });
    if (fianzaEmitible !== null) {
      await repos.reservas.avanzarFianzaStatus({
        reservaId: comando.reservaId,
        estado: 'recibo_enviado',
      });
    }

    // Marcado de los RESERVA_EXTRA con el factura_id de la liquidación.
    await repos.extras.marcarConFactura({
      reservaId: comando.reservaId,
      facturaId: liquidacion.idFactura,
    });

    // Actualización de importe_liquidacion (solo si hubo descuento) + AUDIT_LOG del ajuste.
    if (hayDescuento) {
      await repos.reservas.actualizarImporteLiquidacion({
        reservaId: comando.reservaId,
        importeLiquidacion: desglose.total,
      });
      await repos.auditoria.registrar({
        tenantId: comando.tenantId,
        usuarioId: comando.usuarioId,
        entidad: 'RESERVA',
        entidadId: comando.reservaId,
        accion: 'actualizar',
        datosAnteriores: { importeLiquidacion: reserva.importeLiquidacion },
        datosNuevos: {
          importeLiquidacion: desglose.total,
          ...(comando.motivo ? { motivo: comando.motivo } : {}),
        },
      });
    }

    // Registro de la COMUNICACION E4 `enviado`.
    await repos.comunicaciones.crear({
      tenantId: comando.tenantId,
      reservaId: comando.reservaId,
      clienteId: reserva.clienteId,
      codigoEmail: 'E4',
      estado: 'enviado',
      fechaEnvio: comunicacionEnviada.fechaEnvio,
      destinatarioEmail: reserva.clienteEmail,
    });

    // Resultado: proyección de las facturas emitidas + status.
    const liquidacionEmitida: FacturaEmitible = {
      ...liquidacion,
      numeroFactura: numeroLiquidacion,
      estado: 'enviada',
      fechaEmision: ahora,
      total: desglose.total,
      baseImponible: desglose.baseImponible,
      ivaPorcentaje: desglose.ivaPorcentaje,
      ivaImporte: desglose.ivaImporte,
    };
    const fianzaEmitida: FacturaEmitible | null =
      fianzaEmitible !== null
        ? {
            ...fianzaEmitible,
            numeroFactura: numeroFianza as string,
            estado: 'enviada',
            fechaEmision: ahora,
          }
        : null;

    return {
      liquidacion: liquidacionEmitida,
      fianza: fianzaEmitida,
      liquidacionStatus: 'facturada',
      fianzaStatus: 'recibo_enviado',
    };
  }
}
