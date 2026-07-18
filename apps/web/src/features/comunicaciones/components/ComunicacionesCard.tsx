import { useState } from 'react';
import { Info, Loader2, Mail, Plus } from 'lucide-react';
import { useComunicacionesReserva } from '../api/useComunicacionesReserva';
import { ComunicacionListaItem } from './ComunicacionListaItem';
import { RevisarEnviarBorradorDialog } from './RevisarEnviarBorradorDialog';
import { NuevoEmailManualDialog } from './NuevoEmailManualDialog';
import type { ComunicacionListItem } from '../model/types';

/**
 * Sección "Comunicaciones" de la ficha de la RESERVA (US-046 · UC-36). Lista las
 * COMUNICACION de la reserva (borradores accionables + enviados/fallidos de solo
 * lectura), permite revisar/editar/enviar un borrador y crear un nuevo
 * email manual. Estado de servidor con TanStack Query sobre el SDK generado; los
 * formularios usan React Hook Form + Zod (en sus diálogos). El descarte manual de
 * borradores se eliminó de la UI (US-047).
 *
 * Diseño: el archivo Figma "Slotify" no tiene frame de la ficha de reserva ni de esta
 * sección; se ADAPTA con los tokens del proyecto siguiendo el patrón de las demás
 * tarjetas de la ficha (`FacturaSenalCard`, `FichaOperativaCard`). Mobile-first: la
 * cabecera reparte título y acción, apilando en `<sm`; la lista apila en móvil y las
 * filas reparten sus datos en `sm:`. Sin overflow horizontal.
 */
type Props = {
  reservaId: string;
};

const claseSeccion =
  'flex flex-col gap-6 rounded-[20px] border border-border-default/20 bg-surface-subtle/30 p-4 sm:p-6 lg:p-8';

const claseBotonNuevo =
  'inline-flex h-11 w-full items-center justify-center gap-2 rounded-full bg-brand-primary px-5 font-display text-sm text-brand-foreground transition hover:opacity-95 disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto';

const Encabezado = ({ onNuevo }: { onNuevo?: () => void }) => (
  <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
    <div id="ficha-comunicaciones" className="flex items-center gap-3">
      <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-brand-primary/10 text-brand-primary">
        <Mail aria-hidden className="size-4" />
      </span>
      <h2 className="font-body text-xs font-bold uppercase tracking-[1.4px] text-text-secondary sm:text-sm">
        Comunicaciones
      </h2>
    </div>
    {onNuevo && (
      <button
        type="button"
        onClick={onNuevo}
        data-testid="abrir-email-manual"
        className={claseBotonNuevo}
      >
        <Plus aria-hidden className="size-4" />
        Nuevo email manual
      </button>
    )}
  </div>
);

export const ComunicacionesCard = ({ reservaId }: Props) => {
  const { data: comunicaciones, isLoading, isError } = useComunicacionesReserva(reservaId);

  const [borradorRevisar, setBorradorRevisar] = useState<ComunicacionListItem | null>(null);
  const [dialogoManual, setDialogoManual] = useState(false);

  if (isLoading) {
    return (
      <section className={claseSeccion} aria-labelledby="ficha-comunicaciones">
        <Encabezado />
        <p
          data-testid="comunicaciones-cargando"
          className="flex items-center gap-2 font-body text-sm text-text-secondary"
        >
          <Loader2 aria-hidden className="size-4 animate-spin" />
          Cargando comunicaciones…
        </p>
      </section>
    );
  }

  if (isError || !comunicaciones) {
    return (
      <section className={claseSeccion} aria-labelledby="ficha-comunicaciones">
        <Encabezado />
        <p
          role="alert"
          data-testid="comunicaciones-error"
          className="rounded-[16px] border border-red-200 bg-red-50 px-4 py-3 font-body text-sm text-red-700"
        >
          No se han podido cargar las comunicaciones de esta reserva. Inténtalo de nuevo.
        </p>
      </section>
    );
  }

  return (
    <section
      className={claseSeccion}
      aria-labelledby="ficha-comunicaciones"
      data-testid="comunicaciones-card"
    >
      <Encabezado onNuevo={() => setDialogoManual(true)} />

      {comunicaciones.length === 0 ? (
        <p
          role="status"
          data-testid="comunicaciones-vacio"
          className="flex items-start gap-2 rounded-[16px] border border-border-default/40 bg-surface-muted/40 p-4 font-body text-sm text-text-secondary"
        >
          <Info aria-hidden className="mt-0.5 size-4 shrink-0" />
          Todavía no hay comunicaciones para esta reserva. Puedes redactar un email manual.
        </p>
      ) : (
        <ul data-testid="comunicaciones-lista" className="flex flex-col gap-4">
          {comunicaciones.map((item) => (
            <ComunicacionListaItem
              key={item.idComunicacion}
              item={item}
              onRevisar={setBorradorRevisar}
            />
          ))}
        </ul>
      )}

      <RevisarEnviarBorradorDialog
        reservaId={reservaId}
        borrador={borradorRevisar}
        abierto={borradorRevisar !== null}
        onAbiertoChange={(abierto) => {
          if (!abierto) setBorradorRevisar(null);
        }}
      />

      <NuevoEmailManualDialog
        reservaId={reservaId}
        abierto={dialogoManual}
        onAbiertoChange={setDialogoManual}
      />
    </section>
  );
};
