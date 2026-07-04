import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Ban, X } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import { useRechazarFactura } from '../api/useRechazarFactura';
import { AvisoErrorFactura } from './AvisoErrorFactura';
import type { FacturaSenal } from '../model/types';

/**
 * Diálogo de **rechazo** del borrador de la factura de señal (US-022 · UC-18). Flujo:
 * abrir → indicar el motivo (OBLIGATORIO, no vacío) → **Rechazar** (POST al backend) o
 * **Cancelar**. La FACTURA permanece en `borrador` (el rechazo no cambia el estado); el
 * motivo se registra en `AUDIT_LOG` y E3 sigue bloqueado. El Gestor puede resolver la
 * incidencia (p. ej. corregir datos del tenant) y regenerar el PDF para revisar.
 *
 * Validación de cliente del motivo con **React Hook Form + Zod** (regla dura del
 * proyecto); el servidor revalida (400 motivo requerido / 409 no-borrador) y sus
 * errores se muestran inline (`AvisoErrorFactura`).
 *
 * Diseño: sin frame propio en Figma "Slotify"; se ADAPTA con los tokens del proyecto.
 * `Dialog` (shadcn/Radix) mobile-first; botones apilan en columna en móvil.
 */
type Props = {
  factura: FacturaSenal;
  abierto: boolean;
  onAbiertoChange: (abierto: boolean) => void;
  /** Se invoca con la factura (aún en `borrador`) tras un 200. */
  onRechazado: (factura: FacturaSenal) => void;
};

const MOTIVO_MIN = 3;
const MOTIVO_MAX = 500;

const esquema = z.object({
  motivo: z
    .string()
    .trim()
    .min(MOTIVO_MIN, 'Indica el motivo del rechazo (mínimo 3 caracteres).')
    .max(MOTIVO_MAX, `El motivo no puede superar los ${MOTIVO_MAX} caracteres.`),
});

type FormularioRechazo = z.infer<typeof esquema>;

const claseBotonPrimario =
  'inline-flex h-12 w-full items-center justify-center gap-2 rounded-full bg-red-600 px-8 font-display text-base text-white transition hover:opacity-95 disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto';

const claseBotonSecundario =
  'inline-flex h-12 w-full items-center justify-center gap-2 rounded-full border border-border-default bg-canvas px-8 font-body text-base font-medium text-text-secondary transition hover:bg-surface-muted disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto';

export const RechazarFacturaDialog = ({ factura, abierto, onAbiertoChange, onRechazado }: Props) => {
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<FormularioRechazo>({
    resolver: zodResolver(esquema),
    defaultValues: { motivo: '' },
  });

  const rechazar = useRechazarFactura();
  const { reset: resetRechazar } = rechazar;

  useEffect(() => {
    if (!abierto) {
      resetRechazar();
      reset({ motivo: '' });
    }
  }, [abierto, resetRechazar, reset]);

  const onSubmit = handleSubmit(({ motivo }) => {
    rechazar.mutate(
      { id: factura.idFactura, reservaId: factura.reservaId, motivo },
      {
        onSuccess: (rechazada) => {
          onRechazado(rechazada);
          onAbiertoChange(false);
        },
      },
    );
  });

  return (
    <Dialog open={abierto} onOpenChange={onAbiertoChange}>
      <DialogContent data-testid="dialog-rechazar-factura" className="max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Rechazar borrador de factura</DialogTitle>
          <DialogDescription>
            Indica el motivo del rechazo. La factura seguirá en borrador y el motivo quedará
            registrado. Podrás corregir la incidencia y regenerar el PDF para volver a revisar.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={onSubmit} noValidate className="flex flex-col gap-5">
          {rechazar.error && <AvisoErrorFactura error={rechazar.error} />}

          <div className="flex flex-col gap-2">
            <label
              htmlFor="rechazar-factura-motivo"
              className="px-1 font-body text-xs font-medium tracking-[0.48px] text-text-secondary"
            >
              Motivo del rechazo
            </label>
            <textarea
              id="rechazar-factura-motivo"
              rows={4}
              disabled={rechazar.isPending}
              data-testid="input-motivo-rechazo"
              aria-invalid={errors.motivo ? 'true' : undefined}
              aria-describedby={errors.motivo ? 'rechazar-factura-motivo-error' : undefined}
              className={cn(
                'w-full resize-y rounded-[16px] border bg-canvas px-4 py-3 font-body text-sm text-text-primary transition placeholder:text-text-secondary/60 focus:outline-none focus:ring-2 focus:ring-brand-primary',
                errors.motivo ? 'border-red-400' : 'border-border-default',
              )}
              placeholder="Ej.: Los datos fiscales del emisor son incorrectos."
              {...register('motivo')}
            />
            {errors.motivo && (
              <p
                id="rechazar-factura-motivo-error"
                role="alert"
                data-testid="error-motivo-rechazo"
                className="px-1 font-body text-[13px] text-red-600"
              >
                {errors.motivo.message}
              </p>
            )}
          </div>

          <DialogFooter className="flex-col gap-3 sm:flex-row">
            <button
              type="button"
              onClick={() => onAbiertoChange(false)}
              disabled={rechazar.isPending}
              data-testid="cancelar-rechazar-factura"
              className={claseBotonSecundario}
            >
              <X aria-hidden className="size-5" />
              Cancelar
            </button>
            <button
              type="submit"
              disabled={rechazar.isPending}
              data-testid="confirmar-rechazar-factura"
              className={claseBotonPrimario}
            >
              <Ban aria-hidden className="size-5" />
              {rechazar.isPending ? 'Rechazando…' : 'Rechazar borrador'}
            </button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
};
