import { useState } from 'react';
import { AlertTriangle, Info, Loader2, Send, X } from 'lucide-react';
import { useEnviarFacturaLiquidacion } from '../api/useEnviarFacturaLiquidacion';
import { AccionReenviarE4 } from './AccionReenviarE4';

/**
 * Bloque de la acción **Aprobar y enviar liquidación** (E4, standalone) dentro de la tarjeta
 * de factura de liquidación, cuando el borrador es válido. Emite y remite la liquidación al
 * cliente por email (`useEnviarFacturaLiquidacion`). Espejo de `EnvioFacturaSenal`.
 *
 * Estados y feedback:
 *  - Carga: botón deshabilitado + spinner "Enviando…".
 *  - Éxito: la página muestra el banner permanente arriba (via `onEnviada`).
 *  - Error: 409 `factura-no-borrador` → info "ya emitida"; 502/503 `emision-envio-fallido` →
 *    advertencia reintentable (rollback total); resto → error.
 *
 * La acción visible depende del flag DERIVADO `e4Enviado`:
 *  - `e4Enviado === false`: botón **Aprobar y enviar liquidación** (envío inicial).
 *  - `e4Enviado === true`: acción dedicada **Reenviar factura de liquidación** (`AccionReenviarE4`).
 *
 * Mobile-first: los botones ocupan el ancho completo en `<sm` y ancho automático en `sm:`, con
 * objetivo táctil de 44px (`h-11`); apilan en columna en `<sm` sin overflow horizontal.
 */
type Props = {
  /** ID de la RESERVA sobre la que se emite/envía la liquidación (path del endpoint). */
  reservaId: string;
  /** Flag DERIVADO: `true` cuando ya se envió E4. Determina enviar vs. reenviar. */
  e4Enviado: boolean;
  /** Callback tras un envío exitoso; la página muestra el banner arriba + scroll. */
  onEnviada?: () => void;
};

const claseBotonPrimario =
  'inline-flex h-11 w-full items-center justify-center gap-2 rounded-full bg-accent-success px-6 font-display text-sm text-accent-success-foreground transition hover:opacity-95 disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto';

type TipoResultado = 'ya-enviado' | 'error-envio' | 'error';

interface ResultadoEnvio {
  tipo: TipoResultado;
  mensaje: string;
}

const claseBannerPorTipo: Record<TipoResultado, string> = {
  'ya-enviado': 'flex items-start gap-3 rounded-[16px] border border-blue-200 bg-blue-50 p-4 text-blue-800',
  'error-envio': 'flex items-start gap-3 rounded-[16px] border border-amber-200 bg-amber-50 p-4 text-amber-900',
  error: 'flex items-start gap-3 rounded-[16px] border border-red-200 bg-red-50 p-4 text-red-700',
};

const IconoBannerPorTipo = ({ tipo }: { tipo: TipoResultado }) => {
  if (tipo === 'ya-enviado') return <Info aria-hidden className="mt-0.5 size-5 shrink-0 text-blue-500" />;
  if (tipo === 'error-envio') return <AlertTriangle aria-hidden className="mt-0.5 size-5 shrink-0 text-amber-600" />;
  return <AlertTriangle aria-hidden className="mt-0.5 size-5 shrink-0 text-red-600" />;
};

export const EnvioFacturaLiquidacion = ({ reservaId, e4Enviado, onEnviada }: Props) => {
  const enviar = useEnviarFacturaLiquidacion();
  const [resultado, setResultado] = useState<ResultadoEnvio | null>(null);

  const onEnviar = () => {
    setResultado(null);
    enviar.mutate(
      { reservaId },
      {
        onSuccess: () => {
          setResultado(null);
          onEnviada?.();
        },
        onError: (error) => {
          window.scrollTo({ top: 0, behavior: 'smooth' });
          if (error.tipo === 'emision-envio-fallido') {
            setResultado({ tipo: 'error-envio', mensaje: error.mensaje });
          } else if (error.tipo === 'factura-no-borrador') {
            setResultado({ tipo: 'ya-enviado', mensaje: error.mensaje });
          } else {
            setResultado({ tipo: 'error', mensaje: error.mensaje });
          }
        },
      },
    );
  };

  return (
    <div className="flex flex-col gap-4">
      {resultado && (
        <div
          role="alert"
          data-testid="banner-resultado-envio-liquidacion"
          className={claseBannerPorTipo[resultado.tipo]}
        >
          <IconoBannerPorTipo tipo={resultado.tipo} />
          <p className="flex-1 font-body text-sm">{resultado.mensaje}</p>
          <button
            type="button"
            aria-label="Cerrar aviso"
            onClick={() => setResultado(null)}
            className="shrink-0 opacity-70 hover:opacity-100"
          >
            <X aria-hidden className="size-4" />
          </button>
        </div>
      )}

      <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-start">
        {e4Enviado ? (
          <AccionReenviarE4 reservaId={reservaId} />
        ) : (
          <button
            type="button"
            onClick={onEnviar}
            disabled={enviar.isPending}
            data-testid="enviar-factura-liquidacion"
            className={claseBotonPrimario}
          >
            {enviar.isPending ? (
              <Loader2 aria-hidden className="size-5 animate-spin" />
            ) : (
              <Send aria-hidden className="size-5" />
            )}
            {enviar.isPending ? 'Enviando…' : 'Aprobar y enviar liquidación'}
          </button>
        )}
      </div>
    </div>
  );
};
