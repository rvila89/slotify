/**
 * TESTS del `ExtenderBloqueoController` (US-006 / UC-05) — traducción HTTP del
 * endpoint congelado `POST /reservas/{id}/extender-bloqueo`. fase TDD RED.
 *
 * Trazabilidad: US-006, contrato OpenAPI `docs/api-spec.yml` (operationId
 * `extenderBloqueo`; body `{ dias }`; respuestas 200 `Reserva`, 404 NotFound, 409
 * `ExtenderBloqueoConflictoError` con `motivo`, 422 `ErrorResponse`); design.md
 * §D-2/§D-3/§D-6.
 *
 * Fija el MAPEO de errores de dominio → HTTP (mismo patrón que
 * `pendiente-invitados.controller.ts` y `programar-visita.controller.ts`):
 *   - `BloqueoNoExtensibleError` → 409 (`ConflictException` con `{ motivo }`).
 *   - `ExtenderBloqueoValidacionError` → 422 (`UnprocessableEntityException`).
 *   - `ReservaNoEncontradaError` → 404 (`NotFoundException`).
 *   - éxito → DTO `Reserva` con el `ttlExpiracion` NUEVO; estado/subEstado sin cambios.
 *   - El `tenantId`/`usuarioId` SIEMPRE derivan del JWT (`@CurrentUser`), nunca del path.
 *
 * El use-case y el read-model (`ObtenerReservaUseCase`) se mockean (dobles de los
 * puertos de aplicación); no se toca Prisma.
 *
 * RED: aún NO existen `interface/extender-bloqueo.controller.ts` ni
 * `application/extender-bloqueo.use-case.ts`. La batería está en ROJO por AUSENCIA DE
 * IMPLEMENTACIÓN. GREEN es de `backend-developer`.
 */
import {
  ConflictException,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { ExtenderBloqueoController } from '../interface/extender-bloqueo.controller';
import {
  ExtenderBloqueoUseCase,
  ExtenderBloqueoValidacionError,
  BloqueoNoExtensibleError,
  ReservaNoEncontradaError,
  type ExtenderBloqueoComando,
  type ExtenderBloqueoResultado,
} from '../application/extender-bloqueo.use-case';
import {
  ObtenerReservaUseCase,
  type ReservaDetalleLectura,
} from '../application/obtener-reserva.query';
import type { ExtenderBloqueoRequestDto } from '../interface/extender-bloqueo.dto';
import type { UsuarioAutenticado } from '../../shared/auth/usuario-autenticado';

const TENANT = '00000000-0000-0000-0000-000000000001';
const GESTOR = '00000000-0000-0000-0000-0000000000a1';
const RESERVA_ID = 'res-1';
const DIA_MS = 24 * 60 * 60 * 1000;

const usuario: UsuarioAutenticado = { sub: GESTOR, tenantId: TENANT, rol: 'gestor' };

const TTL_NUEVO = new Date(Date.now() + 12 * DIA_MS);

const dto = (over: Partial<ExtenderBloqueoRequestDto> = {}): ExtenderBloqueoRequestDto =>
  ({ dias: 7, ...over }) as ExtenderBloqueoRequestDto;

const resultadoOk = (): ExtenderBloqueoResultado => ({
  reserva: {
    idReserva: RESERVA_ID,
    tenantId: TENANT,
    clienteId: 'cli-1',
    estado: 'consulta',
    subEstado: '2b',
    ttlExpiracion: TTL_NUEVO,
    fechaEvento: new Date('2027-09-12T00:00:00.000Z'),
  },
});

const detalleOk = (): ReservaDetalleLectura =>
  ({
    idReserva: RESERVA_ID,
    codigo: '26-0001',
    clienteId: 'cli-1',
    estado: 'consulta',
    subEstado: '2b',
    canalEntrada: 'web',
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

const montar = (
  ejecutar: jest.Mock,
  buscarDetalle: jest.Mock = jest.fn(async () => detalleOk()),
) => {
  const useCase = { ejecutar } as unknown as ExtenderBloqueoUseCase;
  const obtener = { ejecutar: buscarDetalle } as unknown as ObtenerReservaUseCase;
  return new ExtenderBloqueoController(useCase, obtener);
};

describe('ExtenderBloqueoController — éxito → 200 con ttlExpiracion nuevo', () => {
  it('debe_devolver_la_reserva_con_el_nuevo_ttl_y_pasar_el_tenant_del_jwt', async () => {
    const ejecutar = jest.fn(
      async (_c: ExtenderBloqueoComando) => resultadoOk(),
    );
    const controller = montar(ejecutar);

    const out = await controller.extenderBloqueo(RESERVA_ID, dto(), usuario);

    // El comando deriva tenant/usuario del JWT y dias del body.
    expect(ejecutar).toHaveBeenCalledTimes(1);
    const comando = ejecutar.mock.calls[0][0];
    expect(comando.tenantId).toBe(TENANT);
    expect(comando.usuarioId).toBe(GESTOR);
    expect(comando.reservaId).toBe(RESERVA_ID);
    expect(comando.dias).toBe(7);

    // Respuesta con el nuevo ttlExpiracion (ISO date-time) y subEstado sin cambios.
    expect(out.ttlExpiracion).toBe(TTL_NUEVO.toISOString());
    expect(out.subEstado).toBe('2b');
  });
});

describe('ExtenderBloqueoController — mapeo de errores de dominio a HTTP', () => {
  it('debe_mapear_BloqueoNoExtensibleError_a_409_con_motivo', async () => {
    const ejecutar = jest.fn(async () => {
      throw new BloqueoNoExtensibleError('El bloqueo de la fecha ha expirado');
    });
    const controller = montar(ejecutar);

    const error = await controller
      .extenderBloqueo(RESERVA_ID, dto(), usuario)
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ConflictException);
    expect((error as ConflictException).getResponse()).toMatchObject({
      statusCode: 409,
      motivo: 'El bloqueo de la fecha ha expirado',
    });
  });

  it('debe_mapear_ExtenderBloqueoValidacionError_a_422', async () => {
    const ejecutar = jest.fn(async () => {
      throw new ExtenderBloqueoValidacionError(
        'El número de días de extensión debe ser un entero positivo (≥ 1)',
      );
    });
    const controller = montar(ejecutar);

    await expect(
      controller.extenderBloqueo(RESERVA_ID, dto({ dias: 0 }), usuario),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);
  });

  it('debe_mapear_ReservaNoEncontradaError_a_404', async () => {
    const ejecutar = jest.fn(async () => {
      throw new ReservaNoEncontradaError(RESERVA_ID);
    });
    const controller = montar(ejecutar);

    await expect(
      controller.extenderBloqueo(RESERVA_ID, dto(), usuario),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('debe_relanzar_un_error_inesperado_para_el_filtro_global', async () => {
    const ejecutar = jest.fn(async () => {
      throw new Error('BOOM_INESPERADO');
    });
    const controller = montar(ejecutar);

    await expect(
      controller.extenderBloqueo(RESERVA_ID, dto(), usuario),
    ).rejects.toThrow('BOOM_INESPERADO');
  });
});
