import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { CheckCircle2, ClipboardList, Loader2, Lock, Save } from 'lucide-react';
import { notify } from '@/lib/notify';
import { useFichaOperativa } from '../api/useFichaOperativa';
import { useGuardarFicha } from '../api/useGuardarFicha';
import {
  construirRequest,
  esquemaFicha,
  numPersonasDerivado,
  valoresDesdeFicha,
  type FormularioFicha,
} from '../lib/schema';
import { mensajeRecalculo, requierePrecioManual } from '../lib/recalculo';
import { formatearFechaHoraCierre } from '../lib/fecha';
import { EstadoFichaBadge } from './EstadoFichaBadge';
import { FichaNoDisponible } from './FichaNoDisponible';
import { CamposFicha } from './CamposFicha';
import { BloquePrecioManual } from './BloquePrecioManual';
import { AvisoRecalculo } from './AvisoRecalculo';
import { CerrarFichaDialog } from './CerrarFichaDialog';
import { AvisoCamposVacios } from './AvisoCamposVacios';
import type { FichaOperativa, RecalculoResultado } from '../model/types';

/**
 * Tarjeta "Ficha operativa del evento" (US-025 · UC-20) para la ficha de una RESERVA
 * en `reserva_confirmada` (o posterior). Orquesta:
 *  - carga de la ficha (query; el 409 `ficha_no_disponible` se muestra como mensaje
 *    contextual en lugar del formulario);
 *  - formulario RHF + Zod con los 7 campos (guardado parcial; el backend transiciona
 *    `pendiente → en_curso` al primer guardado con datos);
 *  - indicador de estado (pendiente/en curso/cerrada) que refleja el `preEventoStatus`
 *    devuelto por el backend;
 *  - "Cerrar ficha" con confirmación; si el cierre devuelve `avisosCamposVacios`, se
 *    muestran como aviso informativo (no bloqueante) y la fecha de cierre;
 *  - edición permitida tras el cierre (persiste; el estado permanece `cerrado`).
 *
 * Diseño ADAPTADO con los tokens del proyecto (sin frame propio en Figma "Slotify").
 * Mobile-first: campos en una columna que pasan a dos en `sm:`, acciones apiladas en
 * `<sm` sin overflow horizontal; objetivos táctiles ≥ 48px.
 */
type Props = {
  reservaId: string;
};

const claseSeccion =
  'flex flex-col gap-6 rounded-[20px] border border-border-default/20 bg-surface-subtle/30 p-4 sm:p-6 lg:p-8';

const claseBotonPrimario =
  'inline-flex h-11 w-full items-center justify-center gap-2 rounded-full bg-brand-primary px-6 font-display text-sm text-brand-foreground transition hover:opacity-95 disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto';

const claseBotonSecundario =
  'inline-flex h-11 w-full items-center justify-center gap-2 rounded-full border border-border-default bg-canvas px-6 font-body text-sm font-medium text-text-secondary transition hover:bg-surface-muted disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto';

const Encabezado = ({ ficha }: { ficha?: FichaOperativa }) => (
  <div className="flex flex-wrap items-center justify-between gap-3">
    <div className="flex items-center gap-3">
      <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-brand-primary/10 text-brand-primary">
        <ClipboardList aria-hidden className="size-4" />
      </span>
      <h2 className="font-body text-xs font-bold uppercase tracking-[1.4px] text-text-secondary sm:text-sm">
        Ficha operativa del evento
      </h2>
    </div>
    {ficha && <EstadoFichaBadge estado={ficha.preEventoStatus} />}
  </div>
);

