import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useMutation } from '@tanstack/react-query';
import { useLocation, useNavigate } from 'react-router-dom';
import { apiClient } from '@/api-client';
import { useSessionActions } from '@/auth/session';

/**
 * Página de login (US-001).
 *
 * Validación por campo con React Hook Form + Zod ANTES de tocar la API (REQ 9).
 * El submit dispara una mutación TanStack Query contra el SDK generado
 * (`apiClient.POST('/auth/login')`). En éxito puebla la sesión EN MEMORIA
 * (`iniciarSesion`, sin storage — REQ 10) y navega al calendario respetando
 * `state.from` (deep-link preservado por `RequireAuth`).
 *
 * Errores de la API mapeados a copy en español: 401 → mensaje genérico
 * anti-enumeration (REQ 3 / FA-01); 429 → aviso de demasiados intentos (REQ 8).
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

export const LoginPage = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { iniciarSesion } = useSessionActions();
  const [errorApi, setErrorApi] = useState<string | null>(null);

  const destino =
    (location.state as { from?: { pathname?: string } } | null)?.from?.pathname ?? '/calendario';

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
    <main className="flex min-h-screen items-center justify-center bg-slate-50 p-4">
      <form
        onSubmit={onSubmit}
        noValidate
        className="w-full max-w-sm space-y-6 rounded-xl border border-slate-200 bg-white p-8 shadow-sm"
      >
        <header className="space-y-1">
          <h1 className="text-2xl font-semibold text-slate-900">Slotify</h1>
          <p className="text-sm text-slate-500">Inicia sesion para continuar</p>
        </header>

        {errorApi && (
          <p
            role="alert"
            className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700"
          >
            {errorApi}
          </p>
        )}

        <div className="space-y-2">
          <label htmlFor="email" className="block text-sm font-medium text-slate-700">
            Email
          </label>
          <input
            id="email"
            type="email"
            autoComplete="email"
            aria-invalid={errors.email ? 'true' : undefined}
            {...register('email')}
            className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-900 focus:ring-1 focus:ring-slate-900"
          />
          {errors.email && <p className="text-sm text-red-600">{errors.email.message}</p>}
        </div>

        <div className="space-y-2">
          <label htmlFor="password" className="block text-sm font-medium text-slate-700">
            Contrasena
          </label>
          <input
            id="password"
            type="password"
            autoComplete="current-password"
            aria-invalid={errors.password ? 'true' : undefined}
            {...register('password')}
            className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-900 focus:ring-1 focus:ring-slate-900"
          />
          {errors.password && <p className="text-sm text-red-600">{errors.password.message}</p>}
        </div>

        <button
          type="submit"
          disabled={mutation.isPending}
          className="w-full rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {mutation.isPending ? 'Entrando…' : 'Entrar'}
        </button>
      </form>
    </main>
  );
};
