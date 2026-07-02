/**
 * API pública del dominio Cola de espera (US-017). El resto de la app importa
 * SIEMPRE desde aquí (`@/features/cola-espera`), nunca de archivos internos.
 * Base de US-019 (promoción manual) y US-020 (salir de cola).
 */
export { ColaEsperaPage } from './pages/ColaEsperaPage';
export { useColaEspera, colaEsperaQueryKey, ColaEsperaError } from './api/useColaEspera';
export type { ColaEsperaResponse, ColaBloqueante, ColaItem } from './model/types';
