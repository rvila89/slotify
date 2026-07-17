/**
 * Puerto de dominio del repositorio de DOCUMENTO (épico #6, US-023 / GAP 1 —
 * `condiciones-particulares-e3-us023`; GENERALIZADO en US-033 / GAP D-documento-repo).
 *
 * Interfaz PURA de dominio: sin `@nestjs`, sin Prisma (hook `no-infra-in-domain`). El puerto es
 * TX-BOUND: sus operaciones viven DENTRO de la unidad de trabajo (transacción + RLS) del envío
 * E3 (US-023) o de la subida de documentación del evento (US-033), de modo que la persistencia
 * del DOCUMENTO se consolida o revierte junto al resto de la transacción. La búsqueda/listado
 * filtra por `tenant_id` (RLS: no se ven documentos de otro tenant).
 *
 * Generalización US-033 (design.md §D-documento-repo, RELAJACIÓN de tipos + método aditivo,
 * compatible hacia atrás): `tipo` pasa del literal `'condiciones_particulares'` a un UNION de
 * dominio `TipoDocumentoDominio` (alineado con el enum `TipoDocumento` de Prisma pero SIN
 * importar Prisma en el puerto); se AÑADE `listarPorReservaYTipos` para derivar el checklist de
 * la documentación del evento. US-023 sigue pasando `'condiciones_particulares'` (subconjunto
 * válido) y usando `buscarPorReservaYTipo` para su idempotencia: no rompe.
 *
 * Idempotencia (US-023 §Reglas de validación / design.md §D-persistencia-documento): la
 * idempotencia (solo un DOCUMENTO de condiciones por reserva) es una decisión del USE-CASE
 * (buscar-antes-de-crear), NO del puerto ni de la tabla; US-033 llama a `crear` directamente
 * (§D-no-idempotencia).
 */

/**
 * Tipos de DOCUMENTO de dominio soportados por el repositorio (union alineado con el enum
 * `TipoDocumento` de Prisma, pero declarado en dominio sin importar Prisma). US-023 usa
 * `'condiciones_particulares'`; US-033 usa los tres tipos obligatorios del evento.
 */
export type TipoDocumentoDominio =
  | 'condiciones_particulares'
  | 'dni_anverso'
  | 'dni_reverso'
  | 'clausula_responsabilidad';

/** Proyección mínima del DOCUMENTO persistido. */
export interface DocumentoPersistido {
  idDocumento: string;
  tipo: TipoDocumentoDominio;
  reservaId: string;
  tenantId: string;
  url: string;
  mimeType: string;
  /** Nombre original del fichero (US-033: referencia del checklist). Opcional para US-023. */
  nombreArchivo?: string;
  /** Tamaño en bytes (US-033: siempre > 0). Opcional para US-023. */
  tamanoBytes?: number;
  /** Instante de creación de la fila (US-033: ordena el "más reciente" del checklist). */
  fechaCreacion?: Date;
}

/** Repositorio TX-BOUND de DOCUMENTO. Idempotencia por reserva + tipo (decisión del use-case). */
export interface DocumentoRepositoryPort {
  /** Busca el DOCUMENTO de la reserva por tipo (idempotencia US-023). RLS por `tenant_id`. */
  buscarPorReservaYTipo(params: {
    reservaId: string;
    tenantId: string;
    tipo: TipoDocumentoDominio;
  }): Promise<DocumentoPersistido | null>;

  /** Crea la fila DOCUMENTO dentro de la unidad de trabajo. */
  crear(params: {
    reservaId: string;
    tenantId: string;
    tipo: TipoDocumentoDominio;
    url: string;
    mimeType: string;
    nombreArchivo?: string;
    tamanoBytes?: number;
  }): Promise<DocumentoPersistido>;

  /**
   * Lista los DOCUMENTOs de una reserva restringidos a `tipos` (US-033: checklist de la
   * documentación del evento). RLS por `tenant_id`. El orden lo decide el consumidor (la
   * query elige el más reciente por `fechaCreacion`).
   *
   * OPCIONAL en el contrato del puerto: solo US-033 lo consume; los consumidores previos
   * (US-023 idempotencia, factura de señal) siguen implementando solo
   * `buscarPorReservaYTipo`/`crear` sin obligación de proveerlo (generalización ADITIVA
   * compatible hacia atrás, design.md §D-documento-repo). El adaptador Prisma sí lo
   * implementa (lo requiere el checklist).
   */
  listarPorReservaYTipos?(params: {
    reservaId: string;
    tenantId: string;
    tipos: ReadonlyArray<TipoDocumentoDominio>;
  }): Promise<DocumentoPersistido[]>;
}
