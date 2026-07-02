import { Link } from 'react-router-dom';
import { CalendarCheck2, CircleAlert, SearchX } from 'lucide-react';

const claseCaja =
  'flex flex-col items-center gap-3 rounded-[20px] border border-border-default/20 bg-surface-subtle/30 p-6 text-center sm:p-10';

/** Estado de carga de la vista de cola. */
export const ColaCargando = () => (
  <p data-testid="cola-cargando" className="font-body text-sm text-text-secondary" aria-live="polite">
    Cargando cola de espera…
  </p>
);

/**
 * Estado de error / no encontrada (FA-404 y fallos de red). `noEncontrada`
 * diferencia "la reserva no existe / no accesible" del error genérico.
 */
export const ColaError = ({ noEncontrada }: { noEncontrada: boolean }) => (
  <div role="alert" data-testid="cola-error" className={claseCaja}>
    <span className="flex size-10 items-center justify-center rounded-full bg-red-50 text-red-600">
      {noEncontrada ? (
        <SearchX aria-hidden className="size-5" />
      ) : (
        <CircleAlert aria-hidden className="size-5" />
      )}
    </span>
    <p className="font-display text-base font-semibold text-text-primary">
      {noEncontrada ? 'Cola no encontrada' : 'No se ha podido cargar la cola'}
    </p>
    <p className="font-body text-sm text-text-secondary">
      {noEncontrada
        ? 'La reserva no existe o no es accesible. Comprueba el enlace o vuelve al calendario.'
        : 'Ha ocurrido un problema al cargar la cola de espera. Inténtalo de nuevo más tarde.'}
    </p>
    <Link
      to="/calendario"
      className="mt-1 inline-flex items-center gap-2 rounded-full border border-border-default bg-canvas px-4 py-2 font-body text-xs font-semibold text-text-secondary transition-colors hover:bg-surface-subtle focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-primary"
    >
      Volver al calendario
    </Link>
  </div>
);

/**
 * FA-04 — `estaBloqueada: false` (`bloqueante: null`): la reserva no bloquea
 * ninguna fecha activa. Estado "Fecha disponible", sin secciones.
 */
export const FechaDisponible = () => (
  <div data-testid="cola-fecha-disponible" className={claseCaja}>
    <span className="flex size-10 items-center justify-center rounded-full bg-emerald-50 text-emerald-600">
      <CalendarCheck2 aria-hidden className="size-5" />
    </span>
    <p className="font-display text-base font-semibold text-text-primary">Fecha disponible</p>
    <p className="font-body text-sm text-text-secondary">
      Esta reserva no bloquea ninguna fecha activa, por lo que no hay cola de espera asociada.
    </p>
    <Link
      to="/calendario"
      className="mt-1 inline-flex items-center gap-2 rounded-full border border-border-default bg-canvas px-4 py-2 font-body text-xs font-semibold text-text-secondary transition-colors hover:bg-surface-subtle focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-primary"
    >
      Volver al calendario
    </Link>
  </div>
);
