/**
 * TESTS DE INTEGRACIÓN HTTP de `POST /auth/logout` — fase TDD RED (US-002).
 *
 * Trazabilidad: US-002, UC-02; spec-delta `auth` (Requirement MODIFICADO). tasks.md
 * Fase 3: 3.4 (frontera HTTP del endpoint) y backend #2 (idempotencia), #4 (no
 * anónimo). Decisiones del Gate SDD: §2 idempotencia / cookie OPCIONAL.
 *
 * Se levanta una app Nest MÍNIMA con supertest y el MISMO filtro/pipe/prefijo que
 * `main.ts`, montando solo `AuthController` con DOBLES de los use-cases. Verifica el
 * CONTRATO CONGELADO de `/auth/logout`:
 *
 *   - Se identifica por la COOKIE de refresh (no por el access token): el controlador
 *     debe pasar al caso de uso el `refreshToken` leído de la cookie.
 *   - Responde 200/204 SIEMPRE (idempotente) y limpia la cookie (Set-Cookie expirada).
 *   - NUNCA 401 por ausencia de cookie (cookie opcional, §2).
 *   - Completa aunque NO haya Authorization (access token expirado/ausente).
 *   - No anónimo: no acepta un usuario de destino; opera solo sobre la cookie propia.
 *
 * RED esperado: el `AuthController.logout` actual identifica al usuario desde
 * `req.user` (ACCESS token) y llama al caso de uso con `{ tenantId, idUsuario }` solo
 * si ese usuario existe; NO lee la cookie de refresh ni la pasa al caso de uso → las
 * aserciones de "use-case invocado con { refreshToken }" fallan por comportamiento
 * de producción ausente.
 */
import { ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AuthController } from '../interface/auth.controller';
import { LoginThrottleGuard } from '../interface/login-throttle.guard';
import {
  LOGIN_USE_CASE,
  LOGOUT_USE_CASE,
  OBTENER_USUARIO_ACTUAL_USE_CASE,
  REFRESH_USE_CASE,
} from '../auth.tokens';
import { HttpExceptionFilter } from '../../shared/filters/http-exception.filter';

const COOKIE_REFRESH = 'refresh_token';
const REFRESH_VALIDO = 'refresh.jwt.valido';

const loginUseCase = { ejecutar: jest.fn() };
const refreshUseCase = { ejecutar: jest.fn() };
const logoutUseCase = { ejecutar: jest.fn(async () => undefined) };
const obtenerUsuarioActualUseCase = { ejecutar: jest.fn() };

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
    .overrideGuard(LoginThrottleGuard)
    .useValue({ canActivate: () => true })
    .compile();

  app = moduleRef.createNestApplication();
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

const limpiaLaCookieRefresh = (setCookie: string[] | undefined): boolean =>
  Boolean(
    setCookie?.some(
      (c) => c.startsWith(`${COOKIE_REFRESH}=`) && /(Expires=|Max-Age=0)/i.test(c),
    ),
  );

describe('POST /api/auth/logout — happy path identificado por la cookie (US-002)', () => {
  it('debe_responder_200_o_204_y_limpiar_la_cookie_de_refresh_cuando_la_cookie_es_valida', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/auth/logout')
      .set('Cookie', `${COOKIE_REFRESH}=${REFRESH_VALIDO}`)
      .send();

    expect([200, 204]).toContain(res.status);
    const setCookie = res.headers['set-cookie'] as unknown as string[] | undefined;
    expect(limpiaLaCookieRefresh(setCookie)).toBe(true);
  });

  it('debe_pasar_al_caso_de_uso_el_refresh_token_leido_de_la_cookie', async () => {
    await request(app.getHttpServer())
      .post('/api/auth/logout')
      .set('Cookie', `${COOKIE_REFRESH}=${REFRESH_VALIDO}`)
      .send();

    // El endpoint se identifica por la COOKIE de refresh (contrato congelado),
    // no por el access token: el caso de uso recibe `{ refreshToken }`.
    expect(logoutUseCase.ejecutar).toHaveBeenCalledWith(
      expect.objectContaining({ refreshToken: REFRESH_VALIDO }),
    );
  });
});

describe('POST /api/auth/logout — idempotencia y cookie opcional (US-002 §2)', () => {
  it('debe_responder_200_o_204_y_NUNCA_401_cuando_no_hay_cookie_de_refresh', async () => {
    const res = await request(app.getHttpServer()).post('/api/auth/logout').send();

    expect([200, 204]).toContain(res.status);
    expect(res.status).not.toBe(401);
  });

  it('debe_responder_200_o_204_en_un_segundo_logout_con_cookie_ausente_sin_devolver_error', async () => {
    // Doble logout: la cookie ya fue limpiada/ausente → idempotente, sin error.
    const res = await request(app.getHttpServer()).post('/api/auth/logout').send();

    expect([200, 204]).toContain(res.status);
    expect(res.body?.statusCode).not.toBe(401);
  });
});

describe('POST /api/auth/logout — access token expirado pero refresh válido (US-002)', () => {
  it('debe_completar_el_logout_sin_Authorization_identificando_solo_por_la_cookie', async () => {
    // SIN header Authorization (access expirado/ausente): el logout depende del refresh.
    const res = await request(app.getHttpServer())
      .post('/api/auth/logout')
      .set('Cookie', `${COOKIE_REFRESH}=${REFRESH_VALIDO}`)
      .send();

    expect([200, 204]).toContain(res.status);
    expect(logoutUseCase.ejecutar).toHaveBeenCalledWith(
      expect.objectContaining({ refreshToken: REFRESH_VALIDO }),
    );
  });
});

describe('POST /api/auth/logout — no anónimo: solo la sesión propia (US-002 §Reglas)', () => {
  it('debe_ignorar_cualquier_usuario_de_destino_del_body_y_operar_solo_sobre_la_cookie', async () => {
    await request(app.getHttpServer())
      .post('/api/auth/logout')
      .set('Cookie', `${COOKIE_REFRESH}=${REFRESH_VALIDO}`)
      .send({ usuarioId: '00000000-0000-0000-0000-0000000000ff', tenantId: 'ajeno' });

    // No puede cerrar la sesión de otro: el caso de uso se invoca con el refresh de
    // la cookie del llamante, jamás con un identificador de destino del body.
    const args = (logoutUseCase.ejecutar as jest.Mock).mock.calls[0]?.[0] ?? {};
    expect(args).toEqual(expect.objectContaining({ refreshToken: REFRESH_VALIDO }));
    expect(JSON.stringify(args)).not.toContain('0000000000ff');
    expect(JSON.stringify(args)).not.toContain('ajeno');
  });
});
