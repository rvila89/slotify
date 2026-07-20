import { notify } from '@/lib/notify';
import type { LiquidacionError } from '../model/types';

/**
 * Textos y disparadores de toast (sonner) para las acciones de facturación de US-028
 * (aprobar-y-enviar, enviar recibo de fianza por separado, reenviar). Centraliza los
 * mensajes en español para no repetirlos por componente y mapea cada desenlace de
 * `LiquidacionError` a un toast de error/advertencia:
 *  - `emision-envio-fallido` (502/503): toast de ADVERTENCIA "Error de envío, reintenta"
 *    (recuperable, rollback total; el Gestor puede volver a intentarlo).
 *  - `factura-no-borrador` / `no-enviada` (409): toast de ERROR con mensaje descriptivo.
 *  - resto (422/genérico): toast de ERROR con el mensaje normalizado.
 */
export const toastLiquidacionExito = (mensaje: string): void => {
  notify.success(mensaje);
};

export const toastLiquidacionError = (error: LiquidacionError): void => {
  if (error.tipo === 'emision-envio-fallido') {
    notify.warning('Error de envío, reintenta', {
      description: error.mensaje,
    });
    return;
  }

  notify.error(error.mensaje);
};
