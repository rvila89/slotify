/**
 * Caso de uso de APLICACIÓN: enviar la factura de señal (40%) + condicions particulars por E3
 * (US-023 / UC-18, épico #6 rebanada 6.4b — Bloque C). Acción ÚNICA y ATÓMICA estado↔E3 (design.md
 * §Atomicidad, espejo literal de `aprobar-y-enviar-liquidacion.use-case.ts` de E4) que FUNDE
 * "aprobar + enviar" sobre la factura de señal, envía el email E3 con el PDF de la señal (y las
 * condiciones si están disponibles) y avanza los sub-procesos de la RESERVA.
 *
 * Orquesta:
 *   0. Carga la RESERVA (RLS). Cross-tenant/inexistente → `FacturaSenalNoEncontradaError` (404).
 *   1. En UNA unidad de trabajo (tx + RLS) con reintento ante `P2002` (§D-num; nunca locks
 *      distribuidos):
 *        a. Guardas: la señal debe existir (→ 404); estado enviable (`borrador` feliz;
 *           `enviada` sin COMUNICACION E3 previa = reintento permitido; `rechazada` → 409
 *           `FacturaSenalNoEnviableError`); idempotencia por COMUNICACION E3 `enviado`
 *           previa → 409 `E3YaEnviadoError` (E3 `fallido` NO bloquea); `pdf_url` de la
 *           señal presente (null → `EmisionEnvioFallidoError`, 502).
 *        b. Genera/OMITE el adjunto de condiciones (`.catch(() => null)`): si degrada a `null`
 *           o lanza, se omite el adjunto y `condPartAdjuntada=false` (NO tumba E3).
 *        c. Envía E3 SÍNCRONO y CONFIRMADO por el puerto DIRECTO. Si falla → PROPAGA
 *           `EmisionEnvioFallidoError` y la tx REVIERTE (rollback total).
 *        d. Solo tras confirmar E3: emite la señal (`borrador → enviada`, fija `fecha_emision`
 *           conservando `numero_factura` de US-022), fija `RESERVA.cond_part_enviadas_fecha=now()`
 *           y `cond_part_firmadas=false`, registra la COMUNICACION E3 `enviado` y el AUDIT_LOG.
 *
 * Hexagonal (hook `no-infra-in-domain`): depende SOLO de puertos inyectados; no importa Prisma ni
 * `@nestjs/*`.
 */
import type { EstadoFactura, TipoFactura } from '../domain/factura';

/**
 * Estado de la señal de partida a efectos de la guarda de "enviable". Además de los estados
 * canónicos de FACTURA (`borrador`/`enviada`/`cobrada`), admite el marcador `rechazada` de un
 * borrador rechazado (US-022: el rechazo no cambia el estado en BD, pero la lectura de la señal
 * puede proyectarlo como no enviable). No es enviable.
 */
export type EstadoSenalEmitible = EstadoFactura | 'rechazada';

// ---------------------------------------------------------------------------
// Tipos de comando / proyecciones / puertos
// ---------------------------------------------------------------------------

/** Comando de la acción "Enviar factura de señal (40%)". */
export interface EnviarFacturaSenalComando {
  /** Tenant del JWT (nunca del path/body). */
  tenantId: string;
  /** Gestor que ejecuta la acción (auditoría). */
  usuarioId: string;
  /** RESERVA cuya factura de señal se envía. */
  reservaId: string;
}

/** FACTURA de señal emitible en su estado de partida (borrador/enviada). */
export interface FacturaSenalEmitible {
  idFactura: string;
  tenantId: string;
  reservaId: string;
  numeroFactura: string | null;
  tipo: TipoFactura;
  estado: EstadoSenalEmitible;
  total: string;
  baseImponible: string;
  ivaPorcentaje: string;
  ivaImporte: string;
  pdfUrl: string | null;
  fechaEmision: Date | null;
}

/** Parámetros de emisión de la señal (transición borrador/enviada → enviada). */
export interface EmitirFacturaSenalParams {
  idFactura: string;
  tipo: TipoFactura;
  numeroFactura: string | null;
  estado: 'enviada';
  fechaEmision: Date;
}

/** Repositorio tx-bound de FACTURA de señal (emisión + numeración). */
export interface FacturasSenalEmisionPort {
  buscarPorReservaYTipo(
    reservaId: string,
    tipo: 'senal',
  ): Promise<FacturaSenalEmitible | null>;
  ultimoNumeroDelAnio(tenantId: string, anio: number): Promise<string | null>;
  emitir(params: EmitirFacturaSenalParams): Promise<void>;
}

