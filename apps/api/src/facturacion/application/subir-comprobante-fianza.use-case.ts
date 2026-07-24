/**
 * Caso de uso de APLICACIÓN: subir el COMPROBANTE de la transferencia de fianza recibida
 * (fix-liquidacion-fianza-independientes / UC-22) — espejo de `registrar-firma-condiciones`.
 *
 * La fianza deja de ser una FACTURA: se convierte en una sección PASIVA donde el Gestor sube el
 * comprobante de la transferencia recibida del cliente. Marca `fianza_status='cobrada'`
 * (comprobante recibido). NO es una transición de la máquina de estados: solo ACTUALIZA
 * `fianza_status`/`fianza_cobrada_fecha`/`fianza_comprobante_fecha`. Es OPCIONAL, re-subible
 * (histórico conservado) y NO bloquea ningún avance de estado.
 *
 * Orquestación:
 *   (0) Guardas SÍNCRONAS previas a la tx (rechazo SIN efectos). Orden: existencia (404) →
 *       estado válido `{reserva_confirmada, evento_en_curso, post_evento}` (422) → fichero
 *       presente / formato / tamaño (422). Se validan ANTES de subir el fichero y de abrir la tx.
 *   (1) Sube físicamente el comprobante al almacenamiento (fuera de la tx crítica).
 *   (2) En UNA unidad de trabajo (tx + RLS), all-or-nothing:
 *         a. Crea una fila DOCUMENTO NUEVA `tipo='comprobante_fianza'` (NO idempotente).
 *         b. Marca la RESERVA `fianza_status='cobrada'` + `fianza_cobrada_fecha` +
 *            `fianza_comprobante_fecha = clock.ahora()`. NO toca `estado` ni otros sub-procesos.
 *         c. AUDIT_LOG `accion='actualizar'`, `entidad='RESERVA'`.
 *
 * Hexagonal (hook `no-infra-in-domain`): depende SOLO de puertos inyectados; no importa Prisma
 * ni `@nestjs/*`.
 */

// ---------------------------------------------------------------------------
// Estados de la RESERVA que admiten la subida del comprobante (guarda de estado).
// ---------------------------------------------------------------------------

const ESTADOS_VALIDOS_COMPROBANTE: ReadonlyArray<string> = [
  'reserva_confirmada',
  'evento_en_curso',
  'post_evento',
];

/** ¿El estado de la RESERVA admite subir el comprobante de la fianza? */
export const esEstadoValidoParaComprobanteFianza = (estado: string): boolean =>
  ESTADOS_VALIDOS_COMPROBANTE.includes(estado);

// ---------------------------------------------------------------------------
// Tipos de comando / proyecciones / puertos
// ---------------------------------------------------------------------------

/** Comprobante de la transferencia subido por el Gestor (multipart). */
export interface ComprobanteFianzaSubido {
  nombreArchivo: string;
  mimeType: string;
  tamanoBytes: number;
  buffer: Buffer;
}

/** Comando de subida del comprobante de la fianza. */
export interface SubirComprobanteFianzaComando {
  /** Tenant del gestor (del JWT, nunca del body/path). */
  tenantId: string;
  /** Identificador del gestor que ejecuta la operación (para auditoría). */
  usuarioId: string;
  /** RESERVA sobre la que se sube el comprobante (debe existir, estado válido). */
  reservaId: string;
  /** Comprobante; `null` si no se adjuntó (→ COMPROBANTE_REQUERIDO). */
  comprobante: ComprobanteFianzaSubido | null;
}

/** Proyección de la RESERVA relevante: estado (guarda) + `fianza_status` anterior (auditoría). */
export interface ReservaComprobanteFianza {
  idReserva: string;
  tenantId: string;
  estado: string;
  fianzaStatus: string;
}

/** Reloj inyectable para determinismo. */
export interface ClockPort {
  ahora(): Date;
}

/** Datos para crear la fila DOCUMENTO del comprobante. */
export interface CrearDocumentoComprobanteParams {
  tipo: 'comprobante_fianza';
  reservaId: string;
  tenantId: string;
  url: string;
  mimeType: string;
  nombreArchivo: string;
  tamanoBytes?: number;
}

/** DOCUMENTO creado (proyección de vuelta). */
export interface DocumentoComprobanteCreado {
  idDocumento: string;
  tipo: string;
  reservaId?: string;
  tenantId?: string;
  url: string;
  mimeType: string;
}

/** Parámetros del marcado de la RESERVA (solo la fianza; SIN estado ni otros sub-procesos). */
export interface MarcarComprobanteFianzaParams {
  idReserva: string;
  fianzaStatus: 'cobrada';
  fianzaCobradaFecha: Date;
  fianzaComprobanteFecha: Date;
}

