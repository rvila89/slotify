/**
 * TESTS DE INTEGRACIÓN HTTP del `ConsultarCalendarioController` (US-039 / UC-29) —
 * frontera HTTP REAL del endpoint congelado `GET /calendario`. Levanta una app Nest
 * mínima con supertest y el MISMO `ValidationPipe` GLOBAL + `HttpExceptionFilter` que
 * `main.ts`, para ejercitar la VALIDACIÓN de query que el unit test (controller en
 * aislamiento) no cubre.
 *
 * HALLAZGO H-1 (US-039): hoy `GET /calendario?desde=2026-08-31&hasta=2026-08-01`
 * (rango INVERTIDO, `desde > hasta`) responde 200 + `fechas:[]` — un rango imposible se
 * cuela como rango vacío. DEBE rechazarse en la validación CROSS-FIELD del query, con un
 * mensaje claro en español indicando que `desde` debe ser <= `hasta`.
 *
 * CÓDIGO DE ERROR = 400 (NO 422). Razón (contrato es la frontera, CLAUDE.md):
 *   - El contrato OpenAPI congelado (`docs/api-spec.yml`, op `consultarCalendario`)
 *     declara para `/calendario` SOLO `400` (`$ref ValidationError`) y `401`; NO declara
 *     `422`. El 422 de `extender-bloqueo` existe porque SU contrato lo declara — aquí no.
 *   - El `ValidationPipe` GLOBAL (`main.ts`: whitelist + forbidNonWhitelisted + transform)
 *     rechaza los fallos de `class-validator` con su HTTP por defecto: **400**. La regla
 *     cross-field (`desde <= hasta`) es validación de FORMA del query y debe vivir en el
 *     DTO (validador cross-field de class-validator), por lo que sale por el pipe global
 *     como 400 — exactamente el código que el contrato declara.
 *
 * RED: la validación cross-field aún NO existe en `ConsultarCalendarioQueryDto`, así que
 * hoy el rango invertido pasa el pipe y llega al use-case (200). Estos tests están en
 * ROJO hasta que `backend-developer` añada la guarda. GREEN NO es de este agente.
 */
import { ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import type { Request, Response, NextFunction } from 'express';
import request from 'supertest';
import { ConsultarCalendarioController } from '../consultar-calendario.controller';
import {
  ObtenerCalendarioUseCase,
  type CalendarioLectura,
  type ObtenerCalendarioComando,
} from '../../application/obtener-calendario.query';
import { HttpExceptionFilter } from '../../../shared/filters/http-exception.filter';
import type { UsuarioAutenticado } from '../../../shared/auth/usuario-autenticado';

const TENANT = '00000000-0000-0000-0000-000000000001';
const GESTOR = '00000000-0000-0000-0000-0000000000a1';
// Fragmento esperado del mensaje cross-field (español, orientado al usuario).
const MENSAJE_RANGO = 'El parámetro «desde» debe ser anterior o igual a «hasta»';
const usuario: UsuarioAutenticado = { sub: GESTOR, tenantId: TENANT, rol: 'gestor' };

// Read-model trivial: el adaptador (mockeado) devolvería 0 fechas para un rango
// invertido. Esto reproduce el síntoma de H-1: sin la guarda, el rango imposible se
// agrega como rango vacío y responde 200.
const lecturaVacia = (desde: string, hasta: string): CalendarioLectura => ({
  rango: {
    desde: new Date(`${desde}T00:00:00.000Z`),
    hasta: new Date(`${hasta}T00:00:00.000Z`),
  },
  fechas: [],
});

// Use-case FALSO: registra si llegó a ejecutarse. Si la validación cross-field rechaza
// ANTES (objetivo de H-1), `ejecutado` queda en false; el rango imposible no debe llegar
// al read-model.
let ejecutado = false;
const useCase = {
  ejecutar: async (comando: ObtenerCalendarioComando): Promise<CalendarioLectura> => {
    ejecutado = true;
    const aIso = (f: Date): string => f.toISOString().slice(0, 10);
    return lecturaVacia(aIso(comando.desde), aIso(comando.hasta));
  },
} as unknown as ObtenerCalendarioUseCase;

let app: INestApplication;

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({
    controllers: [ConsultarCalendarioController],
    providers: [{ provide: ObtenerCalendarioUseCase, useValue: useCase }],
  }).compile();

  app = moduleRef.createNestApplication();
  // Inyecta el usuario del JWT que `@CurrentUser` lee (no se prueba auth aquí).
  app.use((req: Request, _res: Response, next: NextFunction) => {
    req.user = usuario;
    next();
  });
  // Réplica fiel de `main.ts`: prefijo, ValidationPipe GLOBAL (400) y filtro real.
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
  ejecutado = false;
});

describe('GET /api/calendario — validación cross-field del rango (US-039, H-1)', () => {
  it('debe_responder_400_cuando_desde_es_posterior_a_hasta_rango_invertido', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/calendario')
      .query({ desde: '2026-08-31', hasta: '2026-08-01' });

    // 400 del contrato (ValidationError): un rango imposible NO es un rango vacío.
    expect(res.status).toBe(400);
    expect(res.body.statusCode).toBe(400);
    // El rango invertido NO debe llegar al read-model (corta en el pipe).
    expect(ejecutado).toBe(false);
    // Mensaje claro en español indicando desde <= hasta.
    const mensajes = Array.isArray(res.body.message)
      ? res.body.message
      : [res.body.message];
    expect(mensajes.join(' ')).toContain(MENSAJE_RANGO);
  });

  it('debe_responder_200_cuando_desde_es_igual_a_hasta_mismo_dia', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/calendario')
      .query({ desde: '2026-08-15', hasta: '2026-08-15' });

    // Caso de control: un único día es un rango válido (límite inclusivo).
    expect(res.status).toBe(200);
    expect(ejecutado).toBe(true);
    expect(res.body.rango.desde).toBe('2026-08-15');
    expect(res.body.rango.hasta).toBe('2026-08-15');
  });

  it('debe_responder_200_cuando_desde_es_anterior_a_hasta_rango_normal', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/calendario')
      .query({ desde: '2026-08-01', hasta: '2026-08-31' });

    // Caso de control: el happy path NO debe romperse al añadir la guarda.
    expect(res.status).toBe(200);
    expect(ejecutado).toBe(true);
    expect(res.body.rango.desde).toBe('2026-08-01');
    expect(res.body.rango.hasta).toBe('2026-08-31');
  });
});
