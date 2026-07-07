import { useMemo } from 'react';
import type { Reserva } from '../../../model/types';
import { COLUMNAS_KANBAN, agruparPorColumna } from '../../../lib/columnasKanban';
import { KanbanColumn } from './KanbanColumn';

type KanbanViewProps = {
  reservas: Reserva[];
};

/**
 * Tab "Flujo de Reserva" (Kanban) del pipeline (US-050 · UC-37). Renderiza las 5
 * columnas en orden y reparte las reservas por fase (mapa declarativo D-2,
 * memoizado). Contenedor con scroll horizontal: en `<lg` las columnas se
 * desplazan, NO se apilan (D-6, FA-04). Sin overflow horizontal del body.
 */
export const KanbanView = ({ reservas }: KanbanViewProps) => {
  const grupos = useMemo(() => agruparPorColumna(reservas), [reservas]);

  return (
    <div className="-mx-4 overflow-x-auto px-4 pb-2 md:-mx-6 md:px-6 lg:mx-0 lg:px-0">
      <div className="flex gap-4">
        {COLUMNAS_KANBAN.map((columna) => (
          <KanbanColumn key={columna.id} columna={columna} reservas={grupos[columna.id]} />
        ))}
      </div>
    </div>
  );
};
