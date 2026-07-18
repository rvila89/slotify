import { useNavigate } from 'react-router-dom';
import { ExternalLink } from 'lucide-react';
import type { Reserva } from '../../../model/types';
import { aforoDeReserva } from '../../../lib/aforo';
import { formatearFecha } from '../../../lib/fecha';
import { etiquetaEstado } from '../estadoLabel';

type ListadoViewProps = {
  reservas: Reserva[];
};

const CABECERAS = ['Nombre', 'Estado', 'Fecha', 'Aforo', 'Acciones'] as const;

/**
 * Tab "Listado" del pipeline (US-050 · UC-38). Tabla con columnas
 * Nombre · Estado · Fecha · Aforo · Acciones; una fila por reserva activa. El
 * clic en la fila navega a la FichaConsulta (`/reservas/{idReserva}`, solo
 * lectura). Responsive mobile-first (D-6, FA-04): una única tabla accesible que
 * en `<lg` se refluye a TARJETAS APILADAS (celdas en bloque con su etiqueta) y
 * en `≥lg` es una tabla clásica; sin overflow horizontal.
 */
export const ListadoView = ({ reservas }: ListadoViewProps) => {
  const navigate = useNavigate();

  return (
    <table className="w-full border-collapse text-sm">
      <thead className="sr-only lg:not-sr-only">
        <tr className="lg:border-b lg:border-border-default lg:text-left">
          {CABECERAS.map((c) => (
            <th
              key={c}
              scope="col"
              className="font-body text-xs font-semibold uppercase tracking-wide text-text-muted lg:px-4 lg:py-3"
            >
              {c}
            </th>
          ))}
        </tr>
      </thead>
      <tbody className="flex flex-col gap-3 lg:table-row-group lg:gap-0">
        {reservas.map((reserva) => {
          const aforo = aforoDeReserva(reserva);
          const nombre = reserva.nombreEvento ?? reserva.codigo;
          const tieneBorradorE1 = reserva.tieneBorradorE1Pendiente === true;
          return (
            <tr
              key={reserva.idReserva}
              onClick={() => navigate(`/reservas/${reserva.idReserva}`)}
              className="flex cursor-pointer flex-col gap-1 rounded-xl border border-border-default bg-canvas p-4 transition-colors hover:bg-surface-subtle lg:table-row lg:gap-0 lg:rounded-none lg:border-0 lg:border-b lg:border-border-default lg:p-0"
            >
              <td
                data-label="Nombre"
                className="font-display font-semibold text-text-primary before:mr-2 before:font-body before:text-xs before:font-semibold before:uppercase before:text-text-muted before:content-[attr(data-label)] lg:px-4 lg:py-3 lg:before:content-none"
              >
                {nombre}
              </td>
              <td
                data-label="Estado"
                className="text-text-secondary before:mr-2 before:font-body before:text-xs before:font-semibold before:uppercase before:text-text-muted before:content-[attr(data-label)] lg:px-4 lg:py-3 lg:before:content-none"
              >
                <span className="inline-flex flex-wrap items-center gap-2 align-middle">
                  {etiquetaEstado(reserva)}
                  {tieneBorradorE1 && (
                    <span
                      data-testid="badge-borrador-e1-pendiente"
                      className="inline-flex items-center gap-2 rounded-full border border-amber-200 bg-amber-50 px-3 py-1 font-body text-xs font-semibold text-amber-900"
                    >
                      <span aria-hidden className="size-2 rounded-full bg-current opacity-70" />
                      Borrador E1 pendiente
                    </span>
                  )}
                </span>
              </td>
              <td
                data-label="Fecha"
                className="text-text-secondary before:mr-2 before:font-body before:text-xs before:font-semibold before:uppercase before:text-text-muted before:content-[attr(data-label)] lg:px-4 lg:py-3 lg:before:content-none"
              >
                {reserva.fechaEvento ? formatearFecha(reserva.fechaEvento) : '—'}
              </td>
              <td
                data-label="Aforo"
                className="text-text-secondary before:mr-2 before:font-body before:text-xs before:font-semibold before:uppercase before:text-text-muted before:content-[attr(data-label)] lg:px-4 lg:py-3 lg:before:content-none"
              >
                {aforo != null ? `${aforo} pax` : '—'}
              </td>
              <td
                data-label="Acciones"
                className="lg:px-4 lg:py-3"
              >
                <span className="inline-flex items-center gap-1 text-xs font-semibold text-brand-primary">
                  <ExternalLink aria-hidden className="size-3.5" />
                  Ver ficha
                </span>
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
};
