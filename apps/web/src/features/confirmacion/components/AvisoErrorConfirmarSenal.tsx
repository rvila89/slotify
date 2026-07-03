import { AlertTriangle } from 'lucide-react';
import type { ConfirmarSenalError } from '../model/types';

/**
 * Aviso inline de error del flujo de confirmación de señal (US-021 · UC-17).
 * Renderiza en español cada caso del contrato:
 *  - `justificante-requerido` / `formato-no-permitido` / `tamano-excedido`:
 *    validación del fichero (422).
 *  - `origen-invalido`: la RESERVA ya no está en `pre_reserva` (422).
 *  - `importe-invalido`: sin presupuesto aceptado previo (422).
 *  - `reserva-ya-confirmada`: doble clic / dos sesiones (409).
 *  - `fecha-no-disponible`: carrera D4 sobre la fecha firme (409).
 *  - `generico`: mensaje neutro.
 *
 * Componente de presentación puro; el color rojo usa tokens del proyecto.
 */
type Props = {
  error: ConfirmarSenalError;
};

export const AvisoErrorConfirmarSenal = ({ error }: Props) => (
  <div
    role="alert"
    data-testid="aviso-error-confirmar-senal"
    data-error-tipo={error.tipo}
    className="flex items-start gap-3 rounded-[16px] border border-red-200 bg-red-50 p-4 text-red-700"
  >
    <AlertTriangle aria-hidden className="mt-0.5 size-5 shrink-0 text-red-600" />
    <div className="flex flex-col gap-2 font-body text-sm">
      <p>{error.mensaje}</p>

      {error.tipo === 'reserva-ya-confirmada' && (
        <p className="text-red-600/90">
          Actualiza la ficha para ver el estado más reciente de la reserva.
        </p>
      )}

      {error.tipo === 'fecha-no-disponible' && (
        <p className="text-red-600/90">
          Esa fecha ya está confirmada en firme por otra reserva.
        </p>
      )}
    </div>
  </div>
);
