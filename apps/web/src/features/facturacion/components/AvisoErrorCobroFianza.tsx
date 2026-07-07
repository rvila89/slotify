import { AlertTriangle } from 'lucide-react';
import type { CobroFianzaError } from '../model/types';

/**
 * Aviso inline de error del registro del cobro de fianza (US-030). Renderiza en español cada
 * desenlace del contrato:
 *  - `ya-cobrada` (409 `FIANZA_YA_COBRADA`): doble cobro; la fianza ya está cobrada.
 *  - `cobro-invalido` (400 `COBRO_INVALIDO`): importe ≤ 0 o fecha posterior al evento.
 *  - `factura-no-encontrada` / `justificante-no-encontrado` (404).
 *  - `generico` (401/403/otros/red).
 *
 * Componente de presentación puro; los colores usan tokens del proyecto (rojo de error).
 */
type Props = {
  error: CobroFianzaError;
};

export const AvisoErrorCobroFianza = ({ error }: Props) => (
  <div
    role="alert"
    data-testid="aviso-error-cobro-fianza"
    data-error-tipo={error.tipo}
    className="flex items-start gap-3 rounded-[16px] border border-red-200 bg-red-50 p-4 text-red-700"
  >
    <AlertTriangle aria-hidden className="mt-0.5 size-5 shrink-0 text-red-600" />
    <div className="flex flex-col gap-1 font-body text-sm">
      <p>{error.mensaje}</p>
      {error.tipo === 'ya-cobrada' && (
        <p className="text-red-600/90">Actualiza la ficha para ver el estado más reciente de la fianza.</p>
      )}
    </div>
  </div>
);
