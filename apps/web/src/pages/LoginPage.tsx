import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useMutation } from '@tanstack/react-query';
import { useLocation, useNavigate } from 'react-router-dom';
import { ArrowRight, CalendarDays, Eye, EyeOff, Info, Lock, Mail, Sparkles } from 'lucide-react';
import { apiClient } from '@/api-client';
import { useSessionActions } from '@/auth/session';
import heroMasia from '@/assets/login/hero-masia.webp';
import googleIcon from '@/assets/login/google.jpg';
import appleIcon from '@/assets/login/apple.jpg';

/**
 * Página de login (US-001) — revestida con el diseño REAL de Figma.
 *
 * Diseño: archivo Figma "Slotify" (`rBCYMkAoQQRVnWhOxXatio`), frame `0:3` (login
 * desktop) y `0:304` (login mobile). Dos columnas 50/50 a pantalla completa en
 * desktop; en mobile el hero se reduce a una franja superior y el formulario
 * queda en stack debajo (breakpoints Tailwind `lg:`). Columna izquierda: foto de
 * la masía (`hero-masia.webp`) con overlay terracota `rgba(141,77,57,0.1)` en
 * `mix-blend-multiply` + tarjeta glassmorphism (`backdrop-blur`). Columna derecha:
 * brand anchor (logo terracota + wordmark SLOTIFY) + formulario. Tokens de
 * `apps/web/src/index.css` (paleta cálida mediterránea) consumidos vía clases
 * Tailwind (`bg-canvas`, `bg-accent-active`, `text-text-primary`,
 * `bg-state-confirmada`, `font-display`, …); los alphas/hex sin token se expresan
 * con sintaxis arbitraria de Tailwind. Tipografía: Epilogue (display) + Manrope (ui).
 *
 * COMPORTAMIENTO (intacto respecto al scaffolding previo):
 * Validación por campo con React Hook Form + Zod ANTES de tocar la API (REQ 9).
 * El submit dispara una mutación TanStack Query contra el SDK generado
 * (`apiClient.POST('/auth/login')`). En éxito puebla la sesión EN MEMORIA
 * (`iniciarSesion`, sin storage — REQ 10) y navega al calendario respetando
 * `state.from` (deep-link preservado por `RequireAuth`). Errores de la API
 * mapeados a copy en español: 401 → mensaje genérico anti-enumeration (REQ 3 /
 * FA-01); 429 → aviso de demasiados intentos (REQ 8).
 *
 * Elementos visuales del diseño SIN lógica en US-001 (placeholders inertes,
 * fuera de alcance): enlace "¿Olvidaste tu contraseña?", checkbox "Recordarme",
 * botones de proveedor social (Google/Apple) y "Crea una ahora". No cablean
 * ninguna acción.
 */
const esquemaLogin = z.object({
  email: z
    .string()
    .min(1, 'El email es obligatorio')
    .email('Introduce un email válido'),
  password: z.string().min(1, 'La contraseña es obligatoria'),
});

type FormularioLogin = z.infer<typeof esquemaLogin>;

type ErrorLogin = { status?: number };

const mensajePorError = (status?: number): string => {
  if (status === 429) {
    return 'Demasiados intentos. Espera unos minutos antes de volver a intentarlo.';
  }
  if (status === 401) {
    return 'Credenciales incorrectas. Revisa el email y la contraseña.';
  }
  return 'No se ha podido iniciar sesión. Inténtalo de nuevo.';
};

const claseInput =
  'h-[56px] w-full rounded-[12px] bg-accent-active pr-4 font-body text-[16px] text-text-primary placeholder:text-[#6b7280] outline-none ring-1 ring-transparent transition focus-visible:ring-2 focus-visible:ring-brand-primary aria-[invalid=true]:ring-2 aria-[invalid=true]:ring-red-500';

