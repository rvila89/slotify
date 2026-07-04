import { AlertTriangle, RefreshCw } from 'lucide-react';
import { cn } from '@/lib/utils';
import { ETIQUETA_CAMPO_FISCAL } from '../lib/estado';
import type { LiquidacionError } from '../model/types';

/**
 * Aviso inline de error de las mutaciones de emisión con envío de US-028 (aprobar-y-enviar,
 * enviar recibo de fianza por separado, reenviar). Renderiza en español cada desenlace del
 * contrato:
 *  - `factura-no-borrador` (409): la factura ya no está en borrador.
 *  - `no-enviada` (409 reenvío): aún no está emitida; apruébala primero.
 *  - `datos-fiscales-incompletos` (422): lista `camposFaltantes` del cliente.
 *  - `pdf-pendiente` (422): PDF pendiente; el sistema reintenta.
 *  - `descuento-invalido` (422): descuento negativo o total ≤ 0.
 *  - `emision-envio-fallido` (502/503): fallo RECUPERABLE; **nada ha cambiado** y el Gestor
 *    puede reintentar (se resalta en ámbar, no en rojo, porque no hay pérdida de estado).
 *  - `generico`: mensaje neutro.
 *
 * Componente de presentación puro; los colores usan tokens del proyecto.
 */
type Props = {
  error: LiquidacionError;
};

export const AvisoErrorLiquidacion = ({ error }: Props) => {
  const recuperable = error.tipo === 'emision-envio-fallido';

  return (
    <div
      role="alert"
      data-testid="aviso-error-liquidacion"
      data-error-tipo={error.tipo}
      className={cn(
        'flex items-start gap-3 rounded-[16px] border p-4',
        recuperable
          ? 'border-amber-200 bg-amber-50 text-amber-900'
          : 'border-red-200 bg-red-50 text-red-700',
      )}
    >
      {recuperable ? (
        <RefreshCw aria-hidden className="mt-0.5 size-5 shrink-0 text-amber-600" />
      ) : (
        <AlertTriangle aria-hidden className="mt-0.5 size-5 shrink-0 text-red-600" />
      )}
      <div className="flex flex-col gap-2 font-body text-sm">
        <p>{error.mensaje}</p>

        {recuperable && (
          <p className="text-amber-800/90">
            No se ha emitido ni enviado nada: los borradores siguen intactos. Puedes volver a
            intentarlo.
          </p>
        )}

        {error.tipo === 'no-enviada' && (
          <p className="text-red-600/90">
            Usa "Aprobar y enviar" para emitir la factura antes de reenviarla.
          </p>
        )}

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
};
