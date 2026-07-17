import { useEffect, useState } from 'react';
import { AlertTriangle, ArrowRight, Play, ShieldAlert, X } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { useForzarInicioEvento } from '../api/useForzarInicioEvento';
import {
  etiquetaPrecondicionIncumplida,
  type PrecondicionInicioEvento,
} from '../lib/forzarInicioEvento';
import type { components } from '@/api-client';

type ForzarInicioEventoResponse = components['schemas']['ForzarInicioEventoResponse'];

/**
 * Diálogo de la acción "Forzar inicio del evento" (US-032 · UC-23 FA-01) con **doble
 * confirmación obligatoria** (design.md §D-6). Es el guardarraíl de UI del override
 * manual del gestor cuando alguna precondición del inicio de evento está incumplida:
 *  - **Paso 1 (aviso)**: enumera las precondiciones incumplidas y explica que el
 *    forzado asume el riesgo (los sub-procesos NO se resuelven, D-5). El gestor debe
 *    pulsar "Continuar" para avanzar; "Cancelar" cierra sin efectos (no-op).
 *  - **Paso 2 (confirmación)**: exige confirmación explícita antes de disparar el
 *    `POST`. "Cancelar"/"Atrás" no dispara nada (no-op). No es eludible por atajo: el
 *    POST solo se emite en el botón del paso 2.
 *
 * Manejo de respuestas (normalizado en `useForzarInicioEvento`): 200 → la ficha queda
 * en `evento_en_curso` (refetch) + `onForzado`; 409 `conflicto_estado` → aviso inline
 * "El evento ya está en curso…"; 422 `fecha_evento_no_es_hoy` → aviso inline (defensa,
 * no alcanzable desde el botón). La cancelación en cualquier paso es un no-op sin
 * efectos (no hay transición ni audit log).
 *
 * Diseño: no hay frame propio en el archivo Figma "Slotify" para este diálogo; se
 * ADAPTA con los tokens del proyecto reutilizando el tratamiento de
 * `FinalizarEventoDialog` (US-034). Mobile-first: `max-h-[90vh]` con scroll interno,
 * pie que apila en columna en móvil (`<sm`) y pasa a fila en `sm:`, objetivos
 * táctiles ≥48px (`h-12`), sin overflow horizontal.
 */
type Props = {
  reservaId: string;
  /** Precondiciones incumplidas derivadas en la ficha (`precondicionesIncumplidas`). */
  precondiciones: PrecondicionInicioEvento[];
  abierto: boolean;
  onAbiertoChange: (abierto: boolean) => void;
  /** Se invoca con la respuesta completa tras un 200 (RESERVA en evento_en_curso). */
  onForzado: (resultado: ForzarInicioEventoResponse) => void;
};

const claseBotonPrimario =
  'inline-flex h-12 w-full items-center justify-center gap-2 rounded-full bg-brand-primary px-8 font-display text-base text-brand-foreground transition hover:opacity-95 disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto';

const claseBotonPeligro =
  'inline-flex h-12 w-full items-center justify-center gap-2 rounded-full bg-red-600 px-8 font-display text-base text-white transition hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto';

const claseBotonSecundario =
  'inline-flex h-12 w-full items-center justify-center gap-2 rounded-full border border-border-default bg-canvas px-8 font-body text-base font-medium text-text-secondary transition hover:bg-surface-muted disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto';

