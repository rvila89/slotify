import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { CalendarCheck, CalendarPlus, Clock, Mail, User, X } from 'lucide-react';
import { useReserva } from './useReserva';
import { AnadirFechaDialog } from './AnadirFechaDialog';
import { formatearFecha, formatearFechaHora } from './fecha';
import { cn } from '@/lib/utils';
import type { components } from '@/api-client';

type Reserva = components['schemas']['Reserva'];

/**
 * Ficha de consulta (US-005 · UC-04). Muestra el detalle de una RESERVA y, cuando
 * está en sub-estado `2a` (consulta exploratoria), ofrece la acción "Añadir
 * fecha" que dispara la transición `2.a → 2.b/2.d` vía el SDK generado.
 *
 * Diseño: sin frame Figma propio para esta ficha; se ADAPTA con los tokens del
 * proyecto (`index.css`/`DESIGN.md`), reutilizando el lenguaje visual de
 * `NuevaConsultaPage` (secciones `rounded-[20px]` sobre `bg-canvas`, tipografía
 * Epilogue/Manrope, colores semánticos de estado de reserva). Mobile-first: una
 * columna en móvil, dos en `sm:`; paddings `p-4 sm:p-6 lg:p-8`; sin overflow
 * horizontal. El chrome (sidebar→drawer, hamburguesa) lo aporta el AppShell.
 *
 * Avisos por desenlace de la transición:
 *  - `2b`: confirmación de bloqueo provisional (+ email al cliente) con su `ttlExpiracion`.
 *  - `2d`: entrada en cola con `posicionCola`.
 * (Los desenlaces "no disponible" y "validación" se muestran dentro del diálogo;
 *  la oferta de cola aceptar/rechazar también vive en el diálogo.)
 */
const SUB_ESTADO_LABEL: Record<string, string> = {
  '2a': 'Consulta exploratoria',
  '2b': 'Consulta con fecha',
  '2c': 'Pendiente de invitados',
  '2d': 'En cola de espera',
  '2v': 'Visita programada',
  '2x': 'Descartada',
  '2y': 'No disponible',
  '2z': 'Cerrada',
};

const Badge = ({ subEstado }: { subEstado?: string }) => {
  if (!subEstado) return null;
  const tono =
    subEstado === '2b'
      ? 'border-state-confirmada/40 bg-state-confirmada/15 text-[#5b2615]'
      : subEstado === '2d'
        ? 'border-amber-200 bg-amber-50 text-amber-900'
        : 'border-border-default bg-surface-muted text-text-secondary';
  return (
    <span
      data-testid="badge-sub-estado"
      className={cn(
        'inline-flex items-center gap-2 rounded-full border px-3 py-1 font-body text-xs font-semibold',
        tono,
      )}
    >
      <span aria-hidden className="size-2 rounded-full bg-current opacity-70" />
      {SUB_ESTADO_LABEL[subEstado] ?? subEstado}
    </span>
  );
};

const Dato = ({ etiqueta, valor }: { etiqueta: string; valor: string }) => (
  <div className="flex flex-col gap-1">
    <dt className="font-body text-xs font-medium tracking-[0.48px] text-text-secondary">
      {etiqueta}
    </dt>
    <dd className="font-body text-base text-text-primary">{valor}</dd>
  </div>
);

const claseSeccion =
  'flex flex-col gap-6 rounded-[20px] border border-border-default/20 bg-surface-subtle/30 p-4 sm:p-6 lg:p-8';

export const FichaConsultaPage = () => {
  const { id } = useParams<{ id: string }>();
  const { data: reserva, isLoading, isError } = useReserva(id);

  const [dialogoAbierto, setDialogoAbierto] = useState(false);
  // RESERVA resultante de una transición exitosa: alimenta el aviso 2b/2d. La
  // query también se actualiza, pero conservamos el resultado para el banner.
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

      {/* Aviso de transición a 2b: bloqueo provisional + email al cliente. */}
      {resultado?.subEstado === '2b' && (
        <div
          role="status"
          data-testid="alerta-fecha-bloqueada"
          className="flex items-start gap-3 rounded-[16px] border border-emerald-200 bg-emerald-50 p-4 text-emerald-900"
        >
          <CalendarCheck aria-hidden className="mt-0.5 size-5 shrink-0 text-emerald-600" />
          <div className="flex-1">
            <p className="font-body text-sm font-bold">Fecha reservada provisionalmente</p>
            <p className="font-body text-sm">
              {resultado.fechaEvento ? (
                <>
                  La fecha <strong>{formatearFecha(resultado.fechaEvento)}</strong> ha quedado{' '}
                  <strong>bloqueada</strong> (bloqueo blando)
                  {resultado.ttlExpiracion
                    ? ` hasta el ${formatearFechaHora(resultado.ttlExpiracion)}`
                    : ''}
                  . Se ha enviado un email de confirmación al cliente. Confírmala antes de que
                  expire para no perder la reserva.
                </>
              ) : (
                'La fecha ha quedado bloqueada (bloqueo blando) y se ha enviado un email de confirmación al cliente.'
              )}
            </p>
          </div>
          <button
            type="button"
            aria-label="Cerrar aviso"
            onClick={() => setResultado(null)}
            className="rounded-full p-1 text-emerald-700 transition hover:bg-emerald-100"
          >
            <X aria-hidden className="size-4" />
          </button>
        </div>
      )}

      {/* Aviso de transición a 2d: entrada en cola con posición. */}
      {resultado?.subEstado === '2d' && (
        <div
          role="status"
          data-testid="alerta-cola"
          className="flex items-start gap-3 rounded-[16px] border border-amber-200 bg-amber-50 p-4 text-amber-900"
        >
          <Clock aria-hidden className="mt-0.5 size-5 shrink-0 text-amber-600" />
          <div className="flex-1">
            <p className="font-body text-sm font-bold">Consulta en cola de espera</p>
            <p className="font-body text-sm">
              {resultado.fechaEvento ? (
                <>
                  La fecha <strong>{formatearFecha(resultado.fechaEvento)}</strong> ya estaba
                  ocupada.{' '}
                </>
              ) : null}
              Tu consulta ha entrado en la cola en la{' '}
              <strong>posición {resultado.posicionCola}</strong>. Te avisaremos si la fecha se
              libera.
            </p>
          </div>
          <button
            type="button"
            aria-label="Cerrar aviso"
            onClick={() => setResultado(null)}
            className="rounded-full p-1 text-amber-700 transition hover:bg-amber-100"
          >
            <X aria-hidden className="size-4" />
          </button>
        </div>
      )}

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
