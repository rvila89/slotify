import { CalendarClock } from 'lucide-react';
import { Dato } from './Dato';
import { PLACEHOLDER_DATO_AUSENTE } from '../../../lib/detallesEvento';
import type { ReservaDetalle } from '../../../model/types';

/**
 * Sección "Detalles del evento" de la ficha (US-051 §Punto 1). Muestra la duración,
 * el nº de invitados, la hora de inicio y los comentarios de la consulta. Para cada
 * campo opcional AUSENTE se muestra el placeholder "De momento no se dispone de esta
 * información" en lugar de omitir el campo, para que el gestor vea qué falta. El nº de
 * invitados se muestra en una sola fila "Invitados" (el desglose adultos/niños ≤ 4 y
 * el aforo final no se piden al crear la consulta, así que no se muestran aquí; siguen
 * en el editor y en el aforo del Kanban/Listado — mejoras-detalle-consulta §D-1).
 *
 * Diferencia entre los dos campos de texto:
 * - `comentarios`: texto libre que escribió el cliente al crear el lead. Solo lectura.
 * - `notas`: anotaciones internas del gestor, editables vía el editor de consulta.
 * Ambas se muestran con etiquetas distintas. Es de LECTURA: no muta nada.
 */
const claseSeccion =
  'flex flex-col gap-6 rounded-[20px] border border-border-default/20 bg-surface-subtle/30 p-4 sm:p-6 lg:p-8';

type Props = {
  reserva: ReservaDetalle;
};

export const DetallesEvento = ({ reserva }: Props) => {
  const duracion =
    reserva.duracionHoras != null ? `${reserva.duracionHoras} h` : PLACEHOLDER_DATO_AUSENTE;
  const invitados =
    reserva.numAdultosNinosMayores4 != null
      ? String(reserva.numAdultosNinosMayores4)
      : PLACEHOLDER_DATO_AUSENTE;
  const horario = reserva.horario ?? PLACEHOLDER_DATO_AUSENTE;
  const comentarios = reserva.comentarios ?? PLACEHOLDER_DATO_AUSENTE;
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
        <Dato etiqueta="Invitados" valor={invitados} />
        <Dato etiqueta="Comentarios del cliente" valor={comentarios} />
        <Dato etiqueta="Notas internas" valor={notas} />
      </dl>
    </section>
  );
};
