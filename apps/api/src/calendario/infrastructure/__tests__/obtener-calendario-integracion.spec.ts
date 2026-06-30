/**
 * TESTS DE INTEGRACIÓN de la agregación del calendario (`GET /calendario` →
 * `CalendarioResponse`, US-039 / UC-29). INTEGRACIÓN REAL contra el Postgres del
 * docker-compose: el query se resuelve por DI (`CalendarioModule`) y se verifica la
 * agregación por rango sobre RESERVA ⋈ FECHA_BLOQUEADA, el aislamiento multi-tenant
 * (RLS), el conteo de cola `enCola`, la exclusión de terminales (sin FECHA_BLOQUEADA)
 * y la NO-MUTACIÓN de la BD.
 *
 * Trazabilidad: US-039, spec-delta `calendario` (Aislamiento, Histórico, Indicador
 * de cola, Mes sin bloqueos), design.md §D-1/§D-3/§D-4/§D-7.
 *
 * Lectura pura: SIN tests de concurrencia (US-039 §Concurrencia; las garantías de
 * bloqueo de fecha residen en US-040).
 *
 * Requiere `docker compose up -d postgres` + migración + seed (tenant piloto).
 *
 * RED: aún NO existen el use-case `application/obtener-calendario.query.ts`, el puerto
 * ni el adaptador Prisma `infrastructure/calendario-query.prisma.adapter.ts`, ni el
 * `CalendarioModule` los enlaza. La batería está en ROJO POR AUSENCIA DE
 * IMPLEMENTACIÓN. GREEN es de `backend-developer`.
 */
import { Test, type TestingModule } from '@nestjs/testing';
import { ConfigModule } from '@nestjs/config';
import {
  CanalEntrada,
  EstadoReserva,
  SubEstadoConsulta,
  TipoBloqueo,
} from '@prisma/client';
import { CalendarioModule } from '../../calendario.module';
import { PrismaService } from '../../../shared/prisma/prisma.service';
import {
  ObtenerCalendarioUseCase,
  type CalendarioFechaLectura,
} from '../../application/obtener-calendario.query';

const TENANT = '00000000-0000-0000-0000-000000000001';
const OTRO_TENANT = '00000000-0000-0000-0000-0000000000ff';
const EMAIL_PATTERN = '@us039-calendario.test';

// Rango de prueba acotado al mes para evitar colisión con otras fechas sembradas.
const DESDE = new Date('2099-06-01T00:00:00.000Z');
const HASTA = new Date('2099-06-30T00:00:00.000Z');

let moduleRef: TestingModule;
let prisma: PrismaService;
let useCase: ObtenerCalendarioUseCase;

const sufijo = (): string => Math.random().toString(36).slice(2, 8);

const sembrarReservaConBloqueo = async (params: {
  estado: EstadoReserva;
  subEstado: SubEstadoConsulta | null;
  fecha: Date;
  ttlExpiracion?: Date;
  tipoBloqueo?: TipoBloqueo;
  tenantId?: string;
  cliente?: string;
}): Promise<string> => {
  const tenantId = params.tenantId ?? TENANT;
  const cliente = await prisma.cliente.create({
    data: {
      tenantId,
      nombre: params.cliente ?? 'Calendario',
      apellidos: 'Test',
      email: `cal-${sufijo()}${EMAIL_PATTERN}`,
      telefono: '600111222',
    },
  });
  const reserva = await prisma.reserva.create({
    data: {
      tenantId,
      clienteId: cliente.idCliente,
      codigo: `CAL-${sufijo()}`,
      estado: params.estado,
      subEstado: params.subEstado,
      canalEntrada: CanalEntrada.web,
      fechaEvento: params.fecha,
      ...(params.ttlExpiracion !== undefined ? { ttlExpiracion: params.ttlExpiracion } : {}),
    },
  });
  await prisma.fechaBloqueada.create({
    data: {
      tenantId,
      fecha: params.fecha,
      reservaId: reserva.idReserva,
      tipoBloqueo: params.tipoBloqueo ?? TipoBloqueo.blando,
      ...(params.ttlExpiracion !== undefined ? { ttlExpiracion: params.ttlExpiracion } : {}),
    },
  });
  return reserva.idReserva;
};

