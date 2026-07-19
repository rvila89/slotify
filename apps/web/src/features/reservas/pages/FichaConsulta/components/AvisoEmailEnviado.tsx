import { MailCheck, X } from 'lucide-react';

/**
 * Aviso de éxito del envío MANUAL del borrador E1 (mejoras-detalle-consulta §D-3).
 * Se muestra arriba de la ficha y va acompañado de un scroll al inicio, replicando la
 * UX del auto-envío del E1 (banner verde, patrón de `AvisosResultado.tsx`). Cerrable.
 */
export const AvisoEmailEnviado = ({ onCerrar }: { onCerrar: () => void }) => (
  <div
    role="status"
    data-testid="alerta-email-enviado"
    className="flex items-start gap-3 rounded-[16px] border border-emerald-200 bg-emerald-50 p-4 text-emerald-900"
  >
    <MailCheck aria-hidden className="mt-0.5 size-5 shrink-0 text-emerald-600" />
    <div className="flex-1">
      <p className="font-body text-sm font-bold">Email enviado</p>
      <p className="font-body text-sm">
        El correo se ha <strong>enviado correctamente</strong> al cliente. Las acciones de la
        consulta ya están disponibles.
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
