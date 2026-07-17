import { useState } from 'react';
import { useHistorico } from '../api/useHistorico';
import { FILTROS_INICIALES } from '../lib/constants';
import { filtrosLimpios, hayFiltrosActivos } from '../lib/filtros';
import type { FiltrosHistorico } from '../model/types';
import { HistoricoFiltros } from '../components/HistoricoFiltros';
import { HistoricoTabla } from '../components/HistoricoTabla';
import { HistoricoPaginacion } from '../components/HistoricoPaginacion';
import { HistoricoSkeleton } from '../components/HistoricoSkeleton';
import {
  HistoricoError,
  HistoricoSinResultados,
  HistoricoVacio,
} from '../components/HistoricoEstados';

/**
 * Página del histórico de reservas cerradas (US-042 · UC-32). Barra de búsqueda
 * full-text + filtros estructurados, tabla paginada de solo lectura y tres
 * estados vacíos diferenciados (D-5): (a) sin resultados por filtros, (b)
 * búsqueda sin coincidencias y (c) tenant sin histórico. Estado UI local
 * (`useState`); estado de servidor vía `useHistorico` (TanStack Query sobre el
 * SDK). Lectura pura: no monta ningún control de mutación.
 *
 * Responsive mobile-first (regla dura): filtros en grid fluido y tabla que se
 * refluye a tarjetas apiladas en `<lg`; sin overflow horizontal.
 */
export const HistoricoPage = () => {
  const [filtros, setFiltros] = useState<FiltrosHistorico>(FILTROS_INICIALES);
  const { data, isLoading, isError, refetch } = useHistorico(filtros);

  const cambiarFiltros = (parcial: Partial<FiltrosHistorico>) =>
    setFiltros((prev) => ({ ...prev, ...parcial }));

  const limpiar = () => setFiltros(filtrosLimpios());

  const reservas = data?.data ?? [];
  const filtrado = hayFiltrosActivos(filtros);

  const renderContenido = () => {
    if (isLoading) return <HistoricoSkeleton />;
    if (isError) return <HistoricoError onRetry={() => void refetch()} />;
    if (reservas.length === 0) {
      if (!filtrado) return <HistoricoVacio />;
      return <HistoricoSinResultados esBusqueda={Boolean(filtros.q?.trim())} onLimpiar={limpiar} />;
    }
    return (
      <div className="flex flex-col gap-4">
        <HistoricoTabla reservas={reservas} termino={filtros.q} />
        {data && (
          <HistoricoPaginacion
            metadata={data.metadata}
            onPageChange={(page) => cambiarFiltros({ page })}
            onLimitChange={(limit) => cambiarFiltros({ limit, page: 1 })}
          />
        )}
      </div>
    );
  };

  return (
    <div className="mx-auto flex w-full max-w-[1200px] flex-col gap-6">
      <header className="flex flex-col gap-1">
        <h1 className="font-display text-2xl font-bold tracking-tight text-text-primary sm:text-3xl">
          Histórico
        </h1>
        <p className="font-body text-sm text-text-secondary">
          Busca y consulta las reservas completadas y canceladas del negocio.
        </p>
      </header>

      <HistoricoFiltros filtros={filtros} onCambiar={cambiarFiltros} onLimpiar={limpiar} />

      {renderContenido()}
    </div>
  );
};
