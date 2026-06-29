/**
 * TESTS del filtro global `HttpExceptionFilter` (frontera de normalización de
 * errores). Verifica que el envelope estándar (`statusCode/message/error/path/
 * timestamp`) se conserva para errores genéricos, y que los campos OPCIONALES de
 * errores de dominio se PROPAGAN cuando la excepción los aporta:
 *   - `codigo` / `detalle` (motor de tarifa US-016).
 *   - `colaDisponible` / `motivo` (conflicto de fecha US-005,
 *     `AsignarFechaConflictoError` → 409). El contrato OpenAPI declara ambos
 *     `required` en el 409; sin ellos el frontend no clasifica la oferta de cola.
 *
 * Se levanta una app Nest mínima con supertest y el FILTRO GLOBAL REAL (réplica de
 * `main.ts`), con controladores de juguete que lanzan cada tipo de excepción.
 */
import {
  ConflictException,
  Controller,
  Get,
  InternalServerErrorException,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { HttpExceptionFilter } from '../http-exception.filter';

@Controller('test-errores')
class ErroresDePruebaController {
  @Get('conflicto-cola')
  conflictoConCola(): never {
    // Replica EXACTA de lo que lanza TransicionFechaController para
    // AsignarFechaConflictoError (US-005, oferta de cola).
    throw new ConflictException({
      statusCode: 409,
      error: 'Conflict',
      message: 'La fecha está reservada por otra consulta; puedes entrar en la lista de espera.',
      colaDisponible: true,
      motivo: 'La fecha está reservada por otra consulta; puedes entrar en la lista de espera.',
    });
  }

  @Get('conflicto-sin-cola')
  conflictoSinCola(): never {
    throw new ConflictException({
      statusCode: 409,
      error: 'Conflict',
      message: 'La fecha seleccionada no está disponible y no admite lista de espera.',
      colaDisponible: false,
      motivo: 'La fecha seleccionada no está disponible y no admite lista de espera.',
    });
  }

  @Get('error-generico')
  errorGenerico(): never {
    throw new InternalServerErrorException('Algo falló');
  }
}

let app: INestApplication;

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({
    controllers: [ErroresDePruebaController],
  }).compile();
  app = moduleRef.createNestApplication();
  app.setGlobalPrefix('api');
  app.useGlobalFilters(new HttpExceptionFilter());
  await app.init();
});

afterAll(async () => {
  await app.close();
});

describe('HttpExceptionFilter — propagación de campos de conflicto de fecha (US-005)', () => {
  it('debe_propagar_colaDisponible_true_y_motivo_en_el_409_de_oferta_de_cola', async () => {
    const res = await request(app.getHttpServer()).get('/api/test-errores/conflicto-cola');

    expect(res.status).toBe(409);
    expect(res.body).toEqual(
      expect.objectContaining({
        statusCode: 409,
        error: 'Conflict',
        colaDisponible: true,
        motivo: 'La fecha está reservada por otra consulta; puedes entrar en la lista de espera.',
      }),
    );
  });

  it('debe_propagar_colaDisponible_false_y_motivo_en_el_409_no_disponible', async () => {
    const res = await request(app.getHttpServer()).get('/api/test-errores/conflicto-sin-cola');

    expect(res.status).toBe(409);
    expect(res.body).toEqual(
      expect.objectContaining({ colaDisponible: false, motivo: expect.any(String) }),
    );
  });

  it('NO_debe_añadir_colaDisponible_ni_motivo_a_errores_que_no_los_aportan', async () => {
    const res = await request(app.getHttpServer()).get('/api/test-errores/error-generico');

    expect(res.status).toBe(500);
    expect(res.body).not.toHaveProperty('colaDisponible');
    expect(res.body).not.toHaveProperty('motivo');
    expect(res.body).toEqual(
      expect.objectContaining({ statusCode: 500, error: expect.any(String) }),
    );
  });
});
