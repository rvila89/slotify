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
import { useConfirmarSenal } from '../api/useConfirmarSenal';
import {
  ACCEPT_JUSTIFICANTE,
  MENSAJE_JUSTIFICANTE_REQUERIDO,
  formatearTamano,
  validarJustificante,
} from '../lib/justificante';
import { AvisoErrorConfirmarSenal } from './AvisoErrorConfirmarSenal';
import type { ConfirmarSenalResponse } from '../model/types';

/**
 * Diálogo "Confirmar pago de señal" (US-021 · UC-17). Flujo: abrir → adjuntar el
 * justificante (JPEG/PNG/PDF ≤ 10 MB) → **Confirmar** (multipart al backend, que
 * eleva la RESERVA a `reserva_confirmada`) o **Cancelar** (sin efecto).
 *
 * Validación de cliente del fichero (formato/tamaño/obligatorio) con **React Hook
 * Form + Zod** (regla dura del proyecto, coherente con los diálogos de reservas /
 * presupuestos); la autoritativa es el servidor, que revalida (409/422) y cuyos
 * errores se muestran inline (`AvisoErrorConfirmarSenal`).
 *
 * Diseño: no hay frame propio de este diálogo en el archivo Figma "Slotify"; se
 * ADAPTA con los tokens del proyecto (`index.css` + `DESIGN.md`), reutilizando el
 * tratamiento de los diálogos de reservas. El `Dialog` (shadcn/Radix) es
 * mobile-first (`w-[calc(100%-2rem)]`, `max-w-lg`, scroll interno) sin overflow
 * horizontal; el dropzone y los botones apilan en columna en móvil (`<lg`) y el
 * pie pasa a fila en `sm:`. Objetivos táctiles ≥ 44px.
 */
type Props = {
  reservaId: string;
  abierto: boolean;
  onAbiertoChange: (abierto: boolean) => void;
  /** Se invoca con la respuesta tras un 200 (RESERVA en reserva_confirmada). */
  onConfirmado: (resultado: ConfirmarSenalResponse) => void;
};

// El fichero se gestiona fuera del form (input file no controlado); el esquema
// solo asegura que hay un `File` válido antes de enviar.
// El campo es `File | null` en entrada y salida (input de fichero no controlado):
// el esquema solo comprueba que hay un fichero válido; NO narrowa a `File` para no
// desalinear los tipos de entrada/salida del resolver.
const esquema = z.object({
  justificante: z
    .custom<File | null>((v) => v instanceof File, MENSAJE_JUSTIFICANTE_REQUERIDO)
    .refine((v) => v instanceof File && validarJustificante(v) === null, {
      message: 'El justificante adjunto no es válido.',
    }),
});

type FormularioConfirmarSenal = z.infer<typeof esquema>;

// El "Confirmar" interno usa el VERDE del sistema (`accent-success`, mismo token
// que "Generar presupuesto"/"Confirmar pago de señal") por coherencia con el CTA de
// avance que abre este diálogo (D-3, presupuesto-prereserva-cta-descarte-y-e2).
const claseBotonPrimario =
  'inline-flex h-12 w-full items-center justify-center gap-2 rounded-full bg-accent-success px-8 font-display text-base text-accent-success-foreground transition hover:opacity-95 disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto';

const claseBotonSecundario =
  'inline-flex h-12 w-full items-center justify-center gap-2 rounded-full border border-border-default bg-canvas px-8 font-body text-base font-medium text-text-secondary transition hover:bg-surface-muted disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto';

