import { ESTILO_COLOR } from '@/features/calendario';
import type { ColorCalendario } from '@/features/calendario';
import { cn } from '@/lib/utils';

/**
 * Punto de color semántico del widget `proximos30Dias` (US-044). Reutiliza la
 * MISMA tabla `color → clases` del Calendario (US-039 §11.3) reexpuesta por su
 * barrel (`ESTILO_COLOR[color].punto`), en vez de reimplementar el mapa: el
 * código cromático es único en toda la app (design US-044 §D-2).
 *
 * `etiqueta` viaja como `title`/`aria-label` para que el color sea accesible a
 * lectores de pantalla (el color por sí solo no comunica).
 */
export const ColorDot = ({ color }: { color: ColorCalendario }) => {
  const estilo = ESTILO_COLOR[color];
  return (
    <span
      className={cn('inline-block size-2.5 shrink-0 rounded-full', estilo.punto)}
      title={estilo.etiqueta}
      aria-label={estilo.etiqueta}
      role="img"
    />
  );
};
