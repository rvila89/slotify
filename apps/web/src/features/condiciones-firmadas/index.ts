/**
 * API pública del dominio de firma de condiciones particulares (US-024 · UC-19,
 * segundo flujo): registrar la copia firmada por el cliente en la ficha de la
 * reserva. El resto de la app importa SIEMPRE desde aquí
 * (`@/features/condiciones-firmadas`), nunca de archivos internos.
 */
export { CondicionesFirmadasCard } from './components/CondicionesFirmadasCard';
export { RegistrarFirmaDialog } from './components/RegistrarFirmaDialog';
export { AvisoErrorCondiciones } from './components/AvisoErrorCondiciones';
export { useRegistrarCondicionesFirmadas } from './api/useRegistrarCondicionesFirmadas';
export type { RegistrarCondicionesFirmadasVars } from './api/useRegistrarCondicionesFirmadas';
export {
  debeMostrarSeccionCondiciones,
  condicionesEnviadas,
  condicionesFirmadas,
} from './lib/estado';
export type {
  RegistrarCondicionesFirmadasResponse,
  CondicionesFirmadasError,
} from './model/types';
