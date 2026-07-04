import { FileText, Receipt, ShieldCheck } from 'lucide-react';
import { cn } from '@/lib/utils';
import { formatearEuros, formatearPorcentaje } from '../lib/dinero';
import { ETIQUETA_TIPO_FACTURA } from '../lib/estado';
import { EstadoFacturaBadge } from './EstadoFacturaBadge';
import type { Factura } from '../model/types';

/**
 * Tarjeta de solo lectura de un borrador de **liquidación** o **fianza** (US-027 ·
 * UC-21). Muestra el tipo, el estado (badge), el número de factura (`null` en
 * borrador → "Sin número / pendiente de emisión"), el desglose fiscal (base
 * imponible, IVA 21 %, total) y, si existe, el enlace al PDF. NO expone acciones de
 * aprobación/emisión (asignar `numeroFactura`, `borrador → enviada`, E4): eso es
 * US-028, fuera de este change.
 *
 * Estilo consistente con `FacturaSenalCard` (US-022) reutilizando tokens del
 * proyecto. Mobile-first: el desglose apila en una columna en `<sm`, pasa a
 * dos/tres columnas en `sm:`/`lg:`; sin overflow horizontal.
 */
type Props = {
  factura: Factura;
};

const IconoTipo = ({ tipo }: { tipo: Factura['tipo'] }) => {
  const Icono = tipo === 'fianza' ? ShieldCheck : Receipt;
  return <Icono aria-hidden className="size-4" />;
};

const Desglose = ({ factura }: { factura: Factura }) => (
  <dl
    data-testid="desglose-borrador"
    className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3"
  >
    <div className="flex flex-col">
      <dt className="font-body text-xs text-text-secondary">Base imponible</dt>
      <dd
        data-testid="borrador-base"
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
        data-testid="borrador-iva"
        className="font-display text-base font-semibold text-text-primary"
      >
        {formatearEuros(factura.ivaImporte)}
      </dd>
    </div>
    <div className="flex flex-col">
      <dt className="font-body text-xs text-text-secondary">Total</dt>
      <dd
        data-testid="borrador-total"
        className="font-display text-base font-bold text-brand-primary"
      >
        {formatearEuros(factura.total)}
      </dd>
    </div>
  </dl>
);

export const FacturaBorradorCard = ({ factura }: Props) => (
  <article
    data-testid="factura-borrador-card"
    data-tipo={factura.tipo}
    data-estado={factura.estado}
    className={cn(
      'flex flex-col gap-4 rounded-[16px] border border-border-default/40 bg-canvas p-4 sm:p-5',
    )}
  >
    <header className="flex flex-wrap items-center justify-between gap-3">
      <div className="flex items-center gap-3">
        <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-brand-primary/10 text-brand-primary">
          <IconoTipo tipo={factura.tipo} />
        </span>
        <h3 className="font-body text-sm font-semibold text-text-primary">
          {ETIQUETA_TIPO_FACTURA[factura.tipo]}
        </h3>
      </div>
      <EstadoFacturaBadge factura={factura} />
    </header>

    <dl className="flex flex-col gap-1">
      <dt className="font-body text-xs text-text-secondary">Número de factura</dt>
      <dd
        data-testid="borrador-numero"
        className="font-body text-sm font-medium text-text-primary"
      >
        {factura.numeroFactura ?? 'Sin número / pendiente de emisión'}
      </dd>
    </dl>

    {factura.concepto && (
      <p className="font-body text-sm text-text-secondary">{factura.concepto}</p>
    )}

    <Desglose factura={factura} />

    {factura.pdfUrl && (
      <a
        href={factura.pdfUrl}
        target="_blank"
        rel="noreferrer"
        data-testid="borrador-pdf-link"
        className="inline-flex w-fit items-center gap-2 font-body text-sm font-medium text-brand-primary underline underline-offset-2 transition hover:opacity-80"
      >
        <FileText aria-hidden className="size-4" />
        Ver PDF del borrador
      </a>
    )}
  </article>
);
