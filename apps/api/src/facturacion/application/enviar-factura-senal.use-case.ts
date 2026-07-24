/**
 * Caso de uso de APLICACIÓN: enviar la factura de señal (40%) por E3 (US-023 / UC-18). Acción
 * ÚNICA y ATÓMICA estado↔E3 (design.md §Atomicidad, espejo literal de
 * `aprobar-y-enviar-liquidacion.use-case.ts` de E4) que FUNDE "aprobar + enviar" sobre la factura
 * de señal, envía el email E3 con el PDF de la señal y avanza los sub-procesos de la RESERVA.
 *
 * change `condiciones-particulares-senal-y-recordatorio-liquidacion`: las CONDICIONS PARTICULARS
 * vuelven a E3 (dejan E2) de forma DEGRADABLE. El PDF de condiciones se genera PRE-TX con el
 * idioma de la reserva vía `GenerarPdfCondicionesPort` (`.catch(() => null)`): si hay URL, E3 lleva
 * DOS adjuntos (señal + condiciones), se fija `cond_part_enviadas_fecha` DENTRO de la tx y
 * `condicionesAdjuntas: true` viaja a los params de E3; si degrada a `null`, E3 lleva SOLO la señal,
 * NO se fija la fecha, `condicionesAdjuntas: false` y no hay 409.
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
 *        b. Envía E3 SÍNCRONO y CONFIRMADO por el puerto DIRECTO con el ÚNICO adjunto de la
 *           señal. Si falla → PROPAGA `EmisionEnvioFallidoError` y la tx REVIERTE (rollback).
 *        c. Solo tras confirmar E3: emite la señal (`borrador → enviada`, fija `fecha_emision`
 *           conservando `numero_factura` de US-022), registra la COMUNICACION E3 `enviado` y el
 *           AUDIT_LOG.
 *
 * Hexagonal (hook `no-infra-in-domain`): depende SOLO de puertos inyectados; no importa Prisma ni
 * `@nestjs/*`.
 */
import type { EstadoFactura, TipoFactura } from '../domain/factura';
import type { GenerarPdfCondicionesPort } from '../../documentos/domain/generar-pdf-condiciones.port';

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
  entidad: 'FACTURA' | 'RESERVA' | 'COMUNICACION' | 'DOCUMENTO';
  entidadId: string;
  accion: 'actualizar' | 'crear';
  datosAnteriores?: Record<string, unknown> | null;
  datosNuevos?: Record<string, unknown> | null;
}

/** Repositorio tx-bound de AUDIT_LOG. */
export interface AuditoriaSenalEmisionPort {
  registrar(registro: RegistroAuditoriaSenalEmision): Promise<void>;
}

/** Repositorio tx-bound de la RESERVA: fija `cond_part_enviadas_fecha` al adjuntar condiciones. */
export interface ReservasSenalEmisionPort {
  /**
   * Fija `cond_part_enviadas_fecha` (y `cond_part_firmadas=false`) DENTRO de la tx de la emisión,
   * SOLO cuando E3 lleva el adjunto de condiciones (change condiciones-…-senal-…).
   */
  fijarCondicionesEnviadas(params: {
    reservaId: string;
    condPartEnviadasFecha: Date;
  }): Promise<void>;
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
  /** Idioma de la reserva (`'ca'`/`'es'`); elige la plantilla E3 del catálogo. */
  idioma?: string;
  /** Nombre de pila del cliente (nombre del adjunto + saludo del email). */
  clienteNombre?: string;
  /** Apellidos del cliente (nombre del adjunto de la señal). */
  clienteApellidos?: string;
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
  /** Idioma de la reserva (`'ca'`/`'es'`); el adapter selecciona la plantilla E3. */
  idioma?: string;
  /** Nombre de pila del cliente para el saludo de la plantilla. */
  nombre?: string;
  /** ¿El email lleva el adjunto de condiciones? Gobierna el párrafo condicional del render E3. */
  condicionesAdjuntas?: boolean;
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

/** Reloj inyectable para determinismo. */
export interface ClockPort {
  ahora(): Date;
}

/** Dependencias del caso de uso (puertos inyectados). */
export interface EnviarFacturaSenalDeps {
  unidadDeTrabajo: UnidadDeTrabajoSenalEmisionPort;
  cargarReserva: CargarReservaSenalEmisionPort;
  enviarE3: EnviarE3EmisionPort;
  /**
   * Genera el PDF de condicions particulars PRE-TX con el idioma de la reserva (degradable:
   * `null`/lanza → E3 sin condiciones). change condiciones-…-senal-….
   */
  generarCondiciones: GenerarPdfCondicionesPort;
  clock: ClockPort;
}

/** Resultado del envío: factura de señal emitida + timestamp de condiciones (fijado en E2). */
export interface EnviarFacturaSenalResultado {
  senal: FacturaSenalEmitible;
  /**
   * Timestamp `RESERVA.cond_part_enviadas_fecha` (Mejora B: lo fija E2 al confirmar el
   * presupuesto, no este envío). Se refleja en la respuesta del contrato.
   */
  condPartEnviadasFecha: Date | null;
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

