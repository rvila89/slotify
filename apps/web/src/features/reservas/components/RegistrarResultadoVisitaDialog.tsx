import { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  CalendarX2,
  CheckCircle2,
  ClipboardCheck,
  FileCheck,
  Info,
} from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import type { components } from '@/api-client';
import {
  useRegistrarResultadoVisita,
  type RegistrarResultadoVisitaError,
} from '../api/useRegistrarResultadoVisita';
import {
  ETIQUETA_CAMPO_OBLIGATORIO,
  camposObligatoriosFaltantes,
  type CampoObligatorio,
} from '../lib/datosObligatorios';
import type { Reserva, ReservaDetalle } from '../model/types';

type ResultadoVisita = components['schemas']['ResultadoVisita'];

/**
 * Diálogo de la acción "Registrar resultado de visita" (UC-08/UC-14 ·
 * US-009/US-010) sobre una consulta en sub-estado `2v` (visita programada).
 * Dispara la transición contra el SDK generado (`PATCH /reservas/{id}/visita`,
 * body `{ resultado }`).
 *
 * Resultados OPERATIVOS:
 *  - `interesado` (US-009): 2.v → 2.b con TTL fresco de consulta + email E7.
 *  - `reserva_inmediata` (US-010): 2.v → pre_reserva con TTL de 7 días, vaciado de
 *    cola A16 y validación de datos obligatorios UC-14 (sin email). Requiere que
 *    RESERVA (`fechaEvento`, `duracionHoras`, `tipoEvento`,
 *    `numAdultosNinosMayores4`) y CLIENTE (`dniNif`, `direccion`, `codigoPostal`,
 *    `poblacion`, `provincia`) estén completos.
 * `descarta` (US-011) queda deshabilitado ("Próximamente"); el servidor lo
 * rechazaría con 422 igualmente.
 *
 * UX de datos obligatorios (US-010 · decisión consistente con UC-14): como
 * `fechaEvento` no puede completarse desde este endpoint (su alta dispara el
 * bloqueo atómico por otro flujo), NO se completan los datos in-place aquí. En su
 * lugar se hace un **pre-chequeo en cliente** (`camposObligatoriosFaltantes`) que,
 * al seleccionar "Cliente quiere reservar ahora", muestra la lista de campos que
 * faltan y **bloquea la confirmación** hasta que estén completos (el gestor los
 * completa en la ficha / edición del cliente y reintenta). El servidor revalida y,
 * si aún faltan, devuelve el 422 `DATOS_FISCALES_INCOMPLETOS` con `camposFaltantes`,
 * que también se pinta. Mismo tratamiento que UC-14 FA-01.
 *
 * Diseño: NO existe un frame propio de "ficha de consulta" ni de este diálogo en el
 * archivo Figma "Slotify" (el mapeo frame→US de `docs/DESIGN.md` solo cubre Login
 * `0:3/0:304`, Calendario `0:86`, Nueva Reserva `0:382`, Reservas `0:523`,
 * Dashboard `0:742`). Se ADAPTA con los tokens del proyecto (`index.css` +
 * `DESIGN.md`), reutilizando el tratamiento de los demás diálogos de reservas:
 * superficie `bg-canvas`, bordes `border-default`, opciones `rounded-[12px]`,
 * tipografía Epilogue (display) + Manrope (body). El `Dialog` (shadcn/Radix) es
 * mobile-first (`w-[calc(100%-2rem)]`, `max-w-lg`, scroll interno), sin overflow
 * horizontal; objetivos táctiles ≥ 48px.
 */
type Props = {
  /** RESERVA en `2v` (detalle con CLIENTE) para el pre-chequeo de datos UC-14. */
  reserva: ReservaDetalle;
  abierto: boolean;
  onAbiertoChange: (abierto: boolean) => void;
  /** 200 con `interesado` (subEstado='2b'): la ficha muestra su aviso. */
  onResueltoInteresado: (reserva: Reserva) => void;
  /** 200 con `reserva_inmediata` (estado='pre_reserva'): la ficha muestra su aviso. */
  onResueltoReservaInmediata: (reserva: Reserva) => void;
};

