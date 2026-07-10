import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { AlertTriangle, CheckCircle2, Landmark, Send } from 'lucide-react';
import { useRegistrarIbanDevolucion } from '../api/useRegistrarIbanDevolucion';
import { ibanFormSchema, type IbanFormInput, type IbanFormOutput } from '../lib/ibanSchema';
import { AvisoE8Fallido } from './AvisoE8Fallido';
import type { components } from '@/api-client';

type RegistrarIbanDevolucionResponse = components['schemas']['RegistrarIbanDevolucionResponse'];

/**
 * Tarjeta de la ficha de post-evento para "Registrar IBAN de devolución" (US-035 ·
 * UC-26/UC-27). Solo se monta cuando la RESERVA está en `post_evento` **Y**
 * `fianzaEur > 0` (FA-04); la decisión de montaje vive en `FichaConsultaPage` con
 * `puedeRegistrarIban`, así el componente no renderiza si no hay fianza.
 *
 * - FA-01: validación mod-97 en cliente (Zod) para UX; el 422 del servidor se muestra
 *   inline bajo el campo (fuente de verdad = backend).
 * - FA-02: precarga el `ibanExistente` (de `cliente.ibanDevolucion`) como valor por
 *   defecto; registrarlo de nuevo lo revalida y reenvía E8.
 * - FA-03: un 200 con `avisoEmail` presente muestra la alerta de E8 fallido con botón
 *   de reenvío (reintenta la misma mutación con el mismo IBAN).
 *
 * Diseño: no hay frame Figma para post-evento/IBAN en el archivo "Slotify"; se ADAPTA
 * con los tokens del proyecto (`index.css`/`DESIGN.md`), reutilizando el tratamiento
 * de `FacturaSenalCard`/`AvisoEventoFinalizado`. Mobile-first: sin overflow horizontal
 * (`w-full`, `break-all` en el IBAN mostrado), input a ancho completo, botón `w-full`
 * en móvil y `sm:w-auto`, objetivos táctiles ≥ 48px (`h-12`/`h-14`).
 */
type Props = {
  reservaId: string;
  /** IBAN ya registrado del CLIENTE, para precargar en corrección (FA-02). */
  ibanExistente?: string | null;
};

const claseInput =
  'h-14 w-full rounded-[12px] border border-border-default/30 bg-canvas px-4 font-body text-base uppercase tracking-wide text-text-primary outline-none ring-1 ring-transparent transition placeholder:text-text-secondary/40 placeholder:normal-case focus-visible:ring-2 focus-visible:ring-brand-primary aria-[invalid=true]:ring-2 aria-[invalid=true]:ring-red-500 sm:px-5';

const claseBotonPrimario =
  'inline-flex h-12 w-full items-center justify-center gap-2 rounded-full bg-brand-primary px-8 font-display text-base text-brand-foreground transition hover:opacity-95 disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto';

const claseSeccion =
  'flex flex-col gap-6 rounded-[20px] border border-border-default/20 bg-surface-subtle/30 p-4 sm:p-6 lg:p-8';