/** Registro de auditoría (`actualizar`, NUNCA `transicion`). */
export interface RegistroAuditoriaComprobanteFianza {
  tenantId: string;
  usuarioId?: string | null;
  accion: 'actualizar';
  entidad: 'RESERVA';
  entidadId: string;
  datosAnteriores: { fianzaStatus: string };
  datosNuevos: {
    fianzaStatus: 'cobrada';
    fianzaCobradaFecha: Date;
    fianzaComprobanteFecha: Date;
  };
}

/** Conjunto de repositorios tx-bound disponibles dentro de la unidad de trabajo. */
export interface RepositoriosComprobanteFianza {
  documentos: {
    crear(params: CrearDocumentoComprobanteParams): Promise<DocumentoComprobanteCreado>;
  };
  reservas: {
    marcarComprobante(params: MarcarComprobanteFianzaParams): Promise<void>;
  };
  auditoria: {
    registrar(registro: RegistroAuditoriaComprobanteFianza): Promise<void>;
  };
}

/** Unidad de trabajo transaccional (tx + RLS). Un rechazo del `trabajo` revierte todo. */
export interface UnidadDeTrabajoComprobanteFianzaPort {
  ejecutar(
    tenantId: string,
    trabajo: (repos: RepositoriosComprobanteFianza) => Promise<unknown>,
  ): Promise<unknown>;
}

/** Lectura de la RESERVA (fuera de la tx crítica; RLS: cross-tenant → null). */
export interface CargarReservaComprobanteFianzaPort {
  (params: {
    tenantId: string;
    reservaId: string;
  }): Promise<ReservaComprobanteFianza | null | undefined>;
}

/** Almacenamiento físico del comprobante; devuelve la `url` persistible. */
export interface AlmacenarComprobanteFianzaPort {
  (params: {
    tenantId: string;
    reservaId: string;
    comprobante: ComprobanteFianzaSubido;
  }): Promise<string>;
}

/** Dependencias del caso de uso (puertos inyectados). */
export interface SubirComprobanteFianzaDeps {
  unidadDeTrabajo: UnidadDeTrabajoComprobanteFianzaPort;
  cargarReserva: CargarReservaComprobanteFianzaPort;
  almacenarComprobante: AlmacenarComprobanteFianzaPort;
  clock: ClockPort;
}

/** Resultado de la subida (para la respuesta HTTP). */
export interface SubirComprobanteFianzaResultado {
  reservaId: string;
  fianzaStatus: 'cobrada';
  fianzaCobradaFecha: Date;
  fianzaComprobanteFecha: Date;
  documento: DocumentoComprobanteCreado;
}

// ---------------------------------------------------------------------------
// Errores de dominio tipados, en español (con propiedad `codigo`)
// ---------------------------------------------------------------------------

/** La RESERVA no existe para el tenant (RLS): cross-tenant invisible → 404. */
export class ReservaNoEncontradaError extends Error {
  readonly codigo = 'RESERVA_NO_ENCONTRADA' as const;
  readonly reservaId: string;

  constructor(reservaId: string) {
    super('La reserva no existe para el tenant');
    this.name = 'ReservaNoEncontradaError';
    this.reservaId = reservaId;
  }
}

/** El estado de la RESERVA no admite subir el comprobante (terminal/otro) → 422. */
export class EstadoInvalidoError extends Error {
  readonly codigo = 'ESTADO_INVALIDO' as const;

  constructor(
    mensaje = 'No se puede subir el comprobante de la fianza en el estado actual de la reserva',
  ) {
    super(mensaje);
    this.name = 'EstadoInvalidoError';
  }
}

/** No se adjuntó el fichero del comprobante → 422. */
export class ComprobanteRequeridoError extends Error {
  readonly codigo = 'COMPROBANTE_REQUERIDO' as const;

  constructor(mensaje = 'Es obligatorio adjuntar el comprobante de la transferencia de fianza') {
    super(mensaje);
    this.name = 'ComprobanteRequeridoError';
  }
}

/** El `mimeType` del fichero no está permitido (no jpeg/png/pdf) → 422. */
export class FormatoNoPermitidoError extends Error {
  readonly codigo = 'FORMATO_NO_PERMITIDO' as const;
  readonly mimeType: string;

  constructor(mimeType: string) {
    super(`Formato de fichero no permitido: ${mimeType}`);
    this.name = 'FormatoNoPermitidoError';
    this.mimeType = mimeType;
  }
}

/** El fichero del comprobante supera los 10 MB → 422. */
export class TamanoExcedidoError extends Error {
  readonly codigo = 'TAMANO_EXCEDIDO' as const;
  readonly tamanoBytes: number;