/** Repositorio tx-bound de la RESERVA (avance de los sub-procesos de condiciones). */
export interface ReservasSenalEmisionPort {
  fijarCondicionesEnviadas(params: {
    reservaId: string;
    condPartEnviadasFecha: Date;
    condPartFirmadas: false;
  }): Promise<void>;
}

/** Proyección de la COMUNICACION E3 previa (para la idempotencia). */
export interface ComunicacionE3Previa {
  estado: string;
}

/** Repositorio tx-bound de COMUNICACION E3 (idempotencia + registro). */
export interface ComunicacionesSenalEmisionPort {
  buscarE3(reservaId: string): Promise<ComunicacionE3Previa | null>;
  crear(params: {
    tenantId: string;
    reservaId: string;
    clienteId: string;
    codigoEmail: 'E3';
    estado: 'enviado';
    fechaEnvio: Date;
    destinatarioEmail: string;
  }): Promise<{ idComunicacion: string; estado: string; fechaEnvio: Date | null }>;
}

/** Registro de auditoría de la emisión de la señal. */
export interface RegistroAuditoriaSenalEmision {
  tenantId: string;
  usuarioId?: string | null;
  entidad: 'FACTURA' | 'RESERVA' | 'COMUNICACION';
  entidadId: string;
  accion: 'actualizar' | 'crear';
  datosAnteriores?: Record<string, unknown> | null;
  datosNuevos?: Record<string, unknown> | null;
}

/** Repositorio tx-bound de AUDIT_LOG. */
export interface AuditoriaSenalEmisionPort {
  registrar(registro: RegistroAuditoriaSenalEmision): Promise<void>;
}

/** Conjunto de repositorios disponibles dentro de la unidad de trabajo. */
export interface RepositoriosSenalEmision {
  facturas: FacturasSenalEmisionPort;
  reservas: ReservasSenalEmisionPort;
  comunicaciones: ComunicacionesSenalEmisionPort;
  auditoria: AuditoriaSenalEmisionPort;
}

/**
 * Unidad de trabajo transaccional (tx + RLS). El envío de E3 vive DENTRO del `trabajo`: si falla,
 * el `trabajo` propaga y la tx REVIERTE (atomicidad estado↔E3). El adaptador propaga `P2002` para
 * el reintento de numeración del use-case.
 */
export interface UnidadDeTrabajoSenalEmisionPort {
  ejecutar(
    tenantId: string,
    trabajo: (repos: RepositoriosSenalEmision) => Promise<unknown>,
  ): Promise<unknown>;
}

/** Proyección de la RESERVA para la emisión (cliente, código, email, sub-procesos). */
export interface ReservaSenalEmision {
  idReserva: string;
  tenantId: string;
  clienteId: string;
  codigo: string;
  clienteEmail: string;
  condPartEnviadasFecha: Date | null;
  condPartFirmadas: boolean;
}

/** Lectura de la RESERVA (fuera de la tx; RLS: cross-tenant → null). */
export interface CargarReservaSenalEmisionPort {
  (params: {
    tenantId: string;
    reservaId: string;
  }): Promise<ReservaSenalEmision | null | undefined>;
}

/** Adjunto de E3 por referencia a `pdf_url`. */
export interface AdjuntoSenalEmision {
  clave: string;
  nombre: string;
  pdfUrl: string;
}

/** Parámetros del envío de E3 (síncrono y confirmado). */
export interface EnviarE3EmisionParams {
  tenantId: string;
  reservaId: string;
  clienteId: string;
  destinatario: string;
  codigoReserva: string;
  adjuntos: AdjuntoSenalEmision[];
  /** Índice laxo: permite que el doble de test tipe los params como `Record`. */
  [extra: string]: unknown;
}

/** Puerto de envío de E3 SÍNCRONO/CONFIRMADO (puerto directo, §D-ruta-email). */
export interface EnviarE3EmisionPort {
  (params: EnviarE3EmisionParams): Promise<{
    idComunicacion: string;
    estado: 'enviado';
    fechaEnvio: Date;
  }>;
}

/** Puerto de generación del PDF de condicions particulars (degrada a `null`). */
export interface GenerarCondicionesPort {
  (params: { tenantId: string }): Promise<string | null>;
}

