import { Link } from 'react-router-dom';
import { ExternalLink, MessageSquare } from 'lucide-react';
import type { Reserva } from '../../../model/types';
import { aforoDeReserva } from '../../../lib/aforo';
import { formatearFecha } from '../../../lib/fecha';
import { ProgressBar } from './ProgressBar';
import {
  PROGRESS_LIQUIDACION,
  PROGRESS_LOGISTICA,
  TARJETA_BG,
  TARJETA_BORDER,
  TARJETA_SHADOW,
} from '../constants';

type ReservaKanbanCardProps = {
  reserva: Reserva;
};

/**
 * Tarjeta del Kanban de pipeline (US-050 · UC-37). Muestra el nombre del evento,
 * la fecha (formateada en español) junto al aforo/pax, las barras de progreso
 * LOGÍSTICA y LIQUIDACIÓN con su %, y la nota de estado SOLO si existe. Toda la
 * tarjeta es un enlace a la FichaConsulta (`/reservas/{idReserva}`); el clic
 * navega, sin mutar ni ejecutar transición (solo lectura, D-9). Tokens del node
 * 0:523 consolidados en `constants.ts`.
 */
export const ReservaKanbanCard = ({ reserva }: ReservaKanbanCardProps) => {
  const aforo = aforoDeReserva(reserva);
  const nombre = reserva.nombreEvento ?? reserva.codigo;
  const tieneNota = Boolean(reserva.notas && reserva.notas.trim().length > 0);

  const metaPartes = [
    reserva.fechaEvento ? formatearFecha(reserva.fechaEvento) : null,
    aforo != null ? `${aforo} pax` : null,
  ].filter(Boolean);

  return (
    <Link
      to={`/reservas/${reserva.idReserva}`}
      aria-label={`Abrir ficha de ${nombre}`}
      className="flex flex-col gap-3 rounded-xl border p-[17px] transition-shadow hover:shadow-md focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-primary"
      style={{ backgroundColor: TARJETA_BG, borderColor: TARJETA_BORDER, boxShadow: TARJETA_SHADOW }}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex flex-col gap-0.5">
          <span className="font-display text-sm font-semibold text-text-primary">{nombre}</span>
          {metaPartes.length > 0 && (
            <span className="text-xs text-text-secondary">{metaPartes.join(' · ')}</span>
          )}
        </div>
        <ExternalLink aria-hidden className="mt-0.5 size-3.5 shrink-0 text-text-muted" />
      </div>

      <div className="flex flex-col gap-2.5">
        <ProgressBar label="Logística" valor={reserva.progressLogistica ?? 0} color={PROGRESS_LOGISTICA} />
        <ProgressBar label="Liquidación" valor={reserva.progressLiquidacion ?? 0} color={PROGRESS_LIQUIDACION} />
      </div>

      {tieneNota && (
        <div className="flex items-center gap-1.5 border-t border-border-default pt-2.5 text-xs text-text-secondary">
          <MessageSquare aria-hidden className="size-3.5 shrink-0 text-text-muted" />
          <span>{reserva.notas}</span>
        </div>
      )}
    </Link>
  );
};
