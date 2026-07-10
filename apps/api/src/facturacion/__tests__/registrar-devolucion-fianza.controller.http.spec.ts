/**
 * TESTS DE INTEGRACIÓN HTTP del endpoint de REGISTRO DE DEVOLUCIÓN DE FIANZA (US-036 / UC-27 pasos
 * 4-8) `POST /api/reservas/:id/fianza/devolucion` — fase TDD RED. tasks.md Fase 3: 3.5/3.6/3.7/3.8/
 * 3.9 (frontera HTTP). Calcado del patrón de `registrar-iban-devolucion.controller.http.spec.ts`
 * (US-035): controller dedicado + ValidationPipe global + HttpExceptionFilter + RolesGuard.
 *
 * Trazabilidad: contrato CONGELADO `docs/api-spec.yml` op `registrarDevolucionFianza`:
 *   - 200 `RegistrarDevolucionFianzaResponse`: `{ reserva, documentoJustificante?, avisoSinJustificante }`.
 *   - 400 `DevolucionFianzaError`: `IMPORTE_SUPERA_FIANZA` (FA-02), `FECHA_DEVOLUCION_INVALIDA`
 *     (FA-03), `MOTIVO_RETENCION_REQUERIDO` (parcial sin motivo).
 *   - 401 sin JWT; 403 autenticado sin rol Gestor.
 *   - 404 `DevolucionFianzaError`: RESERVA de otro tenant (RLS) o `JUSTIFICANTE_NO_ENCONTRADO`.
 *   - 409 `DevolucionFianzaError`: `PRECONDICION_NO_CUMPLIDA` / `DEVOLUCION_YA_REGISTRADA`.
 *
 * Frontera HTTP REAL con supertest y el MISMO `ValidationPipe` GLOBAL + `HttpExceptionFilter` que
 * `main.ts`. El caso de uso `RegistrarDevolucionFianzaUseCase` se DOBLA (in-memory) para no tocar
 * Prisma: se verifica el CONTRATO del controller (mapeo body/param↔comando + traducción de errores
 * de dominio a códigos HTTP + forma de la respuesta), NO la transacción. Un middleware inyecta el
 * `req.user` que `@CurrentUser` espera; `RolesGuard` + `@Roles('gestor')` deciden 403. El
 * tenant/usuario viajan SIEMPRE del JWT, nunca del path/body.
 *
 * RED: aún NO existen `RegistrarDevolucionFianzaController` ni el use-case con sus errores de
 * dominio. Los imports fallan y la batería está en ROJO por AUSENCIA DE IMPLEMENTACIÓN. GREEN es de
 * `backend-developer`.
 */
import { ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import type { Request, Response, NextFunction } from 'express';
import request from 'supertest';
import { Reflector } from '@nestjs/core';
import { RegistrarDevolucionFianzaController } from '../interface/registrar-devolucion-fianza.controller';
import {
  RegistrarDevolucionFianzaUseCase,
  ImporteSuperaFianzaError,
  FechaDevolucionInvalidaError,
  MotivoRetencionRequeridoError,
  PrecondicionNoCumplidaError,
  DevolucionYaRegistradaError,
  ReservaDevolucionNoEncontradaError,
  JustificanteNoEncontradoError,
  type RegistrarDevolucionFianzaComando,
  type RegistrarDevolucionFianzaResultado,
} from '../application/registrar-devolucion-fianza.use-case';
import { RolesGuard } from '../../shared/auth/roles.guard';
import { HttpExceptionFilter } from '../../shared/filters/http-exception.filter';
import type { UsuarioAutenticado } from '../../shared/auth/usuario-autenticado';

const TENANT = '00000000-0000-0000-0000-000000000001';
const GESTOR = '00000000-0000-0000-0000-0000000000a1';
const RESERVA_ID = 'res-post-evento-36';
const DOC_JUSTIF_ID = '11111111-1111-1111-1111-111111111111';

const usuarioGestor: UsuarioAutenticado = { sub: GESTOR, tenantId: TENANT, rol: 'gestor' };
const usuarioSinRol: UsuarioAutenticado = {
  sub: '00000000-0000-0000-0000-0000000000f9',
  tenantId: TENANT,
  rol: 'cliente',
};

let ultimoComando: RegistrarDevolucionFianzaComando | null = null;
let modo:
  | 'ok'
  | 'sin-justificante'
  | 'importe-supera'
  | 'fecha-invalida'
  | 'motivo-requerido'
  | 'precondicion'
  | 'ya-registrada'
  | 'justificante-no-encontrado'
  | 'no-encontrada' = 'ok';
let usuarioActual: UsuarioAutenticado | undefined = usuarioGestor;

const resultadoOk = (
  over: Partial<RegistrarDevolucionFianzaResultado> = {},
): RegistrarDevolucionFianzaResultado => ({
  reserva: {
    idReserva: RESERVA_ID,
    fianzaStatus: 'devuelta',
    fianzaDevueltaEur: '1000.00',
    fianzaDevueltaFecha: '2026-06-05',
    motivoRetencion: null,
  },
  documentoJustificante: {
    idDocumento: DOC_JUSTIF_ID,
    tipo: 'justificante_pago',
    mimeType: 'application/pdf',
    url: 'https://storage.local/justificantes/devolucion.pdf',
  },
  avisoSinJustificante: false,
  ...over,
});

const servicioFalso = {
  ejecutar: async (
    comando: RegistrarDevolucionFianzaComando,
  ): Promise<RegistrarDevolucionFianzaResultado> => {
    ultimoComando = comando;
    if (modo === 'no-encontrada') throw new ReservaDevolucionNoEncontradaError(comando.reservaId);
    if (modo === 'justificante-no-encontrado') throw new JustificanteNoEncontradoError();
    if (modo === 'importe-supera') throw new ImporteSuperaFianzaError();
    if (modo === 'fecha-invalida') throw new FechaDevolucionInvalidaError();
    if (modo === 'motivo-requerido') throw new MotivoRetencionRequeridoError();
    if (modo === 'precondicion') throw new PrecondicionNoCumplidaError();
    if (modo === 'ya-registrada') throw new DevolucionYaRegistradaError();
    if (modo === 'sin-justificante')
      return resultadoOk({ documentoJustificante: null, avisoSinJustificante: true });
    return resultadoOk();
  },
} as unknown as RegistrarDevolucionFianzaUseCase;

let app: INestApplication;

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({
    controllers: [RegistrarDevolucionFianzaController],
    providers: [
      { provide: RegistrarDevolucionFianzaUseCase, useValue: servicioFalso },
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

const ruta = `/api/reservas/${RESERVA_ID}/fianza/devolucion`;
const bodyValido = {
  importeDevuelto: '1000.00',
  fechaCobro: '2026-06-05',
  justificanteDocId: DOC_JUSTIF_ID,
};

// ===========================================================================
// 200 — happy path: devolución registrada; tenant/usuario del JWT.
// ===========================================================================

describe('POST /api/reservas/:id/fianza/devolucion — happy path (200)', () => {
  it('debe_responder_200_con_reserva_devuelta_avisoSinJustificante_false_y_derivar_jwt', async () => {
    modo = 'ok';

    const res = await request(app.getHttpServer()).post(ruta).send(bodyValido);

    expect(res.status).toBe(200);
    expect(res.body.reserva.fianzaStatus).toBe('devuelta');
    expect(res.body.avisoSinJustificante).toBe(false);
    // tenant/usuario SIEMPRE del JWT; los campos del body; la reserva del path.
    expect(ultimoComando?.tenantId).toBe(TENANT);
    expect(ultimoComando?.usuarioId).toBe(GESTOR);
    expect(ultimoComando?.reservaId).toBe(RESERVA_ID);
    expect(ultimoComando?.importeDevuelto).toBe('1000.00');
    expect(ultimoComando?.fechaCobro).toBe('2026-06-05');
    expect(ultimoComando?.justificanteDocId).toBe(DOC_JUSTIF_ID);
  });

  it('debe_responder_200_con_avisoSinJustificante_true_cuando_se_registra_sin_justificante_FA04', async () => {
    modo = 'sin-justificante';

    const res = await request(app.getHttpServer())
      .post(ruta)
      .send({ importeDevuelto: '1000.00', fechaCobro: '2026-06-05' });

    expect(res.status).toBe(200);
    expect(res.body.avisoSinJustificante).toBe(true);
    expect(res.body.documentoJustificante == null).toBe(true);
  });
});

// ===========================================================================
// 400 — validación de dominio (FA-02 / FA-03 / motivo requerido): con codigo.
// ===========================================================================

describe('POST /api/reservas/:id/fianza/devolucion — validación de dominio (400)', () => {
  it('debe_responder_400_IMPORTE_SUPERA_FIANZA_FA02', async () => {
    modo = 'importe-supera';

    const res = await request(app.getHttpServer())
      .post(ruta)
      .send({ importeDevuelto: '1500.00', fechaCobro: '2026-06-05' });

    expect(res.status).toBe(400);
    expect(res.body.statusCode).toBe(400);
    expect(res.body.codigo).toBe('IMPORTE_SUPERA_FIANZA');
  });

  it('debe_responder_400_FECHA_DEVOLUCION_INVALIDA_FA03', async () => {
    modo = 'fecha-invalida';

    const res = await request(app.getHttpServer())
      .post(ruta)
      .send({ importeDevuelto: '1000.00', fechaCobro: '2026-05-10' });

    expect(res.status).toBe(400);
    expect(res.body.codigo).toBe('FECHA_DEVOLUCION_INVALIDA');
  });

  it('debe_responder_400_MOTIVO_RETENCION_REQUERIDO_en_parcial_sin_motivo', async () => {
    modo = 'motivo-requerido';

    const res = await request(app.getHttpServer())
      .post(ruta)
      .send({ importeDevuelto: '500.00', fechaCobro: '2026-06-05' });

    expect(res.status).toBe(400);
    expect(res.body.codigo).toBe('MOTIVO_RETENCION_REQUERIDO');
  });
});

// ===========================================================================
// 404 — reserva de otro tenant (RLS) / justificante inexistente.
// ===========================================================================

describe('POST /api/reservas/:id/fianza/devolucion — no encontrada (404)', () => {
  it('debe_responder_404_cuando_la_reserva_no_es_resoluble_bajo_rls', async () => {
    modo = 'no-encontrada';

    const res = await request(app.getHttpServer()).post(ruta).send(bodyValido);

    expect(res.status).toBe(404);
    expect(res.body.statusCode).toBe(404);
  });

  it('debe_responder_404_JUSTIFICANTE_NO_ENCONTRADO_cuando_el_doc_no_existe_en_el_tenant', async () => {
    modo = 'justificante-no-encontrado';

    const res = await request(app.getHttpServer()).post(ruta).send(bodyValido);

    expect(res.status).toBe(404);
    expect(res.body.codigo).toBe('JUSTIFICANTE_NO_ENCONTRADO');
  });
});

// ===========================================================================
// 409 — conflicto de precondición / doble registro (irreversible).
// ===========================================================================

describe('POST /api/reservas/:id/fianza/devolucion — conflicto de estado (409)', () => {
  it('debe_responder_409_PRECONDICION_NO_CUMPLIDA', async () => {
    modo = 'precondicion';

    const res = await request(app.getHttpServer()).post(ruta).send(bodyValido);

    expect(res.status).toBe(409);
    expect(res.body.statusCode).toBe(409);
    expect(res.body.codigo).toBe('PRECONDICION_NO_CUMPLIDA');
  });

  it('debe_responder_409_DEVOLUCION_YA_REGISTRADA_en_el_doble_registro', async () => {
    modo = 'ya-registrada';

    const res = await request(app.getHttpServer()).post(ruta).send(bodyValido);

    expect(res.status).toBe(409);
    expect(res.body.codigo).toBe('DEVOLUCION_YA_REGISTRADA');
  });
});

// ===========================================================================
// 400 — validación del body por el ValidationPipe (pre-filtro del contrato).
// ===========================================================================

describe('POST /api/reservas/:id/fianza/devolucion — body inválido (400)', () => {
  it('debe_responder_400_cuando_falta_importeDevuelto_o_fechaCobro', async () => {
    const res = await request(app.getHttpServer()).post(ruta).send({});

    expect(res.status).toBe(400);
    // El caso de uso no debe ejecutarse: la validación del DTO corta antes.
    expect(ultimoComando).toBeNull();
  });

  it('debe_responder_400_cuando_importeDevuelto_no_es_decimal_de_2_posiciones', async () => {
    const res = await request(app.getHttpServer())
      .post(ruta)
      .send({ importeDevuelto: '1000', fechaCobro: '2026-06-05' });

    expect(res.status).toBe(400);
    expect(ultimoComando).toBeNull();
  });
});

// ===========================================================================
// 401 / 403 — autorización: sin JWT → 401; autenticado sin rol Gestor → 403.
// ===========================================================================

describe('POST /api/reservas/:id/fianza/devolucion — autorización por rol Gestor (401/403)', () => {
  it('debe_responder_403_cuando_el_usuario_autenticado_no_tiene_rol_gestor', async () => {
    usuarioActual = usuarioSinRol;

    const res = await request(app.getHttpServer()).post(ruta).send(bodyValido);

    expect(res.status).toBe(403);
    expect(ultimoComando).toBeNull();
  });

  it('debe_rechazar_sin_ejecutar_el_caso_de_uso_cuando_no_hay_jwt', async () => {
    usuarioActual = undefined;

    const res = await request(app.getHttpServer()).post(ruta).send(bodyValido);

    expect([401, 403]).toContain(res.status);
    expect(ultimoComando).toBeNull();
  });
});
