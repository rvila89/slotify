import { useEffect, useMemo } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Percent, Send, X } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import { useAprobarEnviarLiquidacion } from '../api/useAprobarEnviarLiquidacion';
import { formatearEuros, formatearPorcentaje } from '../lib/dinero';
import { calcularDesglosePrevisto } from '../lib/descuento';
import { AvisoErrorLiquidacion } from './AvisoErrorLiquidacion';
import type { AprobarEnviarLiquidacionResponse, Factura } from '../model/types';

/**
 * Diálogo del **editor del borrador de liquidación** + acción "Aprobar y enviar" (US-028 ·
 * UC-21). El Gestor revisa el total y el desglose fiscal, opcionalmente aplica un **descuento
 * negociado** (con motivo) y confirma. La confirmación dispara la emisión atómica estado↔email
 * (E4 con ambos PDFs); si el envío falla (502/503) se muestra un error RECUPERABLE (nada cambió)
 * y puede reintentarse.
 *
 * El descuento se valida en cliente con **React Hook Form + Zod** (regla dura); el desglose
 * previsualizado (base/IVA/total) se recalcula en vivo con la misma fórmula que el backend
 * (`base=round(total/1.21,2)`, `iva=total−base`) SOLO para mostrar — el cálculo fiscal
 * definitivo lo hace el servidor, que revalida (`422 DESCUENTO_INVALIDO`).
 *
 * Diseño: no hay frame propio en el archivo Figma "Slotify" para US-028; se ADAPTA con los
 * tokens del proyecto reutilizando el tratamiento de los diálogos de facturación (US-022).
 * `Dialog` (shadcn/Radix) mobile-first; botones apilan en columna en móvil y el pie pasa a
 * fila en `sm:`. Objetivos táctiles ≥ 44px.
 */
type Props = {
  liquidacion: Factura;
  /** `true` si el recibo de fianza sigue en borrador (se emitirá junto con la liquidación). */
  fianzaPendiente: boolean;
  abierto: boolean;
  onAbiertoChange: (abierto: boolean) => void;
  /** Opcional: se invoca con la respuesta (liquidación emitida + status) tras un 200. */
  onEmitido?: (resultado: AprobarEnviarLiquidacionResponse) => void;
};

const MOTIVO_MAX = 500;

const esquema = z
  .object({
    // Campo de texto libre para admitir "," decimal; se normaliza a punto al enviar.
    descuento: z
      .string()
      .trim()
      .refine(
        (v) => v === '' || /^\d+([.,]\d{1,2})?$/.test(v),
        'Introduce un importe válido (máx. 2 decimales).',
      ),
    motivo: z.string().trim().max(MOTIVO_MAX, `Máximo ${MOTIVO_MAX} caracteres.`),
  })
  .refine((v) => v.motivo === '' || v.descuento !== '', {
    path: ['descuento'],
    message: 'Indica el importe del descuento al que corresponde el motivo.',
  });

type FormularioAprobar = z.infer<typeof esquema>;

const claseBotonPrimario =
  'inline-flex h-12 w-full items-center justify-center gap-2 rounded-full bg-brand-primary px-8 font-display text-base text-brand-foreground transition hover:opacity-95 disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto';

const claseBotonSecundario =
  'inline-flex h-12 w-full items-center justify-center gap-2 rounded-full border border-border-default bg-canvas px-8 font-body text-base font-medium text-text-secondary transition hover:bg-surface-muted disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto';

const claseFilaDesglose = 'flex items-center justify-between gap-4 font-body text-sm';

/** Normaliza el importe tecleado ("200,50") al `Importe` del contrato ("200.50"). */
const aImporte = (valor: string): string | undefined => {
  const limpio = valor.trim().replace(',', '.');
  return limpio === '' ? undefined : limpio;
};

