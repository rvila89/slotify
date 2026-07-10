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
}

/** Clave de búsqueda idempotente por reserva + código. */
export interface BuscarComunicacionParams {
  /** Tenant emisor (del trigger): se fija como contexto RLS en la búsqueda. */
  tenantId: string;
  reservaId: string;
  codigoEmail: CodigoEmail;
}

/** Parámetros de actualización del estado tras el resultado del envío. */
export interface ActualizarEstadoComunicacionParams {
  /** Tenant emisor (del trigger): se fija como contexto RLS en la actualización. */
  tenantId: string;
  idComunicacion: string;
  estado: EstadoComunicacion;
  fechaEnvio: Date | null;
}

/** Repositorio de la trazabilidad de comunicaciones. */
export interface ComunicacionRepositoryPort {
  /** Comunicación existente para `(reservaId, codigoEmail)` o `null` (idempotencia). */
  buscarPorReservaYCodigo(
    params: BuscarComunicacionParams,
  ): Promise<ComunicacionRegistrada | null>;
  /** Crea la fila; ante colisión del UNIQUE parcial lanza `ComunicacionDuplicadaError`. */
  crear(params: RegistrarComunicacionParams): Promise<ComunicacionRegistrada>;
  /** Actualiza estado + `fecha_envio` tras el resultado del proveedor. */
  actualizarEstado(
    params: ActualizarEstadoComunicacionParams,
  ): Promise<ComunicacionRegistrada>;
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
