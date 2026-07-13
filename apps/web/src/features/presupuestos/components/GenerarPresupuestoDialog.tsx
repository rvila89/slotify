import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { FileText, Loader2 } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import { useConfirmarPresupuesto } from '../api/useConfirmarPresupuesto';
import { useExtras } from '../api/useExtras';
import { useBorradorPresupuesto } from '../lib/useBorradorPresupuesto';
import { AvisoErrorPresupuesto } from './AvisoErrorPresupuesto';
import { DesglosePresupuesto } from './DesglosePresupuesto';
import { SelectorExtras } from './SelectorExtras';
import type { ConfirmarPresupuestoResponse, PresupuestoExtraInput } from '../model/types';

/**
 * Diálogo "Generar presupuesto" (US-014 · UC-14 §5.1–5.4). Flujo:
 * abrir → **preview** (no persiste) → editar extras / precio manual →
 * **Confirmar** (persiste: PRESUPUESTO + `pre_reserva` + bloqueo 7d + E2) o
 * **Cancelar** (descarta el borrador, sin efecto — FA-03).
 *
 * El campo de precio manual solo se muestra (y es obligatorio) cuando el motor
 * devuelve `tarifaAConsultar=true` (>50 invitados, FA-02). Los errores del
 * contrato se muestran inline (`AvisoErrorPresupuesto`).
 *
 * Formulario con **React Hook Form + Zod** (regla dura del proyecto, coherente con
 * `ExtenderBloqueoDialog`/`AnadirFechaDialog`): el precio manual se valida en cliente
 * (no negativo; > 0 obligatorio si `tarifaAConsultar`).
 * Los extras son un mapa dinámico y se gestionan aparte en `useBorradorPresupuesto`.
 * El servidor revalida de forma defensiva (409/422).
 *
 * Diseño: no hay frame propio de este diálogo en el archivo Figma "Slotify"; se
 * ADAPTA con los tokens del proyecto (`index.css` + `DESIGN.md`), reutilizando el
 * tratamiento de los diálogos de reservas. El `Dialog` (shadcn/Radix) es
 * mobile-first (`w-[calc(100%-2rem)]`, `max-w-lg`, scroll interno) sin overflow
 * horizontal; objetivos táctiles ≥ 44px.
 */
type Props = {
  reservaId: string;
  abierto: boolean;
  onAbiertoChange: (abierto: boolean) => void;
  /** Se invoca con la respuesta de confirmación tras un 201 (RESERVA en pre_reserva). */
  onConfirmado: (resultado: ConfirmarPresupuestoResponse) => void;
};

const MENSAJE_NO_NEGATIVO = 'Introduce un importe válido (0 o superior)';

const esquema = z.object({
  precioManual: z
    .string()
    .refine(
      (v) => v.trim() === '' || (Number.isFinite(Number(v)) && Number(v) >= 0),
      MENSAJE_NO_NEGATIVO,
    ),
});

type FormularioPresupuesto = z.infer<typeof esquema>;

const claseBotonPrimario =
  'inline-flex h-12 items-center justify-center gap-2 rounded-full bg-accent-success px-8 font-display text-base text-accent-success-foreground transition hover:opacity-95 disabled:cursor-not-allowed disabled:opacity-60';

const claseBotonSecundario =
  'inline-flex h-12 items-center justify-center gap-2 rounded-full border border-border-default bg-canvas px-8 font-body text-base font-medium text-text-secondary transition hover:bg-surface-muted disabled:cursor-not-allowed disabled:opacity-60';

const claseLabel = 'px-1 font-body text-xs font-medium tracking-[0.48px] text-text-secondary';

const claseInput =
  'h-12 w-full rounded-[12px] border border-border-default/30 bg-canvas px-4 font-body text-base text-text-primary outline-none ring-1 ring-transparent transition focus-visible:ring-2 focus-visible:ring-brand-primary aria-[invalid=true]:ring-2 aria-[invalid=true]:ring-red-500';

