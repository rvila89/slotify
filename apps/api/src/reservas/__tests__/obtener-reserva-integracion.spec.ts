/**
 * TESTS DE INTEGRACIÓN de la lectura de la ficha (`GET /reservas/{id}` →
 * `ReservaDetalle`, US-005, BLOQUEADOR 3 del QA). INTEGRACIÓN REAL contra el Postgres
 * del docker-compose: el query se resuelve por DI (`ReservasModule`) y se verifica la
 * forma del read-model según el sub-estado, además del aislamiento multi-tenant (RLS):
 *   - reserva 2.a → forma base sin derivados de bloqueo/cola.
 *   - reserva 2.b → `ttlExpiracion` presente, `fechaEvento` mapeada.
 *   - reserva 2.d → `posicionCola` + `consultaBloqueanteId` presentes.
 *   - reserva de OTRO tenant o id inexistente → null → 404 (`ReservaDetalleNoEncontradaError`).
 *
 * Requiere `docker compose up -d postgres` + migración + seed (tenant piloto).
 */
import { Test, type TestingModule } from '@nestjs/testing';
import { ConfigModule } from '@nestjs/config';
import {
  CanalEntrada,
  DuracionHoras,
  EstadoReserva,
  SubEstadoConsulta,
} from '@prisma/client';
import { ReservasModule } from '../reservas.module';
import { PrismaService } from '../../shared/prisma/prisma.service';
import {
  ObtenerReservaUseCase,
  ReservaDetalleNoEncontradaError,
} from '../application/obtener-reserva.query';

const TENANT = '00000000-0000-0000-0000-000000000001';
const OTRO_TENANT = '00000000-0000-0000-0000-0000000000ff';
const EMAIL_PATTERN = '@us005-get.test';

const FECHA_2B = new Date('2027-05-10T00:00:00.000Z');
const FECHA_2D = new Date('2027-05-11T00:00:00.000Z');

let moduleRef: TestingModule;
let prisma: PrismaService;
let useCase: ObtenerReservaUseCase;

const sufijo = (): string => Math.random().toString(36).slice(2, 8);

const sembrarReserva = async (params: {
  estado: EstadoReserva;
  subEstado: SubEstadoConsulta | null;
  fechaEvento?: Date;
  duracionHoras?: DuracionHoras;
  ttlExpiracion?: Date;
  posicionCola?: number;
  consultaBloqueanteId?: string;
  tenantId?: string;
}): Promise<string> => {
  const cliente = await prisma.cliente.create({
    data: {
      tenantId: params.tenantId ?? TENANT,
      nombre: 'Lectura',
      apellidos: 'Ficha',
      email: `lectura-${sufijo()}${EMAIL_PATTERN}`,
      telefono: '600111222',
    },
  });
  const reserva = await prisma.reserva.create({
    data: {
      tenantId: params.tenantId ?? TENANT,
      clienteId: cliente.idCliente,
      codigo: `TST-GET-${sufijo()}`,
      estado: params.estado,
      subEstado: params.subEstado,
      canalEntrada: CanalEntrada.web,
      ...(params.fechaEvento !== undefined ? { fechaEvento: params.fechaEvento } : {}),
      ...(params.duracionHoras !== undefined
        ? { duracionHoras: params.duracionHoras }
        : {}),
      ...(params.ttlExpiracion !== undefined ? { ttlExpiracion: params.ttlExpiracion } : {}),
      ...(params.posicionCola !== undefined ? { posicionCola: params.posicionCola } : {}),
      ...(params.consultaBloqueanteId !== undefined
        ? { consultaBloqueanteId: params.consultaBloqueanteId }
        : {}),
    },
  });
  return reserva.idReserva;
};

const limpiar = async (): Promise<void> => {
  const clientes = await prisma.cliente.findMany({
    where: { email: { contains: EMAIL_PATTERN } },
    select: { idCliente: true },
  });
  const clienteIds = clientes.map((c) => c.idCliente);
  if (clienteIds.length > 0) {
    const reservas = await prisma.reserva.findMany({
      where: { clienteId: { in: clienteIds } },
      select: { idReserva: true },
    });
    const ids = reservas.map((r) => r.idReserva);
    if (ids.length > 0) {
      await prisma.reserva.deleteMany({ where: { idReserva: { in: ids } } });
    }
    await prisma.cliente.deleteMany({ where: { idCliente: { in: clienteIds } } });
  }
};

beforeAll(async () => {
  moduleRef = await Test.createTestingModule({
    imports: [ConfigModule.forRoot({ isGlobal: true }), ReservasModule],
  }).compile();
  await moduleRef.init();
  prisma = moduleRef.get(PrismaService);
  useCase = moduleRef.get(ObtenerReservaUseCase);
});

afterAll(async () => {
  await limpiar();
  await moduleRef.close();
});

beforeEach(async () => {
  await limpiar();
});

