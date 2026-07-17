import { cn } from '@/lib/utils';
import { ESTADO_COMUNICACION } from '../lib/estado';
import type { EstadoComunicacion } from '../model/types';

/**
 * Badge del estado de una COMUNICACION (US-046 · UC-36): `borrador` (ámbar) /
 * `enviado` (verde) / `fallido` (rojo). La presentación vive en `lib/estado.ts`.
 */
export const EstadoComunicacionBadge = ({ estado }: { estado: EstadoComunicacion }) => {
  const { etiqueta, clase } = ESTADO_COMUNICACION[estado];
  return (
    <span
      data-testid="comunicacion-estado-badge"
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
