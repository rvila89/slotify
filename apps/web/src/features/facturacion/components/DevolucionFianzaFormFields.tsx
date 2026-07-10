import type { RefObject } from 'react';
import type { FieldErrors, UseFormRegister } from 'react-hook-form';
import { Banknote, Calendar, FileUp, MessageSquare, Paperclip } from 'lucide-react';
import { cn } from '@/lib/utils';
import { formatearEuros } from '../lib/dinero';
import { ACCEPT_JUSTIFICANTE, formatearTamano } from '../lib/justificante';
import type { ResultadoDevolucion } from '../lib/devolucionFianza';
import type { FormularioDevolucion } from '../lib/devolucionFianzaSchema';

/**
 * Campos del formulario de devolución de fianza (US-036), extraídos del diálogo para respetar el
 * límite de 300 líneas por archivo. Presentacional puro: recibe el `register`/`errors` de RHF, los
 * valores derivados (resultado completa/parcial, si mostrar motivo) y el estado del fichero. La
 * lógica (validación, subida en dos pasos, confirmación) vive en el diálogo contenedor.
 */
type Props = {
  register: UseFormRegister<FormularioDevolucion>;
  errors: FieldErrors<FormularioDevolucion>;
  pendiente: boolean;
  fianzaEur?: string | null;
  fianzaCobradaFecha?: string | null;
  /** Estado final derivado en tiempo real (`devuelta`|`retenida_parcial`) o `null` si no procede. */
  resultado: ResultadoDevolucion | null;
  /** Si mostrar el campo de motivo (devolución parcial). */
  mostrarMotivo: boolean;
  inputFicheroRef: RefObject<HTMLInputElement>;
  fichero: File | null;
  errorFichero: string | null;
  onCambioFichero: (event: React.ChangeEvent<HTMLInputElement>) => void;
};

const claseInput =
  'h-12 w-full rounded-[16px] border bg-canvas px-4 font-body text-sm text-text-primary transition placeholder:text-text-secondary/60 focus:outline-none focus:ring-2 focus:ring-brand-primary';

const claseLabel = 'px-1 font-body text-xs font-medium tracking-[0.48px] text-text-secondary';

const claseIcono =
  'pointer-events-none absolute left-4 top-1/2 size-4 -translate-y-1/2 text-text-secondary';

