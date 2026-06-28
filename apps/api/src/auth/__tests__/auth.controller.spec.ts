/**
 * TESTS DE INTEGRACIÓN DEL CONTROLADOR de auth (US-001) — fase TDD RED.
 *
 * Trazabilidad: US-001, spec-delta `auth` (login emite cookie de refresh; refresh
 * inválido limpia cookie; logout 204 + cookie limpiada; `/auth/me` real). tasks.md
 * Fase 3 (frontera HTTP de 3.1/3.4/3.5). REQ 5, 6, 7 (capa de framework/cookie).
 *
 * Se prueba el controlador en AISLAMIENTO (sin levantar Nest ni BD): se instancia
 * con DOBLES de los use-cases y un `Response` express simulado (spies de
 * `cookie`/`clearCookie`/`status`), de modo que el ROJO sea por SÍMBOLOS DE
 * PRODUCCIÓN AUSENTES (los métodos `login`/`refresh`/`logout`/`me` y el wiring de
 * la cookie de refresh todavía no existen en `AuthController`), no por config.
 *
 * El `AuthController` actual (scaffolding US-000A) solo expone `yo()` (stub de
 * `/auth/me`). Estos tests fuerzan su evolución a la versión real de US-001.
 */
import { AuthController } from '../interface/auth.controller';

const TENANT_ID = '00000000-0000-0000-0000-000000000001';
const USUARIO_ID = '00000000-0000-0000-0000-0000000000a1';
const EMAIL = 'info@masialencis.com';
const COOKIE_REFRESH = 'refresh_token';

// Doble de `express.Response` con passthrough: capta cookie/clearCookie/status.
const crearResFake = () => {
  const res: Record<string, jest.Mock> = {};
  res.cookie = jest.fn(() => res);
  res.clearCookie = jest.fn(() => res);
  res.status = jest.fn(() => res);
  res.json = jest.fn(() => res);
  res.send = jest.fn(() => res);
  return res;
};

const usuarioPublico = {
  idUsuario: USUARIO_ID,
  email: EMAIL,
  nombre: 'Roger',
  apellidos: 'Vilà',
  rol: 'gestor',
};

const crearUseCases = (over?: { refreshRechaza?: boolean }) => {
  const loginUseCase = {
    ejecutar: jest.fn(async () => ({
      accessToken: 'access.jwt',
      refreshToken: 'refresh.jwt',
      usuario: usuarioPublico,
    })),
  };
  const refreshUseCase = {
    ejecutar: jest.fn(async () => {
      if (over?.refreshRechaza) {
        const e = new Error('refresh inválido');
        e.name = 'RefreshInvalidoError';
        throw e;
      }
      return { accessToken: 'access.renovado', usuario: usuarioPublico };
    }),
  };
  const logoutUseCase = { ejecutar: jest.fn(async () => undefined) };
  const obtenerUsuarioActualUseCase = { ejecutar: jest.fn(async () => usuarioPublico) };
  return { loginUseCase, refreshUseCase, logoutUseCase, obtenerUsuarioActualUseCase };
};

// El ctor real de US-001 inyectará los 4 use-cases. Se construye de forma laxa
// para que el ROJO sea por métodos/colaboradores ausentes en runtime.
const crearController = (uc: ReturnType<typeof crearUseCases>) => {
  const Ctor = AuthController as unknown as new (...args: unknown[]) => Record<string, any>;
  return new Ctor(
    uc.loginUseCase,
    uc.refreshUseCase,
    uc.logoutUseCase,
    uc.obtenerUsuarioActualUseCase,
  );
};

describe('AuthController POST /auth/login — cookie de refresh (REQ 1/5)', () => {
  it('debe_devolver_el_access_token_y_los_datos_del_usuario_en_el_body', async () => {
    const uc = crearUseCases();
    const controller = crearController(uc);
    const res = crearResFake();

    const body = await controller.login({ email: EMAIL, password: 'Slotify2026!' }, res);

    expect(body).toEqual(
      expect.objectContaining({ accessToken: 'access.jwt', usuario: usuarioPublico }),
    );
  });

  it('debe_establecer_el_refresh_token_en_una_cookie_httpOnly', async () => {
    const uc = crearUseCases();
    const controller = crearController(uc);
    const res = crearResFake();

    await controller.login({ email: EMAIL, password: 'Slotify2026!' }, res);

    expect(res.cookie).toHaveBeenCalledWith(
      COOKIE_REFRESH,
      'refresh.jwt',
      expect.objectContaining({ httpOnly: true }),
    );
  });
});

describe('AuthController POST /auth/refresh (REQ 5)', () => {
  it('debe_renovar_el_access_token_cuando_el_refresh_de_la_cookie_es_valido', async () => {
    const uc = crearUseCases();
    const controller = crearController(uc);
    const res = crearResFake();
    const req = { cookies: { [COOKIE_REFRESH]: 'refresh.valido' } };

    const body = await controller.refresh(req, res);

    expect(body).toEqual(expect.objectContaining({ accessToken: 'access.renovado' }));
  });

  it('debe_limpiar_la_cookie_de_refresh_cuando_el_refresh_es_invalido_o_expirado', async () => {
    const uc = crearUseCases({ refreshRechaza: true });
    const controller = crearController(uc);
    const res = crearResFake();
    const req = { cookies: { [COOKIE_REFRESH]: 'refresh.caducado' } };

    await expect(controller.refresh(req, res)).rejects.toBeDefined();
    expect(res.clearCookie).toHaveBeenCalledWith(COOKIE_REFRESH, expect.anything());
  });
});

describe('AuthController POST /auth/logout (REQ 6)', () => {
  it('debe_limpiar_la_cookie_de_refresh_al_cerrar_sesion', async () => {
    const uc = crearUseCases();
    const controller = crearController(uc);
    const res = crearResFake();
    const req = { cookies: { [COOKIE_REFRESH]: 'refresh.valido' }, user: { sub: USUARIO_ID, tenantId: TENANT_ID } };

    await controller.logout(req, res);

    expect(res.clearCookie).toHaveBeenCalledWith(COOKIE_REFRESH, expect.anything());
  });
});

describe('AuthController GET /auth/me (REQ 7)', () => {
  it('debe_resolver_el_usuario_real_a_partir_del_payload_del_token', async () => {
    const uc = crearUseCases();
    const controller = crearController(uc);

    const out = await controller.me({ sub: USUARIO_ID, tenantId: TENANT_ID, rol: 'gestor', email: EMAIL });

    expect(uc.obtenerUsuarioActualUseCase.ejecutar).toHaveBeenCalledWith(
      expect.objectContaining({ idUsuario: USUARIO_ID, tenantId: TENANT_ID }),
    );
    expect(out).toEqual(expect.objectContaining({ idUsuario: USUARIO_ID, email: EMAIL }));
  });
});
