/**
 * TESTS DE INTEGRACIÓN HTTP del endpoint de ARCHIVADO MANUAL del gestor (US-038 / UC-28
 * flujo alternativo manual) `POST /api/reservas/:id/archivar` — fase TDD RED. tasks.md Fase
 * 4: 4.8.
 *
 * Trazabilidad: US-038, contrato `docs/api-spec.yml` op `archivarReservaManual` (calcado de
 * `finalizarEvento`, US-034; task 2.1/2.2), gate D-3=3.B:
 *   - 200 con la RESERVA archivada (patrón `allOf(Reserva)`, como `finalizarEvento`).
 *   - 401 sin JWT; 403 autenticado sin rol Gestor.
 *   - 404 RESERVA inexistente / de otro tenant (RLS).
 *   - 409 `code: transicion_no_permitida` cuando `estado != post_evento` (o carrera perdida).
 *   - 422 `code: fianza_no_resuelta` cuando la fianza no está resuelta (D-3=3.B: precondición
 *     de negocio, distinta del conflicto de estado 409).
 *
 * Frontera HTTP REAL con supertest y el MISMO `ValidationPipe` GLOBAL + `HttpExceptionFilter`
 * que `main.ts`. El caso de uso `ArchivarReservaManualUseCase` se DOBLA (in-memory) para no
 * tocar Prisma: se verifica el CONTRATO del controller (mapeo comando↔HTTP + traducción de
 * errores de dominio a códigos + forma de la respuesta), NO la transacción. Un middleware
 * inyecta el `req.user` que `@CurrentUser` espera; el `RolesGuard` + `@Roles('gestor')`
 * deciden 403. El tenant/usuario viajan SIEMPRE del JWT, nunca del path/body.
 *
 * RED: aún NO existen `ArchivarReservaManualController` ni `ArchivarReservaManualUseCase` con
 * sus errores de dominio (`TransicionNoPermitidaError`, `FianzaNoResueltaError`,
 * `ReservaNoEncontradaError`). Los imports fallan y la batería está en ROJO por AUSENCIA DE
 * IMPLEMENTACIÓN. GREEN es de `backend-developer`.
 */
import { ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import type { Request, Response, NextFunction } from 'express';
import request from 'supertest';
import { Reflector } from '@nestjs/core';
import { ArchivarReservaManualController } from '../interface/archivar-reserva-manual.controller';
import {
  ArchivarReservaManualUseCase,
  TransicionNoPermitidaError,
  FianzaNoResueltaError,
  ReservaNoEncontradaError,
  type ArchivarReservaManualComando,
  type ArchivarReservaManualResultado,
} from '../application/archivar-reserva-manual.use-case';
import { RolesGuard } from '../../shared/auth/roles.guard';
import { HttpExceptionFilter } from '../../shared/filters/http-exception.filter';
import type { UsuarioAutenticado } from '../../shared/auth/usuario-autenticado';

const TENANT = '00000000-0000-0000-0000-000000000001';
const GESTOR = '00000000-0000-0000-0000-0000000000a1';
const RESERVA_ID = 'res-archivar';
const usuarioGestor: UsuarioAutenticado = { sub: GESTOR, tenantId: TENANT, rol: 'gestor' };
const usuarioSinRol: UsuarioAutenticado = {
  sub: '00000000-0000-0000-0000-0000000000f9',
  tenantId: TENANT,
  rol: 'cliente',
};

let ultimoComando: ArchivarReservaManualComando | null = null;
let modo: 'ok' | 'no-encontrada' | 'conflicto' | 'fianza' = 'ok';
let usuarioActual: UsuarioAutenticado | undefined = usuarioGestor;

const resultadoArchivada = (
  over: Partial<ArchivarReservaManualResultado> = {},
): ArchivarReservaManualResultado => ({
  reservaId: RESERVA_ID,
  estado: 'reserva_completada',
  // RESERVA COMPLETA re-leída post-commit que hidrata el `allOf(Reserva)` de la respuesta.
  reserva: {
    idReserva: RESERVA_ID,
    codigo: 'SLO-2026-0038',
    clienteId: '00000000-0000-0000-0000-0000000000c1',
    estado: 'reserva_completada',
    subEstado: null,
    canalEntrada: 'email',
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
    fianzaEur: '300.00',
    fianzaCobradaFecha: null,
    fianzaDevueltaFecha: null,
    fianzaDevueltaEur: '300.00',
    condPartFirmadas: null,
    condPartFechaEnvio: null,
    condPartFechaFirma: null,
    preEventoStatus: 'cerrado',
    liquidacionStatus: 'cobrada',
    fianzaStatus: 'devuelta',
    posicionCola: null,
    consultaBloqueanteId: null,
    notas: null,
    comentarios: null,
    fechaCreacion: new Date('2026-01-10T09:00:00.000Z'),
    cliente: {
      idCliente: '00000000-0000-0000-0000-0000000000c1',
      nombre: 'Ada',
      apellidos: 'Lovelace',
      email: 'ada@us038.test',
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
    comando: ArchivarReservaManualComando,
  ): Promise<ArchivarReservaManualResultado> => {
    ultimoComando = comando;
    if (modo === 'no-encontrada') throw new ReservaNoEncontradaError(comando.reservaId);
    if (modo === 'conflicto') throw new TransicionNoPermitidaError();
    if (modo === 'fianza') throw new FianzaNoResueltaError();
    return resultadoArchivada();
  },
} as unknown as ArchivarReservaManualUseCase;

let app: INestApplication;

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({
    controllers: [ArchivarReservaManualController],
    providers: [
      { provide: ArchivarReservaManualUseCase, useValue: servicioFalso },
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
// 200 — happy path: RESERVA en reserva_completada; tenant/usuario del JWT (nunca del
//        path/body). El `allOf(Reserva)` viaja PLANO en el nivel superior.
// ===========================================================================

describe('POST /api/reservas/:id/archivar — happy path (200)', () => {
  it('debe_responder_200_con_estado_reserva_completada_y_derivar_jwt', async () => {
    modo = 'ok';

    const res = await request(app.getHttpServer())
      .post(`/api/reservas/${RESERVA_ID}/archivar`)
      .send({});

    expect(res.status).toBe(200);
    expect(res.body.estado).toBe('reserva_completada');
    // El `allOf(Reserva)` del contrato: la RESERVA completa viaja PLANA (sin el `cliente`).
    expect(res.body.idReserva).toBe(RESERVA_ID);
    expect(res.body.codigo).toBe('SLO-2026-0038');
    expect(res.body.clienteId).toBe('00000000-0000-0000-0000-0000000000c1');
    expect(res.body.fechaEvento).toBe('2026-06-20');
    expect(res.body.fianzaEur).toBe('300.00');
    expect(res.body.fianzaStatus).toBe('devuelta');
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
// 409 — conflicto de estado: transicion_no_permitida (estado != post_evento o carrera
//        perdida). El discriminador `code` debe ser `transicion_no_permitida` (contrato).
// ===========================================================================

describe('POST /api/reservas/:id/archivar — conflicto de estado (409)', () => {
  it('debe_responder_409_con_code_transicion_no_permitida', async () => {
    modo = 'conflicto';

    const res = await request(app.getHttpServer())
      .post(`/api/reservas/${RESERVA_ID}/archivar`)
      .send({});

    expect(res.status).toBe(409);
    expect(res.body.statusCode).toBe(409);
    expect(res.body.code).toBe('transicion_no_permitida');
  });
});

// ===========================================================================
// 422 — bloqueo por fianza no resuelta (D-3=3.B): precondición de negocio incumplida,
//        DISTINTA del conflicto de estado 409. `code: fianza_no_resuelta` + mensaje FA-01.
// ===========================================================================

describe('POST /api/reservas/:id/archivar — fianza no resuelta (422)', () => {
  it('debe_responder_422_con_code_fianza_no_resuelta_y_mensaje_de_FA_01', async () => {
    modo = 'fianza';

    const res = await request(app.getHttpServer())
      .post(`/api/reservas/${RESERVA_ID}/archivar`)
      .send({});

    expect(res.status).toBe(422);
    expect(res.body.statusCode).toBe(422);
    expect(res.body.code).toBe('fianza_no_resuelta');
    expect(res.body.message).toContain('la fianza está pendiente de resolución');
  });
});

// ===========================================================================
// 404 — RESERVA inexistente / de otro tenant (RLS).
// ===========================================================================

describe('POST /api/reservas/:id/archivar — no encontrada / otro tenant (404)', () => {
  it('debe_responder_404_cuando_la_reserva_no_es_resoluble_bajo_rls', async () => {
    modo = 'no-encontrada';

    const res = await request(app.getHttpServer())
      .post(`/api/reservas/${RESERVA_ID}/archivar`)
      .send({});

    expect(res.status).toBe(404);
    expect(res.body.statusCode).toBe(404);
  });
});

// ===========================================================================
// 401 / 403 — autorización: sin JWT → 401; autenticado sin rol Gestor → 403 (contrato).
//        El caso de uso NO debe ejecutarse cuando la autorización corta.
// ===========================================================================

describe('POST /api/reservas/:id/archivar — autorización por rol Gestor (401/403)', () => {
  it('debe_responder_403_cuando_el_usuario_autenticado_no_tiene_rol_gestor', async () => {
    usuarioActual = usuarioSinRol;

    const res = await request(app.getHttpServer())
      .post(`/api/reservas/${RESERVA_ID}/archivar`)
      .send({});

    expect(res.status).toBe(403);
    expect(ultimoComando).toBeNull();
  });

  it('debe_rechazar_sin_ejecutar_el_caso_de_uso_cuando_no_hay_jwt', async () => {
    usuarioActual = undefined; // sin req.user → no autenticado.

    const res = await request(app.getHttpServer())
      .post(`/api/reservas/${RESERVA_ID}/archivar`)
      .send({});

    // Sin usuario, el guard de rol rechaza (401/403); el caso de uso no se ejecuta.
    expect([401, 403]).toContain(res.status);
    expect(ultimoComando).toBeNull();
  });
});
