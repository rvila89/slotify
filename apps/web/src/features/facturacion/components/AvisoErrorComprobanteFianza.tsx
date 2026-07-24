import { AlertTriangle } from 'lucide-react';
import type { ComprobanteFianzaError } from '../model/types';

/**
 * Aviso inline de error de la subida del comprobante de fianza
 * (fix-liquidacion-fianza-independientes), espejo de `AvisoErrorCondiciones`. Renderiza en
 * español cada caso del contrato:
 *  - `estado-invalido`: la reserva no está en un estado que permita subir el comprobante (422).
 *  - `comprobante-requerido` / `formato-no-permitido` / `tamano-excedido`: validación del
 *    fichero (422).
 *  - `generico`: mensaje neutro.
 *
 * Componente de presentación puro; el color rojo usa tokens del proyecto.
 */
type Props = {
  error: ComprobanteFianzaError;
};

export const AvisoErrorComprobanteFianza = ({ error }: Props) => (
  <div
    role="alert"
    data-testid="aviso-error-comprobante-fianza"
    data-error-tipo={error.tipo}
    className="flex items-start gap-3 rounded-[16px] border border-red-200 bg-red-50 p-4 text-red-700"
  >
    <AlertTriangle aria-hidden className="mt-0.5 size-5 shrink-0 text-red-600" />
    <div className="flex flex-col gap-2 font-body text-sm">
      <p>{error.mensaje}</p>
    </div>
  </div>
);
