/**
 * Caso de uso de APLICACIÓN: registrar la FIRMA de las condiciones particulares
 * (UC-19 segundo flujo / US-024).
 *
 * El Gestor sube la COPIA FIRMADA de las condiciones particulares sobre una RESERVA a
 * la que ya se enviaron las condiciones por E3 (US-023, `cond_part_enviadas_fecha` no
 * nulo) y en un estado válido. La firma NO es una transición de la máquina de estados
 * (§D-no-transicion): solo ACTUALIZA `cond_part_firmadas`/`cond_part_firmadas_fecha`.
 *
 * Orquestación:
 *   (0) Guardas SÍNCRONAS previas a la tx (rechazo SIN efectos). Orden: existencia
 *       (404) → E3 enviado / `cond_part_enviadas_fecha` no nulo (409) → estado válido
 *       (422) → fichero presente / formato / tamaño (422). Se validan ANTES de subir el
 *       fichero y de abrir la transacción.
 *   (1) Sube físicamente la copia firmada al almacenamiento (fuera de la tx crítica; un
 *       rollback deja como mucho un fichero huérfano, nunca una fila DOCUMENTO sin
 *       RESERVA marcada).
 *   (2) En UNA unidad de trabajo (tx + RLS), all-or-nothing:
 *         a. Crea una fila DOCUMENTO NUEVA `tipo='condiciones_particulares'` (NO
 *            idempotente, §D-re-firma / §D-documento-repo: solo `crear`, sin buscar; el
 *            DOCUMENTO original no firmado permanece).
 *         b. Marca la RESERVA `cond_part_firmadas=true` + `cond_part_firmadas_fecha =
 *            clock.ahora()`. NO toca `estado` ni los sub-procesos.
 *         c. AUDIT_LOG `accion='actualizar'` (NUNCA `'transicion'`), `entidad='RESERVA'`,
 *            con `datos_anteriores.cond_part_firmadas` (su valor real) y
 *            `datos_nuevos.cond_part_firmadas=true` + `cond_part_firmadas_fecha`.
 *
 * Re-firma (§D-re-firma): con `cond_part_firmadas` ya `true` NO se rechaza; crea otra
 * versión DOCUMENTO, actualiza la fecha, mantiene el flag `true` y conserva el histórico.
 *
 * Hexagonal (hook `no-infra-in-domain`): depende SOLO de puertos inyectados; no importa
 * Prisma ni `@nestjs/*`. La `cond_part_firmadas_fecha` de dominio se serializa al wire
 * como `condPartFechaFirma` en el read-DTO (fuera de este use-case).
 */
import { esEstadoValidoParaRegistrarFirmaCondiciones } from '../../reservas/domain/maquina-estados';
import type { EstadoReserva } from '../../reservas/domain/maquina-estados';

// ---------------------------------------------------------------------------
// Tipos de comando / proyecciones / puertos
// ---------------------------------------------------------------------------

/** Copia firmada de las condiciones subida por el Gestor (multipart). */
export interface CondicionesFirmadasSubidas {
  nombreArchivo: string;
  mimeType: string;
  tamanoBytes: number;
  buffer: Buffer;
}

/** Comando de registro de la firma de condiciones particulares. */
export interface RegistrarFirmaCondicionesComando {
  /** Tenant del gestor (del JWT, nunca del body/path). */
  tenantId: string;
  /** Identificador del gestor que ejecuta la operación (para auditoría). */
  usuarioId: string;
  /** RESERVA sobre la que se registra la firma (debe existir, con E3 enviado y estado válido). */
  reservaId: string;
  /** Copia firmada; `null` si no se adjuntó (→ CONDICIONES_REQUERIDAS). */
  condiciones: CondicionesFirmadasSubidas | null;
}

/**
 * Proyección de la RESERVA relevante para el registro de la firma: estado (guarda),
 * `cond_part_enviadas_fecha` (E3 enviado) y `cond_part_firmadas` (flag anterior para la
 * auditoría).
 */
export interface ReservaFirmaCondiciones {
  idReserva: string;
  tenantId: string;
  estado: EstadoReserva;
  condPartEnviadasFecha: Date | null;
  condPartFirmadas: boolean;
}

/** Reloj inyectable para determinismo. */
export interface ClockPort {
  ahora(): Date;
}

/** Datos para crear la fila DOCUMENTO de la copia firmada. */
export interface CrearDocumentoFirmadoParams {
  tipo: 'condiciones_particulares';
  reservaId: string;
  tenantId: string;
  url: string;
  mimeType: string;
  nombreArchivo: string;
  tamanoBytes?: number;
}

/** DOCUMENTO creado (proyección de vuelta). */
export interface DocumentoFirmadoCreado {
  idDocumento: string;
  tipo: string;
  reservaId?: string;
  tenantId?: string;
  url: string;
  mimeType: string;
}

/** Parámetros del marcado de la RESERVA (solo la firma; SIN estado ni sub-procesos). */
export interface MarcarFirmaCondicionesParams {
  idReserva: string;
  condPartFirmadas: true;
  condPartFirmadasFecha: Date;
}

