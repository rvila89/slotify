/**
 * TESTS del `ConsultarCalendarioController` (US-039 / UC-29) — traducción HTTP del
 * endpoint congelado `GET /calendario`. Fase TDD RED.
 *
 * Trazabilidad: US-039, spec-delta `calendario`, contrato OpenAPI `docs/api-spec.yml`
 * (operationId `consultarCalendario`; query `desde`/`hasta` date required + `vista`
 * enum default `mes`; respuesta 200 `CalendarioResponse`). design.md §D-1/§D-4.
 *
 * Fija:
 *   - el `tenantId` SIEMPRE deriva del JWT (`@CurrentUser`), nunca del query/path.
 *   - la respuesta cumple la FORMA de `CalendarioResponse`/`CalendarioFecha`:
 *     `rango{desde,hasta}` como `date` (YYYY-MM-DD), `ttlExpiracion` como `date-time`
 *     ISO o `null`, `subEstado` nullable, `enCola` entero ≥ 0.
 *   - el use-case (read-model) se mockea (doble del puerto de aplicación); sin Prisma.
 *
 * Lectura pura: SIN tests de concurrencia (US-039 §Concurrencia).
 *
 * RED: aún NO existen `interface/consultar-calendario.controller.ts` ni
 * `application/obtener-calendario.query.ts`. La batería está en ROJO POR AUSENCIA DE
 * IMPLEMENTACIÓN. GREEN es de `backend-developer`.
 */
import { ConsultarCalendarioController } from '../consultar-calendario.controller';
import {
  ObtenerCalendarioUseCase,
  type CalendarioLectura,
  type ObtenerCalendarioComando,
} from '../../application/obtener-calendario.query';
import type { ConsultarCalendarioQueryDto } from '../consultar-calendario.dto';
import type { UsuarioAutenticado } from '../../../shared/auth/usuario-autenticado';

const TENANT = '00000000-0000-0000-0000-000000000001';
const GESTOR = '00000000-0000-0000-0000-0000000000a1';
const RESERVA_ID = '11111111-1111-1111-1111-111111111111';

const usuario: UsuarioAutenticado = { sub: GESTOR, tenantId: TENANT, rol: 'gestor' };

const query = (
  over: Partial<ConsultarCalendarioQueryDto> = {},
): ConsultarCalendarioQueryDto =>
  ({ desde: '2026-06-01', hasta: '2026-06-30', vista: 'mes', ...over }) as ConsultarCalendarioQueryDto;

const TTL = new Date('2026-06-14T17:00:00.000Z');

const lecturaOk = (): CalendarioLectura => ({
  rango: {
    desde: new Date('2026-06-01T00:00:00.000Z'),
    hasta: new Date('2026-06-30T00:00:00.000Z'),
  },
  fechas: [
    {
      fecha: new Date('2026-06-12T00:00:00.000Z'),
      color: 'gris',
      estado: 'consulta',
      subEstado: '2b',
      reservaId: RESERVA_ID,
      cliente: 'Ana García',
      ttlExpiracion: TTL,
      enCola: 2,
    },
    {
      fecha: new Date('2026-06-20T00:00:00.000Z'),
      color: 'verde',
      estado: 'reserva_confirmada',
      subEstado: null,
      reservaId: '22222222-2222-2222-2222-222222222222',
      cliente: 'Luis Pérez',
      ttlExpiracion: null,
      enCola: 0,
    },
  ],
});

const montar = (
  ejecutar: jest.Mock = jest.fn(async () => lecturaOk()),
): ConsultarCalendarioController => {
  const useCase = { ejecutar } as unknown as ObtenerCalendarioUseCase;
  return new ConsultarCalendarioController(useCase);
};

describe('ConsultarCalendarioController — deriva tenant del JWT y pasa el rango', () => {
  it('debe_pasar_tenant_del_jwt_y_el_rango_vista_al_use_case', async () => {
    const ejecutar = jest.fn(async (_c: ObtenerCalendarioComando) => lecturaOk());
    const controller = montar(ejecutar);

    await controller.consultar(query({ vista: 'semana' }), usuario);

    expect(ejecutar).toHaveBeenCalledTimes(1);
    const comando = ejecutar.mock.calls[0][0] as ObtenerCalendarioComando;
    expect(comando.tenantId).toBe(TENANT);
    expect(comando.vista).toBe('semana');
    // El rango llega al use-case como Date a partir del query `date` del contrato.
    expect(comando.desde).toEqual(new Date('2026-06-01T00:00:00.000Z'));
    expect(comando.hasta).toEqual(new Date('2026-06-30T00:00:00.000Z'));
  });
});

describe('ConsultarCalendarioController — forma de CalendarioResponse/CalendarioFecha', () => {
  it('debe_devolver_rango_como_fechas_YYYY_MM_DD', async () => {
    const out = await montar().consultar(query(), usuario);

    expect(out.rango.desde).toBe('2026-06-01');
    expect(out.rango.hasta).toBe('2026-06-30');
  });

  it('debe_mapear_cada_CalendarioFecha_con_los_campos_del_contrato', async () => {
    const out = await montar().consultar(query(), usuario);

    expect(out.fechas).toHaveLength(2);
    const [primera, segunda] = out.fechas;

    // fecha como date (YYYY-MM-DD), color/estado/subEstado del contrato.
    expect(primera.fecha).toBe('2026-06-12');
    expect(primera.color).toBe('gris');
    expect(primera.estado).toBe('consulta');
    expect(primera.subEstado).toBe('2b');
    expect(primera.reservaId).toBe(RESERVA_ID);
    expect(primera.cliente).toBe('Ana García');
    // ttlExpiracion como date-time ISO completo.
    expect(primera.ttlExpiracion).toBe(TTL.toISOString());
    expect(primera.enCola).toBe(2);

    // subEstado nullable y ttlExpiracion null para una reserva firme.
    expect(segunda.subEstado).toBeNull();
    expect(segunda.ttlExpiracion).toBeNull();
    expect(segunda.color).toBe('verde');
    expect(segunda.enCola).toBe(0);
  });

  it('debe_devolver_fechas_vacio_para_un_rango_sin_bloqueos', async () => {
    const vacio: CalendarioLectura = {
      rango: {
        desde: new Date('2026-06-01T00:00:00.000Z'),
        hasta: new Date('2026-06-30T00:00:00.000Z'),
      },
      fechas: [],
    };
    const out = await montar(jest.fn(async () => vacio)).consultar(query(), usuario);

    expect(out.fechas).toEqual([]);
    expect(out.rango.desde).toBe('2026-06-01');
  });
});