export const DevolucionFianzaFormFields = ({
  register,
  errors,
  pendiente,
  fianzaEur,
  fianzaCobradaFecha,
  resultado,
  mostrarMotivo,
  inputFicheroRef,
  fichero,
  errorFichero,
  onCambioFichero,
}: Props) => (
  <>
    <div className="flex flex-col gap-2">
      <label htmlFor="devolucion-importe" className={claseLabel}>
        Importe devuelto (€)
      </label>
      <div className="relative">
        <Banknote aria-hidden className={claseIcono} />
        <input
          id="devolucion-importe"
          type="text"
          inputMode="decimal"
          disabled={pendiente}
          data-testid="input-importe-devuelto"
          aria-invalid={errors.importeDevuelto ? 'true' : undefined}
          aria-describedby={errors.importeDevuelto ? 'devolucion-importe-error' : undefined}
          className={cn(claseInput, 'pl-11', errors.importeDevuelto ? 'border-red-400' : 'border-border-default')}
          placeholder="Ej.: 1.000,00"
          {...register('importeDevuelto')}
        />
      </div>
      {fianzaEur && (
        <p className="px-1 font-body text-xs text-text-secondary">
          Fianza cobrada: <strong>{formatearEuros(fianzaEur)}</strong>. Devuelve 0 € para retener
          toda la fianza.
        </p>
      )}
      {resultado && !errors.importeDevuelto && (
        <p
          data-testid="indicador-resultado-devolucion"
          data-resultado={resultado}
          className={cn(
            'px-1 font-body text-[13px] font-medium',
            resultado === 'devuelta' ? 'text-emerald-700' : 'text-amber-700',
          )}
        >
          {resultado === 'devuelta'
            ? 'Devolución completa: la fianza quedará como devuelta.'
            : 'Devolución parcial: la fianza quedará como retenida parcial.'}
        </p>
      )}
      {errors.importeDevuelto && (
        <p
          id="devolucion-importe-error"
          role="alert"
          data-testid="error-importe-devuelto"
          className="px-1 font-body text-[13px] text-red-600"
        >
          {errors.importeDevuelto.message}
        </p>
      )}
    </div>

    <div className="flex flex-col gap-2">
      <label htmlFor="devolucion-fecha" className={claseLabel}>
        Fecha de la devolución
      </label>
      <div className="relative">
        <Calendar aria-hidden className={claseIcono} />
        <input
          id="devolucion-fecha"
          type="date"
          min={fianzaCobradaFecha ?? undefined}
          disabled={pendiente}
          data-testid="input-fecha-devolucion"
          aria-invalid={errors.fechaCobro ? 'true' : undefined}
          aria-describedby={errors.fechaCobro ? 'devolucion-fecha-error' : undefined}
          className={cn(claseInput, 'pl-11', errors.fechaCobro ? 'border-red-400' : 'border-border-default')}
          {...register('fechaCobro')}
        />
      </div>
      {errors.fechaCobro && (
        <p
          id="devolucion-fecha-error"
          role="alert"
          data-testid="error-fecha-devolucion"
          className="px-1 font-body text-[13px] text-red-600"
        >
          {errors.fechaCobro.message}
        </p>
      )}
    </div>

    {mostrarMotivo && (
      <div className="flex flex-col gap-2">
        <label htmlFor="devolucion-motivo" className={claseLabel}>
          Motivo de la retención
        </label>
        <div className="relative">
          <MessageSquare aria-hidden className="pointer-events-none absolute left-4 top-4 size-4 text-text-secondary" />
          <textarea
            id="devolucion-motivo"
            rows={3}
            disabled={pendiente}
            data-testid="input-motivo-retencion"
            aria-invalid={errors.motivoRetencion ? 'true' : undefined}
            aria-describedby={errors.motivoRetencion ? 'devolucion-motivo-error' : undefined}
            className={cn(
              'w-full rounded-[16px] border bg-canvas py-3 pl-11 pr-4 font-body text-sm text-text-primary transition placeholder:text-text-secondary/60 focus:outline-none focus:ring-2 focus:ring-brand-primary',
              errors.motivoRetencion ? 'border-red-400' : 'border-border-default',
            )}
            placeholder="Ej.: Daños en vajilla valorados en 500 €"
            {...register('motivoRetencion')}
          />
        </div>
        {errors.motivoRetencion && (
          <p
            id="devolucion-motivo-error"
            role="alert"
            data-testid="error-motivo-retencion"
            className="px-1 font-body text-[13px] text-red-600"
          >
            {errors.motivoRetencion.message}
          </p>
        )}
      </div>
    )}

    <div className="flex flex-col gap-2">
      <label htmlFor="devolucion-justificante" className={claseLabel}>
        Justificante de la transferencia (opcional)
      </label>
      <label
        htmlFor="devolucion-justificante"
        className={cn(
          'flex cursor-pointer flex-col items-center justify-center gap-2 rounded-[16px] border border-dashed px-4 py-6 text-center transition',
          errorFichero
            ? 'border-red-400 bg-red-50/60'
            : 'border-border-default/50 bg-surface-subtle/40 hover:bg-surface-muted',
        )}
      >
        <FileUp aria-hidden className="size-6 text-brand-primary" />
        <span className="font-body text-sm font-medium text-text-primary">
          {fichero ? 'Cambiar fichero' : 'Selecciona o arrastra el justificante'}
        </span>
        <span className="font-body text-xs text-text-secondary">JPG, PNG o PDF · máx. 10 MB</span>
      </label>
      <input
        ref={inputFicheroRef}
        id="devolucion-justificante"
        type="file"
        accept={ACCEPT_JUSTIFICANTE}
        disabled={pendiente}
        onChange={onCambioFichero}
        data-testid="input-justificante-devolucion"
        className="sr-only"
      />
      {fichero && !errorFichero && (
        <p
          data-testid="justificante-devolucion-seleccionado"
          className="flex items-center gap-2 px-1 font-body text-[13px] text-text-secondary"
        >
          <Paperclip aria-hidden className="size-4 shrink-0 text-brand-primary" />
          <span className="truncate">{fichero.name}</span>
          <span className="shrink-0 text-text-secondary/80">({formatearTamano(fichero.size)})</span>
        </p>
      )}
      {errorFichero && (
        <p role="alert" data-testid="error-justificante-devolucion" className="px-1 font-body text-[13px] text-red-600">
          {errorFichero}
        </p>
      )}
      <p className="px-1 font-body text-xs text-text-secondary">
        Si aún no lo tienes, puedes registrar la devolución sin justificante y adjuntarlo más tarde
        desde los documentos de la reserva.
      </p>
    </div>
  </>
);
