import { AlertTriangle, FileStack, Info, Loader2 } from 'lucide-react';
import { useFacturasReserva } from '../api/useFacturasReserva';
import {
  derivarAlertaDocumentos,
  seleccionarBorradoresLiquidacionFianza,
} from '../lib/alerta';
import { FacturaBorradorCard } from './FacturaBorradorCard';

/**
 * Sección "Documentos de liquidación y fianza" (US-027 · UC-21) de la ficha de una
 * RESERVA en `reserva_confirmada`. A partir de la colección de facturas de la reserva
 * (`GET /reservas/{id}/facturas`) DERIVA:
 *  - la **alerta al Gestor** (D-6, sin endpoint propio): "Documentos de liquidación y
 *    fianza pendientes de revisión" cuando hay borradores de ambos tipos; solo la
 *    liquidación si la fianza se omitió (`fianza_default_eur = 0`); ninguna si no hay
 *    borradores pendientes;
 *  - la **visualización** de los borradores de liquidación y fianza (una card por
 *    documento con tipo, desglose, total, estado, número o "pendiente de emisión").
 *
 * Se monta junto a la card de la factura de señal de US-022 en la misma vista.
 * Mobile-first: las cards apilan en una columna en `<lg` y pasan a dos columnas en
 * `lg:`; sin overflow horizontal.
 */
type Props = {
  reservaId: string;
};

const claseSeccion =
  'flex flex-col gap-6 rounded-[20px] border border-border-default/20 bg-surface-subtle/30 p-4 sm:p-6 lg:p-8';

const Encabezado = () => (
  <div className="flex items-center gap-3" id="ficha-documentos-liquidacion-fianza">
    <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-brand-primary/10 text-brand-primary">
      <FileStack aria-hidden className="size-4" />
    </span>
    <h2 className="font-body text-xs font-bold uppercase tracking-[1.4px] text-text-secondary sm:text-sm">
      Documentos de liquidación y fianza
    </h2>
  </div>
);

export const DocumentosLiquidacionFianza = ({ reservaId }: Props) => {
  const { data: facturas, isLoading, isError } = useFacturasReserva(reservaId);

  if (isLoading) {
    return (
      <section className={claseSeccion} aria-labelledby="ficha-documentos-liquidacion-fianza">
        <Encabezado />
        <p
          data-testid="documentos-cargando"
          className="flex items-center gap-2 font-body text-sm text-text-secondary"
        >
          <Loader2 aria-hidden className="size-4 animate-spin" />
          Cargando documentos de liquidación y fianza…
        </p>
      </section>
    );
  }

  const borradores = seleccionarBorradoresLiquidacionFianza(facturas);
  const alerta = derivarAlertaDocumentos(facturas);

  if (isError) {
    return (
      <section className={claseSeccion} aria-labelledby="ficha-documentos-liquidacion-fianza">
        <Encabezado />
        <p
          role="alert"
          data-testid="documentos-error"
          className="rounded-[16px] border border-red-200 bg-red-50 px-4 py-3 font-body text-sm text-red-700"
        >
          No se han podido cargar los documentos de liquidación y fianza. Inténtalo de nuevo.
        </p>
      </section>
    );
  }

  // Sin borradores todavía: el disparo post-commit de US-021/US-027 aún no los materializó.
  if (borradores.length === 0) {
    return (
      <section className={claseSeccion} aria-labelledby="ficha-documentos-liquidacion-fianza">
        <Encabezado />
        <p
          role="status"
          data-testid="documentos-en-preparacion"
          className="flex items-start gap-2 rounded-[16px] border border-border-default/40 bg-surface-muted/40 p-4 font-body text-sm text-text-secondary"
        >
          <Info aria-hidden className="mt-0.5 size-4 shrink-0" />
          Los borradores de liquidación y fianza se están preparando; estarán disponibles para
          revisión en breve.
        </p>
      </section>
    );
  }

  return (
    <section
      className={claseSeccion}
      aria-labelledby="ficha-documentos-liquidacion-fianza"
      data-testid="documentos-liquidacion-fianza"
    >
      <Encabezado />

      {alerta && (
        <p
          role="alert"
          data-testid="alerta-documentos-pendientes"
          className="flex items-start gap-3 rounded-[16px] border border-amber-200 bg-amber-50 p-4 font-body text-sm text-amber-900"
        >
          <AlertTriangle aria-hidden className="mt-0.5 size-5 shrink-0 text-amber-600" />
          <span className="font-medium">{alerta.mensaje}</span>
        </p>
      )}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {borradores.map((factura) => (
          <FacturaBorradorCard key={factura.idFactura} factura={factura} />
        ))}
      </div>
    </section>
  );
};
