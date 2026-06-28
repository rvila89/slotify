/**
 * Caso de uso `logout` (US-001 / UC-01) — APLICACIÓN PURA.
 *
 * Con refresh STATELESS (§2-A), la invalidación real es "best-effort": el dominio
 * solo registra el evento `logout` en `AUDIT_LOG`. La limpieza de la cookie de
 * refresh y el 204 son responsabilidad del controlador (capa de framework).
 */
import type { AuditLogPort } from './login.use-case';

/** Comando: contexto del usuario autenticado (del access token). */
export interface LogoutComando {
  tenantId: string;
  idUsuario: string;
}

/** Dependencias: solo el puerto de auditoría compartido. */
export interface LogoutDeps {
  auditoria: AuditLogPort;
}

export class LogoutUseCase {
  constructor(private readonly deps: LogoutDeps) {}

  async ejecutar(comando: LogoutComando): Promise<void> {
    await this.deps.auditoria.registrar({
      tenantId: comando.tenantId,
      usuarioId: comando.idUsuario,
      accion: 'logout',
      entidad: 'Usuario',
      entidadId: comando.idUsuario,
    });
  }
}
