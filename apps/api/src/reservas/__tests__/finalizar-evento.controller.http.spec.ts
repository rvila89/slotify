/**
 * TESTS DE INTEGRACIÓN HTTP del endpoint de FINALIZACIÓN DE EVENTO (US-034 / UC-25)
 * `POST /api/reservas/:id/finalizar-evento` — fase TDD RED. tasks.md Fase 3: 3.10.
 *
 * Trazabilidad: US-034, contrato CONGELADO `docs/api-spec.yml` op `finalizarEvento`:
 *   - 200 `FinalizarEventoResponse`: RESERVA en `post_evento` + `e5: { resultado:
 *     enviado|fallido|no_aplica, comunicacionId }` + `documentacionPendiente: string[]`.
 *   - 401 sin JWT; 403 autenticado sin rol Gestor.
 *   - 404 RESERVA inexistente / de otro tenant (RLS).
 *   - 409 `code: transicion_no_permitida` cuando `estado != evento_en_curso` (o carrera
 *     de doble finalización perdida). design.md §D-3/§D-8/§D-9.
 *
 * Frontera HTTP REAL con supertest y el MISMO `ValidationPipe` GLOBAL +
 * `HttpExceptionFilter` que `main.ts`. El caso de uso `FinalizarEventoUseCase` se DOBLA
 * (in-memory) para no tocar Prisma: se verifica el CONTRATO del controller (mapeo
 * comando↔HTTP + traducción de errores de dominio a códigos + forma de la respuesta),
 * NO la transacción. Un middleware inyecta el `req.user` que `@CurrentUser` espera; el
 * `RolesGuard` + `@Roles('gestor')` deciden 403. El tenant/usuario viajan SIEMPRE del
 * JWT, nunca del path/body.
 *
 * RED: aún NO existen `FinalizarEventoController` ni `FinalizarEventoUseCase` con sus
 * errores de dominio (`TransicionNoPermitidaError`, `ReservaNoEncontradaError`). Los
 * imports fallan y la batería está en ROJO por AUSENCIA DE IMPLEMENTACIÓN. GREEN es de
 * `backend-developer`.
 */
import { ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import type { Request, Response, NextFunction } from 'express';
import request from 'supertest';
import { Reflector } from '@nestjs/core';
import { FinalizarEventoController } from '../interface/finalizar-evento.controller';
import {
  FinalizarEventoUseCase,
  TransicionNoPermitidaError,
  ReservaNoEncontradaError,
  type FinalizarEventoComando,
  type FinalizarEventoResultado,
} from '../application/finalizar-evento.use-case';
import { RolesGuard } from '../../shared/auth/roles.guard';
import { HttpExceptionFilter } from '../../shared/filters/http-exception.filter';
import type { UsuarioAutenticado } from '../../shared/auth/usuario-autenticado';

const TENANT = '00000000-0000-0000-0000-000000000001';
const GESTOR = '00000000-0000-0000-0000-0000000000a1';
const RESERVA_ID = 'res-evento';
const usuarioGestor: UsuarioAutenticado = { sub: GESTOR, tenantId: TENANT, rol: 'gestor' };
const usuarioSinRol: UsuarioAutenticado = {
  sub: '00000000-0000-0000-0000-0000000000f9',
  tenantId: TENANT,
  rol: 'cliente',
};

let ultimoComando: FinalizarEventoComando | null = null;
let modo: 'ok' | 'no-aplica' | 'no-encontrada' | 'conflicto' = 'ok';
let usuarioActual: UsuarioAutenticado | undefined = usuarioGestor;

const resultadoConE5 = (
  over: Partial<FinalizarEventoResultado> = {},
): FinalizarEventoResultado => ({
  reservaId: RESERVA_ID,
  estado: 'post_evento',
  // RESERVA COMPLETA re-leída post-commit que hidrata el `allOf(Reserva)` de la respuesta.
  reserva: {
    idReserva: RESERVA_ID,
    codigo: 'SLO-2026-0034',
    clienteId: '00000000-0000-0000-0000-0000000000c1',
    estado: 'post_evento',
    subEstado: null,
    canalEntrada: 'web',
    fechaEvento: new Date('2026-06-20T00:00:00.000Z'),
    duracionHoras: 8,
    tipoEvento: 'boda',
    numAdultosNinosMayores4: 80,
    numNinosMenores4: 5,
    numInvitadosFinal: 85,
    importeTotal: '3000.00',
    importeSenal: '1200.00',
    importeLiquidacion: '1800.00',
    ttlExpiracion: null,
    visitaProgramadaFecha: null,
    visitaProgramadaHora: null,
    visitaRealizada: null,
    fianzaEur: '1000.00',
    fianzaCobradaFecha: null,
    fianzaDevueltaFecha: null,
    fianzaDevueltaEur: null,
    condPartFirmadas: null,
    condPartFechaEnvio: null,
    condPartFechaFirma: null,
    preEventoStatus: 'cerrado',
    liquidacionStatus: 'cobrada',
    fianzaStatus: 'cobrada',
    posicionCola: null,
    consultaBloqueanteId: null,
    notas: null,
    fechaCreacion: new Date('2026-01-10T09:00:00.000Z'),
    cliente: {
      idCliente: '00000000-0000-0000-0000-0000000000c1',
      nombre: 'Ada',
      apellidos: 'Lovelace',
      email: 'ada@us034.test',
      telefono: null,
      dniNif: null,
      direccion: null,
      codigoPostal: null,
      poblacion: null,
      provincia: null,
      ibanDevolucion: null,
    },
  },
  e5: { resultado: 'enviado', comunicacionId: 'com-e5-1' },
  documentacionPendiente: [],
  ...over,
});

const servicioFalso = {
  ejecutar: async (comando: FinalizarEventoComando): Promise<FinalizarEventoResultado> => {
    ultimoComando = comando;
    if (modo === 'no-encontrada') throw new ReservaNoEncontradaError(comando.reservaId);
    if (modo === 'conflicto') throw new TransicionNoPermitidaError();
    if (modo === 'no-aplica')
      return resultadoConE5({ e5: { resultado: 'no_aplica', comunicacionId: null } });
    return resultadoConE5();
  },
} as unknown as FinalizarEventoUseCase;

let app: INestApplication;

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({
    controllers: [FinalizarEventoController],
    providers: [
      { provide: FinalizarEventoUseCase, useValue: servicioFalso },
      Reflector,
      RolesGuard,
    ],
  }).compile();

  app = moduleRef.createNestApplication();
  app.use((req: Request, _res: Response, next: NextFunction) => {
    // Simula el JwtAuthGuard: si no hay usuario, deja req.user undefined (→ 401/403).
    if (usuarioActual !== undefined) {
      req.user = usuarioActual;
    }
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
  modo = 'ok';
  usuarioActual = usuarioGestor;
});

// ===========================================================================
// 200 — happy path: RESERVA en post_evento + e5 + documentacionPendiente; tenant/usuario
//        del JWT (nunca del path/body).
// ===========================================================================

describe('POST /api/reservas/:id/finalizar-evento — happy path (200)', () => {
  it('debe_responder_200_con_estado_post_evento_e5_enviado_y_derivar_jwt', async () => {
    modo = 'ok';

    const res = await request(app.getHttpServer())
      .post(`/api/reservas/${RESERVA_ID}/finalizar-evento`)
      .send({});

    expect(res.status).toBe(200);
    expect(res.body.estado).toBe('post_evento');
    expect(res.body.e5).toEqual({ resultado: 'enviado', comunicacionId: 'com-e5-1' });
    expect(res.body.documentacionPendiente).toEqual([]);
    // El `allOf(Reserva)` del contrato: la RESERVA completa (hidratada post-commit) viaja PLANA
    // en el nivel superior de la respuesta (no anidada), sin el `cliente` de ReservaDetalle.
    expect(res.body.idReserva).toBe(RESERVA_ID);
    expect(res.body.codigo).toBe('SLO-2026-0034');
    expect(res.body.clienteId).toBe('00000000-0000-0000-0000-0000000000c1');
    expect(res.body.fechaEvento).toBe('2026-06-20');
    expect(res.body.fianzaEur).toBe('1000.00');
    expect(res.body.fianzaStatus).toBe('cobrada');
    expect(res.body.preEventoStatus).toBe('cerrado');
    expect(res.body.liquidacionStatus).toBe('cobrada');
    expect(res.body.fechaCreacion).toBe('2026-01-10T09:00:00.000Z');
    // `cliente` NO forma parte de `Reserva` (solo de ReservaDetalle): no debe emitirse.
    expect(res.body.cliente).toBeUndefined();
    // tenant/usuario SIEMPRE del JWT.
    expect(ultimoComando?.tenantId).toBe(TENANT);
    expect(ultimoComando?.usuarioId).toBe(GESTOR);
    expect(ultimoComando?.reservaId).toBe(RESERVA_ID);
  });

  it('debe_responder_200_con_e5_no_aplica_cuando_no_hay_fianza', async () => {
    modo = 'no-aplica';

    const res = await request(app.getHttpServer())
      .post(`/api/reservas/${RESERVA_ID}/finalizar-evento`)
      .send({});

    expect(res.status).toBe(200);
    expect(res.body.e5).toEqual({ resultado: 'no_aplica', comunicacionId: null });
  });
});

// ===========================================================================
// 409 — conflicto de estado: transicion_no_permitida (estado != evento_en_curso o carrera
//        perdida). El discriminador `code` debe ser `transicion_no_permitida` (contrato).
// ===========================================================================

describe('POST /api/reservas/:id/finalizar-evento — conflicto de estado (409)', () => {
  it('debe_responder_409_con_code_transicion_no_permitida', async () => {
    modo = 'conflicto';

    const res = await request(app.getHttpServer())
      .post(`/api/reservas/${RESERVA_ID}/finalizar-evento`)
      .send({});

    expect(res.status).toBe(409);
    expect(res.body.statusCode).toBe(409);
    expect(res.body.code).toBe('transicion_no_permitida');
  });
});

// ===========================================================================
// 404 — RESERVA inexistente / de otro tenant (RLS).
// ===========================================================================

describe('POST /api/reservas/:id/finalizar-evento — no encontrada / otro tenant (404)', () => {
  it('debe_responder_404_cuando_la_reserva_no_es_resoluble_bajo_rls', async () => {
    modo = 'no-encontrada';

    const res = await request(app.getHttpServer())
      .post(`/api/reservas/${RESERVA_ID}/finalizar-evento`)
      .send({});

    expect(res.status).toBe(404);
    expect(res.body.statusCode).toBe(404);
  });
});

// ===========================================================================
// 401 / 403 — autorización: sin JWT → 401; autenticado sin rol Gestor → 403 (contrato).
//        El caso de uso NO debe ejecutarse cuando la autorización corta.
// ===========================================================================

describe('POST /api/reservas/:id/finalizar-evento — autorización por rol Gestor (401/403)', () => {
  it('debe_responder_403_cuando_el_usuario_autenticado_no_tiene_rol_gestor', async () => {
    usuarioActual = usuarioSinRol;

    const res = await request(app.getHttpServer())
      .post(`/api/reservas/${RESERVA_ID}/finalizar-evento`)
      .send({});

    expect(res.status).toBe(403);
    expect(ultimoComando).toBeNull();
  });

  it('debe_rechazar_sin_ejecutar_el_caso_de_uso_cuando_no_hay_jwt', async () => {
    usuarioActual = undefined; // sin req.user → no autenticado.

    const res = await request(app.getHttpServer())
      .post(`/api/reservas/${RESERVA_ID}/finalizar-evento`)
      .send({});

    // Sin usuario, el guard de rol rechaza (401/403); el caso de uso no se ejecuta.
    expect([401, 403]).toContain(res.status);
    expect(ultimoComando).toBeNull();
  });
});
