import { useState } from 'react';
import { notify } from '@/lib/notify';
import {
  AlertTriangle,
  CheckCircle2,
  Info,
  Loader2,
  RefreshCw,
  ShieldCheck,
  Undo2,
  Upload,
} from 'lucide-react';
import { useDevolverFianza } from '../api/useDevolverFianza';
import { formatearEuros } from '../lib/dinero';
import { formatearFechaHora } from '../lib/fecha';
import { SubirComprobanteFianzaDialog } from './SubirComprobanteFianzaDialog';
import { AvisoErrorDevolucionFianza } from './AvisoErrorDevolucionFianza';
import type { DevolverFianzaAvisoEmail, FianzaStatus } from '../model/types';

/**
 * Tarjeta "Fianza" (fix-liquidacion-fianza-independientes), sección **pasiva** espejo de
 * `CondicionesFirmadasCard`. La fianza deja de ser una factura: el gestor sube el comprobante
 * de la transferencia recibida. Estados de la UI según `fianzaStatus`:
 *  1. **pendiente** (sin comprobante): aviso no bloqueante (OPCIONAL, no bloquea el evento) +
 *     acción "Subir comprobante de fianza".
 *  2. **cobrada** (comprobante recibido): resumen con `fianzaComprobanteFecha`, permite
 *     re-subir; y, en `post_evento`, la acción **Devolver fianza** (devolución completa +
 *     email E10 best-effort).
 *  3. **devuelta**: resumen final (irreversible) con `fianzaDevueltaFecha`.
 *
 * El montaje lo decide `SeccionesFicha` (de `reserva_confirmada` a `post_evento`). El backend
 * revalida (422 estado / 409 precondición). Mobile-first: sin overflow horizontal, botón
 * `w-full` en móvil y `sm:w-auto`, objetivos táctiles ≥ 48px.
 */
type Props = {
  reservaId: string;
  /** `RESERVA.estado` — habilita "Devolver fianza" solo en `post_evento`. */
  estado?: string;
  /** `RESERVA.fianzaStatus` — pendiente | cobrada | devuelta. */
  fianzaStatus?: FianzaStatus;
  /** `RESERVA.fianzaEur` — importe de la fianza (se muestra en el resumen). */
  fianzaEur?: string | null;
  /** `RESERVA.fianzaComprobanteFecha` — timestamp del registro del comprobante. */
  fianzaComprobanteFecha?: string | null;
  /** `RESERVA.fianzaDevueltaFecha` — timestamp de la devolución. */
  fianzaDevueltaFecha?: string | null;
};

const claseSeccion =
  'flex flex-col gap-6 rounded-[20px] border border-border-default/20 bg-surface-subtle/30 p-4 sm:p-6 lg:p-8';

const claseBotonPrimario =
  'inline-flex h-12 w-full items-center justify-center gap-2 rounded-full bg-brand-primary px-8 font-display text-base text-brand-foreground transition hover:opacity-95 disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto';

const claseBotonSecundario =
  'inline-flex h-12 w-full items-center justify-center gap-2 rounded-full border border-border-default bg-canvas px-8 font-body text-base font-medium text-text-secondary transition hover:bg-surface-muted disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto';

