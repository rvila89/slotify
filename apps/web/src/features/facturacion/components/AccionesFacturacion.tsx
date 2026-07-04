import { useState } from 'react';
import { RefreshCw, Send, ShieldCheck } from 'lucide-react';
import { useReenviarLiquidacion } from '../api/useReenviarLiquidacion';
import { toastLiquidacionError, toastLiquidacionExito } from '../lib/toastLiquidacion';
import { AprobarEnviarLiquidacionDialog } from './AprobarEnviarLiquidacionDialog';
import { EnviarReciboFianzaDialog } from './EnviarReciboFianzaDialog';
import type { Factura, FianzaStatus, LiquidacionStatus } from '../model/types';

/**
 * Panel de **acciones de facturación** del Gestor sobre la factura de liquidación de una
 * RESERVA (US-028 · UC-21/UC-22). Consolida en un único componente las tres acciones y su
 * feedback (toasts con `sonner`), habilitando cada botón por el status de la reserva:
 *  - "Aprobar y enviar factura" → activo solo si `liquidacionStatus === 'pendiente'`. Abre el
 *    editor con descuento negociado (`AprobarEnviarLiquidacionDialog`), que emite la factura de
 *    forma atómica estado↔email (E4 con ambos PDFs).
 *  - "Enviar recibo de fianza" → activo solo si `fianzaStatus === 'pendiente'`. Abre el diálogo
 *    de envío separado del recibo de fianza (`EnviarReciboFianzaDialog`), edge case sin liquidación.
 *  - "Reenviar factura" → activo solo si `liquidacionStatus === 'facturada'`. Reenvía el PDF ya
 *    emitido sin reasignar número ni cambiar estados.
 *
 * Feedback: éxito → toast de confirmación; error → toast (409 mensaje descriptivo, 502/503
 * "Error de envío, reintenta") vía `toastLiquidacion`. El detalle inline por diálogo se mantiene.
 *
 * Diseño: sin frame propio en el archivo Figma "Slotify" para US-028; se ADAPTA con los tokens
 * del proyecto (cream/brand/sand/ink) reutilizando el tratamiento de los diálogos de facturación
 * (US-022). Mobile-first: los botones apilan en columna a ancho completo en `<lg` y pasan a fila
 * con ancho automático en `lg:`; objetivos táctiles ≥ 44px; sin overflow horizontal.
 */
type Props = {
  /** ID de la RESERVA sobre la que actúa el panel (path de los endpoints). */
  reservaId: string;
  /** Sub-proceso de liquidación de la RESERVA; gobierna "Aprobar y enviar" y "Reenviar". */
  liquidacionStatus: LiquidacionStatus;
  /** Sub-proceso de fianza de la RESERVA; gobierna "Enviar recibo de fianza". */
  fianzaStatus: FianzaStatus;
  /** Borrador de la factura de liquidación (para el editor de descuento). */
  liquidacion?: Factura;
  /** Borrador del recibo de fianza (para el diálogo de envío separado). */
  fianza?: Factura;
};

const claseBotonPrimario =
  'inline-flex h-12 w-full items-center justify-center gap-2 rounded-full bg-brand-primary px-6 font-display text-base text-brand-foreground transition hover:opacity-95 disabled:cursor-not-allowed disabled:opacity-60 lg:w-auto';

const claseBotonSecundario =
  'inline-flex h-12 w-full items-center justify-center gap-2 rounded-full border border-border-default bg-canvas px-6 font-body text-base font-medium text-text-secondary transition hover:bg-surface-muted disabled:cursor-not-allowed disabled:opacity-60 lg:w-auto';

export const AccionesFacturacion = ({
  reservaId,
  liquidacionStatus,
  fianzaStatus,
  liquidacion,
  fianza,
}: Props) => {
  const [editorAbierto, setEditorAbierto] = useState(false);
  const [fianzaAbierta, setFianzaAbierta] = useState(false);
  const reenviar = useReenviarLiquidacion();

  // Habilitación por status de la reserva (espejo de las guardas del backend; el servidor
  // revalida). El editor/diálogo además requiere el borrador correspondiente disponible.
  const puedeAprobar = liquidacionStatus === 'pendiente' && Boolean(liquidacion);
  const puedeReenviar = liquidacionStatus === 'facturada';
  const puedeEnviarFianza = fianzaStatus === 'pendiente' && Boolean(fianza);
  const fianzaPendiente = fianzaStatus === 'pendiente';

  const onReenviar = () => {
    reenviar.mutate(
      { reservaId },
      {
        onSuccess: () => toastLiquidacionExito('Factura reenviada al cliente correctamente.'),
        onError: (error) => toastLiquidacionError(error),
      },
    );
  };

  return (
    <div
      data-testid="acciones-facturacion"
      className="flex flex-col gap-3 lg:flex-row lg:flex-wrap lg:items-center"
    >
      <button
        type="button"
        onClick={() => setEditorAbierto(true)}
        disabled={!puedeAprobar}
        data-testid="accion-aprobar-enviar"
        className={claseBotonPrimario}
      >
        <Send aria-hidden className="size-5" />
        Aprobar y enviar factura
      </button>

      <button
        type="button"
        onClick={() => setFianzaAbierta(true)}
        disabled={!puedeEnviarFianza}
        data-testid="accion-enviar-fianza"
        className={claseBotonSecundario}
      >
        <ShieldCheck aria-hidden className="size-5" />
        Enviar recibo de fianza
      </button>

      <button
        type="button"
        onClick={onReenviar}
        disabled={!puedeReenviar || reenviar.isPending}
        data-testid="accion-reenviar"
        className={claseBotonSecundario}
      >
        <RefreshCw aria-hidden className="size-5" />
        {reenviar.isPending ? 'Reenviando…' : 'Reenviar factura'}
      </button>

      {liquidacion && (
        <AprobarEnviarLiquidacionDialog
          liquidacion={liquidacion}
          fianzaPendiente={fianzaPendiente}
          abierto={editorAbierto}
          onAbiertoChange={setEditorAbierto}
          onEmitido={() =>
            toastLiquidacionExito('Factura de liquidación emitida y enviada al cliente.')
          }
        />
      )}

      {fianza && (
        <EnviarReciboFianzaDialog
          fianza={fianza}
          abierto={fianzaAbierta}
          onAbiertoChange={setFianzaAbierta}
          onEnviado={() => toastLiquidacionExito('Recibo de fianza enviado al cliente.')}
        />
      )}
    </div>
  );
};
