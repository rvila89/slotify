/**
 * TESTS DE INTEGRACIÓN HTTP del `ExtenderBloqueoController` (US-006 / UC-05) —
 * frontera HTTP REAL que el unit test (`extender-bloqueo.controller.spec.ts`,
 * controller en aislamiento) NO ejercita: aquí se levanta una app Nest mínima con
 * supertest y el MISMO `ValidationPipe` GLOBAL + `HttpExceptionFilter` que `main.ts`.
 *
 * OBJETIVO (D-3 + contrato congelado `docs/api-spec.yml` op `extenderBloqueo`, 422):
 * el cuerpo inválido (`dias` 0 / negativo / no entero / tipo erróneo) DEBE responder
 * **422**, NO el **400** por defecto del `ValidationPipe` global. Como el pipe global
 * se ejecuta ANTES que cualquier pipe local y prevalece, un pipe local con
 * `errorHttpStatusCode: 422` NO basta; la solución es dejar pasar el cuerpo por el
 * pipe global (DTO sin `@IsInt`/`@Min`, solo `@Allow()` para el whitelist) y delegar el
 * rechazo en la guarda defensiva del DOMINIO (`ExtenderBloqueoUseCase.validarDias` →
 * `ExtenderBloqueoValidacionError`), que el controlador mapea a 422.
 *
 * Por eso aquí se usa el `ExtenderBloqueoUseCase` REAL (con una unidad de trabajo y un
 * reloj FALSOS): para `dias` inválido la validación corta ANTES de tocar la UoW (no se
 * toca Prisma); en el happy path la UoW falsa devuelve la RESERVA extendida. Un
 * middleware inyecta el `req.user` que `@CurrentUser` espera (no se prueba auth aquí).
 */
import { ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import type { Request, Response, NextFunction } from 'express';
import request from 'supertest';
import { ExtenderBloqueoController } from '../interface/extender-bloqueo.controller';
import {
  ExtenderBloqueoUseCase,
  type ExtenderBloqueoDeps,
  type ExtenderBloqueoResultado,
  type RepositoriosExtenderBloqueo,
} from '../application/extender-bloqueo.use-case';
import { ObtenerReservaUseCase } from '../application/obtener-reserva.query';
import { HttpExceptionFilter } from '../../shared/filters/http-exception.filter';
import type { UsuarioAutenticado } from '../../shared/auth/usuario-autenticado';
import type { ReservaDetalleLectura } from '../application/obtener-reserva.query';

const TENANT = '00000000-0000-0000-0000-000000000001';
const GESTOR = '00000000-0000-0000-0000-0000000000a1';
const RESERVA_ID = 'res-1';
const MENSAJE_DIAS =
  'El número de días de extensión debe ser un entero positivo (≥ 1)';
const usuario: UsuarioAutenticado = { sub: GESTOR, tenantId: TENANT, rol: 'gestor' };

const TTL_NUEVO = new Date('2027-09-24T00:00:00.000Z');

const detalleOk = (): ReservaDetalleLectura =>
  ({
    idReserva: RESERVA_ID,
    codigo: '26-0001',
    clienteId: 'cli-1',
    estado: 'consulta',
    subEstado: '2b',
    canalEntrada: 'email',
    fechaEvento: new Date('2027-09-12T00:00:00.000Z'),
    duracionHoras: null,
    tipoEvento: null,
    numAdultosNinosMayores4: null,
    numNinosMenores4: null,
    numInvitadosFinal: null,
    importeTotal: null,
    importeSenal: null,
    importeLiquidacion: null,
    ttlExpiracion: TTL_NUEVO,
    visitaProgramadaFecha: null,
    visitaProgramadaHora: null,
    visitaRealizada: null,
    fianzaEur: null,
    fianzaCobradaFecha: null,
    fianzaDevueltaFecha: null,
    fianzaDevueltaEur: null,
    condPartFirmadas: null,
    condPartFechaEnvio: null,
    condPartFechaFirma: null,
    preEventoStatus: 'pendiente',
    liquidacionStatus: 'pendiente',
    fianzaStatus: 'pendiente',
    posicionCola: null,
    consultaBloqueanteId: null,
    notas: null,
    fechaCreacion: new Date('2026-06-01T00:00:00.000Z'),
    cliente: {
      idCliente: 'cli-1',
      nombre: 'Marta',
      apellidos: 'Soler',
      email: 'marta@example.com',
      telefono: '600111222',
      dniNif: null,
      direccion: null,
      codigoPostal: null,
      poblacion: null,
      provincia: null,
      ibanDevolucion: null,
    },
  }) as ReservaDetalleLectura;

// UoW FALSA: registra el comando recibido y, si se llega a ejecutar (happy path),
// devuelve una RESERVA extendida sin tocar Prisma. Para `dias` inválido, `validarDias`
// del use-case REAL lanza ANTES de invocar la UoW, así que `ejecutado` queda en false.
let ejecutado = false;
const unidadDeTrabajo: ExtenderBloqueoDeps['unidadDeTrabajo'] = {
  ejecutar: async (_tenantId, _trabajo): Promise<unknown> => {
    ejecutado = true;
    const resultado: ExtenderBloqueoResultado = {
      reserva: {
        idReserva: RESERVA_ID,
        tenantId: TENANT,
        clienteId: 'cli-1',
        estado: 'consulta',
        subEstado: '2b',
        ttlExpiracion: TTL_NUEVO,
        fechaEvento: new Date('2027-09-12T00:00:00.000Z'),
      },
    };
    // Evita "unused" del callback de trabajo sin ejecutar lógica de BD.
    void (_trabajo as (r: RepositoriosExtenderBloqueo) => unknown);
    return resultado;
  },
};
const clock: ExtenderBloqueoDeps['clock'] = { ahora: () => new Date('2026-06-30T00:00:00.000Z') };

const obtenerReserva = { ejecutar: jest.fn() };

let app: INestApplication;

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({
    controllers: [ExtenderBloqueoController],
    providers: [
      {
        provide: ExtenderBloqueoUseCase,
        useValue: new ExtenderBloqueoUseCase({ unidadDeTrabajo, clock }),
      },
      { provide: ObtenerReservaUseCase, useValue: obtenerReserva },
    ],
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
  obtenerReserva.ejecutar.mockReset();
});

describe('POST /api/reservas/:id/extender-bloqueo — frontera HTTP (US-006, D-3)', () => {
  it('debe_responder_200_con_el_nuevo_ttl_en_el_happy_path', async () => {
    obtenerReserva.ejecutar.mockResolvedValue(detalleOk());

    const res = await request(app.getHttpServer())
      .post(`/api/reservas/${RESERVA_ID}/extender-bloqueo`)
      .send({ dias: 7 });

    expect(res.status).toBe(200);
    expect(res.body.ttlExpiracion).toBe(TTL_NUEVO.toISOString());
    expect(ejecutado).toBe(true);
  });

  const invalidos: ReadonlyArray<{ nombre: string; dias: unknown }> = [
    { nombre: 'cero', dias: 0 },
    { nombre: 'negativo', dias: -1 },
    { nombre: 'no_entero', dias: 1.5 },
    { nombre: 'tipo_string', dias: 'siete' },
  ];

  it.each(invalidos)(
    'debe_responder_422_y_no_400_cuando_dias_es_$nombre',
    async ({ dias }) => {
      const res = await request(app.getHttpServer())
        .post(`/api/reservas/${RESERVA_ID}/extender-bloqueo`)
        .send({ dias });

      // 422 del contrato (NO 400 del pipe global): el cuerpo PASA el pipe global y lo
      // rechaza la guarda de dominio mapeada a 422 por el controlador.
      expect(res.status).toBe(422);
      expect(res.body.statusCode).toBe(422);
      // El cuerpo inválido NO debe llegar a la transacción (validación pre-UoW).
      expect(ejecutado).toBe(false);
      // Mensaje exacto del contrato.
      const mensajes = Array.isArray(res.body.message)
        ? res.body.message
        : [res.body.message];
      expect(mensajes).toContain(MENSAJE_DIAS);
    },
  );
});
