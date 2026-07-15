import { AlertTriangle, Info, RefreshCw } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { EnvioSenalError } from '../model/types';

/**
 * Aviso inline de error del envío de la factura de señal 40% por email E3 (rebanada 6.4b).
 * Renderiza en español cada desenlace del contrato:
 *  - `ya-enviado` (409 `E3_YA_ENVIADO`): idempotencia; la factura ya se envió (aviso neutro,
 *    NO es un fallo real: nada que reintentar, se resalta en ámbar informativo).
 *  - `no-enviable` (409 `FACTURA_SENAL_NO_ENVIABLE`): la factura no está en estado enviable.
 *  - `no-encontrada` (404): no existe factura de señal.
 *  - `envio-fallido` (502 `EMISION_ENVIO_FALLIDO`): fallo RECUPERABLE; **nada ha cambiado** y
 *    el Gestor puede reintentar (ámbar, no rojo, porque no hay pérdida de estado).
 *  - `generico`: mensaje neutro.
 *
 * Componente de presentación puro; los colores usan tokens del proyecto.
 */
type Props = {
  error: EnvioSenalError;
};

export const AvisoErrorEnvioSenal = ({ error }: Props) => {
  const recuperable = error.tipo === 'envio-fallido';
  const informativo = error.tipo === 'ya-enviado';
  const suave = recuperable || informativo;

  return (
    <div
      role="alert"
      data-testid="aviso-error-envio-senal"
      data-error-tipo={error.tipo}
      className={cn(
        'flex items-start gap-3 rounded-[16px] border p-4',
        suave ? 'border-amber-200 bg-amber-50 text-amber-900' : 'border-red-200 bg-red-50 text-red-700',
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
            No se ha enviado nada: la factura sigue intacta. Puedes volver a intentarlo.
          </p>
        )}

        {error.tipo === 'no-enviable' && (
          <p className="text-red-600/90">
            Aprueba la factura de señal antes de enviarla al cliente.
          </p>
        )}
      </div>
    </div>
  );
};
