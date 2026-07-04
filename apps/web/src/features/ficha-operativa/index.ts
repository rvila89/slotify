/**
 * API pública del dominio de ficha operativa del evento (US-025 · UC-20):
 * cumplimentar progresivamente y cerrar la FICHA_OPERATIVA de una RESERVA en
 * `reserva_confirmada` (o posterior). El resto de la app importa SIEMPRE desde aquí
 * (`@/features/ficha-operativa`), nunca de archivos internos del dominio.
 */
export { FichaOperativaCard } from './components/FichaOperativaCard';
export { useFichaOperativa, fichaOperativaQueryKey } from './api/useFichaOperativa';
export { useGuardarFicha } from './api/useGuardarFicha';
export type { GuardarFichaVars } from './api/useGuardarFicha';
export { useCerrarFicha } from './api/useCerrarFicha';
export type { CerrarFichaVars } from './api/useCerrarFicha';
export type {
  FichaOperativa,
  CerrarFichaOperativaResponse,
  PreEventoStatus,
  EstadoFicha,
} from './model/types';
