import { CalendarClock } from 'lucide-react';
import { Dato } from './Dato';
import { PLACEHOLDER_DATO_AUSENTE } from '../../../lib/detallesEvento';
import type { Reserva } from '../../../model/types';

/**
 * Sección "Detalles del evento" de la ficha (US-051 §Punto 1). Muestra la duración,
 * el nº de invitados (desglose adultos/niños ≤ 4 y aforo final), la hora de inicio
 * y los comentarios. Para cada campo opcional AUSENTE se muestra el placeholder
 * "De momento no se dispone de esta información" en lugar de omitir el campo, para
 * que el gestor vea qué falta. Es de LECTURA: no muta nada.
 */
const claseSeccion =
  'flex flex-col gap-6 rounded-[20px] border border-border-default/20 bg-surface-subtle/30 p-4 sm:p-6 lg:p-8';

type Props = {
  reserva: Reserva;
};

export const DetallesEvento = ({ reserva }: Props) => {
  const duracion =
    reserva.duracionHoras != null ? `${reserva.duracionHoras} h` : PLACEHOLDER_DATO_AUSENTE;
  const adultos =
    reserva.numAdultosNinosMayores4 != null
      ? String(reserva.numAdultosNinosMayores4)
      : PLACEHOLDER_DATO_AUSENTE;
  const ninos =
    reserva.numNinosMenores4 != null ? String(reserva.numNinosMenores4) : PLACEHOLDER_DATO_AUSENTE;
  const invitadosFinal =
    reserva.numInvitadosFinal != null
      ? String(reserva.numInvitadosFinal)
      : PLACEHOLDER_DATO_AUSENTE;
  const horario = reserva.horario ?? PLACEHOLDER_DATO_AUSENTE;
  const notas = reserva.notas ?? PLACEHOLDER_DATO_AUSENTE;

  return (
    <section className={claseSeccion} aria-labelledby="ficha-detalles-evento" data-testid="detalles-evento">
      <div id="ficha-detalles-evento" className="flex items-center gap-3">
        <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-brand-primary/10 text-brand-primary">
          <CalendarClock aria-hidden className="size-4" />
        </span>
        <h2 className="font-body text-xs font-bold uppercase tracking-[1.4px] text-text-secondary sm:text-sm">
          Detalles del evento
        </h2>
      </div>
      <dl className="grid grid-cols-1 gap-4 sm:grid-cols-2 sm:gap-6">
        <Dato etiqueta="Duración" valor={duracion} />
        <Dato etiqueta="Hora de inicio" valor={horario} />
        <Dato etiqueta="Invitados (adultos y niños > 4)" valor={adultos} />
        <Dato etiqueta="Niños ≤ 4" valor={ninos} />
        <Dato etiqueta="Nº de invitados final" valor={invitadosFinal} />
        <Dato etiqueta="Comentarios" valor={notas} />
      </dl>
    </section>
  );
};
