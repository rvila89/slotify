/**
 * TESTS DE INTEGRACIÓN de la actualización de DATOS FISCALES DEL CLIENTE (US-014 #5, Parte B / UC-14)
 * — fase TDD RED. tasks.md Fase 3.5.
 *
 * Trazabilidad: US-014 (#5); spec-delta `presupuestos`. Contrato congelado `docs/api-spec.yml`
 * op `actualizarDatosFiscalesCliente` (`PATCH /reservas/{id}/datos-fiscales`). design.md §D-2/§D-3/§D-4.
 *
 * INTEGRACIÓN REAL contra el Postgres AISLADO de tests (`slotify_test`, `.env.test`) — NO mocks
 * (memoria del proyecto: "US-049 backend nunca probado contra BD real"): el UPDATE parcial de los
 * campos fiscales del CLIENTE y que NO se muta RESERVA ni FECHA_BLOQUEADA se verifican por el ESTADO
 * DE LA BD real, bajo el contexto RLS del tenant. Fechas/emails propios; se limpia el sembrado.
 * BD aislada (memoria: "Tests con BD aislada slotify_test").
 *
 * Cubre (§3.5):
 *   - El PATCH persiste los 5 campos fiscales del CLIENTE.
 *   - PATCH parcial: enviar solo algunos campos NO borra los demás (D-2).
 *   - NO muta la RESERVA (estado/subEstado/ttl/fechaEvento/duracionHoras/tipoEvento) ni
 *     FECHA_BLOQUEADA (D-3).
 *   - RLS: un tenant NO puede tocar el CLIENTE de la RESERVA de otro tenant → "no encontrada",
 *     sin efectos.
 *
 * RED: aún NO existe `reservas/application/actualizar-datos-fiscales-cliente.use-case.ts` ni su
 * cableado en `ReservasModule`. El import falla en compilación y la batería está en ROJO por
 * AUSENCIA DE IMPLEMENTACIÓN (el Postgres está arriba: no es fallo de infra). GREEN es de
 * `backend-developer`.
 *
 * NOTA (subagente TDD): este archivo NO se ejecuta en el subagente (sin Docker/Postgres). Su RED
 * debe confirmarse desde la SESIÓN PRINCIPAL con Postgres arriba.
 */
import { Test, type TestingModule } from '@nestjs/testing';
import { ConfigModule } from '@nestjs/config';
import { CanalEntrada, EstadoReserva, SubEstadoConsulta } from '@prisma/client';
import { ReservasModule } from '../reservas.module';
import { PrismaService } from '../../shared/prisma/prisma.service';
import {
  ActualizarDatosFiscalesClienteUseCase,
  ReservaNoEncontradaError,
  type ActualizarDatosFiscalesClienteComando,
} from '../application/actualizar-datos-fiscales-cliente.use-case';

const TENANT = '00000000-0000-0000-0000-000000000001';
const OTRO_TENANT = '00000000-0000-0000-0000-0000000000ff';
const GESTOR = '00000000-0000-0000-0000-000000000002';
const EMAIL_PATTERN = '@us014-fiscales-int.test';

let moduleRef: TestingModule;
let prisma: PrismaService;
let useCase: ActualizarDatosFiscalesClienteUseCase;

const sufijo = (): string => Math.random().toString(36).slice(2, 8);

const FISCALES_PREVIOS = {
  dniNif: '12345678Z',
  direccion: 'Calle Vieja 1',
  codigoPostal: '08001',
  poblacion: 'Barcelona',
  provincia: 'Barcelona',
} as const;

