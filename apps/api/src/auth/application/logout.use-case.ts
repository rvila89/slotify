/**
 * Caso de uso `logout` (US-002 / UC-02) — APLICACIÓN PURA.
 *
 * Endurece el `logout` best-effort de US-001. Con refresh STATELESS (§2-A), la
 * invalidación real sigue siendo "best-effort": el caso de uso IDENTIFICA al
 * usuario VERIFICANDO el refresh token de la cookie (no el access token, de modo
 * que el logout funcione aunque el access ya haya expirado) y, SOLO si hay usuario
 * identificable, registra el evento `logout` en `AUDIT_LOG`.
 *
 * Es IDEMPOTENTE (§2): un refresh ausente, expirado o inválido NO lanza error y
 * NO audita (doble logout silencioso). La limpieza de la cookie de refresh y el
 * 200/204 son responsabilidad del controlador (capa de framework).
 *
 * No importa `@nestjs/*`, Prisma ni infraestructura: orquesta contra los puertos
 * inyectados (`TokenEmitterPort`, `AuditLogPort`).
 */
import type { AuditLogPort, TokenEmitterPort } from './login.use-case';

/**
 * Comando: el refresh token leído de la cookie `refresh_token` (capa de framework).
 * Es OPCIONAL: la ausencia de cookie no es un error (idempotencia §2). El caso de
 * uso NUNCA recibe un identificador de usuario de destino (no-anónimo §4).
 */
export interface LogoutComando {
  refreshToken?: string;
}

/** Dependencias: emisor de tokens (verifica el refresh) y auditoría compartida. */
export interface LogoutDeps {
  tokenEmitter: TokenEmitterPort;
  auditoria: AuditLogPort;
}

export class LogoutUseCase {
  constructor(private readonly deps: LogoutDeps) {}

  async ejecutar(comando: LogoutComando): Promise<void> {
    const { refreshToken } = comando;

    // 1) Sin cookie de refresh → idempotente: no hay usuario que auditar, se
    //    completa sin error (el controlador limpia cualquier cookie presente).
    if (refreshToken === undefined || refreshToken === '') {
      return;
    }

    // 2) Identificar al usuario VERIFICANDO el refresh token. Un refresh inválido o
    //    expirado NO cierra con error (best-effort): se completa sin auditar.
    let payload;
    try {
      payload = await this.deps.tokenEmitter.verificarRefreshToken(refreshToken);
    } catch {
      return;
    }

    // 3) Usuario identificable → auditar `logout` bajo el tenant del refresh (RLS).
    //    Convención reutilizada de `login` (US-001 §3): entidad `'Usuario'`,
    //    entidadId = usuario_id, para trazar el ciclo login→logout por usuario.
    await this.deps.auditoria.registrar({
      tenantId: payload.tenantId,
      usuarioId: payload.sub,
      accion: 'logout',
      entidad: 'Usuario',
      entidadId: payload.sub,
    });
  }
}
