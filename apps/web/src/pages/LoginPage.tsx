import { useState, type FormEvent } from 'react';

/**
 * Pagina de login (scaffolding).
 *
 * REGLA 3 (US-000): el access token NUNCA se persiste en localStorage ni
 * sessionStorage. Vivira en memoria, en el estado de React (p. ej. un
 * AuthContext con useState), y el refresh token en una cookie httpOnly que el
 * navegador gestiona de forma transparente. Aqui no se toca window.localStorage.
 *
 * La llamada real de autenticacion se implementara en una US posterior usando
 * TanStack Query (useMutation) sobre el cliente API generado en `src/api-client/`.
 * Por ahora el handler es un stub.
 */
export const LoginPage = () => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    // STUB: la mutacion de login se conecta en Fase 6 / US de auth.
    // El access token resultante se guardara en estado React (memoria), no en
    // localStorage/sessionStorage (Regla 3).
    console.info('login submit (stub)', { email });
  };

  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-50 p-4">
      <form
        onSubmit={handleSubmit}
        className="w-full max-w-sm space-y-6 rounded-xl border border-slate-200 bg-white p-8 shadow-sm"
      >
        <header className="space-y-1">
          <h1 className="text-2xl font-semibold text-slate-900">Slotify</h1>
          <p className="text-sm text-slate-500">Inicia sesion para continuar</p>
        </header>

        <div className="space-y-2">
          <label htmlFor="email" className="block text-sm font-medium text-slate-700">
            Email
          </label>
          <input
            id="email"
            name="email"
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-900 focus:ring-1 focus:ring-slate-900"
          />
        </div>

        <div className="space-y-2">
          <label htmlFor="password" className="block text-sm font-medium text-slate-700">
            Contrasena
          </label>
          <input
            id="password"
            name="password"
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-900 focus:ring-1 focus:ring-slate-900"
          />
        </div>

        <button
          type="submit"
          className="w-full rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-slate-700"
        >
          Entrar
        </button>
      </form>
    </main>
  );
};
