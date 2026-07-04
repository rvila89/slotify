import { Info, X } from 'lucide-react';
import { etiquetasCamposVacios } from '../lib/campos';

type Props = {
  /** Nombres camelCase de los campos vacíos al cerrar (`avisosCamposVacios`). */
  campos: readonly string[];
  onCerrar: () => void;
};

/**
 * Aviso PURAMENTE INFORMATIVO (no error bloqueante) que se muestra tras cerrar la
 * ficha cuando quedaron campos de contenido vacíos (US-025 · D-6). El cierre ya se
 * ha confirmado; este banner solo enumera los campos que faltaron por si el gestor
 * quiere completarlos (la ficha sigue siendo editable). Es descartable.
 */
export const AvisoCamposVacios = ({ campos, onCerrar }: Props) => {
  if (campos.length === 0) return null;
  const etiquetas = etiquetasCamposVacios(campos);
  return (
    <div
      role="status"
      data-testid="aviso-campos-vacios"
      className="flex items-start gap-3 rounded-[16px] border border-amber-200 bg-amber-50 p-4 text-amber-900"
    >
      <Info aria-hidden className="mt-0.5 size-5 shrink-0 text-amber-600" />
      <div className="flex flex-1 flex-col gap-1 font-body text-sm">
        <p className="font-medium">
          Ficha cerrada con {etiquetas.length}{' '}
          {etiquetas.length === 1 ? 'campo sin rellenar' : 'campos sin rellenar'}.
        </p>
        <p className="text-amber-800/90">
          El cierre no requiere la ficha completa. Puedes completar estos campos más
          tarde: {etiquetas.join(', ')}.
        </p>
      </div>
      <button
        type="button"
        onClick={onCerrar}
        aria-label="Descartar aviso"
        className="shrink-0 rounded-full p-1 text-amber-700 transition hover:bg-amber-100"
      >
        <X aria-hidden className="size-4" />
      </button>
    </div>
  );
};
