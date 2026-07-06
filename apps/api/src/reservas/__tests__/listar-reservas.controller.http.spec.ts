/**
 * TESTS DE INTEGRACIÓN HTTP de CONFORMIDAD DE CONTRATO del endpoint del pipeline
 * `GET /api/reservas` → `ReservaListResponse` (US-049 / UC-37 / UC-38; fix de scope
 * US-050 §5b.1) — fase TDD RED.
 *
 * Hallazgo (QA US-050): el backend NO es conforme al contrato OpenAPI congelado. El
 * schema `Reserva` declara `idReserva` (required) y expone `fechaEvento`,
 * `numInvitadosFinal`, `numAdultosNinosMayores4`, `numNinosMenores4` y `notas`; la
 * implementación actual (`ReservaPipelineItemDto` + `aResponse()`) emite `id` (mal) y
 * OMITE los cinco campos de datos. El frontend tipado contra el contrato queda NO
 * funcional con datos reales (`/reservas/undefined`, sin fecha/aforo/nota).
 *
 * Frontera HTTP REAL con supertest y el MISMO `ValidationPipe` GLOBAL +
 * `HttpExceptionFilter` que `main.ts`. El `ListarReservasUseCase` se DOBLA (in-memory)
 * para no tocar Prisma (hexagonal): se verifica el CONTRATO del controller (forma de la
 * respuesta HTTP), NO la transacción. Un middleware inyecta el `req.user` que
 * `@CurrentUser` espera.
 *
 * RED: hoy la respuesta trae `id` en vez de `idReserva` y NO trae los cinco campos de
 * datos → estas aserciones fallan por AUSENCIA de proyección conforme (no por error
 * trivial de import). El GREEN es de `backend-developer`: alinear
 * `interface/listar-reservas.dto.ts`, `application/listar-reservas.use-case.ts` y
 * `interface/listar-reservas.controller.ts` al schema `Reserva`.
 */
import { ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import type { Request, Response, NextFunction } from 'express';
import request from 'supertest';
import { ListarReservasController } from '../interface/listar-reservas.controller';
import {
  ListarReservasUseCase,
  type ListarReservasComando,
  type ReservaListResponse,
} from '../application/listar-reservas.use-case';
import { HttpExceptionFilter } from '../../shared/filters/http-exception.filter';
import type { UsuarioAutenticado } from '../../shared/auth/usuario-autenticado';

const TENANT = '00000000-0000-0000-0000-000000000001';
const GESTOR = '00000000-0000-0000-0000-0000000000a1';
const usuarioGestor: UsuarioAutenticado = { sub: GESTOR, tenantId: TENANT, rol: 'gestor' };

// Respuesta que el use-case doblado devuelve: una reserva ACTIVA con TODOS los campos
// del contrato `Reserva` poblados. La forma de este objeto es la que la proyección del
// use-case DEBE producir (idReserva + los cinco campos de datos + derivados US-049).
const respuestaConforme: ReservaListResponse = {
  data: [
    {
      // Identificador del contrato (required): `idReserva`, NO `id`.
      idReserva: '11111111-1111-1111-1111-111111111111',
      codigo: 'SLO-2026-0001',
      estado: 'reserva_confirmada',
      subEstado: null,
      fechaCreacion: '2026-06-01T08:00:00.000Z',
      // Cinco campos de datos del schema `Reserva` que hoy se omiten.
      fechaEvento: '2027-10-20',
      numInvitadosFinal: 80,
      numAdultosNinosMayores4: 72,
      numNinosMenores4: 8,
      notas: 'Alergia a frutos secos; montaje a las 17:00',
      // Derivados de presentación US-049.
      nombreEvento: 'Ana García López',
      progressLogistica: 50,
      progressLiquidacion: 0,
    },
  ],
  metadata: { total: 1, page: 1, limit: 20, totalPages: 1 },
} as unknown as ReservaListResponse;

let ultimoComando: ListarReservasComando | null = null;

const useCaseFalso = {
  ejecutar: async (comando: ListarReservasComando): Promise<ReservaListResponse> => {
    ultimoComando = comando;
    return respuestaConforme;
  },
} as unknown as ListarReservasUseCase;

let app: INestApplication;

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({
    controllers: [ListarReservasController],
    providers: [{ provide: ListarReservasUseCase, useValue: useCaseFalso }],
  }).compile();

  app = moduleRef.createNestApplication();
  app.use((req: Request, _res: Response, next: NextFunction) => {
    req.user = usuarioGestor;
    next();
  });
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
  ultimoComando = null;
});

describe('GET /api/reservas — conformidad de contrato del pipeline (US-050 §5b.1)', () => {
  it('debe_responder_200_y_derivar_el_tenant_del_jwt', async () => {
    const res = await request(app.getHttpServer()).get('/api/reservas');

    expect(res.status).toBe(200);
    // El tenant SIEMPRE deriva del JWT, nunca del query.
    expect(ultimoComando?.tenantId).toBe(TENANT);
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.data).toHaveLength(1);
  });

  it('debe_exponer_idReserva_y_no_id_en_cada_elemento_de_data', async () => {
    const res = await request(app.getHttpServer()).get('/api/reservas');

    const item = res.body.data[0];
    // Contrato `Reserva`: identificador = `idReserva` (required).
    expect(item.idReserva).toBe('11111111-1111-1111-1111-111111111111');
    // El campo `id` NO forma parte del schema: no debe aparecer en la respuesta.
    expect(item).not.toHaveProperty('id');
  });

  it('debe_exponer_los_cinco_campos_de_datos_del_schema_Reserva', async () => {
    const res = await request(app.getHttpServer()).get('/api/reservas');

    const item = res.body.data[0];
    expect(item.fechaEvento).toBe('2027-10-20');
    expect(item.numInvitadosFinal).toBe(80);
    expect(item.numAdultosNinosMayores4).toBe(72);
    expect(item.numNinosMenores4).toBe(8);
    expect(item.notas).toBe('Alergia a frutos secos; montaje a las 17:00');
  });

  it('debe_mantener_los_derivados_de_presentacion_US049_junto_a_los_campos_de_datos', async () => {
    const res = await request(app.getHttpServer()).get('/api/reservas');

    const item = res.body.data[0];
    // Los derivados US-049 conviven con los cinco campos de datos (no se pierden).
    expect(item.nombreEvento).toBe('Ana García López');
    expect(item.progressLogistica).toBe(50);
    expect(item.progressLiquidacion).toBe(0);
    // Y los campos de datos siguen presentes en la MISMA respuesta.
    expect(item.fechaEvento).toBe('2027-10-20');
    expect(item.notas).toBe('Alergia a frutos secos; montaje a las 17:00');
  });
});
