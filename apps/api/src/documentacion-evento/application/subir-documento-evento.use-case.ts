/**
 * Caso de uso de APLICACIÓN: capturar (subir) un DOCUMENTO obligatorio de la
 * documentación del evento (UC-24 / US-033).
 *
 * El Gestor sube un fichero (`dni_anverso` | `dni_reverso` | `clausula_responsabilidad`)
 * sobre una RESERVA en `evento_en_curso`. La subida CREA una fila DOCUMENTO pero NO
 * transiciona la máquina de estados (§D-no-transicion): `RESERVA.estado` permanece
 * intacto. Es NO idempotente (§D-no-idempotencia): cada subida crea una fila nueva
 * (histórico conservado); NO se busca-antes-de-crear (a diferencia de US-023).
 *
 * Orquestación (orden estricto, rechazo SIN efectos ante cualquier guarda):
 *   (0) Guardas SÍNCRONAS previas a la tx. Orden: existencia (404) → tipo permitido
 *       (422) → estado válido `evento_en_curso` (422) → fichero presente (422) →
 *       formato (422) → vacío/corrupto `tamanoBytes = 0` (422) → tamaño ≤ 10 MB (422).
 *   (1) Sube físicamente el binario al almacén durable (fuera de la tx crítica). Si el
 *       almacén falla, NO se crea DOCUMENTO ni se audita (el error propaga).
 *   (2) En UNA unidad de trabajo (tx + RLS), all-or-nothing:
 *         a. Crea la fila DOCUMENTO (NO idempotente: solo `crear`).
 *         b. AUDIT_LOG `accion='crear'`, `entidad='DOCUMENTO'` con `datosNuevos`.
 *         c. Lista los DOCUMENTOs del evento para derivar el checklist devuelto.
 *
 * Hexagonal (hook `no-infra-in-domain`): depende SOLO de puertos inyectados; no importa
 * Prisma ni `@nestjs/*`.
 */
import { esEstadoQuePermiteDocumentacionEvento } from '../../reservas/domain/maquina-estados';
import type { EstadoReserva } from '../../reservas/domain/maquina-estados';

// ---------------------------------------------------------------------------
// Tipos de comando / proyecciones / puertos
// ---------------------------------------------------------------------------

/** Tipos de DOCUMENTO obligatorios de la documentación del evento (US-033). */
export type TipoDocumentacionEvento =
  | 'dni_anverso'
  | 'dni_reverso'
  | 'clausula_responsabilidad';

/** Los tres tipos obligatorios, en orden canónico (checklist + validación de tipo). */
export const TIPOS_DOCUMENTACION_EVENTO: ReadonlyArray<TipoDocumentacionEvento> = [
  'dni_anverso',
  'dni_reverso',
  'clausula_responsabilidad',
];

/** Fichero subido por el Gestor (multipart) mapeado a VO de dominio. */
export interface ArchivoDocumentoEventoSubido {
  nombreArchivo: string;
  mimeType: string;
  tamanoBytes: number;
  buffer: Buffer;
}

/** Comando de subida de un documento del evento. El `tipo` puede llegar fuera del enum. */
export interface SubirDocumentoEventoComando {
  /** Tenant del gestor (del JWT, nunca del body/path). */
  tenantId: string;
  /** Identificador del gestor que ejecuta la operación (para auditoría). */
  usuarioId: string;
  /** RESERVA sobre la que se sube el documento (debe existir y estar en evento_en_curso). */
  reservaId: string;
  /** Tipo del documento; se valida contra los tres tipos obligatorios. */
  tipo: TipoDocumentacionEvento;
  /** Fichero; `null` si no se adjuntó (→ ARCHIVO_REQUERIDO). */
  archivo: ArchivoDocumentoEventoSubido | null;
}

/** Proyección de la RESERVA relevante para la subida: estado (guarda) + tenant. */
export interface ReservaDocumentacionEvento {
  idReserva: string;
  tenantId: string;
  estado: EstadoReserva;
}

/**
 * DOCUMENTO del evento persistido (proyección de vuelta). `reservaId`/`tenantId` son
 * opcionales en la proyección de referencia del checklist (la fila ya está acotada a la
 * reserva y el tenant); el DOCUMENTO devuelto por `crear` sí los rellena.
 */
