/**
 * Caso de uso `refresh` (US-001 / UC-01) — APLICACIÓN PURA.
 *
 * Estrategia STATELESS SIN ROTACIÓN (decisión §2-A): un refresh token válido
 * renueva el access token reconstruyendo el payload firmado desde el propio
 * refresh; un refresh inválido/expirado lanza `RefreshInvalidoError`, que el
 * controlador traduce a 401 + limpieza de la cookie. No hay estado en BD ni
 * rotación.
 *
 * Re-valida que el usuario siga existiendo y `activo` antes de reemitir, para que
 * una cuenta deshabilitada no pueda renovar sesión.
 */
import {
  aUsuarioPublico,
  type AccessTokenPayload,
  type TokenEmitterPort,
  type UsuarioRepositoryPort,
  type UsuarioPublico,
} from './login.use-case';

/** Refresh token inválido o expirado: la sesión debe cerrarse (401 + limpiar cookie). */
export class RefreshInvalidoError extends Error {
  readonly codigo = 'REFRESH_INVALIDO' as const;

  constructor() {
    super('Sesión expirada o inválida');
    this.name = 'RefreshInvalidoError';
  }
}

/** Comando: el refresh token leído de la cookie `refresh_token`. */
export interface RefreshComando {
  refreshToken: string;
}

/** Resultado: nuevo access token y datos públicos del usuario. */
export interface RefreshResultado {
  accessToken: string;
  usuario: UsuarioPublico;
}

/** Dependencias: emisor de tokens y repositorio (re-validación de la cuenta). */
export interface RefreshDeps {
  tokenEmitter: TokenEmitterPort;
  usuarios: UsuarioRepositoryPort;
}

export class RefreshUseCase {
  constructor(private readonly deps: RefreshDeps) {}

  async ejecutar(comando: RefreshComando): Promise<RefreshResultado> {
    // 1) Verificar el refresh; cualquier fallo (inválido/expirado) cierra la sesión.
    let payload: AccessTokenPayload;
    try {
      payload = await this.deps.tokenEmitter.verificarRefreshToken(comando.refreshToken);
    } catch {
      throw new RefreshInvalidoError();
    }

    // 2) Re-validar que la cuenta sigue existiendo y activa.
    const usuario = await this.deps.usuarios.buscarPorEmail(payload.email);
    if (usuario === null || !usuario.activo) {
      throw new RefreshInvalidoError();
    }

    // 3) Reemitir el access con el contexto (tenant/rol) del refresh.
    const accessToken = await this.deps.tokenEmitter.emitirAccessToken({
      sub: payload.sub,
      tenantId: payload.tenantId,
      rol: payload.rol,
      email: payload.email,
    });

    return { accessToken, usuario: aUsuarioPublico(usuario) };
  }
}
