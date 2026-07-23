/**
 * TESTS del `AltaConsultaController` (US-003 / UC-03) — traducción HTTP.
 *
 * Hallazgo MAYOR #1 del code-review: el `try/catch` del controller enmascaraba
 * cualquier error no-validación como `HttpException(500)` ANTES de llegar al
 * `HttpExceptionFilter` global (que es quien mapea `P2002` → 409). Estos tests
 * fijan el comportamiento correcto:
 *   - `AltaConsultaValidacionError` → `BadRequestException` (400).
 *   - `Prisma.PrismaClientKnownRequestError` con `P2002` (colisión del `codigo`
 *     correlativo de RESERVA) se RELANZA tal cual (no se convierte en 500): el
 *     filtro global lo normalizará a 409.
 *   - Alta correcta → DTO de respuesta.
 *
 * El caso de uso se mockea (doble del puerto de aplicación); no se toca Prisma.
 */
import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AltaConsultaController } from '../interface/alta-consulta.controller';
import {
  AltaConsultaUseCase,
  AltaConsultaValidacionError,
  type AltaConsultaResultado,
} from '../application/alta-consulta.use-case';
import type { CreateReservaRequestDto } from '../interface/create-reserva.dto';
import type { UsuarioAutenticado } from '../../shared/auth/usuario-autenticado';

const TENANT = '00000000-0000-0000-0000-000000000001';
const GESTOR = '00000000-0000-0000-0000-0000000000a1';
const EMAIL = 'marta.soler@example.com';

const usuario: UsuarioAutenticado = { sub: GESTOR, tenantId: TENANT, rol: 'gestor' };

const dtoBase = (): CreateReservaRequestDto =>
  ({
    canalEntrada: 'email',
    cliente: {
      nombre: 'Marta',
      apellidos: 'Soler',
      email: EMAIL,
      telefono: '600111222',
    },
  }) as CreateReservaRequestDto;

const resultadoOk = (): AltaConsultaResultado => ({
  reserva: {
    idReserva: 'res-1',
    tenantId: TENANT,
    clienteId: 'cli-1',
    codigo: '26-0001',
    estado: 'consulta',
    subEstado: '2a',
    ttlExpiracion: null,
    canalEntrada: 'email',
  },
  cliente: {
    idCliente: 'cli-1',
    tenantId: TENANT,
    nombre: 'Marta',
    apellidos: 'Soler',
    email: EMAIL,
    telefono: '600111222',
  },
  comunicacion: {
    idComunicacion: 'com-1',
    tenantId: TENANT,
    reservaId: 'res-1',
    clienteId: 'cli-1',
    codigoEmail: 'E1',
    estado: 'enviado',
    destinatarioEmail: EMAIL,
    fechaEnvio: new Date('2026-06-28T10:00:00.000Z'),
  },
  clienteReutilizado: false,
  errores: [],
});

const montar = () => {
  const useCase = { ejecutar: jest.fn() } as unknown as AltaConsultaUseCase & {
    ejecutar: jest.Mock;
  };
  const controller = new AltaConsultaController(useCase);
  return { controller, useCase };
};

describe('AltaConsultaController — traducción de errores (MAYOR #1)', () => {
  it('debe_devolver_el_dto_de_respuesta_cuando_el_alta_tiene_exito', async () => {
    const { controller, useCase } = montar();
    useCase.ejecutar.mockResolvedValueOnce(resultadoOk());

    const out = await controller.crear(dtoBase(), usuario);

    expect(out.idReserva).toBe('res-1');
    expect(out.codigo).toBe('26-0001');
    expect(out.estado).toBe('consulta');
  });

  it('debe_mapear_AltaConsultaValidacionError_a_400_BadRequest', async () => {
    const { controller, useCase } = montar();
    useCase.ejecutar.mockRejectedValueOnce(
      new AltaConsultaValidacionError([
        { campo: 'email', mensaje: 'El email no tiene un formato válido' },
      ]),
    );

    const error = await controller
      .crear(dtoBase(), usuario)
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(BadRequestException);
    expect((error as BadRequestException).getStatus()).toBe(400);
  });

  it('NO_debe_convertir_un_P2002_en_500_sino_relanzarlo_para_el_filtro_global', async () => {
    // Colisión del `codigo` correlativo de RESERVA tras agotar los reintentos del
    // UoW: el controller debe RELANZAR el P2002 intacto (el filtro global → 409),
    // nunca enmascararlo como 500.
    const { controller, useCase } = montar();
    const p2002 = new Prisma.PrismaClientKnownRequestError(
      'Unique constraint failed on the fields: (`codigo`)',
      { code: 'P2002', clientVersion: '6.2.0', meta: { target: ['codigo'] } },
    );
    useCase.ejecutar.mockRejectedValueOnce(p2002);

    const error = await controller
      .crear(dtoBase(), usuario)
      .catch((e: unknown) => e);

    expect(error).toBe(p2002);
    expect(error).toBeInstanceOf(Prisma.PrismaClientKnownRequestError);
    expect((error as Prisma.PrismaClientKnownRequestError).code).toBe('P2002');
  });

  it('debe_relanzar_cualquier_otro_error_inesperado_sin_envolverlo', async () => {
    const { controller, useCase } = montar();
    const inesperado = new Error('fallo inesperado');
    useCase.ejecutar.mockRejectedValueOnce(inesperado);

    await expect(controller.crear(dtoBase(), usuario)).rejects.toBe(inesperado);
  });
});
