/**
 * Caso de uso de APLICACIÓN: reenviar la factura de liquidación ya emitida (US-028 / D-4).
 *
 * Precondición: la FACTURA `tipo='liquidacion'` está en `estado='enviada'`. El reenvío
 * reutiliza el PDF YA emitido: NO reasigna `numero_factura`, NO cambia `FACTURA.estado` ni
 * los status de la RESERVA. Crea una NUEVA fila `COMUNICACION(codigoEmail='E4',
 * estado='enviado')` por cada reenvío (excepción explícita y auditada a la idempotencia
 * `(reserva_id, codigo_email)` de US-045: el reenvío manual del Gestor es intencionado y DEBE
 * quedar trazado). El use-case NO expone ningún puerto de emisión/renumeración/avance de
 * status (garantía de que un reenvío jamás muta la factura).
 *
 * Hexagonal (hook `no-infra-in-domain`): depende SOLO de puertos inyectados; no importa Prisma.
 */

/** Reloj inyectable para determinismo. */
export interface ClockPort {
  ahora(): Date;
}

/** Sub-estados de la RESERVA (solo para la proyección; no se mutan en el reenvío). */
export type LiquidacionStatus = 'pendiente' | 'facturada' | 'cobrada';
/** fix-liquidacion-fianza-independientes: FianzaStatus reducido a 3 valores. */
export type FianzaStatus = 'pendiente' | 'cobrada' | 'devuelta';

/** Comando del reenvío. */
export interface ReenviarLiquidacionComando {
  tenantId: string;
  usuarioId: string;
  reservaId: string;
}

/** FACTURA de liquidación YA emitida (proyección de lectura). */
export interface FacturaEmitida {
  idFactura: string;
  tenantId: string;
  reservaId: string;
  numeroFactura: string | null;
  tipo: 'liquidacion';
  estado: 'borrador' | 'enviada' | 'cobrada';
  total: string;
  pdfUrl: string | null;
  fechaEmision: Date | null;
}

/** Proyección de la RESERVA para el reenvío (destinatario). */
export interface ReservaReenvio {
  idReserva: string;
  tenantId: string;
  clienteId: string;
  codigo: string;
  liquidacionStatus: LiquidacionStatus;
  fianzaStatus: FianzaStatus;
  clienteEmail: string;
  /** Idioma de la reserva (`'ca'`/`'es'`); elige la plantilla E4 del catálogo. */
  idioma?: string;
  /** Nombre de pila del cliente (para el nombre del adjunto PDF del email E4). */
  clienteNombre?: string;
  /** Apellidos del cliente (para el nombre del adjunto PDF del email E4). */
  clienteApellidos?: string;
  /** Importe de la fianza (Decimal string) para el recordatorio del email E4. */
  fianzaEur?: string | null;
}

/** Adjunto de E4 por referencia a `pdf_url`. */
export interface AdjuntoReenvio {
  clave: string;
  nombre: string;
  pdfUrl: string;
}

/** Proyección de la COMUNICACION de reenvío. */
export interface ComunicacionReenvio {
  idComunicacion: string;
  estado?: string;
  fechaEnvio?: Date | null;
}

/** Parámetros del reenvío de E4. */
export interface ReenviarE4Params {
  tenantId: string;
  reservaId: string;
  destinatario: string;
  codigoReserva: string;
  numeroFactura: string | null;
  /** Idioma de la reserva (`'ca'`/`'es'`); el adapter selecciona la plantilla E4. */
  idioma?: string;
  /** Nombre de pila del cliente para el saludo de la plantilla. */
  nombre?: string;
  /** Importe de la fianza (Decimal string) para el recordatorio del email. */
  fianzaEur?: string | null;
  adjuntos: AdjuntoReenvio[];
  /** Índice laxo: permite que el doble de test tipe los params como `Record`. */
  [extra: string]: unknown;
}

/** Puerto de reenvío de E4 (transporte síncrono/confirmado). */
export interface ReenviarE4Port {
  (
    params: ReenviarE4Params,
  ): Promise<{ idComunicacion: string; estado: 'enviado'; fechaEnvio: Date }>;
}

/** Parámetros de registro de la NUEVA COMUNICACION de reenvío. */
export interface RegistrarComunicacionReenvioParams {
  tenantId: string;
  reservaId: string;
  clienteId: string;
  codigoEmail: 'E4';
  estado: 'enviado';
  fechaEnvio: Date;
  destinatarioEmail: string;
  /** Índice laxo: permite que el doble de test tipe los params como `Record`. */
  [extra: string]: unknown;
}

/** Puerto de registro de la NUEVA COMUNICACION de reenvío. */
export interface RegistrarComunicacionReenvioPort {
  (params: RegistrarComunicacionReenvioParams): Promise<ComunicacionReenvio>;
}

