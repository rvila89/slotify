/**
 * Decodificación del payload de un JWT SIN verificar la firma
 * (change gestion-sesion-ux-modal-f5-error-banner).
 *
 * El frontend solo necesita leer datos NO sensibles del payload (identidad para
 * pintar la UI, `exp` para programar el aviso de expiración). La verificación
 * real de la firma la hace el backend en cada request; aquí basta con parsear el
 * segmento central del token (base64url → JSON). Es puro y sin efectos.
 */
export type JwtPayload = {
  idUsuario?: string;
  email?: string;
  nombre?: string;
  apellidos?: string | null;
  rol?: string;
  plan?: string;
  /** Instante de expiración en segundos epoch (estándar JWT). */
  exp?: number;
  [clave: string]: unknown;
};

/**
 * Devuelve el payload del JWT, o `null` si el token está mal formado o no puede
 * decodificarse (nunca lanza: el consumidor decide cómo degradar).
 */
export const decodificarPayloadJwt = (token: string | null): JwtPayload | null => {
  if (!token) return null;
  try {
    const segmento = token.split('.')[1];
    if (!segmento) return null;
    const base64 = segmento.replace(/-/g, '+').replace(/_/g, '/');
    return JSON.parse(atob(base64)) as JwtPayload;
  } catch {
    return null;
  }
};
