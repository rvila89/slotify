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

// US-015 — Editar y reenviar presupuesto en pre_reserva (UC-15).
export { EditarPresupuestoDialog } from './components/EditarPresupuestoDialog';
export { AvisoPresupuestoEditado } from './components/AvisoPresupuestoEditado';
export { puedeEditarPresupuesto } from './lib/estado';
export { usePreviewEdicionPresupuesto } from './api/usePreviewEdicionPresupuesto';
export type { PreviewEdicionVars } from './api/usePreviewEdicionPresupuesto';
export { useEditarPresupuesto } from './api/useEditarPresupuesto';
export type { EditarPresupuestoVars } from './api/useEditarPresupuesto';
export { useReenviarPresupuesto } from './api/useReenviarPresupuesto';
export type { ReenviarPresupuestoVars } from './api/useReenviarPresupuesto';
export type {
  EdicionPresupuestoResponse,
  EdicionPresupuestoPreviewResponse,
  ReenviarPresupuestoResponse,
} from './model/types';
