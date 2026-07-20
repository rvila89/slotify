import { CalendarPlus, Mail } from 'lucide-react';
import { AccionCambiarFecha } from './AccionCambiarFecha';
import { AccionEditarConsulta } from './AccionEditarConsulta';
import type { Reserva } from '../../../model/types';

/**
 * Botonera de la ficha cuando existe un borrador E1 pendiente de envío
 * (change `consulta-fecha-borrador-fix` §D-4). El desbloqueo es PARCIAL: se permiten
 * "Editar consulta" y la GESTIÓN DE FECHA (añadir en `2a` / cambiar en `2b/2c/2v`),
 * porque introducen los datos que el propio borrador necesita (placeholder `___`);
 * las acciones downstream (presupuesto, visita, descartar…) NO se ofrecen hasta enviar
 * el E1. Extraída de `AccionesConsulta` para respetar `max-lines` (regla dura).
 */
const claseBotonAccion =
  'inline-flex h-14 w-full items-center justify-center gap-2 rounded-full bg-brand-primary px-10 font-display text-base text-brand-foreground transition hover:opacity-95 disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto sm:px-16';

type Props = {
  reserva: Reserva;
  onAnadirFecha: () => void;
  onCambiarFecha: () => void;
  onEditarConsulta: () => void;
};

export const AccionesBorradorPendiente = ({
  reserva,
  onAnadirFecha,
  onCambiarFecha,
  onEditarConsulta,
}: Props) => (
  <div className="flex flex-col gap-5">
    <div
      data-testid="aviso-borrador-e1-pendiente"
      className="flex items-start gap-3 rounded-lg border border-amber-200 bg-amber-50 p-4 font-body text-sm text-amber-800"
    >
      <Mail aria-hidden className="mt-0.5 size-5 shrink-0 text-amber-600" />
      <span>
        Revisa y envía el correo de confirmación antes de continuar. Mientras tanto puedes editar la
        consulta y ajustar la fecha para que el borrador refleje los datos definitivos.
      </span>
    </div>
    <AccionEditarConsulta reserva={reserva} onEditarConsulta={onEditarConsulta} />
    {reserva.subEstado === '2a' ? (
      <button
        type="button"
        data-testid="boton-anadir-fecha"
        onClick={onAnadirFecha}
        className={claseBotonAccion}
      >
        <CalendarPlus aria-hidden className="size-5" />
        Añadir fecha
      </button>
    ) : (
      <AccionCambiarFecha reserva={reserva} onCambiarFecha={onCambiarFecha} />
    )}
  </div>
);
