import { useEffect } from 'react';
import { AlertTriangle, CheckCircle2, X } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { useFinalizarEvento } from '../api/useFinalizarEvento';
import { etiquetaDocumentacionPendiente } from '../lib/finalizarEvento';
import type { components } from '@/api-client';

type FinalizarEventoResponse = components['schemas']['FinalizarEventoResponse'];

/**
 * Diálogo de confirmación de la acción "Marcar evento como finalizado" (US-034 ·
 * UC-25). La finalización es **irreversible** (`evento_en_curso → post_evento`), por
 * lo que se exige confirmación explícita antes de ejecutarla.
 *
 * Advertencia NO bloqueante de documentación pendiente (US-034 FA-01, checklist de
 * US-033): si `documentacionPendiente` viene informada desde la ficha, se muestra
 * ANTES de confirmar como aviso enumerando los ítems sin subir; el gestor "puede
 * continuar igualmente". La confirmación NO se deshabilita por ello.
 *
 * Diseño: no hay frame propio de este diálogo en el archivo Figma "Slotify"; se
 * ADAPTA con los tokens del proyecto (`index.css` + `DESIGN.md`), reutilizando el
 * tratamiento de `ExtenderBloqueoDialog`/`ConfirmarSenalDialog`. El `Dialog`
 * (shadcn/Radix) es mobile-first (`w-[calc(100%-2rem)]`, `max-w-lg`, scroll interno
 * `max-h-[90vh]`) sin overflow horizontal; el pie apila en columna en móvil (`<sm`)
 * y pasa a fila en `sm:`. Objetivos táctiles ≥ 48px (`h-12`).
 */
type Props = {
  reservaId: string;
  /**
   * Ítems del checklist de documentación del evento pendientes (US-033). La ficha
   * los inyecta si conoce el estado del checklist antes de finalizar; puede llegar
   * vacío o indefinido (fail-open) — la respuesta del endpoint es la autoritativa.
   */
  documentacionPendiente?: string[];
  abierto: boolean;
  onAbiertoChange: (abierto: boolean) => void;
  /** Se invoca con la respuesta completa tras un 200 (RESERVA en post_evento + e5). */
  onFinalizado: (resultado: FinalizarEventoResponse) => void;
};

const claseBotonPrimario =
  'inline-flex h-12 w-full items-center justify-center gap-2 rounded-full bg-brand-primary px-8 font-display text-base text-brand-foreground transition hover:opacity-95 disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto';

const claseBotonSecundario =
  'inline-flex h-12 w-full items-center justify-center gap-2 rounded-full border border-border-default bg-canvas px-8 font-body text-base font-medium text-text-secondary transition hover:bg-surface-muted disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto';

export const FinalizarEventoDialog = ({
  reservaId,
  documentacionPendiente,
  abierto,
  onAbiertoChange,
  onFinalizado,
}: Props) => {
  const mutation = useFinalizarEvento();
  const { reset: resetMutation } = mutation;

  useEffect(() => {
    if (!abierto) resetMutation();
  }, [abierto, resetMutation]);

  const pendientes = documentacionPendiente ?? [];
  const hayPendientes = pendientes.length > 0;

  const confirmar = () => {
    // El error (conflicto/genérico) se muestra inline vía `mutation.error`; la
    // RESERVA no se modifica en un 409 (transición no permitida).
    mutation.mutate(
      { id: reservaId },
      {
        onSuccess: (resultado) => {
          onFinalizado(resultado);
          onAbiertoChange(false);
        },
      },
    );
  };

  return (
    <Dialog open={abierto} onOpenChange={onAbiertoChange}>
      <DialogContent
        data-testid="dialog-finalizar-evento"
        className="max-h-[90vh] overflow-y-auto"
      >
        <DialogHeader>
          <DialogTitle>Marcar evento como finalizado</DialogTitle>
          <DialogDescription>
            La reserva pasará a <strong>post-evento</strong> y esta acción es irreversible. Si hay
            fianza cobrada, se enviará al cliente el email de agradecimiento con la solicitud del
            IBAN para su devolución.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-5">
          {hayPendientes && (
            <div
              role="alert"
              data-testid="aviso-documentacion-pendiente"
              className="flex items-start gap-3 rounded-[16px] border border-amber-200 bg-amber-50 p-4 text-amber-800"
            >
              <AlertTriangle aria-hidden className="mt-0.5 size-5 shrink-0 text-amber-600" />
              <div className="flex flex-col gap-1 font-body text-sm">
                <p className="font-medium">Documentación pendiente:</p>
                <ul className="list-disc pl-5">
                  {pendientes.map((item) => (
                    <li key={item}>{etiquetaDocumentacionPendiente(item)}</li>
                  ))}
                </ul>
                <p>Puedes continuar igualmente; podrás subirla más tarde en la ficha.</p>
              </div>
            </div>
          )}

          {mutation.error && (
            <div
              role="alert"
              data-testid="aviso-error-finalizar-evento"
              className="flex items-start gap-3 rounded-[16px] border border-red-200 bg-red-50 p-4 text-red-700"
            >
              <AlertTriangle aria-hidden className="mt-0.5 size-5 shrink-0 text-red-600" />
              <p className="font-body text-sm">{mutation.error.mensaje}</p>
            </div>
          )}

          <DialogFooter className="flex-col gap-3 sm:flex-row">
            <button
              type="button"
              onClick={() => onAbiertoChange(false)}
              disabled={mutation.isPending}
              data-testid="cancelar-finalizar-evento"
              className={claseBotonSecundario}
            >
              <X aria-hidden className="size-5" />
              Cancelar
            </button>
            <button
              type="button"
              onClick={confirmar}
              disabled={mutation.isPending}
              data-testid="confirmar-finalizar-evento"
              className={claseBotonPrimario}
            >
              <CheckCircle2 aria-hidden className="size-5" />
              {mutation.isPending ? 'Finalizando…' : 'Finalizar evento'}
            </button>
          </DialogFooter>
        </div>
      </DialogContent>
    </Dialog>
  );
};
