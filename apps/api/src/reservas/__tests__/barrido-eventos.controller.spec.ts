/**
 * TESTS DE INTEGRACIÓN HTTP del `BarridoEventosController` + `CronTokenGuard`
 * (US-031 / UC-23, actor Sistema) — fase TDD RED. tasks.md Fase 3: 3.12.
 *
 * Trazabilidad: US-031; spec-delta `consultas` (Requirement "Barrido periódico protegido
 * de inicio automático de evento en T-0"; escenarios "El cron invoca el barrido con
 * token válido e inicia los eventos elegibles" y "Llamada sin token o con token inválido
 * se rechaza" → 401), design.md §D-1/§D-2 (endpoint interno protegido con auth
 * service-to-service por cabecera `X-Cron-Token` comparada con `CRON_TOKEN` del entorno
 * vía `CronTokenGuard`, NO el JwtAuthGuard de usuario; sin token válido → 401).
 * Contrato CONGELADO (D-2 Opción B, resuelto 2026-07-07) `docs/api-spec.yml`
 * `POST /cron/barrido-eventos` — endpoint DEDICADO, gemelo del `POST /cron/barrido-expiracion`
 * de US-012 (mismo módulo `reservas`). Devuelve el resumen DIRECTAMENTE con la forma del
 * schema `BarridoEventosResponse` (`{ candidatas, eventosIniciados, precondicionesIncumplidas,
 * fallos }`); 401 sin token/token inválido. (Se descartó la Opción A —subobjeto
 * `BarridoResponse.eventos` en `POST /cron/barrido?tarea=eventos`— por colisión de ruta con el
 * barrido de fichas de US-026, ya mergeado; ver `design.md §D-2` RESOLUCIÓN DE GATE.)
 *
 * Se levanta una app Nest mínima con supertest y el MISMO `HttpExceptionFilter` global
 * que `main.ts`. El caso de uso `IniciarEventosDelDiaService` se mockea (doble): aquí se
 * prueba la FRONTERA HTTP (guard + shape de la respuesta con el resumen), no
 * la lógica de barrido (cubierta en use-case/integración/concurrencia). El
 * `CronTokenGuard` REAL se ejercita contra un `ConfigService` con `CRON_TOKEN` fijo, de
 * modo que el 401 lo produce la comparación real del token, no un mock del guard.
 *
 * RED: aún NO existe `interface/barrido-eventos.controller.ts`. GREEN es de
 * `backend-developer`. (`CronTokenGuard` y el use-case `IniciarEventosDelDiaService` sí
 * existen; el guard reutilizado de US-012/US-026.)
 */
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { BarridoEventosController } from '../interface/barrido-eventos.controller';
import { CronTokenGuard } from '../../shared/auth/cron-token.guard';
import { IniciarEventosDelDiaService } from '../application/iniciar-eventos-del-dia.service';
import { HttpExceptionFilter } from '../../shared/filters/http-exception.filter';

const CRON_TOKEN = 'dev-cron-token';

// Resumen del inicio de eventos (shape del schema `BarridoEventosResponse` del contrato).
const resumenEventos = {
  candidatas: 4,
  eventosIniciados: 2,
  precondicionesIncumplidas: 1,
  fallos: 1,
};

// Doble del caso de uso: solo cuenta invocaciones y devuelve el resumen.
const barridoUseCase = { ejecutar: jest.fn(async () => resumenEventos) };

// ConfigService con el CRON_TOKEN de entorno (fuente de verdad del guard).
const configService = {
  get: jest.fn((clave: string) => (clave === 'CRON_TOKEN' ? CRON_TOKEN : undefined)),
} as unknown as ConfigService;

let app: INestApplication;

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({
    controllers: [BarridoEventosController],
    providers: [
      { provide: IniciarEventosDelDiaService, useValue: barridoUseCase },
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

describe('POST /api/cron/barrido-eventos — CronTokenGuard (US-031, D-2 Opción B)', () => {
  it('debe_responder_200_con_el_resumen_cuando_el_X_Cron_Token_es_valido', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/cron/barrido-eventos')
      .set('X-Cron-Token', CRON_TOKEN);

    expect(res.status).toBe(200);
    // Contrato congelado (Opción B): endpoint dedicado que devuelve el resumen DIRECTAMENTE
    // con la forma `BarridoEventosResponse` { candidatas, eventosIniciados,
    // precondicionesIncumplidas, fallos } (gemelo de barrido-expiracion de US-012).
    expect(res.body).toEqual(resumenEventos);
    expect(barridoUseCase.ejecutar).toHaveBeenCalledTimes(1);
  });

  it('debe_responder_401_cuando_falta_la_cabecera_X_Cron_Token', async () => {
    const res = await request(app.getHttpServer()).post('/api/cron/barrido-eventos');

    expect(res.status).toBe(401);
    // No inicia ningún evento si no está autenticado.
    expect(barridoUseCase.ejecutar).not.toHaveBeenCalled();
  });

  it('debe_responder_401_cuando_el_X_Cron_Token_es_incorrecto', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/cron/barrido-eventos')
      .set('X-Cron-Token', 'token-incorrecto');

    expect(res.status).toBe(401);
    expect(barridoUseCase.ejecutar).not.toHaveBeenCalled();
  });

  it('no_debe_aceptar_un_JWT_bearer_como_credencial_del_endpoint_de_cron', async () => {
    // El endpoint es service-to-service (X-Cron-Token), NO JWT de usuario: un bearer sin
    // la cabecera de cron NO autoriza (401).
    const res = await request(app.getHttpServer())
      .post('/api/cron/barrido-eventos')
      .set('Authorization', 'Bearer un.jwt.de.usuario');

    expect(res.status).toBe(401);
    expect(barridoUseCase.ejecutar).not.toHaveBeenCalled();
  });
});
