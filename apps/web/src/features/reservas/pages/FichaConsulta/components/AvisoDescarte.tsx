import { CheckCircle2, X } from 'lucide-react';

/**
 * Aviso inline verde de confirmación de descarte (change
 * `2026-07-20-descarte-aviso-inline-ficha`). Sustituye al `toast.success()` lateral
 * de Sonner por un banner esmeralda en la cabecera de la ficha, calcado del patrón de
 * `AvisoVisitaProgramada` (banner verde, ícono, título en negrita con el código,
 * descripción, botón "Cerrar aviso").
 *
 * Presentacional puro: sin red ni SDK. La página monta este aviso a partir del
 * callback `onDescartado` de los diálogos de descarte (consulta / pre-reserva).
 */
export const AvisoDescarte = ({
  tipo,
  codigo,
  onCerrar,
}: {
  tipo: 'consulta' | 'prereserva';
  codigo: string;
  onCerrar: () => void;
}) => {
  const esPreReserva = tipo === 'prereserva';
  const titulo = esPreReserva
    ? `Pre-reserva ${codigo} descartada`
    : `Consulta ${codigo} descartada`;
  const descripcion = esPreReserva
    ? 'La reserva se ha cancelado y la fecha del evento ha quedado liberada.'
    : 'La consulta se ha marcado como descartada por el cliente.';

  return (
    <div
      role="status"
      data-testid={esPreReserva ? 'alerta-descarte-prereserva' : 'alerta-descarte-consulta'}
      className="flex items-start gap-3 rounded-[16px] border border-emerald-200 bg-emerald-50 p-4 text-emerald-900"
    >
      <CheckCircle2 aria-hidden className="mt-0.5 size-5 shrink-0 text-emerald-600" />
      <div className="flex-1">
        <p className="font-body text-sm font-bold">{titulo}</p>
        <p className="font-body text-sm">{descripcion}</p>
      </div>
      <button
        type="button"
        aria-label="Cerrar aviso"
        onClick={onCerrar}
        className="rounded-full p-1 text-emerald-700 transition hover:bg-emerald-100"
      >
        <X aria-hidden className="size-4" />
      </button>
    </div>
  );
};