export const AprobarEnviarLiquidacionDialog = ({
  liquidacion,
  fianzaPendiente,
  abierto,
  onAbiertoChange,
  onEmitido,
}: Props) => {
  const {
    register,
    handleSubmit,
    watch,
    reset,
    formState: { errors },
  } = useForm<FormularioAprobar>({
    resolver: zodResolver(esquema),
    defaultValues: { descuento: '', motivo: '' },
  });

  const aprobar = useAprobarEnviarLiquidacion();
  const { reset: resetAprobar } = aprobar;

  useEffect(() => {
    if (!abierto) {
      resetAprobar();
      reset({ descuento: '', motivo: '' });
    }
  }, [abierto, resetAprobar, reset]);

  const descuentoRaw = watch('descuento');

  const preview = useMemo(
    () => calcularDesglosePrevisto(liquidacion.total, aImporte(descuentoRaw ?? '')),
    [liquidacion.total, descuentoRaw],
  );

  const hayDescuento = Boolean(aImporte(descuentoRaw ?? ''));
  // Descuento presente pero preview nulo ⇒ dejaría el total ≤ 0 (espejo del 422 backend).
  const descuentoDejaTotalInvalido = hayDescuento && preview === null;

  const onSubmit = handleSubmit(({ descuento, motivo }) => {
    aprobar.mutate(
      {
        reservaId: liquidacion.reservaId,
        descuento: aImporte(descuento),
        motivo: motivo.trim() === '' ? undefined : motivo.trim(),
      },
      {
        onSuccess: (resultado) => {
          onEmitido?.(resultado);
          onAbiertoChange(false);
        },
      },
    );
  });

  const desgloseMostrado = preview ?? {
    baseImponible: liquidacion.baseImponible,
    ivaImporte: liquidacion.ivaImporte,
    total: liquidacion.total,
  };

  return (
    <Dialog open={abierto} onOpenChange={onAbiertoChange}>
      <DialogContent
        data-testid="dialog-aprobar-enviar-liquidacion"
        className="max-h-[90vh] overflow-y-auto"
      >
        <DialogHeader>
          <DialogTitle>Aprobar y enviar la factura de liquidación</DialogTitle>
          <DialogDescription>
            Revisa el importe y, si lo has negociado, aplica un descuento. Al aprobar, se emitirá
            la factura con su número fiscal y se enviará al cliente por email
            {fianzaPendiente ? ' junto con el recibo de fianza.' : '.'}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={onSubmit} noValidate className="flex flex-col gap-5">
          {aprobar.error && <AvisoErrorLiquidacion error={aprobar.error} />}

          <div className="flex flex-col gap-3 rounded-[16px] border border-border-default/50 bg-surface-subtle/40 p-4">
            <div className={claseFilaDesglose}>
              <span className="text-text-secondary">Base imponible</span>
              <strong data-testid="preview-base" className="font-display text-text-primary">
                {formatearEuros(desgloseMostrado.baseImponible)}
              </strong>
            </div>
            <div className={claseFilaDesglose}>
              <span className="text-text-secondary">
                IVA ({formatearPorcentaje(liquidacion.ivaPorcentaje)})
              </span>
              <strong data-testid="preview-iva" className="font-display text-text-primary">
                {formatearEuros(desgloseMostrado.ivaImporte)}
              </strong>
            </div>
            <div className="mt-1 flex items-center justify-between gap-4 border-t border-border-default/40 pt-3 font-body text-base">
              <span className="font-medium text-text-primary">Total a facturar</span>
              <strong data-testid="preview-total" className="font-display text-brand-primary">
                {formatearEuros(desgloseMostrado.total)}
              </strong>
            </div>
            {hayDescuento && preview && (
              <p data-testid="preview-descuento-aplicado" className="font-body text-xs text-text-secondary">
                Total original {formatearEuros(liquidacion.total)} − descuento{' '}
                {formatearEuros(aImporte(descuentoRaw ?? ''))}.
              </p>
            )}
          </div>

          <div className="flex flex-col gap-2">
            <label
              htmlFor="liquidacion-descuento"
              className="px-1 font-body text-xs font-medium tracking-[0.48px] text-text-secondary"
            >
              Descuento negociado (opcional)
            </label>
            <div
              className={cn(
                'flex items-center rounded-[16px] border bg-canvas pr-4 transition focus-within:ring-2 focus-within:ring-brand-primary',
                errors.descuento || descuentoDejaTotalInvalido
                  ? 'border-red-400'
                  : 'border-border-default',
              )}
            >
              <input
                id="liquidacion-descuento"
                type="text"
                inputMode="decimal"
                disabled={aprobar.isPending}
                data-testid="input-descuento"
                aria-invalid={errors.descuento || descuentoDejaTotalInvalido ? 'true' : undefined}
                aria-describedby={
                  errors.descuento || descuentoDejaTotalInvalido
                    ? 'liquidacion-descuento-error'
                    : undefined
                }
                className="h-12 w-full rounded-[16px] bg-transparent px-4 font-body text-sm text-text-primary placeholder:text-text-secondary/60 focus:outline-none"
                placeholder="Ej.: 200,00"
                {...register('descuento')}
              />
              <Percent aria-hidden className="size-4 shrink-0 text-text-secondary" />
            </div>
            {(errors.descuento || descuentoDejaTotalInvalido) && (
              <p
                id="liquidacion-descuento-error"
                role="alert"
                data-testid="error-descuento"
                className="px-1 font-body text-[13px] text-red-600"
              >
                {errors.descuento?.message ??
                  'El descuento no puede dejar el total en cero o negativo.'}
              </p>
            )}
          </div>

          <div className="flex flex-col gap-2">
            <label
              htmlFor="liquidacion-descuento-motivo"
              className="px-1 font-body text-xs font-medium tracking-[0.48px] text-text-secondary"
            >
              Motivo del descuento (opcional)
            </label>
            <textarea
              id="liquidacion-descuento-motivo"
              rows={2}
              disabled={aprobar.isPending}
              data-testid="input-motivo-descuento"
              aria-invalid={errors.motivo ? 'true' : undefined}
              className={cn(
                'w-full resize-y rounded-[16px] border bg-canvas px-4 py-3 font-body text-sm text-text-primary transition placeholder:text-text-secondary/60 focus:outline-none focus:ring-2 focus:ring-brand-primary',
                errors.motivo ? 'border-red-400' : 'border-border-default',
              )}
              placeholder="Ej.: Descuento comercial acordado con el cliente."
              {...register('motivo')}
            />
            {errors.motivo && (
              <p role="alert" className="px-1 font-body text-[13px] text-red-600">
                {errors.motivo.message}
              </p>
            )}
          </div>

          <DialogFooter className="flex-col gap-3 sm:flex-row">
            <button
              type="button"
              onClick={() => onAbiertoChange(false)}
              disabled={aprobar.isPending}
              data-testid="cancelar-aprobar-enviar"
              className={claseBotonSecundario}
            >
              <X aria-hidden className="size-5" />
              Cancelar
            </button>
            <button
              type="submit"
              disabled={aprobar.isPending || descuentoDejaTotalInvalido}
              data-testid="confirmar-aprobar-enviar"
              className={claseBotonPrimario}
            >
              <Send aria-hidden className="size-5" />
              {aprobar.isPending ? 'Emitiendo y enviando…' : 'Aprobar y enviar'}
            </button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
};
