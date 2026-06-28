/**
 * Caso de uso `obtener-usuario-actual` (`GET /auth/me`, US-001 / UC-01) —
 * APLICACIÓN PURA.
 *
 * Pasa del STUB de US-000A (que devolvía el payload del JWT) a resolver el USUARIO
 * REAL del repositorio por su id (`sub` del token) y devolver sus datos públicos
 * `{idUsuario, email, nombre, apellidos?, rol}`. Nunca expone el hash.
 */
import {
  aUsuarioPublico,
  type UsuarioPublico,
  type UsuarioRepositoryPort,
} from './login.use-case';

/** El usuario autenticado no existe (o ya no es accesible) al resolver `/auth/me`. */
export class UsuarioNoEncontradoError extends Error {
  readonly codigo = 'USUARIO_NO_ENCONTRADO' as const;

  constructor() {
    super('Usuario no encontrado');
    this.name = 'UsuarioNoEncontradoError';
  }
}

/** Comando: identidad del usuario autenticado, derivada del access token. */
export interface ObtenerUsuarioActualComando {
  idUsuario: string;
  tenantId: string;
}

/** Dependencias: el repositorio de usuarios (lectura por id). */
export interface ObtenerUsuarioActualDeps {
  usuarios: UsuarioRepositoryPort;
}

export class ObtenerUsuarioActualUseCase {
  constructor(private readonly deps: ObtenerUsuarioActualDeps) {}

  async ejecutar(comando: ObtenerUsuarioActualComando): Promise<UsuarioPublico> {
    const usuario = await this.deps.usuarios.buscarPorId?.(comando.idUsuario, comando.tenantId);
    if (!usuario) {
      throw new UsuarioNoEncontradoError();
    }
    return aUsuarioPublico(usuario);
  }
}
