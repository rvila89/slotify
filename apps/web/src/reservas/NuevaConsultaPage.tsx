import { useState } from 'react';
import { useForm, type UseFormSetError } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useMutation } from '@tanstack/react-query';
import { AlertTriangle, CheckCircle2, ChevronDown, X } from 'lucide-react';
import { apiClient, type components } from '@/api-client';
import { cn } from '@/lib/utils';

/**
 * Alta de consulta exploratoria sin fecha (US-003 · UC-03).
 *
 * Diseño: archivo Figma "Slotify" (`rBCYMkAoQQRVnWhOxXatio`). NO existe un frame
 * propio de "Nueva consulta" ni versión móvil; se ADAPTA el lenguaje visual del
 * frame `0:382` "Nueva Reserva" (mapeado a US-014): tarjeta blanca con borde y
 * sombra suave (`shadow rgba(141,77,57,0.05)`), secciones numeradas sobre fondo
 * `surface-subtle/30`, inputs `bg-canvas` con borde `border-default/30` y toggles
 * de duración en `state-confirmada`. Tokens de `index.css`/`tailwind.config.ts`
 * (NO hex sueltos salvo el `#5b2615` del texto sobre terracota, que ya usa el
 * login). Tipografía Epilogue (display) + Manrope (body).
 *
 * Adaptaciones a US-003 frente al frame de referencia:
 *  - Se SEPARA "Nombre Completo" en `nombre` + `apellidos` (ambos obligatorios
 *    por contrato `CreateClienteRequest`).
 *  - Se OMITE el campo "Fecha": esta US es la consulta exploratoria SIN fecha
 *    (sub-estado 2.a). Con fecha el alta nace en 2.b (US-004/005), fuera de
 *    alcance.
 *  - Mobile-first: una columna en móvil, dos en `sm:`; paddings reducidos; sin
 *    overflow horizontal; objetivos táctiles ≥ 48px. El chrome (sidebar→drawer)
 *    lo aporta el AppShell.
 *
 * Comportamiento E1 (clave de la US): si el gestor rellena `comentarios`, tras
 * crear la consulta la UI ALERTA de un borrador E1 pendiente de revisar (el
 * email NO se envía). Sin comentarios, el E1 se auto-envía y se informa de ello.
 * El SDK generado (`apiClient.POST('/reservas')`) es la única vía a la API; los
 * errores 400 por campo se mapean a los campos del formulario en español.
 */
type CreateReservaRequest = components['schemas']['CreateReservaRequest'];
type CanalEntrada = components['schemas']['CanalEntrada'];
type TipoEvento = components['schemas']['TipoEvento'];
type DuracionHoras = components['schemas']['DuracionHoras'];
type Reserva = components['schemas']['Reserva'];
type ErrorResponse = components['schemas']['ErrorResponse'];

const CANALES: { value: CanalEntrada; label: string }[] = [
  { value: 'web', label: 'Web' },
  { value: 'email', label: 'Email' },
  { value: 'whatsapp', label: 'WhatsApp' },
  { value: 'instagram', label: 'Instagram' },
  { value: 'telefono', label: 'Teléfono' },
];

const TIPOS: { value: TipoEvento; label: string }[] = [
  { value: 'boda', label: 'Boda' },
  { value: 'corporativo', label: 'Corporativo' },
  { value: 'privado', label: 'Privado' },
  { value: 'otro', label: 'Otro' },
];

const DURACIONES = ['4', '8', '12'] as const;

const CANAL_VALUES = CANALES.map((c) => c.value) as CanalEntrada[];

// RFC 5322 básico, alineado al `pattern` del contrato (local@dominio.tld).
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

