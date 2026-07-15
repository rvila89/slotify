import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { FileText, Loader2, Save, Send } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { useEditarPresupuesto } from '../api/useEditarPresupuesto';
import { useReenviarPresupuesto } from '../api/useReenviarPresupuesto';
import { useExtras } from '../api/useExtras';
import { useBorradorEdicion } from '../lib/useBorradorEdicion';
import { esquemaEdicion, type FormularioEdicion } from '../lib/edicionSchema';
import { METODO_PAGO_POR_DEFECTO, etiquetaRegimenIva } from '../lib/metodoPago';
import { claseBotonPrimario, claseBotonSecundario, claseLabel } from '../lib/estilos';
import { AvisoErrorPresupuesto } from './AvisoErrorPresupuesto';
import { DesglosePresupuesto } from './DesglosePresupuesto';
import { SelectorExtras } from './SelectorExtras';
import { SelectorMetodoPago } from './SelectorMetodoPago';
import { ParametrosEdicion } from './ParametrosEdicion';
import { CamposDescuentoEdicion } from './CamposDescuentoEdicion';
import type {
  DuracionHorasEdicion,
  EdicionExtraInput,
  EdicionPresupuestoRequest,
  EdicionPresupuestoResponse,
  ReenviarPresupuestoResponse,
} from '../model/types';

/**
 * Diálogo "Editar presupuesto" (US-015 · UC-15). Extiende la ficha de una RESERVA en
 * `pre_reserva` con la edición versionada del presupuesto y el reenvío sin cambios.
 * Flujo: abrir → **preview de edición** en vivo (no persiste) → ajustar nº invitados,
 * duración, extras (precio congelado por el server), descuento y método de pago →
 *  - **Guardar borrador** (`enviar:false`): nueva versión en `borrador`, sin email.
 *  - **Enviar al cliente** (`enviar:true`): nueva versión `enviado` + E2 + AUDIT_LOG.
 *  - **Reenviar sin cambios**: no versiona; reenvía el PDF vigente (E2).
 *
 * El precio manual solo aparece (y es obligatorio) con `tarifaAConsultar=true` (>50
 * invitados). Formulario RHF + Zod (regla dura). El server revalida (409 fuera de
 * pre_reserva / presupuesto aceptado; 422 descuento/duración/precio/datos fiscales).
 * Sin frame propio en Figma "Slotify": se ADAPTA con los tokens del proyecto,
 * reutilizando los componentes del diálogo de generación (US-014). `Dialog`
 * mobile-first, scroll interno, sin overflow horizontal, táctiles ≥ 44px.
 */
type Props = {
  reservaId: string;
  abierto: boolean;
  onAbiertoChange: (abierto: boolean) => void;
  onEditado: (resultado: EdicionPresupuestoResponse) => void;
  onReenviado: (resultado: ReenviarPresupuestoResponse) => void;
};

