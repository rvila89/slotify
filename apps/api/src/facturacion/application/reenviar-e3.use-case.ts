/**
 * Caso de uso de APLICACIÓN: reenviar E3 (factura de señal 40% + condicions particulars) ya
 * enviado previamente (US-023 / GAP 3, §D-reenvio-e3). Espejo literal de
 * `ReenviarLiquidacionUseCase` (E4, US-028) adaptado a la señal + condiciones.
 *
 * Precondición: debe existir una COMUNICACION E3 `enviado` (`es_reenvio=false`) previa para la
 * reserva y la factura de señal `enviada`. El reenvío REUTILIZA los documentos existentes: el PDF
 * de la señal ya emitido y el DOCUMENTO `tipo='condiciones_particulares'` ya persistido (GAP 1).
 * NO regenera el PDF de condiciones, NO duplica el DOCUMENTO, NO reasigna `numero_factura`, NO
 * cambia `FACTURA.estado` ni transiciona la RESERVA. Crea una NUEVA fila COMUNICACION E3
 * (`estado='enviado'`, `es_reenvio=true`) —excepción explícita y auditada al índice UNIQUE parcial
 * `(reserva_id, codigo_email) WHERE es_reenvio=false`— y actualiza
 * `RESERVA.cond_part_enviadas_fecha=now()`.
 *
 * Atomicidad (§Atomicidad): envío E3 SÍNCRONO y CONFIRMADO PRIMERO; si el proveedor falla →
 * `EmisionEnvioFallidoError` y NO se crea la COMUNICACION de reenvío ni se actualiza la fecha
 * (rollback). El use-case NO expone ningún puerto de emisión/renumeración de factura ni de
 * transición de la RESERVA (garantía de que un reenvío jamás muta la factura).
 *
 * change `condiciones-particulares-senal-y-recordatorio-liquidacion`: las condiciones ya NO se
 * persisten como DOCUMENTO (dejaron E2); el reenvío REGENERA el PDF en blanco vía
 * `GenerarPdfCondicionesPort` (degradable: `null` → E3 solo con la señal), en vez de buscar un
 * DOCUMENTO stale.
 *
 * Hexagonal (hook `no-infra-in-domain`): depende SOLO de puertos inyectados; no importa Prisma.
 */
import type { GenerarPdfCondicionesPort } from '../../documentos/domain/generar-pdf-condiciones.port';

/** Reloj inyectable para determinismo. */
export interface ClockPort {
  ahora(): Date;
}

/** Comando del reenvío de E3. */
export interface ReenviarE3Comando {
  tenantId: string;
  usuarioId: string;
  reservaId: string;
}

/** FACTURA de señal YA emitida (proyección de lectura; no se muta). */
export interface FacturaSenalReenvio {
  idFactura: string;
  tenantId: string;
  reservaId: string;
  numeroFactura: string | null;
  tipo: 'senal';
  estado: 'borrador' | 'enviada' | 'cobrada';
  total: string;
  pdfUrl: string | null;
  fechaEmision: Date | null;
}

/** Proyección de la RESERVA para el reenvío (destinatario + fecha de condiciones). */
export interface ReservaReenvioE3 {
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
}

/** Proyección de la COMUNICACION E3 previa (para la precondición de reenvío). */
export interface ComunicacionE3PreviaReenvio {
  idComunicacion: string;
  estado: string;
  esReenvio: boolean;
}


/** Adjunto de E3 por referencia a `pdf_url`. */
export interface AdjuntoReenvioE3 {
  clave: string;
  nombre: string;
  pdfUrl: string;
}

/** Proyección de la NUEVA COMUNICACION de reenvío. */
export interface ComunicacionReenvioE3 {
  idComunicacion: string;
  estado?: string;
  fechaEnvio?: Date | null;
  esReenvio?: boolean;
}

/** Parámetros del reenvío de E3. */
export interface ReenviarE3Params {
  tenantId: string;
  reservaId: string;
  clienteId: string;
  destinatario: string;
  codigoReserva: string;
  numeroFactura: string | null;
  /** Idioma de la reserva (`'ca'`/`'es'`); el adapter selecciona la plantilla E3. */
  idioma?: string;
  /** Nombre de pila del cliente para el saludo de la plantilla. */
  nombre?: string;
  /** ¿El reenvío lleva el adjunto de condiciones? Gobierna el párrafo condicional del render E3. */
  condicionesAdjuntas?: boolean;
  adjuntos: AdjuntoReenvioE3[];
  /** Índice laxo: permite que el doble de test tipe los params como `Record`. */
  [extra: string]: unknown;
}

/** Puerto de reenvío de E3 (transporte síncrono/confirmado, puerto directo). */
export interface ReenviarE3Port {
  (
    params: ReenviarE3Params,
  ): Promise<{ idComunicacion: string; estado: 'enviado'; fechaEnvio: Date }>;
}

