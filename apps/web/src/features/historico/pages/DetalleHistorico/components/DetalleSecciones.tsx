import { User, CalendarDays, FileText, Receipt, ClipboardCheck } from 'lucide-react';
import type { ReservaDetalle } from '../../../model/types';
import { etiquetaTipoEvento } from '../../../lib/constants';
import { formatearFechaEvento, formatearImporte, nombreCliente } from '../../../lib/formato';
import { etiquetaTipoFactura, presupuestoAceptado } from '../../../lib/detalle';
import { DetalleDato } from './DetalleDato';
import { SeccionCard } from './SeccionCard';

/**
 * Secciones del detalle en MODO LECTURA ESTRICTO (US-042 · D-5): datos del
 * cliente, del evento, presupuesto aceptado, facturas y estado operativo. NO
 * monta ningún control de edición ni acción mutante (la reserva es inmutable).
 * Todo son pares etiqueta/valor y listas de solo lectura.
 */
export const DetalleSecciones = ({ reserva }: { reserva: ReservaDetalle }) => {
  const cliente = reserva.cliente;
  const presupuesto = presupuestoAceptado(reserva.presupuestos);
  const facturas = reserva.facturas ?? [];
  const aforo = reserva.numInvitadosFinal ?? reserva.numAdultosNinosMayores4;

  return (
    <>
      <SeccionCard icon={User} titulo="Datos del cliente">
        <dl className="grid grid-cols-1 gap-4 sm:grid-cols-2 sm:gap-6">
          <DetalleDato
            etiqueta="Cliente"
            valor={nombreCliente(cliente?.nombre, cliente?.apellidos)}
          />
          {cliente?.email && <DetalleDato etiqueta="Email" valor={cliente.email} />}
          {cliente?.telefono && <DetalleDato etiqueta="Teléfono" valor={cliente.telefono} />}
          {cliente?.dniNif && <DetalleDato etiqueta="DNI / NIF" valor={cliente.dniNif} />}
          {cliente?.poblacion && <DetalleDato etiqueta="Población" valor={cliente.poblacion} />}
        </dl>
      </SeccionCard>

      <SeccionCard icon={CalendarDays} titulo="Datos del evento">
        <dl className="grid grid-cols-1 gap-4 sm:grid-cols-2 sm:gap-6">
          <DetalleDato etiqueta="Código" valor={reserva.codigo} />
          <DetalleDato etiqueta="Tipo de evento" valor={etiquetaTipoEvento(reserva.tipoEvento)} />
          <DetalleDato
            etiqueta="Fecha del evento"
            valor={formatearFechaEvento(reserva.fechaEvento)}
          />
          {aforo != null && <DetalleDato etiqueta="Aforo" valor={`${aforo} pax`} />}
          <DetalleDato etiqueta="Importe total" valor={formatearImporte(reserva.importeTotal)} />
          {reserva.notas && <DetalleDato etiqueta="Notas" valor={reserva.notas} />}
        </dl>
      </SeccionCard>

      {presupuesto && (
        <SeccionCard icon={FileText} titulo="Presupuesto aceptado">
          <dl className="grid grid-cols-1 gap-4 sm:grid-cols-2 sm:gap-6">
            {presupuesto.numeroPresupuesto && (
              <DetalleDato etiqueta="Número" valor={presupuesto.numeroPresupuesto} />
            )}
            <DetalleDato
              etiqueta="Base imponible"
              valor={formatearImporte(presupuesto.baseImponible)}
            />
            <DetalleDato etiqueta="IVA" valor={formatearImporte(presupuesto.ivaImporte)} />
            <DetalleDato etiqueta="Total" valor={formatearImporte(presupuesto.total)} />
          </dl>
        </SeccionCard>
      )}

      <SeccionCard icon={Receipt} titulo="Facturas">
        {facturas.length === 0 ? (
          <p className="font-body text-sm text-text-secondary">
            No hay facturas registradas en esta reserva.
          </p>
        ) : (
          <ul className="flex flex-col gap-3">
            {facturas.map((factura, i) => (
              <li
                key={factura.idFactura ?? i}
                className="flex flex-col gap-1 rounded-xl border border-border-default bg-canvas p-4 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="flex flex-col gap-0.5">
                  <span className="font-body text-sm font-semibold text-text-primary">
                    {factura.numeroFactura ?? etiquetaTipoFactura(factura.tipo)}
                  </span>
                  <span className="font-body text-xs text-text-secondary">
                    {etiquetaTipoFactura(factura.tipo)}
                  </span>
                </div>
                <span className="font-body text-sm font-semibold text-text-primary">
                  {formatearImporte(factura.total)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </SeccionCard>

      <SeccionCard icon={ClipboardCheck} titulo="Estado operativo">
        <dl className="grid grid-cols-1 gap-4 sm:grid-cols-2 sm:gap-6">
          {reserva.fianzaEur && (
            <DetalleDato etiqueta="Fianza" valor={formatearImporte(reserva.fianzaEur)} />
          )}
          {reserva.fianzaDevueltaEur && (
            <DetalleDato
              etiqueta="Fianza devuelta"
              valor={formatearImporte(reserva.fianzaDevueltaEur)}
            />
          )}
          {reserva.motivoRetencion && (
            <DetalleDato etiqueta="Motivo de retención" valor={reserva.motivoRetencion} />
          )}
          {typeof reserva.condPartFirmadas === 'boolean' && (
            <DetalleDato
              etiqueta="Condiciones firmadas"
              valor={reserva.condPartFirmadas ? 'Sí' : 'No'}
            />
          )}
        </dl>
      </SeccionCard>
    </>
  );
};
