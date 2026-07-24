import {
  AlertTriangle,
  CheckCircle2,
  FileText,
  Info,
  Loader2,
  Receipt,
  RefreshCw,
} from 'lucide-react';
import { useFacturaLiquidacion } from '../api/useFacturaLiquidacion';
import { useRegenerarPdf } from '../api/useRegenerarPdf';
import { formatearEuros, formatearPorcentaje } from '../lib/dinero';
import { formatearFechaHora } from '../lib/fecha';
import { estadoVisualFactura } from '../lib/estado';
import { AvisoErrorFactura } from './AvisoErrorFactura';
import { EnvioFacturaLiquidacion } from './EnvioFacturaLiquidacion';
import { EstadoFacturaBadge } from './EstadoFacturaBadge';
import type { FacturaLiquidacion } from '../model/types';

/**
 * Tarjeta "Factura de liquidación" (US-028 · UC-21, standalone tras
 * fix-liquidacion-fianza-independientes) para la ficha de una RESERVA en `reserva_confirmada`.
 * Se coloca **debajo** de la factura de señal y es su flujo espejo:
 *  - `borrador`: desglose fiscal + acción **Aprobar y enviar liquidación**.
 *  - `borrador-invalido` (`esBorradorInvalido`): aviso de datos fiscales incompletos, sin envío.
 *  - `pdf-pendiente` (`pdfPendiente`): aviso de PDF en proceso + Regenerar PDF, sin envío.
 *  - `enviada`: badge verde, banner permanente "Factura de liquidación enviada al cliente el
 *    {fecha/hora}" (`e4Enviado`), enlace al PDF y acción **Reenviar factura de liquidación**.
 *
 * La emisión (`useEnviarFacturaLiquidacion`) es atómica estado↔E4 (consolida solo si E4 se
 * confirma); un fallo 502 es reintentable. La fianza NO se toca aquí (sección aparte).
 *
 * Estado de servidor con TanStack Query sobre el SDK generado. Mobile-first: el desglose apila
 * en una columna en móvil y pasa a dos/tres columnas en `sm:`/`lg:`, las acciones apilan en
 * columna en `<sm` sin overflow horizontal.
 */
type Props = {
  reservaId: string;
  /** Callback tras emitir/enviar exitosamente la liquidación; la página muestra el banner arriba. */
  onEnviada?: () => void;
};

const claseBotonSecundario =
  'inline-flex h-11 w-full items-center justify-center gap-2 rounded-full border border-border-default bg-canvas px-6 font-body text-sm font-medium text-text-secondary transition hover:bg-surface-muted disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto';

const Encabezado = ({ factura }: { factura?: FacturaLiquidacion | null }) => (
  <div className="flex flex-wrap items-center justify-between gap-3">
    <div className="flex items-center gap-3">
      <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-brand-primary/10 text-brand-primary">
        <Receipt aria-hidden className="size-4" />
      </span>
      <h2 className="font-body text-xs font-bold uppercase tracking-[1.4px] text-text-secondary sm:text-sm">
        Factura de liquidación
      </h2>
    </div>
    {factura && <EstadoFacturaBadge factura={factura} />}
  </div>
);

const Desglose = ({ factura }: { factura: FacturaLiquidacion }) => (
  <dl
    data-testid="desglose-liquidacion"
    className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3"
  >
    <div className="flex flex-col">
      <dt className="font-body text-xs text-text-secondary">Base imponible</dt>
      <dd
        data-testid="liquidacion-base"
        className="font-display text-base font-semibold text-text-primary"
      >
        {formatearEuros(factura.baseImponible)}
      </dd>
    </div>
    <div className="flex flex-col">
      <dt className="font-body text-xs text-text-secondary">
        IVA ({formatearPorcentaje(factura.ivaPorcentaje)})
      </dt>
      <dd
        data-testid="liquidacion-iva"
        className="font-display text-base font-semibold text-text-primary"
      >
        {formatearEuros(factura.ivaImporte)}
      </dd>
    </div>
    <div className="flex flex-col">
      <dt className="font-body text-xs text-text-secondary">Total</dt>
      <dd
        data-testid="liquidacion-total"
        className="font-display text-base font-bold text-brand-primary"
      >
        {formatearEuros(factura.total)}
      </dd>
    </div>
  </dl>
);

const EnlacePdf = ({ url }: { url: string }) => (
  <a
    href={url}
    target="_blank"
    rel="noreferrer"
    data-testid="liquidacion-pdf-link"
    className="inline-flex w-fit items-center gap-2 font-body text-sm font-medium text-brand-primary underline underline-offset-2 transition hover:opacity-80"
  >
    <FileText aria-hidden className="size-4" />
    Ver PDF de la factura
  </a>
);

