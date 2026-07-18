import { Pencil } from 'lucide-react';
import type { Reserva } from '../../../model/types';

/**
 * Bloque "Editar consulta" (US-051 §Punto 2) de la sección Acciones. Extraído de
 * `AccionesConsulta` para respetar el límite de 300 líneas (regla dura
 * `max-lines`). Visible mientras la RESERVA sigue en fase `consulta` (no terminal;
 * los terminales ya no llegan aquí). Abre el editor de campos simples de la
 * consulta; la fecha se gestiona dentro por el flujo atómico (§D-2).
 */
const claseBotonEditar =
  'inline-flex h-14 w-full items-center justify-center gap-2 rounded-full border border-border-default bg-canvas px-10 font-display text-base text-text-secondary transition hover:bg-surface-muted sm:w-auto sm:px-16';

type Props = {
  reserva: Reserva;
  onEditarConsulta: () => void;
};

export const AccionEditarConsulta = ({ reserva, onEditarConsulta }: Props) => {
  if (reserva.estado !== 'consulta') return null;

  return (
    <button
      type="button"
      data-testid="boton-editar-consulta"
      onClick={onEditarConsulta}
      className={claseBotonEditar}
    >
      <Pencil aria-hidden className="size-5" />
      Editar consulta
    </button>
  );
};