export interface DocumentoEventoPersistido {
  idDocumento: string;
  tipo: TipoDocumentacionEvento;
  reservaId?: string;
  tenantId?: string;
  url: string;
  mimeType: string;
  nombreArchivo: string;
  tamanoBytes: number;
  fechaCreacion: Date;
}

/** Ítem del checklist derivado: un tipo obligatorio + si está completado + referencia. */
export interface ChecklistItemDocumentacionEvento {
  tipo: TipoDocumentacionEvento;
  completado: boolean;
  documento?: DocumentoEventoPersistido;
}

/** Checklist derivado por lectura (siempre los tres ítems, en orden canónico). */
export interface ChecklistDocumentacionEvento {
  items: ChecklistItemDocumentacionEvento[];
}

/** Datos para crear la fila DOCUMENTO del evento. */
export interface CrearDocumentoEventoParams {
  tipo: TipoDocumentacionEvento;
  reservaId: string;
  tenantId: string;
  url: string;
  mimeType: string;
  nombreArchivo: string;
  tamanoBytes: number;
}

/** Registro de auditoría de la subida (`crear`, NUNCA `transicion`). */
export interface RegistroAuditoriaDocumentacionEvento {
  tenantId: string;
  usuarioId?: string | null;
  accion: 'crear';
  entidad: 'DOCUMENTO';
  entidadId: string;
  datosNuevos: {
    tipo: TipoDocumentacionEvento;
    reservaId: string;
    url: string;
    mimeType: string;
    tamanoBytes: number;
  };
}

/**
 * Repositorios tx-bound disponibles dentro de la unidad de trabajo de la subida.
 * `documentos` reutiliza el puerto generalizado de US-023 llamando SOLO a `crear` (no
 * idempotente) y a `listarPorReservaYTipos` (checklist).
 */
export interface RepositoriosDocumentacionEvento {
  documentos: {
    crear(params: CrearDocumentoEventoParams): Promise<DocumentoEventoPersistido>;
    listarPorReservaYTipos(params: {
      reservaId: string;
      tenantId: string;
      tipos: ReadonlyArray<TipoDocumentacionEvento>;
    }): Promise<DocumentoEventoPersistido[]>;
  };
  auditoria: {
    registrar(registro: RegistroAuditoriaDocumentacionEvento): Promise<void>;
  };
}

/**
 * Unidad de trabajo transaccional. El adaptador envuelve `$transaction` +
 * `fijarTenant(tenantId)` (RLS) y expone los repositorios tx-bound. Si el `trabajo`
 * rechaza, la transacción revierte por completo (all-or-nothing).
 */
export interface UnidadDeTrabajoDocumentacionEventoPort {
  ejecutar(
    tenantId: string,
    trabajo: (repos: RepositoriosDocumentacionEvento) => Promise<unknown>,
  ): Promise<unknown>;
}

/** Lectura de la RESERVA (fuera de la tx crítica; RLS: cross-tenant → null). */
export interface CargarReservaDocumentacionEventoPort {
  (params: {
    tenantId: string;
    reservaId: string;
  }): Promise<ReservaDocumentacionEvento | null | undefined>;
}

/** Almacenamiento físico del binario; devuelve la `url` persistible. */
export interface AlmacenarDocumentoEventoPort {
  (params: {
    tenantId: string;
    reservaId: string;
    tipo: TipoDocumentacionEvento;
    archivo: ArchivoDocumentoEventoSubido;
  }): Promise<string>;
}

/** Dependencias del caso de uso (puertos inyectados). */
export interface SubirDocumentoEventoDeps {
  unidadDeTrabajo: UnidadDeTrabajoDocumentacionEventoPort;
  cargarReserva: CargarReservaDocumentacionEventoPort;
  almacenarDocumento: AlmacenarDocumentoEventoPort;
}

/** Resultado de la subida (para la respuesta HTTP 201): DOCUMENTO + checklist actualizado. */
export interface SubirDocumentoEventoResultado {
  documento: DocumentoEventoPersistido;
  checklist: ChecklistDocumentacionEvento;
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

/** El estado de la RESERVA no permite capturar la documentación (no `evento_en_curso`). 422. */
export class EstadoNoPermiteDocumentacionError extends Error {
  readonly codigo = 'ESTADO_NO_PERMITE_DOCUMENTACION' as const;

