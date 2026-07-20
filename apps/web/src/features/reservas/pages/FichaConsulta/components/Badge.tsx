import { cn } from '@/lib/utils';
import type { Reserva } from '../../../model/types';
import { etiquetaEstadoPrincipal } from '../../../lib/etiquetaEstado';

const SUB_ESTADO_LABEL: Record<string, string> = {
  '2a': 'Consulta exploratoria',
  '2b': 'Consulta con fecha',
  '2c': 'Pendiente de invitados',
  '2d': 'En cola de espera',
  '2v': 'Visita programada',
  '2x': 'Descartada',
  '2y': 'No disponible',
  '2z': 'Cerrada',
};

/**
 * Insignia tonal del estado de la reserva. Muestra SIEMPRE algo visible: si hay
 * `subEstado` (consulta), la etiqueta del sub-estado (`2a…2z`); si no, la etiqueta
 * del ESTADO PRINCIPAL (`pre_reserva → «Pre-reserva»`, etc.). Solo devuelve `null`
 * cuando no hay ni sub-estado ni un estado principal mapeable.
 */
export const Badge = ({
  subEstado,
  estado,
}: {
  subEstado?: string;
  estado?: Reserva['estado'];
}) => {
  const etiquetaEstado = estado ? etiquetaEstadoPrincipal(estado) : null;
  const texto = subEstado ? (SUB_ESTADO_LABEL[subEstado] ?? subEstado) : etiquetaEstado;
  if (!texto) return null;
  const tono =
    subEstado === '2b'
      ? 'border-state-confirmada/40 bg-state-confirmada/15 text-[#5b2615]'
      : subEstado === '2d'
        ? 'border-amber-200 bg-amber-50 text-amber-900'
        : 'border-border-default bg-surface-muted text-text-secondary';
  return (
    <span
      data-testid="badge-sub-estado"
      className={cn(
        'inline-flex items-center gap-2 rounded-full border px-3 py-1 font-body text-xs font-semibold',
        tono,
      )}
    >
      <span aria-hidden className="size-2 rounded-full bg-current opacity-70" />
      {texto}
    </span>
  );
};
