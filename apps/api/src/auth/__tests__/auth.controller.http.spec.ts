/**
 * TESTS DE INTEGRACIÓN HTTP del controlador de auth (US-001) — fase TDD RED.
 *
 * Trazabilidad: US-001 (Iniciar Sesión). Cubre la FRONTERA HTTP real que los unit
 * tests de `auth.controller.spec.ts` (controller en aislamiento, sin Nest) NO
 * ejercitan: el mapeo excepción de dominio → código HTTP lo hace el filtro global
 * REAL (`HttpExceptionFilter`), por lo que aquí se levanta una app Nest mínima con
 * supertest y el MISMO filtro/pipe/prefijo que `main.ts`. NO se mockea el filtro.
 *
 * BUG que destapa (no se parchea aquí — solo se prueba en rojo):
 *  - `AuthController.login()` no envuelve el caso de uso en try/catch y
 *    `CredencialesInvalidasError` extiende `Error` nativo (no `HttpException`),
 *    así que el filtro global lo convierte en 500 en vez de 401.
 *  - Faltan `@HttpCode(200)` en `login()` y `refresh()`: NestJS responde 201 por
 *    defecto a un POST, pero el contrato exige 200.
 *
 * Los dobles de los use-cases reproducen EXACTAMENTE lo que lanza el dominio real:
 * `CredencialesInvalidasError` (mismo error para credenciales inválidas Y cuenta
 * `activo = false`, anti-enumeration OWASP A01) y `RefreshInvalidoError`.
 */
import { ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AuthController } from '../interface/auth.controller';
import { LoginThrottleGuard } from '../interface/login-throttle.guard';
import { CredencialesInvalidasError } from '../application/login.use-case';
import { RefreshInvalidoError } from '../application/refresh.use-case';
import {
  LOGIN_USE_CASE,
  LOGOUT_USE_CASE,
  OBTENER_USUARIO_ACTUAL_USE_CASE,
  REFRESH_USE_CASE,
} from '../auth.tokens';
import { HttpExceptionFilter } from '../../shared/filters/http-exception.filter';

const EMAIL = 'info@masialencis.com';
const PASSWORD = 'Slotify2026!';
const COOKIE_REFRESH = 'refresh_token';

const usuarioPublico = {
  idUsuario: '00000000-0000-0000-0000-0000000000a1',
  email: EMAIL,
  nombre: 'Roger',
  apellidos: 'Vilà',
  rol: 'gestor',
};

const loginUseCase = { ejecutar: jest.fn() };
const refreshUseCase = { ejecutar: jest.fn() };
const logoutUseCase = { ejecutar: jest.fn() };
const obtenerUsuarioActualUseCase = { ejecutar: jest.fn() };

// Solo los campos estables del envelope de error (sin `path`/`timestamp` volátiles),
// para comparar respuestas de error byte a byte (anti-enumeration).
const envelopeEstable = (body: Record<string, unknown>) => ({
  statusCode: body.statusCode,
  message: body.message,
  error: body.error,
  codigo: body.codigo,
});

let app: INestApplication;

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({
    controllers: [AuthController],
    providers: [
      { provide: LOGIN_USE_CASE, useValue: loginUseCase },
      { provide: REFRESH_USE_CASE, useValue: refreshUseCase },
      { provide: LOGOUT_USE_CASE, useValue: logoutUseCase },
      { provide: OBTENER_USUARIO_ACTUAL_USE_CASE, useValue: obtenerUsuarioActualUseCase },
    ],
  })
    // El rate-limiting no es objeto de estas pruebas: se neutraliza el guard.
    .overrideGuard(LoginThrottleGuard)
    .useValue({ canActivate: () => true })
    .compile();

  app = moduleRef.createNestApplication();
  // Réplica fiel de `main.ts`: prefijo, ValidationPipe y FILTRO GLOBAL REAL.
  app.setGlobalPrefix('api');
  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
  );
  app.useGlobalFilters(new HttpExceptionFilter());
  await app.init();
});

afterAll(async () => {
  await app.close();
});

beforeEach(() => {
  jest.clearAllMocks();
});