export const FichaOperativaCard = ({ reservaId }: Props) => {
  const { data: estado, isLoading, isError } = useFichaOperativa(reservaId);
  const guardar = useGuardarFicha();

  const [dialogoCerrar, setDialogoCerrar] = useState(false);
  const [camposVacios, setCamposVacios] = useState<string[] | null>(null);
  const [guardadoOk, setGuardadoOk] = useState(false);
  const [recalculo, setRecalculo] = useState<RecalculoResultado | null>(null);
  const [pidePrecioManual, setPidePrecioManual] = useState(false);

  const ficha = estado?.tipo === 'disponible' ? estado.ficha : undefined;

  const { register, handleSubmit, reset, watch, formState } = useForm<FormularioFicha>({
    resolver: zodResolver(esquemaFicha),
    values: valoresDesdeFicha(ficha),
  });

  const numPersonas = numPersonasDerivado(watch());

  const onSubmit = handleSubmit((valores) => {
    setGuardadoOk(false);
    guardar.mutate(
      { reservaId, body: construirRequest(valores) },
      {
        onSuccess: ({ recalculo: resultado, ...fichaGuardada }) => {
          reset(valoresDesdeFicha(fichaGuardada));
          setGuardadoOk(true);

          if (resultado && requierePrecioManual(resultado)) {
            // Tramo +51 o sin TARIFA: el gestor debe introducir el precio manual y
            // reenviar. No mostramos precio recalculado (el motor no lo resolvió).
            setRecalculo(null);
            setPidePrecioManual(true);
            notify.warning(
              'Este aforo no tiene tarifa automática. Introduce el precio manual y guarda de nuevo.',
            );
            return;
          }

          setPidePrecioManual(false);
          setRecalculo(resultado ?? null);
          if (resultado) notify.success(mensajeRecalculo(resultado));
        },
      },
    );
  });

  if (isLoading) {
    return (
      <section className={claseSeccion} aria-labelledby="ficha-operativa">
        <div id="ficha-operativa">
          <Encabezado />
        </div>
        <p
          data-testid="ficha-operativa-cargando"
          className="flex items-center gap-2 font-body text-sm text-text-secondary"
        >
          <Loader2 aria-hidden className="size-4 animate-spin" />
          Cargando ficha operativa…
        </p>
      </section>
    );
  }

  if (isError || !estado) {
    return (
      <section className={claseSeccion} aria-labelledby="ficha-operativa">
        <div id="ficha-operativa">
          <Encabezado />
        </div>
        <p
          role="alert"
          data-testid="ficha-operativa-error"
          className="rounded-[16px] border border-red-200 bg-red-50 px-4 py-3 font-body text-sm text-red-700"
        >
          No se ha podido cargar la ficha operativa. Inténtalo de nuevo.
        </p>
      </section>
    );
  }

  // 409 `ficha_no_disponible` (D-3): la RESERVA aún no está confirmada.
  if (estado.tipo === 'no-disponible') return <FichaNoDisponible />;

  const fichaActual = estado.ficha;
  const cerrada = fichaActual.fichaCerrada;

  return (
    <section
      className={claseSeccion}
      aria-labelledby="ficha-operativa"
      data-testid="ficha-operativa-card"
      data-estado={fichaActual.preEventoStatus}
    >
      <div id="ficha-operativa">
        <Encabezado ficha={fichaActual} />
      </div>

      {cerrada && fichaActual.fechaCierre && (
        <p
          role="status"
          data-testid="ficha-fecha-cierre"
          className="flex items-start gap-2 rounded-[16px] border border-emerald-200 bg-emerald-50 p-4 font-body text-sm text-emerald-800"
        >
          <Lock aria-hidden className="mt-0.5 size-4 shrink-0 text-emerald-600" />
          Ficha cerrada el {formatearFechaHoraCierre(fichaActual.fechaCierre)}. Puedes
          seguir editando los campos; el cierre se mantiene.
        </p>
      )}

      {camposVacios && (
        <AvisoCamposVacios campos={camposVacios} onCerrar={() => setCamposVacios(null)} />
      )}

      {recalculo && !recalculo.tarifaAConsultar && (
        <AvisoRecalculo recalculo={recalculo} onCerrar={() => setRecalculo(null)} />
      )}

      <form onSubmit={onSubmit} noValidate className="flex flex-col gap-6">
        <CamposFicha
          register={register}
          errors={formState.errors}
          numPersonas={numPersonas}
        />

        {pidePrecioManual && (
          <BloquePrecioManual register={register} errors={formState.errors} />
        )}

        {guardar.isError && (
          <p
            role="alert"
            data-testid="ficha-guardar-error"
            className="rounded-[16px] border border-red-200 bg-red-50 px-4 py-3 font-body text-sm text-red-700"
          >
            No se ha podido guardar la ficha. Inténtalo de nuevo.
          </p>
        )}

        {guardadoOk && !guardar.isPending && (
          <p
            role="status"
            data-testid="ficha-guardado-ok"
            className="flex items-center gap-2 font-body text-sm text-emerald-700"
          >
            <CheckCircle2 aria-hidden className="size-4 shrink-0" />
            Cambios guardados.
          </p>
        )}

        <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:justify-end">
          {!cerrada && (
            <button
              type="button"
              onClick={() => setDialogoCerrar(true)}
              data-testid="abrir-cerrar-ficha"
              className={claseBotonSecundario}
            >
              <Lock aria-hidden className="size-5" />
              Cerrar ficha
            </button>
          )}
          <button
            type="submit"
            disabled={guardar.isPending}
            data-testid="guardar-ficha"
            className={claseBotonPrimario}
          >
            <Save aria-hidden className="size-5" />
            {guardar.isPending ? 'Guardando…' : 'Guardar cambios'}
          </button>
        </div>
      </form>

      <CerrarFichaDialog
        reservaId={reservaId}
        abierto={dialogoCerrar}
        onAbiertoChange={setDialogoCerrar}
        onCerrada={(respuesta) => setCamposVacios(respuesta.avisosCamposVacios)}
      />
    </section>
  );
};
