import { useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  FileText,
  Info,
  Loader2,
  Receipt,
  RefreshCw,
} from 'lucide-react';
import { useFacturaSenal } from '../api/useFacturaSenal';
import { useRegenerarPdf } from '../api/useRegenerarPdf';
import { formatearEuros, formatearPorcentaje } from '../lib/dinero';
import { estadoVisualFactura, puedeAprobar, puedeRechazar } from '../lib/estado';
import { AprobarFacturaDialog } from './AprobarFacturaDialog';
import { RechazarFacturaDialog } from './RechazarFacturaDialog';
import { AvisoErrorFactura } from './AvisoErrorFactura';
import { EnvioFacturaSenal } from './EnvioFacturaSenal';
import { EstadoFacturaBadge } from './EstadoFacturaBadge';
import type { FacturaSenal } from '../model/types';

/**
 * Tarjeta "Factura de señal" (US-022 · UC-18) para la ficha de una RESERVA en
 * `reserva_confirmada`. Muestra el desglose fiscal (base imponible, IVA 21 %, total),
 * el número de factura (o "Pendiente" en borrador), el estado con badge, el enlace al
 * PDF cuando existe y, para el Gestor, las acciones **Aprobar** / **Rechazar** según
 * el estado visual derivado (design.md §D-9):
 *  - `borrador`: desglose + Aprobar / Rechazar.
 *  - `borrador-invalido` (`esBorradorInvalido`): aviso de datos fiscales incompletos
 *    con los `camposFaltantes`, sin Aprobar, con Rechazar.
 *  - `pdf-pendiente` (`pdfPendiente`): aviso de PDF en proceso + Regenerar PDF, sin
 *    Aprobar.
 *  - `enviada`: badge verde, enlace al PDF y acción **Enviar factura 40%** (rebanada 6.4b):
 *    remite al cliente la factura de señal emitida + las condicions particulars por email E3.
 *
 * La acción "Enviar factura 40%" (`useEnviarFacturaSenal`) es idempotente en backend: tras el
 * primer envío un re-disparo devuelve 409 `E3_YA_ENVIADO` (se avisa sin alarmar), y un fallo de
 * envío 502 `EMISION_ENVIO_FALLIDO` es recuperable/reintentable (rollback total). Si el email
 * salió sin las condiciones (`condPartAdjuntada=false`) se avisa al Gestor.
 *
 * Estado de servidor con TanStack Query sobre el SDK generado. Diseño adaptado con
 * los tokens del proyecto (sin frame propio en Figma "Slotify"); mobile-first: el
 * desglose apila en una columna en móvil y pasa a dos/tres columnas en `sm:`/`lg:`,
 * las acciones apilan en columna en `<sm` sin overflow horizontal.
 */
type Props = {
  reservaId: string;
};

const claseBotonPrimario =
  'inline-flex h-11 w-full items-center justify-center gap-2 rounded-full bg-brand-primary px-6 font-display text-sm text-brand-foreground transition hover:opacity-95 disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto';

const claseBotonSecundario =
  'inline-flex h-11 w-full items-center justify-center gap-2 rounded-full border border-border-default bg-canvas px-6 font-body text-sm font-medium text-text-secondary transition hover:bg-surface-muted disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto';

const claseBotonPeligro =
  'inline-flex h-11 w-full items-center justify-center gap-2 rounded-full border border-red-200 bg-canvas px-6 font-body text-sm font-medium text-red-700 transition hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto';

const Encabezado = ({ factura }: { factura?: FacturaSenal | null }) => (
  <div className="flex flex-wrap items-center justify-between gap-3">
    <div className="flex items-center gap-3">
      <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-brand-primary/10 text-brand-primary">
        <Receipt aria-hidden className="size-4" />
      </span>
      <h2 className="font-body text-xs font-bold uppercase tracking-[1.4px] text-text-secondary sm:text-sm">
        Factura de señal
      </h2>
    </div>
    {factura && <EstadoFacturaBadge factura={factura} />}
  </div>
);

