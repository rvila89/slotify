/**
 * Caso de uso `login` (US-001 / UC-01) — DOMINIO/APLICACIÓN PURO.
 *
 * Orquesta la autenticación contra PUERTOS inyectados (hexagonal): busca el
 * usuario, verifica la contraseña contra su hash argon2, comprueba la invariante
 * `activo`, emite los tokens y registra el evento `login` en `AUDIT_LOG`. No
 * importa `@nestjs/*`, Prisma ni infraestructura.
 *
 * Este módulo concentra los PUERTOS y tipos de la capability `auth` (repositorio
 * de usuarios, hasher, emisor de tokens) porque los tests de US-001 los consumen
 * desde aquí y el hook `require-tests-first` exige test hermano por fichero; la
 * inversión de dependencias se mantiene (la infraestructura los implementa).
 *
 * Seguridad (FA-01/FA-02, OWASP A01 anti-enumeration): credenciales inválidas
 * (email inexistente O contraseña incorrecta) y cuenta `activo = false` producen
 * EL MISMO `CredencialesInvalidasError` genérico, sin emitir token ni auditar.
 */
import type { AuditLogPort } from '../../shared/audit/audit-log.port';

// Re-export del puerto de auditoría compartido para que los tests de auth lo
// importen desde el caso de uso sin acoplarse a su ubicación física.
export type { AuditLogPort } from '../../shared/audit/audit-log.port';

// ---------------------------------------------------------------------------
// Entidad de dominio (sin contraseña en claro)
// ---------------------------------------------------------------------------

/** Rol del usuario (en el MVP, siempre `gestor`). */
export type Rol = 'gestor' | 'admin' | 'operario';

/** Usuario tal como lo necesita la autenticación: incluye el hash, nunca la clave. */
export interface UsuarioAutenticable {
  idUsuario: string;
  tenantId: string;
  email: string;
  passwordHash: string;
  nombre: string;
  apellidos?: string | null;
  rol: Rol;
  activo: boolean;
}

/** Datos públicos del usuario: lo único que sale al exterior (jamás el hash). */
export interface UsuarioPublico {
  idUsuario: string;
  email: string;
  nombre: string;
  apellidos?: string | null;
  rol: Rol;
}

/** Proyecta un `UsuarioAutenticable` a su forma pública, descartando el hash. */
export const aUsuarioPublico = (usuario: UsuarioAutenticable): UsuarioPublico => ({
  idUsuario: usuario.idUsuario,
  email: usuario.email,
  nombre: usuario.nombre,
  apellidos: usuario.apellidos ?? null,
  rol: usuario.rol,
});

// ---------------------------------------------------------------------------
// Puertos (interfaces) — implementados en infraestructura (adaptadores)
// ---------------------------------------------------------------------------

/** Repositorio de usuarios. La lectura por id solo la usa `/auth/me`. */
export interface UsuarioRepositoryPort {
  buscarPorEmail(email: string): Promise<UsuarioAutenticable | null>;
  buscarPorId?(idUsuario: string, tenantId?: string): Promise<UsuarioAutenticable | null>;
}

/** Verificación de la contraseña contra el hash argon2 (sin acoplar la librería). */
export interface PasswordHasherPort {
  verificar(password: string, hash: string): Promise<boolean>;
}

/**
 * Payload firmado del access token (aislamiento multi-tenant: `tenantId`/`rol`).
 * `rol` se modela como `string` porque así viaja firmado en el JWT y así lo
 * consume la `JwtStrategy` (`shared/auth/jwt.strategy.ts`).
 */
export interface AccessTokenPayload {
  sub: string;
  tenantId: string;
  rol: string;
  email: string;
}

/** Emisión y verificación de tokens (access en body, refresh en cookie). */
export interface TokenEmitterPort {
  emitirAccessToken(payload: AccessTokenPayload): Promise<string>;
  emitirRefreshToken(payload: AccessTokenPayload): Promise<string>;
  verificarRefreshToken(token: string): Promise<AccessTokenPayload>;
}

// ---------------------------------------------------------------------------
// Error de dominio (genérico anti-enumeration: FA-01 y FA-02 indistinguibles)
// ---------------------------------------------------------------------------

/**
 * Credenciales inválidas. Cubre email inexistente, contraseña incorrecta Y cuenta
 * deshabilitada (`activo = false`): TODOS comparten este mismo error con el mismo
 * mensaje genérico para no revelar qué emails existen (OWASP A01). El controlador
 * lo traduce a un 401 uniforme.
 */
export class CredencialesInvalidasError extends Error {
  readonly codigo = 'CREDENCIALES_INVALIDAS' as const;

  constructor() {
    super('Credenciales incorrectas');
    this.name = 'CredencialesInvalidasError';
  }
}

// ---------------------------------------------------------------------------
// Caso de uso
// ---------------------------------------------------------------------------

/** Comando de entrada: las credenciales en claro nunca se persisten ni se loguean. */
export interface LoginComando {
  email: string;
  password: string;
}

/** Resultado: access token (body), refresh token (cookie) y datos públicos. */
export interface LoginResultado {
  accessToken: string;
  refreshToken: string;
  usuario: UsuarioPublico;
}

/** Dependencias del caso de uso: puertos inyectados (hexagonal). */
export interface LoginDeps {
  usuarios: UsuarioRepositoryPort;
  passwordHasher: PasswordHasherPort;
  tokenEmitter: TokenEmitterPort;
  auditoria: AuditLogPort;
}

export class LoginUseCase {
  constructor(private readonly deps: LoginDeps) {}

  async ejecutar(comando: LoginComando): Promise<LoginResultado> {
    const { email, password } = comando;

    // 1) Buscar el usuario. Email inexistente → error genérico (anti-enumeration).
    const usuario = await this.deps.usuarios.buscarPorEmail(email);
    if (usuario === null) {
      throw new CredencialesInvalidasError();
    }

    // 2) Verificar la contraseña contra el hash argon2 (nunca en claro).
    const coincide = await this.deps.passwordHasher.verificar(password, usuario.passwordHash);
    if (!coincide) {
      throw new CredencialesInvalidasError();
    }

    // 3) Cuenta deshabilitada → MISMO error genérico que FA-01 (indistinguible).
    if (!usuario.activo) {
      throw new CredencialesInvalidasError();
    }

    // 4) Emitir tokens con el payload firmado (sub/tenantId/rol/email).
    const payload: AccessTokenPayload = {
      sub: usuario.idUsuario,
      tenantId: usuario.tenantId,
      rol: usuario.rol,
      email: usuario.email,
    };
    const accessToken = await this.deps.tokenEmitter.emitirAccessToken(payload);
    const refreshToken = await this.deps.tokenEmitter.emitirRefreshToken(payload);

    // 5) Auditar el `login` en AUDIT_LOG vía el puerto compartido.
    await this.deps.auditoria.registrar({
      tenantId: usuario.tenantId,
      usuarioId: usuario.idUsuario,
      accion: 'login',
      entidad: 'Usuario',
      entidadId: usuario.idUsuario,
    });

    return { accessToken, refreshToken, usuario: aUsuarioPublico(usuario) };
  }
}
