import { AlertTriangle } from 'lucide-react';
import type { DevolucionFianzaError } from '../model/types';

/**
 * Aviso inline de error de la devolución de fianza (fix-liquidacion-fianza-independientes:
 * devolución completa, sin IBAN ni retención). Renderiza en español cada caso del contrato:
 *  - `precondicion-no-cumplida` (409): la reserva no está en post-evento con la fianza recibida.
 *  - `ya-registrada` (409): la devolución ya se registró (estado final irreversible).
 *  - `generico`: mensaje neutro.
 *
 * Componente de presentación puro; el color rojo usa tokens del proyecto.
 */
type Props = {
  error: DevolucionFianzaError;
};

export const AvisoErrorDevolucionFianza = ({ error }: Props) => (
  <div
    role="alert"
    data-testid="aviso-error-devolucion-fianza"
    data-error-tipo={error.tipo}
    className="flex items-start gap-3 rounded-[16px] border border-red-200 bg-red-50 p-4 text-red-700"
  >
    <AlertTriangle aria-hidden className="mt-0.5 size-5 shrink-0 text-red-600" />
    <div className="flex flex-col gap-2 font-body text-sm">
      <p>{error.mensaje}</p>

      {error.tipo === 'ya-registrada' && (
        <p className="text-red-600/90">
          Actualiza la ficha para ver el estado más reciente de la fianza.
        </p>
      )}
    </div>
  </div>
);