type OpcionResultado = {
  valor: ResultadoVisita;
  titulo: string;
  descripcion: string;
  Icono: typeof CheckCircle2;
  /** Operativo en el frontend actual. `descarta` (US-011) queda deshabilitado. */
  disponible: boolean;
};

const OPCIONES: OpcionResultado[] = [
  {
    valor: 'interesado',
    titulo: 'Cliente interesado',
    descripcion:
      'Reanuda el bloqueo con un plazo fresco de decisión y envía la confirmación por email al cliente.',
    Icono: CheckCircle2,
    disponible: true,
  },
  {
    valor: 'reserva_inmediata',
    titulo: 'Cliente quiere reservar ahora',
    descripcion:
      'Pasa la consulta directamente a pre-reserva: bloquea la fecha 7 días y libera la cola de espera. Requiere los datos obligatorios completos.',
    Icono: FileCheck,
    disponible: true,
  },
  {
    valor: 'descarta',
    titulo: 'Cliente descarta',
    descripcion: 'El cliente no continúa; la fecha se libera.',
    Icono: CalendarX2,
    disponible: false,
  },
];

const claseBotonPrimario =
  'inline-flex h-12 items-center justify-center gap-2 rounded-full bg-brand-primary px-8 font-display text-base text-brand-foreground transition hover:opacity-95 disabled:cursor-not-allowed disabled:opacity-60';

const claseBotonSecundario =
  'inline-flex h-12 items-center justify-center gap-2 rounded-full border border-border-default bg-canvas px-8 font-body text-base font-medium text-text-secondary transition hover:bg-surface-muted disabled:cursor-not-allowed disabled:opacity-60';