const esquema = z.object({
  nombre: z
    .string()
    .trim()
    .min(1, 'El nombre es obligatorio')
    .max(100, 'Máximo 100 caracteres'),
  apellidos: z
    .string()
    .trim()
    .min(1, 'Los apellidos son obligatorios')
    .max(100, 'Máximo 100 caracteres'),
  email: z
    .string()
    .trim()
    .min(1, 'El email es obligatorio')
    .max(254, 'Máximo 254 caracteres')
    .regex(EMAIL_RE, 'Introduce un email válido'),
  telefono: z.string().trim().min(1, 'El teléfono es obligatorio'),
  canalEntrada: z
    .string()
    .refine((v) => CANAL_VALUES.includes(v as CanalEntrada), {
      message: 'Selecciona un canal de entrada',
    }),
  invitados: z
    .string()
    .trim()
    .regex(/^\d*$/, 'Introduce un número de invitados válido'),
  duracionHoras: z.union([z.enum(DURACIONES), z.literal('')]),
  tipoEvento: z.union([z.enum(['boda', 'corporativo', 'privado', 'otro']), z.literal('')]),
  comentarios: z.string().max(2000, 'Máximo 2000 caracteres'),
});

type FormularioConsulta = z.infer<typeof esquema>;

const valoresIniciales: FormularioConsulta = {
  nombre: '',
  apellidos: '',
  email: '',
  telefono: '',
  canalEntrada: '',
  invitados: '',
  duracionHoras: '',
  tipoEvento: '',
  comentarios: '',
};

type VariablesAlta = { body: CreateReservaRequest; tieneComentarios: boolean };
type ErrorAlta = { status?: number; body?: ErrorResponse };
type ResultadoAlta = { reserva: Reserva; tieneComentarios: boolean };

/**
 * Mapea los mensajes de validación del backend (400, formato NestJS: `message`
 * string o string[]) a los campos del formulario, en español. Devuelve cuántos
 * se pudieron asignar para decidir si además mostrar un aviso general.
 */
const aplicarErroresDeCampo = (
  mensajes: string[],
  setError: UseFormSetError<FormularioConsulta>,
): number => {
  let mapeados = 0;
  for (const mensaje of mensajes) {
    const m = mensaje.toLowerCase();
    if (m.includes('apellido')) {
      setError('apellidos', { message: mensaje });
    } else if (m.includes('nombre')) {
      setError('nombre', { message: mensaje });
    } else if (m.includes('email') || m.includes('correo')) {
      setError('email', { message: mensaje });
    } else if (m.includes('tel')) {
      setError('telefono', { message: mensaje });
    } else if (m.includes('canal')) {
      setError('canalEntrada', { message: mensaje });
    } else {
      continue;
    }
    mapeados += 1;
  }
  return mapeados;
};

const claseInput =
  'h-14 w-full rounded-[12px] border border-border-default/30 bg-canvas px-4 font-body text-base text-text-primary outline-none ring-1 ring-transparent transition placeholder:text-text-secondary/40 focus-visible:ring-2 focus-visible:ring-brand-primary aria-[invalid=true]:ring-2 aria-[invalid=true]:ring-red-500 sm:px-5';

const claseLabel = 'px-1 font-body text-xs font-medium tracking-[0.48px] text-text-secondary';

const Campo = ({
  id,
  label,
  opcional,
  error,
  children,
  className,
}: {
  id: string;
  label: string;
  opcional?: boolean;
  error?: string;
  children: React.ReactNode;
  className?: string;
}) => (
  <div className={cn('flex flex-col gap-2', className)}>
    <label htmlFor={id} className={claseLabel}>
      {label}
      {opcional && <span className="ml-1 font-normal text-text-muted">(opcional)</span>}
    </label>
    {children}
    {error && (
      <p id={`${id}-error`} role="alert" className="px-1 font-body text-[13px] text-red-600">
        {error}
      </p>
    )}
  </div>
);

const SeccionHeader = ({ numero, titulo }: { numero: number; titulo: string }) => (
  <div className="flex items-center gap-4">
    <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-brand-primary/10 font-body text-base font-bold text-brand-primary">
      {numero}
    </span>
    <h2 className="font-body text-xs font-bold uppercase tracking-[1.4px] text-text-secondary sm:text-sm">
      {titulo}
    </h2>
  </div>
);

const claseSeccion =
  'flex flex-col gap-6 rounded-[20px] border border-border-default/20 bg-surface-subtle/30 p-4 sm:p-6 lg:p-10';

