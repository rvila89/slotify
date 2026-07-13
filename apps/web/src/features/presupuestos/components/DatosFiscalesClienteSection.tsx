import { forwardRef, useEffect, useImperativeHandle } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useActualizarDatosFiscales } from '../api/useActualizarDatosFiscales';
import { claseInputBase, claseLabel } from './estilos';
import type { CampoFiscalCliente } from './datosFiscalesCampos';
import type { ActualizarDatosFiscalesClienteRequest } from '../model/types';

/**
 * Sección inline "Datos fiscales del cliente" del diálogo de presupuesto (US-014 ·
 * incidencia #5, Parte B). Precarga los 5 campos fiscales del CLIENTE, permite
 * completarlos con **React Hook Form + Zod** y los persiste (PATCH datos fiscales)
 * como paso previo a la generación/confirmación del presupuesto.
 *
 * Forma parte del bucle de resolución (design.md §D-5): cuando el preview/confirmación
 * devuelve `DATOS_FISCALES_INCOMPLETOS` (422), el diálogo padre pasa `camposResaltados`
 * y el foco salta al primer campo faltante; tras un guardado con éxito el padre reintenta.
 *
 * Presentacional/co-locado (privado de la feature). Reutiliza los tokens y clases de
 * inputs del diálogo; mobile-first (una columna en móvil, dos en `sm:`), sin overflow.
 * Las utilidades de campos viven en `./datosFiscalesCampos` para no romper el fast-refresh.
 */

/** Handle imperativo para que el diálogo dispare el guardado dentro del bucle de resolución. */
export type DatosFiscalesHandle = {
  /** Persiste los datos fiscales (PATCH). Resuelve `true` si se guardó con éxito. */
  guardar: () => Promise<boolean>;
  /** Enfoca el primer campo faltante recibido del backend (`camposFaltantes`). */
  enfocarPrimerFaltante: (faltantes: readonly CampoFiscalCliente[]) => void;
};

type ClienteFiscal = {
  dniNif?: string | null;
  direccion?: string | null;
  codigoPostal?: string | null;
  poblacion?: string | null;
  provincia?: string | null;
};

type Props = {
  /** Datos del CLIENTE de la RESERVA (de `ReservaDetalle.cliente`), para precargar. */
  cliente: ClienteFiscal | undefined;
  reservaId: string;
  /** Campos que el backend reportó como faltantes (422): se resaltan visualmente. */
  camposResaltados: readonly CampoFiscalCliente[];
  deshabilitado?: boolean;
};

const MENSAJE_REQUERIDO = 'Completa este dato fiscal del cliente.';

const esquema = z.object({
  dniNif: z.string().trim(),
  direccion: z.string().trim(),
  codigoPostal: z.string().trim(),
  poblacion: z.string().trim(),
  provincia: z.string().trim(),
});

type FormularioDatosFiscales = z.infer<typeof esquema>;

const CAMPOS: readonly { name: CampoFiscalCliente; etiqueta: string; autoComplete: string }[] = [
  { name: 'dniNif', etiqueta: 'DNI / NIF', autoComplete: 'off' },
  { name: 'direccion', etiqueta: 'Dirección', autoComplete: 'street-address' },
  { name: 'codigoPostal', etiqueta: 'Código postal', autoComplete: 'postal-code' },
  { name: 'poblacion', etiqueta: 'Población', autoComplete: 'address-level2' },
  { name: 'provincia', etiqueta: 'Provincia', autoComplete: 'address-level1' },
] as const;

const valoresIniciales = (cliente: ClienteFiscal | undefined): FormularioDatosFiscales => ({
  dniNif: cliente?.dniNif ?? '',
  direccion: cliente?.direccion ?? '',
  codigoPostal: cliente?.codigoPostal ?? '',
  poblacion: cliente?.poblacion ?? '',
  provincia: cliente?.provincia ?? '',
});

