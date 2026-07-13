/**
 * API pública del dominio de presupuestos (US-014 · UC-14). El resto de la app
 * importa SIEMPRE desde aquí (`@/features/presupuestos`), nunca de archivos
 * internos del dominio.
 */
export { GenerarPresupuestoDialog } from './components/GenerarPresupuestoDialog';
export { AvisoPresupuestoConfirmado } from './components/AvisoPresupuestoConfirmado';
export { puedeGenerarPresupuesto, motivoNoPuedeGenerar } from './lib/estado';
export { usePreviewPresupuesto } from './api/usePreviewPresupuesto';
export type { PreviewPresupuestoVars } from './api/usePreviewPresupuesto';
export { useConfirmarPresupuesto } from './api/useConfirmarPresupuesto';
export type { ConfirmarPresupuestoVars } from './api/useConfirmarPresupuesto';
export { useActualizarDatosFiscales } from './api/useActualizarDatosFiscales';
export type { ActualizarDatosFiscalesVars } from './api/useActualizarDatosFiscales';
export type {
  ConfirmarPresupuestoResponse,
  PresupuestoPreviewResponse,
  PresupuestoError,
} from './model/types';