/** Parámetros de registro de la NUEVA COMUNICACION de reenvío (es_reenvio=true). */
export interface RegistrarComunicacionReenvioE3Params {
  tenantId: string;
  reservaId: string;
  clienteId: string;
  codigoEmail: 'E3';
  estado: 'enviado';
  esReenvio: true;
  fechaEnvio: Date;
  destinatarioEmail: string;
  /** Índice laxo: permite que el doble de test tipe los params como `Record`. */
  [extra: string]: unknown;
}

/** Puerto de registro de la NUEVA COMUNICACION de reenvío. */
export interface RegistrarComunicacionReenvioE3Port {
  (params: RegistrarComunicacionReenvioE3Params): Promise<ComunicacionReenvioE3>;
}

/** Puerto de actualización de `cond_part_enviadas_fecha` (nuevo timestamp del reenvío). */
export interface FijarCondicionesEnviadasReenvioPort {
  (params: {
    tenantId: string;
    reservaId: string;
    condPartEnviadasFecha: Date;
  }): Promise<void>;
}

/** Puerto de auditoría del reenvío. */
export interface RegistrarAuditoriaReenvioE3Port {
  (registro: {
    tenantId: string;
    usuarioId?: string | null;
    entidad: 'COMUNICACION';
    entidadId: string;
    accion: 'crear';
    datosNuevos: Record<string, unknown>;
  }): Promise<void>;
}

/** Lectura de la RESERVA (RLS: cross-tenant → null). */
export interface CargarReservaReenvioE3Port {
  (params: {
    tenantId: string;
    reservaId: string;
  }): Promise<ReservaReenvioE3 | null | undefined>;
}

/** Lectura de la FACTURA de señal por reserva (RLS). */
export interface CargarFacturaSenalReenvioPort {
  (params: {
    tenantId: string;
    reservaId: string;
  }): Promise<FacturaSenalReenvio | null | undefined>;
}

/** Lectura de la COMUNICACION E3 previa (`es_reenvio=false`) de la reserva. */
export interface BuscarE3PreviaPort {
  (params: {
    tenantId: string;
    reservaId: string;
  }): Promise<ComunicacionE3PreviaReenvio | null | undefined>;
}

/**
 * Dependencias del reenvío de E3. Intencionadamente SIN puertos de emisión/renumeración de
 * factura, de transición de la RESERVA ni de creación/regeneración de documentos: el reenvío
 * jamás muta la factura ni transiciona la reserva ni duplica documentos (test 3.5).
 */
export interface ReenviarE3Deps {
  cargarReserva: CargarReservaReenvioE3Port;
  cargarFacturaSenal: CargarFacturaSenalReenvioPort;
  buscarE3Previa: BuscarE3PreviaPort;
  /**
   * Regenera el PDF de condicions particulars en blanco (change condiciones-…-senal-…). Degradable:
   * `null` → el reenvío va SOLO con la señal. Sustituye al `buscarDocumentoCondiciones` stale.
   */
  generarCondiciones: GenerarPdfCondicionesPort;
  reenviarE3: ReenviarE3Port;
  registrarComunicacion: RegistrarComunicacionReenvioE3Port;
  fijarCondicionesEnviadas: FijarCondicionesEnviadasReenvioPort;
  registrarAuditoria: RegistrarAuditoriaReenvioE3Port;
  clock: ClockPort;
}

/** Resultado del reenvío: la nueva COMUNICACION creada + el nuevo timestamp de condiciones. */
export interface ReenviarE3Resultado {
  comunicacion: ComunicacionReenvioE3;
  condPartEnviadasFecha: Date;
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

/** No existe una COMUNICACION E3 `enviado` previa: nada que reenviar → HTTP 409. */
export class E3NoEnviadoPreviamenteError extends Error {
  readonly codigo = 'E3_NO_ENVIADO_PREVIAMENTE' as const;
  readonly reservaId: string;

  constructor(reservaId: string) {
    super('E3 no se envió previamente para la reserva: no hay nada que reenviar');
    this.name = 'E3NoEnviadoPreviamenteError';
    this.reservaId = reservaId;
  }
}

/** Fallo recuperable de email en el reenvío (rollback total) → HTTP 502/503. */
export class EmisionEnvioFallidoError extends Error {
  readonly codigo = 'EMISION_ENVIO_FALLIDO' as const;
  readonly causa: unknown;

  constructor(causa: unknown) {
    super('Fallo en el reenvío de E3 (recuperable)');
    this.name = 'EmisionEnvioFallidoError';
    this.causa = causa;
  }
}

// ---------------------------------------------------------------------------
// Caso de uso
// ---------------------------------------------------------------------------

export class ReenviarE3UseCase {
  constructor(private readonly deps: ReenviarE3Deps) {}