const Desglose = ({ factura }: { factura: FacturaSenal }) => (
  <dl
    data-testid="desglose-factura"
    className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3"
  >
    <div className="flex flex-col">
      <dt className="font-body text-xs text-text-secondary">Base imponible</dt>
      <dd data-testid="factura-base" className="font-display text-base font-semibold text-text-primary">
        {formatearEuros(factura.baseImponible)}
      </dd>
    </div>
    <div className="flex flex-col">
      <dt className="font-body text-xs text-text-secondary">
        IVA ({formatearPorcentaje(factura.ivaPorcentaje)})
      </dt>
      <dd data-testid="factura-iva" className="font-display text-base font-semibold text-text-primary">
        {formatearEuros(factura.ivaImporte)}
      </dd>
    </div>
    <div className="flex flex-col">
      <dt className="font-body text-xs text-text-secondary">Total</dt>
      <dd data-testid="factura-total" className="font-display text-base font-bold text-brand-primary">
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
    data-testid="factura-pdf-link"
    className="inline-flex w-fit items-center gap-2 font-body text-sm font-medium text-brand-primary underline underline-offset-2 transition hover:opacity-80"
  >
    <FileText aria-hidden className="size-4" />
    Ver PDF de la factura
  </a>
);

export const FacturaSenalCard = ({ reservaId }: Props) => {
  const { data: factura, isLoading, isError } = useFacturaSenal(reservaId);
  const regenerar = useRegenerarPdf();
  const [dialogoAprobar, setDialogoAprobar] = useState(false);
  const [dialogoRechazar, setDialogoRechazar] = useState(false);

  const claseSeccion =
    'flex flex-col gap-6 rounded-[20px] border border-border-default/20 bg-surface-subtle/30 p-4 sm:p-6 lg:p-8';

  if (isLoading) {
    return (
      <section className={claseSeccion} aria-labelledby="ficha-factura-senal">
        <div id="ficha-factura-senal">
          <Encabezado />
        </div>
        <p
          data-testid="factura-cargando"
          className="flex items-center gap-2 font-body text-sm text-text-secondary"
        >
          <Loader2 aria-hidden className="size-4 animate-spin" />
          Cargando factura de señal…
        </p>
      </section>
    );
  }

  // 404 → `null`: la factura aún no se ha materializado (disparo post-commit de US-021).
  if (!isError && !factura) {
    return (
      <section className={claseSeccion} aria-labelledby="ficha-factura-senal">
        <div id="ficha-factura-senal">
          <Encabezado />
        </div>
        <p
          role="status"
          data-testid="factura-en-preparacion"
          className="flex items-start gap-2 rounded-[16px] border border-border-default/40 bg-surface-muted/40 p-4 font-body text-sm text-text-secondary"
        >
          <Info aria-hidden className="mt-0.5 size-4 shrink-0" />
          La factura de señal en borrador se está preparando; estará disponible para revisión en
          breve.
        </p>
      </section>
    );
  }

  if (isError || !factura) {
    return (
      <section className={claseSeccion} aria-labelledby="ficha-factura-senal">
        <div id="ficha-factura-senal">
          <Encabezado />
        </div>
        <p
          role="alert"
          data-testid="factura-error"
          className="rounded-[16px] border border-red-200 bg-red-50 px-4 py-3 font-body text-sm text-red-700"
        >
          No se ha podido cargar la factura de señal. Inténtalo de nuevo.
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
      aria-labelledby="ficha-factura-senal"
      data-testid="factura-senal-card"
      data-estado-visual={estadoVisual}
    >
      <div id="ficha-factura-senal">
        <Encabezado factura={factura} />
      </div>

      <dl className="flex flex-col gap-1">
        <dt className="font-body text-xs text-text-secondary">Número de factura</dt>
        <dd data-testid="factura-numero" className="font-body text-sm font-medium text-text-primary">
          {factura.numeroFactura ?? 'Pendiente'}
        </dd>
      </dl>

      {factura.concepto && (
        <p className="font-body text-sm text-text-secondary">{factura.concepto}</p>
      )}

      <Desglose factura={factura} />

      {/* Borrador inválido: faltan datos fiscales del cliente (design.md §D-9). */}
      {estadoVisual === 'borrador-invalido' && (
        <div
          role="alert"
          data-testid="aviso-borrador-invalido"
          className="flex items-start gap-3 rounded-[16px] border border-red-200 bg-red-50 p-4 text-red-700"
        >
          <AlertTriangle aria-hidden className="mt-0.5 size-5 shrink-0 text-red-600" />
          <div className="flex flex-col gap-2 font-body text-sm">
            <p className="font-medium">
              Datos fiscales del cliente incompletos: no se puede emitir la factura.
            </p>
            <p className="text-red-600/90">
              Completa los datos fiscales del cliente (DNI/NIF y dirección fiscal). La aprobación
              queda bloqueada hasta que se completen; al intentar aprobar o regenerar el PDF se
              detallarán los campos que faltan.
            </p>
          </div>
        </div>
      )}

      {/* PDF pendiente: fallo transitorio; el sistema reintenta y se puede forzar. */}
      {estadoVisual === 'pdf-pendiente' && (
        <div
          role="status"
          data-testid="aviso-pdf-pendiente"
          className="flex items-start gap-3 rounded-[16px] border border-amber-200 bg-amber-50 p-4 text-amber-900"
        >
          <Info aria-hidden className="mt-0.5 size-5 shrink-0 text-amber-600" />
          <div className="flex flex-col gap-1 font-body text-sm">
            <p className="font-medium">El PDF de la factura se está generando.</p>
            <p className="text-amber-800/90">
              La aprobación queda bloqueada hasta que el PDF esté disponible. El sistema reintenta
              automáticamente; también puedes forzar la regeneración.
            </p>
          </div>
        </div>
      )}

      {/* Enviada (emitida): factura lista para remitir al cliente por email E3 (6.4b). */}
      {estadoVisual === 'enviada' && <EnvioFacturaSenal reservaId={reservaId} />}

      {regenerar.error && <AvisoErrorFactura error={regenerar.error} />}

      {factura.pdfUrl && <EnlacePdf url={factura.pdfUrl} />}

      {/* Acciones del Gestor según el estado visual derivado. */}
      {(puedeAprobar(factura) || puedeRechazar(factura) || estadoVisual === 'pdf-pendiente') && (
        <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap">
          {puedeAprobar(factura) && (
            <button
              type="button"
              onClick={() => setDialogoAprobar(true)}
              data-testid="abrir-aprobar-factura"
              className={claseBotonPrimario}
            >
              <CheckCircle2 aria-hidden className="size-5" />
              Aprobar factura
            </button>
          )}

          {estadoVisual === 'pdf-pendiente' && (
            <button
              type="button"
              onClick={onRegenerar}
              disabled={regenerar.isPending}
              data-testid="regenerar-pdf-factura"
              className={claseBotonSecundario}
            >
              <RefreshCw
                aria-hidden
                className={regenerar.isPending ? 'size-5 animate-spin' : 'size-5'}
              />
              {regenerar.isPending ? 'Regenerando…' : 'Regenerar PDF'}
            </button>
          )}

          {puedeRechazar(factura) && (
            <button
              type="button"
              onClick={() => setDialogoRechazar(true)}
              data-testid="abrir-rechazar-factura"
              className={claseBotonPeligro}
            >
              <AlertTriangle aria-hidden className="size-5" />
              Rechazar borrador
            </button>
          )}
        </div>
      )}

      <AprobarFacturaDialog
        factura={factura}
        abierto={dialogoAprobar}
        onAbiertoChange={setDialogoAprobar}
        onAprobado={() => setDialogoAprobar(false)}
      />

      <RechazarFacturaDialog
        factura={factura}
        abierto={dialogoRechazar}
        onAbiertoChange={setDialogoRechazar}
        onRechazado={() => setDialogoRechazar(false)}
      />
    </section>
  );
};