    // PRE-TX (degradable): genera el PDF de condicions particulars con el idioma de la reserva.
    // Un `null` (tenant sin config) o un fallo de render (`.catch(() => null)`) degrada: E3 se
    // envía SOLO con la señal, sin fijar `cond_part_enviadas_fecha` ni 409. change condiciones-….
    const idiomaCondiciones: 'es' | 'ca' = reserva.idioma === 'ca' ? 'ca' : 'es';
    const urlCondiciones = await this.deps.generarCondiciones
      .generar({ tenantId: comando.tenantId, idioma: idiomaCondiciones })
      .catch(() => null);

    // (1) Unidad de trabajo con reintento ante colisión de numeración (P2002). El envío de E3
    //     vive DENTRO de la tx: si falla, la tx revierte (rollback total, §Atomicidad).
    let ultimoError: unknown = null;
    for (let intento = 0; intento < MAX_REINTENTOS_NUMERACION; intento += 1) {
      try {
        return (await this.deps.unidadDeTrabajo.ejecutar(comando.tenantId, (repos) =>
          this.emitir(comando, reserva, repos, urlCondiciones, idiomaCondiciones),
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
    urlCondiciones: string | null,
    idiomaCondiciones: 'es' | 'ca',
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

    // (1b) Envío E3 SÍNCRONO y CONFIRMADO (§D-ruta-email): adjunta la factura de señal y, si el
    //      PDF de condiciones se generó (degradable, PRE-TX), también las condicions particulars
    //      (change condiciones-…-senal-…). Si el envío falla → PROPAGA (rollback total).
    const condicionesAdjuntas = urlCondiciones !== null;
    const adjuntos: AdjuntoSenalEmision[] = [
      {
        clave: 'senal',
        nombre: `${senal.numeroFactura ?? 'Factura'} ${reserva.clienteNombre ?? ''} ${reserva.clienteApellidos ?? ''}.pdf`,
        pdfUrl: senal.pdfUrl,
      },
    ];
    if (condicionesAdjuntas) {
      adjuntos.push({
        clave: 'condiciones',
        nombre:
          idiomaCondiciones === 'ca'
            ? 'condicions-particulars.pdf'
            : 'condiciones-particulares.pdf',
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
        idioma: reserva.idioma,
        nombre: reserva.clienteNombre,
        condicionesAdjuntas,
        adjuntos,
      });
    } catch (error) {
      throw new EmisionEnvioFallidoError(error);
    }

    // (1c) Consolidación SOLO tras confirmar E3: emisión de la señal (conservando su número de
    //      US-022), COMUNICACION E3 y AUDIT_LOG. Si E3 llevó condiciones, se fija
    //      `cond_part_enviadas_fecha` DENTRO de la misma tx (change condiciones-…-senal-…).
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
      },
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

    // Fijación de `cond_part_enviadas_fecha` SOLO si E3 llevó el adjunto de condiciones.
    let condPartEnviadasFecha = reserva.condPartEnviadasFecha;
    if (condicionesAdjuntas) {
      await repos.reservas.fijarCondicionesEnviadas({
        reservaId: comando.reservaId,
        condPartEnviadasFecha: ahora,
      });
      condPartEnviadasFecha = ahora;
    }

    // Resultado: proyección de la señal emitida.
    const senalEmitida: FacturaSenalEmitible = {
      ...senal,
      estado: 'enviada',
      fechaEmision: senal.fechaEmision ?? ahora,
    };

    return { senal: senalEmitida, condPartEnviadasFecha };
  }
}
