import { toast } from 'sonner';

/**
 * Notificaciones (toasts) de la app con la conducta "solo el último": antes de
 * emitir un toast nuevo se descartan los previos (`toast.dismiss()`), de modo
 * que a cada acción solo quede el último mensaje visible y no se apilen mensajes
 * antiguos que confundan al usuario.
 *
 * Envuelve `toast` de sonner preservando tipo, mensaje y opciones. Todo
 * `apps/web` DEBE usar `notify.*()` en lugar de `toast.*()` directo. La
 * configuración del `<Toaster/>` (`components/ui/sonner.tsx`) no cambia.
 */
const soloUltimo =
  <F extends (...args: never[]) => unknown>(emitir: F) =>
  (...args: Parameters<F>): ReturnType<F> => {
    toast.dismiss();
    return emitir(...args) as ReturnType<F>;
  };

export const notify = {
  success: soloUltimo(toast.success),
  error: soloUltimo(toast.error),
  warning: soloUltimo(toast.warning),
  info: soloUltimo(toast.info),
};
