/**
 * API pública del dominio de facturación (US-022 · UC-18): visualización de la
 * factura de señal en borrador y acciones del Gestor (aprobar / rechazar /
 * regenerar PDF) sobre una RESERVA en `reserva_confirmada`. El resto de la app
 * importa SIEMPRE desde aquí (`@/features/facturacion`), nunca de archivos internos.
 */
export { FacturaSenalCard } from './components/FacturaSenalCard';
export { FacturaBorradorCard } from './components/FacturaBorradorCard';
export { DocumentosLiquidacionFianza } from './components/DocumentosLiquidacionFianza';
export { AccionesFacturacion } from './components/AccionesFacturacion';
export { EstadoFacturaBadge } from './components/EstadoFacturaBadge';
export { useFacturaSenal, facturaSenalQueryKey } from './api/useFacturaSenal';
export { useFacturasReserva, facturasReservaQueryKey } from './api/useFacturasReserva';
export {
  derivarAlertaDocumentos,
  seleccionarBorradoresLiquidacionFianza,
} from './lib/alerta';
export type { AlertaDocumentos } from './lib/alerta';
export { useAprobarFactura } from './api/useAprobarFactura';
export type { AprobarFacturaVars } from './api/useAprobarFactura';
export { useRechazarFactura } from './api/useRechazarFactura';
export type { RechazarFacturaVars } from './api/useRechazarFactura';
export { useRegenerarPdf } from './api/useRegenerarPdf';
export type { RegenerarPdfVars } from './api/useRegenerarPdf';
export { estadoVisualFactura } from './lib/estado';
export type { EstadoVisualFactura } from './lib/estado';
export { ETIQUETA_TIPO_FACTURA } from './lib/estado';
export type { FacturaSenal, Factura, TipoFactura, FacturaError } from './model/types';
