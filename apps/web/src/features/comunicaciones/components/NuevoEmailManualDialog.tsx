import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Send, X } from 'lucide-react';
import { toast } from 'sonner';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import { useCrearEmailManual } from '../api/useCrearEmailManual';
import { esquemaEmailManual, type FormularioEmailManual } from '../lib/schema';
import { AvisoErrorComunicacion } from './AvisoErrorComunicacion';

/**
 * Diálogo "Nuevo email manual" (US-046 · UC-36). Redacta `asunto` y `cuerpo`
 * OBLIGATORIOS (React Hook Form + Zod, regla dura) y, al confirmar, crea y envía una
 * COMUNICACION `manual` al cliente de la RESERVA. El destinatario es el `CLIENTE.email`
 * (lo resuelve el backend); no se edita en la UI.
 *
 * Errores del contrato, inline:
 *  - 422 destinatario inválido → aviso recuperable (ámbar); no se crea nada.
 *  - 502 fallo del proveedor → aviso; la fila queda `fallido`, reintentable.
 *
 * Diseño adaptado con los tokens del proyecto (sin frame propio en Figma "Slotify").
 * Mobile-first (pie apila en `<sm`, campos a ancho completo, textarea redimensionable).
 */
type Props = {
  reservaId: string;
  abierto: boolean;
  onAbiertoChange: (abierto: boolean) => void;
};

const claseBotonPrimario =
  'inline-flex h-12 w-full items-center justify-center gap-2 rounded-full bg-brand-primary px-8 font-display text-base text-brand-foreground transition hover:opacity-95 disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto';

const claseBotonSecundario =
  'inline-flex h-12 w-full items-center justify-center gap-2 rounded-full border border-border-default bg-canvas px-8 font-body text-base font-medium text-text-secondary transition hover:bg-surface-muted disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto';

const claseInput =
  'w-full rounded-[16px] border bg-canvas px-4 py-3 font-body text-sm text-text-primary transition placeholder:text-text-secondary/60 focus:outline-none focus:ring-2 focus:ring-brand-primary';

export const NuevoEmailManualDialog = ({ reservaId, abierto, onAbiertoChange }: Props) => {
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<FormularioEmailManual>({
    resolver: zodResolver(esquemaEmailManual),
    defaultValues: { asunto: '', cuerpo: '' },
  });

  const crear = useCrearEmailManual();
  const { reset: resetCrear } = crear;

  useEffect(() => {
    if (!abierto) {
      resetCrear();
      reset({ asunto: '', cuerpo: '' });
    }
  }, [abierto, resetCrear, reset]);

  const onSubmit = handleSubmit(({ asunto, cuerpo }) => {
    crear.mutate(
      { reservaId, asunto, cuerpo },
      {
        onSuccess: () => {
          toast.success('Email manual enviado correctamente al cliente.');
          onAbiertoChange(false);
        },
      },
    );
  });

  return (
    <Dialog open={abierto} onOpenChange={onAbiertoChange}>
      <DialogContent
        data-testid="dialog-email-manual"
        className="max-h-[90vh] overflow-y-auto"
      >
        <DialogHeader>
          <DialogTitle>Nuevo email manual</DialogTitle>
          <DialogDescription>
            Redacta un email para el cliente de esta reserva. Se enviará y quedará registrado en
            las comunicaciones.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={onSubmit} noValidate className="flex flex-col gap-5">
          {crear.error && (
            <AvisoErrorComunicacion
              mensaje={crear.error.mensaje}
              recuperable={crear.error.tipo === 'destinatario'}
              testId="aviso-error-email-manual"
            />
          )}

          <div className="flex flex-col gap-2">
            <label
              htmlFor="email-manual-asunto"
              className="px-1 font-body text-xs font-medium tracking-[0.48px] text-text-secondary"
            >
              Asunto
            </label>
            <input
              id="email-manual-asunto"
              type="text"
              disabled={crear.isPending}
              data-testid="input-asunto-manual"
              aria-invalid={errors.asunto ? 'true' : undefined}
              aria-describedby={errors.asunto ? 'email-manual-asunto-error' : undefined}
              className={cn(claseInput, errors.asunto ? 'border-red-400' : 'border-border-default')}
              placeholder="Ej.: Información adicional sobre tu evento"
              {...register('asunto')}
            />
            {errors.asunto && (
              <p
                id="email-manual-asunto-error"
                role="alert"
                data-testid="error-asunto-manual"
                className="px-1 font-body text-[13px] text-red-600"
              >
                {errors.asunto.message}
              </p>
            )}
          </div>

          <div className="flex flex-col gap-2">
            <label
              htmlFor="email-manual-cuerpo"
              className="px-1 font-body text-xs font-medium tracking-[0.48px] text-text-secondary"
            >
              Cuerpo del email
            </label>
            <textarea
              id="email-manual-cuerpo"
              rows={8}
              disabled={crear.isPending}
              data-testid="input-cuerpo-manual"
              aria-invalid={errors.cuerpo ? 'true' : undefined}
              aria-describedby={errors.cuerpo ? 'email-manual-cuerpo-error' : undefined}
              className={cn(
                claseInput,
                'resize-y',
                errors.cuerpo ? 'border-red-400' : 'border-border-default',
              )}
              placeholder="Escribe aquí el mensaje para el cliente…"
              {...register('cuerpo')}
            />
            {errors.cuerpo && (
              <p
                id="email-manual-cuerpo-error"
                role="alert"
                data-testid="error-cuerpo-manual"
                className="px-1 font-body text-[13px] text-red-600"
              >
                {errors.cuerpo.message}
              </p>
            )}
          </div>

          <DialogFooter className="flex-col gap-3 sm:flex-row">
            <button
              type="button"
              onClick={() => onAbiertoChange(false)}
              disabled={crear.isPending}
              data-testid="cancelar-email-manual"
              className={claseBotonSecundario}
            >
              <X aria-hidden className="size-5" />
              Cancelar
            </button>
            <button
              type="submit"
              disabled={crear.isPending}
              data-testid="confirmar-email-manual"
              className={claseBotonPrimario}
            >
              <Send aria-hidden className="size-5" />
              {crear.isPending ? 'Enviando…' : 'Enviar email'}
            </button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
};