/** Body PATCH parcial: solo los campos NO vacíos (D-2, `minProperties:1`, `minLength:1`). */
const construirBodyFiscal = (
  valores: FormularioDatosFiscales,
): ActualizarDatosFiscalesClienteRequest => {
  const body: ActualizarDatosFiscalesClienteRequest = {};
  for (const { name } of CAMPOS) {
    const valor = valores[name].trim();
    if (valor !== '') body[name] = valor;
  }
  return body;
};

export const DatosFiscalesClienteSection = forwardRef<DatosFiscalesHandle, Props>(
  ({ cliente, reservaId, camposResaltados, deshabilitado = false }, ref) => {
    const actualizar = useActualizarDatosFiscales();
    const {
      register,
      reset,
      setFocus,
      setError,
      trigger,
      getValues,
      formState: { errors },
    } = useForm<FormularioDatosFiscales>({
      resolver: zodResolver(esquema),
      defaultValues: valoresIniciales(cliente),
    });

    // Precarga: cuando llegan/actualizan los datos del cliente (query o refetch),
    // sincroniza los valores del formulario sin pisar ediciones en curso del usuario.
    useEffect(() => {
      reset(valoresIniciales(cliente));
    }, [cliente, reset]);

    useImperativeHandle(
      ref,
      () => ({
        guardar: async () => {
          const valido = await trigger();
          if (!valido) return false;
          const body = construirBodyFiscal(getValues());
          // Nada que enviar: no hay campos para persistir (evita el 400 `minProperties`).
          if (Object.keys(body).length === 0) return true;
          try {
            await actualizar.mutateAsync({ id: reservaId, body });
            return true;
          } catch {
            return false;
          }
        },
        enfocarPrimerFaltante: (faltantes) => {
          const primero = CAMPOS.find(({ name }) => faltantes.includes(name));
          if (!primero) return;
          for (const name of faltantes) {
            setError(name, { type: 'server', message: MENSAJE_REQUERIDO });
          }
          setFocus(primero.name);
        },
      }),
      [actualizar, getValues, reservaId, setError, setFocus, trigger],
    );

    return (
      <section className="flex flex-col gap-3" data-testid="seccion-datos-fiscales-cliente">
        <div className="flex flex-col gap-1">
          <h3 className={claseLabel}>Datos fiscales del cliente</h3>
          <p className="px-1 font-body text-[13px] text-text-secondary">
            Necesarios para emitir el presupuesto. Complétalos si el sistema los pide.
          </p>
        </div>

        {actualizar.isError && (
          <p role="alert" className="px-1 font-body text-[13px] text-red-600">
            No se han podido guardar los datos fiscales. Revisa la conexión e inténtalo de nuevo.
          </p>
        )}

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {CAMPOS.map(({ name, etiqueta, autoComplete }) => {
            const resaltado = camposResaltados.includes(name);
            const conError = Boolean(errors[name]) || resaltado;
            const idInput = `datos-fiscales-${name}`;
            return (
              <div
                key={name}
                className={name === 'direccion' ? 'flex flex-col gap-2 sm:col-span-2' : 'flex flex-col gap-2'}
              >
                <label htmlFor={idInput} className={claseLabel}>
                  {etiqueta}
                </label>
                <input
                  id={idInput}
                  type="text"
                  autoComplete={autoComplete}
                  disabled={deshabilitado || actualizar.isPending}
                  aria-invalid={conError ? 'true' : undefined}
                  data-testid={`input-fiscal-${name}`}
                  {...register(name)}
                  className={
                    conError
                      ? `${claseInputBase} border-red-400 ring-2 ring-red-400`
                      : `${claseInputBase} border-border-default/30`
                  }
                />
                {errors[name] && (
                  <p role="alert" className="px-1 font-body text-[13px] text-red-600">
                    {errors[name]?.message}
                  </p>
                )}
              </div>
            );
          })}
        </div>
      </section>
    );
  },
);

DatosFiscalesClienteSection.displayName = 'DatosFiscalesClienteSection';
