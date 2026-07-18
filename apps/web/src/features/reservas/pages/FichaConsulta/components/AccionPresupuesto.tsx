import { FileText, Info, Pencil } from 'lucide-react';
import {
  camposCompletitudFaltantes,
  motivoNoPuedeGenerar,
  puedeGenerarPresupuesto,
} from '@/features/presupuestos';
import { esConsultaTerminal } from '../../../lib/estadoTerminal';
import type { Reserva } from '../../../model/types';

/**
 * Bloque "Generar presupuesto" (US-014 · UC-14) de la sección Acciones. Extraído de
 * `AccionesConsulta` para respetar el límite de 300 líneas (regla dura `max-lines`).
 * Es el CTA PRINCIPAL para avanzar de estado (verde, token `accent-success`): visible
 * solo en fase `consulta` NO terminal; habilitado en `2a/2b/2c/2v` con datos de evento
 * completos (US-051 §Punto 3) y bloqueado con motivo (enumerando lo que falta) en
 * `2d`/incompleto. En sub-estados terminales (`2x/2y/2z`) NO se renderiza nada
 * (US-051 §Punto 4). El backend revalida de forma defensiva (409/422).
 */
const claseBotonPresupuesto =
  'inline-flex h-14 w-full items-center justify-center gap-2 rounded-full bg-accent-success px-10 font-display text-base text-accent-success-foreground transition hover:opacity-95 disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto sm:px-16';

const claseBotonEditar =
  'inline-flex h-12 w-full items-center justify-center gap-2 rounded-full border border-border-default bg-canvas px-8 font-body text-base font-medium text-text-secondary transition hover:bg-surface-muted sm:w-auto';

const claseTextoInfo = 'flex items-start gap-3 font-body text-sm text-text-secondary';

type Props = {
  reserva: Reserva;
  onGenerarPresupuesto: () => void;
  onEditarConsulta: () => void;
};

export const AccionPresupuesto = ({ reserva, onGenerarPresupuesto, onEditarConsulta }: Props) => {
  // Solo se muestra (habilitado o bloqueado) mientras la reserva sigue en fase
  // `consulta` NO terminal; en `pre_reserva`+ desaparece (ya hay presupuesto/UC-15)
  // y en terminales (`2x/2y/2z`) tampoco se ofrece (US-051 §Punto 4).
  if (reserva.estado !== 'consulta' || esConsultaTerminal(reserva)) return null;

  const guarda = {
    estado: reserva.estado,
    subEstado: reserva.subEstado,
    fechaEvento: reserva.fechaEvento,
    numAdultosNinosMayores4: reserva.numAdultosNinosMayores4,
    duracionHoras: reserva.duracionHoras,
    horario: reserva.horario,
  };
  const puede = puedeGenerarPresupuesto(guarda);
  // Cuando el bloqueo se debe a datos incompletos (no al estado), se ofrece el
  // atajo a "Editar consulta" para corregirlos (US-051 §Punto 3).
  const faltanDatos = camposCompletitudFaltantes(guarda).length > 0 && reserva.subEstado !== '2d';

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
            {motivoNoPuedeGenerar(guarda)}
          </p>
          <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap">
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
            {faltanDatos && (
              <button
                type="button"
                data-testid="boton-editar-consulta-presupuesto"
                onClick={onEditarConsulta}
                className={claseBotonEditar}
              >
                <Pencil aria-hidden className="size-5" />
                Editar consulta
              </button>
            )}
          </div>
        </>
      )}
    </div>
  );
};
