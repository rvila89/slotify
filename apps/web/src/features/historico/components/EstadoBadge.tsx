import { cn } from '@/lib/utils';
import type { EstadoFinal } from '../model/types';
import { ESTADO_FINAL_LABEL } from '../lib/constants';

/**
 * Insignia tonal del estado cerrado de una reserva del histórico. Reutiliza el
 * lenguaje visual de los badges del pipeline (US-050): completada en tono
 * "confirmada", cancelada en tono de aviso. Ambos son estados terminales
 * inmutables, así que el badge es puramente informativo (sin acción).
 */
export const EstadoBadge = ({ estado }: { estado: EstadoFinal }) => {
  const tono =
    estado === 'reserva_completada'
      ? 'border-state-confirmada/40 bg-state-confirmada/15 text-[#5b2615]'
      : 'border-amber-200 bg-amber-50 text-amber-900';
  return (
    <span
      data-testid="badge-estado-final"
      className={cn(
        'inline-flex items-center gap-2 rounded-full border px-3 py-1 font-body text-xs font-semibold',
        tono,
      )}
    >
      <span aria-hidden className="size-2 rounded-full bg-current opacity-70" />
      {ESTADO_FINAL_LABEL[estado]}
    </span>
  );
};
