import { CheckCircle2, X } from 'lucide-react';

/**
 * Aviso inline verde de confirmación de edición de consulta. Sustituye al callback
 * vacío `onEditado={() => {}}` por un banner esmeralda en la cabecera de la ficha,
 * calcado del patrón de `AvisoDescarte` (banner verde, ícono, título con el código,
 * descripción, botón "Cerrar aviso").
 *
 * Presentacional puro: sin red ni SDK. La página monta este aviso a partir del
 * callback `onEditado` del diálogo de edición (`EditarConsultaDialog`).
 */
export const AvisoEdicionConsulta = ({
  codigo,
  onCerrar,
}: {
  codigo: string;
  onCerrar: () => void;
}) => (
  <div
    role="status"
    data-testid="alerta-edicion-consulta"
    className="flex items-start gap-3 rounded-[16px] border border-emerald-200 bg-emerald-50 p-4 text-emerald-900"
  >
    <CheckCircle2 aria-hidden className="mt-0.5 size-5 shrink-0 text-emerald-600" />
    <div className="flex-1">
      <p className="font-body text-sm font-bold">Consulta {codigo} actualizada</p>
      <p className="font-body text-sm">Los datos de la consulta se han guardado correctamente.</p>
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