export const GenerarPresupuestoDialog = ({
  reservaId,
  abierto,
  onAbiertoChange,
  onConfirmado,
}: Props) => {
  const {
    register,
    handleSubmit,
    watch,
    reset,
    setError,
    formState: { errors },
  } = useForm<FormularioPresupuesto>({
    resolver: zodResolver(esquema),
    defaultValues: { precioManual: '' },
  });

  const precioManual = watch('precioManual');

  const { cantidades, cambiarCantidad, extrasInput, preview } = useBorradorPresupuesto(
    reservaId,
    abierto,
    { precioManual },
  );
  const { data: extras = [], isLoading: cargandoExtras } = useExtras(abierto);
  const confirmar = useConfirmarPresupuesto();

  const { reset: resetConfirmar } = confirmar;

  // Al cerrar, limpia el formulario y el estado de la mutación de confirmación.
  useEffect(() => {
    if (!abierto) {
      resetConfirmar();
      reset({ precioManual: '' });
    }
  }, [abierto, resetConfirmar, reset]);

  const borrador = preview.data;
  const tarifaAConsultar = borrador?.tarifaAConsultar ?? false;
  const errorActivo = confirmar.error ?? preview.error ?? null;

  const construirBodyConfirmar = () => {
    const body: {
      extras: PresupuestoExtraInput[];
      precioManualEur?: string;
    } = { extras: extrasInput };
    if (tarifaAConsultar && precioManual.trim() !== '') body.precioManualEur = precioManual;
    return body;
  };

  const onSubmit = handleSubmit(() => {
    // FA-02: con tarifa a consultar, el precio manual (> 0) es obligatorio en cliente.
    if (tarifaAConsultar && (precioManual.trim() === '' || Number(precioManual) <= 0)) {
      setError('precioManual', {
        message: 'Introduce el precio manual (mayor que 0) para esta consulta de más de 50 invitados.',
      });
      return;
    }
    confirmar.mutate(
      { id: reservaId, body: construirBodyConfirmar() },
      {
        onSuccess: (resultado) => {
          onConfirmado(resultado);
          onAbiertoChange(false);
        },
      },
    );
  });

  // Confirmar deshabilitado si: no hay desglose calculado, o falta el precio
  // manual obligatorio (FA-02), o alguna mutación está en curso.
  const faltaPrecioManual = tarifaAConsultar && precioManual.trim() === '';
  const confirmarDeshabilitado =
    !borrador?.desglose || faltaPrecioManual || confirmar.isPending || preview.isPending;

  return (
    <Dialog open={abierto} onOpenChange={onAbiertoChange}>
      <DialogContent
        data-testid="dialog-generar-presupuesto"
        className="max-h-[90vh] max-w-2xl overflow-y-auto"
      >
        <DialogHeader>
          <DialogTitle>Generar presupuesto</DialogTitle>
          <DialogDescription>
            Revisa el borrador calculado con la tarifa vigente. Ajusta los extras; al
            confirmar se creará el presupuesto y la reserva pasará a pre-reserva (bloqueo de 7 días).
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={onSubmit} noValidate className="flex flex-col gap-5">
          {errorActivo && <AvisoErrorPresupuesto error={errorActivo} />}

          <section className="flex flex-col gap-3">
            <h3 className={claseLabel}>Extras</h3>
            {cargandoExtras ? (
              <p className="font-body text-sm text-text-secondary">Cargando catálogo de extras…</p>
            ) : (
              <SelectorExtras
                extras={extras}
                cantidades={cantidades}
                onCambiar={cambiarCantidad}
                deshabilitado={confirmar.isPending}
              />
            )}
          </section>

          {tarifaAConsultar && (
            <div className="flex flex-col gap-2">
              <label htmlFor="presupuesto-precio-manual" className={claseLabel}>
                Precio manual (€, IVA incluido) — requerido
              </label>
              <input
                id="presupuesto-precio-manual"
                type="number"
                inputMode="decimal"
                min={0}
                step="0.01"
                disabled={confirmar.isPending}
                aria-invalid={errors.precioManual || faltaPrecioManual ? 'true' : undefined}
                aria-describedby={
                  errors.precioManual ? 'presupuesto-precio-manual-error' : undefined
                }
                {...register('precioManual')}
                placeholder="0.00"
                data-testid="input-precio-manual"
                className={claseInput}
              />
              {errors.precioManual ? (
                <p
                  id="presupuesto-precio-manual-error"
                  role="alert"
                  className="px-1 font-body text-[13px] text-red-600"
                >
                  {errors.precioManual.message}
                </p>
              ) : (
                <p className="px-1 font-body text-[13px] text-text-secondary">
                  Esta consulta supera los 50 invitados: la tarifa es a consultar. Introduce el
                  precio total acordado para calcular el desglose.
                </p>
              )}
            </div>
          )}

          {preview.isPending && !borrador && (
            <p
              data-testid="presupuesto-calculando"
              className="flex items-center gap-2 font-body text-sm text-text-secondary"
            >
              <Loader2 aria-hidden className="size-4 animate-spin" />
              Calculando borrador…
            </p>
          )}

          {borrador?.desglose ? (
            <DesglosePresupuesto
              desglose={borrador.desglose}
              reparto={borrador.reparto}
              extrasTotalEur={borrador.extrasTotalEur}
            />
          ) : (
            !preview.isPending &&
            tarifaAConsultar && (
              <p className="font-body text-sm text-text-secondary">
                Introduce el precio manual para ver el desglose fiscal.
              </p>
            )
          )}

          <DialogFooter>
            <button
              type="button"
              onClick={() => onAbiertoChange(false)}
              disabled={confirmar.isPending}
              data-testid="cancelar-presupuesto"
              className={claseBotonSecundario}
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={confirmarDeshabilitado}
              data-testid="confirmar-presupuesto"
              className={cn(claseBotonPrimario)}
            >
              <FileText aria-hidden className="size-5" />
              {confirmar.isPending ? 'Confirmando…' : 'Confirmar presupuesto'}
            </button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
};
