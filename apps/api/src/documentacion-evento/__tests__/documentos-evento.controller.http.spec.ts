/**
 * TESTS DE INTEGRACIÓN HTTP de los endpoints de DOCUMENTACIÓN DEL EVENTO (US-033 / UC-24)
 * — fase TDD RED. tasks.md Fase 3: 3.2/3.4 (frontera HTTP).
 *
 * Trazabilidad: US-033; contrato CONGELADO `docs/api-spec.yml`:
 *   - `POST /reservas/{id}/documentos-evento` (multipart: `archivo` binario + `tipo`)
 *     → 201 `SubirDocumentoEventoResponse { documento, checklist }`; 404 reserva/
 *     cross-tenant; 422 (ESTADO_NO_PERMITE_DOCUMENTACION, TIPO_DOCUMENTO_NO_PERMITIDO,
 *     ARCHIVO_REQUERIDO, FORMATO_NO_PERMITIDO, ARCHIVO_INVALIDO, TAMANO_EXCEDIDO).
 *   - `GET /reservas/{id}/documentos-evento/checklist` → 200
 *     `ChecklistDocumentacionEvento { items: [{ tipo, completado, documento? }] }`.
 *   - 401 sin JWT; 403 autenticado sin rol Gestor.
 *
 * Frontera HTTP REAL con supertest y el MISMO `ValidationPipe` GLOBAL +
 * `HttpExceptionFilter` que `main.ts`. El use-case `SubirDocumentoEventoUseCase` y la
 * query `ObtenerChecklistDocumentacionEventoQuery` se DOBLAN (in-memory) para no tocar
 * Prisma: se verifica el CONTRATO del controller (mapeo multipart→VO + comando↔HTTP +
 * traducción de errores de dominio a códigos 404/422 con `{statusCode,error,message,
 * codigo}` + forma de la respuesta 201). Un middleware inyecta `req.user`; el
 * `RolesGuard` + `@Roles('gestor')` deciden 403. El tenant/usuario viajan SIEMPRE del
 * JWT, nunca del path/body.
 *
 * RED: aún NO existen `SubirDocumentoEventoController` ni los use-cases con sus errores
 * de dominio. Los imports fallan y la batería está en ROJO por AUSENCIA DE
 * IMPLEMENTACIÓN. GREEN es de `backend-developer`.
 */
import { ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import type { Request, Response, NextFunction } from 'express';
import request from 'supertest';
import { Reflector } from '@nestjs/core';
import { DocumentosEventoController } from '../interface/documentos-evento.controller';
import {
  SubirDocumentoEventoUseCase,
  EstadoNoPermiteDocumentacionError,
  TipoDocumentoNoPermitidoError,
  ArchivoRequeridoError,
  FormatoNoPermitidoError,
  ArchivoInvalidoError,
  TamanoExcedidoError,
  ReservaNoEncontradaError,
  type SubirDocumentoEventoComando,
  type SubirDocumentoEventoResultado,
} from '../application/subir-documento-evento.use-case';
import {
  ObtenerChecklistDocumentacionEventoQuery,
  ReservaNoEncontradaError as ReservaNoEncontradaChecklistError,
  type ChecklistDocumentacionEvento,
} from '../application/obtener-checklist-documentacion-evento.query';
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

type ModoSubida =
  | 'ok'
  | 'estado'
  | 'tipo'
  | 'archivo-requerido'
  | 'formato'
  | 'archivo-invalido'
  | 'tamano'
  | 'no-encontrada';

let ultimoComando: SubirDocumentoEventoComando | null = null;
let modoSubida: ModoSubida = 'ok';
let modoChecklist: 'ok' | 'no-encontrada' = 'ok';
let usuarioActual: UsuarioAutenticado | undefined = usuarioGestor;

const checklistFalso = (
  anversoCompletado = true,
): ChecklistDocumentacionEvento => ({
  items: [
    {
      tipo: 'dni_anverso',
      completado: anversoCompletado,
      documento: anversoCompletado
        ? {
            idDocumento: 'doc-1',
            tipo: 'dni_anverso',
            url: 'https://docs/documentos-evento/anverso.jpg',
            mimeType: 'image/jpeg',
            nombreArchivo: 'anverso.jpg',
            tamanoBytes: 1024,
            fechaCreacion: new Date('2026-06-20T12:00:00.000Z'),
          }
        : undefined,
    },
    { tipo: 'dni_reverso', completado: false },
    { tipo: 'clausula_responsabilidad', completado: false },
  ],
});

const resultadoOk = (): SubirDocumentoEventoResultado => ({
  documento: {
    idDocumento: 'doc-1',
    tipo: 'dni_anverso',
    reservaId: RESERVA_ID,
    tenantId: TENANT,
    url: 'https://docs/documentos-evento/anverso.jpg',
    mimeType: 'image/jpeg',
    nombreArchivo: 'anverso.jpg',
    tamanoBytes: 1024,
    fechaCreacion: new Date('2026-06-20T12:00:00.000Z'),
  },
  checklist: checklistFalso(true),
});

const useCaseFalso = {
  ejecutar: async (
    comando: SubirDocumentoEventoComando,
  ): Promise<SubirDocumentoEventoResultado> => {
    ultimoComando = comando;
    if (modoSubida === 'no-encontrada') throw new ReservaNoEncontradaError(comando.reservaId);
    if (modoSubida === 'estado') throw new EstadoNoPermiteDocumentacionError();
    if (modoSubida === 'tipo') throw new TipoDocumentoNoPermitidoError('otro');
    if (modoSubida === 'archivo-requerido') throw new ArchivoRequeridoError();
    if (modoSubida === 'formato') throw new FormatoNoPermitidoError('image/heic');
    if (modoSubida === 'archivo-invalido') throw new ArchivoInvalidoError();
    if (modoSubida === 'tamano') throw new TamanoExcedidoError(20 * 1024 * 1024);
    return resultadoOk();
  },
} as unknown as SubirDocumentoEventoUseCase;

const queryFalsa = {
  ejecutar: async (): Promise<ChecklistDocumentacionEvento> => {
    if (modoChecklist === 'no-encontrada') {
      throw new ReservaNoEncontradaChecklistError(RESERVA_ID);
    }
    return checklistFalso(true);
  },
} as unknown as ObtenerChecklistDocumentacionEventoQuery;

let app: INestApplication;

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({
    controllers: [DocumentosEventoController],
    providers: [
      { provide: SubirDocumentoEventoUseCase, useValue: useCaseFalso },
      { provide: ObtenerChecklistDocumentacionEventoQuery, useValue: queryFalsa },
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
  modoSubida = 'ok';
  modoChecklist = 'ok';
  usuarioActual = usuarioGestor;
});

// ===========================================================================
// 201 — subida happy path: multipart (`archivo` + `tipo`) → documento + checklist;
//        tenant/usuario del JWT (nunca del path/body).
// ===========================================================================

describe('POST /api/reservas/:id/documentos-evento — happy path (201)', () => {
  it('debe_responder_201_con_documento_y_checklist_y_mapear_multipart_a_comando', async () => {
    const res = await request(app.getHttpServer())
      .post(`/api/reservas/${RESERVA_ID}/documentos-evento`)
      .field('tipo', 'dni_anverso')
      .attach('archivo', Buffer.from('fake-jpeg-bytes'), {
        filename: 'anverso.jpg',
        contentType: 'image/jpeg',
      });

    expect(res.status).toBe(201);
    expect(res.body.documento.tipo).toBe('dni_anverso');
    expect(res.body.documento.idDocumento).toBe('doc-1');
    expect(res.body.checklist.items).toHaveLength(3);
    const anverso = res.body.checklist.items.find(
      (i: { tipo: string }) => i.tipo === 'dni_anverso',
    );
    expect(anverso.completado).toBe(true);

    // El controller mapea el fichero multer al VO de dominio y el `tipo` del campo.
    expect(ultimoComando?.tipo).toBe('dni_anverso');
    expect(ultimoComando?.archivo?.mimeType).toBe('image/jpeg');
    expect(ultimoComando?.archivo?.nombreArchivo).toBe('anverso.jpg');
    expect(ultimoComando?.archivo?.tamanoBytes).toBeGreaterThan(0);
    // tenant/usuario SIEMPRE del JWT.
    expect(ultimoComando?.tenantId).toBe(TENANT);
    expect(ultimoComando?.usuarioId).toBe(GESTOR);
    expect(ultimoComando?.reservaId).toBe(RESERVA_ID);
  });

  it('debe_pasar_archivo_null_al_comando_cuando_no_se_adjunta_fichero', async () => {
    // Sin `.attach()`: el controller debe pasar `archivo: null` para que el use-case
    // lance ARCHIVO_REQUERIDO (mapeado a 422 abajo).
    modoSubida = 'archivo-requerido';

    const res = await request(app.getHttpServer())
      .post(`/api/reservas/${RESERVA_ID}/documentos-evento`)
      .field('tipo', 'dni_anverso');

    expect(res.status).toBe(422);
    expect(ultimoComando?.archivo).toBeNull();
  });
});

// ===========================================================================
// 422 — errores de dominio → Unprocessable Entity con `codigo` EXACTO del contrato.
// ===========================================================================

describe('POST /api/reservas/:id/documentos-evento — errores de dominio (422)', () => {
  const casos: ReadonlyArray<{ modo: ModoSubida; codigo: string }> = [
    { modo: 'estado', codigo: 'ESTADO_NO_PERMITE_DOCUMENTACION' },
    { modo: 'tipo', codigo: 'TIPO_DOCUMENTO_NO_PERMITIDO' },
    { modo: 'archivo-requerido', codigo: 'ARCHIVO_REQUERIDO' },
    { modo: 'formato', codigo: 'FORMATO_NO_PERMITIDO' },
    { modo: 'archivo-invalido', codigo: 'ARCHIVO_INVALIDO' },
    { modo: 'tamano', codigo: 'TAMANO_EXCEDIDO' },
  ];

  it.each(casos)('debe_responder_422_con_codigo_$codigo', async ({ modo, codigo }) => {
    modoSubida = modo;

    const res = await request(app.getHttpServer())
      .post(`/api/reservas/${RESERVA_ID}/documentos-evento`)
      .field('tipo', 'dni_anverso')
      .attach('archivo', Buffer.from('x'), {
        filename: 'x.jpg',
        contentType: 'image/jpeg',
      });

    expect(res.status).toBe(422);
    expect(res.body.statusCode).toBe(422);
    expect(res.body.codigo).toBe(codigo);
    expect(typeof res.body.message).toBe('string');
  });
});

// ===========================================================================
// 404 — RESERVA inexistente / cross-tenant (RLS).
// ===========================================================================

describe('POST /api/reservas/:id/documentos-evento — no encontrada / otro tenant (404)', () => {
  it('debe_responder_404_cuando_la_reserva_no_es_resoluble_bajo_rls', async () => {
    modoSubida = 'no-encontrada';

    const res = await request(app.getHttpServer())
      .post(`/api/reservas/${RESERVA_ID}/documentos-evento`)
      .field('tipo', 'dni_anverso')
      .attach('archivo', Buffer.from('x'), {
        filename: 'x.jpg',
        contentType: 'image/jpeg',
      });

    expect(res.status).toBe(404);
    expect(res.body.statusCode).toBe(404);
  });
});

// ===========================================================================
// GET /checklist — 200 con los tres ítems; 404 cross-tenant.
// ===========================================================================

describe('GET /api/reservas/:id/documentos-evento/checklist — (200/404)', () => {
  it('debe_responder_200_con_los_tres_items_del_checklist', async () => {
    const res = await request(app.getHttpServer()).get(
      `/api/reservas/${RESERVA_ID}/documentos-evento/checklist`,
    );

    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(3);
    expect(res.body.items.map((i: { tipo: string }) => i.tipo).sort()).toEqual(
      ['clausula_responsabilidad', 'dni_anverso', 'dni_reverso'].sort(),
    );
  });

  it('debe_responder_404_cuando_la_reserva_no_es_resoluble_bajo_rls', async () => {
    modoChecklist = 'no-encontrada';

    const res = await request(app.getHttpServer()).get(
      `/api/reservas/${RESERVA_ID}/documentos-evento/checklist`,
    );

    expect(res.status).toBe(404);
    expect(res.body.statusCode).toBe(404);
  });
});

// ===========================================================================
// 401 / 403 — autorización por rol Gestor. El use-case NO debe ejecutarse cuando
//        la autorización corta.
// ===========================================================================

describe('documentos-evento — autorización por rol Gestor (401/403)', () => {
  it('debe_responder_403_cuando_el_usuario_autenticado_no_tiene_rol_gestor', async () => {
    usuarioActual = usuarioSinRol;

    const res = await request(app.getHttpServer())
      .post(`/api/reservas/${RESERVA_ID}/documentos-evento`)
      .field('tipo', 'dni_anverso')
      .attach('archivo', Buffer.from('x'), {
        filename: 'x.jpg',
        contentType: 'image/jpeg',
      });

    expect(res.status).toBe(403);
    expect(ultimoComando).toBeNull();
  });

  it('debe_rechazar_sin_ejecutar_el_caso_de_uso_cuando_no_hay_jwt', async () => {
    usuarioActual = undefined;

    const res = await request(app.getHttpServer())
      .post(`/api/reservas/${RESERVA_ID}/documentos-evento`)
      .field('tipo', 'dni_anverso')
      .attach('archivo', Buffer.from('x'), {
        filename: 'x.jpg',
        contentType: 'image/jpeg',
      });

    expect([401, 403]).toContain(res.status);
    expect(ultimoComando).toBeNull();
  });
});
