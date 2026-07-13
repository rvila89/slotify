/**
 * TESTS DE INTEGRACIÓN HTTP del endpoint de DATOS FISCALES DEL CLIENTE (US-014 #5, Parte B / UC-14)
 * `PATCH /api/reservas/:id/datos-fiscales` (operationId `actualizarDatosFiscalesCliente`) —
 * fase TDD RED. tasks.md Fase 3.4.
 *
 * Trazabilidad: US-014 (#5), contrato CONGELADO `docs/api-spec.yml` op del PATCH:
 *   - 200 `ActualizarDatosFiscalesClienteResponse`: `{ dniNif, direccion, codigoPostal, poblacion,
 *     provincia }` (cada uno nullable) — estado resultante de los 5 campos fiscales del CLIENTE.
 *   - 400 body inválido (vacío `minProperties: 1`, campo `minLength: 1`, propiedad ajena
 *     `additionalProperties: false`).
 *   - 401 sin JWT; 403 autenticado sin rol Gestor.
 *   - 404 RESERVA inexistente / de otro tenant (RLS).
 *
 * Frontera HTTP REAL con supertest y el MISMO `ValidationPipe` GLOBAL + `HttpExceptionFilter`
 * que `main.ts`. El caso de uso `ActualizarDatosFiscalesClienteUseCase` se DOBLA (in-memory) para
 * no tocar Prisma: se verifica el CONTRATO del controller (mapeo body/param↔comando + traducción
 * de errores de dominio a códigos + forma de la respuesta), NO la transacción. Un middleware inyecta
 * el `req.user` que `@CurrentUser` espera; `RolesGuard` + `@Roles('gestor')` deciden 403. El
 * tenant/usuario viajan SIEMPRE del JWT, nunca del path/body (D-3/D-4).
 *
 * RED: aún NO existen `ActualizarDatosFiscalesClienteController` ni `ActualizarDatosFiscalesClienteUseCase`
 * con sus errores/DTOs. Los imports fallan y la batería está en ROJO por AUSENCIA DE
 * IMPLEMENTACIÓN. GREEN es de `backend-developer`.
 */
import { ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import type { Request, Response, NextFunction } from 'express';
import request from 'supertest';
import { Reflector } from '@nestjs/core';
import { ActualizarDatosFiscalesClienteController } from '../interface/actualizar-datos-fiscales-cliente.controller';
import {
  ActualizarDatosFiscalesClienteUseCase,
  ReservaNoEncontradaError,
  type ActualizarDatosFiscalesClienteComando,
  type ActualizarDatosFiscalesClienteResultado,
} from '../application/actualizar-datos-fiscales-cliente.use-case';
import { RolesGuard } from '../../shared/auth/roles.guard';
import { HttpExceptionFilter } from '../../shared/filters/http-exception.filter';
import type { UsuarioAutenticado } from '../../shared/auth/usuario-autenticado';

const TENANT = '00000000-0000-0000-0000-000000000001';
const GESTOR = '00000000-0000-0000-0000-0000000000a1';
const RESERVA_ID = 'res-presupuesto';

const bodyValido = {
  dniNif: '99999999R',
  direccion: 'Avenida Nueva 42',
  codigoPostal: '28080',
  poblacion: 'Madrid',
  provincia: 'Madrid',
};

const usuarioGestor: UsuarioAutenticado = { sub: GESTOR, tenantId: TENANT, rol: 'gestor' };
const usuarioSinRol: UsuarioAutenticado = {
  sub: '00000000-0000-0000-0000-0000000000f9',
  tenantId: TENANT,
  rol: 'cliente',
};

let ultimoComando: ActualizarDatosFiscalesClienteComando | null = null;
let modo: 'ok' | 'no-encontrada' = 'ok';
let usuarioActual: UsuarioAutenticado | undefined = usuarioGestor;

const resultadoOk = (
  over: Partial<ActualizarDatosFiscalesClienteResultado> = {},
): ActualizarDatosFiscalesClienteResultado => ({
  dniNif: '99999999R',
  direccion: 'Avenida Nueva 42',
  codigoPostal: '28080',
  poblacion: 'Madrid',
  provincia: 'Madrid',
  ...over,
});

const servicioFalso = {
  ejecutar: async (
    comando: ActualizarDatosFiscalesClienteComando,
  ): Promise<ActualizarDatosFiscalesClienteResultado> => {
    ultimoComando = comando;
    if (modo === 'no-encontrada') throw new ReservaNoEncontradaError(comando.reservaId);
    // El resultado refleja los campos enviados en el comando (los ausentes irían con su valor previo).
    return resultadoOk({ ...comando.datos });
  },
} as unknown as ActualizarDatosFiscalesClienteUseCase;

let app: INestApplication;

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({
    controllers: [ActualizarDatosFiscalesClienteController],
    providers: [
      { provide: ActualizarDatosFiscalesClienteUseCase, useValue: servicioFalso },
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
// 200 — happy path: datos fiscales actualizados; tenant/usuario del JWT, reserva del path.
// ===========================================================================

describe('PATCH /api/reservas/:id/datos-fiscales — happy path (200)', () => {
  it('debe_responder_200_con_los_5_campos_y_derivar_tenant_y_usuario_del_jwt', async () => {
    modo = 'ok';

    const res = await request(app.getHttpServer())
      .patch(`/api/reservas/${RESERVA_ID}/datos-fiscales`)
      .send(bodyValido);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      dniNif: '99999999R',
      direccion: 'Avenida Nueva 42',
      codigoPostal: '28080',
      poblacion: 'Madrid',
      provincia: 'Madrid',
    });
    // tenant/usuario SIEMPRE del JWT; los campos del body; la reserva del path.
    expect(ultimoComando?.tenantId).toBe(TENANT);
    expect(ultimoComando?.usuarioId).toBe(GESTOR);
    expect(ultimoComando?.reservaId).toBe(RESERVA_ID);
    expect(ultimoComando?.datos).toEqual(bodyValido);
  });

  it('debe_aceptar_un_body_parcial_con_un_solo_campo', async () => {
    modo = 'ok';

    const res = await request(app.getHttpServer())
      .patch(`/api/reservas/${RESERVA_ID}/datos-fiscales`)
      .send({ direccion: 'Avenida Nueva 42' });

    expect(res.status).toBe(200);
    // Solo el campo enviado llega al comando (PATCH parcial, D-2).
    expect(ultimoComando?.datos).toEqual({ direccion: 'Avenida Nueva 42' });
  });
});

// ===========================================================================
// 404 — RESERVA inexistente / de otro tenant (RLS).
// ===========================================================================

describe('PATCH /api/reservas/:id/datos-fiscales — no encontrada / otro tenant (404)', () => {
  it('debe_responder_404_cuando_la_reserva_no_es_resoluble_bajo_rls', async () => {
    modo = 'no-encontrada';

    const res = await request(app.getHttpServer())
      .patch(`/api/reservas/${RESERVA_ID}/datos-fiscales`)
      .send(bodyValido);

    expect(res.status).toBe(404);
    expect(res.body.statusCode).toBe(404);
  });
});

// ===========================================================================
// 400 — validación del body por el ValidationPipe (pre-filtro del contrato).
// ===========================================================================

describe('PATCH /api/reservas/:id/datos-fiscales — body inválido (400)', () => {
  it('debe_responder_400_cuando_el_body_esta_vacio_minProperties', async () => {
    const res = await request(app.getHttpServer())
      .patch(`/api/reservas/${RESERVA_ID}/datos-fiscales`)
      .send({});

    // `minProperties: 1`: hay que enviar al menos un campo fiscal.
    expect(res.status).toBe(400);
    expect(ultimoComando).toBeNull();
  });

  it('debe_responder_400_cuando_un_campo_va_vacio_minLength', async () => {
    const res = await request(app.getHttpServer())
      .patch(`/api/reservas/${RESERVA_ID}/datos-fiscales`)
      .send({ dniNif: '' });

    // `minLength: 1`: la cadena vacía no es un valor fiscal válido.
    expect(res.status).toBe(400);
    expect(ultimoComando).toBeNull();
  });

  it('debe_responder_400_cuando_se_envia_una_propiedad_no_permitida', async () => {
    const res = await request(app.getHttpServer())
      .patch(`/api/reservas/${RESERVA_ID}/datos-fiscales`)
      // `additionalProperties: false`: campos ajenos (p. ej. de la RESERVA) → 400.
      .send({ direccion: 'Avenida Nueva 42', fechaEvento: '2028-05-10' });

    expect(res.status).toBe(400);
    expect(ultimoComando).toBeNull();
  });
});

// ===========================================================================
// 401 / 403 — autorización: sin JWT → 401; autenticado sin rol Gestor → 403 (contrato).
// ===========================================================================

describe('PATCH /api/reservas/:id/datos-fiscales — autorización por rol Gestor (401/403)', () => {
  it('debe_responder_403_cuando_el_usuario_autenticado_no_tiene_rol_gestor', async () => {
    usuarioActual = usuarioSinRol;

    const res = await request(app.getHttpServer())
      .patch(`/api/reservas/${RESERVA_ID}/datos-fiscales`)
      .send(bodyValido);

    expect(res.status).toBe(403);
    expect(ultimoComando).toBeNull();
  });

  it('debe_rechazar_sin_ejecutar_el_caso_de_uso_cuando_no_hay_jwt', async () => {
    usuarioActual = undefined;

    const res = await request(app.getHttpServer())
      .patch(`/api/reservas/${RESERVA_ID}/datos-fiscales`)
      .send(bodyValido);

    expect([401, 403]).toContain(res.status);
    expect(ultimoComando).toBeNull();
  });
});