export const EditarPresupuestoDialog = ({
  reservaId,
  abierto,
  onAbiertoChange,
  onEditado,
  onReenviado,
}: Props) => {
  const {
    register,
    watch,
    reset,
    setValue,
    setError,
    formState: { errors },
  } = useForm<FormularioEdicion>({
    resolver: zodResolver(esquemaEdicion),
    defaultValues: {
      numInvitados: '',
      duracionHoras: '4',
      descuento: '',
      descuentoMotivo: '',
      precioManual: '',
      metodoPago: METODO_PAGO_POR_DEFECTO,
    },
  });

  const numInvitados = watch('numInvitados');
  const duracionHoras = watch('duracionHoras');
  const descuento = watch('descuento');
  const descuentoMotivo = watch('descuentoMotivo');
  const precioManual = watch('precioManual');
  const metodoPago = watch('metodoPago');

  const { cantidades, cambiarCantidad, extrasInput, preview } = useBorradorEdicion(
    reservaId,
    abierto,
    { numInvitados, duracionHoras, descuento, precioManual, metodoPago },
  );
  const { data: extras = [], isLoading: cargandoExtras } = useExtras(abierto);
  const editar = useEditarPresupuesto();
  const reenviar = useReenviarPresupuesto();
  const { reset: resetEditar } = editar;
  const { reset: resetReenviar } = reenviar;

  useEffect(() => {
    if (!abierto) {
      resetEditar();
      resetReenviar();
      reset();
    }
  }, [abierto, resetEditar, resetReenviar, reset]);

  const borrador = preview.data;
  const tarifaAConsultar = borrador?.tarifaAConsultar ?? false;
  const errorActivo = editar.error ?? reenviar.error ?? preview.error ?? null;
  const enCurso = editar.isPending || reenviar.isPending;
  const faltaPrecioManual = tarifaAConsultar && precioManual.trim() === '';

  const construirBody = (enviar: boolean): EdicionPresupuestoRequest => {
    const extrasBody: EdicionExtraInput[] = extrasInput;
    const body: EdicionPresupuestoRequest = { metodoPago, extras: extrasBody, enviar };

    const invitados = numInvitados.trim();
    if (invitados !== '') body.numAdultosNinosMayores4 = Math.trunc(Number(invitados));
    body.duracionHoras = Number(duracionHoras) as DuracionHorasEdicion;
    if (descuento.trim() !== '' && Number(descuento) > 0) body.descuentoEur = descuento;
    if (descuentoMotivo && descuentoMotivo.trim() !== '') body.descuentoMotivo = descuentoMotivo;
    if (tarifaAConsultar && precioManual.trim() !== '') body.precioManualEur = precioManual;

    return body;
  };

  const validarPrecioManual = (): boolean => {
    if (tarifaAConsultar && (precioManual.trim() === '' || Number(precioManual) <= 0)) {
      setError('precioManual', {
        message:
          'Introduce el precio manual (mayor que 0): esta edición supera los 50 invitados (tarifa a consultar).',
      });
      return false;
    }
    return true;
  };

  const enviarEdicion = (enviar: boolean) => {
    if (!validarPrecioManual()) return;
    editar.mutate(
      { id: reservaId, body: construirBody(enviar) },
      {
        onSuccess: (resultado) => {
          onEditado(resultado);
          onAbiertoChange(false);
        },
      },
    );
  };

  const reenviarSinCambios = () => {
    reenviar.mutate(
      { id: reservaId },
      {
        onSuccess: (resultado) => {
          onReenviado(resultado);
          onAbiertoChange(false);
        },
      },
    );
  };

  const accionesDeshabilitadas = enCurso || preview.isPending;
  const editarDeshabilitado = accionesDeshabilitadas || !borrador?.desglose || faltaPrecioManual;

  return (
    <Dialog open={abierto} onOpenChange={onAbiertoChange}>
      <DialogContent
        data-testid="dialog-editar-presupuesto"
        className="max-h-[90vh] max-w-2xl overflow-y-auto"
      >
        <DialogHeader>
          <DialogTitle>Editar presupuesto</DialogTitle>
          <DialogDescription>
            Ajusta la oferta de la pre-reserva (invitados, duración, extras, descuento) y
            reenvíala. Al enviar se crea una nueva versión y el cliente la recibe por email; la
            versión anterior se conserva como historial.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-5">
          {errorActivo && <AvisoErrorPresupuesto error={errorActivo} />}

          <ParametrosEdicion register={register} errors={errors} deshabilitado={enCurso} />

          <div className="flex flex-col gap-1">
            <SelectorMetodoPago
              valor={metodoPago}
              onCambiar={(v) => setValue('metodoPago', v, { shouldValidate: true })}
              deshabilitado={enCurso}
            />
            {errors.metodoPago && (
              <p role="alert" className="px-1 font-body text-[13px] text-red-600">
                {errors.metodoPago.message}
              </p>
            )}
          </div>

          <section className="flex flex-col gap-3">
            <h3 className={claseLabel}>Extras</h3>
            {cargandoExtras ? (
              <p className="font-body text-sm text-text-secondary">Cargando catálogo de extras…</p>
            ) : (
              <SelectorExtras
                extras={extras}
                cantidades={cantidades}
                onCambiar={cambiarCantidad}
                deshabilitado={enCurso}
              />
            )}
          </section>

          <CamposDescuentoEdicion
            register={register}
            errors={errors}
            tarifaAConsultar={tarifaAConsultar}
            faltaPrecioManual={faltaPrecioManual}
            deshabilitado={enCurso}
          />

          {preview.isPending && !borrador && (
            <p
              data-testid="edicion-calculando"
              className="flex items-center gap-2 font-body text-sm text-text-secondary"
            >
              <Loader2 aria-hidden className="size-4 animate-spin" />
              Recalculando borrador…
            </p>
          )}

          {borrador?.desglose ? (
            <div className="flex flex-col gap-2">
              {borrador.regimenIva && (
                <p
                  data-testid="borrador-regimen-iva"
                  className="px-1 font-body text-xs font-medium tracking-[0.48px] text-text-secondary"
                >
                  Régimen fiscal: {etiquetaRegimenIva(borrador.regimenIva)}
                </p>
              )}
              <DesglosePresupuesto
                desglose={borrador.desglose}
                reparto={borrador.reparto}
                extrasTotalEur={borrador.extrasTotalEur}
                descuentoEur={borrador.descuentoEur}
              />
            </div>
          ) : (
            !preview.isPending &&
            tarifaAConsultar && (
              <p className="font-body text-sm text-text-secondary">
                Introduce el precio manual para ver el desglose fiscal.
              </p>
            )
          )}

          <DialogFooter className="flex-col gap-3 sm:flex-row sm:flex-wrap sm:justify-end">
            <button
              type="button"
              onClick={reenviarSinCambios}
              disabled={accionesDeshabilitadas}
              data-testid="reenviar-presupuesto"
              className={claseBotonSecundario}
            >
              <FileText aria-hidden className="size-5" />
              {reenviar.isPending ? 'Reenviando…' : 'Reenviar sin cambios'}
            </button>
            <button
              type="button"
              onClick={() => enviarEdicion(false)}
              disabled={editarDeshabilitado}
              data-testid="guardar-borrador-edicion"
              className={claseBotonSecundario}
            >
              <Save aria-hidden className="size-5" />
              Guardar borrador
            </button>
            <button
              type="button"
              onClick={() => enviarEdicion(true)}
              disabled={editarDeshabilitado}
              data-testid="enviar-edicion"
              className={claseBotonPrimario}
            >
              <Send aria-hidden className="size-5" />
              {editar.isPending ? 'Enviando…' : 'Enviar al cliente'}
            </button>
          </DialogFooter>
        </div>
      </DialogContent>
    </Dialog>
  );
};