/** Siembra un CLIENTE con datos fiscales previos + una RESERVA en pre_reserva (2b) para ese cliente. */
const sembrarReservaConCliente = async (
  params: { tenantId?: string; fiscales?: Partial<typeof FISCALES_PREVIOS> } = {},
): Promise<{ reservaId: string; clienteId: string }> => {
  const tenantId = params.tenantId ?? TENANT;
  const cliente = await prisma.cliente.create({
    data: {
      tenantId,
      nombre: 'Nadia',
      apellidos: 'Ferrer',
      email: `cli-${sufijo()}${EMAIL_PATTERN}`,
      dniNif: params.fiscales?.dniNif ?? FISCALES_PREVIOS.dniNif,
      direccion: params.fiscales?.direccion ?? FISCALES_PREVIOS.direccion,
      codigoPostal: params.fiscales?.codigoPostal ?? FISCALES_PREVIOS.codigoPostal,
      poblacion: params.fiscales?.poblacion ?? FISCALES_PREVIOS.poblacion,
      provincia: params.fiscales?.provincia ?? FISCALES_PREVIOS.provincia,
    },
  });
  const reserva = await prisma.reserva.create({
    data: {
      tenantId,
      clienteId: cliente.idCliente,
      codigo: `TST-U014-${sufijo()}`,
      estado: EstadoReserva.pre_reserva,
      subEstado: SubEstadoConsulta.s2b,
      canalEntrada: CanalEntrada.web,
      fechaEvento: new Date('2028-05-10T00:00:00.000Z'),
    },
  });
  return { reservaId: reserva.idReserva, clienteId: cliente.idCliente };
};

const comando = (
  reservaId: string,
  datos: ActualizarDatosFiscalesClienteComando['datos'],
  over: Partial<ActualizarDatosFiscalesClienteComando> = {},
): ActualizarDatosFiscalesClienteComando => ({
  tenantId: TENANT,
  usuarioId: GESTOR,
  reservaId,
  datos,
  ...over,
});

const leerCliente = (clienteId: string) =>
  prisma.cliente.findUnique({ where: { idCliente: clienteId } });

const leerReserva = (reservaId: string) =>
  prisma.reserva.findUnique({ where: { idReserva: reservaId } });

const limpiar = async (): Promise<void> => {
  const clientes = await prisma.cliente.findMany({
    where: { email: { contains: EMAIL_PATTERN } },
    select: { idCliente: true },
  });
  const clienteIds = clientes.map((c) => c.idCliente);
  const reservas = await prisma.reserva.findMany({
    where: { clienteId: { in: clienteIds } },
    select: { idReserva: true },
  });
  const ids = reservas.map((r) => r.idReserva);
  if (ids.length > 0) {
    await prisma.fechaBloqueada.deleteMany({ where: { reservaId: { in: ids } } });
    await prisma.auditLog.deleteMany({ where: { entidadId: { in: ids } } });
    await prisma.reserva.deleteMany({ where: { idReserva: { in: ids } } });
  }
  if (clienteIds.length > 0) {
    await prisma.auditLog.deleteMany({ where: { entidadId: { in: clienteIds } } });
    await prisma.cliente.deleteMany({ where: { idCliente: { in: clienteIds } } });
  }
};

beforeAll(async () => {
  moduleRef = await Test.createTestingModule({
    imports: [ConfigModule.forRoot({ isGlobal: true }), ReservasModule],
  }).compile();
  await moduleRef.init();
  prisma = moduleRef.get(PrismaService);
  useCase = moduleRef.get(ActualizarDatosFiscalesClienteUseCase);
});

afterAll(async () => {
  await limpiar();
  await moduleRef.close();
});

beforeEach(async () => {
  await limpiar();
});

// ===========================================================================
// 3.5.a — Persiste los 5 campos fiscales del CLIENTE.
// ===========================================================================

describe('Datos fiscales — persiste los 5 campos del CLIENTE (3.5)', () => {
  it('debe_persistir_dni_direccion_cp_poblacion_provincia_en_el_cliente', async () => {
    const { reservaId, clienteId } = await sembrarReservaConCliente();

    const resultado = await useCase.ejecutar(
      comando(reservaId, {
        dniNif: '99999999R',
        direccion: 'Avenida Nueva 42',
        codigoPostal: '28080',
        poblacion: 'Madrid',
        provincia: 'Madrid',
      }),
    );

    const cliente = await leerCliente(clienteId);
    expect(cliente?.dniNif).toBe('99999999R');
    expect(cliente?.direccion).toBe('Avenida Nueva 42');
    expect(cliente?.codigoPostal).toBe('28080');
    expect(cliente?.poblacion).toBe('Madrid');
    expect(cliente?.provincia).toBe('Madrid');

    // El resultado devuelto refleja el estado persistido de los 5 campos.
    expect(resultado).toEqual({
      dniNif: '99999999R',
      direccion: 'Avenida Nueva 42',
      codigoPostal: '28080',
      poblacion: 'Madrid',
      provincia: 'Madrid',
    });
  });
});

