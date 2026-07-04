import { cn } from '@/lib/utils';
import { ESTADO_PRE_EVENTO } from '../lib/campos';
import type { PreEventoStatus } from '../model/types';

/**
 * Indicador de estado del sub-proceso pre-evento (US-025): `pendiente` / `en_curso`
 * (En curso) / `cerrado` (Cerrada). Refleja el `preEventoStatus` devuelto por el
 * backend tras cada guardado/cierre.
 */
export const EstadoFichaBadge = ({ estado }: { estado: PreEventoStatus }) => {
  const { etiqueta, clase } = ESTADO_PRE_EVENTO[estado];
  return (
    <span
      data-testid="ficha-estado-badge"
      data-estado={estado}
      className={cn(
        'inline-flex items-center rounded-full border px-3 py-1 font-body text-xs font-semibold',
        clase,
      )}
    >
      {etiqueta}
    </span>
  );
};
