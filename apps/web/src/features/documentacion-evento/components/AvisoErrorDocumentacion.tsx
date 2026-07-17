import { AlertTriangle } from 'lucide-react';
import type { SubirDocumentoEventoError } from '../model/types';

/**
 * Aviso inline de error de la subida de un documento del evento (US-033 · UC-24).
 * Renderiza en español cada caso del contrato (422 validación de negocio/fichero,
 * 404 reserva no encontrada). Componente de presentación puro; el color rojo usa
 * tokens del proyecto.
 */
type Props = {
  error: SubirDocumentoEventoError;
};

export const AvisoErrorDocumentacion = ({ error }: Props) => (
  <div
    role="alert"
    data-testid="aviso-error-documentacion-evento"
    data-error-tipo={error.tipo}
    className="flex items-start gap-3 rounded-[16px] border border-red-200 bg-red-50 p-4 text-red-700"
  >
    <AlertTriangle aria-hidden className="mt-0.5 size-5 shrink-0 text-red-600" />
    <div className="flex flex-col gap-2 font-body text-sm">
      <p>{error.mensaje}</p>

      {error.tipo === 'estado-no-permite' && (
        <p className="text-red-600/90">
          Actualiza la ficha para ver el estado más reciente de la reserva.
        </p>
      )}
    </div>
  </div>
);
