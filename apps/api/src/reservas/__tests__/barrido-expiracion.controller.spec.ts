/**
 * TESTS DE INTEGRACIÓN HTTP del `BarridoExpiracionController` + `CronTokenGuard`
 * (US-012 / UC-09) — fase TDD RED. tasks.md Fase 3: 3.11.
 *
 * Trazabilidad: US-012, spec-delta `consultas` (Requirement "Barrido periódico
 * protegido de expiración por TTL agotado"; escenarios "El cron invoca el endpoint
 * con token válido y barre las candidatas" y "Llamada sin token o con token inválido
 * se rechaza" → 401), design.md §D-1/§D-2 (endpoint interno protegido
 * `POST /cron/barrido-expiracion`, auth service-to-service por cabecera
 * `X-Cron-Token` comparada con `CRON_TOKEN` del entorno vía `CronTokenGuard`, NO el
 * JwtAuthGuard de usuario; sin token válido → 401). Contrato congelado
 * `docs/api-spec.yml` op `barridoExpiracion` (200 → `BarridoExpiracionResponse`
 * `{ candidatas, expiradas, promocionesDisparadas, fallos }`; 401 sin token).
 *
 * Se levanta una app Nest mínima con supertest y el MISMO `HttpExceptionFilter`
 * global que `main.ts`. El caso de uso `ExpirarConsultasVencidasService` se mockea
 * (doble): aquí se prueba la FRONTERA HTTP (guard + shape de respuesta), no la
 * lógica de barrido (cubierta en los specs de use-case/integración/concurrencia).
 * El `CronTokenGuard` REAL se ejercita contra un `ConfigService` con `CRON_TOKEN`
 * fijo, así que el 401 lo produce la comparación real del token, no un mock del guard.
 *
 * RED: aún NO existen `interface/barrido-expiracion.controller.ts` ni
 * `shared/auth/cron-token.guard.ts`; los imports fallan y la batería está en ROJO
 * por AUSENCIA DE IMPLEMENTACIÓN. GREEN es de `backend-developer`.
 */
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { BarridoExpiracionController } from '../interface/barrido-expiracion.controller';
import { CronTokenGuard } from '../../shared/auth/cron-token.guard';
import { ExpirarConsultasVencidasService } from '../application/expirar-consultas-vencidas.service';
import { HttpExceptionFilter } from '../../shared/filters/http-exception.filter';

const CRON_TOKEN = 'dev-cron-token';

const resumenFake = {
  candidatas: 5,
  expiradas: 4,
  promocionesDisparadas: 1,
  fallos: 0,
};

// Doble del caso de uso: solo cuenta invocaciones y devuelve el resumen.
const barridoUseCase = { ejecutar: jest.fn(async () => resumenFake) };

// ConfigService con el CRON_TOKEN de entorno (fuente de verdad del guard).
const configService = {
  get: jest.fn((clave: string) => (clave === 'CRON_TOKEN' ? CRON_TOKEN : undefined)),
} as unknown as ConfigService;

let app: INestApplication;

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({
    controllers: [BarridoExpiracionController],
    providers: [
      { provide: ExpirarConsultasVencidasService, useValue: barridoUseCase },
      { provide: ConfigService, useValue: configService },
      // El guard REAL: compara la cabecera con CRON_TOKEN del ConfigService.
      CronTokenGuard,
    ],
  }).compile();

  app = moduleRef.createNestApplication();
  app.setGlobalPrefix('api');
  app.useGlobalFilters(new HttpExceptionFilter());
  await app.init();
});

afterAll(async () => {
  await app.close();
});

beforeEach(() => {
  barridoUseCase.ejecutar.mockClear();
});

describe('POST /api/cron/barrido-expiracion — CronTokenGuard (US-012, D-2)', () => {
  it('debe_responder_200_con_el_resumen_cuando_el_X_Cron_Token_es_valido', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/cron/barrido-expiracion')
      .set('X-Cron-Token', CRON_TOKEN);

    expect(res.status).toBe(200);
    // Shape EXACTA del contrato (BarridoExpiracionResponse).
    expect(res.body).toEqual(resumenFake);
    expect(barridoUseCase.ejecutar).toHaveBeenCalledTimes(1);
  });

  it('debe_responder_401_cuando_falta_la_cabecera_X_Cron_Token', async () => {
    const res = await request(app.getHttpServer()).post('/api/cron/barrido-expiracion');

    expect(res.status).toBe(401);
    // No procesa ninguna expiración si no está autenticado.
    expect(barridoUseCase.ejecutar).not.toHaveBeenCalled();
  });

  it('debe_responder_401_cuando_el_X_Cron_Token_es_incorrecto', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/cron/barrido-expiracion')
      .set('X-Cron-Token', 'token-incorrecto');

    expect(res.status).toBe(401);
    expect(barridoUseCase.ejecutar).not.toHaveBeenCalled();
  });

  it('no_debe_aceptar_un_JWT_bearer_como_credencial_del_endpoint_de_cron', async () => {
    // El endpoint es service-to-service (X-Cron-Token), NO JWT de usuario: un bearer
    // sin la cabecera de cron NO autoriza (401).
    const res = await request(app.getHttpServer())
      .post('/api/cron/barrido-expiracion')
      .set('Authorization', 'Bearer un.jwt.de.usuario');

    expect(res.status).toBe(401);
    expect(barridoUseCase.ejecutar).not.toHaveBeenCalled();
  });
});
