/**
 * TESTS DE DOMINIO del caso de uso `logout` (US-001 / UC-01) — fase TDD RED.
 *
 * Trazabilidad: US-001, spec-delta `auth` (Requirement "Logout limpia la sesión
 * de refresh"). tasks.md Fase 3 (parte de auditoría 3.6). REQ 6.
 *
 * Con refresh STATELESS (§2-A), la invalidación real es "best-effort": el dominio
 * registra el evento `logout` en AUDIT_LOG; la limpieza de la cookie y el 204 son
 * responsabilidad del controlador (capa de framework). Aquí se verifica el efecto
 * de dominio (auditoría `logout`).
 *
 * Dominio puro contra doble del puerto. RED: aún no existe
 * `auth/application/logout.use-case.ts` → ROJO por símbolo de producción ausente.
 */
import { LogoutUseCase, type LogoutDeps } from '../application/logout.use-case';
import type { AuditLogPort } from '../application/login.use-case';

const TENANT_ID = '00000000-0000-0000-0000-000000000001';
const USUARIO_ID = '00000000-0000-0000-0000-0000000000a1';

type AuditFake = AuditLogPort & { registrar: jest.Mock };

const crearAuditFake = (): AuditFake => ({ registrar: jest.fn(async () => undefined) });

const montar = () => {
  const auditoria = crearAuditFake();
  const deps: LogoutDeps = { auditoria };
  return { useCase: new LogoutUseCase(deps), auditoria };
};

describe('LogoutUseCase — registra el cierre de sesión (REQ 6)', () => {
  it('debe_registrar_logout_en_AUDIT_LOG_con_el_tenant_del_usuario', async () => {
    const { useCase, auditoria } = montar();

    await useCase.ejecutar({ tenantId: TENANT_ID, idUsuario: USUARIO_ID });

    expect(auditoria.registrar).toHaveBeenCalledTimes(1);
    expect(auditoria.registrar).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: TENANT_ID, accion: 'logout' }),
    );
  });
});
