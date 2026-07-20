/**
 * Puerto de DOMINIO `ComunicacionRepositoryPort` del motor de email (US-045 / UC-35,
 * design.md §4–§5).
 *
 * Interfaz PURA (sin `@nestjs/*`, Prisma ni infraestructura): describe la
 * persistencia de la trazabilidad en `COMUNICACION` (buscar idempotente, crear,
 * actualizar estado). La implementación Prisma (con el índice UNIQUE parcial real
 * `(reserva_id, codigo_email) WHERE reserva_id IS NOT NULL`) vive en infraestructura
 * y traduce la violación del índice a `ComunicacionDuplicadaError`, que el motor
 * trata como "ya existe" sin error de usuario (red de seguridad ante carreras).
 */
import type { CodigoEmail, EstadoComunicacion } from './codigo-email';
import type { SubtipoEmail } from './subtipo-email';

/** Proyección de una `COMUNICACION` registrada (lo que el motor necesita). */
export interface ComunicacionRegistrada {
  idComunicacion: string;
  tenantId: string;
  reservaId: string | null;
  clienteId: string;
  codigoEmail: CodigoEmail;
  estado: EstadoComunicacion;
  destinatarioEmail: string;
  fechaEnvio: Date | null;
  /** Fecha real de creación de la fila (US-046: respuestas de mutación fieles). */
  fechaCreacion: Date;
  /** Marca de reenvío (US-028 D-4); los `manual` de US-046 son `false` (D-5). */
  esReenvio: boolean;
}

/** Parámetros de creación de una `COMUNICACION`. */
export interface RegistrarComunicacionParams {
  tenantId: string;
  reservaId: string | null;
  clienteId: string;
  codigoEmail: CodigoEmail;
  asunto: string;
  cuerpo: string;
  destinatarioEmail: string;
  estado: EstadoComunicacion;
  fechaEnvio: Date | null;
  /**
   * Marca de REENVÍO manual del Gestor (US-028 D-4 / US-035 D-3A). Cuando es `true`, la
   * fila queda FUERA del índice UNIQUE parcial `(reserva_id, codigo_email) WHERE
   * es_reenvio = false`, permitiendo múltiples COMUNICACION del mismo código para la
   * misma reserva (excepción auditada a la idempotencia). Ausente/`false` = disparo
   * automático normal, protegido por el índice. Default en persistencia: `false`.
   */
  esReenvio?: boolean;
  /**
   * Subtipo semántico del E1 (change `historial-completo-comunicaciones`, §D-subtipo).
   * Participa en la TERNA `(reserva_id, codigo_email, subtipo)` del índice UNIQUE parcial.
   * `null`/ausente para E2–E8, `manual` y filas legadas.
   */
  subtipo?: SubtipoEmail | null;
}

/**
 * Clave de búsqueda idempotente clavada sobre la TERNA `(reserva, codigo, subtipo)`
 * (change `historial-completo-comunicaciones`, §D-autosend). El chequeo previo del motor
 * solo cortocircuita ante un envío CONSUMADO (`estado = 'enviado'`) de la MISMA terna;
 * subtipos distintos y borradores no frenan un nuevo auto-envío.
 */
export interface BuscarComunicacionParams {
  /** Tenant emisor (del trigger): se fija como contexto RLS en la búsqueda. */
  tenantId: string;
  reservaId: string;
  codigoEmail: CodigoEmail;
  /** Subtipo de la terna (`null`/ausente para E2–E8). */
  subtipo?: SubtipoEmail | null;
  /**
   * Estado a exigir en la fila buscada. El motor lo fija a `'enviado'` (§D-autosend):
   * solo un envío consumado de la terna se trata como idempotente.
   */
  estado?: EstadoComunicacion;
}

/** Parámetros de actualización del estado tras el resultado del envío. */
export interface ActualizarEstadoComunicacionParams {
  /** Tenant emisor (del trigger): se fija como contexto RLS en la actualización. */
  tenantId: string;
  idComunicacion: string;
  estado: EstadoComunicacion;
  fechaEnvio: Date | null;
}

/**
 * Parámetros del UPDATE del CONTENIDO (asunto + cuerpo) de una fila en `borrador`
 * (fix-borrador-e1-cuerpo-prerelleno). Rellena el borrador E1 creado con comentarios en
 * el alta con el texto renderizado, sin cambiar `estado` ni `fecha_envio`.
 */
export interface ActualizarContenidoBorradorParams {
  /** Tenant emisor (del JWT): se fija como contexto RLS en la actualización. */
  tenantId: string;
  idComunicacion: string;
  asunto: string;
  cuerpo: string;
}

