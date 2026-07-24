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
import { useSubirComprobanteFianza } from '../api/useSubirComprobanteFianza';
import {
  ACCEPT_COMPROBANTE,
  MENSAJE_COMPROBANTE_REQUERIDO,
  formatearTamano,
  validarComprobante,
} from '../lib/comprobanteFianza';
import { AvisoErrorComprobanteFianza } from './AvisoErrorComprobanteFianza';
import type { SubirComprobanteFianzaResponse } from '../model/types';

/**
 * Diálogo "Subir comprobante de fianza" (fix-liquidacion-fianza-independientes), espejo de
 * `RegistrarFirmaDialog`. Flujo: abrir → adjuntar el comprobante de la transferencia recibida
 * (JPEG/PNG/PDF ≤ 10 MB) → **Subir comprobante** (multipart al backend, que crea el DOCUMENTO
 * y marca `fianzaStatus='cobrada'`) o **Cancelar** (sin efecto). Sirve para el primer registro
 * y para la re-subida.
 *
 * Validación de cliente del fichero con React Hook Form + Zod; la autoritativa es el servidor
 * (422), cuyos errores se muestran inline (`AvisoErrorComprobanteFianza`).
 *
 * Mobile-first: `Dialog` con scroll interno, dropzone y botones apilan en columna en móvil
 * (`<sm`) y el pie pasa a fila en `sm:`. Objetivos táctiles ≥ 48px.
 */
type Props = {
  reservaId: string;
  /** `true` cuando ya hay un comprobante previo: el diálogo pasa a modo re-subida. */
  yaSubido: boolean;
  abierto: boolean;
  onAbiertoChange: (abierto: boolean) => void;
  /** Se invoca con la respuesta tras un 200 (RESERVA con `fianzaStatus='cobrada'`). */
  onSubido: (resultado: SubirComprobanteFianzaResponse) => void;
};

// El fichero se gestiona fuera del form (input file no controlado); el esquema solo asegura
// que hay un `File` válido antes de enviar.
const esquema = z.object({
  comprobanteFianza: z
    .custom<File | null>((v) => v instanceof File, MENSAJE_COMPROBANTE_REQUERIDO)
    .refine((v) => v instanceof File && validarComprobante(v) === null, {
      message: 'El fichero adjunto no es válido.',
    }),
});

type FormularioSubirComprobante = z.infer<typeof esquema>;

const claseBotonPrimario =
  'inline-flex h-12 w-full items-center justify-center gap-2 rounded-full bg-brand-primary px-8 font-display text-base text-brand-foreground transition hover:opacity-95 disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto';

const claseBotonSecundario =
  'inline-flex h-12 w-full items-center justify-center gap-2 rounded-full border border-border-default bg-canvas px-8 font-body text-base font-medium text-text-secondary transition hover:bg-surface-muted disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto';