// ===========================================================================
// 3.5.b — PATCH parcial (D-2): enviar solo algunos campos NO borra los demás.
// ===========================================================================

describe('Datos fiscales — PATCH parcial no borra campos previos (3.5)', () => {
  it('debe_actualizar_solo_los_enviados_y_conservar_el_resto', async () => {
    const { reservaId, clienteId } = await sembrarReservaConCliente();

    await useCase.ejecutar(
      comando(reservaId, { direccion: 'Avenida Nueva 42', codigoPostal: '28080' }),
    );

    const cliente = await leerCliente(clienteId);
    // Los enviados se actualizan.
    expect(cliente?.direccion).toBe('Avenida Nueva 42');
    expect(cliente?.codigoPostal).toBe('28080');
    // Los ausentes conservan su valor previo (no se ponen a null).
    expect(cliente?.dniNif).toBe(FISCALES_PREVIOS.dniNif);
    expect(cliente?.poblacion).toBe(FISCALES_PREVIOS.poblacion);
    expect(cliente?.provincia).toBe(FISCALES_PREVIOS.provincia);
  });
});

// ===========================================================================
// 3.5.c — Alcance estricto (D-3): NO muta la RESERVA ni FECHA_BLOQUEADA.
// ===========================================================================

describe('Datos fiscales — no muta RESERVA ni FECHA_BLOQUEADA (3.5)', () => {
  it('no_debe_cambiar_ningun_campo_de_la_reserva', async () => {
    const { reservaId } = await sembrarReservaConCliente();
    const antes = await leerReserva(reservaId);

    await useCase.ejecutar(
      comando(reservaId, { dniNif: '99999999R', direccion: 'Avenida Nueva 42' }),
    );

    const despues = await leerReserva(reservaId);
    expect(despues?.estado).toBe(antes?.estado);
    expect(despues?.subEstado).toBe(antes?.subEstado);
    expect(despues?.ttlExpiracion).toEqual(antes?.ttlExpiracion);
    expect(despues?.fechaEvento).toEqual(antes?.fechaEvento);
    expect(despues?.duracionHoras).toEqual(antes?.duracionHoras);
    expect(despues?.tipoEvento).toBe(antes?.tipoEvento);
  });

  it('no_debe_crear_ni_tocar_fecha_bloqueada', async () => {
    const { reservaId } = await sembrarReservaConCliente();
    const antes = await prisma.fechaBloqueada.count({ where: { reservaId } });

    await useCase.ejecutar(comando(reservaId, { poblacion: 'Madrid' }));

    const despues = await prisma.fechaBloqueada.count({ where: { reservaId } });
    expect(despues).toBe(antes);
  });
});

// ===========================================================================
// 3.5.d — RLS: un tenant NO puede tocar el CLIENTE de la RESERVA de otro tenant.
// ===========================================================================

describe('Datos fiscales — aislamiento multi-tenant / RLS (3.5)', () => {
  it('debe_rechazar_como_no_encontrada_y_no_mutar_el_cliente_de_otro_tenant', async () => {
    const { reservaId, clienteId } = await sembrarReservaConCliente({
      tenantId: OTRO_TENANT,
    });

    await expect(
      useCase.ejecutar(
        comando(reservaId, { dniNif: '99999999R' }, { tenantId: TENANT }),
      ),
    ).rejects.toBeInstanceOf(ReservaNoEncontradaError);

    // El CLIENTE del otro tenant sigue con sus datos fiscales previos.
    const cliente = await leerCliente(clienteId);
    expect(cliente?.dniNif).toBe(FISCALES_PREVIOS.dniNif);
  });
});
