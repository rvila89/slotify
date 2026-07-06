import { useState } from 'react';
import { useReservasActivas } from '../../api/useReservasActivas';
import { KanbanView } from './KanbanView';
import { ListadoView } from './ListadoView';
import { PipelineSkeleton } from './PipelineSkeleton';
import { PipelineError, PipelineVacio } from './PipelineEstados';

type TabId = 'flujo' | 'listado';

const TABS: readonly { id: TabId; label: string }[] = [
  { id: 'flujo', label: 'Flujo de Reserva' },
  { id: 'listado', label: 'Listado' },
];

/**
 * Pantalla de pipeline de reservas (US-050 · UC-37/UC-38). Orquesta dos tabs
 * —Flujo de Reserva (Kanban) por defecto y Listado (D-4)— sobre un ÚNICO hook de
 * datos compartido (`useReservasActivas`, D-3): cambiar de tab NO dispara una
 * segunda llamada al SDK. Estados de vista derivados de la misma carga (D-5):
 * skeleton (FA-02), vacío + CTA (FA-01) y error + reintento (FA-03). Solo lectura.
 *
 * Responsive mobile-first (regla dura): el Kanban desplaza sus columnas en `<lg`
 * (no apila) y el Listado se refluye a tarjetas apiladas; sin overflow del body.
 */
export const ReservasPage = () => {
  const [tab, setTab] = useState<TabId>('flujo');
  const { data, isLoading, isError, refetch } = useReservasActivas();
  const reservas = data ?? [];

  const renderContenido = () => {
    if (isLoading) return <PipelineSkeleton />;
    if (isError) return <PipelineError onRetry={() => void refetch()} />;
    if (reservas.length === 0) return <PipelineVacio />;
    return tab === 'flujo' ? (
      <KanbanView reservas={reservas} />
    ) : (
      <ListadoView reservas={reservas} />
    );
  };

  return (
    <div className="mx-auto flex w-full max-w-[1200px] flex-col gap-6">
      <header className="flex flex-col gap-1">
        <h1 className="font-display text-2xl font-bold tracking-tight text-text-primary sm:text-3xl">
          Reservas
        </h1>
        <p className="font-body text-sm text-text-secondary">
          Pipeline de reservas activas agrupadas por fase.
        </p>
      </header>

      <div role="tablist" aria-label="Vistas del pipeline" className="flex gap-2 border-b border-border-default">
        {TABS.map(({ id, label }) => {
          const activo = tab === id;
          return (
            <button
              key={id}
              type="button"
              role="tab"
              id={`tab-${id}`}
              aria-selected={activo}
              aria-controls="panel-pipeline"
              onClick={() => setTab(id)}
              className={`-mb-px border-b-2 px-4 py-3 font-body text-sm font-semibold transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-primary ${
                activo
                  ? 'border-brand-primary text-text-primary'
                  : 'border-transparent text-text-secondary hover:text-text-primary'
              }`}
            >
              {label}
            </button>
          );
        })}
      </div>

      <div id="panel-pipeline" role="tabpanel" aria-labelledby={`tab-${tab}`}>
        {renderContenido()}
      </div>
    </div>
  );
};
