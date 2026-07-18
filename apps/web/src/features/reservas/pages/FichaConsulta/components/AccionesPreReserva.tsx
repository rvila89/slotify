import { CheckCircle2, FilePen } from 'lucide-react';
import { puedeEditarPresupuesto } from '@/features/presupuestos';
import { puedeConfirmarSenal } from '@/features/confirmacion';
import { puedeDescartarPreReserva } from '../../../lib/descartarPreReserva';
import { AccionDescartarPreReserva } from './AccionDescartarPreReserva';
import type { Reserva } from '../../../model/types';

/**
 * Acciones de la fase `pre_reserva` de la ficha (US-015 + US-021 + descarte de
 * pre-reserva): "Confirmar pago de señal" (UC-17), "Editar presupuesto" (UC-15) y
 * "Descartar pre-reserva". Todas SOLO se ofrecen cuando la RESERVA está en
 * `pre_reserva`; el servidor revalida de forma defensiva (409/422). Extraído de
 * `AccionesConsulta` para respetar el límite de 300 líneas (regla dura `max-lines`).
 * Mobile-first (botones a ancho completo en `<sm`).
 *
 * Orden (workstream A `presupuesto-prereserva-cta-descarte-y-e2`): "Confirmar pago
 * de señal" va PRIMERO y usa el **verde** del sistema (`accent-success`, mismo token
 * que "Generar presupuesto" en `AccionPresupuesto`), por ser el CTA que avanza de
 * estado; "Editar presupuesto" queda debajo en `brand-primary` (secundaria); el
 * descarte va al final, en estilo destructivo/secundario (NO verde).
 */
const claseBotonSenal =
  'inline-flex h-14 w-full items-center justify-center gap-2 rounded-full bg-accent-success px-10 font-display text-base text-accent-success-foreground transition hover:opacity-95 disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto sm:px-16';

const claseBotonAccion =
  'inline-flex h-14 w-full items-center justify-center gap-2 rounded-full bg-brand-primary px-10 font-display text-base text-brand-foreground transition hover:opacity-95 disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto sm:px-16';

type Props = {
  reserva: Reserva;
  onEditarPresupuesto: () => void;
  onConfirmarSenal: () => void;
  onDescartarPreReserva: () => void;
};

export const AccionesPreReserva = ({
  reserva,
  onEditarPresupuesto,
  onConfirmarSenal,
  onDescartarPreReserva,
}: Props) => {
  const puedeEditar = puedeEditarPresupuesto({ estado: reserva.estado });
  const puedeConfirmar = puedeConfirmarSenal({ estado: reserva.estado });
  const puedeDescartar = puedeDescartarPreReserva({ estado: reserva.estado });

  if (!puedeEditar && !puedeConfirmar && !puedeDescartar) return null;

  return (
    <>
      {/* US-021: "Confirmar pago de señal" — CTA PRINCIPAL que avanza de estado
          (verde `accent-success`), primero en el orden. */}
      {puedeConfirmar && (
        <div className="flex flex-col gap-3">
          <p className="font-body text-sm text-text-secondary">
            El cliente ha aceptado el presupuesto. Adjunta el justificante del pago de la señal
            para confirmar la reserva: la fecha quedará bloqueada en firme, se congelarán los
            importes de señal y liquidación y se iniciarán los sub-procesos del evento.
          </p>
          <button
            type="button"
            data-testid="boton-confirmar-senal"
            onClick={onConfirmarSenal}
            className={claseBotonSenal}
          >
            <CheckCircle2 aria-hidden className="size-5" />
            Confirmar pago de señal
          </button>
        </div>
      )}

      {/* US-015: "Editar presupuesto" — ajustar la oferta (invitados, duración,
          extras, descuento) y crear una versión nueva (enviar/guardar borrador), o
          reenviar sin cambios. Acción secundaria (`brand-primary`). */}
      {puedeEditar && (
        <div className="flex flex-col gap-3">
          <p className="font-body text-sm text-text-secondary">
            Ajusta la oferta económica de la pre-reserva y reenvíala al cliente sin perder el
            historial de versiones, o reenvía el presupuesto vigente sin cambios.
          </p>
          <button
            type="button"
            data-testid="boton-editar-presupuesto"
            onClick={onEditarPresupuesto}
            className={claseBotonAccion}
          >
            <FilePen aria-hidden className="size-5" />
            Editar presupuesto
          </button>
        </div>
      )}

      {/* Descartar pre-reserva — acción de cierre manual (estilo secundario/
          destructivo, NO verde). Visible solo en `pre_reserva`. */}
      <AccionDescartarPreReserva
        reserva={reserva}
        onDescartarPreReserva={onDescartarPreReserva}
      />
    </>
  );
};