export const FacturaLiquidacionCard = ({ reservaId, onEnviada }: Props) => {
  const { data: factura, isLoading, isError } = useFacturaLiquidacion(reservaId);
  const regenerar = useRegenerarPdf();

  const claseSeccion =
    'flex flex-col gap-6 rounded-[20px] border border-border-default/20 bg-surface-subtle/30 p-4 sm:p-6 lg:p-8';

  if (isLoading) {
    return (
      <section className={claseSeccion} aria-labelledby="ficha-factura-liquidacion">
        <div id="ficha-factura-liquidacion">
          <Encabezado />
        </div>
        <p
          data-testid="liquidacion-cargando"
          className="flex items-center gap-2 font-body text-sm text-text-secondary"
        >
          <Loader2 aria-hidden className="size-4 animate-spin" />
          Cargando factura de liquidación…
        </p>
      </section>
    );
  }

  // 404 → `null`: el borrador aún no se ha materializado (disparo post-commit de US-027).
  if (!isError && !factura) {
    return (
      <section className={claseSeccion} aria-labelledby="ficha-factura-liquidacion">
        <div id="ficha-factura-liquidacion">
          <Encabezado />
        </div>
        <p
          role="status"
          data-testid="liquidacion-en-preparacion"
          className="flex items-start gap-2 rounded-[16px] border border-border-default/40 bg-surface-muted/40 p-4 font-body text-sm text-text-secondary"
        >
          <Info aria-hidden className="mt-0.5 size-4 shrink-0" />
          La factura de liquidación en borrador se está preparando; estará disponible para
          revisión en breve.
        </p>
      </section>
    );
  }

  if (isError || !factura) {
    return (
      <section className={claseSeccion} aria-labelledby="ficha-factura-liquidacion">
        <div id="ficha-factura-liquidacion">
          <Encabezado />
        </div>
        <p
          role="alert"
          data-testid="liquidacion-error"
          className="rounded-[16px] border border-red-200 bg-red-50 px-4 py-3 font-body text-sm text-red-700"
        >
          No se ha podido cargar la factura de liquidación. Inténtalo de nuevo.
        </p>
      </section>
    );
  }

  const estadoVisual = estadoVisualFactura(factura);

  const onRegenerar = () => {
    regenerar.mutate({ id: factura.idFactura, reservaId });
  };

  return (
    <section
      className={claseSeccion}
      aria-labelledby="ficha-factura-liquidacion"
      data-testid="factura-liquidacion-card"
      data-estado-visual={estadoVisual}
    >
      <div id="ficha-factura-liquidacion">
        <Encabezado factura={factura} />
      </div>

      <dl className="flex flex-col gap-1">
        <dt className="font-body text-xs text-text-secondary">Número de factura</dt>
        <dd
          data-testid="liquidacion-numero"
          className="font-body text-sm font-medium text-text-primary"
        >
          {factura.numeroFactura ?? 'Pendiente'}
        </dd>
      </dl>

      {factura.concepto && (
        <p className="font-body text-sm text-text-secondary">{factura.concepto}</p>
      )}

      <Desglose factura={factura} />

      {/* Borrador inválido: faltan datos fiscales del cliente. */}
      {estadoVisual === 'borrador-invalido' && (
        <div
          role="alert"
          data-testid="aviso-liquidacion-borrador-invalido"
          className="flex items-start gap-3 rounded-[16px] border border-red-200 bg-red-50 p-4 text-red-700"
        >
          <AlertTriangle aria-hidden className="mt-0.5 size-5 shrink-0 text-red-600" />
          <div className="flex flex-col gap-2 font-body text-sm">
            <p className="font-medium">
              Datos fiscales del cliente incompletos: no se puede emitir la factura.
            </p>
            <p className="text-red-600/90">
              Completa los datos fiscales del cliente (DNI/NIF y dirección fiscal). El envío queda
              bloqueado hasta que se completen.
            </p>
          </div>
        </div>
      )}

      {/* PDF pendiente: fallo transitorio; el sistema reintenta y se puede forzar. */}
      {estadoVisual === 'pdf-pendiente' && (
        <div
          role="status"
          data-testid="aviso-liquidacion-pdf-pendiente"
          className="flex items-start gap-3 rounded-[16px] border border-amber-200 bg-amber-50 p-4 text-amber-900"
        >
          <Info aria-hidden className="mt-0.5 size-5 shrink-0 text-amber-600" />
          <div className="flex flex-col gap-1 font-body text-sm">
            <p className="font-medium">El PDF de la factura se está generando.</p>
            <p className="text-amber-800/90">
              El envío queda bloqueado hasta que el PDF esté disponible. El sistema reintenta
              automáticamente; también puedes forzar la regeneración.
            </p>
          </div>
        </div>
      )}

      {/* Enviada (emitida): banner permanente + acción de reenvío. */}
      {estadoVisual === 'enviada' && (
        <>
          {factura.e4Enviado && (
            <p
              role="status"
              data-testid="aviso-factura-liquidacion-enviada"
              className="flex items-start gap-3 rounded-[16px] border border-emerald-200 bg-emerald-50 p-4 font-body text-sm text-emerald-800"
            >
              <CheckCircle2 aria-hidden className="mt-0.5 size-5 shrink-0 text-emerald-600" />
              <span>
                Factura de liquidación <strong>enviada al cliente</strong>
                {factura.fechaEmision && (
                  <>
                    {' '}el <strong>{formatearFechaHora(factura.fechaEmision)}</strong>
                  </>
                )}
                .
              </span>
            </p>
          )}
          <EnvioFacturaLiquidacion
            reservaId={reservaId}
            e4Enviado={factura.e4Enviado}
            onEnviada={onEnviada}
          />
        </>
      )}

      {/* Borrador válido: acción de emitir + enviar. */}
      {estadoVisual === 'borrador' && (
        <EnvioFacturaLiquidacion reservaId={reservaId} e4Enviado={false} onEnviada={onEnviada} />
      )}

      {regenerar.error && <AvisoErrorFactura error={regenerar.error} />}

      {factura.pdfUrl && <EnlacePdf url={factura.pdfUrl} />}

      {/* Regenerar PDF cuando está pendiente. */}
      {estadoVisual === 'pdf-pendiente' && (
        <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap">
          <button
            type="button"
            onClick={onRegenerar}
            disabled={regenerar.isPending}
            data-testid="regenerar-pdf-liquidacion"
            className={claseBotonSecundario}
          >
            <RefreshCw
              aria-hidden
              className={regenerar.isPending ? 'size-5 animate-spin' : 'size-5'}
            />
            {regenerar.isPending ? 'Regenerando…' : 'Regenerar PDF'}
          </button>
        </div>
      )}
    </section>
  );
};