  async ejecutar(comando: ReenviarE3Comando): Promise<ReenviarE3Resultado> {
    // (0) Guardas de existencia (RLS): reserva y factura de señal deben existir en el tenant.
    const reserva = await this.deps.cargarReserva({
      tenantId: comando.tenantId,
      reservaId: comando.reservaId,
    });
    if (reserva === null || reserva === undefined) {
      throw new FacturaSenalNoEncontradaError(comando.reservaId);
    }
    const senal = await this.deps.cargarFacturaSenal({
      tenantId: comando.tenantId,
      reservaId: comando.reservaId,
    });
    if (senal === null || senal === undefined) {
      throw new FacturaSenalNoEncontradaError(comando.reservaId);
    }

    // (1) Precondición: debe existir una COMUNICACION E3 `enviado` previa (`fallido` no cuenta).
    const e3Previa = await this.deps.buscarE3Previa({
      tenantId: comando.tenantId,
      reservaId: comando.reservaId,
    });
    if (
      e3Previa === null ||
      e3Previa === undefined ||
      e3Previa.estado !== 'enviado'
    ) {
      throw new E3NoEnviadoPreviamenteError(comando.reservaId);
    }

    // (2) REGENERA el PDF de condicions particulars en blanco (change condiciones-…-senal-…) con el
    //     idioma de la reserva, en vez de buscar un DOCUMENTO persistido (stale). Degradable
    //     (`.catch(() => null)`): si degrada, el reenvío adjunta SOLO la señal ya emitida.
    const idiomaCondiciones: 'es' | 'ca' = reserva.idioma === 'ca' ? 'ca' : 'es';
    const urlCondiciones = await this.deps.generarCondiciones
      .generar({ tenantId: comando.tenantId, idioma: idiomaCondiciones })
      .catch(() => null);
    const adjuntos: AdjuntoReenvioE3[] = [
      {
        clave: 'senal',
        nombre: `${senal.numeroFactura ?? 'Factura'} ${reserva.clienteNombre ?? ''} ${reserva.clienteApellidos ?? ''}.pdf`,
        pdfUrl: senal.pdfUrl ?? '',
      },
    ];
    if (urlCondiciones !== null) {
      adjuntos.push({
        clave: 'condiciones',
        nombre:
          idiomaCondiciones === 'ca'
            ? 'condicions-particulars.pdf'
            : 'condiciones-particulares.pdf',
        pdfUrl: urlCondiciones,
      });
    }

    // (3) Envío E3 SÍNCRONO y CONFIRMADO PRIMERO. Si el proveedor falla → rollback: no se crea la
    //     COMUNICACION de reenvío ni se actualiza `cond_part_enviadas_fecha`.
    try {
      await this.deps.reenviarE3({
        tenantId: comando.tenantId,
        reservaId: comando.reservaId,
        clienteId: reserva.clienteId,
        destinatario: reserva.clienteEmail,
        codigoReserva: reserva.codigo,
        numeroFactura: senal.numeroFactura,
        idioma: reserva.idioma,
        nombre: reserva.clienteNombre,
        condicionesAdjuntas: urlCondiciones !== null,
        adjuntos,
      });
    } catch (error) {
      throw new EmisionEnvioFallidoError(error);
    }

    // (4) Solo tras confirmar E3: NUEVA COMUNICACION E3 `es_reenvio=true` (esquiva el UNIQUE
    //     parcial), nuevo `cond_part_enviadas_fecha` y AUDIT_LOG del reenvío.
    const fechaEnvio = this.deps.clock.ahora();
    const comunicacion = await this.deps.registrarComunicacion({
      tenantId: comando.tenantId,
      reservaId: comando.reservaId,
      clienteId: reserva.clienteId,
      codigoEmail: 'E3',
      estado: 'enviado',
      esReenvio: true,
      fechaEnvio,
      destinatarioEmail: reserva.clienteEmail,
    });
    if (urlCondiciones !== null) {
      await this.deps.fijarCondicionesEnviadas({
        tenantId: comando.tenantId,
        reservaId: comando.reservaId,
        condPartEnviadasFecha: fechaEnvio,
      });
    }
    await this.deps.registrarAuditoria({
      tenantId: comando.tenantId,
      usuarioId: comando.usuarioId,
      entidad: 'COMUNICACION',
      entidadId: comunicacion.idComunicacion,
      accion: 'crear',
      datosNuevos: {
        codigoEmail: 'E3',
        estado: 'enviado',
        esReenvio: true,
        numeroFactura: senal.numeroFactura,
      },
    });

    return { comunicacion, condPartEnviadasFecha: fechaEnvio };
  }
}
