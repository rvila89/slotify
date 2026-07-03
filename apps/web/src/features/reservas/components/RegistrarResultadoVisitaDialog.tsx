import { useEffect, useState } from 'react';
import { AlertTriangle, CalendarX2, CheckCircle2, ClipboardCheck, FileCheck } from 'lucide-react';
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
import type { Reserva } from '../model/types';

type ResultadoVisita = components['schemas']['ResultadoVisita'];

/**
 * Diálogo de la acción "Registrar resultado de visita" (US-009 · UC-08) sobre una
 * consulta en sub-estado `2v` (visita programada). Dispara la transición contra el
 * SDK generado (`PATCH /reservas/{id}/visita`, body `{ resultado }`).
 *
 * Alcance US-009: solo el resultado **"Cliente interesado"** (`interesado`, 2.v →
 * 2.b con TTL fresco + email E7) está OPERATIVO. Los otros resultados
 * (`reserva_inmediata`/`descarta`) son US-010/US-011: se muestran en la lista para
 * dejar la estructura preparada, pero quedan **deshabilitados** ("Próximamente") y
 * no se pueden confirmar; el servidor los rechazaría con 422 igualmente.
 *
 * Diseño: NO existe un frame propio de "ficha de consulta" ni de este diálogo en el
 * archivo Figma "Slotify" (el mapeo frame→US solo cubre el listado de Reservas
 * `0:523`/US-042). Se ADAPTA con los tokens del proyecto (`index.css` + `DESIGN.md`),
 * reutilizando el mismo tratamiento que `ProgramarVisitaDialog`/`ExtenderBloqueoDialog`:
 * superficie `bg-canvas`, bordes `border-default`, opciones `rounded-[12px]`,
 * tipografía Epilogue (display) + Manrope (body). El `Dialog` (shadcn/Radix) ya es
 * mobile-first (`w-[calc(100%-2rem)]` con margen lateral en móvil, `max-w-lg` en
 * pantallas mayores), sin overflow horizontal; objetivos táctiles ≥ 48px.
 *
 * Flujo:
 *  - 200 `2b`: éxito → `onResuelto(reserva)` (la ficha muestra el aviso) y cierra.
 *  - 422 `validacion`: la RESERVA ya no está en `2v` (barrido/otra pestaña) o
 *    resultado no soportado — aviso inline con el mensaje del servidor.
 *  - genérico (404/red): aviso de reintento.
 */
type Props = {
  reservaId: string;
  abierto: boolean;
  onAbiertoChange: (abierto: boolean) => void;
  /** Se invoca con la RESERVA actualizada (subEstado='2b') tras un 200. */
  onResuelto: (reserva: Reserva) => void;
};

type OpcionResultado = {
  valor: ResultadoVisita;
  titulo: string;
  descripcion: string;
  Icono: typeof CheckCircle2;
  /** Operativo en esta US. Los demás quedan preparados pero deshabilitados. */
  disponible: boolean;
};

/**
 * Estructura preparada para los tres resultados de visita. Solo `interesado` es
 * operativo en US-009; `reserva_inmediata`/`descarta` (US-010/US-011) quedan como
 * opciones no disponibles todavía.
 */
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
    titulo: 'Reserva inmediata',
    descripcion: 'El cliente confirma y se genera el presupuesto en el acto.',
    Icono: FileCheck,
    disponible: false,
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
  reservaId,
  abierto,
  onAbiertoChange,
  onResuelto,
}: Props) => {
  const mutation = useRegistrarResultadoVisita();
  const [seleccion, setSeleccion] = useState<ResultadoVisita>('interesado');
  const [errorInline, setErrorInline] = useState<string | null>(null);

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

  const manejarError = (err: RegistrarResultadoVisitaError) => {
    setErrorInline(err.mensaje);
  };

  const confirmar = () => {
    setErrorInline(null);
    mutation.mutate(
      { id: reservaId, resultado: seleccion },
      {
        onSuccess: (reserva) => {
          onResuelto(reserva);
          onAbiertoChange(false);
        },
        onError: manejarError,
      },
    );
  };

  return (
    <Dialog open={abierto} onOpenChange={onAbiertoChange}>
      <DialogContent data-testid="dialog-resultado-visita">
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
                  onChange={() => setSeleccion(valor)}
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

        {errorInline && (
          <div
            role="alert"
            data-testid="aviso-error-resultado-visita"
            className="flex items-start gap-3 rounded-[16px] border border-red-200 bg-red-50 p-4 text-red-700"
          >
            <AlertTriangle aria-hidden className="mt-0.5 size-5 shrink-0 text-red-600" />
            <p className="font-body text-sm">{errorInline}</p>
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
            disabled={mutation.isPending}
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
