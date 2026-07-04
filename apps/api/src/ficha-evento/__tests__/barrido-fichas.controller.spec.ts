/**
 * TESTS DE INTEGRACIÓN HTTP del `BarridoFichasController` + `CronTokenGuard`
 * (US-026 / UC-20 FA-01, actor Sistema) — fase TDD RED. tasks.md Fase 3: 3.11.
 *
 * Trazabilidad: US-026; spec-delta `ficha-operativa` (Requirement "Barrido periódico
 * protegido de cierre automático en T-1d"; escenarios "El cron invoca el barrido con
 * token válido y cierra las fichas elegibles" y "Llamada sin token o con token inválido
 * se rechaza" → 401), design.md §D-1/§D-2 (endpoint interno protegido con auth
 * service-to-service por cabecera `X-Cron-Token` comparada con `CRON_TOKEN` del entorno
 * vía `CronTokenGuard`, NO el JwtAuthGuard de usuario; sin token válido → 401).
 * Contrato CONGELADO (Opción A) `docs/api-spec.yml` `POST /cron/barrido?tarea=fichas`:
 * el resumen del cierre de fichas viaja en `BarridoResponse.fichas` con la forma del
 * schema `BarridoFichasResumen` (`{ candidatas, fichasCerradas, fallos }`); 401 sin
 * token/token inválido.
 *
 * Se levanta una app Nest mínima con supertest y el MISMO `HttpExceptionFilter` global
 * que `main.ts`. El caso de uso `CerrarFichasVencidasService` se mockea (doble): aquí
 * se prueba la FRONTERA HTTP (guard + shape de respuesta con el resumen bajo `fichas`),
 * no la lógica de barrido (cubierta en use-case/integración/concurrencia). El
 * `CronTokenGuard` REAL se ejercita contra un `ConfigService` con `CRON_TOKEN` fijo, de
 * modo que el 401 lo produce la comparación real del token, no un mock del guard.
 *
 * RED: aún NO existe `interface/barrido-fichas.controller.ts`; el import falla y la
 * batería está en ROJO por AUSENCIA DE IMPLEMENTACIÓN. GREEN es de `backend-developer`.
 * (`CronTokenGuard` sí existe, reutilizado de US-012.)
 */
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { BarridoFichasController } from '../interface/barrido-fichas.controller';
import { CronTokenGuard } from '../../shared/auth/cron-token.guard';
import { CerrarFichasVencidasService } from '../application/cerrar-fichas-vencidas.service';
import { HttpExceptionFilter } from '../../shared/filters/http-exception.filter';

const CRON_TOKEN = 'dev-cron-token';

// Resumen del cierre de fichas (shape del schema `BarridoFichasResumen` del contrato).
const resumenFichas = {
  candidatas: 3,
  fichasCerradas: 2,
  fallos: 0,
};

// Doble del caso de uso: solo cuenta invocaciones y devuelve el resumen.
const barridoUseCase = { ejecutar: jest.fn(async () => resumenFichas) };

// ConfigService con el CRON_TOKEN de entorno (fuente de verdad del guard).
const configService = {
  get: jest.fn((clave: string) => (clave === 'CRON_TOKEN' ? CRON_TOKEN : undefined)),
} as unknown as ConfigService;

let app: INestApplication;

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({
    controllers: [BarridoFichasController],
    providers: [
      { provide: CerrarFichasVencidasService, useValue: barridoUseCase },
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

describe('POST /api/cron/barrido?tarea=fichas — CronTokenGuard (US-026, D-2 Opción A)', () => {
  it('debe_responder_200_con_el_resumen_bajo_fichas_cuando_el_X_Cron_Token_es_valido', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/cron/barrido?tarea=fichas')
      .set('X-Cron-Token', CRON_TOKEN);

    expect(res.status).toBe(200);
    // Contrato congelado (Opción A): el resumen del cierre de fichas viaja en `fichas`
    // con la forma `BarridoFichasResumen` { candidatas, fichasCerradas, fallos }.
    expect(res.body).toHaveProperty('fichas');
    expect(res.body.fichas).toEqual(resumenFichas);
    expect(barridoUseCase.ejecutar).toHaveBeenCalledTimes(1);
  });

  it('debe_responder_401_cuando_falta_la_cabecera_X_Cron_Token', async () => {
    const res = await request(app.getHttpServer()).post('/api/cron/barrido?tarea=fichas');

    expect(res.status).toBe(401);
    // No cierra ninguna ficha si no está autenticado.
    expect(barridoUseCase.ejecutar).not.toHaveBeenCalled();
  });

  it('debe_responder_401_cuando_el_X_Cron_Token_es_incorrecto', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/cron/barrido?tarea=fichas')
      .set('X-Cron-Token', 'token-incorrecto');

    expect(res.status).toBe(401);
    expect(barridoUseCase.ejecutar).not.toHaveBeenCalled();
  });

  it('no_debe_aceptar_un_JWT_bearer_como_credencial_del_endpoint_de_cron', async () => {
    // El endpoint es service-to-service (X-Cron-Token), NO JWT de usuario: un bearer
    // sin la cabecera de cron NO autoriza (401).
    const res = await request(app.getHttpServer())
      .post('/api/cron/barrido?tarea=fichas')
      .set('Authorization', 'Bearer un.jwt.de.usuario');

    expect(res.status).toBe(401);
    expect(barridoUseCase.ejecutar).not.toHaveBeenCalled();
  });
});
