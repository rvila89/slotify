import { CalendarRange } from 'lucide-react';
import type { Reserva } from '../../../model/types';

/**
 * Bloque "Cambiar fecha" (US-051 §D-2.1, cambio ATÓMICO de fecha) de la sección
 * Acciones. Extraído de `AccionesConsulta` para respetar el límite de 300 líneas
 * (regla dura `max-lines`) y separar la GESTIÓN DE FECHA (flujo atómico + correo E1)
 * de la EDICIÓN de campos (`PATCH`, sin correo) — change `consulta-fecha-borrador-fix`.
 * Aplica a `2b/2c/2v` (fecha ya bloqueada) y a `2d` (consulta en cola de espera, change
 * `cambiar-fecha-consulta-en-cola`): el lead en cola puede pedir otra fecha y el gestor la
 * cambia con el mismo diálogo. En `2a` (sin fecha) la gestión es "Añadir fecha", no
 * "Cambiar fecha"; los sub-estados terminales no ofrecen la acción.
 */
const SUB_ESTADOS_CON_FECHA = ['2b', '2c', '2v', '2d'] as const;

const claseBotonFecha =
  'inline-flex h-14 w-full items-center justify-center gap-2 rounded-full border border-border-default bg-canvas px-10 font-display text-base text-text-secondary transition hover:bg-surface-muted sm:w-auto sm:px-16';

type Props = {
  reserva: Reserva;
  onCambiarFecha: () => void;
};

export const AccionCambiarFecha = ({ reserva, onCambiarFecha }: Props) => {
  const tieneFechaBloqueada = SUB_ESTADOS_CON_FECHA.includes(
    reserva.subEstado as (typeof SUB_ESTADOS_CON_FECHA)[number],
  );
  if (!tieneFechaBloqueada) return null;

  return (
    <button
      type="button"
      data-testid="boton-cambiar-fecha"
      onClick={onCambiarFecha}
      className={claseBotonFecha}
    >
      <CalendarRange aria-hidden className="size-5" />
      Cambiar fecha
    </button>
  );
};
