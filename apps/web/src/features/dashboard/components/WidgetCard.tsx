import type { ColorCalendario } from '@/features/calendario';
import type { DashboardItem, DashboardItemProximos30Dias } from '../model/types';
import { WidgetItem } from './WidgetItem';

/** Máximo de ítems listados por card; el resto se resume como "+N más". */
const MAX_ITEMS_VISIBLES = 6;

const tieneColor = (
  item: DashboardItem | DashboardItemProximos30Dias,
): item is DashboardItemProximos30Dias => 'color' in item;

/**
 * Card genérica de widget del dashboard (US-044). Estilo bento del design system
 * (Figma "Insights Section": esquinas muy redondeadas, superficie cálida, título
 * en versalitas Manrope y contador grande Epilogue). Mapea los tokens del
 * proyecto (bg-surface-muted, border-border-default, text-brand-primary…), no
 * hex inline.
 *
 * Cada widget gestiona su estado vacío de forma independiente (§FA-01): si
 * `total = 0` muestra el mensaje `vacio` en vez de la lista. El contador `total`
 * es siempre el recuento del backend, aunque la lista se recorte a
 * `MAX_ITEMS_VISIBLES`.
 */
export const WidgetCard = ({
  titulo,
  descripcion,
  vacio,
  total,
  items,
}: {
  titulo: string;
  descripcion: string;
  vacio: string;
  total: number;
  items: (DashboardItem | DashboardItemProximos30Dias)[];
}) => {
  const visibles = items.slice(0, MAX_ITEMS_VISIBLES);
  const restantes = total - visibles.length;

  return (
    <section
      aria-label={titulo}
      className="flex h-full flex-col gap-4 rounded-[28px] border border-border-default bg-surface-muted p-5 sm:p-6"
    >
      <header className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-1">
          <h2 className="font-body text-xs font-bold uppercase tracking-wider text-text-secondary">
            {titulo}
          </h2>
          <p className="font-body text-xs text-text-muted">{descripcion}</p>
        </div>
        <span
          aria-hidden
          className="shrink-0 font-display text-4xl font-bold leading-none tracking-tight text-brand-primary"
        >
          {total}
        </span>
      </header>

      {total === 0 || visibles.length === 0 ? (
        <p className="flex flex-1 items-center rounded-2xl bg-canvas/60 px-3 py-6 font-body text-sm text-text-muted">
          {vacio}
        </p>
      ) : (
        <>
          <ul className="-mx-1 flex flex-col gap-1">
            {visibles.map((item) => (
              <WidgetItem
                key={item.reservaId}
                reservaId={item.reservaId}
                codigo={item.codigo}
                clienteNombre={item.clienteNombre}
                fechaEvento={item.fechaEvento}
                color={tieneColor(item) ? (item.color as ColorCalendario) : undefined}
              />
            ))}
          </ul>
          {restantes > 0 ? (
            <p className="px-3 font-body text-xs font-medium text-text-secondary">
              +{restantes} más
            </p>
          ) : null}
        </>
      )}
    </section>
  );
};
