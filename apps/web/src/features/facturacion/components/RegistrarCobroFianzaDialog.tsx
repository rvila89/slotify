import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Banknote, Calendar, FileText, ShieldCheck, X } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import { useRegistrarCobroFianza } from '../api/useRegistrarCobroFianza';
import { hoyISO } from '../lib/fecha';
import { AvisoErrorCobroFianza } from './AvisoErrorCobroFianza';
import { ConfirmacionCobroNegociable } from './ConfirmacionCobroNegociable';
import type { RegistrarCobroFianzaCobrado } from '../model/types';

/**
 * Diálogo de **registro del cobro de fianza** en la ficha de la reserva (US-030 · UC-22 · D-4).
 * El Gestor introduce `importe`, `fechaCobro` y (opcional) la referencia de un justificante ya
 * subido; al confirmar, el backend crea el PAGO y avanza la fianza a `cobrada` de forma atómica.
 *
 * Política "Negociable" (design.md §D-2): si `fianzaStatus='pendiente'`, la primera petición
 * (sin `confirmarSinRecibo`) devuelve `confirmacion_requerida`; el diálogo muestra entonces el
 * AVISO de confirmación ("El recibo de fianza no ha sido enviado…") y, al confirmar, reintenta la
 * MISMA petición con `confirmarSinRecibo: true`. Al cancelar, no se realiza ninguna acción.
 *
 * Validación en cliente con React Hook Form + Zod (regla dura): `importe > 0` y
 * `fechaCobro ≤ fechaEvento`. El servidor revalida (`400 COBRO_INVALIDO`) y es la fuente de verdad.
 *
 * Diseño: sin frame propio en el archivo Figma "Slotify" para US-030; se ADAPTA con los tokens del
 * proyecto reutilizando el tratamiento de los diálogos de facturación (US-028/US-029). `Dialog`
 * (shadcn/Radix) mobile-first: los campos apilan en una columna en `<sm` y el pie pasa a fila en
 * `sm:`; objetivos táctiles ≥ 44px; sin overflow horizontal.
 */
type Props = {
  reservaId: string;
  /** Fecha del evento (`YYYY-MM-DD`), para acotar y validar `fechaCobro ≤ fechaEvento`. */
  fechaEvento?: string | null;
  abierto: boolean;
  onAbiertoChange: (abierto: boolean) => void;
  /** Se invoca con la respuesta tras un cobro efectivo (`resultado='cobrado'`). */
  onCobrado?: (resultado: RegistrarCobroFianzaCobrado) => void;
};

const IMPORTE_RE = /^\d+([.,]\d{1,2})?$/;

/** Normaliza el importe tecleado ("1.000,50" → "1000.50") al `Importe` del contrato. */
const aImporte = (valor: string): string => valor.trim().replace(/\./g, '').replace(',', '.');

const construirEsquema = (fechaEvento?: string | null) =>
  z.object({
    importe: z
      .string()
      .trim()
      .min(1, 'Introduce el importe cobrado.')
      .refine((v) => IMPORTE_RE.test(v), 'Introduce un importe válido (máx. 2 decimales).')
      .refine((v) => Number(aImporte(v)) > 0, 'El importe debe ser mayor que cero.'),
    fechaCobro: z
      .string()
      .min(1, 'Indica la fecha del cobro.')
      .refine(
        (v) => !fechaEvento || v <= fechaEvento,
        'La fecha de cobro no puede ser posterior a la del evento.',
      ),
    justificanteDocId: z.string().trim().optional(),
  });

type FormularioCobro = z.infer<ReturnType<typeof construirEsquema>>;

const claseBotonPrimario =
  'inline-flex h-12 w-full items-center justify-center gap-2 rounded-full bg-brand-primary px-8 font-display text-base text-brand-foreground transition hover:opacity-95 disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto';

const claseBotonSecundario =
  'inline-flex h-12 w-full items-center justify-center gap-2 rounded-full border border-border-default bg-canvas px-8 font-body text-base font-medium text-text-secondary transition hover:bg-surface-muted disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto';

const claseInput =
  'h-12 w-full rounded-[16px] border bg-canvas px-4 font-body text-sm text-text-primary transition placeholder:text-text-secondary/60 focus:outline-none focus:ring-2 focus:ring-brand-primary';

const claseLabel = 'px-1 font-body text-xs font-medium tracking-[0.48px] text-text-secondary';

