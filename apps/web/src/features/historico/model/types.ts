/**
 * Alias de tipos del dominio de histórico sobre el cliente generado del contrato
 * OpenAPI (`@/api-client`). No se inventan tipos de API: todos derivan del SDK
 * generado (única fuente de verdad). El detalle en modo lectura reutiliza el
 * `ReservaDetalle` ya existente del pipeline (D-1); aquí solo se alias.
 */
import type { components } from '@/api-client';

/** Fila ligera del histórico (envoltorio `data[]` de `GET /historico`). */
export type ReservaHistorico = components['schemas']['ReservaHistorico'];

/** Detalle completo de una reserva (reutiliza `GET /reservas/{id}`, D-1). */
export type ReservaDetalle = components['schemas']['ReservaDetalle'];

/** Presupuesto de la reserva (para la sección "Presupuesto aceptado"). */
export type Presupuesto = components['schemas']['Presupuesto'];

/** Factura de la reserva (para la sección "Facturas"). */
export type Factura = components['schemas']['Factura'];

/** Metadata de paginación compartida con el pipeline (`{ total, page, limit, totalPages }`). */
export type PaginationMetadata = components['schemas']['PaginationMetadata'];

/** Estado cerrado del histórico (opt-in de canceladas). */
export type EstadoFinal = ReservaHistorico['estado'];

/** Tipo de evento del contrato (filtro exacto). */
export type TipoEvento = components['schemas']['TipoEvento'];

/**
 * Filtros de UI del histórico. Todos opcionales salvo la paginación (siempre
 * presente). Es el estado de la página que `useHistorico` traduce a los query
 * params del SDK (`listarHistorico`). El `q` es la búsqueda full-text.
 */
export type FiltrosHistorico = {
  readonly q?: string;
  readonly estadoFinal?: EstadoFinal;
  readonly fechaDesde?: string;
  readonly fechaHasta?: string;
  readonly tipoEvento?: TipoEvento;
  readonly importeMin?: string;
  readonly importeMax?: string;
  readonly page: number;
  readonly limit: number;
};