export const RegistrarResultadoVisitaDialog = ({
  reserva,
  abierto,
  onAbiertoChange,
  onResueltoInteresado,
  onResueltoReservaInmediata,
}: Props) => {
  const mutation = useRegistrarResultadoVisita();
  const [seleccion, setSeleccion] = useState<ResultadoVisita>('interesado');
  const [errorInline, setErrorInline] = useState<RegistrarResultadoVisitaError | null>(null);

  // Pre-chequeo en cliente de los datos obligatorios UC-14 (espejo del backend).
  const faltantesCliente = useMemo(() => camposObligatoriosFaltantes(reserva), [reserva]);

  // `mutation.reset` es referencia estable en TanStack Query v5; el objeto completo
  // no lo es y NO debe entrar en deps (provocaría un bucle de render).
  const { reset: resetMutation } = mutation;

  useEffect(() => {
    if (!abierto) {
      resetMutation();
      setSeleccion('interesado');
      setErrorInline(null);
    }
  }, [abierto, resetMutation]);

  const esReservaInmediata = seleccion === 'reserva_inmediata';

  // Campos a mostrar: la lista autoritativa del 422 si ya llegó; si no, el pre-chequeo.
  const camposFaltantes: CampoObligatorio[] =
    errorInline?.tipo === 'datos-incompletos' ? errorInline.camposFaltantes : faltantesCliente;

  const datosIncompletos = esReservaInmediata && camposFaltantes.length > 0;

  const confirmar = () => {
    setErrorInline(null);
    // Guarda de cliente: no lanzar la mutación si el pre-chequeo detecta faltantes.
    if (datosIncompletos) {
      setErrorInline({
        tipo: 'datos-incompletos',
        camposFaltantes: faltantesCliente,
        mensaje:
          'Faltan datos obligatorios para reservar en el acto. Complétalos en la ficha del cliente y de la reserva antes de confirmar.',
      });
      return;
    }
    mutation.mutate(
      { id: reserva.idReserva, resultado: seleccion },
      {
        onSuccess: (actualizada) => {
          if (esReservaInmediata) onResueltoReservaInmediata(actualizada);
          else onResueltoInteresado(actualizada);
          onAbiertoChange(false);
        },
        onError: setErrorInline,
      },
    );
  };

  const mostrarChecklist = esReservaInmediata && camposFaltantes.length > 0;
  const mostrarErrorGenerico =
    errorInline && errorInline.tipo !== 'datos-incompletos' ? errorInline.mensaje : null;

  return (
    <Dialog open={abierto} onOpenChange={onAbiertoChange}>
      <DialogContent data-testid="dialog-resultado-visita" className="max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Registrar resultado de visita</DialogTitle>
          <DialogDescription>
            Indica cómo ha ido la visita al espacio. Al confirmar, se actualizará la consulta y se
            avisará al cliente cuando corresponda.
          </DialogDescription>
        </DialogHeader>

        <fieldset
          className="flex flex-col gap-3"
          aria-label="Resultado de la visita"
          disabled={mutation.isPending}
        >
          {OPCIONES.map(({ valor, titulo, descripcion, Icono, disponible }) => {
            const seleccionada = seleccion === valor;
            return (
              <label
                key={valor}
                data-testid={`opcion-resultado-${valor}`}
                aria-disabled={!disponible ? 'true' : undefined}
                className={cn(
                  'flex items-start gap-3 rounded-[12px] border p-4 transition',
                  disponible
                    ? 'cursor-pointer border-border-default/40 bg-canvas hover:bg-surface-muted'
                    : 'cursor-not-allowed border-border-default/20 bg-surface-muted/40 opacity-60',
                  seleccionada && disponible && 'border-brand-primary ring-2 ring-brand-primary/40',
                )}
              >
                <input
                  type="radio"
                  name="resultado-visita"
                  value={valor}
                  checked={seleccionada}
                  disabled={!disponible}
                  onChange={() => {
                    setSeleccion(valor);
                    setErrorInline(null);
                  }}
                  className="mt-1 size-4 shrink-0 accent-brand-primary"
                />
                <Icono
                  aria-hidden
                  className={cn(
                    'mt-0.5 size-5 shrink-0',
                    disponible ? 'text-brand-primary' : 'text-text-secondary',
                  )}
                />
                <span className="flex flex-1 flex-col gap-0.5">
                  <span className="flex flex-wrap items-center gap-2 font-display text-base text-text-primary">
                    {titulo}
                    {!disponible && (
                      <span className="rounded-full border border-border-default bg-surface-muted px-2 py-0.5 font-body text-[11px] font-medium uppercase tracking-wide text-text-secondary">
                        Próximamente
                      </span>
                    )}
                  </span>
                  <span className="font-body text-sm text-text-secondary">{descripcion}</span>
                </span>
              </label>
            );
          })}
        </fieldset>

        {/* US-010 UC-14 FA-01: datos obligatorios incompletos → checklist + bloqueo. */}
        {mostrarChecklist && (
          <div
            role="alert"
            data-testid="aviso-datos-incompletos"
            className="flex items-start gap-3 rounded-[16px] border border-amber-200 bg-amber-50 p-4 text-amber-900"
          >
            <Info aria-hidden className="mt-0.5 size-5 shrink-0 text-amber-600" />
            <div className="flex flex-1 flex-col gap-2 font-body text-sm">
              <p>
                Para reservar en el acto faltan datos obligatorios de la reserva y del cliente.
                Complétalos y vuelve a intentarlo:
              </p>
              <ul className="list-disc pl-5" data-testid="lista-campos-faltantes">
                {camposFaltantes.map((campo) => (
                  <li key={campo}>{ETIQUETA_CAMPO_OBLIGATORIO[campo] ?? campo}</li>
                ))}
              </ul>
            </div>
          </div>
        )}

        {mostrarErrorGenerico && (
          <div
            role="alert"
            data-testid="aviso-error-resultado-visita"
            className="flex items-start gap-3 rounded-[16px] border border-red-200 bg-red-50 p-4 text-red-700"
          >
            <AlertTriangle aria-hidden className="mt-0.5 size-5 shrink-0 text-red-600" />
            <p className="font-body text-sm">{mostrarErrorGenerico}</p>
          </div>
        )}

        <DialogFooter>
          <button
            type="button"
            onClick={() => onAbiertoChange(false)}
            className={claseBotonSecundario}
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={confirmar}
            disabled={mutation.isPending || datosIncompletos}
            aria-disabled={datosIncompletos ? 'true' : undefined}
            data-testid="confirmar-resultado-visita"
            className={claseBotonPrimario}
          >
            <ClipboardCheck aria-hidden className="size-5" />
            {mutation.isPending ? 'Registrando…' : 'Confirmar resultado'}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