export const ForzarInicioEventoDialog = ({
  reservaId,
  precondiciones,
  abierto,
  onAbiertoChange,
  onForzado,
}: Props) => {
  const mutation = useForzarInicioEvento();
  const { reset: resetMutation } = mutation;
  // Paso de la doble confirmación: 1 = aviso + precondiciones, 2 = confirmación final.
  const [paso, setPaso] = useState<1 | 2>(1);

  // Al cerrar (o reabrir), vuelve al paso 1 y limpia el error de la mutación: la
  // doble confirmación empieza siempre desde cero (no hay atajo al paso 2).
  useEffect(() => {
    if (!abierto) {
      setPaso(1);
      resetMutation();
    }
  }, [abierto, resetMutation]);

  const hayPrecondiciones = precondiciones.length > 0;

  const confirmar = () => {
    // El POST SOLO se dispara aquí (paso 2). El error (conflicto/fuera_de_dia/genérico)
    // se muestra inline vía `mutation.error`; en 409/422 la RESERVA no se modifica.
    mutation.mutate(
      { id: reservaId },
      {
        onSuccess: (resultado) => {
          onForzado(resultado);
          onAbiertoChange(false);
        },
      },
    );
  };

  return (
    <Dialog open={abierto} onOpenChange={onAbiertoChange}>
      <DialogContent
        data-testid="dialog-forzar-inicio-evento"
        className="max-h-[90vh] overflow-y-auto"
      >
        <DialogHeader>
          <DialogTitle>
            {paso === 1 ? 'Forzar inicio del evento' : 'Confirmar forzado del inicio'}
          </DialogTitle>
          <DialogDescription>
            {paso === 1 ? (
              <>
                Vas a iniciar el evento manualmente aunque no se cumplan todas las precondiciones. La
                reserva pasará a <strong>evento en curso</strong> y quedará registrado en la
                auditoría como forzado por el gestor.
              </>
            ) : (
              <>
                Esta acción es un <strong>override</strong>: los sub-procesos pendientes NO se
                resolverán y deberás gestionarlos aparte. ¿Seguro que quieres forzar el inicio?
              </>
            )}
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-5">
          {paso === 1 && hayPrecondiciones && (
            <div
              role="alert"
              data-testid="aviso-precondiciones-incumplidas"
              className="flex items-start gap-3 rounded-[16px] border border-amber-200 bg-amber-50 p-4 text-amber-800"
            >
              <AlertTriangle aria-hidden className="mt-0.5 size-5 shrink-0 text-amber-600" />
              <div className="flex flex-col gap-1 font-body text-sm">
                <p className="font-medium">Precondiciones incumplidas:</p>
                <ul className="list-disc pl-5">
                  {precondiciones.map((item) => (
                    <li key={item}>{etiquetaPrecondicionIncumplida(item)}</li>
                  ))}
                </ul>
                <p>
                  Estas tareas seguirán pendientes tras el forzado; podrás completarlas más tarde
                  desde la ficha.
                </p>
              </div>
            </div>
          )}

          {paso === 2 && (
            <div
              role="alert"
              data-testid="aviso-confirmacion-forzado"
              className="flex items-start gap-3 rounded-[16px] border border-red-200 bg-red-50 p-4 text-red-700"
            >
              <ShieldAlert aria-hidden className="mt-0.5 size-5 shrink-0 text-red-600" />
              <p className="font-body text-sm">
                Confirma que asumes el riesgo de iniciar el evento con precondiciones pendientes.
              </p>
            </div>
          )}

          {mutation.error && (
            <div
              role="alert"
              data-testid="aviso-error-forzar-inicio-evento"
              className="flex items-start gap-3 rounded-[16px] border border-red-200 bg-red-50 p-4 text-red-700"
            >
              <AlertTriangle aria-hidden className="mt-0.5 size-5 shrink-0 text-red-600" />
              <p className="font-body text-sm">{mutation.error.mensaje}</p>
            </div>
          )}

          <DialogFooter className="flex-col gap-3 sm:flex-row">
            <button
              type="button"
              onClick={() => (paso === 2 ? setPaso(1) : onAbiertoChange(false))}
              disabled={mutation.isPending}
              data-testid="cancelar-forzar-inicio-evento"
              className={claseBotonSecundario}
            >
              <X aria-hidden className="size-5" />
              {paso === 2 ? 'Atrás' : 'Cancelar'}
            </button>

            {paso === 1 ? (
              <button
                type="button"
                onClick={() => setPaso(2)}
                data-testid="continuar-forzar-inicio-evento"
                className={claseBotonPrimario}
              >
                Continuar
                <ArrowRight aria-hidden className="size-5" />
              </button>
            ) : (
              <button
                type="button"
                onClick={confirmar}
                disabled={mutation.isPending}
                data-testid="confirmar-forzar-inicio-evento"
                className={claseBotonPeligro}
              >
                <Play aria-hidden className="size-5" />
                {mutation.isPending ? 'Forzando…' : 'Forzar inicio del evento'}
              </button>
            )}
          </DialogFooter>
        </div>
      </DialogContent>
    </Dialog>
  );
};