export const LoginPage = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { iniciarSesion } = useSessionActions();
  const [errorApi, setErrorApi] = useState<string | null>(null);
  const [mostrarPassword, setMostrarPassword] = useState(false);

  const destino =
    (location.state as { from?: { pathname?: string } } | null)?.from?.pathname ?? '/calendario';

  // Aviso de cierre de sesión degradado (US-002): cuando el logout falla por red,
  // `useLogout` redirige a `/login` transportando el aviso por el `state` de
  // navegación. `SidebarContent` se desmonta en la redirección, así que el banner
  // PERSISTE aquí en lugar de desaparecer antes de ser leído.
  const avisoLogout =
    (location.state as { avisoLogout?: string } | null)?.avisoLogout ?? null;

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<FormularioLogin>({
    resolver: zodResolver(esquemaLogin),
    defaultValues: { email: '', password: '' },
  });

  const mutation = useMutation({
    mutationFn: async (valores: FormularioLogin) => {
      const { data, error, response } = await apiClient.POST('/auth/login', { body: valores });
      if (error || !data) {
        throw { status: response?.status } satisfies ErrorLogin;
      }
      return data;
    },
    onSuccess: (data) => {
      setErrorApi(null);
      iniciarSesion(data.accessToken, data.usuario);
      navigate(destino, { replace: true });
    },
    onError: (error: ErrorLogin) => {
      setErrorApi(mensajePorError(error?.status));
    },
  });

  const onSubmit = handleSubmit((valores) => {
    setErrorApi(null);
    mutation.mutate(valores);
  });

  return (
    <main className="min-h-screen w-full bg-canvas font-body text-text-primary lg:grid lg:grid-cols-2">
      {/*
        Columna IZQUIERDA — Visual / Brand Area (frame 0:3). En mobile (frame
        0:304) se reduce a una franja superior; en lg ocupa media pantalla a
        toda altura. Foto de la masía con overlay terracota en multiply +
        tarjeta esmerilada con el copy en vivo.
      */}
      <aside className="relative flex h-[220px] items-center justify-center overflow-hidden bg-surface-subtle p-5 lg:h-auto lg:p-12">
        <img
          src={heroMasia}
          alt=""
          aria-hidden="true"
          className="absolute inset-0 h-full w-full object-cover"
        />
        <div
          aria-hidden="true"
          className="absolute inset-0 bg-[rgba(141,77,57,0.1)] mix-blend-multiply"
        />

        <div className="relative z-10 flex w-full max-w-[512px] flex-col items-center gap-3 rounded-[16px] border border-white/20 bg-white/10 p-6 text-center backdrop-blur-[6px] lg:gap-6 lg:p-[65px]">
          <h2 className="font-display text-[28px] font-extrabold leading-[32px] tracking-[-0.5px] text-text-primary lg:text-[60px] lg:leading-[60px] lg:tracking-[-1.5px]">
            Organiza y gestiona con control
          </h2>
          <p className="hidden font-body text-[20px] leading-[28px] tracking-[0.5px] text-text-secondary lg:block">
            La plataforma de gestión integral para espacios boutique de eventos privados
          </p>
        </div>

        {/* Detalle decorativo (abajo-izquierda) — solo desktop. */}
        <p className="absolute bottom-12 left-12 z-10 hidden items-center gap-2 font-body text-[14px] font-semibold tracking-[0.14px] text-[rgba(28,28,25,0.6)] lg:flex">
          <Sparkles aria-hidden="true" className="size-4" />
          Diseñado para el bienestar profesional
        </p>
      </aside>

      {/* Columna DERECHA — Login Form (frame 0:3). */}
      <div className="flex items-center justify-center bg-canvas px-6 py-12 lg:p-12">
        <div className="flex w-full max-w-[400px] flex-col">
          {/* Aviso de cierre degradado (US-002): persistente tras la redirección
              desde el logout best-effort. `role="status"` + `aria-live` para que los
              lectores de pantalla lo anuncien sin interrumpir el foco del formulario. */}
          {avisoLogout && (
            <div
              role="status"
              aria-live="polite"
              className="mb-8 flex items-start gap-2 rounded-[12px] border border-border-default bg-surface-muted px-4 py-3 font-body text-[14px] leading-[20px] text-text-secondary"
            >
              <Info aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-brand-primary" />
              <span>{avisoLogout}</span>
            </div>
          )}

          {/* Brand anchor: logo terracota + wordmark, título y subtítulo. */}
          <div className="flex flex-col pb-16">
            <div className="flex items-center gap-2 pb-4">
              <span className="flex size-10 items-center justify-center rounded-[12px] bg-state-confirmada">
                <CalendarDays aria-hidden="true" className="size-5 text-white" />
              </span>
              <span className="font-display text-[28px] font-bold uppercase tracking-[2.8px] text-brand-primary">
                Slotify
              </span>
            </div>
            <h1 className="pb-2 font-display text-[30px] font-bold leading-[36px] tracking-[-0.75px] text-text-primary">
              Bienvenido de nuevo
            </h1>
            <p className="font-body text-[16px] leading-[24px] text-[rgba(83,67,63,0.8)]">
              Introduce tus credenciales para acceder a tu panel.
            </p>
          </div>

          <form onSubmit={onSubmit} noValidate className="flex w-full flex-col gap-6">
            {errorApi && (
              <p
                role="alert"
                className="rounded-[12px] border border-red-200 bg-red-50 px-4 py-3 font-body text-[14px] text-red-700"
              >
                {errorApi}
              </p>
            )}

            {/* Campo: Correo electrónico */}
            <div className="flex flex-col gap-2">
              <label
                htmlFor="email"
                className="px-1 font-body text-[14px] font-semibold tracking-[0.14px] text-text-secondary"
              >
                Correo electrónico
              </label>
              <div className="relative">
                <Mail
                  aria-hidden="true"
                  className="pointer-events-none absolute left-4 top-1/2 size-5 -translate-y-1/2 text-text-secondary"
                />
                <input
                  id="email"
                  type="email"
                  autoComplete="email"
                  placeholder="nombre@ejemplo.com"
                  aria-invalid={errors.email ? 'true' : undefined}
                  {...register('email')}
                  className={`${claseInput} pl-12`}
                />
              </div>
              {errors.email && (
                <p className="px-1 font-body text-[13px] text-red-600">{errors.email.message}</p>
              )}
            </div>

            {/* Campo: Contraseña (+ enlace inerte de recuperación) */}
            <div className="flex flex-col gap-2">
              <div className="flex items-center justify-between px-1">
                <label
                  htmlFor="password"
                  className="font-body text-[14px] font-semibold tracking-[0.14px] text-text-secondary"
                >
                  Contraseña
                </label>
                <button
                  type="button"
                  className="font-body text-[12px] font-medium tracking-[0.48px] text-brand-primary transition hover:opacity-80"
                >
                  ¿Olvidaste tu contraseña?
                </button>
              </div>
              <div className="relative">
                <Lock
                  aria-hidden="true"
                  className="pointer-events-none absolute left-4 top-1/2 size-5 -translate-y-1/2 text-text-secondary"
                />
                <input
                  id="password"
                  type={mostrarPassword ? 'text' : 'password'}
                  autoComplete="current-password"
                  aria-invalid={errors.password ? 'true' : undefined}
                  {...register('password')}
                  className={`${claseInput} pl-12 pr-12`}
                />
                <button
                  type="button"
                  onClick={() => setMostrarPassword((v) => !v)}
                  aria-label="Alternar visibilidad de la clave"
                  className="absolute right-3 top-1/2 flex size-8 -translate-y-1/2 items-center justify-center rounded-full text-text-secondary transition hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-primary"
                >
                  {mostrarPassword ? (
                    <EyeOff aria-hidden="true" className="size-5" />
                  ) : (
                    <Eye aria-hidden="true" className="size-5" />
                  )}
                </button>
              </div>
              {errors.password && (
                <p className="px-1 font-body text-[13px] text-red-600">{errors.password.message}</p>
              )}
            </div>

            {/* Recordarme (placeholder visual inerte, sin lógica en US-001) */}
            <label className="flex items-center gap-2 px-1">
              <input
                type="checkbox"
                className="size-5 rounded-[4px] border border-border-default bg-accent-active accent-[#d98b74]"
              />
              <span className="font-body text-[14px] font-semibold text-text-secondary">
                Recordarme en este dispositivo
              </span>
            </label>

            {/* Botón de envío REAL del formulario. */}
            <button
              type="submit"
              disabled={mutation.isPending}
              className="flex h-[56px] w-full items-center justify-center gap-2 rounded-full bg-state-confirmada font-body text-[14px] font-bold tracking-[0.35px] text-[#5b2615] shadow-[0px_12px_24px_-4px_rgba(125,110,100,0.08)] transition hover:opacity-95 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {mutation.isPending ? (
                'Entrando…'
              ) : (
                <>
                  Entrar a Slotify
                  <ArrowRight aria-hidden="true" className="size-3.5" />
                </>
              )}
            </button>
          </form>

          {/* Divider + proveedores sociales (inertes, fuera de alcance US-001). */}
          <div className="flex flex-col gap-6 pt-10">
            <div className="flex items-center gap-3">
              <span className="h-px flex-1 bg-border-default" />
              <span className="font-body text-[12px] font-medium tracking-[0.48px] text-[rgba(83,67,63,0.4)]">
                O continuar con
              </span>
              <span className="h-px flex-1 bg-border-default" />
            </div>
            <div className="flex gap-4">
              <button
                type="button"
                aria-label="Continuar con Google"
                className="flex h-[48px] flex-1 items-center justify-center rounded-full border border-border-default transition hover:bg-surface-muted"
              >
                <img src={googleIcon} alt="" aria-hidden="true" className="size-5" />
              </button>
              <button
                type="button"
                aria-label="Continuar con Apple"
                className="flex h-[48px] flex-1 items-center justify-center rounded-full border border-border-default transition hover:bg-surface-muted"
              >
                <img src={appleIcon} alt="" aria-hidden="true" className="size-5" />
              </button>
            </div>
          </div>

          {/* Pie: alta de cuenta (inerte) + estado de sistemas (decorativo). */}
          <div className="flex flex-col items-center gap-6 pt-8">
            <p className="text-center font-body text-[16px] text-[rgba(83,67,63,0.8)]">
              ¿No tienes una cuenta?{' '}
              <button
                type="button"
                className="font-body text-[14px] font-bold text-brand-primary transition hover:opacity-80"
              >
                Crea una ahora
              </button>
            </p>
            <p className="flex items-center gap-1.5 font-body text-[12px] font-medium tracking-[0.48px] text-[rgba(83,67,63,0.3)]">
              <span aria-hidden="true" className="size-1.5 rounded-full bg-[#4ade80]" />
              Sistemas operativos
            </p>
          </div>
        </div>
      </div>
    </main>
  );
};
