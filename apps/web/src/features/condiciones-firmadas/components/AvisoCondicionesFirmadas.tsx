import { CheckCircle2, X } from 'lucide-react';

/**
 * Aviso inline verde tras registrar la firma de las condicions particulars
 * (change `condiciones-idioma-e2-firma-banner`, Mejora C). Sustituye al toast de
 * Sonner por un banner esmeralda en la cabecera de la ficha, calcado del patrón de
 * `AvisoDescarte` / `AvisoPresupuestoConfirmado`.
 *
 * Presentacional puro: sin red ni SDK. La página lo monta a partir del callback
 * `onRegistrado` de `CondicionesFirmadasCard`, distinguiendo primer registro
 * (`registrada`) de re-firma (`reregistrada`). Mobile-first: bloque `flex` con texto
 * que fluye y botón de cerrar a la derecha, sin overflow horizontal en 390px.
 */
export const AvisoCondicionesFirmadas = ({
  tipo,
  onCerrar,
}: {
  tipo: 'registrada' | 'reregistrada';
  onCerrar: () => void;
}) => {
  const esReregistrada = tipo === 'reregistrada';
  const titulo = esReregistrada ? 'Nueva versión registrada' : 'Firma registrada';
  const descripcion = esReregistrada
    ? 'La nueva copia firmada ha quedado registrada. Se conserva el histórico de versiones.'
    : 'La copia firmada de las condicions particulars ha quedado registrada en la reserva.';

  return (
    <div
      role="status"
      data-testid={
        esReregistrada ? 'aviso-condiciones-reregistradas' : 'aviso-condiciones-registradas'
      }
      className="flex items-start gap-3 rounded-[16px] border border-emerald-200 bg-emerald-50 p-4 text-emerald-800"
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
        className="shrink-0 rounded-full p-1 text-emerald-700 transition hover:bg-emerald-100"
      >
        <X aria-hidden className="size-4" />
      </button>
    </div>
  );
};