describe('GET reserva — forma del ReservaDetalle por sub-estado', () => {
  it('reserva_2a_devuelve_forma_base_con_cliente_y_sin_derivados_de_bloqueo', async () => {
    const reservaId = await sembrarReserva({
      estado: EstadoReserva.consulta,
      subEstado: SubEstadoConsulta.s2a,
    });

    const detalle = await useCase.ejecutar({ tenantId: TENANT, reservaId });

    expect(detalle.idReserva).toBe(reservaId);
    expect(detalle.estado).toBe('consulta');
    expect(detalle.subEstado).toBe('2a');
    expect(detalle.fechaEvento).toBeNull();
    expect(detalle.ttlExpiracion).toBeNull();
    expect(detalle.posicionCola).toBeNull();
    expect(detalle.consultaBloqueanteId).toBeNull();
    expect(detalle.cliente.nombre).toBe('Lectura');
    expect(detalle.cliente.email).toContain(EMAIL_PATTERN);
  });

  it('reserva_2b_devuelve_ttlExpiracion_y_fechaEvento', async () => {
    const ttl = new Date('2026-07-02T17:03:07.000Z');
    const reservaId = await sembrarReserva({
      estado: EstadoReserva.consulta,
      subEstado: SubEstadoConsulta.s2b,
      fechaEvento: FECHA_2B,
      ttlExpiracion: ttl,
    });

    const detalle = await useCase.ejecutar({ tenantId: TENANT, reservaId });

    expect(detalle.subEstado).toBe('2b');
    expect(detalle.fechaEvento).toEqual(FECHA_2B);
    expect(detalle.ttlExpiracion).toEqual(ttl);
  });

  it('duracionHoras_enum_h4_se_serializa_como_numero_4_no_null', async () => {
    const reservaId = await sembrarReserva({
      estado: EstadoReserva.consulta,
      subEstado: SubEstadoConsulta.s2b,
      fechaEvento: FECHA_2B,
      duracionHoras: DuracionHoras.h4,
    });

    const detalle = await useCase.ejecutar({ tenantId: TENANT, reservaId });

    // El enum Prisma `h4` DEBE traducirse a `4` (número), nunca `NaN` → null.
    expect(detalle.duracionHoras).toBe(4);
  });

  it('duracionHoras_enum_h8_se_serializa_como_numero_8', async () => {
    const reservaId = await sembrarReserva({
      estado: EstadoReserva.consulta,
      subEstado: SubEstadoConsulta.s2b,
      fechaEvento: FECHA_2B,
      duracionHoras: DuracionHoras.h8,
    });

    const detalle = await useCase.ejecutar({ tenantId: TENANT, reservaId });

    expect(detalle.duracionHoras).toBe(8);
  });

  it('duracionHoras_null_permanece_null', async () => {
    const reservaId = await sembrarReserva({
      estado: EstadoReserva.consulta,
      subEstado: SubEstadoConsulta.s2a,
    });

    const detalle = await useCase.ejecutar({ tenantId: TENANT, reservaId });

    expect(detalle.duracionHoras).toBeNull();
  });

  it('reserva_2d_devuelve_posicionCola_y_consultaBloqueanteId', async () => {
    const bloqueanteId = await sembrarReserva({
      estado: EstadoReserva.consulta,
      subEstado: SubEstadoConsulta.s2b,
      fechaEvento: FECHA_2D,
    });
    const reservaId = await sembrarReserva({
      estado: EstadoReserva.consulta,
      subEstado: SubEstadoConsulta.s2d,
      fechaEvento: FECHA_2D,
      posicionCola: 1,
      consultaBloqueanteId: bloqueanteId,
    });

    const detalle = await useCase.ejecutar({ tenantId: TENANT, reservaId });

    expect(detalle.subEstado).toBe('2d');
    expect(detalle.posicionCola).toBe(1);
    expect(detalle.consultaBloqueanteId).toBe(bloqueanteId);
  });
});

describe('GET reserva — aislamiento multi-tenant / no encontrado (404)', () => {
  it('reserva_de_otro_tenant_es_invisible_y_lanza_ReservaDetalleNoEncontrada', async () => {
    const reservaId = await sembrarReserva({
      estado: EstadoReserva.consulta,
      subEstado: SubEstadoConsulta.s2a,
    });

    await expect(
      useCase.ejecutar({ tenantId: OTRO_TENANT, reservaId }),
    ).rejects.toBeInstanceOf(ReservaDetalleNoEncontradaError);
  });

  it('id_inexistente_lanza_ReservaDetalleNoEncontrada', async () => {
    await expect(
      useCase.ejecutar({
        tenantId: TENANT,
        reservaId: '00000000-0000-0000-0000-999999999999',
      }),
    ).rejects.toBeInstanceOf(ReservaDetalleNoEncontradaError);
  });
});
