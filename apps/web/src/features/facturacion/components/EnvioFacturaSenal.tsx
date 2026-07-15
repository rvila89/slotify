import { CheckCircle2, Loader2, Send } from 'lucide-react';
import { toast } from 'sonner';
import { useEnviarFacturaSenal } from '../api/useEnviarFacturaSenal';
import { AvisoErrorEnvioSenal } from './AvisoErrorEnvioSenal';
import { AccionReenviarE3 } from './AccionReenviarE3';

/**
 * Bloque de la acción **Enviar factura 40%** (rebanada 6.4b) dentro de la tarjeta de factura
 * de señal, cuando la factura está emitida (`estado='enviada'`). Remite al cliente la factura
 * de señal + las condicions particulars por email E3 (`useEnviarFacturaSenal`).
 *
 * Estados y feedback (patrón de las acciones hermanas de facturación):
 *  - Carga: botón deshabilitado + spinner "Enviando…".
 *  - Éxito: toast de confirmación; si `condPartAdjuntada=false` avisa que el email salió sin las
 *    condiciones (tenant sin condiciones configuradas o fallo de render).
 *  - Error: 409 `E3_YA_ENVIADO` → info "ya enviado" (idempotente, sin re-envío); 502
 *    `EMISION_ENVIO_FALLIDO` → advertencia reintentable (rollback total); resto → error. El
 *    detalle inline se muestra con `AvisoErrorEnvioSenal`.
 *
 * Junto a "Enviar factura 40%" se ofrece la acción dedicada **Reenviar E3** (US-023 · GAP 3,
 * `AccionReenviarE3`), espejo de "Reenviar factura de liquidación" (E4): vuelve a remitir la
 * factura de señal + condiciones ya emitidas. Es intencionada y explícita (el re-disparo del envío
 * inicial devuelve 409 `E3_YA_ENVIADO`); el backend resuelve si hay un E3 previo que reenviar (si no
 * → 409 `E3_NO_ENVIADO_PREVIAMENTE`).
 *
 * Mobile-first: los botones ocupan el ancho completo en `<sm` y ancho automático en `sm:`, con
 * objetivo táctil de 44px (`h-11`); apilan en columna en `<sm` sin overflow horizontal.
 */
type Props = {
  /** ID de la RESERVA sobre la que se envía la factura de señal (path del endpoint). */
  reservaId: string;
};

const claseBotonPrimario =
  'inline-flex h-11 w-full items-center justify-center gap-2 rounded-full bg-brand-primary px-6 font-display text-sm text-brand-foreground transition hover:opacity-95 disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto';

export const EnvioFacturaSenal = ({ reservaId }: Props) => {
  const enviarSenal = useEnviarFacturaSenal();

  const onEnviarSenal = () => {
    enviarSenal.mutate(
      { reservaId },
      {
        onSuccess: ({ condPartAdjuntada }) => {
          if (condPartAdjuntada) {
            toast.success('Factura de señal enviada al cliente con las condiciones particulares.');
          } else {
            toast.warning('Factura de señal enviada al cliente.', {
              description:
                'No se adjuntaron las condiciones particulares (sin condiciones configuradas o fallo al generarlas). Revísalo si el cliente debe recibirlas.',
            });
          }
        },
        onError: (error) => {
          // 502 (recuperable) y 409 "ya enviado" se avisan sin alarmar; el resto como error.
          if (error.tipo === 'envio-fallido') {
            toast.warning('Error de envío, reintenta', { description: error.mensaje });
          } else if (error.tipo === 'ya-enviado') {
            toast.info(error.mensaje);
          } else {
            toast.error(error.mensaje);
          }
        },
      },
    );
  };

  return (
    <div className="flex flex-col gap-4">
      <p
        role="status"
        data-testid="aviso-factura-enviada"
        className="flex items-start gap-2 rounded-[16px] border border-emerald-200 bg-emerald-50 p-4 font-body text-sm text-emerald-800"
      >
        <CheckCircle2 aria-hidden className="mt-0.5 size-4 shrink-0 text-emerald-600" />
        Factura aprobada y lista para enviarse al cliente con las condiciones particulares.
      </p>

      {enviarSenal.error && <AvisoErrorEnvioSenal error={enviarSenal.error} />}

      <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-start">
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

        {/* Reenvío intencionado de E3 (US-023 · GAP 3), espejo de "Reenviar liquidación" (E4). */}
        <AccionReenviarE3 reservaId={reservaId} />
      </div>
    </div>
  );
};