/** Reloj inyectable para determinismo. */
export interface ClockPort {
  ahora(): Date;
}

/** Dependencias del caso de uso (puertos inyectados). */
export interface EnviarFacturaSenalDeps {
  unidadDeTrabajo: UnidadDeTrabajoSenalEmisionPort;
  cargarReserva: CargarReservaSenalEmisionPort;
  enviarE3: EnviarE3EmisionPort;
  generarCondiciones: GenerarCondicionesPort;
  clock: ClockPort;
}

/** Resultado del envío: factura emitida + metadatos del envío de condiciones. */
export interface EnviarFacturaSenalResultado {
  senal: FacturaSenalEmitible;
  condPartEnviadasFecha: Date;
  condPartAdjuntada: boolean;
}

// ---------------------------------------------------------------------------
// Errores de dominio tipados, en español
// ---------------------------------------------------------------------------

/** La factura de señal (o la reserva) no existe para el tenant (RLS) → HTTP 404. */
export class FacturaSenalNoEncontradaError extends Error {
  readonly codigo = 'FACTURA_SENAL_NO_ENCONTRADA' as const;
  readonly reservaId: string;

  constructor(reservaId: string) {
    super('No hay factura de señal para la reserva');
    this.name = 'FacturaSenalNoEncontradaError';
    this.reservaId = reservaId;
  }
}

/** La factura de señal no es enviable (p. ej. `rechazada`) → HTTP 409. */
export class FacturaSenalNoEnviableError extends Error {
  readonly codigo = 'FACTURA_SENAL_NO_ENVIABLE' as const;
  readonly motivo: string;

  constructor(motivo = 'La factura de señal no está en un estado enviable') {
    super(motivo);
    this.name = 'FacturaSenalNoEnviableError';
    this.motivo = motivo;
  }
}

/** Ya existe una COMUNICACION E3 `enviado` para la reserva (idempotencia) → HTTP 409. */
export class E3YaEnviadoError extends Error {
  readonly codigo = 'E3_YA_ENVIADO' as const;
  readonly reservaId: string;

  constructor(reservaId: string) {
    super('La factura de señal ya se envió por E3 para la reserva');
    this.name = 'E3YaEnviadoError';
    this.reservaId = reservaId;
  }
}

/** Fallo recuperable de PDF/email (rollback total) → HTTP 502/503. */
export class EmisionEnvioFallidoError extends Error {
  readonly codigo = 'EMISION_ENVIO_FALLIDO' as const;
  readonly causa: unknown;