  constructor(tamanoBytes: number) {
    super('El fichero del comprobante de la fianza supera el tamaño máximo de 10 MB');
    this.name = 'TamanoExcedidoError';
    this.tamanoBytes = tamanoBytes;
  }
}

// ---------------------------------------------------------------------------
// Constantes y helpers puros
// ---------------------------------------------------------------------------

/** Tamaño máximo del comprobante: 10 MB (inclusive). */
const TAMANO_MAXIMO_BYTES = 10 * 1024 * 1024;

/** Formatos permitidos del comprobante (validación autoritativa en servidor). */
const MIMES_PERMITIDOS: ReadonlyArray<string> = [
  'image/jpeg',
  'image/png',
  'application/pdf',
];

// ---------------------------------------------------------------------------
// Caso de uso
// ---------------------------------------------------------------------------

export class SubirComprobanteFianzaUseCase {
  constructor(private readonly deps: SubirComprobanteFianzaDeps) {}

  async ejecutar(
    comando: SubirComprobanteFianzaComando,
  ): Promise<SubirComprobanteFianzaResultado> {
    // (0) Guardas SÍNCRONAS previas a la tx. Orden: existencia (404) → estado válido (422) →
    //     fichero presente/formato/tamaño (422).
    const reserva = await this.deps.cargarReserva({
      tenantId: comando.tenantId,
      reservaId: comando.reservaId,
    });
    if (reserva === null || reserva === undefined) {
      throw new ReservaNoEncontradaError(comando.reservaId);
    }
    if (!esEstadoValidoParaComprobanteFianza(reserva.estado)) {
      throw new EstadoInvalidoError();
    }
    const comprobante = this.validarComprobantePresente(comando.comprobante);
    this.validarFormatoYTamano(comprobante);

    // (1) Subida física del comprobante (fuera de la tx crítica).
    const url = await this.deps.almacenarComprobante({
      tenantId: comando.tenantId,
      reservaId: comando.reservaId,
      comprobante,
    });

    const ahora = this.deps.clock.ahora();
    const statusAnterior = reserva.fianzaStatus;

    // (2) Transacción única (all-or-nothing). Cualquier rechazo propaga (rollback).
    const documento = (await this.deps.unidadDeTrabajo.ejecutar(
      comando.tenantId,
      async (repos): Promise<DocumentoComprobanteCreado> => {
        const doc = await repos.documentos.crear({
          tipo: 'comprobante_fianza',
          reservaId: comando.reservaId,
          tenantId: comando.tenantId,
          url,
          mimeType: comprobante.mimeType,
          nombreArchivo: comprobante.nombreArchivo,
          tamanoBytes: comprobante.tamanoBytes,
        });

        await repos.reservas.marcarComprobante({
          idReserva: comando.reservaId,
          fianzaStatus: 'cobrada',
          fianzaCobradaFecha: ahora,
          fianzaComprobanteFecha: ahora,
        });

        await repos.auditoria.registrar({
          tenantId: comando.tenantId,
          usuarioId: comando.usuarioId,
          accion: 'actualizar',
          entidad: 'RESERVA',
          entidadId: comando.reservaId,
          datosAnteriores: { fianzaStatus: statusAnterior },
          datosNuevos: {
            fianzaStatus: 'cobrada',
            fianzaCobradaFecha: ahora,
            fianzaComprobanteFecha: ahora,
          },
        });

        return doc;
      },
    )) as DocumentoComprobanteCreado;

    return {
      reservaId: comando.reservaId,
      fianzaStatus: 'cobrada',
      fianzaCobradaFecha: ahora,
      fianzaComprobanteFecha: ahora,
      documento,
    };
  }

  /** Valida que se adjuntó el comprobante; lo devuelve tipado si está presente. */
  private validarComprobantePresente(
    comprobante: ComprobanteFianzaSubido | null,
  ): ComprobanteFianzaSubido {
    if (comprobante === null || comprobante === undefined) {
      throw new ComprobanteRequeridoError();
    }
    return comprobante;
  }

  /** Valida el formato (mime permitido) y el tamaño (≤ 10 MB) del comprobante. */
  private validarFormatoYTamano(comprobante: ComprobanteFianzaSubido): void {
    if (!MIMES_PERMITIDOS.includes(comprobante.mimeType)) {
      throw new FormatoNoPermitidoError(comprobante.mimeType);
    }
    if (comprobante.tamanoBytes > TAMANO_MAXIMO_BYTES) {
      throw new TamanoExcedidoError(comprobante.tamanoBytes);
    }
  }
}
