import { CheckCircle2, FileText, MailCheck } from 'lucide-react';
import { formatearEuros } from '../lib/dinero';
import { ETIQUETA_TIPO_FACTURA } from '../lib/estado';
import type { Factura } from '../model/types';

/**
 * Resumen de una factura **ya emitida** (`estado='enviada'`) de US-028: número fiscal
 * asignado, total, aviso de "enviada al cliente por email" y enlace al PDF emitido.
 * Presentacional puro; los colores de éxito usan tonos verdes con los tokens del proyecto.
 * Mobile-first: el aviso y el número apilan en `<sm` y el enlace al PDF no fuerza overflow.
 */
type Props = {
  factura: Factura;
  /** Acción(es) contextual(es) bajo el resumen (p. ej. "Reenviar factura"). */
  children?: React.ReactNode;
};

export const FacturaEmitidaResumen = ({ factura, children }: Props) => (
  <div className="flex flex-col gap-4" data-testid="factura-emitida-resumen" data-tipo={factura.tipo}>
    <p
      role="status"
      data-testid="aviso-envio-cliente"
      className="flex items-start gap-3 rounded-[16px] border border-emerald-200 bg-emerald-50 p-4 font-body text-sm text-emerald-900"
    >
      <MailCheck aria-hidden className="mt-0.5 size-5 shrink-0 text-emerald-600" />
      <span>
        <strong className="font-semibold">{ETIQUETA_TIPO_FACTURA[factura.tipo]}</strong> emitida
        y enviada al cliente por email.
      </span>
    </p>

    <dl className="grid grid-cols-1 gap-4 sm:grid-cols-2">
      <div className="flex flex-col">
        <dt className="font-body text-xs text-text-secondary">Número de factura</dt>
        <dd
          data-testid="emitida-numero"
          className="flex items-center gap-2 font-display text-base font-semibold text-text-primary"
        >
          <CheckCircle2 aria-hidden className="size-4 shrink-0 text-emerald-600" />
          {factura.numeroFactura ?? '—'}
        </dd>
      </div>
      <div className="flex flex-col">
        <dt className="font-body text-xs text-text-secondary">Total facturado</dt>
        <dd
          data-testid="emitida-total"
          className="font-display text-base font-bold text-brand-primary"
        >
          {formatearEuros(factura.total)}
        </dd>
      </div>
    </dl>

    {factura.pdfUrl && (
      <a
        href={factura.pdfUrl}
        target="_blank"
        rel="noreferrer"
        data-testid="emitida-pdf-link"
        className="inline-flex w-fit items-center gap-2 font-body text-sm font-medium text-brand-primary underline underline-offset-2 transition hover:opacity-80"
      >
        <FileText aria-hidden className="size-4" />
        Ver PDF de la factura
      </a>
    )}

    {children}
  </div>
);
