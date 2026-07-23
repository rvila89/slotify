import { useState } from 'react';
import { AlertTriangle, Info, Loader2, Send, X } from 'lucide-react';
import { useEnviarFacturaSenal } from '../api/useEnviarFacturaSenal';
import { AccionReenviarE3 } from './AccionReenviarE3';

/**
 * Bloque de la acción **Enviar factura 40%** (rebanada 6.4b) dentro de la tarjeta de factura
 * de señal, cuando la factura está emitida (`estado='enviada'`). Remite al cliente la factura
 * de señal por email (`useEnviarFacturaSenal`). Desde el change
 * `condiciones-idioma-e2-firma-banner` las condicions particulars se adjuntan en E2 (confirmar
 * presupuesto), no en este envío.
 *
 * Estados y feedback (patrón de las acciones hermanas de facturación):
 *  - Carga: botón deshabilitado + spinner "Enviando…".
 *  - Éxito: toast de confirmación del envío de la factura de señal.
 *  - Error: 409 `E3_YA_ENVIADO` → info "ya enviado" (idempotente, sin re-envío); 502
 *    `EMISION_ENVIO_FALLIDO` → advertencia reintentable (rollback total); resto → error. El
 *    detalle inline se muestra con `AvisoErrorEnvioSenal`.
 *
 * La acción visible depende del flag DERIVADO `e3Enviado` de la factura de señal:
 *  - `e3Enviado === false`: sólo el botón **Enviar factura 40%** (envío inicial).
 *  - `e3Enviado === true`: sólo la acción dedicada **Reenviar E3** (US-023 · GAP 3,
 *    `AccionReenviarE3`), espejo de "Reenviar factura de liquidación" (E4): vuelve a remitir la
 *    factura de señal + condiciones ya emitidas. El envío inicial ya no se ofrece (el backend
 *    devolvería 409 `E3_YA_ENVIADO`); el reenvío es intencionado y explícito.
 *
 * Mobile-first: los botones ocupan el ancho completo en `<sm` y ancho automático en `sm:`, con
 * objetivo táctil de 44px (`h-11`); apilan en columna en `<sm` sin overflow horizontal.
 */
type Props = {
  /** ID de la RESERVA sobre la que se envía la factura de señal (path del endpoint). */
  reservaId: string;
  /**
   * Flag DERIVADO de la factura de señal: `true` cuando ya se envió el email E3 inicial. Determina
   * qué acción se muestra (enviar vs. reenviar), nunca ambas a la vez.
   */
  e3Enviado: boolean;
  /** Callback invocado tras un envío exitoso; la página muestra el banner arriba + scroll. */
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

export const EnvioFacturaSenal = ({ reservaId, e3Enviado, onEnviada }: Props) => {
  const enviarSenal = useEnviarFacturaSenal();
  const [resultado, setResultado] = useState<ResultadoEnvio | null>(null);

  const onEnviarSenal = () => {
    setResultado(null);
    enviarSenal.mutate(
      { reservaId },
      {
        onSuccess: () => {
          setResultado(null);
          onEnviada?.();
        },
        onError: (error) => {
          window.scrollTo({ top: 0, behavior: 'smooth' });
          if (error.tipo === 'envio-fallido') {
            setResultado({ tipo: 'error-envio', mensaje: error.mensaje });
          } else if (error.tipo === 'ya-enviado') {
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
          role={resultado.tipo === 'exito' ? 'status' : 'alert'}
          data-testid="banner-resultado-envio"
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
        {e3Enviado ? (
          /* Ya enviado: sólo el reenvío intencionado de E3 (US-023 · GAP 3), espejo de "Reenviar liquidación" (E4). */
          <AccionReenviarE3 reservaId={reservaId} />
        ) : (
          <button
            type="button"
            onClick={onEnviarSenal}
            disabled={enviarSenal.isPending}
            data-testid="enviar-factura-senal"
            className={claseBotonPrimario}
          >
            {enviarSenal.isPending ? (
              <Loader2 aria-hidden className="size-5 animate-spin" />
            ) : (
              <Send aria-hidden className="size-5" />
            )}
            {enviarSenal.isPending ? 'Enviando…' : 'Enviar factura 40%'}
          </button>
        )}
      </div>
    </div>
  );
};