/**
 * Parámetros del listado de comunicaciones de una RESERVA para la ficha (US-046 D-3).
 * Scoped por el `tenant_id` del JWT (RLS); nunca cross-tenant.
 */
export interface ListarPorReservaParams {
  /** Tenant del JWT: se fija como contexto RLS en la lectura. */
  tenantId: string;
  /** RESERVA cuya sección "Comunicaciones" se consulta. */
  reservaId: string;
}

/**
 * Proyección de LISTADO enriquecida de una `COMUNICACION` para la ficha de la RESERVA
 * (US-046 D-3). Añade a la proyección del motor los campos que la ficha necesita
 * (`asunto`, `codigoEmail`, `fechaCreacion`, `esReenvio`) y el flag derivado
 * `accionable` (`true` sii `estado === 'borrador'`: la fila puede enviarse/descartarse;
 * `enviado`/`fallido` son de solo lectura).
 */
export interface ComunicacionListItem {
  idComunicacion: string;
  clienteId: string;
  codigoEmail: CodigoEmail;
  estado: EstadoComunicacion;
  asunto: string;
  /** Cuerpo real de la fila (lo precarga el diálogo de revisión del frontend). */
  cuerpo: string | null;
  destinatarioEmail: string;
  /**
   * Subtipo semántico del E1 (change `historial-completo-comunicaciones`, §D-subtipo):
   * `null` para E2–E8, `manual` y filas legadas. El frontend renderiza su etiqueta humana.
   */
  subtipo: SubtipoEmail | null;
  fechaCreacion: Date;
  fechaEnvio: Date | null;
  esReenvio: boolean;
  /** Derivado: `true` sii `estado === 'borrador'` (accionable). */
  accionable: boolean;
}

/** Repositorio de la trazabilidad de comunicaciones. */
export interface ComunicacionRepositoryPort {
  /**
   * Comunicación existente para la TERNA `(reservaId, codigoEmail, subtipo)` filtrando
   * por `estado` cuando se aporta, o `null` (idempotencia §D-autosend). El motor lo llama
   * con `estado: 'enviado'` para tratar como idempotente SOLO un envío consumado de la
   * misma terna (subtipos distintos coexisten).
   */
  buscarPorReservaYCodigo(
    params: BuscarComunicacionParams,
  ): Promise<ComunicacionRegistrada | null>;
  /** Crea la fila; ante colisión del UNIQUE parcial lanza `ComunicacionDuplicadaError`. */
  crear(params: RegistrarComunicacionParams): Promise<ComunicacionRegistrada>;
  /** Actualiza estado + `fecha_envio` tras el resultado del proveedor. */
  actualizarEstado(
    params: ActualizarEstadoComunicacionParams,
  ): Promise<ComunicacionRegistrada>;
  /**
   * Actualiza SOLO `asunto` + `cuerpo` de una fila en `estado = 'borrador'`
   * (fix-borrador-e1-cuerpo-prerelleno). Guarda de estado: no afecta a filas
   * `enviado`/`fallido`. No cambia `estado` ni `fecha_envio`.
   */
  actualizarContenidoBorrador(
    params: ActualizarContenidoBorradorParams,
  ): Promise<ComunicacionRegistrada>;
  /**
   * Lista TODAS las `COMUNICACION` de una RESERVA (sección "Comunicaciones" de la ficha,
   * US-046 D-3), scoped por el `tenant_id` del JWT (RLS), con la proyección de listado
   * enriquecida `ComunicacionListItem` (ordenadas por `fechaCreacion` descendente).
   */
  listarPorReserva(
    params: ListarPorReservaParams,
  ): Promise<ComunicacionListItem[]>;
}

/**
 * Error de DOMINIO: colisión del índice UNIQUE parcial `(reserva_id, codigo_email)`.
 * Lo lanza el adaptador Prisma al traducir la violación del índice (P2002) para que
 * el motor trate la carrera como "ya existe" sin reenviar ni propagar error al
 * usuario.
 */
export class ComunicacionDuplicadaError extends Error {
  readonly reservaId: string | null;
  readonly codigoEmail: CodigoEmail;

  constructor(reservaId: string | null, codigoEmail: CodigoEmail) {
    super(
      `Ya existe una COMUNICACION para la reserva ${String(reservaId)} y el código ${codigoEmail}`,
    );
    this.name = 'ComunicacionDuplicadaError';
    this.reservaId = reservaId;
    this.codigoEmail = codigoEmail;
  }
}
