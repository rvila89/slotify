/**
 * Configuración de rate-limiting de `POST /auth/login` (US-001, decisión §3-A).
 *
 * Defensa anti brute-force por IP + email: un límite finito de intentos dentro de
 * una ventana temporal; superado, el guard responde 429 (TooManyRequests). El
 * conteo es en memoria del proceso (sin almacenamiento externo).
 *
 * Aquí vive el CONTRATO de configuración (límite + ventana + generador de clave);
 * el `LoginThrottleGuard` (interface/) lo aplica. El 429 efectivo se verifica
 * end-to-end en QA.
 */

/** Límite de intentos y ventana (ms). 5 intentos por minuto y clave (IP+email). */
export const LOGIN_THROTTLE = {
  /** Máximo de intentos permitidos dentro de la ventana. */
  limit: 5,
  /** Ventana de tiempo en milisegundos. */
  ttl: 60_000,
} as const;

/**
 * Clave de throttling que combina IP y email (normalizado): distingue intentos por
 * cuenta dentro de la misma IP, de modo que un atacante no agote a un tercero ni se
 * salte el límite cambiando solo de email.
 */
export const claveThrottleLogin = (ip: string, email: string): string =>
  `login:${ip}:${email.trim().toLowerCase()}`;
