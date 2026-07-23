import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useMutation } from '@tanstack/react-query';
import { useLocation, useNavigate } from 'react-router-dom';
import { ArrowRight, Eye, EyeOff, Info, Lock, Mail } from 'lucide-react';
import { apiClient } from '@/api-client';
import { useSessionActions } from '@/features/auth';
import heroDesktop from '@/assets/login/hero-desktop.webp';
import heroMobile from '@/assets/login/hero-mobile.webp';

/**
 * Página de login (US-001) — Login v2.
 *
 * Diseño: archivo Figma "Slotify" (`rBCYMkAoQQRVnWhOxXatio`), frame `0:3` (login
 * desktop v2) y `23:8` (login mobile v2). Tema oscuro navy (#1f2129) en ambos
 * viewports. Desktop: dos columnas (3fr/2fr) con hero a la izquierda y formulario
 * a la derecha. Mobile: hero en franja superior (252px) + formulario oscuro abajo.
 * Tokens de `apps/web/src/index.css` donde aplican; valores hex directos para
 * colores del tema oscuro que no tienen token semántico.
 *
 * COMPORTAMIENTO (intacto respecto a v1):
 * Validación por campo con React Hook Form + Zod ANTES de tocar la API (REQ 9).
 * Submit dispara mutación TanStack Query contra `apiClient.POST('/auth/login')`.
 * En éxito puebla sesión EN MEMORIA (`iniciarSesion`, sin storage — REQ 10) y
 * navega al calendario respetando `state.from`. Errores de la API mapeados a copy
 * en español: 401 → genérico (REQ 3 / FA-01); 429 → aviso rate-limit (REQ 8).
 *
 * Elementos inertes (sin lógica en US-001): "¿Olvidaste tu contraseña?", checkbox
 * "Recordarme", pill "Contactar"/"CONTACTO".
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
  'w-full rounded-[12px] bg-[#f7f4f1] border border-white h-[52px] lg:h-[56px] pr-4 font-body text-[16px] text-text-primary placeholder:text-[#9ca3af] outline-none transition focus-visible:ring-2 focus-visible:ring-[#d98b74] aria-[invalid=true]:ring-2 aria-[invalid=true]:ring-red-400';

export const LoginPage = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { iniciarSesion } = useSessionActions();
  const [errorApi, setErrorApi] = useState<string | null>(null);
  const [mostrarPassword, setMostrarPassword] = useState(false);

  const destino =
    (location.state as { from?: { pathname?: string } } | null)?.from?.pathname ?? '/dashboard';

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
    <main className="min-h-screen w-full bg-[#1f2129] font-body text-white lg:grid lg:grid-cols-[3fr_2fr]">
      {/*
        Columna IZQUIERDA (desktop) / Franja SUPERIOR (mobile) — Hero visual.
        Desktop lg: ocupa 3fr (≈58%) a pantalla completa, imagen + tarjeta blanca centrada.
        Mobile: franja de 252px, imagen + mini-card bottom-left.
      */}
      <aside className="relative flex h-[252px] overflow-hidden lg:h-auto">
        <img
          src={heroDesktop}
          alt=""
          aria-hidden="true"
          className="absolute inset-0 h-full w-full object-cover lg:block"
        />
        <img
          src={heroMobile}
          alt=""
          aria-hidden="true"
          className="absolute inset-0 h-full w-full object-cover lg:hidden"
        />

        {/* Mini-card mobile — bottom-left, solo < lg */}
        <div className="absolute bottom-[20px] left-[20px] z-10 flex flex-col gap-[8px] rounded-[16px] border border-white/20 bg-[rgba(255,255,255,0.9)] p-[16px] backdrop-blur-[6px] lg:hidden">
          <p className="font-display text-[12px] font-semibold text-[#1f2129]">
            Organiza y gestiona con control
          </p>
          <button
            type="button"
            className="self-start rounded-[14px] bg-[#d17859] px-[12px] py-[6px] font-display text-[10px] font-semibold text-white"
          >
            Contactar
          </button>
        </div>

        {/* Brand hero card desktop — centrada, solo >= lg */}
        <div className="relative z-10 m-auto hidden w-[520px] flex-col gap-[20px] rounded-[24px] border border-white/20 bg-[rgba(255,255,255,0.9)] p-[40px] shadow-[0px_18px_48px_0px_rgba(0,0,0,0.4)] backdrop-blur-[12px] lg:flex">
          <div className="flex items-center gap-[10px]">
            <img src="/slotify-icon.svg" alt="" aria-hidden="true" className="size-7" />
            <span className="font-display text-[22px] font-semibold uppercase tracking-[3.08px] text-[#1a1a1a]">
              Slotify
            </span>
          </div>
          <h2 className="font-display text-[44px] font-extrabold leading-[1.1] tracking-[-0.6px] text-[#1c1c19]">
            Organiza y gestiona
            <br />
            con control
          </h2>
          <p className="font-body text-[16px] leading-[26px] tracking-[0.2px] text-[#53433f]">
            La plataforma de gestión integral para espacios boutique de eventos privados
          </p>
          <div>
            <a
              href="https://mail.google.com/mail/?view=cm&to=info@masialencis.com"
              target="_blank"
              rel="noopener noreferrer"
              className="rounded-full bg-[#d98b74] px-[14px] py-[10px] font-body text-[12px] font-extrabold tracking-[0.6px] text-white"
            >
              CONTACTO
            </a>
          </div>
          <div className="h-px w-full bg-white/20" />
        </div>
      </aside>

      {/* Columna DERECHA (desktop) / Sección INFERIOR (mobile) — Formulario */}
      <div className="flex items-center justify-center p-[32px] lg:p-[48px]">
        <div className="flex w-full max-w-[440px] flex-col gap-[32px]">
          {/* Aviso de cierre degradado (US-002) */}
          {avisoLogout && (
            <div
              role="status"
              aria-live="polite"
              className="flex items-start gap-2 rounded-[12px] border border-white/20 bg-white/10 px-4 py-3 font-body text-[14px] leading-[20px] text-[#f9f6f3]"
            >
              <Info aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-[#d98b74]" />
              <span>{avisoLogout}</span>
            </div>
          )}

          {/* Brand anchor: icono + wordmark + heading + subtítulo */}
          <div className="flex flex-col gap-[12px]">
            <div className="flex items-center gap-[8px]">
              <img src="/slotify-icon.svg" alt="" aria-hidden="true" className="size-9" />
              <span className="font-display text-[24px] font-semibold uppercase tracking-[3.36px] text-white">
                SLOTIFY
              </span>
            </div>
            <div className="flex flex-col gap-[8px]">
              <h1 className="font-display text-[28px] font-bold leading-[1.2] tracking-[-0.75px] text-[#f9fafb] lg:text-[30px]">
                Bienvenido de nuevo
              </h1>
              <p className="font-body text-[15px] leading-[1.5] text-[#ebecee] lg:text-[16px]">
                Introduce tus credenciales para acceder a tu panel.
              </p>
            </div>
          </div>

          {/* Formulario */}
          <form onSubmit={onSubmit} noValidate className="flex w-full flex-col gap-[24px] lg:gap-[28px]">
            {errorApi && (
              <p
                role="alert"
                className="rounded-[12px] border border-red-400/30 bg-red-500/10 px-4 py-3 font-body text-[14px] text-red-300"
              >
                {errorApi}
              </p>
            )}

            {/* Campo: Correo electrónico */}
            <div className="flex flex-col gap-[8px]">
              <label
                htmlFor="email"
                className="font-body text-[14px] font-semibold tracking-[0.14px] text-[#f9fafb]"
              >
                Correo electrónico
              </label>
              <div className="relative">
                <Mail
                  aria-hidden="true"
                  className="pointer-events-none absolute left-4 top-1/2 size-5 -translate-y-1/2 text-[#9ca3af]"
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
                <p className="font-body text-[13px] text-red-400">{errors.email.message}</p>
              )}
            </div>

            {/* Campo: Contraseña */}
            <div className="flex flex-col gap-[8px]">
              <div className="flex items-center justify-between">
                <label
                  htmlFor="password"
                  className="font-body text-[14px] font-semibold tracking-[0.14px] text-[#f9fafb]"
                >
                  Contraseña
                </label>
                <button
                  type="button"
                  className="font-body text-[12px] font-medium tracking-[0.48px] text-[#d98b74] transition hover:opacity-80"
                >
                  ¿Olvidaste tu contraseña?
                </button>
              </div>
              <div className="relative">
                <Lock
                  aria-hidden="true"
                  className="pointer-events-none absolute left-4 top-1/2 size-5 -translate-y-1/2 text-[#9ca3af]"
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
                  className="absolute right-3 top-1/2 flex size-8 -translate-y-1/2 items-center justify-center rounded-full text-[#9ca3af] transition hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#d98b74]"
                >
                  {mostrarPassword ? (
                    <EyeOff aria-hidden="true" className="size-5" />
                  ) : (
                    <Eye aria-hidden="true" className="size-5" />
                  )}
                </button>
              </div>
              {errors.password && (
                <p className="font-body text-[13px] text-red-400">{errors.password.message}</p>
              )}
            </div>

            {/* Recordarme (placeholder visual inerte) */}
            <label className="flex items-center gap-[12px]">
              <input
                type="checkbox"
                className="size-5 rounded-[6px] border border-white bg-[#1f2129] accent-[#d98b74]"
              />
              <span className="font-body text-[14px] font-semibold text-[#f9fafb]">
                Recordarme en este dispositivo
              </span>
            </label>

            {/* Botón de envío */}
            <button
              type="submit"
              disabled={mutation.isPending}
              className="flex h-[56px] w-full items-center justify-center gap-[8px] rounded-full bg-[#d98b74] font-body text-[14px] font-bold tracking-[0.35px] text-[#5b2615] shadow-[0px_12px_12px_rgba(0,0,0,0.25)] transition hover:opacity-95 disabled:cursor-not-allowed disabled:opacity-60"
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
        </div>
      </div>
    </main>
  );
};
