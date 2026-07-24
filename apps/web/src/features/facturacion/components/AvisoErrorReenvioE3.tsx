import { AlertTriangle, Info, RefreshCw } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { ReenvioE3Error } from '../model/types';

/**
 * Aviso inline de error del **reenvío de E3** (US-023 · GAP 3). Renderiza en español cada desenlace
 * del contrato:
 *  - `no-enviado-previamente` (409 `E3_NO_ENVIADO_PREVIAMENTE`): no hay un E3 previo que reenviar
 *    (aviso neutro/informativo; nada que reintentar).
 *  - `envio-fallido` (502/503 `EMISION_ENVIO_FALLIDO`): fallo RECUPERABLE; **nada ha cambiado** y el
 *    Gestor puede reintentar (ámbar, no rojo).
 *  - `no-encontrada` (404) / `generico`: error rojo.
 *
 * Componente de presentación puro; los colores usan tokens del proyecto.
 */
type Props = {
  error: ReenvioE3Error;
};

export const AvisoErrorReenvioE3 = ({ error }: Props) => {
  const recuperable = error.tipo === 'envio-fallido';
  const informativo = error.tipo === 'no-enviado-previamente';
  const suave = recuperable || informativo;

  return (
    <div
      role="alert"
      data-testid="aviso-error-reenvio-e3"
      data-error-tipo={error.tipo}
      className={cn(
        'flex items-start gap-3 rounded-[16px] border p-4',
        suave
          ? 'border-amber-200 bg-amber-50 text-amber-900'
          : 'border-red-200 bg-red-50 text-red-700',
      )}
    >
      {recuperable ? (
        <RefreshCw aria-hidden className="mt-0.5 size-5 shrink-0 text-amber-600" />
      ) : informativo ? (
        <Info aria-hidden className="mt-0.5 size-5 shrink-0 text-amber-600" />
      ) : (
        <AlertTriangle aria-hidden className="mt-0.5 size-5 shrink-0 text-red-600" />
      )}
      <div className="flex flex-col gap-2 font-body text-sm">
        <p>{error.mensaje}</p>

        {recuperable && (
          <p className="text-amber-800/90">
            No se ha reenviado nada: la factura y las condiciones siguen intactas. Puedes volver a
            intentarlo.
          </p>
        )}
      </div>
    </div>
  );
};
