import { AlertTriangle } from 'lucide-react';
import { ETIQUETA_CAMPO_FISCAL } from '../lib/estado';
import type { FacturaError } from '../model/types';

/**
 * Aviso inline de error de las mutaciones de la factura de señal (US-022 · UC-18).
 * Renderiza en español cada caso del contrato:
 *  - `factura-no-borrador` (409): la factura ya no está en borrador (enviada/cobrada).
 *  - `datos-fiscales-incompletos` (422): borrador inválido; lista `camposFaltantes`.
 *  - `pdf-pendiente` (422): PDF pendiente de regenerar.
 *  - `motivo-requerido` (400): el rechazo llegó sin motivo válido.
 *  - `generico`: mensaje neutro.
 *
 * Componente de presentación puro; el color rojo usa tokens del proyecto.
 */
type Props = {
  error: FacturaError;
};

export const AvisoErrorFactura = ({ error }: Props) => (
  <div
    role="alert"
    data-testid="aviso-error-factura"
    data-error-tipo={error.tipo}
    className="flex items-start gap-3 rounded-[16px] border border-red-200 bg-red-50 p-4 text-red-700"
  >
    <AlertTriangle aria-hidden className="mt-0.5 size-5 shrink-0 text-red-600" />
    <div className="flex flex-col gap-2 font-body text-sm">
      <p>{error.mensaje}</p>

      {error.tipo === 'factura-no-borrador' && (
        <p className="text-red-600/90">
          Actualiza la ficha para ver el estado más reciente de la factura.
        </p>
      )}

      {error.tipo === 'datos-fiscales-incompletos' &&
        error.camposFaltantes &&
        error.camposFaltantes.length > 0 && (
          <div className="flex flex-col gap-1">
            <p className="text-red-600/90">Completa estos datos fiscales del cliente:</p>
            <ul className="list-inside list-disc text-red-600/90">
              {error.camposFaltantes.map((campo) => (
                <li key={campo}>{ETIQUETA_CAMPO_FISCAL[campo] ?? campo}</li>
              ))}
            </ul>
          </div>
        )}

      {error.tipo === 'pdf-pendiente' && (
        <p className="text-red-600/90">
          El PDF se está generando de nuevo. Vuelve a intentarlo cuando esté disponible.
        </p>
      )}
    </div>
  </div>
);