/** Registro de auditoría del registro de la firma (`actualizar`, NUNCA `transicion`). */
export interface RegistroAuditoriaFirmaCondiciones {
  tenantId: string;
  usuarioId?: string | null;
  accion: 'actualizar';
  entidad: 'RESERVA';
  entidadId: string;
  datosAnteriores: { condPartFirmadas: boolean };
  datosNuevos: { condPartFirmadas: true; condPartFirmadasFecha: Date };
}

/**
 * Conjunto de repositorios tx-bound disponibles dentro de la unidad de trabajo del
 * registro de la firma. `documentos` reutiliza el puerto de US-023 llamando SOLO a
 * `crear` (no idempotente, §D-documento-repo).
 */
export interface RepositoriosFirmaCondiciones {
  documentos: {
    crear(params: CrearDocumentoFirmadoParams): Promise<DocumentoFirmadoCreado>;
  };
  reservas: {
    marcarFirmada(params: MarcarFirmaCondicionesParams): Promise<void>;
  };
  auditoria: {
    registrar(registro: RegistroAuditoriaFirmaCondiciones): Promise<void>;
  };
}

/**
 * Unidad de trabajo transaccional. El adaptador envuelve `$transaction` +
 * `fijarTenant(tenantId)` (RLS) y expone los repositorios tx-bound. Si el `trabajo`
 * rechaza, la transacción revierte por completo (all-or-nothing).
 */
export interface UnidadDeTrabajoFirmaCondicionesPort {
  ejecutar(
    tenantId: string,
    trabajo: (repos: RepositoriosFirmaCondiciones) => Promise<unknown>,
  ): Promise<unknown>;
}

/** Lectura de la RESERVA (fuera de la tx crítica; RLS: cross-tenant → null). */
export interface CargarReservaFirmaCondicionesPort {
  (params: {
    tenantId: string;
    reservaId: string;
  }): Promise<ReservaFirmaCondiciones | null | undefined>;
}

/** Almacenamiento físico de la copia firmada; devuelve la `url` persistible. */
export interface AlmacenarCondicionesFirmadasPort {
  (params: {
    tenantId: string;
    reservaId: string;
    condiciones: CondicionesFirmadasSubidas;
  }): Promise<string>;
}

/** Dependencias del caso de uso (puertos inyectados). */
export interface RegistrarFirmaCondicionesDeps {
  unidadDeTrabajo: UnidadDeTrabajoFirmaCondicionesPort;
  cargarReserva: CargarReservaFirmaCondicionesPort;
  almacenarCondiciones: AlmacenarCondicionesFirmadasPort;
  clock: ClockPort;
}

/** Resultado del registro de la firma (para la respuesta HTTP). */
export interface RegistrarFirmaCondicionesResultado {
  reservaId: string;
  condPartFirmadas: true;
  condPartFirmadasFecha: Date;
  documento: DocumentoFirmadoCreado;
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

/** Las condiciones aún NO se enviaron por E3 (`cond_part_enviadas_fecha` nulo). 409. */
export class CondicionesNoEnviadasError extends Error {
  readonly codigo = 'CONDICIONES_NO_ENVIADAS' as const;

  constructor(
    mensaje = 'Las condiciones particulares no han sido enviadas al cliente aún',
  ) {
    super(mensaje);
    this.name = 'CondicionesNoEnviadasError';
  }
}

/** El estado de la RESERVA no es válido para registrar la firma (terminal/otro). 422. */
export class EstadoInvalidoError extends Error {
  readonly codigo = 'ESTADO_INVALIDO' as const;

  constructor(
    mensaje = 'No se puede registrar la firma en una reserva en estado terminal',
  ) {
    super(mensaje);
    this.name = 'EstadoInvalidoError';
  }
}

/** No se adjuntó el fichero de las condiciones firmadas. 422. */
export class CondicionesRequeridasError extends Error {
  readonly codigo = 'CONDICIONES_REQUERIDAS' as const;

  constructor(mensaje = 'Es obligatorio adjuntar la copia firmada de las condiciones') {
    super(mensaje);
    this.name = 'CondicionesRequeridasError';
  }
}

/** El `mimeType` del fichero no está permitido (no jpeg/png/pdf). 422. */
export class FormatoNoPermitidoError extends Error {
  readonly codigo = 'FORMATO_NO_PERMITIDO' as const;
  readonly mimeType: string;

  constructor(mimeType: string) {
    super(`Formato de fichero no permitido: ${mimeType}`);
    this.name = 'FormatoNoPermitidoError';
    this.mimeType = mimeType;
  }
}

/** El fichero de las condiciones firmadas supera los 10 MB. 422. */
export class TamanoExcedidoError extends Error {
  readonly codigo = 'TAMANO_EXCEDIDO' as const;
  readonly tamanoBytes: number;

