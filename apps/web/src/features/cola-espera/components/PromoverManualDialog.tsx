import { useEffect } from 'react';
import { AlertTriangle, ArrowUpToLine } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { usePromoverManual, type PromoverManualError } from '../api/usePromoverManual';
import type { ColaItem } from '../model/types';

/**
 * Diálogo de confirmación de la promoción manual (US-019 · UC-12 flujo alternativo
 * manual, actor Gestor). Confirma explícitamente una acción DESTRUCTIVA: promover la
 * consulta elegida a bloqueante EXPIRA forzosamente la bloqueante actual (a `2.x`,
 * terminal e irreversible). El copy deja claro ese efecto antes de disparar.
 *
 * Consume el SDK generado vía `usePromoverManual` (`POST /reservas/{id}/promover` con
 * `{ confirmado: true }`); tras el 200 invalida la query de la cola (en el hook) y se
 * cierra. Manejo de desenlaces:
 *  - 409 `conflicto` (arbitraje D-4): muestra "La cola ya fue actualizada
 *    automáticamente…" y el hook invalida la cola para recargar el estado real; el
 *    Gestor cierra el diálogo y decide de nuevo sobre la vista actualizada.
 *  - 422 `validacion` (FA-05): la consulta ya no está en cola.
 *  - 403 `sin_permiso`: sin rol Gestor.
 *  - genérico: reintento.
 * FA-04: "Cancelar" cierra sin ningún cambio de estado.
 *
 * Diseño: no existe frame propio de esta acción en el archivo Figma "Slotify" (el
 * mapeo frame→US no cubre la cola de espera); se ADAPTA con los tokens del proyecto,
 * reutilizando el tratamiento de `ExtenderBloqueoDialog`/`AnadirFechaDialog`. El
 * `Dialog` (shadcn/Radix) ya es mobile-first (`w-[calc(100%-2rem)]` con margen lateral
 * en móvil, `max-w-lg` en pantallas mayores), sin overflow horizontal; los botones son
 * objetivos táctiles ≥ 48px (`h-12`) y en `<sm` se apilan a ancho completo.
 */
type Props = {
  /** Consulta en `2.d` elegida para promover (null = diálogo cerrado, sin selección). */
  seleccionada: ColaItem | null;
  /** Id de la bloqueante actual (route param), para invalidar la query de la cola. */
  bloqueanteId: string;
  /** Nombre de la bloqueante actual, para nombrar en el copy la consulta que se expira. */
  bloqueanteNombre: string;
  abierto: boolean;
  onAbiertoChange: (abierto: boolean) => void;
};

const claseBotonPrimario =
  'inline-flex h-12 w-full items-center justify-center gap-2 rounded-full bg-brand-primary px-6 font-display text-base text-brand-foreground transition hover:opacity-95 disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto';

const claseBotonSecundario =
  'inline-flex h-12 w-full items-center justify-center gap-2 rounded-full border border-border-default bg-canvas px-6 font-body text-base font-medium text-text-secondary transition hover:bg-surface-muted disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto';

const mensajeError = (err: PromoverManualError): string => err.mensaje;

export const PromoverManualDialog = ({
  seleccionada,
  bloqueanteId,
  bloqueanteNombre,
  abierto,
  onAbiertoChange,
}: Props) => {
  const mutation = usePromoverManual();

  // `mutation.reset` es referencia estable en TanStack Query v5; el objeto completo no
  // lo es y NO debe entrar en deps (provocaría un bucle de render).
  const { reset: resetMutation } = mutation;

  useEffect(() => {
    if (!abierto) resetMutation();
  }, [abierto, resetMutation]);

  const confirmar = () => {
    if (!seleccionada) return;
    mutation.mutate(
      { id: seleccionada.idReserva, bloqueanteId },
      {
        onSuccess: () => onAbiertoChange(false),
      },
    );
  };

  return (
    <Dialog open={abierto} onOpenChange={onAbiertoChange}>
      <DialogContent data-testid="dialog-promover-manual">
        <DialogHeader>
          <div className="flex size-11 items-center justify-center rounded-full bg-amber-100 text-amber-700">
            <ArrowUpToLine aria-hidden className="size-5" />
          </div>
          <DialogTitle>Promover a bloqueante</DialogTitle>
          <DialogDescription>
            {seleccionada ? (
              <>
                Vas a promover a <strong>{seleccionada.clienteNombre}</strong> (
                {seleccionada.codigo}) como nueva consulta bloqueante de esta fecha.
              </>
            ) : (
              'Promueve esta consulta como nueva bloqueante de la fecha.'
            )}
          </DialogDescription>
        </DialogHeader>

        <div
          role="note"
          className="flex items-start gap-3 rounded-[16px] border border-amber-200 bg-amber-50 p-4 text-amber-900"
        >
          <AlertTriangle aria-hidden className="mt-0.5 size-5 shrink-0 text-amber-600" />
          <p className="font-body text-sm">
            Esta acción es <strong>irreversible</strong>: la consulta bloqueante actual
            {bloqueanteNombre ? (
              <>
                {' '}
                (<strong>{bloqueanteNombre}</strong>)
              </>
            ) : null}{' '}
            se expirará de inmediato y perderá la fecha. El resto de la cola se reordenará
            automáticamente.
          </p>
        </div>

        {mutation.isError ? (
          <div
            role="alert"
            data-testid="aviso-error-promover"
            className="flex items-start gap-3 rounded-[16px] border border-red-200 bg-red-50 p-4 text-red-700"
          >
            <AlertTriangle aria-hidden className="mt-0.5 size-5 shrink-0 text-red-600" />
            <p className="font-body text-sm">{mensajeError(mutation.error)}</p>
          </div>
        ) : null}

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
            disabled={mutation.isPending || !seleccionada}
            data-testid="confirmar-promover-manual"
            className={claseBotonPrimario}
          >
            <ArrowUpToLine aria-hidden className="size-5" />
            {mutation.isPending ? 'Promoviendo…' : 'Confirmar promoción'}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
