import { AlertTriangle } from 'lucide-react';
import type { DevolucionFianzaError } from '../model/types';

/**
 * Aviso inline de error del registro de la devolución de fianza (US-036). Renderiza en español cada
 * desenlace del contrato:
 *  - `importe-supera-fianza` (400 `IMPORTE_SUPERA_FIANZA`, FA-02).
 *  - `fecha-invalida` (400 `FECHA_DEVOLUCION_INVALIDA`, FA-03).
 *  - `motivo-requerido` (400 `MOTIVO_RETENCION_REQUERIDO`).
 *  - `justificante-no-encontrado` (404).
 *  - `precondicion-no-cumplida` / `ya-registrada` (409).
 *  - `generico` (401/403/otros/red).
 *
 * Componente de presentación puro; los colores usan tokens del proyecto (rojo de error).
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
    <div className="flex flex-col gap-1 font-body text-sm">
      <p>{error.mensaje}</p>
      {error.tipo === 'ya-registrada' && (
        <p className="text-red-600/90">
          Actualiza la ficha para ver el estado final de la fianza; la devolución es irreversible.
        </p>
      )}
    </div>
  </div>
);
