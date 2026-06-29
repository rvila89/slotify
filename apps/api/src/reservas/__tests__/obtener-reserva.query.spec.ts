/**
 * TESTS del query `ObtenerReservaUseCase` (US-005 / ficha de consulta, BLOQUEADOR 3
 * del QA: `GET /reservas/{id}` no existía). Ejercita la APLICACIÓN contra un DOBLE del
 * puerto de lectura (in-memory), sin Prisma (hexagonal):
 *   - devuelve el read-model `ReservaDetalle` cuando la RESERVA existe en el tenant.
 *   - lanza `ReservaDetalleNoEncontradaError` (→ 404) cuando el puerto devuelve null
 *     (no existe o pertenece a otro tenant: cross-tenant invisible por RLS).
 */
import {
  ObtenerReservaUseCase,
  ReservaDetalleNoEncontradaError,
  type ReservaDetalleLectura,
  type ReservaDetalleQueryPort,
} from '../application/obtener-reserva.query';

const TENANT = '00000000-0000-0000-0000-000000000001';
const RESERVA_ID = '11111111-1111-1111-1111-111111111111';

const detalle2b = (): ReservaDetalleLectura => ({
  idReserva: RESERVA_ID,
  codigo: 'SLO-2026-0001',
  clienteId: 'cli-1',
  estado: 'consulta',
  subEstado: '2b',
  canalEntrada: 'web',
  fechaEvento: new Date('2027-10-20T00:00:00.000Z'),
  duracionHoras: null,
  tipoEvento: null,
  numAdultosNinosMayores4: null,
  numNinosMenores4: null,
  numInvitadosFinal: null,
  importeTotal: null,
  importeSenal: null,
  importeLiquidacion: null,
  ttlExpiracion: new Date('2026-07-02T17:03:07.000Z'),
  visitaProgramadaFecha: null,
  visitaProgramadaHora: null,
  visitaRealizada: false,
  fianzaEur: null,
  fianzaCobradaFecha: null,
  fianzaDevueltaFecha: null,
  fianzaDevueltaEur: null,
  condPartFirmadas: false,
  condPartFechaEnvio: null,
  condPartFechaFirma: null,
  preEventoStatus: 'pendiente',
  liquidacionStatus: 'pendiente',
  fianzaStatus: 'pendiente',
  posicionCola: null,
  consultaBloqueanteId: null,
  notas: null,
  fechaCreacion: new Date('2026-06-01T08:00:00.000Z'),
  cliente: {
    idCliente: 'cli-1',
    nombre: 'Marta',
    apellidos: 'Soler',
    email: 'marta@example.com',
    telefono: '600000000',
    dniNif: null,
    direccion: null,
    codigoPostal: null,
    poblacion: null,
    provincia: null,
    ibanDevolucion: null,
  },
});

const construir = (
  buscarDetalle: ReservaDetalleQueryPort['buscarDetalle'],
): ObtenerReservaUseCase =>
  new ObtenerReservaUseCase({ reservaDetalle: { buscarDetalle } });

describe('ObtenerReservaUseCase — lectura del detalle de la reserva', () => {
  it('debe_devolver_el_detalle_cuando_la_reserva_existe_en_el_tenant', async () => {
    const buscarDetalle = jest.fn().mockResolvedValue(detalle2b());
    const useCase = construir(buscarDetalle);

    const resultado = await useCase.ejecutar({ tenantId: TENANT, reservaId: RESERVA_ID });

    expect(resultado.idReserva).toBe(RESERVA_ID);
    expect(resultado.subEstado).toBe('2b');
    expect(resultado.ttlExpiracion).toEqual(new Date('2026-07-02T17:03:07.000Z'));
    expect(resultado.cliente.nombre).toBe('Marta');
    expect(buscarDetalle).toHaveBeenCalledWith({ tenantId: TENANT, reservaId: RESERVA_ID });
  });

  it('debe_lanzar_ReservaDetalleNoEncontrada_cuando_el_puerto_devuelve_null', async () => {
    const useCase = construir(jest.fn().mockResolvedValue(null));

    await expect(
      useCase.ejecutar({ tenantId: TENANT, reservaId: RESERVA_ID }),
    ).rejects.toBeInstanceOf(ReservaDetalleNoEncontradaError);
  });
});
