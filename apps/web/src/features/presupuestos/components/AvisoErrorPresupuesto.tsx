import { AlertTriangle } from 'lucide-react';
import { ETIQUETA_CAMPO_FALTANTE } from '../lib/estado';
import type { PresupuestoError } from '../model/types';

/**
 * Aviso inline de error del flujo de presupuesto (US-014 §5.3). Renderiza cada
 * caso del contrato en español:
 *  - `datos-fiscales` (FA-01): enumera los campos faltantes con etiquetas legibles.
 *  - `tarifa-no-configurada`: mensaje claro de tarifario incompleto.
 *  - `precio-manual-requerido` (FA-02): pide introducir el precio manual.
 *  - `fecha-no-disponible` (race): "Fecha no disponible".
 *  - `presupuesto-ya-existe`: remite a la edición del presupuesto (UC-15).
 *  - `origen-invalido` / `generico`: mensaje neutro.
 *
 * Componente de presentación puro; el color rojo usa los tokens del proyecto.
 */
type Props = {
  error: PresupuestoError;
};

export const AvisoErrorPresupuesto = ({ error }: Props) => (
  <div
    role="alert"
    data-testid="aviso-error-presupuesto"
    data-error-tipo={error.tipo}
    className="flex items-start gap-3 rounded-[16px] border border-red-200 bg-red-50 p-4 text-red-700"
  >
    <AlertTriangle aria-hidden className="mt-0.5 size-5 shrink-0 text-red-600" />
    <div className="flex flex-col gap-2 font-body text-sm">
      <p>{error.mensaje}</p>

      {error.tipo === 'datos-fiscales' && error.camposFaltantes.length > 0 && (
        <ul className="list-disc pl-5" data-testid="lista-campos-faltantes">
          {error.camposFaltantes.map((campo) => (
            <li key={campo}>{ETIQUETA_CAMPO_FALTANTE[campo] ?? campo}</li>
          ))}
        </ul>
      )}

      {error.tipo === 'presupuesto-ya-existe' && (
        <p className="text-red-600/90">
          Abre la gestión del presupuesto existente para editarlo y reenviarlo (UC-15).
        </p>
      )}
    </div>
  </div>
);
