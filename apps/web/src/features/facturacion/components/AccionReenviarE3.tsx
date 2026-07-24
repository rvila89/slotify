import { Loader2, RefreshCw } from 'lucide-react';
import { notify } from '@/lib/notify';
import { useReenviarE3 } from '../api/useReenviarE3';
import { AvisoErrorReenvioE3 } from './AvisoErrorReenvioE3';

/**
 * Acción **Reenviar E3** (US-023 · GAP 3 · design.md §D-reenvio-e3), espejo de la acción "Reenviar
 * factura de liquidación" (E4). Vuelve a remitir al cliente la factura de señal ya emitida junto con
 * las condiciones particulares (`useReenviarE3`, endpoint `POST .../facturas/senal/reenviar`).
 *
 * Estados y feedback (patrón de las acciones hermanas de facturación):
 *  - Carga: botón deshabilitado + spinner "Reenviando…".
 *  - Éxito (200): toast "E3 reenviado" (las queries de facturas se invalidan en el hook).
 *  - Error:
 *      - 409 `E3_NO_ENVIADO_PREVIAMENTE` → info "No hay un E3 enviado previamente que reenviar".
 *      - 502/503 `EMISION_ENVIO_FALLIDO` → advertencia reintentable (rollback total).
 *      - resto → error. El detalle inline lo muestra `AvisoErrorReenvioE3`.
 *
 * Mobile-first: el botón ocupa el ancho completo en `<sm` y ancho automático en `sm:`, con objetivo
 * táctil de 44px (`h-11`); sin overflow horizontal.
 */
type Props = {
  /** ID de la RESERVA sobre la que se reenvía E3 (path del endpoint). */
  reservaId: string;
};

const claseBotonSecundario =
  'inline-flex h-11 w-full items-center justify-center gap-2 rounded-full border border-border-default bg-canvas px-6 font-body text-sm font-medium text-text-secondary transition hover:bg-surface-muted disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto';

export const AccionReenviarE3 = ({ reservaId }: Props) => {
  const reenviar = useReenviarE3();

  const onReenviar = () => {
    reenviar.mutate(
      { reservaId },
      {
        onSuccess: () => {
          notify.success('E3 reenviado al cliente.');
        },
        onError: (error) => {
          if (error.tipo === 'envio-fallido') {
            notify.warning('Error de reenvío, reintenta', { description: error.mensaje });
          } else if (error.tipo === 'no-enviado-previamente') {
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
      {reenviar.error && <AvisoErrorReenvioE3 error={reenviar.error} />}

      <button
        type="button"
        onClick={onReenviar}
        disabled={reenviar.isPending}
        data-testid="reenviar-e3"
        className={claseBotonSecundario}
      >
        {reenviar.isPending ? (
          <Loader2 aria-hidden className="size-5 animate-spin" />
        ) : (
          <RefreshCw aria-hidden className="size-5" />
        )}
        {reenviar.isPending ? 'Reenviando…' : 'Reenviar E3'}
      </button>
    </div>
  );
};