  constructor() {
    super(
      'La documentación del evento solo puede capturarse mientras el evento está en curso',
    );
    this.name = 'EstadoNoPermiteDocumentacionError';
  }
}

/** El `tipo` recibido no es uno de los tres tipos obligatorios del evento. 422. */
export class TipoDocumentoNoPermitidoError extends Error {
  readonly codigo = 'TIPO_DOCUMENTO_NO_PERMITIDO' as const;
  readonly tipo: string;

  constructor(tipo: string) {
    super(`Tipo de documento no permitido: ${tipo}`);
    this.name = 'TipoDocumentoNoPermitidoError';
    this.tipo = tipo;
  }
}

/** No se adjuntó el fichero. 422. */
export class ArchivoRequeridoError extends Error {
  readonly codigo = 'ARCHIVO_REQUERIDO' as const;

  constructor() {
    super('Es obligatorio adjuntar un archivo');
    this.name = 'ArchivoRequeridoError';
  }
}

/** El `mimeType` del fichero no está permitido (no jpeg/png/pdf). 422. */
export class FormatoNoPermitidoError extends Error {
  readonly codigo = 'FORMATO_NO_PERMITIDO' as const;
  readonly mimeType: string;

  constructor(mimeType: string) {
    super('Formato no admitido. Por favor, usa JPEG, PNG o PDF.');
    this.name = 'FormatoNoPermitidoError';
    this.mimeType = mimeType;
  }
}

/** El fichero está vacío o corrupto (`tamanoBytes = 0`). 422. */
export class ArchivoInvalidoError extends Error {
  readonly codigo = 'ARCHIVO_INVALIDO' as const;

  constructor() {
    super(
      'El archivo no pudo procesarse. Por favor, inténtalo de nuevo con un archivo válido.',
    );
    this.name = 'ArchivoInvalidoError';
  }
}

/** El fichero supera los 10 MB. 422. */
export class TamanoExcedidoError extends Error {
  readonly codigo = 'TAMANO_EXCEDIDO' as const;
  readonly tamanoBytes: number;

  constructor(tamanoBytes: number) {
    super('El archivo supera el tamaño máximo de 10 MB');
    this.name = 'TamanoExcedidoError';
    this.tamanoBytes = tamanoBytes;
  }
}

// ---------------------------------------------------------------------------
// Constantes y helpers puros
// ---------------------------------------------------------------------------

/** Tamaño máximo del fichero: 10 MB (inclusive). */
const TAMANO_MAXIMO_BYTES = 10 * 1024 * 1024;

/** Formatos permitidos (validación autoritativa en servidor). */
const MIMES_PERMITIDOS: ReadonlyArray<string> = [
  'image/jpeg',
  'image/png',
  'application/pdf',
];

/** ¿El `tipo` recibido es uno de los tres tipos obligatorios del evento? */
const esTipoDocumentacionEvento = (tipo: string): tipo is TipoDocumentacionEvento =>
  (TIPOS_DOCUMENTACION_EVENTO as ReadonlyArray<string>).includes(tipo);

/**
 * Deriva el checklist por existencia ≥ 1 por tipo; el `documento` de referencia es el más
 * reciente por `fechaCreacion`. Siempre devuelve los tres ítems en orden canónico. Función
 * pura reutilizada por el use-case (respuesta de subida) y la query de checklist.
 */
export const derivarChecklistDocumentacionEvento = (
  documentos: ReadonlyArray<DocumentoEventoPersistido>,
): ChecklistDocumentacionEvento => ({
  items: TIPOS_DOCUMENTACION_EVENTO.map((tipo) => {
    const delTipo = documentos.filter((d) => d.tipo === tipo);
    if (delTipo.length === 0) {
      return { tipo, completado: false };
    }
    const masReciente = delTipo.reduce((a, b) =>
      b.fechaCreacion.getTime() > a.fechaCreacion.getTime() ? b : a,
    );
    return { tipo, completado: true, documento: masReciente };
  }),
});

// ---------------------------------------------------------------------------
// Caso de uso
// ---------------------------------------------------------------------------

export class SubirDocumentoEventoUseCase {
  constructor(private readonly deps: SubirDocumentoEventoDeps) {}

