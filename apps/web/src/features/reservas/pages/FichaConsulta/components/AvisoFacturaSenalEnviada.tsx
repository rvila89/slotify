import { MailCheck, X } from 'lucide-react';

/**
 * Aviso de éxito tras enviar la factura de señal al cliente (E3 inicial, US-023 · UC-18 §6.4b).
 * Se muestra arriba de la ficha con scroll al inicio, siguiendo el mismo patrón que
 * `AvisoEmailEnviado`. Cerrable.
 */
export const AvisoFacturaSenalEnviada = ({ onCerrar }: { onCerrar: () => void }) => (
  <div
    role="status"
    data-testid="aviso-factura-senal-enviada"
    className="flex items-start gap-3 rounded-[16px] border border-emerald-200 bg-emerald-50 p-4 text-emerald-900"
  >
    <MailCheck aria-hidden className="mt-0.5 size-5 shrink-0 text-emerald-600" />
    <div className="flex-1">
      <p className="font-body text-sm font-bold">Factura de señal enviada</p>
      <p className="font-body text-sm">
        La factura de señal se ha enviado correctamente al cliente por email.
      </p>
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
