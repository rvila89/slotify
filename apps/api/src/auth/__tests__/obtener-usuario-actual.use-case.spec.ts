/**
 * TESTS DE DOMINIO del caso de uso `obtener-usuario-actual` (`GET /auth/me`)
 * (US-001 / UC-01) — fase TDD RED.
 *
 * Trazabilidad: US-001, spec-delta `auth` (Requirement "Endpoint de usuario
 * autenticado"). tasks.md Fase 3: 3.5. REQ 7.
 *
 * `/auth/me` pasa del STUB de US-000A (que devolvía el payload del JWT) a resolver
 * el USUARIO REAL del repositorio y devolver `{idUsuario, email, nombre,
 * apellidos?, rol}`.
 *
 * Dominio puro contra doble del puerto. RED: aún no existe
 * `auth/application/obtener-usuario-actual.use-case.ts` → ROJO por símbolo ausente.
 */
import {
  ObtenerUsuarioActualUseCase,
  UsuarioNoEncontradoError,
  type ObtenerUsuarioActualDeps,
} from '../application/obtener-usuario-actual.use-case';
import type {
  UsuarioAutenticable,
  UsuarioRepositoryPort,
} from '../application/login.use-case';

const TENANT_ID = '00000000-0000-0000-0000-000000000001';
const USUARIO_ID = '00000000-0000-0000-0000-0000000000a1';
const EMAIL = 'info@masialencis.com';

const usuario = (): UsuarioAutenticable => ({
  idUsuario: USUARIO_ID,
  tenantId: TENANT_ID,
  email: EMAIL,
  passwordHash: '$argon2id$x',
  nombre: 'Roger',
  apellidos: 'Vilà',
  rol: 'gestor',
  activo: true,
});

type UsuariosFake = UsuarioRepositoryPort & {
  buscarPorEmail: jest.Mock;
  buscarPorId: jest.Mock;
};

const crearUsuariosFake = (encontrado: UsuarioAutenticable | null = usuario()): UsuariosFake => ({
  buscarPorEmail: jest.fn(async () => encontrado),
  // `/auth/me` resuelve por id (el `sub` del token), no por email.
  buscarPorId: jest.fn(async () => encontrado),
});

const montar = (encontrado: UsuarioAutenticable | null = usuario()) => {
  const usuarios = crearUsuariosFake(encontrado);
  const deps: ObtenerUsuarioActualDeps = { usuarios };
  return { useCase: new ObtenerUsuarioActualUseCase(deps), usuarios };
};

describe('ObtenerUsuarioActualUseCase — /auth/me real (REQ 7)', () => {
  it('debe_devolver_los_datos_publicos_del_usuario_real', async () => {
    const { useCase } = montar();

    const out = await useCase.ejecutar({ idUsuario: USUARIO_ID, tenantId: TENANT_ID });

    expect(out).toEqual(
      expect.objectContaining({
        idUsuario: USUARIO_ID,
        email: EMAIL,
        nombre: 'Roger',
        apellidos: 'Vilà',
        rol: 'gestor',
      }),
    );
  });

  it('no_debe_exponer_el_passwordHash_en_la_respuesta_de_me', async () => {
    const { useCase } = montar();

    const out = await useCase.ejecutar({ idUsuario: USUARIO_ID, tenantId: TENANT_ID });

    expect(JSON.stringify(out)).not.toContain('$argon2id$');
    expect((out as unknown as Record<string, unknown>).passwordHash).toBeUndefined();
  });

  it('debe_rechazar_con_UsuarioNoEncontradoError_cuando_el_usuario_no_existe', async () => {
    const { useCase } = montar(null);

    await expect(
      useCase.ejecutar({ idUsuario: 'inexistente', tenantId: TENANT_ID }),
    ).rejects.toBeInstanceOf(UsuarioNoEncontradoError);
  });
});
