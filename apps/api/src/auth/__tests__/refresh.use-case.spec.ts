/**
 * TESTS DE DOMINIO del caso de uso `refresh` (US-001 / UC-01) — fase TDD RED.
 *
 * Trazabilidad: US-001, spec-delta `auth` (Requirement "Renovación de access
 * token vía refresh"). tasks.md Fase 3: 3.4. REQ 5.
 *
 * Estrategia de refresh STATELESS SIN ROTACIÓN (decisión §2-A): un refresh válido
 * renueva el access desde la cookie; un refresh inválido/expirado → error que el
 * controlador traduce a 401 + limpieza de la cookie. NO se modela rotación ni
 * estado en BD.
 *
 * Dominio puro contra dobles de puertos (hexagonal). RED: aún no existe
 * `auth/application/refresh.use-case.ts` → ROJO por símbolos de producción ausentes.
 */
import {
  RefreshUseCase,
  RefreshInvalidoError,
  type RefreshDeps,
  type RefreshResultado,
} from '../application/refresh.use-case';
import type {
  UsuarioAutenticable,
  UsuarioRepositoryPort,
  TokenEmitterPort,
} from '../application/login.use-case';

const TENANT_ID = '00000000-0000-0000-0000-000000000001';
const USUARIO_ID = '00000000-0000-0000-0000-0000000000a1';
const EMAIL = 'info@masialencis.com';
const ACCESS_NUEVO = 'access.jwt.renovado';
const REFRESH_VALIDO = 'refresh.jwt.valido';

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

type UsuariosFake = UsuarioRepositoryPort & { buscarPorEmail: jest.Mock };
type TokenFake = TokenEmitterPort & {
  emitirAccessToken: jest.Mock;
  emitirRefreshToken: jest.Mock;
  verificarRefreshToken: jest.Mock;
};

const crearTokenFake = (refreshValido = true): TokenFake => ({
  emitirAccessToken: jest.fn(async () => ACCESS_NUEVO),
  emitirRefreshToken: jest.fn(async () => 'refresh.nuevo'),
  verificarRefreshToken: jest.fn(async () => {
    if (!refreshValido) {
      throw new Error('jwt expired');
    }
    return { sub: USUARIO_ID, tenantId: TENANT_ID, rol: 'gestor', email: EMAIL };
  }),
});

const crearUsuariosFake = (): UsuariosFake => ({
  buscarPorEmail: jest.fn(async () => usuario()),
});

const montar = (refreshValido = true) => {
  const tokenEmitter = crearTokenFake(refreshValido);
  const usuarios = crearUsuariosFake();
  const deps: RefreshDeps = { tokenEmitter, usuarios };
  return { useCase: new RefreshUseCase(deps), tokenEmitter, usuarios };
};

describe('RefreshUseCase — refresh válido renueva el access (REQ 5)', () => {
  it('debe_emitir_un_nuevo_access_token_cuando_el_refresh_es_valido', async () => {
    const { useCase } = montar(true);

    const out: RefreshResultado = await useCase.ejecutar({ refreshToken: REFRESH_VALIDO });

    expect(out.accessToken).toBe(ACCESS_NUEVO);
  });

  it('debe_reemitir_el_access_con_el_contexto_de_tenant_y_rol_del_refresh', async () => {
    const { useCase, tokenEmitter } = montar(true);

    await useCase.ejecutar({ refreshToken: REFRESH_VALIDO });

    expect(tokenEmitter.verificarRefreshToken).toHaveBeenCalledWith(REFRESH_VALIDO);
    expect(tokenEmitter.emitirAccessToken).toHaveBeenCalledWith(
      expect.objectContaining({ sub: USUARIO_ID, tenantId: TENANT_ID, rol: 'gestor', email: EMAIL }),
    );
  });
});

describe('RefreshUseCase — refresh inválido/expirado cierra la sesión (REQ 5)', () => {
  it('debe_rechazar_con_RefreshInvalidoError_cuando_el_refresh_es_invalido_o_expirado', async () => {
    const { useCase } = montar(false);

    await expect(useCase.ejecutar({ refreshToken: 'cualquier-cosa' })).rejects.toBeInstanceOf(
      RefreshInvalidoError,
    );
  });

  it('no_debe_emitir_un_nuevo_access_token_cuando_el_refresh_es_invalido', async () => {
    const { useCase, tokenEmitter } = montar(false);

    await useCase.ejecutar({ refreshToken: 'cualquier-cosa' }).catch(() => undefined);

    expect(tokenEmitter.emitirAccessToken).not.toHaveBeenCalled();
  });
});