  constructor(causa: unknown) {
    super('Fallo en la emisión o el envío de la factura de señal (recuperable)');
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
  error instanceof FacturaSenalNoEncontradaError ||
  error instanceof FacturaSenalNoEnviableError ||
  error instanceof E3YaEnviadoError;

// ---------------------------------------------------------------------------
// Caso de uso
// ---------------------------------------------------------------------------

export class EnviarFacturaSenalUseCase {
  constructor(private readonly deps: EnviarFacturaSenalDeps) {}

  async ejecutar(
    comando: EnviarFacturaSenalComando,
  ): Promise<EnviarFacturaSenalResultado> {
    // (0) Carga la RESERVA (RLS). Cross-tenant/inexistente → 404.
    const reserva = await this.deps.cargarReserva({
      tenantId: comando.tenantId,
      reservaId: comando.reservaId,
    });
    if (reserva === null || reserva === undefined) {
      throw new FacturaSenalNoEncontradaError(comando.reservaId);
    }

    // (1) Unidad de trabajo con reintento ante colisión de numeración (P2002). El envío de E3
    //     vive DENTRO de la tx: si falla, la tx revierte (rollback total, §Atomicidad).
    let ultimoError: unknown = null;
    for (let intento = 0; intento < MAX_REINTENTOS_NUMERACION; intento += 1) {
      try {
        return (await this.deps.unidadDeTrabajo.ejecutar(comando.tenantId, (repos) =>
          this.emitir(comando, reserva, repos),
        )) as EnviarFacturaSenalResultado;
      } catch (error) {
        // Los fallos de negocio (E3, guardas, idempotencia) NO son reintentables.
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
    comando: EnviarFacturaSenalComando,
    reserva: ReservaSenalEmision,
    repos: RepositoriosSenalEmision,
  ): Promise<EnviarFacturaSenalResultado> {
    // Guarda de existencia: la señal debe existir para la reserva.
    const senal = await repos.facturas.buscarPorReservaYTipo(comando.reservaId, 'senal');
    if (senal === null) {
      throw new FacturaSenalNoEncontradaError(comando.reservaId);
    }
    // Guarda de estado enviable: `rechazada` → 409 (no se envía un borrador rechazado).
    if (senal.estado === 'rechazada') {
      throw new FacturaSenalNoEnviableError();
    }

    // Idempotencia: COMUNICACION E3 `enviado` previa → 409 (no re-envía, no duplica, no regenera).
    // Una COMUNICACION E3 `fallido` previa NO bloquea (permite el reintento).
    const e3Previa = await repos.comunicaciones.buscarE3(comando.reservaId);
    if (e3Previa !== null && e3Previa.estado === 'enviado') {
      throw new E3YaEnviadoError(comando.reservaId);
    }

    // Guarda de datos: el PDF de la señal es el adjunto imprescindible. Null → fallo de emisión.
    if (senal.pdfUrl === null) {
      throw new EmisionEnvioFallidoError(
        new Error('La factura de señal no tiene PDF disponible'),
      );
    }

    const ahora = this.deps.clock.ahora();

    // (1b) Genera/OMITE el adjunto de condiciones (`.catch(() => null)`): degradación a `null`
    //      o throw → se omite el adjunto y `condPartAdjuntada=false` (NO tumba E3).
    const urlCondiciones = await this.deps
      .generarCondiciones({ tenantId: comando.tenantId })
      .catch(() => null);
    const condPartAdjuntada = urlCondiciones !== null;

    // (1c) Envío E3 SÍNCRONO y CONFIRMADO (§D-ruta-email): adjunta siempre la señal; las
    //      condiciones solo si se generaron. Si falla → PROPAGA para que la tx revierta.
    const adjuntos: AdjuntoSenalEmision[] = [
      {
        clave: 'senal',
        nombre: 'factura-senal.pdf',
        pdfUrl: senal.pdfUrl,
      },
    ];
    if (urlCondiciones !== null) {
      adjuntos.push({
        clave: 'condiciones',
        nombre: 'condicions-particulars.pdf',
        pdfUrl: urlCondiciones,
      });
    }
    let comunicacionEnviada: {
      idComunicacion: string;
      estado: 'enviado';
      fechaEnvio: Date;
    };
    try {
      comunicacionEnviada = await this.deps.enviarE3({
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

    // (1d) Consolidación SOLO tras confirmar E3: emisión de la señal (conservando su número de
    //      US-022), avance de cond_part_*, COMUNICACION E3 y AUDIT_LOG.
    await repos.facturas.emitir({
      idFactura: senal.idFactura,
      tipo: 'senal',
      numeroFactura: senal.numeroFactura,
      estado: 'enviada',
      fechaEmision: senal.fechaEmision ?? ahora,
    });
    await repos.auditoria.registrar({
      tenantId: comando.tenantId,
      usuarioId: comando.usuarioId,
      entidad: 'FACTURA',
      entidadId: senal.idFactura,
      accion: 'actualizar',
      datosAnteriores: { estado: senal.estado },
      datosNuevos: {
        estado: 'enviada',
        numeroFactura: senal.numeroFactura,
        condPartAdjuntada,
      },
    });

    // Avance de sub-procesos: fija cond_part_enviadas_fecha y cond_part_firmadas=false.
    await repos.reservas.fijarCondicionesEnviadas({
      reservaId: comando.reservaId,
      condPartEnviadasFecha: ahora,
      condPartFirmadas: false,
    });

    // Registro de la COMUNICACION E3 `enviado`.
    await repos.comunicaciones.crear({
      tenantId: comando.tenantId,
      reservaId: comando.reservaId,
      clienteId: reserva.clienteId,
      codigoEmail: 'E3',
      estado: 'enviado',
      fechaEnvio: comunicacionEnviada.fechaEnvio,
      destinatarioEmail: reserva.clienteEmail,
    });

    // Resultado: proyección de la señal emitida + metadatos del envío de condiciones.
    const senalEmitida: FacturaSenalEmitible = {
      ...senal,
      estado: 'enviada',
      fechaEmision: senal.fechaEmision ?? ahora,
    };

    return {
      senal: senalEmitida,
      condPartEnviadasFecha: ahora,
      condPartAdjuntada,
    };
  }
}
