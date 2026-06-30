import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { CalendarPlus, Mail, User } from 'lucide-react';
import { useReserva } from '../../api/useReserva';
import { AnadirFechaDialog } from '../../components/AnadirFechaDialog';
import { formatearFecha } from '../../lib/fecha';
import { Badge } from './components/Badge';
import { Dato } from './components/Dato';
import { AvisosTransicion } from './components/AvisosTransicion';
import type { Reserva } from '../../model/types';

const claseSeccion =
  'flex flex-col gap-6 rounded-[20px] border border-border-default/20 bg-surface-subtle/30 p-4 sm:p-6 lg:p-8';

/**
 * Ficha de consulta (US-005 · UC-04). Muestra el detalle de una RESERVA y, en
 * sub-estado `2a` (exploratoria), ofrece la acción "Añadir fecha" que dispara la
 * transición `2.a → 2.b/2.d` vía el diálogo de dominio. Los avisos del desenlace
 * (2b/2d) y los fragmentos visuales (badge, datos) viven en `components/`.
 */
export const FichaConsultaPage = () => {
  const { id } = useParams<{ id: string }>();
  const { data: reserva, isLoading, isError } = useReserva(id);

  const [dialogoAbierto, setDialogoAbierto] = useState(false);
  // RESERVA resultante de una transición exitosa: alimenta el aviso 2b/2d.
  const [resultado, setResultado] = useState<Reserva | null>(null);

  if (isLoading) {
    return (
      <p data-testid="ficha-cargando" className="font-body text-sm text-text-secondary">
        Cargando consulta…
      </p>
    );
  }

  if (isError || !reserva) {
    return (
      <div
        role="alert"
        data-testid="ficha-error"
        className="rounded-[16px] border border-red-200 bg-red-50 px-4 py-3 font-body text-sm text-red-700"
      >
        No se ha podido cargar la consulta. Comprueba el enlace o vuelve al listado.
      </div>
    );
  }

  const cliente = reserva.cliente;
  const nombreCliente = cliente
    ? `${cliente.nombre ?? ''} ${cliente.apellidos ?? ''}`.trim() || 'Cliente'
    : 'Cliente';
  const subEstado = reserva.subEstado;
  const esExploratoria = subEstado === '2a';

  return (
    <div className="mx-auto flex w-full max-w-[1000px] flex-col gap-6">
      <header className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="font-display text-2xl font-bold tracking-tight text-text-primary sm:text-3xl">
            Consulta {reserva.codigo}
          </h1>
          <Badge subEstado={subEstado} />
        </div>
        <p className="font-body text-sm text-text-secondary sm:text-base">
          Ficha del lead. Revisa los datos y, si es una consulta exploratoria, añade una fecha de
          evento para intentar reservarla.
        </p>
      </header>

      {resultado && <AvisosTransicion resultado={resultado} onCerrar={() => setResultado(null)} />}

      <section className={claseSeccion} aria-labelledby="ficha-cliente">
        <div id="ficha-cliente" className="flex items-center gap-3">
          <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-brand-primary/10 text-brand-primary">
            <User aria-hidden className="size-4" />
          </span>
          <h2 className="font-body text-xs font-bold uppercase tracking-[1.4px] text-text-secondary sm:text-sm">
            Datos del lead
          </h2>
        </div>
        <dl className="grid grid-cols-1 gap-4 sm:grid-cols-2 sm:gap-6">
          <Dato etiqueta="Cliente" valor={nombreCliente} />
          {cliente?.email && <Dato etiqueta="Email" valor={cliente.email} />}
          {cliente?.telefono && <Dato etiqueta="Teléfono" valor={cliente.telefono} />}
          <Dato etiqueta="Canal de entrada" valor={reserva.canalEntrada} />
          {reserva.tipoEvento && <Dato etiqueta="Tipo de evento" valor={reserva.tipoEvento} />}
          <Dato
            etiqueta="Fecha del evento"
            valor={reserva.fechaEvento ? formatearFecha(reserva.fechaEvento) : 'Sin asignar'}
          />
          {typeof reserva.posicionCola === 'number' && (
            <Dato etiqueta="Posición en cola" valor={`${reserva.posicionCola}`} />
          )}
        </dl>
      </section>

      <section className={claseSeccion} aria-labelledby="ficha-acciones">
        <div id="ficha-acciones" className="flex items-center gap-3">
          <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-brand-primary/10 text-brand-primary">
            <CalendarPlus aria-hidden className="size-4" />
          </span>
          <h2 className="font-body text-xs font-bold uppercase tracking-[1.4px] text-text-secondary sm:text-sm">
            Acciones
          </h2>
        </div>

        {esExploratoria ? (
          <div className="flex flex-col gap-3">
            <p className="font-body text-sm text-text-secondary">
              Esta consulta es exploratoria (sin fecha). Añade una fecha para intentar bloquearla;
              si está ocupada, podrás entrar en la cola de espera.
            </p>
            <button
              type="button"
              data-testid="boton-anadir-fecha"
              onClick={() => {
                setResultado(null);
                setDialogoAbierto(true);
              }}
              className="inline-flex h-14 w-full items-center justify-center gap-2 rounded-full bg-brand-primary px-10 font-display text-base text-brand-foreground transition hover:opacity-95 sm:w-auto sm:px-16"
            >
              <CalendarPlus aria-hidden className="size-5" />
              Añadir fecha
            </button>
          </div>
        ) : (
          <p className="flex items-start gap-3 font-body text-sm text-text-secondary">
            <Mail aria-hidden className="mt-0.5 size-5 shrink-0 text-text-secondary" />
            La acción "Añadir fecha" solo está disponible para consultas exploratorias (sub-estado
            2a). Esta consulta ya está en otro estado.
          </p>
        )}
      </section>

      {id && (
        <AnadirFechaDialog
          reservaId={id}
          abierto={dialogoAbierto}
          onAbiertoChange={setDialogoAbierto}
          onResuelto={setResultado}
        />
      )}
    </div>
  );
};