export const IbanDevolucionCard = ({ reservaId, ibanExistente }: Props) => {
  const mutation = useRegistrarIbanDevolucion();
  // Resultado del último 200: guarda el IBAN persistido + `avisoEmail` (FA-03).
  const [resultado, setResultado] = useState<RegistrarIbanDevolucionResponse | null>(null);

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<IbanFormInput, unknown, IbanFormOutput>({
    resolver: zodResolver(ibanFormSchema),
    defaultValues: { iban: ibanExistente ?? '' },
  });

  const errorServidor = mutation.error;
  const errorIbanInline =
    errors.iban?.message ?? (errorServidor?.tipo === 'iban_invalido' ? errorServidor.mensaje : undefined);
  const errorGeneral =
    errorServidor && errorServidor.tipo !== 'iban_invalido' ? errorServidor.mensaje : undefined;

  const guardar = ({ iban }: IbanFormOutput) => {
    mutation.mutate({ id: reservaId, iban }, { onSuccess: setResultado });
  };

  // FA-03: reenvío de E8 → reintenta la misma mutación con el IBAN ya guardado.
  const reenviar = () => {
    if (!resultado) return;
    mutation.mutate({ id: reservaId, iban: resultado.iban }, { onSuccess: setResultado });
  };

  const avisoEmail = resultado?.avisoEmail ?? null;
  const guardadoOk = Boolean(resultado) && !avisoEmail;

  return (
    <section className={claseSeccion} aria-labelledby="ficha-iban-devolucion">
      <div id="ficha-iban-devolucion" className="flex items-center gap-3">
        <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-brand-primary/10 text-brand-primary">
          <Landmark aria-hidden className="size-4" />
        </span>
        <h2 className="font-body text-xs font-bold uppercase tracking-[1.4px] text-text-secondary sm:text-sm">
          IBAN de devolución de la fianza
        </h2>
      </div>

      <p className="font-body text-sm text-text-secondary">
        Registra el IBAN que el cliente te ha proporcionado para devolverle la fianza. Al guardarlo,
        se enviará al cliente un email de confirmación con los próximos pasos de la devolución.
      </p>

      <form
        onSubmit={handleSubmit(guardar)}
        noValidate
        className="flex flex-col gap-5"
        data-testid="form-iban-devolucion"
      >
        <div className="flex flex-col gap-2">
          <label
            htmlFor="iban-devolucion"
            className="px-1 font-body text-xs font-medium tracking-[0.48px] text-text-secondary"
          >
            IBAN
          </label>
          <input
            id="iban-devolucion"
            data-testid="input-iban"
            type="text"
            autoComplete="off"
            spellCheck={false}
            placeholder="ES91 2100 0418 4502 0005 1332"
            aria-invalid={errorIbanInline ? true : undefined}
            aria-describedby={errorIbanInline ? 'iban-devolucion-error' : undefined}
            className={claseInput}
            {...register('iban')}
          />
          {errorIbanInline && (
            <p
              id="iban-devolucion-error"
              role="alert"
              data-testid="error-iban"
              className="px-1 font-body text-[13px] text-red-600"
            >
              {errorIbanInline}
            </p>
          )}
        </div>

        {errorGeneral && (
          <div
            role="alert"
            data-testid="aviso-error-iban"
            className="flex items-start gap-3 rounded-[16px] border border-red-200 bg-red-50 p-4 text-red-700"
          >
            <AlertTriangle aria-hidden className="mt-0.5 size-5 shrink-0 text-red-600" />
            <p className="font-body text-sm">{errorGeneral}</p>
          </div>
        )}

        {guardadoOk && resultado && (
          <div
            role="status"
            data-testid="aviso-iban-guardado"
            className="flex items-start gap-3 rounded-[16px] border border-emerald-200 bg-emerald-50 p-4 text-emerald-800"
          >
            <CheckCircle2 aria-hidden className="mt-0.5 size-5 shrink-0 text-emerald-600" />
            <p className="font-body text-sm">
              IBAN <strong className="break-all">{resultado.iban}</strong> guardado. Se ha enviado
              al cliente el email de confirmación de recepción.
            </p>
          </div>
        )}

        {avisoEmail && (
          <AvisoE8Fallido
            mensaje={avisoEmail.mensaje}
            reenviando={mutation.isPending}
            onReenviar={reenviar}
          />
        )}

        <div className="flex justify-end">
          <button
            type="submit"
            disabled={mutation.isPending}
            data-testid="guardar-iban"
            className={claseBotonPrimario}
          >
            <Send aria-hidden className="size-5" />
            {mutation.isPending ? 'Guardando…' : 'Guardar IBAN'}
          </button>
        </div>
      </form>
    </section>
  );
};
