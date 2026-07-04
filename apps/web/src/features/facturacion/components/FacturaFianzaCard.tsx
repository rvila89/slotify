import { useState } from 'react';
import { Send, ShieldCheck } from 'lucide-react';
import { estadoVisualFactura } from '../lib/estado';
import { EstadoFacturaBadge } from './EstadoFacturaBadge';
import { FacturaBorradorCard } from './FacturaBorradorCard';
import { FacturaEmitidaResumen } from './FacturaEmitidaResumen';
import { EnviarReciboFianzaDialog } from './EnviarReciboFianzaDialog';
import type { Factura } from '../model/types';

/**
 * Card del **recibo de fianza** en la ficha de la reserva (US-028 · D-3). Gobierna las dos
 * fases:
 *  - `borrador`: muestra el desglose (`FacturaBorradorCard`) y la acción "Enviar recibo de
 *    fianza por separado" (edge case sin liquidación). El envío conjunto con la liquidación se
 *    dispara desde la card de liquidación; esta acción es el envío independiente del recibo.
 *  - `enviada`: muestra el resumen emitido (número, total, aviso de envío, PDF). Cuando la
 *    fianza se emite junto a la liquidación (E4) la card también entra en este estado.
 *
 * Mobile-first: contenedor fluido; la acción es un botón a ancho completo en `<sm`.
 */
type Props = {
  fianza: Factura;
};

const claseBotonSecundario =
  'inline-flex h-12 w-full items-center justify-center gap-2 rounded-full border border-border-default bg-canvas px-6 font-body text-base font-medium text-text-secondary transition hover:bg-surface-muted disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto';

export const FacturaFianzaCard = ({ fianza }: Props) => {
  const [dialogoAbierto, setDialogoAbierto] = useState(false);

  const emitida = fianza.estado !== 'borrador';
  const puedeEnviar = estadoVisualFactura(fianza) === 'borrador';

  return (
    <article
      data-testid="factura-fianza-card"
      data-estado={fianza.estado}
      className="flex flex-col gap-4 rounded-[16px] border border-border-default/40 bg-canvas p-4 sm:p-5"
    >
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-brand-primary/10 text-brand-primary">
            <ShieldCheck aria-hidden className="size-4" />
          </span>
          <h3 className="font-body text-sm font-semibold text-text-primary">Recibo de fianza</h3>
        </div>
        <EstadoFacturaBadge factura={fianza} />
      </header>

      {emitida ? (
        <FacturaEmitidaResumen factura={fianza} />
      ) : (
        <>
          <FacturaBorradorCard factura={fianza} />
          <button
            type="button"
            onClick={() => setDialogoAbierto(true)}
            disabled={!puedeEnviar}
            data-testid="abrir-enviar-fianza"
            className={claseBotonSecundario}
          >
            <Send aria-hidden className="size-5" />
            Enviar recibo de fianza por separado
          </button>
          {!puedeEnviar && (
            <p className="font-body text-xs text-text-secondary">
              Completa los datos fiscales del cliente y el PDF del recibo para poder enviarlo.
            </p>
          )}
          <EnviarReciboFianzaDialog
            fianza={fianza}
            abierto={dialogoAbierto}
            onAbiertoChange={setDialogoAbierto}
          />
        </>
      )}
    </article>
  );
};
