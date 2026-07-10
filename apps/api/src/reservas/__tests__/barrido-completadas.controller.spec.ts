/**
 * TESTS DE INTEGRACIÓN HTTP del `BarridoCompletadasController` + `CronTokenGuard`
 * (US-037 / UC-28, actor Sistema) — fase TDD RED. tasks.md Fase 4: 4.14.
 *
 * Trazabilidad: US-037; spec-delta `consultas` (Requirement "Barrido periódico protegido
 * de archivado automático a reserva_completada en T+7d"; escenarios "El cron invoca el
 * barrido con token válido y archiva las reservas elegibles" y "Llamada sin token o con
 * token inválido se rechaza" → 401), design.md §D-1 (endpoint interno protegido con auth
 * service-to-service por cabecera `X-Cron-Token` comparada con `CRON_TOKEN` del entorno
 * vía `CronTokenGuard`, NO el JwtAuthGuard de usuario; sin token válido → 401).
 * Contrato CONGELADO `docs/api-spec.yml` `POST /cron/barrido-completadas` — endpoint
 * DEDICADO, gemelo del `POST /cron/barrido-eventos` de US-031 y `POST /cron/barrido-expiracion`
 * de US-012 (mismo módulo `reservas`). Devuelve el resumen DIRECTAMENTE con la forma del
 * schema `BarridoCompletadasResponse` (`{ candidatas, archivadas, fianzaPendiente,
 * fallos }`); 401 sin token/token inválido. PROHIBIDO reutilizar `POST /cron/barrido` ni
 * dispatch por `?tarea=` (design §D-1; memoria "Cron ?tarea= dispatch es ficticio").
 *
 * Se levanta una app Nest mínima con supertest y el MISMO `HttpExceptionFilter` global
 * que `main.ts`. El caso de uso `ArchivarReservasCompletadasService` se mockea (doble):
 * aquí se prueba la FRONTERA HTTP (guard + shape de la respuesta con el resumen), no la
 * lógica de barrido (cubierta en use-case/integración/concurrencia). El `CronTokenGuard`
 * REAL se ejercita contra un `ConfigService` con `CRON_TOKEN` fijo, de modo que el 401 lo
 * produce la comparación real del token, no un mock del guard.
 *
 * RED: aún NO existe `interface/barrido-completadas.controller.ts` ni el use-case
 * `ArchivarReservasCompletadasService`. GREEN es de `backend-developer`. (`CronTokenGuard`
 * sí existe; reutilizado de US-012/US-026/US-031.)
 */
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { BarridoCompletadasController } from '../interface/barrido-completadas.controller';
import { CronTokenGuard } from '../../shared/auth/cron-token.guard';
import { ArchivarReservasCompletadasService } from '../application/archivar-reservas-completadas.service';
import { HttpExceptionFilter } from '../../shared/filters/http-exception.filter';

const CRON_TOKEN = 'dev-cron-token';

// Resumen del archivado (shape del schema `BarridoCompletadasResponse` del contrato).
const resumenCompletadas = {
  candidatas: 4,
  archivadas: 2,
  fianzaPendiente: 1,
  fallos: 1,
};

// Doble del caso de uso: solo cuenta invocaciones y devuelve el resumen.
const barridoUseCase = { ejecutar: jest.fn(async () => resumenCompletadas) };

// ConfigService con el CRON_TOKEN de entorno (fuente de verdad del guard).
const configService = {
  get: jest.fn((clave: string) => (clave === 'CRON_TOKEN' ? CRON_TOKEN : undefined)),
} as unknown as ConfigService;

let app: INestApplication;

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({
    controllers: [BarridoCompletadasController],
    providers: [
      { provide: ArchivarReservasCompletadasService, useValue: barridoUseCase },
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

describe('POST /api/cron/barrido-completadas — CronTokenGuard (US-037, D-1)', () => {
  it('debe_responder_200_con_el_resumen_cuando_el_X_Cron_Token_es_valido', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/cron/barrido-completadas')
      .set('X-Cron-Token', CRON_TOKEN);

    expect(res.status).toBe(200);
    // Endpoint dedicado que devuelve el resumen DIRECTAMENTE con la forma
    // `BarridoCompletadasResponse` { candidatas, archivadas, fianzaPendiente, fallos }.
    expect(res.body).toEqual(resumenCompletadas);
    expect(barridoUseCase.ejecutar).toHaveBeenCalledTimes(1);
  });

  it('debe_responder_401_cuando_falta_la_cabecera_X_Cron_Token', async () => {
    const res = await request(app.getHttpServer()).post('/api/cron/barrido-completadas');

    expect(res.status).toBe(401);
    // No archiva ninguna reserva si no está autenticado.
    expect(barridoUseCase.ejecutar).not.toHaveBeenCalled();
  });

  it('debe_responder_401_cuando_el_X_Cron_Token_es_incorrecto', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/cron/barrido-completadas')
      .set('X-Cron-Token', 'token-incorrecto');

    expect(res.status).toBe(401);
    expect(barridoUseCase.ejecutar).not.toHaveBeenCalled();
  });

  it('no_debe_aceptar_un_JWT_bearer_como_credencial_del_endpoint_de_cron', async () => {
    // El endpoint es service-to-service (X-Cron-Token), NO JWT de usuario: un bearer sin
    // la cabecera de cron NO autoriza (401).
    const res = await request(app.getHttpServer())
      .post('/api/cron/barrido-completadas')
      .set('Authorization', 'Bearer un.jwt.de.usuario');

    expect(res.status).toBe(401);
    expect(barridoUseCase.ejecutar).not.toHaveBeenCalled();
  });
});
