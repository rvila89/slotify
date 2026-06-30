/**
 * Alias de tipos del dominio de reservas sobre el cliente generado del contrato
 * OpenAPI (`@/api-client`). Centralizar aquí evita repetir
 * `components['schemas'][...]` por todo el dominio y da un único punto de import
 * para páginas, hooks y componentes. No se inventan tipos de API: todos derivan
 * del SDK generado (única fuente de verdad).
 */
import type { components } from '@/api-client';

export type Reserva = components['schemas']['Reserva'];
export type ReservaDetalle = components['schemas']['ReservaDetalle'];
export type CreateReservaRequest = components['schemas']['CreateReservaRequest'];
export type CreateReservaResponse = components['schemas']['CreateReservaResponse'];
export type CanalEntrada = components['schemas']['CanalEntrada'];
export type TipoEvento = components['schemas']['TipoEvento'];
export type DuracionHoras = components['schemas']['DuracionHoras'];
export type AsignarFechaRequest = components['schemas']['AsignarFechaRequest'];
export type AsignarFechaConflictoError = components['schemas']['AsignarFechaConflictoError'];
export type PendienteInvitadosResponse = components['schemas']['PendienteInvitadosResponse'];
export type BloqueoNoVigenteError = components['schemas']['BloqueoNoVigenteError'];
export type ErrorResponse = components['schemas']['ErrorResponse'];

/**
 * Resultado de la transición 2.b → 2.c (US-007), usado por la ficha y su aviso de
 * éxito: la RESERVA actualizada (`subEstado='2c'`, `ttlExpiracion` extendido) y el
 * recuento de consultas de cola descartadas (A16).
 */
export type PendienteInvitadosResultado = {
  reserva: Reserva;
  consultasDescartadas: number;
};

/** Resultado de un alta de consulta, usado por la página y sus avisos (2b/2d/2a/E1). */
export type ResultadoAlta = {
  reserva: CreateReservaResponse;
  tieneComentarios: boolean;
  conFecha: boolean;
  fechaEnviada: string;
};