export const NuevaConsultaPage = () => {
  const [errorApi, setErrorApi] = useState<string | null>(null);
  const [resultado, setResultado] = useState<ResultadoAlta | null>(null);

  const {
    register,
    handleSubmit,
    setError,
    setValue,
    watch,
    reset,
    formState: { errors },
  } = useForm<FormularioConsulta>({
    resolver: zodResolver(esquema),
    defaultValues: valoresIniciales,
  });

  const canalSeleccionado = watch('canalEntrada');
  const tipoSeleccionado = watch('tipoEvento');
  const duracionSeleccionada = watch('duracionHoras');

  const mutation = useMutation({
    mutationFn: async ({ body }: VariablesAlta) => {
      const { data, error, response } = await apiClient.POST('/reservas', { body });
      if (error || !data) {
        throw { status: response?.status, body: error as ErrorResponse | undefined } satisfies ErrorAlta;
      }
      return data;
    },
    onSuccess: (reserva, variables) => {
      setErrorApi(null);
      setResultado({ reserva, tieneComentarios: variables.tieneComentarios });
      reset(valoresIniciales);
      if (typeof window !== 'undefined') {
        window.scrollTo({ top: 0, behavior: 'smooth' });
      }
    },
    onError: (err: ErrorAlta) => {
      setResultado(null);
      if (err.status === 400 && err.body) {
        const mensajes = Array.isArray(err.body.message) ? err.body.message : [err.body.message];
        const mapeados = aplicarErroresDeCampo(mensajes, setError);
        setErrorApi(mapeados === 0 ? mensajes.join(' ') : null);
      } else {
        setErrorApi('No se ha podido crear la consulta. Inténtalo de nuevo.');
      }
    },
  });

  const onSubmit = handleSubmit((valores) => {
    setErrorApi(null);
    setResultado(null);

    const comentarios = valores.comentarios.trim();
    const body: CreateReservaRequest = {
      canalEntrada: valores.canalEntrada as CanalEntrada,
      cliente: {
        nombre: valores.nombre.trim(),
        apellidos: valores.apellidos.trim(),
        email: valores.email.trim(),
        telefono: valores.telefono.trim(),
      },
      ...(comentarios ? { comentarios } : {}),
      ...(valores.tipoEvento ? { tipoEvento: valores.tipoEvento as TipoEvento } : {}),
      ...(valores.duracionHoras
        ? { duracionHoras: Number(valores.duracionHoras) as DuracionHoras }
        : {}),
      ...(valores.invitados ? { numAdultosNinosMayores4: Number(valores.invitados) } : {}),
    };

    mutation.mutate({ body, tieneComentarios: Boolean(comentarios) });
  });

  return (
    <div className="mx-auto flex w-full max-w-[1000px] flex-col gap-6">
      <header className="flex flex-col gap-1">
        <h1 className="font-display text-2xl font-bold tracking-tight text-text-primary sm:text-3xl">
          Nueva consulta
        </h1>
        <p className="font-body text-sm text-text-secondary sm:text-base">
          Registra un lead exploratorio sin fecha de evento. Podrás asignarle una fecha más adelante.
        </p>
      </header>

      {/* Feedback de éxito: la diferencia E1 enviado vs E1 borrador (REQ clave US-003). */}
      {resultado?.tieneComentarios && (
        <div
          role="alert"
          data-testid="alerta-e1-borrador"
          className="flex items-start gap-3 rounded-[16px] border border-amber-200 bg-amber-50 p-4 text-amber-900"
        >
          <AlertTriangle aria-hidden className="mt-0.5 size-5 shrink-0 text-amber-600" />
          <div className="flex-1">
            <p className="font-body text-sm font-bold">
              Consulta {resultado.reserva.codigo} creada — borrador E1 pendiente
            </p>
            <p className="font-body text-sm">
              Como has añadido comentarios, el email de respuesta inicial (E1) ha quedado en{' '}
              <strong>borrador</strong> y <strong>no se ha enviado</strong>. Revísalo y confírmalo
              para enviarlo al cliente.
            </p>
          </div>
          <button
            type="button"
            aria-label="Cerrar aviso"
            onClick={() => setResultado(null)}
            className="rounded-full p-1 text-amber-700 transition hover:bg-amber-100"
          >
            <X aria-hidden className="size-4" />
          </button>
        </div>
      )}

      {resultado && !resultado.tieneComentarios && (
        <div
          role="status"
          data-testid="alerta-e1-enviado"
          className="flex items-start gap-3 rounded-[16px] border border-emerald-200 bg-emerald-50 p-4 text-emerald-900"
        >
          <CheckCircle2 aria-hidden className="mt-0.5 size-5 shrink-0 text-emerald-600" />
          <div className="flex-1">
            <p className="font-body text-sm font-bold">
              Consulta {resultado.reserva.codigo} creada
            </p>
            <p className="font-body text-sm">
              El email de respuesta inicial (E1) se ha <strong>enviado automáticamente</strong> al
              cliente.
            </p>
          </div>
          <button
            type="button"
            aria-label="Cerrar aviso"
            onClick={() => setResultado(null)}
            className="rounded-full p-1 text-emerald-700 transition hover:bg-emerald-100"
          >
            <X aria-hidden className="size-4" />
          </button>
        </div>
      )}

      {errorApi && (
        <div
          role="alert"
          data-testid="error-api"
          className="rounded-[16px] border border-red-200 bg-red-50 px-4 py-3 font-body text-sm text-red-700"
        >
          {errorApi}
        </div>
      )}

      <form
        onSubmit={onSubmit}
        noValidate
        data-testid="form-nueva-consulta"
        className="flex flex-col gap-6 rounded-[24px] border border-border-default bg-white p-4 shadow-[0px_1px_2px_0px_rgba(141,77,57,0.05)] sm:p-6 lg:gap-10 lg:p-10"
      >
        {/* Sección 1 — Datos del cliente (todos obligatorios por contrato). */}
        <section className={claseSeccion} aria-labelledby="seccion-cliente">
          <div id="seccion-cliente">
            <SeccionHeader numero={1} titulo="Datos del cliente" />
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 sm:gap-6">
            <Campo id="nombre" label="Nombre" error={errors.nombre?.message}>
              <input
                id="nombre"
                type="text"
                autoComplete="given-name"
                placeholder="Ej. Javier"
                aria-invalid={errors.nombre ? 'true' : undefined}
                aria-describedby={errors.nombre ? 'nombre-error' : undefined}
                {...register('nombre')}
                className={claseInput}
              />
            </Campo>

            <Campo id="apellidos" label="Apellidos" error={errors.apellidos?.message}>
              <input
                id="apellidos"
                type="text"
                autoComplete="family-name"
                placeholder="Ej. Gómez Ruiz"
                aria-invalid={errors.apellidos ? 'true' : undefined}
                aria-describedby={errors.apellidos ? 'apellidos-error' : undefined}
                {...register('apellidos')}
                className={claseInput}
              />
            </Campo>

            <Campo id="email" label="Email de contacto" error={errors.email?.message}>
              <input
                id="email"
                type="email"
                autoComplete="email"
                placeholder="javier@ejemplo.com"
                aria-invalid={errors.email ? 'true' : undefined}
                aria-describedby={errors.email ? 'email-error' : undefined}
                {...register('email')}
                className={claseInput}
              />
            </Campo>

            <Campo id="telefono" label="Teléfono" error={errors.telefono?.message}>
              <input
                id="telefono"
                type="tel"
                autoComplete="tel"
                placeholder="+34 600 000 000"
                aria-invalid={errors.telefono ? 'true' : undefined}
                aria-describedby={errors.telefono ? 'telefono-error' : undefined}
                {...register('telefono')}
                className={claseInput}
              />
            </Campo>

            <Campo
              id="canalEntrada"
              label="Canal de entrada"
              error={errors.canalEntrada?.message}
              className="sm:col-span-2"
            >
              <div className="relative">
                <select
                  id="canalEntrada"
                  aria-invalid={errors.canalEntrada ? 'true' : undefined}
                  aria-describedby={errors.canalEntrada ? 'canalEntrada-error' : undefined}
                  {...register('canalEntrada')}
                  className={cn(
                    claseInput,
                    'appearance-none pr-12',
                    !canalSeleccionado && 'text-text-secondary/40',
                  )}
                >
                  <option value="">Selecciona un canal</option>
                  {CANALES.map(({ value, label }) => (
                    <option key={value} value={value} className="text-text-primary">
                      {label}
                    </option>
                  ))}
                </select>
                <ChevronDown
                  aria-hidden
                  className="pointer-events-none absolute right-4 top-1/2 size-5 -translate-y-1/2 text-text-secondary"
                />
              </div>
            </Campo>
          </div>
        </section>

        {/* Sección 2 — Detalles del evento (opcionales; sin fecha en la 2.a). */}
        <section className={claseSeccion} aria-labelledby="seccion-evento">
          <div id="seccion-evento">
            <SeccionHeader numero={2} titulo="Detalles del evento" />
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 sm:gap-6">
            <Campo id="invitados" label="Invitados" opcional error={errors.invitados?.message}>
              <input
                id="invitados"
                type="text"
                inputMode="numeric"
                placeholder="Ej. 50"
                aria-invalid={errors.invitados ? 'true' : undefined}
                aria-describedby={errors.invitados ? 'invitados-error' : undefined}
                {...register('invitados')}
                className={claseInput}
              />
            </Campo>

            <Campo id="tipoEvento" label="Tipo de evento" opcional>
              <div className="relative">
                <select
                  id="tipoEvento"
                  {...register('tipoEvento')}
                  className={cn(
                    claseInput,
                    'appearance-none pr-12',
                    !tipoSeleccionado && 'text-text-secondary/40',
                  )}
                >
                  <option value="">Sin especificar</option>
                  {TIPOS.map(({ value, label }) => (
                    <option key={value} value={value} className="text-text-primary">
                      {label}
                    </option>
                  ))}
                </select>
                <ChevronDown
                  aria-hidden
                  className="pointer-events-none absolute right-4 top-1/2 size-5 -translate-y-1/2 text-text-secondary"
                />
              </div>
            </Campo>

            <div className="flex flex-col gap-2 sm:col-span-2">
              <span className={claseLabel}>
                Horas de duración
                <span className="ml-1 font-normal text-text-muted">(opcional)</span>
              </span>
              <div className="grid grid-cols-3 gap-3" role="group" aria-label="Horas de duración">
                {DURACIONES.map((horas) => {
                  const activo = duracionSeleccionada === horas;
                  return (
                    <button
                      key={horas}
                      type="button"
                      aria-pressed={activo}
                      onClick={() =>
                        setValue('duracionHoras', activo ? '' : horas, { shouldDirty: true })
                      }
                      className={cn(
                        'flex h-14 items-center justify-center rounded-[12px] border font-body text-base font-medium transition',
                        activo
                          ? 'border-transparent bg-state-confirmada text-[#5b2615]'
                          : 'border-border-default/30 bg-canvas text-text-secondary hover:bg-surface-muted',
                      )}
                    >
                      {horas}h
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="flex flex-col gap-2 sm:col-span-2">
              <label htmlFor="comentarios" className={claseLabel}>
                Comentarios y requisitos
                <span className="ml-1 font-normal text-text-muted">(opcional)</span>
              </label>
              <textarea
                id="comentarios"
                rows={4}
                placeholder="Notas del gestor sobre el lead…"
                {...register('comentarios')}
                className={cn(claseInput, 'h-auto min-h-[120px] resize-y py-3')}
              />
              {errors.comentarios?.message ? (
                <p role="alert" className="px-1 font-body text-[13px] text-red-600">
                  {errors.comentarios.message}
                </p>
              ) : (
                <p className="px-1 font-body text-[13px] text-text-muted">
                  Si añades comentarios, el email de respuesta inicial (E1) quedará en borrador para
                  tu revisión y no se enviará automáticamente.
                </p>
              )}
            </div>
          </div>
        </section>

        <div className="flex justify-end pt-2">
          <button
            type="submit"
            disabled={mutation.isPending}
            className="inline-flex h-14 w-full items-center justify-center gap-2 rounded-full bg-brand-primary px-10 font-display text-base text-brand-foreground transition hover:opacity-95 disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto sm:px-16"
          >
            {mutation.isPending ? 'Creando…' : 'Crear consulta'}
          </button>
        </div>
      </form>
    </div>
  );
};
