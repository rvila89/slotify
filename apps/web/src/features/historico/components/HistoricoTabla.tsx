import { useNavigate } from 'react-router-dom';
import { ExternalLink } from 'lucide-react';
import type { ReservaHistorico } from '../model/types';
import { etiquetaTipoEvento } from '../lib/constants';
import { formatearFechaEvento, formatearImporte, nombreCliente } from '../lib/formato';
import { EstadoBadge } from './EstadoBadge';
import { TextoDestacado } from './TextoDestacado';

type Props = {
  reservas: ReservaHistorico[];
  /** Término de búsqueda activo para destacar coincidencias (D-2). */
  termino?: string;
};

const CABECERAS = ['Código', 'Cliente', 'Fecha evento', 'Tipo', 'Importe', 'Estado', ''] as const;

const celda =
  'before:mr-2 before:font-body before:text-xs before:font-semibold before:uppercase before:text-text-muted before:content-[attr(data-label)] lg:px-4 lg:py-3 lg:before:content-none';

/**
 * Tabla paginada del histórico (US-042 · D-5). Columnas: código · cliente ·
 * fecha evento · tipo · importe · estado (+ acceso al detalle). Reutiliza el
 * patrón responsive del Listado del pipeline (US-050): una única tabla accesible
 * que en `<lg` se refluye a TARJETAS APILADAS (celdas en bloque con su etiqueta)
 * y en `≥lg` es una tabla clásica; sin overflow horizontal. Clic en la fila →
 * detalle en MODO LECTURA (`/historico/{idReserva}`). El código y el nombre del
 * cliente destacan las coincidencias del término buscado.
 */
export const HistoricoTabla = ({ reservas, termino }: Props) => {
  const navigate = useNavigate();

  return (
    <table className="w-full border-collapse text-sm">
      <thead className="sr-only lg:not-sr-only">
        <tr className="lg:border-b lg:border-border-default lg:text-left">
          {CABECERAS.map((c, i) => (
            <th
              key={c || `col-${i}`}
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
          const cliente = nombreCliente(reserva.clienteNombre, reserva.clienteApellidos);
          return (
            <tr
              key={reserva.idReserva}
              onClick={() => navigate(`/historico/${reserva.idReserva}`)}
              className="flex cursor-pointer flex-col gap-1 rounded-xl border border-border-default bg-canvas p-4 transition-colors hover:bg-surface-subtle lg:table-row lg:gap-0 lg:rounded-none lg:border-0 lg:border-b lg:border-border-default lg:p-0"
            >
              <td
                data-label="Código"
                className={`font-display font-semibold text-text-primary ${celda}`}
              >
                <TextoDestacado texto={reserva.codigo} termino={termino} />
              </td>
              <td data-label="Cliente" className={`text-text-secondary ${celda}`}>
                <TextoDestacado texto={cliente} termino={termino} />
              </td>
              <td data-label="Fecha evento" className={`text-text-secondary ${celda}`}>
                {formatearFechaEvento(reserva.fechaEvento)}
              </td>
              <td data-label="Tipo" className={`text-text-secondary ${celda}`}>
                {etiquetaTipoEvento(reserva.tipoEvento)}
              </td>
              <td data-label="Importe" className={`text-text-secondary ${celda}`}>
                {formatearImporte(reserva.importeTotal)}
              </td>
              <td data-label="Estado" className="lg:px-4 lg:py-3">
                <EstadoBadge estado={reserva.estado} />
              </td>
              <td data-label="" className="lg:px-4 lg:py-3">
                <span className="inline-flex items-center gap-1 text-xs font-semibold text-brand-primary">
                  <ExternalLink aria-hidden className="size-3.5" />
                  Ver detalle
                </span>
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
};
