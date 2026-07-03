/**
 * TESTS DE INTEGRACIÓN HTTP del endpoint de PROMOCIÓN MANUAL (US-019 / UC-12 FA manual)
 * `POST /api/reservas/:id/promover` con body `PromoverManualRequest` — fase TDD RED.
 * tasks.md Fase 3: 3.2 (superficie HTTP: confirmación, mapeo de errores a códigos).
 *
 * Trazabilidad: US-019, contrato `docs/api-spec.yml` op `promoverConsultaCola` (D-1):
 *   - 200: consulta promovida (devuelve la RESERVA promovida).
 *   - 422: confirmación ausente (`confirmado` != true) O consulta ya no en cola (FA-05).
 *   - 409: carrera perdida ("La cola ya fue actualizada automáticamente, por favor
 *     recarga la vista") O inconsistencia de bloqueo (sin FECHA_BLOQUEADA activa).
 *   - 404: reserva `{id}` inexistente o de otro tenant (RLS).
 * design.md §D-1 (confirmación explícita, defensa en servidor), §D-4 (409 carrera),
 * §D-7 (tenant/usuario SIEMPRE del JWT, nunca del path/body).
 *
 * Frontera HTTP REAL con supertest y el MISMO `ValidationPipe` GLOBAL +
 * `HttpExceptionFilter` que `main.ts`. El caso de uso `PromoverManualEnColaService` se
 * DOBLA (in-memory) para no tocar Prisma: se verifica el CONTRATO del controller
 * (mapeo comando↔HTTP + traducción de errores de dominio a códigos), NO la transacción.
 * Un middleware inyecta el `req.user` que `@CurrentUser` espera (no se prueba auth aquí).
 *
 * RED: aún NO existen `PromoverManualController`, el DTO `PromoverManualRequestDto`, ni
 * `PromoverManualEnColaService` con sus errores de dominio. Los imports fallan y la
 * batería está en ROJO por AUSENCIA DE IMPLEMENTACIÓN. GREEN es de `backend-developer`.
 */
import { ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import type { Request, Response, NextFunction } from 'express';
import request from 'supertest';
import { Reflector } from '@nestjs/core';
import { PromoverManualController } from '../interface/promover-manual.controller';
import {
  PromoverManualEnColaService,
  PromocionManualConsultaNoEnColaError,
  PromocionManualReservaNoEncontradaError,
  PromocionManualSinBloqueoError,
  PromocionManualCarreraPerdidaError,
  type PromoverManualComando,
  type ResultadoPromocionManual,
} from '../application/promover-manual-en-cola.service';
import { RolesGuard } from '../../shared/auth/roles.guard';
import { HttpExceptionFilter } from '../../shared/filters/http-exception.filter';
import type { UsuarioAutenticado } from '../../shared/auth/usuario-autenticado';

const TENANT = '00000000-0000-0000-0000-000000000001';
const GESTOR = '00000000-0000-0000-0000-0000000000a1';
const RESERVA_ID = 'R3';
const usuarioGestor: UsuarioAutenticado = { sub: GESTOR, tenantId: TENANT, rol: 'gestor' };
// Autenticado del mismo tenant pero SIN rol Gestor: la promoción manual le está vetada.
const usuarioSinRol: UsuarioAutenticado = {
  sub: '00000000-0000-0000-0000-0000000000f9',
  tenantId: TENANT,
  rol: 'cliente',
};

const MSG_CARRERA =
  'La cola ya fue actualizada automáticamente, por favor recarga la vista';
const MSG_NO_EN_COLA = 'La consulta seleccionada ya no está en cola';
const MSG_NO_ENCONTRADA = 'La reserva indicada no existe';

// Registra el último comando recibido para verificar que tenant/usuario vienen del JWT.
let ultimoComando: PromoverManualComando | null = null;
let modo: 'ok' | 'no-en-cola' | 'no-encontrada' | 'sin-bloqueo' | 'carrera' = 'ok';
// Usuario que el middleware inyecta como `req.user` (mutable por test para probar el rol).
let usuarioActual: UsuarioAutenticado = usuarioGestor;

const resultadoOk: ResultadoPromocionManual = {
  reservaPromovidaId: RESERVA_ID,
  bloqueanteExpiradaId: 'R1',
  fechaReAsignada: true,
  reordenadas: 1,
  auditadas: 3,
};

const servicioFalso = {
  ejecutar: async (comando: PromoverManualComando): Promise<ResultadoPromocionManual> => {
    ultimoComando = comando;
    if (modo === 'no-en-cola') throw new PromocionManualConsultaNoEnColaError(MSG_NO_EN_COLA);
    if (modo === 'no-encontrada')
      throw new PromocionManualReservaNoEncontradaError(MSG_NO_ENCONTRADA);
    if (modo === 'sin-bloqueo')
      throw new PromocionManualSinBloqueoError('No existe FECHA_BLOQUEADA activa para la fecha');
    if (modo === 'carrera') throw new PromocionManualCarreraPerdidaError(MSG_CARRERA);
    return resultadoOk;
  },
} as unknown as PromoverManualEnColaService;

let app: INestApplication;

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({
    controllers: [PromoverManualController],
    providers: [
      { provide: PromoverManualEnColaService, useValue: servicioFalso },
      // `RolesGuard` (declarado en el controller vía @UseGuards) necesita el Reflector
      // para leer la metadata de `@Roles`. Se registra explícitamente en el test module.
      Reflector,
      RolesGuard,
    ],
  }).compile();

  app = moduleRef.createNestApplication();
  app.use((req: Request, _res: Response, next: NextFunction) => {
    req.user = usuarioActual;
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

describe('POST /api/reservas/:id/promover — promoción manual (US-019, D-1/D-4/D-7)', () => {
  it('debe_responder_200_y_derivar_tenant_y_usuario_del_jwt_en_el_happy_path', async () => {
    modo = 'ok';

    const res = await request(app.getHttpServer())
      .post(`/api/reservas/${RESERVA_ID}/promover`)
      .send({ confirmado: true });

    expect(res.status).toBe(200);
    // El controller propaga SIEMPRE tenant/usuario del JWT (D-7), nunca del path/body.
    expect(ultimoComando?.tenantId).toBe(TENANT);
    expect(ultimoComando?.usuarioId).toBe(GESTOR);
    expect(ultimoComando?.reservaId).toBe(RESERVA_ID);
    expect(ultimoComando?.confirmado).toBe(true);
  });

  it('debe_responder_422_cuando_falta_confirmado_true', async () => {
    modo = 'ok';

    const res = await request(app.getHttpServer())
      .post(`/api/reservas/${RESERVA_ID}/promover`)
      .send({ confirmado: false });

    // Confirmación ausente/false → 422 sin efectos (contrato op promoverConsultaCola).
    expect(res.status).toBe(422);
    expect(res.body.statusCode).toBe(422);
  });

  it('debe_responder_422_cuando_la_consulta_ya_no_esta_en_cola_FA05', async () => {
    modo = 'no-en-cola';

    const res = await request(app.getHttpServer())
      .post(`/api/reservas/${RESERVA_ID}/promover`)
      .send({ confirmado: true });

    // FA-05 (existe pero YA NO en 2.d): guarda de negocio → 422, NUNCA 404.
    expect(res.status).toBe(422);
    const mensajes = Array.isArray(res.body.message) ? res.body.message : [res.body.message];
    expect(mensajes).toContain(MSG_NO_EN_COLA);
  });

  // H-1 (code-review US-019): la reserva inexistente / de otro tenant NO es resoluble
  // bajo RLS → 404 (no 422). Hoy la ausencia se mapea a `PromocionManualConsultaNoEnColaError`
  // → 422, así que este caso está en ROJO hasta que exista el error de dominio propio y su
  // mapeo a NotFoundException.
  //   contrato op `promoverConsultaCola`: 404 "Reserva {id} inexistente o de otro tenant (RLS)".
  it('debe_responder_404_cuando_la_reserva_no_es_resoluble_bajo_rls', async () => {
    modo = 'no-encontrada';

    const res = await request(app.getHttpServer())
      .post(`/api/reservas/${RESERVA_ID}/promover`)
      .send({ confirmado: true });

    expect(res.status).toBe(404);
    expect(res.body.statusCode).toBe(404);
  });

  it('debe_responder_409_cuando_pierde_la_carrera_con_el_mensaje_de_recarga', async () => {
    modo = 'carrera';

    const res = await request(app.getHttpServer())
      .post(`/api/reservas/${RESERVA_ID}/promover`)
      .send({ confirmado: true });

    expect(res.status).toBe(409);
    const mensajes = Array.isArray(res.body.message) ? res.body.message : [res.body.message];
    expect(mensajes).toContain(MSG_CARRERA);
  });

  it('debe_responder_409_cuando_no_existe_bloqueo_activo_para_la_fecha', async () => {
    modo = 'sin-bloqueo';

    const res = await request(app.getHttpServer())
      .post(`/api/reservas/${RESERVA_ID}/promover`)
      .send({ confirmado: true });

    // Inconsistencia de bloqueo → 409 (contrato op promoverConsultaCola).
    expect(res.status).toBe(409);
    expect(res.body.statusCode).toBe(409);
  });
});

// ===========================================================================
// Fix 2 (code-review US-019) — AUTORIZACIÓN por rol Gestor (contrato: 403 para
// autenticado sin rol suficiente). El controller debe declarar `RolesGuard` + `@Roles`
// para la promoción manual. Hoy solo tiene `JwtAuthGuard` global (sin RolesGuard), así
// que un autenticado sin rol Gestor PASA y recibe 200 → este bloque está en ROJO hasta
// que se aplique la autorización por rol.
//   contrato op `promoverConsultaCola`: 403 "Autenticado pero sin rol Gestor del tenant".
// ===========================================================================

describe('POST /api/reservas/:id/promover — autorización por rol Gestor (403)', () => {
  it('debe_responder_403_cuando_el_usuario_autenticado_no_tiene_rol_gestor', async () => {
    modo = 'ok';
    usuarioActual = usuarioSinRol; // mismo tenant, rol distinto de Gestor.

    const res = await request(app.getHttpServer())
      .post(`/api/reservas/${RESERVA_ID}/promover`)
      .send({ confirmado: true });

    expect(res.status).toBe(403);
    expect(res.body.statusCode).toBe(403);
    // El servicio NO debe ejecutarse: la autorización corta antes del caso de uso.
    expect(ultimoComando).toBeNull();
  });

  it('debe_permitir_al_gestor_valido_y_seguir_respondiendo_200', async () => {
    modo = 'ok';
    usuarioActual = usuarioGestor;

    const res = await request(app.getHttpServer())
      .post(`/api/reservas/${RESERVA_ID}/promover`)
      .send({ confirmado: true });

    // El happy path del Gestor no se rompe al introducir el RolesGuard.
    expect(res.status).toBe(200);
    expect(ultimoComando?.usuarioId).toBe(GESTOR);
  });
});
