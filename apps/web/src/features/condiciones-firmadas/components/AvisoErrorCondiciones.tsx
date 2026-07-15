import { AlertTriangle } from 'lucide-react';
import type { CondicionesFirmadasError } from '../model/types';

/**
 * Aviso inline de error del flujo de registro de firma (US-024 · UC-19). Renderiza
 * en español cada caso del contrato:
 *  - `condiciones-no-enviadas`: E3 aún no enviado (409).
 *  - `estado-invalido`: reserva en estado terminal / no válido (422).
 *  - `condiciones-requeridas` / `formato-no-permitido` / `tamano-excedido`:
 *    validación del fichero (422).
 *  - `generico`: mensaje neutro.
 *
 * Componente de presentación puro; el color rojo usa tokens del proyecto.
 */
type Props = {
  error: CondicionesFirmadasError;
};

export const AvisoErrorCondiciones = ({ error }: Props) => (
  <div
    role="alert"
    data-testid="aviso-error-condiciones"
    data-error-tipo={error.tipo}
    className="flex items-start gap-3 rounded-[16px] border border-red-200 bg-red-50 p-4 text-red-700"
  >
    <AlertTriangle aria-hidden className="mt-0.5 size-5 shrink-0 text-red-600" />
    <div className="flex flex-col gap-2 font-body text-sm">
      <p>{error.mensaje}</p>

      {error.tipo === 'condiciones-no-enviadas' && (
        <p className="text-red-600/90">
          Completa primero el envío de las condiciones particulares al cliente (E3).
        </p>
      )}
    </div>
  </div>
);
