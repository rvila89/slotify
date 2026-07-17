import { CheckCircle2, Play, X } from 'lucide-react';
import { etiquetaPrecondicionIncumplida } from '../../../lib/forzarInicioEvento';
import type { components } from '@/api-client';

type ForzarInicioEventoResponse = components['schemas']['ForzarInicioEventoResponse'];

/**
 * Aviso de desenlace de la acción "Forzar inicio del evento" (US-032 · UC-23 FA-01).
 * El 200 garantiza la transición `reserva_confirmada → evento_en_curso` como override
 * explícito del gestor (`forzadoPorGestor=true`). Recuerda las precondiciones que
 * quedaron incumplidas (`precondicionesIncumplidas`, evidencia del audit log) para que
 * el gestor sepa qué sub-procesos siguen pendientes (NO se resolvieron, D-5).
 * Componente de presentación puro, mobile-first (apila en columna; sin overflow).
 */
type Props = {
  resultado: ForzarInicioEventoResponse;
  onCerrar: () => void;
};

export const AvisoEventoForzado = ({ resultado, onCerrar }: Props) => {
  const pendientes = resultado.precondicionesIncumplidas ?? [];

  return (
    <div
      role="status"
      data-testid="aviso-evento-forzado"
      className="flex items-start gap-3 rounded-[16px] border border-emerald-200 bg-emerald-50 p-4 text-emerald-800"
    >
      <CheckCircle2 aria-hidden className="mt-0.5 size-5 shrink-0 text-emerald-600" />

      <div className="flex flex-1 flex-col gap-3 font-body text-sm">
        <p className="flex items-start gap-2 font-medium">
          <Play aria-hidden className="mt-0.5 size-4 shrink-0 text-emerald-600" />
          Inicio de evento forzado. La reserva ha pasado a <strong>evento en curso</strong>.
        </p>

        {pendientes.length > 0 && (
          <div
            data-testid="aviso-forzado-precondiciones"
            className="flex flex-col gap-1 rounded-[12px] border border-black/10 bg-black/5 p-3"
          >
            <p className="font-medium">Quedaron precondiciones sin resolver:</p>
            <ul className="list-disc pl-5">
              {pendientes.map((item) => (
                <li key={item}>{etiquetaPrecondicionIncumplida(item)}</li>
              ))}
            </ul>
            <p>Gestiónalas desde la ficha; el forzado no las resuelve automáticamente.</p>
          </div>
        )}
      </div>

      <button
        type="button"
        onClick={onCerrar}
        aria-label="Cerrar aviso"
        className="shrink-0 rounded-full p-1 transition hover:bg-black/5"
      >
        <X aria-hidden className="size-4" />
      </button>
    </div>
  );
};
