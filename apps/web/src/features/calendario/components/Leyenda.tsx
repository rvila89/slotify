import { Repeat } from 'lucide-react';
import { cn } from '@/lib/utils';
import { ESTILO_COLOR, ORDEN_LEYENDA } from '../lib/colores';

/**
 * Leyenda del código de colores canónico (US-039 §11.3). Ayuda al gestor a
 * interpretar las celdas; el mismo mapa `ESTILO_COLOR` que pinta el calendario
 * alimenta la leyenda (única fuente de verdad). Responsive: envuelve en móvil.
 */
export const Leyenda = () => (
  <ul className="flex flex-wrap items-center gap-x-4 gap-y-2 font-body text-xs text-text-secondary">
    {ORDEN_LEYENDA.map((color) => (
      <li key={color} className="flex items-center gap-1.5">
        <span aria-hidden className={cn('size-3 rounded-full', ESTILO_COLOR[color].punto)} />
        {ESTILO_COLOR[color].etiqueta}
      </li>
    ))}
    <li className="flex items-center gap-1.5">
      <Repeat aria-hidden className="size-3.5 text-text-primary" />
      N en cola
    </li>
  </ul>
);
