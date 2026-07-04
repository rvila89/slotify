import { useEffect } from 'react';
import { AlertTriangle, Lock } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { useCerrarFicha } from '../api/useCerrarFicha';
import type { CerrarFichaOperativaResponse } from '../model/types';

/**
 * Diálogo de confirmación de "Cerrar ficha" (US-025 · UC-20). El cierre NUNCA falla
 * por campos vacíos (D-6): al confirmar, si el backend devuelve `avisosCamposVacios`,
 * se propagan al padre para mostrarlos como aviso informativo (no bloqueante).
 *
 * Diseño ADAPTADO con los tokens del proyecto (sin frame propio en Figma "Slotify"),
 * reutilizando el tratamiento de los demás diálogos de dominio. El `Dialog`
 * (shadcn/Radix) ya es mobile-first (`w-[calc(100%-2rem)]` en móvil, `max-w-lg`
 * en pantallas mayores), sin overflow horizontal; objetivos táctiles ≥ 48px.
 */
type Props = {
  reservaId: string;
  abierto: boolean;
  onAbiertoChange: (abierto: boolean) => void;
  /** Se invoca con la respuesta del cierre (incluye `avisosCamposVacios`) tras un 200. */
  onCerrada: (respuesta: CerrarFichaOperativaResponse) => void;
};

const claseBotonPrimario =
  'inline-flex h-12 items-center justify-center gap-2 rounded-full bg-brand-primary px-8 font-display text-base text-brand-foreground transition hover:opacity-95 disabled:cursor-not-allowed disabled:opacity-60';

const claseBotonSecundario =
  'inline-flex h-12 items-center justify-center gap-2 rounded-full border border-border-default bg-canvas px-8 font-body text-base font-medium text-text-secondary transition hover:bg-surface-muted disabled:cursor-not-allowed disabled:opacity-60';

export const CerrarFichaDialog = ({
  reservaId,
  abierto,
  onAbiertoChange,
  onCerrada,
}: Props) => {
  const mutation = useCerrarFicha();
  const { reset: resetMutation } = mutation;

  useEffect(() => {
    if (!abierto) resetMutation();
  }, [abierto, resetMutation]);

  const onConfirmar = () => {
    mutation.mutate(
      { reservaId },
      {
        onSuccess: (respuesta) => {
          onCerrada(respuesta);
          onAbiertoChange(false);
        },
      },
    );
  };

  return (
    <Dialog open={abierto} onOpenChange={onAbiertoChange}>
      <DialogContent data-testid="dialog-cerrar-ficha">
        <DialogHeader>
          <DialogTitle>Cerrar ficha operativa</DialogTitle>
          <DialogDescription>
            Marcarás la ficha operativa como cerrada. El cierre no requiere la ficha
            completa: si quedan campos sin rellenar, se te avisará pero no bloqueará el
            cierre. Podrás seguir editando la ficha después.
          </DialogDescription>
        </DialogHeader>

        {mutation.isError && (
          <div
            role="alert"
            data-testid="aviso-error-cerrar-ficha"
            className="flex items-start gap-3 rounded-[16px] border border-red-200 bg-red-50 p-4 text-red-700"
          >
            <AlertTriangle aria-hidden className="mt-0.5 size-5 shrink-0 text-red-600" />
            <p className="font-body text-sm">
              No se ha podido cerrar la ficha. Inténtalo de nuevo.
            </p>
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
            onClick={onConfirmar}
            disabled={mutation.isPending}
            data-testid="confirmar-cerrar-ficha"
            className={claseBotonPrimario}
          >
            <Lock aria-hidden className="size-5" />
            {mutation.isPending ? 'Cerrando…' : 'Cerrar ficha'}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