export const ConfirmarSenalDialog = ({
  reservaId,
  abierto,
  onAbiertoChange,
  onConfirmado,
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
  } = useForm<FormularioConfirmarSenal>({
    resolver: zodResolver(esquema),
    defaultValues: { justificante: null },
  });

  const confirmar = useConfirmarSenal();
  const { reset: resetConfirmar } = confirmar;

  // Al cerrar, limpia el formulario, el fichero y el estado de la mutación.
  useEffect(() => {
    if (!abierto) {
      resetConfirmar();
      reset({ justificante: null });
      setNombreFichero(null);
      setTamanoFichero(null);
      if (inputRef.current) inputRef.current.value = '';
    }
  }, [abierto, resetConfirmar, reset]);

  const onCambioFichero = (event: React.ChangeEvent<HTMLInputElement>) => {
    const fichero = event.target.files?.[0] ?? null;
    setNombreFichero(fichero?.name ?? null);
    setTamanoFichero(fichero?.size ?? null);

    const mensaje = validarJustificante(fichero);
    if (mensaje) {
      setValue('justificante', null, { shouldValidate: false });
      setError('justificante', { message: mensaje });
      return;
    }
    clearErrors('justificante');
    setValue('justificante', fichero, { shouldValidate: true });
  };

  const onSubmit = handleSubmit(({ justificante }) => {
    // Guarda defensiva: el esquema ya garantiza un `File` válido, pero el tipo del
    // campo es `File | null`. Sin fichero, se refuerza el error obligatorio.
    if (!(justificante instanceof File)) {
      setError('justificante', { message: MENSAJE_JUSTIFICANTE_REQUERIDO });
      return;
    }
    confirmar.mutate(
      { id: reservaId, justificante },
      {
        onSuccess: (resultado) => {
          onConfirmado(resultado);
          onAbiertoChange(false);
        },
      },
    );
  });

  const confirmarDeshabilitado = !nombreFichero || Boolean(errors.justificante) || confirmar.isPending;

  return (
    <Dialog open={abierto} onOpenChange={onAbiertoChange}>
      <DialogContent data-testid="dialog-confirmar-senal" className="max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Confirmar pago de señal</DialogTitle>
          <DialogDescription>
            Adjunta el justificante del pago de la señal (JPG, PNG o PDF, máximo 10 MB). Al
            confirmar, la reserva pasará a reserva confirmada y la fecha quedará bloqueada en firme.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={onSubmit} noValidate className="flex flex-col gap-5">
          {confirmar.error && <AvisoErrorConfirmarSenal error={confirmar.error} />}

          <div className="flex flex-col gap-2">
            <label
              htmlFor="confirmar-senal-justificante"
              className="px-1 font-body text-xs font-medium tracking-[0.48px] text-text-secondary"
            >
              Justificante de pago
            </label>

            <label
              htmlFor="confirmar-senal-justificante"
              className={cn(
                'flex cursor-pointer flex-col items-center justify-center gap-2 rounded-[16px] border border-dashed px-4 py-8 text-center transition',
                errors.justificante
                  ? 'border-red-400 bg-red-50/60'
                  : 'border-border-default/50 bg-surface-subtle/40 hover:bg-surface-muted',
              )}
            >
              <FileUp aria-hidden className="size-6 text-brand-primary" />
              <span className="font-body text-sm font-medium text-text-primary">
                {nombreFichero ? 'Cambiar fichero' : 'Selecciona o arrastra el justificante'}
              </span>
              <span className="font-body text-xs text-text-secondary">JPG, PNG o PDF · máx. 10 MB</span>
            </label>

            <input
              ref={inputRef}
              id="confirmar-senal-justificante"
              type="file"
              accept={ACCEPT_JUSTIFICANTE}
              disabled={confirmar.isPending}
              onChange={onCambioFichero}
              data-testid="input-justificante"
              aria-invalid={errors.justificante ? 'true' : undefined}
              aria-describedby={errors.justificante ? 'confirmar-senal-justificante-error' : undefined}
              className="sr-only"
            />

            {nombreFichero && !errors.justificante && (
              <p
                data-testid="justificante-seleccionado"
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

            {errors.justificante && (
              <p
                id="confirmar-senal-justificante-error"
                role="alert"
                data-testid="error-justificante"
                className="px-1 font-body text-[13px] text-red-600"
              >
                {errors.justificante.message}
              </p>
            )}
          </div>

          <DialogFooter className="flex-col gap-3 sm:flex-row">
            <button
              type="button"
              onClick={() => onAbiertoChange(false)}
              disabled={confirmar.isPending}
              data-testid="cancelar-confirmar-senal"
              className={claseBotonSecundario}
            >
              <X aria-hidden className="size-5" />
              Cancelar
            </button>
            <button
              type="submit"
              disabled={confirmarDeshabilitado}
              data-testid="confirmar-senal"
              className={claseBotonPrimario}
            >
              <CheckCircle2 aria-hidden className="size-5" />
              {confirmar.isPending ? 'Confirmando…' : 'Confirmar'}
            </button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
};
