import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, Lock } from 'lucide-react';
import { useReserva } from '@/features/reservas';
import { EstadoBadge } from '../../components/EstadoBadge';
import { DetalleSecciones } from './components/DetalleSecciones';
import type { EstadoFinal } from '../../model/types';

/**
 * Detalle de una reserva del histórico en MODO LECTURA ESTRICTO (US-042 · D-5).
 * Reutiliza `GET /reservas/{id}` (`ReservaDetalle`) vía el hook `useReserva` del
 * dominio de reservas (import por barrel, D-1: no se crea endpoint de detalle
 * nuevo). NO monta ningún control de edición/acción mutante: la reserva está en
 * estado cerrado e inmutable. Un banner "solo lectura" lo hace explícito.
 */
export const DetalleHistoricoPage = () => {
  const { id } = useParams<{ id: string }>();
  const { data: reserva, isLoading, isError } = useReserva(id);

  if (isLoading) {
    return (
      <p data-testid="detalle-cargando" className="font-body text-sm text-text-secondary">
        Cargando detalle…
      </p>
    );
  }

  if (isError || !reserva) {
    return (
      <div
        role="alert"
        data-testid="detalle-error"
        className="rounded-[16px] border border-red-200 bg-red-50 px-4 py-3 font-body text-sm text-red-700"
      >
        No se ha podido cargar la reserva. Comprueba el enlace o vuelve al histórico.
      </div>
    );
  }

  const estadoFinal = reserva.estado as EstadoFinal;
  const esCerrada = estadoFinal === 'reserva_completada' || estadoFinal === 'reserva_cancelada';

  return (
    <div className="flex flex-col gap-6">
      <Link
        to="/historico"
        className="inline-flex w-fit items-center gap-2 font-body text-sm font-semibold text-brand-primary underline-offset-2 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-primary"
      >
        <ArrowLeft aria-hidden className="size-4" />
        Volver al histórico
      </Link>

      <header className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="font-display text-2xl font-bold tracking-tight text-text-primary sm:text-3xl">
            Reserva {reserva.codigo}
          </h1>
          {esCerrada && <EstadoBadge estado={estadoFinal} />}
        </div>
        <p className="inline-flex items-center gap-2 font-body text-sm text-text-secondary">
          <Lock aria-hidden className="size-4" />
          Reserva archivada en modo solo lectura. No se puede modificar.
        </p>
      </header>

      <DetalleSecciones reserva={reserva} />
    </div>
  );
};