export const RegistrarCobroFianzaDialog = ({
  reservaId,
  fechaEvento,
  abierto,
  onAbiertoChange,
  onCobrado,
}: Props) => {
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<FormularioCobro>({
    resolver: zodResolver(construirEsquema(fechaEvento)),
    defaultValues: { importe: '', fechaCobro: hoyISO(), justificanteDocId: '' },
  });

  const cobrar = useRegistrarCobroFianza();
  const { reset: resetCobrar } = cobrar;

  // Aviso "Negociable": el servidor pidió confirmación (`fianzaStatus='pendiente'`); guardamos
  // los datos ya validados para reintentar con `confirmarSinRecibo: true` sin volver al formulario.
  const [confirmacionNegociable, setConfirmacionNegociable] = useState<{
    mensaje: string;
    vars: { importe: string; fechaCobro: string; justificanteDocId?: string };
  } | null>(null);

  useEffect(() => {
    if (!abierto) {
      resetCobrar();
      setConfirmacionNegociable(null);
      reset({ importe: '', fechaCobro: hoyISO(), justificanteDocId: '' });
    }
  }, [abierto, resetCobrar, reset]);

  const registrar = (
    vars: { importe: string; fechaCobro: string; justificanteDocId?: string },
    confirmarSinRecibo: boolean,
  ) => {
    cobrar.mutate(
      { reservaId, ...vars, confirmarSinRecibo },
      {
        onSuccess: (resultado) => {
          if (resultado.resultado === 'confirmacion_requerida') {
            setConfirmacionNegociable({ mensaje: resultado.mensaje, vars });
            return;
          }
          setConfirmacionNegociable(null);
          onCobrado?.(resultado);
          onAbiertoChange(false);
        },
      },
    );
  };

  const onSubmit = handleSubmit(({ importe, fechaCobro, justificanteDocId }) => {
    const docId = justificanteDocId?.trim();
    registrar(
      { importe: aImporte(importe), fechaCobro, ...(docId ? { justificanteDocId: docId } : {}) },
      false,
    );
  });

  const onConfirmarNegociable = () => {
    if (confirmacionNegociable) registrar(confirmacionNegociable.vars, true);
  };

  return (
    <Dialog open={abierto} onOpenChange={onAbiertoChange}>
      <DialogContent data-testid="dialog-registrar-cobro-fianza" className="max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Registrar el cobro de la fianza</DialogTitle>
          <DialogDescription>
            Registra el importe recibido en concepto de fianza. El cobro se admite en cualquier
            momento hasta el día del evento; el justificante es opcional.
          </DialogDescription>
        </DialogHeader>

        {confirmacionNegociable ? (
          <ConfirmacionCobroNegociable
            mensaje={confirmacionNegociable.mensaje}
            error={cobrar.error}
            pendiente={cobrar.isPending}
            onCancelar={() => onAbiertoChange(false)}
            onConfirmar={onConfirmarNegociable}
          />
        ) : (
          <form onSubmit={onSubmit} noValidate className="flex flex-col gap-5">
            {cobrar.error && <AvisoErrorCobroFianza error={cobrar.error} />}

            <div className="flex flex-col gap-2">
              <label htmlFor="cobro-fianza-importe" className={claseLabel}>
                Importe cobrado (€)
              </label>
              <div className="relative">
                <Banknote
                  aria-hidden
                  className="pointer-events-none absolute left-4 top-1/2 size-4 -translate-y-1/2 text-text-secondary"
                />
                <input
                  id="cobro-fianza-importe"
                  type="text"
                  inputMode="decimal"
                  disabled={cobrar.isPending}
                  data-testid="input-importe-fianza"
                  aria-invalid={errors.importe ? 'true' : undefined}
                  aria-describedby={errors.importe ? 'cobro-fianza-importe-error' : undefined}
                  className={cn(claseInput, 'pl-11', errors.importe ? 'border-red-400' : 'border-border-default')}
                  placeholder="Ej.: 1.000,00"
                  {...register('importe')}
                />
              </div>
              {errors.importe && (
                <p id="cobro-fianza-importe-error" role="alert" data-testid="error-importe" className="px-1 font-body text-[13px] text-red-600">
                  {errors.importe.message}
                </p>
              )}
            </div>

            <div className="flex flex-col gap-2">
              <label htmlFor="cobro-fianza-fecha" className={claseLabel}>
                Fecha del cobro
              </label>
              <div className="relative">
                <Calendar
                  aria-hidden
                  className="pointer-events-none absolute left-4 top-1/2 size-4 -translate-y-1/2 text-text-secondary"
                />
                <input
                  id="cobro-fianza-fecha"
                  type="date"
                  max={fechaEvento ?? undefined}
                  disabled={cobrar.isPending}
                  data-testid="input-fecha-cobro"
                  aria-invalid={errors.fechaCobro ? 'true' : undefined}
                  aria-describedby={errors.fechaCobro ? 'cobro-fianza-fecha-error' : undefined}
                  className={cn(claseInput, 'pl-11', errors.fechaCobro ? 'border-red-400' : 'border-border-default')}
                  {...register('fechaCobro')}
                />
              </div>
              {errors.fechaCobro && (
                <p id="cobro-fianza-fecha-error" role="alert" data-testid="error-fecha-cobro" className="px-1 font-body text-[13px] text-red-600">
                  {errors.fechaCobro.message}
                </p>
              )}
            </div>

            <div className="flex flex-col gap-2">
              <label htmlFor="cobro-fianza-justificante" className={claseLabel}>
                Justificante de pago (opcional)
              </label>
              <div className="relative">
                <FileText
                  aria-hidden
                  className="pointer-events-none absolute left-4 top-1/2 size-4 -translate-y-1/2 text-text-secondary"
                />
                <input
                  id="cobro-fianza-justificante"
                  type="text"
                  disabled={cobrar.isPending}
                  data-testid="input-justificante-fianza"
                  className={cn(claseInput, 'pl-11', 'border-border-default')}
                  placeholder="Referencia del documento subido (opcional)"
                  {...register('justificanteDocId')}
                />
              </div>
              <p className="px-1 font-body text-xs text-text-secondary">
                Si recibes la fianza en efectivo el día del evento, puedes registrarla sin justificante.
              </p>
            </div>

            <DialogFooter className="flex-col gap-3 sm:flex-row">
              <button
                type="button"
                onClick={() => onAbiertoChange(false)}
                disabled={cobrar.isPending}
                data-testid="cancelar-cobro-fianza"
                className={claseBotonSecundario}
              >
                <X aria-hidden className="size-5" />
                Cancelar
              </button>
              <button
                type="submit"
                disabled={cobrar.isPending}
                data-testid="confirmar-cobro-fianza"
                className={claseBotonPrimario}
              >
                <ShieldCheck aria-hidden className="size-5" />
                {cobrar.isPending ? 'Registrando…' : 'Registrar cobro de fianza'}
              </button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
};
