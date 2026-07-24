import { Loader2, RefreshCw } from 'lucide-react';
import { notify } from '@/lib/notify';
import { useReenviarLiquidacion } from '../api/useReenviarLiquidacion';
import { AvisoErrorLiquidacion } from './AvisoErrorLiquidacion';

/**
 * Acción **Reenviar factura de liquidación** (E4), espejo de `AccionReenviarE3`. Vuelve a
 * remitir al cliente la factura de liquidación YA emitida (`useReenviarLiquidacion`, endpoint
 * `POST .../facturas/liquidacion/reenviar`): NO reasigna número ni cambia estado; crea una
 * nueva COMUNICACION E4.
 *
 * Estados y feedback (patrón de las acciones hermanas de facturación):
 *  - Carga: botón deshabilitado + spinner "Reenviando…".
 *  - Éxito (200): toast "Factura de liquidación reenviada" (queries invalidadas en el hook).
 *  - Error:
 *      - 409 `no-enviada` → info "La liquidación aún no se ha emitido".
 *      - 502/503 `emision-envio-fallido` → advertencia reintentable (rollback total).
 *      - resto → error. El detalle inline lo muestra `AvisoErrorLiquidacion`.
 *
 * Mobile-first: el botón ocupa el ancho completo en `<sm` y ancho automático en `sm:`, con
 * objetivo táctil de 44px (`h-11`); sin overflow horizontal.
 */
type Props = {
  /** ID de la RESERVA sobre la que se reenvía E4 (path del endpoint). */
  reservaId: string;
};

const claseBotonSecundario =
  'inline-flex h-11 w-full items-center justify-center gap-2 rounded-full border border-border-default bg-canvas px-6 font-body text-sm font-medium text-text-secondary transition hover:bg-surface-muted disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto';

export const AccionReenviarE4 = ({ reservaId }: Props) => {
  const reenviar = useReenviarLiquidacion();

  const onReenviar = () => {
    reenviar.mutate(
      { reservaId },
      {
        onSuccess: () => {
          notify.success('Factura de liquidación reenviada al cliente.');
        },
        onError: (error) => {
          if (error.tipo === 'emision-envio-fallido') {
            notify.warning('Error de reenvío, reintenta', { description: error.mensaje });
          } else if (error.tipo === 'no-enviada') {
            notify.info(error.mensaje);
          } else {
            notify.error(error.mensaje);
          }
        },
      },
    );
  };

  return (
    <div className="flex flex-col gap-3">
      {reenviar.error && <AvisoErrorLiquidacion error={reenviar.error} />}

      <button
        type="button"
        onClick={onReenviar}
        disabled={reenviar.isPending}
        data-testid="reenviar-liquidacion"
        className={claseBotonSecundario}
      >
        {reenviar.isPending ? (
          <Loader2 aria-hidden className="size-5 animate-spin" />
        ) : (
          <RefreshCw aria-hidden className="size-5" />
        )}
        {reenviar.isPending ? 'Reenviando…' : 'Reenviar factura de liquidación'}
      </button>
    </div>
  );
};