export const FianzaComprobanteCard = ({
  reservaId,
  estado,
  fianzaStatus,
  fianzaEur,
  fianzaComprobanteFecha,
  fianzaDevueltaFecha,
}: Props) => {
  const [abierto, setAbierto] = useState(false);
  const [avisoEmail, setAvisoEmail] = useState<DevolverFianzaAvisoEmail | null>(null);
  const devolver = useDevolverFianza();

  const cobrada = fianzaStatus === 'cobrada';
  const devuelta = fianzaStatus === 'devuelta';

  const onDevolver = () => {
    setAvisoEmail(null);
    devolver.mutate(
      { reservaId },
      {
        onSuccess: ({ avisoEmail: aviso }) => {
          if (aviso) {
            setAvisoEmail(aviso);
          } else {
            notify.success('Fianza marcada como devuelta y confirmada al cliente por email.');
          }
        },
      },
    );
  };

  return (
    <section className={claseSeccion} aria-labelledby="ficha-fianza-comprobante">
      <div id="ficha-fianza-comprobante" className="flex items-center gap-3">
        <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-brand-primary/10 text-brand-primary">
          <ShieldCheck aria-hidden className="size-4" />
        </span>
        <h2 className="font-body text-xs font-bold uppercase tracking-[1.4px] text-text-secondary sm:text-sm">
          Fianza
        </h2>
      </div>

      {fianzaEur && (
        <dl className="flex flex-col gap-1">
          <dt className="font-body text-xs text-text-secondary">Importe de la fianza</dt>
          <dd
            data-testid="fianza-importe"
            className="font-display text-base font-semibold text-text-primary"
          >
            {formatearEuros(fianzaEur)}
          </dd>
        </dl>
      )}

      {devuelta ? (
        <p
          role="status"
          data-testid="fianza-devuelta-resumen"
          className="flex items-start gap-3 rounded-[16px] border border-emerald-200 bg-emerald-50 p-4 font-body text-sm text-emerald-800"
        >
          <CheckCircle2 aria-hidden className="mt-0.5 size-5 shrink-0 text-emerald-600" />
          <span>
            Fianza <strong>devuelta</strong>
            {fianzaDevueltaFecha && (
              <>
                {' '}el <strong>{formatearFechaHora(fianzaDevueltaFecha)}</strong>
              </>
            )}
            . La devolución quedó registrada y confirmada al cliente.
          </span>
        </p>
      ) : cobrada ? (
        <>
          <p
            role="status"
            data-testid="fianza-comprobante-resumen"
            className="flex items-start gap-3 rounded-[16px] border border-emerald-200 bg-emerald-50 p-4 font-body text-sm text-emerald-800"
          >
            <CheckCircle2 aria-hidden className="mt-0.5 size-5 shrink-0 text-emerald-600" />
            <span>
              Comprobante de fianza <strong>recibido</strong>
              {fianzaComprobanteFecha && (
                <>
                  {' '}el <strong>{formatearFechaHora(fianzaComprobanteFecha)}</strong>
                </>
              )}
              . El comprobante queda registrado en la reserva.
            </span>
          </p>

          <p className="font-body text-sm text-text-secondary">
            Si dispones de una versión más legible del comprobante, puedes volver a subirla. Se
            conservará el histórico y la más reciente será la de referencia.
          </p>

          {avisoEmail && (
            <p
              role="alert"
              data-testid="fianza-aviso-email"
              className="flex items-start gap-3 rounded-[16px] border border-amber-200 bg-amber-50 p-4 font-body text-sm text-amber-900"
            >
              <AlertTriangle aria-hidden className="mt-0.5 size-5 shrink-0 text-amber-600" />
              <span>{avisoEmail.mensaje}</span>
            </p>
          )}

          {devolver.error && <AvisoErrorDevolucionFianza error={devolver.error} />}

          <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:justify-end">
            <button
              type="button"
              onClick={() => setAbierto(true)}
              data-testid="accion-resubir-comprobante-fianza"
              className={claseBotonSecundario}
            >
              <RefreshCw aria-hidden className="size-5" />
              Subir nuevo comprobante
            </button>

            {estado === 'post_evento' && (
              <button
                type="button"
                onClick={onDevolver}
                disabled={devolver.isPending}
                data-testid="accion-devolver-fianza"
                className={claseBotonPrimario}
              >
                {devolver.isPending ? (
                  <Loader2 aria-hidden className="size-5 animate-spin" />
                ) : (
                  <Undo2 aria-hidden className="size-5" />
                )}
                {devolver.isPending ? 'Registrando…' : 'Devolver fianza'}
              </button>
            )}
          </div>
        </>
      ) : (
        <>
          <p
            role="status"
            data-testid="fianza-sin-comprobante"
            className="flex items-start gap-3 rounded-[16px] border border-amber-200 bg-amber-50 p-4 font-body text-sm text-amber-900"
          >
            <Info aria-hidden className="mt-0.5 size-5 shrink-0 text-amber-600" />
            <span>
              <strong>Comprobante de fianza pendiente</strong>. Sube el comprobante de la
              transferencia cuando la recibas. Es opcional y no bloquea el inicio del evento.
            </span>
          </p>

          <div className="flex justify-end">
            <button
              type="button"
              onClick={() => setAbierto(true)}
              data-testid="accion-subir-comprobante-fianza"
              className={claseBotonPrimario}
            >
              <Upload aria-hidden className="size-5" />
              Subir comprobante de fianza
            </button>
          </div>
        </>
      )}

      <SubirComprobanteFianzaDialog
        reservaId={reservaId}
        yaSubido={cobrada}
        abierto={abierto}
        onAbiertoChange={setAbierto}
        onSubido={() => {
          notify.success(
            cobrada
              ? 'Nuevo comprobante de fianza registrado.'
              : 'Comprobante de fianza registrado correctamente.',
          );
        }}
      />
    </section>
  );
};
