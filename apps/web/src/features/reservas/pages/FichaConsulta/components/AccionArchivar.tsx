import { Archive, Info } from 'lucide-react';
import { motivoArchivarBloqueado, puedeArchivarReserva } from '../../../lib/archivarReserva';
import type { Reserva } from '../../../model/types';

/**
 * Bloque de la acción "Archivar reserva" (US-038 · UC-28 flujo manual) dentro de la
 * sección "Acciones" de la ficha. Extraído de `AccionesConsulta` para mantener el
 * contenedor ≤300 líneas (regla dura `max-lines`).
 *
 * Solo se renderiza (por el padre) cuando `reserva.estado = post_evento`. Ofrece el
 * botón deshabilitado con la razón cuando la fianza no está resuelta (FA-01/FA-02,
 * defensa en UI); el backend revalida siempre (422 `fianza_no_resuelta`).
 */
const claseBotonAccion =
  'inline-flex h-14 w-full items-center justify-center gap-2 rounded-full bg-brand-primary px-10 font-display text-base text-brand-foreground transition hover:opacity-95 disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto sm:px-16';

const claseTextoInfo = 'flex items-start gap-3 font-body text-sm text-text-secondary';

type Props = {
  reserva: Reserva;
  onArchivarReserva: () => void;
};

export const AccionArchivar = ({ reserva, onArchivarReserva }: Props) => {
  if (!puedeArchivarReserva(reserva.estado)) return null;

  const motivo = motivoArchivarBloqueado(reserva.fianzaStatus, reserva.fianzaEur);
  const bloqueado = motivo !== null;

  return (
    <div className="flex flex-col gap-3">
      {bloqueado ? (
        <p data-testid="aviso-archivar-bloqueado" className={claseTextoInfo}>
          <Info aria-hidden className="mt-0.5 size-5 shrink-0 text-text-secondary" />
          {motivo}
        </p>
      ) : (
        <p className="font-body text-sm text-text-secondary">
          El evento ya ha finalizado y la fianza está resuelta. Archiva la reserva para cerrarla:
          pasará a completada (acción irreversible) y quedará disponible en el Histórico. No se
          enviará ningún email.
        </p>
      )}
      <button
        type="button"
        data-testid="boton-archivar-reserva"
        onClick={onArchivarReserva}
        disabled={bloqueado}
        aria-disabled={bloqueado}
        className={claseBotonAccion}
      >
        <Archive aria-hidden className="size-5" />
        Archivar reserva
      </button>
    </div>
  );
};
