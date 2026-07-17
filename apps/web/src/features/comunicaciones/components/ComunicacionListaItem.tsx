import { Ban, CalendarClock, Mail, Send } from 'lucide-react';
import { EstadoComunicacionBadge } from './EstadoComunicacionBadge';
import { etiquetaCodigoEmail } from '../lib/estado';
import { formatearFechaHora } from '../lib/fecha';
import type { ComunicacionListItem } from '../model/types';

/**
 * Fila del listado de comunicaciones de la ficha de la RESERVA (US-046 · UC-36).
 * Muestra `codigoEmail`, badge de `estado`, `asunto`, `destinatarioEmail`,
 * `fechaCreacion` y (si aplica) `fechaEnvio`. Las filas `enviado`/`fallido` son de
 * SOLO LECTURA; las `borrador` (flag `accionable`) muestran las acciones Enviar /
 * Descartar. Se apila en móvil (`<sm`) y reparte en fila en `sm:`/`lg:` sin overflow.
 */
type Props = {
  item: ComunicacionListItem;
  onRevisar: (item: ComunicacionListItem) => void;
  onDescartar: (item: ComunicacionListItem) => void;
};

const claseBotonPrimario =
  'inline-flex h-11 w-full items-center justify-center gap-2 rounded-full bg-brand-primary px-5 font-display text-sm text-brand-foreground transition hover:opacity-95 disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto';

const claseBotonPeligro =
  'inline-flex h-11 w-full items-center justify-center gap-2 rounded-full border border-red-200 bg-canvas px-5 font-body text-sm font-medium text-red-700 transition hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto';

export const ComunicacionListaItem = ({ item, onRevisar, onDescartar }: Props) => (
  <li
    data-testid="comunicacion-item"
    data-estado={item.estado}
    data-accionable={item.accionable}
    className="flex flex-col gap-4 rounded-[16px] border border-border-default/40 bg-canvas p-4 sm:p-5"
  >
    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
      <div className="flex min-w-0 flex-col gap-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="inline-flex items-center gap-1.5 font-body text-xs font-semibold uppercase tracking-[0.6px] text-text-secondary">
            <Mail aria-hidden className="size-3.5" />
            {etiquetaCodigoEmail(item.codigoEmail)}
          </span>
          <EstadoComunicacionBadge estado={item.estado} />
        </div>
        <p
          data-testid="comunicacion-asunto"
          className="break-words font-display text-base font-semibold text-text-primary"
        >
          {item.asunto}
        </p>
      </div>
    </div>

    <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      <div className="flex min-w-0 flex-col">
        <dt className="font-body text-xs text-text-secondary">Destinatario</dt>
        <dd
          data-testid="comunicacion-destinatario"
          className="break-words font-body text-sm text-text-primary"
        >
          {item.destinatarioEmail ?? 'Sin email registrado'}
        </dd>
      </div>
      <div className="flex flex-col">
        <dt className="font-body text-xs text-text-secondary">Creado</dt>
        <dd className="inline-flex items-center gap-1.5 font-body text-sm text-text-primary">
          <CalendarClock aria-hidden className="size-3.5 text-text-secondary" />
          {formatearFechaHora(item.fechaCreacion)}
        </dd>
      </div>
      {item.fechaEnvio && (
        <div className="flex flex-col">
          <dt className="font-body text-xs text-text-secondary">Enviado</dt>
          <dd
            data-testid="comunicacion-fecha-envio"
            className="inline-flex items-center gap-1.5 font-body text-sm text-text-primary"
          >
            <Send aria-hidden className="size-3.5 text-text-secondary" />
            {formatearFechaHora(item.fechaEnvio)}
          </dd>
        </div>
      )}
    </dl>

    {item.accionable && (
      <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap">
        <button
          type="button"
          onClick={() => onRevisar(item)}
          data-testid="abrir-revisar-borrador"
          className={claseBotonPrimario}
        >
          <Send aria-hidden className="size-4" />
          Revisar y enviar
        </button>
        <button
          type="button"
          onClick={() => onDescartar(item)}
          data-testid="abrir-descartar-borrador"
          className={claseBotonPeligro}
        >
          <Ban aria-hidden className="size-4" />
          Descartar
        </button>
      </div>
    )}
  </li>
);
