import { FileText, Info } from 'lucide-react';
import { motivoNoPuedeGenerar, puedeGenerarPresupuesto } from '@/features/presupuestos';
import type { Reserva } from '../../../model/types';

/**
 * Bloque "Generar presupuesto" (US-014 · UC-14) de la sección Acciones. Extraído de
 * `AccionesConsulta` para respetar el límite de 300 líneas (regla dura `max-lines`).
 * Es el CTA PRINCIPAL para avanzar de estado (verde, token `accent-success`): visible
 * solo en fase `consulta`; habilitado en `2a/2b/2c/2v` y bloqueado con motivo en
 * `2d`/terminales. El backend revalida de forma defensiva (409/422).
 */
const claseBotonPresupuesto =
  'inline-flex h-14 w-full items-center justify-center gap-2 rounded-full bg-accent-success px-10 font-display text-base text-accent-success-foreground transition hover:opacity-95 disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto sm:px-16';

const claseTextoInfo = 'flex items-start gap-3 font-body text-sm text-text-secondary';

type Props = {
  reserva: Reserva;
  onGenerarPresupuesto: () => void;
};

export const AccionPresupuesto = ({ reserva, onGenerarPresupuesto }: Props) => {
  // Solo se muestra (habilitado o bloqueado) mientras la reserva sigue en fase
  // `consulta`; en `pre_reserva`+ desaparece (ya hay presupuesto/UC-15).
  if (reserva.estado !== 'consulta') return null;

  const puede = puedeGenerarPresupuesto({ estado: reserva.estado, subEstado: reserva.subEstado });

  return (
    <div className="flex flex-col gap-3">
      {puede ? (
        <>
          <p className="font-body text-sm text-text-secondary">
            Genera el presupuesto con la tarifa vigente y activa la pre-reserva: se creará el
            presupuesto, la fecha quedará bloqueada 7 días y se enviará al cliente por email.
          </p>
          <button
            type="button"
            data-testid="boton-generar-presupuesto"
            onClick={onGenerarPresupuesto}
            className={claseBotonPresupuesto}
          >
            <FileText aria-hidden className="size-5" />
            Generar presupuesto
          </button>
        </>
      ) : (
        <>
          <p data-testid="aviso-presupuesto-bloqueado" className={claseTextoInfo}>
            <Info aria-hidden className="mt-0.5 size-5 shrink-0 text-text-secondary" />
            {motivoNoPuedeGenerar({ estado: reserva.estado, subEstado: reserva.subEstado })}
          </p>
          <button
            type="button"
            data-testid="boton-generar-presupuesto"
            disabled
            aria-disabled="true"
            className={claseBotonPresupuesto}
          >
            <FileText aria-hidden className="size-5" />
            Generar presupuesto
          </button>
        </>
      )}
    </div>
  );
};