  /**
   * Sube un documento del evento: valida guardas (estado + tipo + fichero) SIN efectos,
   * sube el binario al almacén, y crea la fila DOCUMENTO + AUDIT_LOG `crear` en UNA
   * transacción, devolviendo el DOCUMENTO y el checklist actualizado.
   */
  async ejecutar(
    comando: SubirDocumentoEventoComando,
  ): Promise<SubirDocumentoEventoResultado> {
    // (0) Guardas SÍNCRONAS previas a la tx (rechazo SIN efectos).
    const reserva = await this.deps.cargarReserva({
      tenantId: comando.tenantId,
      reservaId: comando.reservaId,
    });
    if (reserva === null || reserva === undefined) {
      throw new ReservaNoEncontradaError(comando.reservaId);
    }
    if (!esTipoDocumentacionEvento(comando.tipo)) {
      throw new TipoDocumentoNoPermitidoError(comando.tipo);
    }
    if (!esEstadoQuePermiteDocumentacionEvento(reserva.estado)) {
      throw new EstadoNoPermiteDocumentacionError();
    }
    const archivo = this.validarArchivo(comando.archivo);

    // (1) Subida física del binario (fuera de la tx crítica). Si falla, propaga sin crear.
    const url = await this.deps.almacenarDocumento({
      tenantId: comando.tenantId,
      reservaId: comando.reservaId,
      tipo: comando.tipo,
      archivo,
    });

    // (2) Transacción única (all-or-nothing). Cualquier rechazo propaga (rollback).
    return (await this.deps.unidadDeTrabajo.ejecutar(
      comando.tenantId,
      async (repos): Promise<SubirDocumentoEventoResultado> => {
        // (a) DOCUMENTO NUEVO (NO idempotente: solo `crear`, sin buscar-antes).
        const documento = await repos.documentos.crear({
          tipo: comando.tipo,
          reservaId: comando.reservaId,
          tenantId: comando.tenantId,
          url,
          mimeType: archivo.mimeType,
          nombreArchivo: archivo.nombreArchivo,
          tamanoBytes: archivo.tamanoBytes,
        });

        // (b) AUDIT_LOG: crear (NUNCA transicion).
        await repos.auditoria.registrar({
          tenantId: comando.tenantId,
          usuarioId: comando.usuarioId,
          accion: 'crear',
          entidad: 'DOCUMENTO',
          entidadId: comando.reservaId,
          datosNuevos: {
            tipo: comando.tipo,
            reservaId: comando.reservaId,
            url,
            mimeType: archivo.mimeType,
            tamanoBytes: archivo.tamanoBytes,
          },
        });

        // (c) Checklist derivado por lectura (incluye el documento recién creado).
        const documentos = await repos.documentos.listarPorReservaYTipos({
          reservaId: comando.reservaId,
          tenantId: comando.tenantId,
          tipos: TIPOS_DOCUMENTACION_EVENTO,
        });
        const checklist = derivarChecklistDocumentacionEvento(
          this.incluir(documentos, documento),
        );

        return { documento, checklist };
      },
    )) as SubirDocumentoEventoResultado;
  }

  // -------------------------------------------------------------------------
  // Pasos privados
  // -------------------------------------------------------------------------

  /** Valida presencia, formato, vacío/corrupto y tamaño del fichero (autoritativo). */
  private validarArchivo(
    archivo: ArchivoDocumentoEventoSubido | null,
  ): ArchivoDocumentoEventoSubido {
    if (archivo === null || archivo === undefined) {
      throw new ArchivoRequeridoError();
    }
    if (!MIMES_PERMITIDOS.includes(archivo.mimeType)) {
      throw new FormatoNoPermitidoError(archivo.mimeType);
    }
    if (archivo.tamanoBytes <= 0) {
      throw new ArchivoInvalidoError();
    }
    if (archivo.tamanoBytes > TAMANO_MAXIMO_BYTES) {
      throw new TamanoExcedidoError(archivo.tamanoBytes);
    }
    return archivo;
  }

  /**
   * Garantiza que el DOCUMENTO recién creado se refleje en el checklist aunque el listado
   * tx-bound aún no lo devuelva (dobles in-memory que listan `existentes` fijos): lo une
   * sin duplicar por `idDocumento`.
   */
  private incluir(
    documentos: ReadonlyArray<DocumentoEventoPersistido>,
    creado: DocumentoEventoPersistido,
  ): DocumentoEventoPersistido[] {
    if (documentos.some((d) => d.idDocumento === creado.idDocumento)) {
      return [...documentos];
    }
    return [...documentos, creado];
  }
}
