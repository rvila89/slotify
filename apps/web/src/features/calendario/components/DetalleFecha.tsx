import { Link } from 'react-router-dom';
import { ArrowUpRight, Repeat } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { CalendarioFecha } from '../model/types';
import { ESTILO_COLOR } from '../lib/colores';
import { etiquetaEstado } from '../lib/etiquetas';
import { ttlRestante } from '../lib/fecha';
import { formatearFechaLarga, rutaCola } from '../lib/navegacion';

/**
 * Contenido del popover/panel de detalle al hacer clic en una fecha ocupada
 * (US-039 §Clic en fecha con reserva activa). REUTILIZA los campos ya presentes
 * en la respuesta agregada (cliente, subEstado, ttlExpiracion, reservaId,
 * enCola): NO dispara una segunda llamada (design §D-8).
 */
export const DetalleFecha = ({ fecha }: { fecha: CalendarioFecha }) => {
  const estilo = ESTILO_COLOR[fecha.color];
  const ttl = ttlRestante(fecha.ttlExpiracion);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <span aria-hidden className={cn('size-3 shrink-0 rounded-full', estilo.punto)} />
        <p className="font-display text-sm font-semibold text-text-primary">
          {formatearFechaLarga(fecha.fecha)}
        </p>
      </div>

      <dl className="flex flex-col gap-1.5 font-body text-sm">
        <div className="flex justify-between gap-3">
          <dt className="text-text-secondary">Cliente</dt>
          <dd className="text-right font-medium text-text-primary">{fecha.cliente}</dd>
        </div>
        <div className="flex justify-between gap-3">
          <dt className="text-text-secondary">Estado</dt>
          <dd className="text-right font-medium text-text-primary">{etiquetaEstado(fecha)}</dd>
        </div>
        <div className="flex justify-between gap-3">
          <dt className="text-text-secondary">TTL restante</dt>
          <dd className="text-right font-medium text-text-primary">{ttl ?? '—'}</dd>
        </div>
      </dl>

      {fecha.enCola >= 1 ? (
        <Link
          to={rutaCola(fecha.reservaId)}
          className="flex items-center justify-center gap-2 rounded-full border border-border-default bg-surface-muted px-3 py-2 font-body text-xs font-semibold text-text-secondary transition-colors hover:bg-surface-subtle"
        >
          <Repeat aria-hidden className="size-4" />
          Ver cola ({fecha.enCola} en espera)
        </Link>
      ) : null}

      <Link
        to={`/reservas/${fecha.reservaId}`}
        className="flex items-center justify-center gap-2 rounded-full bg-brand-primary px-3 py-2 font-body text-xs font-semibold text-brand-foreground transition-opacity hover:opacity-90"
      >
        Ver ficha de la reserva
        <ArrowUpRight aria-hidden className="size-4" />
      </Link>
    </div>
  );
};
