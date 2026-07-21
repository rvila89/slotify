import { Loader2, Send } from 'lucide-react';
import { notify } from '@/lib/notify';
import { useEnviarFacturaSenal } from '../api/useEnviarFacturaSenal';
import { AvisoErrorEnvioSenal } from './AvisoErrorEnvioSenal';
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
};

const claseBotonPrimario =
  'inline-flex h-11 w-full items-center justify-center gap-2 rounded-full bg-brand-primary px-6 font-display text-sm text-brand-foreground transition hover:opacity-95 disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto';

export const EnvioFacturaSenal = ({ reservaId, e3Enviado }: Props) => {
  const enviarSenal = useEnviarFacturaSenal();

  const onEnviarSenal = () => {
    enviarSenal.mutate(
      { reservaId },
      {
        onSuccess: () => {
          // Desde el change condiciones-idioma-e2-firma-banner las condiciones particulares
          // se adjuntan en E2 (confirmar presupuesto), no en E3; E3 solo emite la factura de señal.
          notify.success('Factura de señal enviada al cliente.');
        },
        onError: (error) => {
          // 502 (recuperable) y 409 "ya enviado" se avisan sin alarmar; el resto como error.
          if (error.tipo === 'envio-fallido') {
            notify.warning('Error de envío, reintenta', { description: error.mensaje });
          } else if (error.tipo === 'ya-enviado') {
            notify.info(error.mensaje);
          } else {
            notify.error(error.mensaje);
          }
        },
      },
    );
  };

  return (
    <div className="flex flex-col gap-4">
      {enviarSenal.error && <AvisoErrorEnvioSenal error={enviarSenal.error} />}

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