/** Puerto de auditoría del reenvío. */
export interface RegistrarAuditoriaReenvioPort {
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
export interface CargarReservaReenvioPort {
  (params: {
    tenantId: string;
    reservaId: string;
  }): Promise<ReservaReenvio | null | undefined>;
}

/** Lectura de la FACTURA de liquidación por reserva (RLS). */
export interface CargarLiquidacionReenvioPort {
  (params: {
    tenantId: string;
    reservaId: string;
  }): Promise<FacturaEmitida | null | undefined>;
}

/**
 * Dependencias del reenvío. Intencionadamente SIN puertos de emisión/renumeración/avance de
 * status: el reenvío jamás muta la factura ni la RESERVA (test 3.7).
 */
export interface ReenviarLiquidacionDeps {
  cargarReserva: CargarReservaReenvioPort;
  cargarLiquidacion: CargarLiquidacionReenvioPort;
  reenviarE4: ReenviarE4Port;
  registrarComunicacion: RegistrarComunicacionReenvioPort;
  registrarAuditoria: RegistrarAuditoriaReenvioPort;
  clock: ClockPort;
}

/** Resultado del reenvío: la nueva COMUNICACION creada. */
export interface ReenviarLiquidacionResultado {
  comunicacion: ComunicacionReenvio;
}

// ---------------------------------------------------------------------------
// Errores de dominio tipados, en español
// ---------------------------------------------------------------------------

/** La liquidación (o la reserva) no existe para el tenant (RLS) → HTTP 404. */
export class FacturaLiquidacionNoEncontradaError extends Error {
  readonly codigo = 'FACTURA_LIQUIDACION_NO_ENCONTRADA' as const;
  readonly reservaId: string;

  constructor(reservaId: string) {
    super('No hay factura de liquidación para la reserva');
    this.name = 'FacturaLiquidacionNoEncontradaError';
    this.reservaId = reservaId;
  }
}

/** La liquidación no está `enviada` (sigue en borrador): nada que reenviar → HTTP 409. */
export class FacturaNoEnviadaError extends Error {
  readonly codigo = 'FACTURA_NO_ENVIADA' as const;
  readonly motivo: string;

  constructor(motivo = 'La factura de liquidación aún no ha sido emitida') {
    super(motivo);
    this.name = 'FacturaNoEnviadaError';
    this.motivo = motivo;
  }
}

// ---------------------------------------------------------------------------
// Caso de uso
// ---------------------------------------------------------------------------

export class ReenviarLiquidacionUseCase {
  constructor(private readonly deps: ReenviarLiquidacionDeps) {}

  async ejecutar(
    comando: ReenviarLiquidacionComando,
  ): Promise<ReenviarLiquidacionResultado> {
    const reserva = await this.deps.cargarReserva({
      tenantId: comando.tenantId,
      reservaId: comando.reservaId,
    });
    if (reserva === null || reserva === undefined) {
      throw new FacturaLiquidacionNoEncontradaError(comando.reservaId);
    }
    const liquidacion = await this.deps.cargarLiquidacion({
      tenantId: comando.tenantId,
      reservaId: comando.reservaId,
    });
    if (liquidacion === null || liquidacion === undefined) {
      throw new FacturaLiquidacionNoEncontradaError(comando.reservaId);
    }
    if (liquidacion.estado !== 'enviada') {
      throw new FacturaNoEnviadaError();
    }

    // Reenvía el PDF YA emitido (no regenera contenido fiscal ni reasigna número).
    await this.deps.reenviarE4({
      tenantId: comando.tenantId,
      reservaId: comando.reservaId,
      destinatario: reserva.clienteEmail,
      codigoReserva: reserva.codigo,
      numeroFactura: liquidacion.numeroFactura,
      idioma: reserva.idioma,
      nombre: reserva.clienteNombre,
      fianzaEur: reserva.fianzaEur,
      adjuntos: [
        {
          clave: 'liquidacion',
              nombre: `${liquidacion.numeroFactura ?? 'Liquidación'} ${reserva.clienteNombre ?? ''} ${reserva.clienteApellidos ?? ''}`.trim() + '.pdf',
          pdfUrl: liquidacion.pdfUrl ?? '',
        },
      ],
    });

    // NUEVA fila COMUNICACION E4 por cada reenvío (excepción auditada a la idempotencia).
    const fechaEnvio = this.deps.clock.ahora();
    const comunicacion = await this.deps.registrarComunicacion({
      tenantId: comando.tenantId,
      reservaId: comando.reservaId,
      clienteId: reserva.clienteId,
      codigoEmail: 'E4',
      estado: 'enviado',
      fechaEnvio,
      destinatarioEmail: reserva.clienteEmail,
    });
    await this.deps.registrarAuditoria({
      tenantId: comando.tenantId,
      usuarioId: comando.usuarioId,
      entidad: 'COMUNICACION',
      entidadId: comunicacion.idComunicacion,
      accion: 'crear',
      datosNuevos: {
        codigoEmail: 'E4',
        estado: 'enviado',
        reenvio: true,
        numeroFactura: liquidacion.numeroFactura,
      },
    });

    return { comunicacion };
  }
}
