/* eslint-disable react-refresh/only-export-components */
import { createContext, useContext, useMemo, type ReactNode } from 'react';

/**
 * Abstracción de sesión (US-000A).
 *
 * US-000A entrega ÚNICAMENTE el contrato (provider + hook). La sesión REAL la
 * poblará US-001 (login). Regla dura: el access token vive en memoria (estado de
 * React), NUNCA en localStorage/sessionStorage. Aquí no se persiste nada.
 */
export type SessionUser = {
  nombre: string;
  plan?: string;
};

export type Session =
  | { status: 'authenticated'; user: SessionUser }
  | { status: 'unauthenticated'; user?: undefined };

const SessionContext = createContext<Session>({ status: 'unauthenticated' });

/**
 * Normaliza un valor arbitrario a una `Session`. El provider acepta `unknown`
 * para no acoplarse a una implementación concreta de auth (la inyecta el caller,
 * hoy los tests; mañana US-001). Cualquier valor que no represente una sesión
 * autenticada válida se trata, de forma defensiva, como anónima.
 */
const normalizarSesion = (value: unknown): Session => {
  if (
    typeof value === 'object' &&
    value !== null &&
    (value as { status?: unknown }).status === 'authenticated' &&
    Boolean((value as { user?: unknown }).user)
  ) {
    return value as Session;
  }
  return { status: 'unauthenticated' };
};

export const SessionProvider = ({
  value,
  children,
}: {
  value: unknown;
  children: ReactNode;
}) => {
  const session = useMemo(() => normalizarSesion(value), [value]);
  return <SessionContext.Provider value={session}>{children}</SessionContext.Provider>;
};

export const useSession = (): Session => useContext(SessionContext);