describe('POST /api/auth/login — frontera HTTP (US-001)', () => {
  it('debe_responder_200_y_no_201_y_emitir_access_token_en_body_y_cookie_de_refresh_cuando_las_credenciales_son_validas', async () => {
    loginUseCase.ejecutar.mockResolvedValue({
      accessToken: 'access.jwt',
      refreshToken: 'refresh.jwt',
      usuario: usuarioPublico,
    });

    const res = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email: EMAIL, password: PASSWORD });

    expect(res.status).toBe(200);
    expect(res.body).toEqual(
      expect.objectContaining({ accessToken: 'access.jwt', usuario: usuarioPublico }),
    );
    const setCookie = res.headers['set-cookie'] as unknown as string[] | undefined;
    expect(setCookie?.some((c) => c.startsWith(`${COOKIE_REFRESH}=`))).toBe(true);
  });

  it('debe_responder_401_con_envelope_generico_cuando_el_caso_de_uso_lanza_CredencialesInvalidasError', async () => {
    loginUseCase.ejecutar.mockRejectedValue(new CredencialesInvalidasError());

    const res = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email: EMAIL, password: 'incorrecta' });

    expect(res.status).toBe(401);
    expect(res.body).toEqual(
      expect.objectContaining({ statusCode: 401, error: expect.any(String) }),
    );
    // No debe filtrarse traza interna ni mensaje de error 500.
    expect(res.body.statusCode).not.toBe(500);
  });

  it('debe_responder_401_identico_cuando_la_cuenta_esta_inactiva_para_no_revelar_su_existencia_anti_enumeration', async () => {
    // El dominio lanza el MISMO CredencialesInvalidasError para activo=false.
    loginUseCase.ejecutar.mockRejectedValue(new CredencialesInvalidasError());
    const inactiva = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email: 'cuenta.inactiva@masialencis.com', password: PASSWORD });

    loginUseCase.ejecutar.mockRejectedValue(new CredencialesInvalidasError());
    const credInvalidas = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email: EMAIL, password: 'incorrecta' });

    expect(inactiva.status).toBe(401);
    expect(credInvalidas.status).toBe(401);
    // Anti-enumeration: mismo status y mismo cuerpo estable, indistinguibles.
    expect(envelopeEstable(inactiva.body)).toEqual(envelopeEstable(credInvalidas.body));
    // No debe filtrar que la cuenta existe pero está deshabilitada.
    const texto = JSON.stringify(inactiva.body).toLowerCase();
    expect(texto).not.toContain('inactiv');
    expect(texto).not.toContain('deshabilit');
    expect(texto).not.toContain('activo');
  });

  // BUG (hallazgo Menor de code-review): el `catch {}` AMPLIO de `login()`
  // traduce CUALQUIER excepción a 401, enmascarando un fallo de INFRAESTRUCTURA
  // (p. ej. BD caída) como "Credenciales incorrectas". Un error inesperado que NO
  // es de dominio debe propagarse y el filtro global mapearlo a 500, no a 401.
  // Caso ROJO hoy (recibe 401) hasta que el fix estreche el catch a los errores
  // de dominio (`instanceof CredencialesInvalidasError`) y re-lance el resto.
  it('debe_responder_500_y_no_401_cuando_el_caso_de_uso_lanza_un_error_de_infraestructura_inesperado', async () => {
    // Error NO de dominio: simula caída de BD / fallo de infraestructura.
    loginUseCase.ejecutar.mockRejectedValue(new Error('DB connection lost'));

    const res = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email: EMAIL, password: PASSWORD });

    // Un fallo de infra NO debe disfrazarse de credenciales incorrectas.
    expect(res.status).toBe(500);
    expect(res.status).not.toBe(401);
    expect(res.body.statusCode).toBe(500);
    // No debe traducirse al mensaje genérico de credenciales del catch amplio.
    expect(JSON.stringify(res.body)).not.toContain('Credenciales incorrectas');
  });
});

describe('POST /api/auth/refresh — frontera HTTP (US-001)', () => {
  it('debe_responder_200_y_no_201_cuando_el_refresh_de_la_cookie_es_valido', async () => {
    refreshUseCase.ejecutar.mockResolvedValue({
      accessToken: 'access.renovado',
      usuario: usuarioPublico,
    });

    const res = await request(app.getHttpServer())
      .post('/api/auth/refresh')
      .set('Cookie', `${COOKIE_REFRESH}=refresh.valido`)
      .send();

    expect(res.status).toBe(200);
    expect(res.body).toEqual(expect.objectContaining({ accessToken: 'access.renovado' }));
  });

  it('debe_responder_401_cuando_el_refresh_es_invalido_o_expirado', async () => {
    refreshUseCase.ejecutar.mockRejectedValue(new RefreshInvalidoError());

    const res = await request(app.getHttpServer())
      .post('/api/auth/refresh')
      .set('Cookie', `${COOKIE_REFRESH}=refresh.caducado`)
      .send();

    expect(res.status).toBe(401);
    expect(res.body.statusCode).toBe(401);
  });

  // Mismo BUG en `refresh()`: su `catch {}` amplio también degrada un fallo de
  // infraestructura a 401 ("Sesión expirada o inválida"). Un error inesperado que
  // NO es `RefreshInvalidoError` debe propagarse a 500. Caso ROJO hoy (recibe 401).
  it('debe_responder_500_y_no_401_cuando_el_refresh_lanza_un_error_de_infraestructura_inesperado', async () => {
    refreshUseCase.ejecutar.mockRejectedValue(new Error('DB connection lost'));

    const res = await request(app.getHttpServer())
      .post('/api/auth/refresh')
      .set('Cookie', `${COOKIE_REFRESH}=refresh.valido`)
      .send();

    expect(res.status).toBe(500);
    expect(res.status).not.toBe(401);
    expect(res.body.statusCode).toBe(500);
    expect(JSON.stringify(res.body)).not.toContain('Sesión expirada');
  });
});
