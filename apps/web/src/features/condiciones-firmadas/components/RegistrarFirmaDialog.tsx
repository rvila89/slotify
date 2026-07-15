import { useEffect, useRef, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { CheckCircle2, FileUp, Paperclip, X } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import { useRegistrarCondicionesFirmadas } from '../api/useRegistrarCondicionesFirmadas';
import {
  ACCEPT_CONDICIONES,
  MENSAJE_CONDICIONES_REQUERIDAS,
  formatearTamano,
  validarFicheroFirmado,
} from '../lib/fichero';
import { AvisoErrorCondiciones } from './AvisoErrorCondiciones';
import type { RegistrarCondicionesFirmadasResponse } from '../model/types';

/**
 * Diálogo "Registrar condiciones firmadas" (US-024 · UC-19). Flujo: abrir → adjuntar
 * la copia firmada (JPEG/PNG/PDF ≤ 10 MB) → **Registrar firma** (multipart al backend,
 * que crea el DOCUMENTO y marca `condPartFirmadas=true`) o **Cancelar** (sin efecto).
 * Sirve tanto para el primer registro como para la re-subida (re-firma, D-re-firma).
 *
 * Validación de cliente del fichero (formato/tamaño/obligatorio) con **React Hook
 * Form + Zod** (regla dura del proyecto, coherente con `ConfirmarSenalDialog`); la
 * autoritativa es el servidor, que revalida (409/422) y cuyos errores se muestran
 * inline (`AvisoErrorCondiciones`).
 *
 * Diseño: no hay frame propio de este diálogo en el archivo Figma "Slotify"; se
 * ADAPTA con los tokens del proyecto reutilizando el tratamiento de los diálogos de
 * confirmación. Mobile-first: `Dialog` con scroll interno, dropzone y botones apilan
 * en columna en móvil (`<sm`) y el pie pasa a fila en `sm:`. Objetivos táctiles ≥ 48px.
 */
type Props = {
  reservaId: string;
  /** `true` cuando ya hay una firma previa: el diálogo pasa a modo re-firma. */
  yaFirmada: boolean;
  abierto: boolean;
  onAbiertoChange: (abierto: boolean) => void;
  /** Se invoca con la respuesta tras un 200 (RESERVA con `condPartFirmadas=true`). */
  onRegistrado: (resultado: RegistrarCondicionesFirmadasResponse) => void;
};

// El fichero se gestiona fuera del form (input file no controlado); el esquema solo
// asegura que hay un `File` válido antes de enviar (no narrowa a `File` para no
// desalinear los tipos de entrada/salida del resolver).
const esquema = z.object({
  condicionesFirmadas: z
    .custom<File | null>((v) => v instanceof File, MENSAJE_CONDICIONES_REQUERIDAS)
    .refine((v) => v instanceof File && validarFicheroFirmado(v) === null, {
      message: 'El fichero adjunto no es válido.',
    }),
});

type FormularioRegistrarFirma = z.infer<typeof esquema>;

const claseBotonPrimario =
  'inline-flex h-12 w-full items-center justify-center gap-2 rounded-full bg-brand-primary px-8 font-display text-base text-brand-foreground transition hover:opacity-95 disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto';

const claseBotonSecundario =
  'inline-flex h-12 w-full items-center justify-center gap-2 rounded-full border border-border-default bg-canvas px-8 font-body text-base font-medium text-text-secondary transition hover:bg-surface-muted disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto';

export const RegistrarFirmaDialog = ({
  reservaId,
  yaFirmada,
  abierto,
  onAbiertoChange,
  onRegistrado,
}: Props) => {
  const inputRef = useRef<HTMLInputElement>(null);
  const [nombreFichero, setNombreFichero] = useState<string | null>(null);
  const [tamanoFichero, setTamanoFichero] = useState<number | null>(null);

  const {
    handleSubmit,
    setValue,
    setError,
    clearErrors,
    reset,
    formState: { errors },
  } = useForm<FormularioRegistrarFirma>({
    resolver: zodResolver(esquema),
    defaultValues: { condicionesFirmadas: null },
  });

  const registrar = useRegistrarCondicionesFirmadas();
  const { reset: resetRegistrar } = registrar;

  // Al cerrar, limpia el formulario, el fichero y el estado de la mutación.
  useEffect(() => {
    if (!abierto) {
      resetRegistrar();
      reset({ condicionesFirmadas: null });
      setNombreFichero(null);
      setTamanoFichero(null);
      if (inputRef.current) inputRef.current.value = '';
    }
  }, [abierto, resetRegistrar, reset]);

  const onCambioFichero = (event: React.ChangeEvent<HTMLInputElement>) => {
    const fichero = event.target.files?.[0] ?? null;
    setNombreFichero(fichero?.name ?? null);
    setTamanoFichero(fichero?.size ?? null);

    const mensaje = validarFicheroFirmado(fichero);
    if (mensaje) {
      setValue('condicionesFirmadas', null, { shouldValidate: false });
      setError('condicionesFirmadas', { message: mensaje });
      return;
    }
    clearErrors('condicionesFirmadas');
    setValue('condicionesFirmadas', fichero, { shouldValidate: true });
  };

  const onSubmit = handleSubmit(({ condicionesFirmadas }) => {
    if (!(condicionesFirmadas instanceof File)) {
      setError('condicionesFirmadas', { message: MENSAJE_CONDICIONES_REQUERIDAS });
      return;
    }
    registrar.mutate(
      { id: reservaId, condicionesFirmadas },
      {
        onSuccess: (resultado) => {
          onRegistrado(resultado);
          onAbiertoChange(false);
        },
      },
    );
  });

  const registrarDeshabilitado =
    !nombreFichero || Boolean(errors.condicionesFirmadas) || registrar.isPending;

  return (
    <Dialog open={abierto} onOpenChange={onAbiertoChange}>
      <DialogContent
        data-testid="dialog-registrar-firma-condiciones"
        className="max-h-[90vh] overflow-y-auto"
      >
        <DialogHeader>
          <DialogTitle>
            {yaFirmada ? 'Actualizar condiciones firmadas' : 'Registrar condiciones firmadas'}
          </DialogTitle>
          <DialogDescription>
            {yaFirmada
              ? 'Sube una nueva versión de la copia firmada (JPG, PNG o PDF, máximo 10 MB). Se conservará el histórico y esta pasará a ser la versión de referencia.'
              : 'Adjunta la copia firmada de las condiciones particulares (JPG, PNG o PDF, máximo 10 MB). Al registrar, la reserva quedará marcada como firmada.'}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={onSubmit} noValidate className="flex flex-col gap-5">
          {registrar.error && <AvisoErrorCondiciones error={registrar.error} />}

          <div className="flex flex-col gap-2">
            <label
              htmlFor="condiciones-firmadas-fichero"
              className="px-1 font-body text-xs font-medium tracking-[0.48px] text-text-secondary"
            >
              Copia firmada
            </label>

            <label
              htmlFor="condiciones-firmadas-fichero"
              className={cn(
                'flex cursor-pointer flex-col items-center justify-center gap-2 rounded-[16px] border border-dashed px-4 py-8 text-center transition',
                errors.condicionesFirmadas
                  ? 'border-red-400 bg-red-50/60'
                  : 'border-border-default/50 bg-surface-subtle/40 hover:bg-surface-muted',
              )}
            >
              <FileUp aria-hidden className="size-6 text-brand-primary" />
              <span className="font-body text-sm font-medium text-text-primary">
                {nombreFichero ? 'Cambiar fichero' : 'Selecciona o arrastra la copia firmada'}
              </span>
              <span className="font-body text-xs text-text-secondary">
                JPG, PNG o PDF · máx. 10 MB
              </span>
            </label>

            <input
              ref={inputRef}
              id="condiciones-firmadas-fichero"
              type="file"
              accept={ACCEPT_CONDICIONES}
              disabled={registrar.isPending}
              onChange={onCambioFichero}
              data-testid="input-condiciones-firmadas"
              aria-invalid={errors.condicionesFirmadas ? 'true' : undefined}
              aria-describedby={
                errors.condicionesFirmadas ? 'condiciones-firmadas-error' : undefined
              }
              className="sr-only"
            />

            {nombreFichero && !errors.condicionesFirmadas && (
              <p
                data-testid="condiciones-firmadas-seleccionado"
                className="flex items-center gap-2 px-1 font-body text-[13px] text-text-secondary"
              >
                <Paperclip aria-hidden className="size-4 shrink-0 text-brand-primary" />
                <span className="truncate">{nombreFichero}</span>
                {tamanoFichero !== null && (
                  <span className="shrink-0 text-text-secondary/80">
                    ({formatearTamano(tamanoFichero)})
                  </span>
                )}
              </p>
            )}

            {errors.condicionesFirmadas && (
              <p
                id="condiciones-firmadas-error"
                role="alert"
                data-testid="error-condiciones-firmadas"
                className="px-1 font-body text-[13px] text-red-600"
              >
                {errors.condicionesFirmadas.message}
              </p>
            )}
          </div>

          <DialogFooter className="flex-col gap-3 sm:flex-row">
            <button
              type="button"
              onClick={() => onAbiertoChange(false)}
              disabled={registrar.isPending}
              data-testid="cancelar-registrar-firma"
              className={claseBotonSecundario}
            >
              <X aria-hidden className="size-5" />
              Cancelar
            </button>
            <button
              type="submit"
              disabled={registrarDeshabilitado}
              data-testid="registrar-firma-condiciones"
              className={claseBotonPrimario}
            >
              <CheckCircle2 aria-hidden className="size-5" />
              {registrar.isPending
                ? 'Registrando…'
                : yaFirmada
                  ? 'Actualizar firma'
                  : 'Registrar firma'}
            </button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
};
