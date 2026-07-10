/**
 * TESTS DE INTEGRACIÓN HTTP del endpoint de REGISTRO DE IBAN DE DEVOLUCIÓN (US-035 / UC-26
 * FA-01, UC-27) `PATCH /api/reservas/:id/iban-devolucion` — fase TDD RED. tasks.md Fase 3.
 *
 * Trazabilidad: US-035, contrato CONGELADO `docs/api-spec.yml` op del PATCH:
 *   - 200 `RegistrarIbanDevolucionResponse`: `{ iban, avisoEmail }` (avisoEmail nullable;
 *     `{ codigo:'e8_fallido', mensaje, comunicacionId }` en FA-03).
 *   - 401 sin JWT; 403 autenticado sin rol Gestor.
 *   - 404 RESERVA inexistente / de otro tenant (RLS).
 *   - 409 `RegistrarIbanDevolucionConflictError` con `code: estado_no_post_evento | sin_fianza`
 *     (FA-04).
 *   - 422 IBAN inválido por checksum mod-97 (FA-01).
 *
 * Frontera HTTP REAL con supertest y el MISMO `ValidationPipe` GLOBAL + `HttpExceptionFilter`
 * que `main.ts`. El caso de uso `RegistrarIbanDevolucionUseCase` se DOBLA (in-memory) para no
 * tocar Prisma: se verifica el CONTRATO del controller (mapeo body/param↔comando + traducción
 * de errores de dominio a códigos + forma de la respuesta), NO la transacción. Un middleware
 * inyecta el `req.user` que `@CurrentUser` espera; `RolesGuard` + `@Roles('gestor')` deciden
 * 403. El tenant/usuario viajan SIEMPRE del JWT, nunca del path/body.
 *
 * RED: aún NO existen `RegistrarIbanDevolucionController` ni `RegistrarIbanDevolucionUseCase`
 * con sus errores de dominio. Los imports fallan y la batería está en ROJO por AUSENCIA DE
 * IMPLEMENTACIÓN. GREEN es de `backend-developer`.
 */
import { ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import type { Request, Response, NextFunction } from 'express';
import request from 'supertest';
import { Reflector } from '@nestjs/core';
import { RegistrarIbanDevolucionController } from '../interface/registrar-iban-devolucion.controller';
import {
  RegistrarIbanDevolucionUseCase,
  ReservaNoEncontradaError,
  IbanInvalidoError,
  EstadoNoPostEventoError,
  SinFianzaError,
  type RegistrarIbanDevolucionComando,
  type RegistrarIbanDevolucionResultado,
} from '../application/registrar-iban-devolucion.use-case';
import { RolesGuard } from '../../shared/auth/roles.guard';
import { HttpExceptionFilter } from '../../shared/filters/http-exception.filter';
import type { UsuarioAutenticado } from '../../shared/auth/usuario-autenticado';

const TENANT = '00000000-0000-0000-0000-000000000001';
const GESTOR = '00000000-0000-0000-0000-0000000000a1';
const RESERVA_ID = 'res-post-evento';
const IBAN_VALIDO = 'ES9121000418450200051332';

const usuarioGestor: UsuarioAutenticado = { sub: GESTOR, tenantId: TENANT, rol: 'gestor' };
const usuarioSinRol: UsuarioAutenticado = {
  sub: '00000000-0000-0000-0000-0000000000f9',
  tenantId: TENANT,
  rol: 'cliente',
};

let ultimoComando: RegistrarIbanDevolucionComando | null = null;
let modo: 'ok' | 'e8-fallido' | 'iban-invalido' | 'sin-fianza' | 'no-post-evento' | 'no-encontrada' =
  'ok';
let usuarioActual: UsuarioAutenticado | undefined = usuarioGestor;

const resultadoOk = (
  over: Partial<RegistrarIbanDevolucionResultado> = {},
): RegistrarIbanDevolucionResultado => ({
  iban: IBAN_VALIDO,
  avisoEmail: null,
  ...over,
});

const servicioFalso = {
  ejecutar: async (
    comando: RegistrarIbanDevolucionComando,
  ): Promise<RegistrarIbanDevolucionResultado> => {
    ultimoComando = comando;
    if (modo === 'no-encontrada') throw new ReservaNoEncontradaError(comando.reservaId);
    if (modo === 'iban-invalido') throw new IbanInvalidoError();
    if (modo === 'sin-fianza') throw new SinFianzaError();
    if (modo === 'no-post-evento') throw new EstadoNoPostEventoError();
    if (modo === 'e8-fallido')
      return resultadoOk({
        avisoEmail: {
          codigo: 'e8_fallido',
          mensaje:
            'IBAN guardado, pero E8 no pudo enviarse. Puedes reenviarlo desde la ficha.',
          comunicacionId: '00000000-0000-0000-0000-0000000000e8',
        },
      });
    return resultadoOk();
  },
} as unknown as RegistrarIbanDevolucionUseCase;

let app: INestApplication;

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({
    controllers: [RegistrarIbanDevolucionController],
    providers: [
      { provide: RegistrarIbanDevolucionUseCase, useValue: servicioFalso },
      Reflector,
      RolesGuard,
    ],
  }).compile();

  app = moduleRef.createNestApplication();
  app.use((req: Request, _res: Response, next: NextFunction) => {
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
// 200 — happy path: IBAN registrado, avisoEmail nulo; tenant/usuario del JWT.
// ===========================================================================

describe('PATCH /api/reservas/:id/iban-devolucion — happy path (200)', () => {
  it('debe_responder_200_con_iban_normalizado_avisoEmail_nulo_y_derivar_jwt', async () => {
    modo = 'ok';

    const res = await request(app.getHttpServer())
      .patch(`/api/reservas/${RESERVA_ID}/iban-devolucion`)
      .send({ iban: IBAN_VALIDO });

    expect(res.status).toBe(200);
    expect(res.body.iban).toBe(IBAN_VALIDO);
    expect(res.body.avisoEmail).toBeNull();
    // tenant/usuario SIEMPRE del JWT; el iban del body; la reserva del path.
    expect(ultimoComando?.tenantId).toBe(TENANT);
    expect(ultimoComando?.usuarioId).toBe(GESTOR);
    expect(ultimoComando?.reservaId).toBe(RESERVA_ID);
    expect(ultimoComando?.iban).toBe(IBAN_VALIDO);
  });

  it('debe_responder_200_con_avisoEmail_presente_cuando_e8_fallo_FA03', async () => {
    modo = 'e8-fallido';

    const res = await request(app.getHttpServer())
      .patch(`/api/reservas/${RESERVA_ID}/iban-devolucion`)
      .send({ iban: IBAN_VALIDO });

    // FA-03: el IBAN queda guardado (200) pero el aviso señala el fallo de E8.
    expect(res.status).toBe(200);
    expect(res.body.iban).toBe(IBAN_VALIDO);
    expect(res.body.avisoEmail).toEqual({
      codigo: 'e8_fallido',
      mensaje:
        'IBAN guardado, pero E8 no pudo enviarse. Puedes reenviarlo desde la ficha.',
      comunicacionId: '00000000-0000-0000-0000-0000000000e8',
    });
  });
});

// ===========================================================================
// 422 — IBAN inválido (FA-01, checksum mod-97): sin efectos.
// ===========================================================================

describe('PATCH /api/reservas/:id/iban-devolucion — IBAN inválido (422)', () => {
  it('debe_responder_422_cuando_el_iban_no_supera_mod97', async () => {
    modo = 'iban-invalido';

    const res = await request(app.getHttpServer())
      .patch(`/api/reservas/${RESERVA_ID}/iban-devolucion`)
      // El pattern del contrato es laxo; este valor lo cumple pero falla mod-97 en dominio.
      .send({ iban: 'ES0000000000000000000000' });

    expect(res.status).toBe(422);
    expect(res.body.statusCode).toBe(422);
  });
});

// ===========================================================================
// 409 — conflicto de precondición (FA-04): code = sin_fianza | estado_no_post_evento.
// ===========================================================================

describe('PATCH /api/reservas/:id/iban-devolucion — conflicto de precondición (409)', () => {
  it('debe_responder_409_con_code_sin_fianza', async () => {
    modo = 'sin-fianza';

    const res = await request(app.getHttpServer())
      .patch(`/api/reservas/${RESERVA_ID}/iban-devolucion`)
      .send({ iban: IBAN_VALIDO });

    expect(res.status).toBe(409);
    expect(res.body.statusCode).toBe(409);
    expect(res.body.code).toBe('sin_fianza');
  });

  it('debe_responder_409_con_code_estado_no_post_evento', async () => {
    modo = 'no-post-evento';

    const res = await request(app.getHttpServer())
      .patch(`/api/reservas/${RESERVA_ID}/iban-devolucion`)
      .send({ iban: IBAN_VALIDO });

    expect(res.status).toBe(409);
    expect(res.body.statusCode).toBe(409);
    expect(res.body.code).toBe('estado_no_post_evento');
  });
});

// ===========================================================================
// 404 — RESERVA inexistente / de otro tenant (RLS).
// ===========================================================================

describe('PATCH /api/reservas/:id/iban-devolucion — no encontrada / otro tenant (404)', () => {
  it('debe_responder_404_cuando_la_reserva_no_es_resoluble_bajo_rls', async () => {
    modo = 'no-encontrada';

    const res = await request(app.getHttpServer())
      .patch(`/api/reservas/${RESERVA_ID}/iban-devolucion`)
      .send({ iban: IBAN_VALIDO });

    expect(res.status).toBe(404);
    expect(res.body.statusCode).toBe(404);
  });
});

// ===========================================================================
// 400 — validación del body por el ValidationPipe (pre-filtro del contrato): iban ausente.
// ===========================================================================

describe('PATCH /api/reservas/:id/iban-devolucion — body inválido (400)', () => {
  it('debe_responder_400_cuando_falta_el_iban_en_el_body', async () => {
    const res = await request(app.getHttpServer())
      .patch(`/api/reservas/${RESERVA_ID}/iban-devolucion`)
      .send({});

    expect(res.status).toBe(400);
    // El caso de uso no debe ejecutarse: la validación del DTO corta antes.
    expect(ultimoComando).toBeNull();
  });
});

// ===========================================================================
// 401 / 403 — autorización: sin JWT → 401; autenticado sin rol Gestor → 403 (contrato).
// ===========================================================================

describe('PATCH /api/reservas/:id/iban-devolucion — autorización por rol Gestor (401/403)', () => {
  it('debe_responder_403_cuando_el_usuario_autenticado_no_tiene_rol_gestor', async () => {
    usuarioActual = usuarioSinRol;

    const res = await request(app.getHttpServer())
      .patch(`/api/reservas/${RESERVA_ID}/iban-devolucion`)
      .send({ iban: IBAN_VALIDO });

    expect(res.status).toBe(403);
    expect(ultimoComando).toBeNull();
  });

  it('debe_rechazar_sin_ejecutar_el_caso_de_uso_cuando_no_hay_jwt', async () => {
    usuarioActual = undefined;

    const res = await request(app.getHttpServer())
      .patch(`/api/reservas/${RESERVA_ID}/iban-devolucion`)
      .send({ iban: IBAN_VALIDO });

    expect([401, 403]).toContain(res.status);
    expect(ultimoComando).toBeNull();
  });
});
