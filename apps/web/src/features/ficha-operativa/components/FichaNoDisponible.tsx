import { ClipboardList, Info } from 'lucide-react';

const claseSeccion =
  'flex flex-col gap-6 rounded-[20px] border border-border-default/20 bg-surface-subtle/30 p-4 sm:p-6 lg:p-8';

/**
 * Mensaje contextual mostrado EN LUGAR del formulario cuando la RESERVA aún no está
 * confirmada (respuesta 409 `ficha_no_disponible`, D-3, US-025): la ficha operativa
 * todavía no existe. No es un error bloqueante, sino una indicación de que la sección
 * se habilitará al confirmar la reserva.
 */
export const FichaNoDisponible = () => (
  <section className={claseSeccion} aria-labelledby="ficha-operativa-no-disponible">
    <div className="flex items-center gap-3">
      <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-brand-primary/10 text-brand-primary">
        <ClipboardList aria-hidden className="size-4" />
      </span>
      <h2
        id="ficha-operativa-no-disponible"
        className="font-body text-xs font-bold uppercase tracking-[1.4px] text-text-secondary sm:text-sm"
      >
        Ficha operativa del evento
      </h2>
    </div>
    <p
      role="status"
      data-testid="ficha-no-disponible"
      className="flex items-start gap-2 rounded-[16px] border border-border-default/40 bg-surface-muted/40 p-4 font-body text-sm text-text-secondary"
    >
      <Info aria-hidden className="mt-0.5 size-4 shrink-0" />
      La ficha operativa estará disponible una vez confirmada la reserva.
    </p>
  </section>
);