  constructor(tamanoBytes: number) {
    super('El fichero de las condiciones firmadas supera el tamaño máximo de 10 MB');
    this.name = 'TamanoExcedidoError';
    this.tamanoBytes = tamanoBytes;
  }
}

// ---------------------------------------------------------------------------
// Constantes y helpers puros
// ---------------------------------------------------------------------------

/** Tamaño máximo de la copia firmada: 10 MB (inclusive). */
const TAMANO_MAXIMO_BYTES = 10 * 1024 * 1024;

/** Formatos permitidos de la copia firmada (validación autoritativa en servidor). */
const MIMES_PERMITIDOS: ReadonlyArray<string> = [
  'image/jpeg',
  'image/png',
  'application/pdf',
];

// ---------------------------------------------------------------------------
// Caso de uso
// ---------------------------------------------------------------------------

export class RegistrarFirmaCondicionesUseCase {
  constructor(private readonly deps: RegistrarFirmaCondicionesDeps) {}

  /**
   * Registra la firma: crea la fila DOCUMENTO firmada, marca la RESERVA
   * (`cond_part_firmadas=true` + fecha) y audita (`actualizar`) — todo en UNA
   * transacción. Antes valida (sin efectos) existencia, E3 enviado, estado y fichero.
   */
  async ejecutar(
    comando: RegistrarFirmaCondicionesComando,
  ): Promise<RegistrarFirmaCondicionesResultado> {
    // (0) Guardas SÍNCRONAS previas a la tx (rechazo SIN efectos). Orden: existencia
    // (404) → E3 enviado (409) → estado válido (422) → fichero presente/formato/tamaño (422).
    const reserva = await this.deps.cargarReserva({
      tenantId: comando.tenantId,
      reservaId: comando.reservaId,
    });
    if (reserva === null || reserva === undefined) {
      throw new ReservaNoEncontradaError(comando.reservaId);
    }
    if (
      reserva.condPartEnviadasFecha === null ||
      reserva.condPartEnviadasFecha === undefined
    ) {
      throw new CondicionesNoEnviadasError();
    }
    if (!esEstadoValidoParaRegistrarFirmaCondiciones(reserva.estado)) {
      throw new EstadoInvalidoError();
    }
    const condiciones = this.validarCondicionesPresentes(comando.condiciones);
    this.validarFormatoYTamano(condiciones);

    // (1) Subida física del fichero firmado (fuera de la tx crítica).
    const url = await this.deps.almacenarCondiciones({
      tenantId: comando.tenantId,
      reservaId: comando.reservaId,
      condiciones,
    });

    const condPartFirmadasFecha = this.deps.clock.ahora();
    const flagAnterior = reserva.condPartFirmadas;

    // (2) Transacción única (all-or-nothing). Cualquier rechazo propaga (rollback).
    const documento = (await this.deps.unidadDeTrabajo.ejecutar(
      comando.tenantId,
      async (repos): Promise<DocumentoFirmadoCreado> => {
        // (a) DOCUMENTO condiciones_particulares (fila NUEVA; NO idempotente).
        const doc = await repos.documentos.crear({
          tipo: 'condiciones_particulares',
          reservaId: comando.reservaId,
          tenantId: comando.tenantId,
          url,
          mimeType: condiciones.mimeType,
          nombreArchivo: condiciones.nombreArchivo,
          tamanoBytes: condiciones.tamanoBytes,
        });

        // (b) Marca la RESERVA (solo la firma; SIN estado ni sub-procesos).
        await repos.reservas.marcarFirmada({
          idReserva: comando.reservaId,
          condPartFirmadas: true,
          condPartFirmadasFecha,
        });

        // (c) AUDIT_LOG: actualizar (NUNCA transicion).
        await repos.auditoria.registrar({
          tenantId: comando.tenantId,
          usuarioId: comando.usuarioId,
          accion: 'actualizar',
          entidad: 'RESERVA',
          entidadId: comando.reservaId,
          datosAnteriores: { condPartFirmadas: flagAnterior },
          datosNuevos: { condPartFirmadas: true, condPartFirmadasFecha },
        });

        return doc;
      },
    )) as DocumentoFirmadoCreado;

    return {
      reservaId: comando.reservaId,
      condPartFirmadas: true,
      condPartFirmadasFecha,
      documento,
    };
  }

  // -------------------------------------------------------------------------
  // Pasos privados
  // -------------------------------------------------------------------------

  /** Valida que se adjuntó la copia firmada; la devuelve tipada si está presente. */
  private validarCondicionesPresentes(
    condiciones: CondicionesFirmadasSubidas | null,
  ): CondicionesFirmadasSubidas {
    if (condiciones === null || condiciones === undefined) {
      throw new CondicionesRequeridasError();
    }
    return condiciones;
  }

  /** Valida el formato (mime permitido) y el tamaño (≤ 10 MB) de la copia firmada. */
  private validarFormatoYTamano(condiciones: CondicionesFirmadasSubidas): void {
    if (!MIMES_PERMITIDOS.includes(condiciones.mimeType)) {
      throw new FormatoNoPermitidoError(condiciones.mimeType);
    }
    if (condiciones.tamanoBytes > TAMANO_MAXIMO_BYTES) {
      throw new TamanoExcedidoError(condiciones.tamanoBytes);
    }
  }
}