export const SubirComprobanteFianzaDialog = ({
  reservaId,
  yaSubido,
  abierto,
  onAbiertoChange,
  onSubido,
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
  } = useForm<FormularioSubirComprobante>({
    resolver: zodResolver(esquema),
    defaultValues: { comprobanteFianza: null },
  });

  const subir = useSubirComprobanteFianza();
  const { reset: resetSubir } = subir;

  useEffect(() => {
    if (!abierto) {
      resetSubir();
      reset({ comprobanteFianza: null });
      setNombreFichero(null);
      setTamanoFichero(null);
      if (inputRef.current) inputRef.current.value = '';
    }
  }, [abierto, resetSubir, reset]);

  const onCambioFichero = (event: React.ChangeEvent<HTMLInputElement>) => {
    const fichero = event.target.files?.[0] ?? null;
    setNombreFichero(fichero?.name ?? null);
    setTamanoFichero(fichero?.size ?? null);

    const mensaje = validarComprobante(fichero);
    if (mensaje) {
      setValue('comprobanteFianza', null, { shouldValidate: false });
      setError('comprobanteFianza', { message: mensaje });
      return;
    }
    clearErrors('comprobanteFianza');
    setValue('comprobanteFianza', fichero, { shouldValidate: true });
  };

  const onSubmit = handleSubmit(({ comprobanteFianza }) => {
    if (!(comprobanteFianza instanceof File)) {
      setError('comprobanteFianza', { message: MENSAJE_COMPROBANTE_REQUERIDO });
      return;
    }
    subir.mutate(
      { reservaId, comprobanteFianza },
      {
        onSuccess: (resultado) => {
          onSubido(resultado);
          onAbiertoChange(false);
        },
      },
    );
  });

  const subirDeshabilitado =
    !nombreFichero || Boolean(errors.comprobanteFianza) || subir.isPending;

  return (
    <Dialog open={abierto} onOpenChange={onAbiertoChange}>
      <DialogContent
        data-testid="dialog-subir-comprobante-fianza"
        className="max-h-[90vh] overflow-y-auto"
      >
        <DialogHeader>
          <DialogTitle>
            {yaSubido ? 'Actualizar comprobante de fianza' : 'Subir comprobante de fianza'}
          </DialogTitle>
          <DialogDescription>
            {yaSubido
              ? 'Sube una nueva versión del comprobante de la transferencia (JPG, PNG o PDF, máximo 10 MB). Se conservará el histórico y esta pasará a ser la versión de referencia.'
              : 'Adjunta el comprobante de la transferencia de fianza recibida (JPG, PNG o PDF, máximo 10 MB). Al subirlo, la fianza quedará marcada como recibida.'}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={onSubmit} noValidate className="flex flex-col gap-5">
          {subir.error && <AvisoErrorComprobanteFianza error={subir.error} />}

          <div className="flex flex-col gap-2">
            <label
              htmlFor="comprobante-fianza-fichero"
              className="px-1 font-body text-xs font-medium tracking-[0.48px] text-text-secondary"
            >
              Comprobante de la transferencia
            </label>

            <label
              htmlFor="comprobante-fianza-fichero"
              className={cn(
                'flex cursor-pointer flex-col items-center justify-center gap-2 rounded-[16px] border border-dashed px-4 py-8 text-center transition',
                errors.comprobanteFianza
                  ? 'border-red-400 bg-red-50/60'
                  : 'border-border-default/50 bg-surface-subtle/40 hover:bg-surface-muted',
              )}
            >
              <FileUp aria-hidden className="size-6 text-brand-primary" />
              <span className="font-body text-sm font-medium text-text-primary">
                {nombreFichero ? 'Cambiar fichero' : 'Selecciona o arrastra el comprobante'}
              </span>
              <span className="font-body text-xs text-text-secondary">
                JPG, PNG o PDF · máx. 10 MB
              </span>
            </label>

            <input
              ref={inputRef}
              id="comprobante-fianza-fichero"
              type="file"
              accept={ACCEPT_COMPROBANTE}
              disabled={subir.isPending}
              onChange={onCambioFichero}
              data-testid="input-comprobante-fianza"
              aria-invalid={errors.comprobanteFianza ? 'true' : undefined}
              aria-describedby={errors.comprobanteFianza ? 'comprobante-fianza-error' : undefined}
              className="sr-only"
            />

            {nombreFichero && !errors.comprobanteFianza && (
              <p
                data-testid="comprobante-fianza-seleccionado"
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

            {errors.comprobanteFianza && (
              <p
                id="comprobante-fianza-error"
                role="alert"
                data-testid="error-comprobante-fianza"
                className="px-1 font-body text-[13px] text-red-600"
              >
                {errors.comprobanteFianza.message}
              </p>
            )}
          </div>

          <DialogFooter className="flex-col gap-3 sm:flex-row">
            <button
              type="button"
              onClick={() => onAbiertoChange(false)}
              disabled={subir.isPending}
              data-testid="cancelar-subir-comprobante"
              className={claseBotonSecundario}
            >
              <X aria-hidden className="size-5" />
              Cancelar
            </button>
            <button
              type="submit"
              disabled={subirDeshabilitado}
              data-testid="subir-comprobante-fianza"
              className={claseBotonPrimario}
            >
              <CheckCircle2 aria-hidden className="size-5" />
              {subir.isPending
                ? 'Subiendo…'
                : yaSubido
                  ? 'Actualizar comprobante'
                  : 'Subir comprobante'}
            </button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
};
