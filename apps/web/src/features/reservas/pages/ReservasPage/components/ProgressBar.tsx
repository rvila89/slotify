import { PROGRESS_TRACK } from '../constants';

type ProgressBarProps = {
  /** Etiqueta en versalitas (p. ej. "LOGÍSTICA", "LIQUIDACIÓN"). */
  label: string;
  /** Valor 0-100. Se acota al rango para el ancho de la barra. */
  valor: number;
  /** Color del relleno (token Figma consolidado en `constants.ts`). */
  color: string;
};

/**
 * Barra de progreso reutilizable de la tarjeta del Kanban (US-050, D-7). Muestra
 * la etiqueta y el porcentaje como TEXTO (`{valor}%`) sobre una pista `#eae1d6`,
 * con relleno del color indicado. Track de 4px (medida Figma node 0:523).
 */
export const ProgressBar = ({ label, valor, color }: ProgressBarProps) => {
  const pct = Math.max(0, Math.min(100, valor));
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-text-muted">
          {label}
        </span>
        <span className="text-[11px] font-semibold text-text-secondary">{pct}%</span>
      </div>
      <div
        className="h-1 w-full overflow-hidden rounded-full"
        style={{ backgroundColor: PROGRESS_TRACK }}
        role="progressbar"
        aria-label={label}
        aria-valuenow={pct}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        <div className="h-full rounded-full" style={{ width: `${pct}%`, backgroundColor: color }} />
      </div>
    </div>
  );
};
