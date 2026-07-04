import { useState } from 'react';
import { Receipt, RefreshCw, Send } from 'lucide-react';
import { useReenviarLiquidacion } from '../api/useReenviarLiquidacion';
import { estadoVisualFactura } from '../lib/estado';
import { EstadoFacturaBadge } from './EstadoFacturaBadge';
import { FacturaBorradorCard } from './FacturaBorradorCard';
import { FacturaEmitidaResumen } from './FacturaEmitidaResumen';
import { AprobarEnviarLiquidacionDialog } from './AprobarEnviarLiquidacionDialog';
import { AvisoErrorLiquidacion } from './AvisoErrorLiquidacion';
import type { Factura } from '../model/types';

/**
 * Card de la **factura de liquidación** en la ficha de la reserva (US-028 · UC-21). Gobierna
 * las dos fases según el estado de la factura:
 *  - `borrador`: muestra el desglose (`FacturaBorradorCard`) y la acción "Aprobar y enviar",
 *    que abre el editor con descuento negociado (`AprobarEnviarLiquidacionDialog`). Solo se
 *    habilita si el borrador es válido (datos fiscales + PDF); el servidor revalida.
 *  - `enviada`: muestra el resumen emitido (`numeroFactura`, total, aviso de envío al cliente,
 *    PDF) y la acción "Reenviar factura de liquidación".
 *
 * Mobile-first: el contenedor es fluido; las acciones son botones a ancho completo en `<sm`.
 */
type Props = {
  liquidacion: Factura;
  /** `true` si el recibo de fianza sigue en borrador (se emitirá junto con la liquidación). */
  fianzaPendiente: boolean;
};

const claseBotonPrimario =
  'inline-flex h-12 w-full items-center justify-center gap-2 rounded-full bg-brand-primary px-6 font-display text-base text-brand-foreground transition hover:opacity-95 disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto';

const claseBotonSecundario =
  'inline-flex h-12 w-full items-center justify-center gap-2 rounded-full border border-border-default bg-canvas px-6 font-body text-base font-medium text-text-secondary transition hover:bg-surface-muted disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto';

export const FacturaLiquidacionCard = ({ liquidacion, fianzaPendiente }: Props) => {
  const [editorAbierto, setEditorAbierto] = useState(false);
  const reenviar = useReenviarLiquidacion();

  const emitida = liquidacion.estado !== 'borrador';
  const puedeAprobar = estadoVisualFactura(liquidacion) === 'borrador';

  const onReenviar = () => {
    reenviar.mutate({ reservaId: liquidacion.reservaId });
  };

  return (
    <article
      data-testid="factura-liquidacion-card"
      data-estado={liquidacion.estado}
      className="flex flex-col gap-4 rounded-[16px] border border-border-default/40 bg-canvas p-4 sm:p-5"
    >
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-brand-primary/10 text-brand-primary">
            <Receipt aria-hidden className="size-4" />
          </span>
          <h3 className="font-body text-sm font-semibold text-text-primary">
            Factura de liquidación
          </h3>
        </div>
        <EstadoFacturaBadge factura={liquidacion} />
      </header>

      {emitida ? (
        <FacturaEmitidaResumen factura={liquidacion}>
          {reenviar.error && <AvisoErrorLiquidacion error={reenviar.error} />}
          {reenviar.isSuccess && !reenviar.error && (
            <p
              role="status"
              data-testid="reenvio-confirmado"
              className="font-body text-sm text-emerald-700"
            >
              Factura reenviada al cliente correctamente.
            </p>
          )}
          <button
            type="button"
            onClick={onReenviar}
            disabled={reenviar.isPending}
            data-testid="reenviar-liquidacion"
            className={claseBotonSecundario}
          >
            <RefreshCw aria-hidden className="size-5" />
            {reenviar.isPending ? 'Reenviando…' : 'Reenviar factura de liquidación'}
          </button>
        </FacturaEmitidaResumen>
      ) : (
        <>
          <FacturaBorradorCard factura={liquidacion} />
          <button
            type="button"
            onClick={() => setEditorAbierto(true)}
            disabled={!puedeAprobar}
            data-testid="abrir-aprobar-enviar"
            className={claseBotonPrimario}
          >
            <Send aria-hidden className="size-5" />
            Aprobar y enviar
          </button>
          {!puedeAprobar && (
            <p className="font-body text-xs text-text-secondary">
              Completa los datos fiscales del cliente y el PDF del borrador para poder emitir la
              factura.
            </p>
          )}
          <AprobarEnviarLiquidacionDialog
            liquidacion={liquidacion}
            fianzaPendiente={fianzaPendiente}
            abierto={editorAbierto}
            onAbiertoChange={setEditorAbierto}
          />
        </>
      )}
    </article>
  );
};
