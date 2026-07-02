import type { components } from '@/api-client';

/**
 * Tipos del dominio Cola de espera (US-017). Alias directos sobre los esquemas
 * del cliente generado (`@/api-client`): la fuente de verdad de la forma de los
 * datos es el contrato OpenAPI, nunca tipos inventados aquí.
 */
export type ColaEsperaResponse = components['schemas']['ColaEsperaResponse'];
export type ColaBloqueante = components['schemas']['ColaBloqueante'];
export type ColaItem = components['schemas']['ColaItem'];
