/**
 * TESTS DE INTEGRACIÓN HTTP del endpoint de FORZADO MANUAL del inicio de evento
 * (US-032 / UC-23 FA-01) `POST /api/reservas/:id/forzar-inicio-evento` — fase TDD RED.
 * tasks.md Fase 3: 3.9.
 *
 * Trazabilidad: US-032, contrato `docs/api-spec.yml` op `forzarInicioEvento`:
 *   - 200 `ForzarInicioEventoResponse`: `allOf(Reserva)` (RESERVA en `evento_en_curso`) +
 *     `forzadoPorGestor: boolean` (siempre true) + `precondicionesIncumplidas: string[]`.
 *   - 401 sin JWT; 403 autenticado sin rol Gestor.
 *   - 404 RESERVA inexistente / de otro tenant (RLS).
 *   - 409 `code: conflicto_estado` cuando `estado != reserva_confirmada` (incl. cron llegó
 *     primero / carrera perdida bajo el lock). design.md §D-1.
 *   - 422 `code: fecha_evento_no_es_hoy` cuando `estado = reserva_confirmada` pero
 *     `fecha_evento != hoy`. design.md §D-1/§D-2.
 *
 * Frontera HTTP REAL con supertest y el MISMO `ValidationPipe` GLOBAL +
 * `HttpExceptionFilter` que `main.ts`. El caso de uso `ForzarInicioEventoUseCase` se DOBLA
 * (in-memory) para no tocar Prisma: se verifica el CONTRATO del controller (mapeo
 * comando↔HTTP + traducción de errores de dominio a códigos + forma de la respuesta), NO
 * la transacción. Un middleware inyecta el `req.user` que `@CurrentUser` espera; el
 * `RolesGuard` + `@Roles('gestor')` deciden 403. El tenant/usuario viajan SIEMPRE del JWT,
 * nunca del path/body.
 *
 * RED: aún NO existen `ForzarInicioEventoController` ni `ForzarInicioEventoUseCase` con sus
 * errores de dominio (`ConflictoEstadoError`, `FechaEventoNoEsHoyError`,
 * `ReservaNoEncontradaError`). Los imports fallan y la batería está en ROJO por AUSENCIA DE
 * IMPLEMENTACIÓN. GREEN es de `backend-developer`.
 */
import { ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import type { Request, Response, NextFunction } from 'express';
import request from 'supertest';
import { Reflector } from '@nestjs/core';
import { ForzarInicioEventoController } from '../interface/forzar-inicio-evento.controller';
import {
  ForzarInicioEventoUseCase,
  ConflictoEstadoError,
  FechaEventoNoEsHoyError,
  ReservaNoEncontradaError,
  type ForzarInicioEventoComando,
  type ForzarInicioEventoResultado,
} from '../application/forzar-inicio-evento.use-case';
import { RolesGuard } from '../../shared/auth/roles.guard';
import { HttpExceptionFilter } from '../../shared/filters/http-exception.filter';
import type { UsuarioAutenticado } from '../../shared/auth/usuario-autenticado';

const TENANT = '00000000-0000-0000-0000-000000000001';
const GESTOR = '00000000-0000-0000-0000-0000000000a1';
const RESERVA_ID = 'res-forzar';
const usuarioGestor: UsuarioAutenticado = { sub: GESTOR, tenantId: TENANT, rol: 'gestor' };
const usuarioSinRol: UsuarioAutenticado = {
  sub: '00000000-0000-0000-0000-0000000000f9',
  tenantId: TENANT,
  rol: 'cliente',
};

let ultimoComando: ForzarInicioEventoComando | null = null;
let modo: 'ok' | 'conflicto' | 'fecha' | 'no-encontrada' = 'ok';
let usuarioActual: UsuarioAutenticado | undefined = usuarioGestor;

const resultadoForzado = (
  over: Partial<ForzarInicioEventoResultado> = {},
): ForzarInicioEventoResultado => ({
  reservaId: RESERVA_ID,
  estado: 'evento_en_curso',
  forzadoPorGestor: true,
  precondicionesIncumplidas: ['liquidacion_status'],
  // RESERVA COMPLETA re-leída post-commit que hidrata el `allOf(Reserva)` de la respuesta.
  reserva: {
    idReserva: RESERVA_ID,
    codigo: 'SLO-2026-0032',
    clienteId: '00000000-0000-0000-0000-0000000000c1',
    estado: 'evento_en_curso',
    subEstado: null,
    canalEntrada: 'web',
    fechaEvento: new Date('2026-09-12T00:00:00.000Z'),
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
    liquidacionStatus: 'facturada',
    fianzaStatus: 'cobrada',
    posicionCola: null,
    consultaBloqueanteId: null,
    notas: null,
    fechaCreacion: new Date('2026-01-10T09:00:00.000Z'),
    cliente: {
      idCliente: '00000000-0000-0000-0000-0000000000c1',
      nombre: 'Ada',
      apellidos: 'Lovelace',
      email: 'ada@us032.test',
      telefono: null,
      dniNif: null,
      direccion: null,
      codigoPostal: null,
      poblacion: null,
      provincia: null,
      ibanDevolucion: null,
    },
  },
  ...over,
});

const servicioFalso = {
  ejecutar: async (
    comando: ForzarInicioEventoComando,
  ): Promise<ForzarInicioEventoResultado> => {
    ultimoComando = comando;
    if (modo === 'no-encontrada') throw new ReservaNoEncontradaError(comando.reservaId);
    if (modo === 'conflicto') throw new ConflictoEstadoError();
    if (modo === 'fecha') throw new FechaEventoNoEsHoyError();
    return resultadoForzado();
  },
} as unknown as ForzarInicioEventoUseCase;

let app: INestApplication;

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({
    controllers: [ForzarInicioEventoController],
    providers: [
      { provide: ForzarInicioEventoUseCase, useValue: servicioFalso },
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
// 200 — happy path: RESERVA en evento_en_curso (allOf plano) + forzadoPorGestor +
//        precondicionesIncumplidas; tenant/usuario del JWT (nunca del path/body).
// ===========================================================================

describe('POST /api/reservas/:id/forzar-inicio-evento — happy path (200)', () => {
  it('debe_responder_200_con_evento_en_curso_forzado_y_derivar_jwt', async () => {
    modo = 'ok';

    const res = await request(app.getHttpServer())
      .post(`/api/reservas/${RESERVA_ID}/forzar-inicio-evento`)
      .send({});

    expect(res.status).toBe(200);
    expect(res.body.estado).toBe('evento_en_curso');
    expect(res.body.forzadoPorGestor).toBe(true);
    expect(res.body.precondicionesIncumplidas).toEqual(['liquidacion_status']);
    // El `allOf(Reserva)` del contrato: la RESERVA completa viaja PLANA en el nivel superior.
    expect(res.body.idReserva).toBe(RESERVA_ID);
    expect(res.body.codigo).toBe('SLO-2026-0032');
    expect(res.body.clienteId).toBe('00000000-0000-0000-0000-0000000000c1');
    expect(res.body.fechaEvento).toBe('2026-09-12');
    expect(res.body.fechaCreacion).toBe('2026-01-10T09:00:00.000Z');
    // `cliente` NO forma parte de `Reserva` (solo de ReservaDetalle): no debe emitirse.
    expect(res.body.cliente).toBeUndefined();
    // tenant/usuario SIEMPRE del JWT.
    expect(ultimoComando?.tenantId).toBe(TENANT);
    expect(ultimoComando?.usuarioId).toBe(GESTOR);
    expect(ultimoComando?.reservaId).toBe(RESERVA_ID);
  });
});

// ===========================================================================
// 409 — conflicto de estado: estado != reserva_confirmada (incl. cron llegó primero /
//        carrera perdida). Discriminador `code = conflicto_estado` (contrato).
// ===========================================================================

describe('POST /api/reservas/:id/forzar-inicio-evento — conflicto de estado (409)', () => {
  it('debe_responder_409_con_code_conflicto_estado', async () => {
    modo = 'conflicto';

    const res = await request(app.getHttpServer())
      .post(`/api/reservas/${RESERVA_ID}/forzar-inicio-evento`)
      .send({});

    expect(res.status).toBe(409);
    expect(res.body.statusCode).toBe(409);
    expect(res.body.code).toBe('conflicto_estado');
  });
});

// ===========================================================================
// 422 — precondición de negocio: fecha_evento != hoy (con estado reserva_confirmada).
//        Discriminador `code = fecha_evento_no_es_hoy` (contrato), distinto del 409.
// ===========================================================================

describe('POST /api/reservas/:id/forzar-inicio-evento — fecha no es hoy (422)', () => {
  it('debe_responder_422_con_code_fecha_evento_no_es_hoy', async () => {
    modo = 'fecha';

    const res = await request(app.getHttpServer())
      .post(`/api/reservas/${RESERVA_ID}/forzar-inicio-evento`)
      .send({});

    expect(res.status).toBe(422);
    expect(res.body.statusCode).toBe(422);
    expect(res.body.code).toBe('fecha_evento_no_es_hoy');
  });
});

// ===========================================================================
// 404 — RESERVA inexistente / de otro tenant (RLS).
// ===========================================================================

describe('POST /api/reservas/:id/forzar-inicio-evento — no encontrada / otro tenant (404)', () => {
  it('debe_responder_404_cuando_la_reserva_no_es_resoluble_bajo_rls', async () => {
    modo = 'no-encontrada';

    const res = await request(app.getHttpServer())
      .post(`/api/reservas/${RESERVA_ID}/forzar-inicio-evento`)
      .send({});

    expect(res.status).toBe(404);
    expect(res.body.statusCode).toBe(404);
  });
});

// ===========================================================================
// 401 / 403 — autorización: sin JWT → 401; autenticado sin rol Gestor → 403 (contrato).
//        El caso de uso NO debe ejecutarse cuando la autorización corta.
// ===========================================================================

describe('POST /api/reservas/:id/forzar-inicio-evento — autorización por rol Gestor (401/403)', () => {
  it('debe_responder_403_cuando_el_usuario_autenticado_no_tiene_rol_gestor', async () => {
    usuarioActual = usuarioSinRol;

    const res = await request(app.getHttpServer())
      .post(`/api/reservas/${RESERVA_ID}/forzar-inicio-evento`)
      .send({});

    expect(res.status).toBe(403);
    expect(ultimoComando).toBeNull();
  });

  it('debe_rechazar_sin_ejecutar_el_caso_de_uso_cuando_no_hay_jwt', async () => {
    usuarioActual = undefined; // sin req.user → no autenticado.

    const res = await request(app.getHttpServer())
      .post(`/api/reservas/${RESERVA_ID}/forzar-inicio-evento`)
      .send({});

    expect([401, 403]).toContain(res.status);
    expect(ultimoComando).toBeNull();
  });
});
