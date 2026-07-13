import { useEffect, useRef, useState } from 'react';
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
import { useReserva } from '@/features/reservas';
import { useConfirmarPresupuesto } from '../api/useConfirmarPresupuesto';
import { useExtras } from '../api/useExtras';
import { useBorradorPresupuesto } from '../lib/useBorradorPresupuesto';
import { AvisoErrorPresupuesto } from './AvisoErrorPresupuesto';
import { DesglosePresupuesto } from './DesglosePresupuesto';
import { SelectorExtras } from './SelectorExtras';
import {
  DatosFiscalesClienteSection,
  type DatosFiscalesHandle,
} from './DatosFiscalesClienteSection';
import { camposFiscalesFaltantes, type CampoFiscalCliente } from './datosFiscalesCampos';
import {
  claseBotonPrimario,
  claseBotonSecundario,
  claseInput,
  claseLabel,
} from './estilos';
import type { ConfirmarPresupuestoResponse, PresupuestoExtraInput } from '../model/types';

/**
 * Diálogo "Generar presupuesto" (US-014 · UC-14 §5.1–5.4). Flujo: abrir → **preview**
 * (no persiste) → completar datos fiscales del CLIENTE (incidencia #5) + editar extras
 * / precio manual → **Confirmar** (persiste: PRESUPUESTO + `pre_reserva` + bloqueo 7d +
 * E2) o **Cancelar** (descarta el borrador, FA-03).
 *
 * El precio manual solo se muestra (y es obligatorio) con `tarifaAConsultar=true` (>50
 * invitados, FA-02). Formulario **RHF + Zod** (regla dura). Al confirmar se guardan
 * primero los datos fiscales (PATCH) y luego se confirma; ante `DATOS_FISCALES_INCOMPLETOS`
 * (422) el bucle de resolución (D-5) resalta/enfoca los campos faltantes. El servidor
 * revalida defensivamente (409/422). Sin frame propio en Figma "Slotify": se ADAPTA con
 * los tokens del proyecto; `Dialog` mobile-first, sin overflow horizontal, táctiles ≥ 44px.
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
  const { data: reserva } = useReserva(abierto ? reservaId : undefined);
  const confirmar = useConfirmarPresupuesto();

  const { reset: resetConfirmar } = confirmar;

  // Handle imperativo de la sección de datos fiscales (guardar + enfocar faltantes)
  // y los campos que el backend reporta como faltantes (bucle de resolución D-5).
  const datosFiscalesRef = useRef<DatosFiscalesHandle>(null);
  const [camposResaltados, setCamposResaltados] = useState<CampoFiscalCliente[]>([]);

  // Al cerrar, limpia el formulario, el estado de la mutación y el resaltado fiscal.
  useEffect(() => {
    if (!abierto) {
      resetConfirmar();
      reset({ precioManual: '' });
      setCamposResaltados([]);
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

  // Bucle de resolución de datos fiscales (D-5): resalta/enfoca los campos que el
  // backend reporta como faltantes (`DATOS_FISCALES_INCOMPLETOS`, 422) en preview o
  // confirmación. Solo los 5 campos fiscales del CLIENTE que gestiona la sección.
  useEffect(() => {
    if (errorActivo?.tipo !== 'datos-fiscales') return;
    const faltantes = camposFiscalesFaltantes(errorActivo.camposFaltantes);
    setCamposResaltados(faltantes);
    if (faltantes.length > 0) datosFiscalesRef.current?.enfocarPrimerFaltante(faltantes);
  }, [errorActivo]);

  const onSubmit = handleSubmit(async () => {
    // FA-02: con tarifa a consultar, el precio manual (> 0) es obligatorio en cliente.
    if (tarifaAConsultar && (precioManual.trim() === '' || Number(precioManual) <= 0)) {
      setError('precioManual', {
        message: 'Introduce el precio manual (mayor que 0) para esta consulta de más de 50 invitados.',
      });
      return;
    }

    // Paso previo: persiste los datos fiscales del CLIENTE (PATCH). Si falla la
    // validación/guardado, no se intenta confirmar (D-5: guardar → reintentar).
    const guardado = await datosFiscalesRef.current?.guardar();
    if (guardado === false) return;
    setCamposResaltados([]);

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

          <DatosFiscalesClienteSection
            ref={datosFiscalesRef}
            reservaId={reservaId}
            cliente={reserva?.cliente}
            camposResaltados={camposResaltados}
            deshabilitado={confirmar.isPending}
          />

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