const sembrarEnCola = async (params: {
  fecha: Date;
  consultaBloqueanteId: string;
  posicionCola: number;
  tenantId?: string;
}): Promise<string> => {
  const tenantId = params.tenantId ?? TENANT;
  const cliente = await prisma.cliente.create({
    data: {
      tenantId,
      nombre: 'EnCola',
      apellidos: 'Test',
      email: `cola-${sufijo()}${EMAIL_PATTERN}`,
      telefono: '600333444',
    },
  });
  const reserva = await prisma.reserva.create({
    data: {
      tenantId,
      clienteId: cliente.idCliente,
      codigo: `COLA-${sufijo()}`,
      estado: EstadoReserva.consulta,
      subEstado: SubEstadoConsulta.s2d,
      canalEntrada: CanalEntrada.web,
      fechaEvento: params.fecha,
      posicionCola: params.posicionCola,
      consultaBloqueanteId: params.consultaBloqueanteId,
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
  if (clienteIds.length === 0) return;
  const reservas = await prisma.reserva.findMany({
    where: { clienteId: { in: clienteIds } },
    select: { idReserva: true },
  });
  const ids = reservas.map((r) => r.idReserva);
  if (ids.length > 0) {
    await prisma.fechaBloqueada.deleteMany({ where: { reservaId: { in: ids } } });
    // Limpia primero las que apuntan a una bloqueante (FK consultaBloqueanteId).
    await prisma.reserva.updateMany({
      where: { idReserva: { in: ids } },
      data: { consultaBloqueanteId: null },
    });
    await prisma.reserva.deleteMany({ where: { idReserva: { in: ids } } });
  }
  await prisma.cliente.deleteMany({ where: { idCliente: { in: clienteIds } } });
};

beforeAll(async () => {
  moduleRef = await Test.createTestingModule({
    imports: [ConfigModule.forRoot({ isGlobal: true }), CalendarioModule],
  }).compile();
  await moduleRef.init();
  prisma = moduleRef.get(PrismaService);
  useCase = moduleRef.get(ObtenerCalendarioUseCase);
});

afterAll(async () => {
  await limpiar();
  await moduleRef.close();
});

beforeEach(async () => {
  await limpiar();
});

describe('Calendario — agregación por rango: solo fechas ocupadas del tenant', () => {
  it('debe_devolver_una_entrada_por_fecha_ocupada_con_su_color_canonico', async () => {
    await sembrarReservaConBloqueo({
      estado: EstadoReserva.consulta,
      subEstado: SubEstadoConsulta.s2b,
      fecha: new Date('2099-06-12T00:00:00.000Z'),
      ttlExpiracion: new Date('2099-06-14T17:00:00.000Z'),
    });
    await sembrarReservaConBloqueo({
      estado: EstadoReserva.reserva_confirmada,
      subEstado: null,
      fecha: new Date('2099-06-20T00:00:00.000Z'),
      tipoBloqueo: TipoBloqueo.firme,
    });

    const resultado = await useCase.ejecutar({
      tenantId: TENANT,
      desde: DESDE,
      hasta: HASTA,
      vista: 'mes',
    });

    expect(resultado.fechas).toHaveLength(2);
    const porColor = resultado.fechas.map((f: CalendarioFechaLectura) => f.color).sort();
    expect(porColor).toEqual(['gris', 'verde']);
  });

  it('debe_devolver_fechas_vacio_cuando_el_rango_no_tiene_bloqueos', async () => {
    const resultado = await useCase.ejecutar({
      tenantId: TENANT,
      desde: DESDE,
      hasta: HASTA,
      vista: 'mes',
    });

    expect(resultado.fechas).toEqual([]);
  });
});

describe('Calendario — conteo de cola (enCola)', () => {
  it('debe_contar_enCola_N_para_una_fecha_2b_con_N_reservas_en_2d', async () => {
    const fecha = new Date('2099-06-15T00:00:00.000Z');
    const bloqueanteId = await sembrarReservaConBloqueo({
      estado: EstadoReserva.consulta,
      subEstado: SubEstadoConsulta.s2b,
      fecha,
      ttlExpiracion: new Date('2099-06-17T00:00:00.000Z'),
    });
    await sembrarEnCola({ fecha, consultaBloqueanteId: bloqueanteId, posicionCola: 1 });
    await sembrarEnCola({ fecha, consultaBloqueanteId: bloqueanteId, posicionCola: 2 });

    const resultado = await useCase.ejecutar({
      tenantId: TENANT,
      desde: DESDE,
      hasta: HASTA,
      vista: 'mes',
    });

    const celda = resultado.fechas.find((f: CalendarioFechaLectura) => f.reservaId === bloqueanteId);
    expect(celda).toBeDefined();
    expect(celda?.color).toBe('gris');
    expect(celda?.enCola).toBe(2);
  });

  it('debe_devolver_enCola_0_cuando_la_fecha_no_tiene_cola', async () => {
    const bloqueanteId = await sembrarReservaConBloqueo({
      estado: EstadoReserva.consulta,
      subEstado: SubEstadoConsulta.s2b,
      fecha: new Date('2099-06-16T00:00:00.000Z'),
      ttlExpiracion: new Date('2099-06-18T00:00:00.000Z'),
    });

    const resultado = await useCase.ejecutar({
      tenantId: TENANT,
      desde: DESDE,
      hasta: HASTA,
      vista: 'mes',
    });

    const celda = resultado.fechas.find((f: CalendarioFechaLectura) => f.reservaId === bloqueanteId);
    expect(celda?.enCola).toBe(0);
  });
});

describe('Calendario — aislamiento multi-tenant (CRÍTICO)', () => {
  it('no_debe_mostrar_fechas_de_otro_tenant', async () => {
    const propia = await sembrarReservaConBloqueo({
      estado: EstadoReserva.consulta,
      subEstado: SubEstadoConsulta.s2b,
      fecha: new Date('2099-06-10T00:00:00.000Z'),
      ttlExpiracion: new Date('2099-06-12T00:00:00.000Z'),
      tenantId: TENANT,
    });
    const ajena = await sembrarReservaConBloqueo({
      estado: EstadoReserva.consulta,
      subEstado: SubEstadoConsulta.s2b,
      fecha: new Date('2099-06-11T00:00:00.000Z'),
      ttlExpiracion: new Date('2099-06-13T00:00:00.000Z'),
      tenantId: OTRO_TENANT,
    });

    const resultado = await useCase.ejecutar({
      tenantId: TENANT,
      desde: DESDE,
      hasta: HASTA,
      vista: 'mes',
    });

    const ids = resultado.fechas.map((f: CalendarioFechaLectura) => f.reservaId);
    expect(ids).toContain(propia);
    expect(ids).not.toContain(ajena);
  });
});

describe('Calendario — histórico y terminales', () => {
  it('debe_pintar_completada_azul_y_cancelada_rojo_y_excluir_terminales', async () => {
    const completadaId = await sembrarReservaConBloqueo({
      estado: EstadoReserva.reserva_completada,
      subEstado: null,
      fecha: new Date('2099-06-05T00:00:00.000Z'),
      tipoBloqueo: TipoBloqueo.firme,
    });
    const canceladaId = await sembrarReservaConBloqueo({
      estado: EstadoReserva.reserva_cancelada,
      subEstado: null,
      fecha: new Date('2099-06-06T00:00:00.000Z'),
      tipoBloqueo: TipoBloqueo.firme,
    });
    // Consulta terminal 2x: su bloqueo YA fue liberado → NO hay FechaBloqueada → no aparece.
    const cliente = await prisma.cliente.create({
      data: {
        tenantId: TENANT,
        nombre: 'Terminal',
        apellidos: 'Test',
        email: `term-${sufijo()}${EMAIL_PATTERN}`,
        telefono: '600999000',
      },
    });
    const terminal = await prisma.reserva.create({
      data: {
        tenantId: TENANT,
        clienteId: cliente.idCliente,
        codigo: `TERM-${sufijo()}`,
        estado: EstadoReserva.consulta,
        subEstado: SubEstadoConsulta.s2x,
        canalEntrada: CanalEntrada.web,
        fechaEvento: new Date('2099-06-07T00:00:00.000Z'),
      },
    });

    const resultado = await useCase.ejecutar({
      tenantId: TENANT,
      desde: DESDE,
      hasta: HASTA,
      vista: 'mes',
    });

    const completada = resultado.fechas.find((f: CalendarioFechaLectura) => f.reservaId === completadaId);
    const cancelada = resultado.fechas.find((f: CalendarioFechaLectura) => f.reservaId === canceladaId);
    expect(completada?.color).toBe('azul');
    expect(cancelada?.color).toBe('rojo');
    // La consulta terminal (sin FechaBloqueada) NO aparece como celda coloreada.
    expect(resultado.fechas.map((f: CalendarioFechaLectura) => f.reservaId)).not.toContain(terminal.idReserva);
  });
});

describe('Calendario — no-mutación (lectura pura)', () => {
  it('no_debe_modificar_RESERVA_ni_FECHA_BLOQUEADA_al_consultar', async () => {
    const reservaId = await sembrarReservaConBloqueo({
      estado: EstadoReserva.consulta,
      subEstado: SubEstadoConsulta.s2b,
      fecha: new Date('2099-06-22T00:00:00.000Z'),
      ttlExpiracion: new Date('2099-06-24T00:00:00.000Z'),
    });

    const antesReserva = await prisma.reserva.findUnique({ where: { idReserva: reservaId } });
    const antesBloqueo = await prisma.fechaBloqueada.findUnique({
      where: { reservaId },
    });

    await useCase.ejecutar({ tenantId: TENANT, desde: DESDE, hasta: HASTA, vista: 'mes' });

    const despuesReserva = await prisma.reserva.findUnique({ where: { idReserva: reservaId } });
    const despuesBloqueo = await prisma.fechaBloqueada.findUnique({
      where: { reservaId },
    });

    expect(despuesReserva).toEqual(antesReserva);
    expect(despuesBloqueo).toEqual(antesBloqueo);
  });
});
