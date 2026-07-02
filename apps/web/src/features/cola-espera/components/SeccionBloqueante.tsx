import { Link } from 'react-router-dom';
import { ArrowUpRight, Clock, User } from 'lucide-react';
import type { ColaBloqueante } from '../model/types';
import { etiquetaSubEstado, formatearFechaVisita } from '../lib/etiquetas';

const claseSeccion =
  'flex flex-col gap-5 rounded-[20px] border border-border-default/20 bg-surface-subtle/30 p-4 sm:p-6 lg:p-8';

/**
 * Dato etiqueta/valor apilado (mobile-first): la etiqueta encima del valor para
 * que en 390px no compita por el ancho ni provoque overflow horizontal.
 */
const Dato = ({ etiqueta, valor }: { etiqueta: string; valor: string }) => (
  <div className="flex flex-col gap-1">
    <dt className="font-body text-xs font-medium uppercase tracking-wide text-text-secondary">
      {etiqueta}
    </dt>
    <dd className="font-body text-sm font-medium text-text-primary sm:text-base">{valor}</dd>
  </div>
);

/**
 * Sección "Consulta bloqueante" (US-017): cliente, sub_estado, TTL restante y
 * código de la RESERVA que posee la fecha. En `2v` añade la visita programada.
 * `ttlRestante` viene ya derivado del backend como string legible: se muestra
 * TAL CUAL, no se recalcula en cliente (mitiga el off-by-one de TZ).
 */
export const SeccionBloqueante = ({ bloqueante }: { bloqueante: ColaBloqueante }) => {
  const esVisita = bloqueante.subEstado === '2v';

  return (
    <section className={claseSeccion} aria-labelledby="cola-bloqueante">
      <div id="cola-bloqueante" className="flex items-center gap-3">
        <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-brand-primary/10 text-brand-primary">
          <User aria-hidden className="size-4" />
        </span>
        <h2 className="font-body text-xs font-bold uppercase tracking-[1.4px] text-text-secondary sm:text-sm">
          Consulta bloqueante
        </h2>
      </div>

      <dl className="grid grid-cols-1 gap-4 sm:grid-cols-2 sm:gap-6">
        <Dato etiqueta="Cliente" valor={bloqueante.clienteNombre} />
        <Dato etiqueta="Código" valor={bloqueante.codigo} />
        <Dato etiqueta="Sub-estado" valor={etiquetaSubEstado(bloqueante.subEstado)} />
        <div className="flex flex-col gap-1">
          <dt className="flex items-center gap-1.5 font-body text-xs font-medium uppercase tracking-wide text-text-secondary">
            <Clock aria-hidden className="size-3.5" />
            TTL restante
          </dt>
          <dd className="font-body text-sm font-medium text-text-primary sm:text-base">
            {bloqueante.ttlRestante ?? 'Sin TTL'}
          </dd>
        </div>
        {esVisita && bloqueante.visitaProgramadaFecha ? (
          <Dato
            etiqueta="Visita programada"
            valor={formatearFechaVisita(bloqueante.visitaProgramadaFecha)}
          />
        ) : null}
      </dl>

      <Link
        to={`/reservas/${bloqueante.idReserva}`}
        className="inline-flex w-fit items-center gap-2 rounded-full bg-brand-primary px-4 py-2 font-body text-xs font-semibold text-brand-foreground transition-opacity hover:opacity-90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-primary"
      >
        Ver ficha de la bloqueante
        <ArrowUpRight aria-hidden className="size-4" />
      </Link>
    </section>
  );
};
