/**
 * TESTS DE INTEGRACIÓN del alta CON FECHA (US-004 / UC-03) — fase TDD RED.
 * tasks.md Fase 3: 3.2 (2.b), 3.3 (2.d), 3.4 (2.a), 3.6 (validación `> hoy` +
 * regresión sin fecha).
 *
 * Trazabilidad: US-004, spec-delta `consultas` (Requirements "Alta con fecha
 * disponible crea una RESERVA en 2.b…", "…entra en cola (2.d)", "…va a 2.a
 * exploratoria", "Validación de fecha_evento estrictamente futura en servidor"),
 * design.md §D-1 (validación `> hoy` vía `validarFechaFutura`, divergencia A del
 * Gate 1: rechaza hoy y pasado con 400), §D-2 (bloqueo blando atómico en la tx del
 * alta, `ttl = now()+ttl_consulta_dias`), §D-3 (sub-estado declarativo), §D-5 (cola
 * `MAX+1` serializada).
 *
 * INTEGRACIÓN REAL contra el Postgres del docker-compose (no mocks): el caso de uso
 * se resuelve por DI (`ReservasModule`) y se verifica el ESTADO DE LA BD tras el
 * alta. Requiere `docker compose up -d postgres` + migración + seed (tenant piloto
 * con `ttl_consulta_dias = 3`).
 *
 * RED: hoy `AltaConsultaUseCase` IGNORA `fechaEvento` (crea siempre 2.a sin
 * FECHA_BLOQUEADA y SIN rechazar hoy/pasado): las aserciones de `s2b`/bloqueo,
 * `s2d`/cola, aviso de no-disponibilidad y rechazo de fecha inválida fallan. La
 * batería está en ROJO. El único test que pasa es la REGRESIÓN sin fecha (2.a),
 * que demuestra regresión cero de US-003. GREEN es de `backend-developer`.
 */
import { Test, type TestingModule } from '@nestjs/testing';
import { CanalEntrada, EstadoReserva, SubEstadoConsulta, TipoBloqueo } from '@prisma/client';
import { ReservasModule } from '../reservas.module';
import { PrismaService } from '../../shared/prisma/prisma.service';
import {
  AltaConsultaUseCase,
  type AltaConsultaComando,
} from '../application/alta-consulta.use-case';

const TENANT = '00000000-0000-0000-0000-000000000001';
const GESTOR = '00000000-0000-0000-0000-000000000002';
const EMAIL_PATTERN = '@us004-int.test';

const FECHA_LIBRE = new Date('2027-03-01T00:00:00.000Z');
const FECHA_COLA = new Date('2027-03-02T00:00:00.000Z');
const FECHA_EXPLORATORIA = new Date('2027-03-03T00:00:00.000Z');
const FECHA_PASADA = new Date('2020-01-01T00:00:00.000Z');
const hoyUtc = (): Date => {
  const n = new Date();
  return new Date(Date.UTC(n.getUTCFullYear(), n.getUTCMonth(), n.getUTCDate()));
};
const FECHAS = [FECHA_LIBRE, FECHA_COLA, FECHA_EXPLORATORIA, FECHA_PASADA, hoyUtc()];

let moduleRef: TestingModule;
let prisma: PrismaService;
let useCase: AltaConsultaUseCase;

type ComandoConFecha = AltaConsultaComando & { fechaEvento?: Date };
const comando = (email: string, over: Partial<ComandoConFecha> = {}): AltaConsultaComando =>
  ({
    tenantId: TENANT,
    usuarioId: GESTOR,
    canalEntrada: 'web',
    cliente: { nombre: 'Int', apellidos: 'Test', email, telefono: '600000000' },
    ...over,
  } as ComandoConFecha);

/** Inserta directamente una RESERVA bloqueante + su FECHA_BLOQUEADA (arrange). */
const sembrarBloqueante = async (params: {
  fecha: Date;
  estado: EstadoReserva;
  subEstado: SubEstadoConsulta | null;
  tipoBloqueo: TipoBloqueo;
  codigo: string;
  email: string;
}): Promise<string> => {
  const cliente = await prisma.cliente.create({
    data: { tenantId: TENANT, nombre: 'Bloqueante', email: params.email },
  });
  const reserva = await prisma.reserva.create({
    data: {
      tenantId: TENANT,
      clienteId: cliente.idCliente,
      codigo: params.codigo,
      estado: params.estado,
      subEstado: params.subEstado,
      canalEntrada: CanalEntrada.web,
      fechaEvento: params.fecha,
    },
  });
  await prisma.fechaBloqueada.create({
    data: {
      tenantId: TENANT,
      fecha: params.fecha,
      reservaId: reserva.idReserva,
      tipoBloqueo: params.tipoBloqueo,
      ttlExpiracion: params.tipoBloqueo === TipoBloqueo.blando ? new Date('2027-12-31') : null,
    },
  });
  return reserva.idReserva;
};

const limpiar = async (): Promise<void> => {
  const clientesPattern = await prisma.cliente.findMany({
    where: { tenantId: TENANT, email: { contains: EMAIL_PATTERN } },
    select: { idCliente: true },
  });
  const clienteIds = clientesPattern.map((c) => c.idCliente);
  const reservas = await prisma.reserva.findMany({
    where: {
      tenantId: TENANT,
      OR: [{ clienteId: { in: clienteIds } }, { fechaEvento: { in: FECHAS } }],
    },
    select: { idReserva: true, clienteId: true },
  });
  const ids = reservas.map((r) => r.idReserva);
  const todosClienteIds = [...new Set([...clienteIds, ...reservas.map((r) => r.clienteId)])];
  if (ids.length > 0) {
    await prisma.fechaBloqueada.deleteMany({ where: { reservaId: { in: ids } } });
    await prisma.comunicacion.deleteMany({ where: { reservaId: { in: ids } } });
    await prisma.auditLog.deleteMany({ where: { tenantId: TENANT, entidadId: { in: ids } } });
    await prisma.reserva.deleteMany({ where: { idReserva: { in: ids } } });
  }
  await prisma.fechaBloqueada.deleteMany({ where: { tenantId: TENANT, fecha: { in: FECHAS } } });
  if (todosClienteIds.length > 0) {
    await prisma.cliente.deleteMany({ where: { idCliente: { in: todosClienteIds } } });
  }
};

beforeAll(async () => {
  moduleRef = await Test.createTestingModule({ imports: [ReservasModule] }).compile();
  await moduleRef.init();
  prisma = moduleRef.get(PrismaService);
  useCase = moduleRef.get(AltaConsultaUseCase);
});

afterAll(async () => {
  await limpiar();
  await moduleRef.close();
});

beforeEach(async () => {
  await limpiar();
});

// ===========================================================================
// 3.2 — Fecha libre → RESERVA 2.b + FECHA_BLOQUEADA blando (ttl = now+3d).
// ===========================================================================

describe('Alta con fecha LIBRE → 2.b + bloqueo blando atómico (3.2)', () => {
  it('debe_crear_la_reserva_en_s2b_y_una_FECHA_BLOQUEADA_blando_con_ttl_consulta_dias', async () => {
    await useCase.ejecutar(comando(`libre${EMAIL_PATTERN}`, { fechaEvento: FECHA_LIBRE }));

    const reserva = await prisma.reserva.findFirst({
      where: { tenantId: TENANT, fechaEvento: FECHA_LIBRE },
    });
    expect(reserva?.subEstado).toBe(SubEstadoConsulta.s2b);
    expect(reserva?.ttlExpiracion).not.toBeNull();

    const bloqueo = await prisma.fechaBloqueada.findFirst({
      where: { tenantId: TENANT, fecha: FECHA_LIBRE },
    });
    expect(bloqueo).not.toBeNull();
    expect(bloqueo?.tipoBloqueo).toBe(TipoBloqueo.blando);
    expect(bloqueo?.reservaId).toBe(reserva?.idReserva);
    expect(bloqueo?.ttlExpiracion).not.toBeNull();
    // ttl = now() + ttl_consulta_dias (3 en el seed): ventana ~3 días.
    const dias = ((bloqueo!.ttlExpiracion!.getTime() - Date.now()) / 86_400_000);
    expect(dias).toBeGreaterThan(2.5);
    expect(dias).toBeLessThan(3.5);
  });
});

// ===========================================================================
// 3.3 — Fecha bloqueada por 2.b → RESERVA 2.d en cola, sin nuevo bloqueo.
// ===========================================================================

describe('Alta sobre fecha bloqueada por 2.b → cola 2.d (3.3)', () => {
  it('debe_crear_la_reserva_en_s2d_con_posicion_cola_1_y_consulta_bloqueante_sin_nuevo_bloqueo', async () => {
    const bloqueanteId = await sembrarBloqueante({
      fecha: FECHA_COLA,
      estado: EstadoReserva.consulta,
      subEstado: SubEstadoConsulta.s2b,
      tipoBloqueo: TipoBloqueo.blando,
      codigo: 'TST-U004-2B',
      email: `bloq2b${EMAIL_PATTERN}`,
    });

    await useCase.ejecutar(comando(`cola${EMAIL_PATTERN}`, { fechaEvento: FECHA_COLA }));

    const enCola = await prisma.reserva.findFirst({
      where: { tenantId: TENANT, fechaEvento: FECHA_COLA, subEstado: SubEstadoConsulta.s2d },
    });
    expect(enCola).not.toBeNull();
    expect(enCola?.posicionCola).toBe(1);
    expect(enCola?.consultaBloqueanteId).toBe(bloqueanteId);

    // No se crea una segunda FECHA_BLOQUEADA: sigue habiendo exactamente 1.
    const bloqueos = await prisma.fechaBloqueada.count({
      where: { tenantId: TENANT, fecha: FECHA_COLA },
    });
    expect(bloqueos).toBe(1);
  });
});

// ===========================================================================
// 3.4 — Fecha bloqueada por estado superior → RESERVA 2.a exploratoria.
// ===========================================================================

describe('Alta sobre fecha bloqueada por pre_reserva → 2.a exploratoria (3.4)', () => {
  it('debe_crear_la_reserva_en_s2a_sin_bloqueo_ni_cola_y_avisar_de_no_disponibilidad', async () => {
    await sembrarBloqueante({
      fecha: FECHA_EXPLORATORIA,
      estado: EstadoReserva.pre_reserva,
      subEstado: null,
      tipoBloqueo: TipoBloqueo.blando,
      codigo: 'TST-U004-PRE',
      email: `bloqpre${EMAIL_PATTERN}`,
    });

    const out = (await useCase.ejecutar(
      comando(`explora${EMAIL_PATTERN}`, { fechaEvento: FECHA_EXPLORATORIA }),
    )) as { fechaDisponible?: boolean; avisoDisponibilidad?: unknown };

    const reserva = await prisma.reserva.findFirst({
      where: {
        tenantId: TENANT,
        fechaEvento: FECHA_EXPLORATORIA,
        subEstado: SubEstadoConsulta.s2a,
      },
    });
    expect(reserva).not.toBeNull();
    expect(reserva?.posicionCola).toBeNull();
    expect(reserva?.consultaBloqueanteId).toBeNull();

    // No se crea bloqueo nuevo: sigue habiendo exactamente 1 (el de la bloqueante).
    const bloqueos = await prisma.fechaBloqueada.count({
      where: { tenantId: TENANT, fecha: FECHA_EXPLORATORIA },
    });
    expect(bloqueos).toBe(1);

    // El resultado informa de que la fecha no está disponible (aviso para la UI).
    expect(out.fechaDisponible).toBe(false);
    expect(out.avisoDisponibilidad).toBeTruthy();
  });
});

// ===========================================================================
// 3.6 — Validación servidor `fecha_evento > hoy` (estrictamente futura).
//        hoy → 400 sin efectos; pasado → 400 sin efectos.
// ===========================================================================

describe('Alta con fecha — validación `> hoy` (3.6)', () => {
  it('debe_rechazar_fecha_evento_igual_a_hoy_sin_crear_reserva_ni_bloqueo', async () => {
    const email = `hoy${EMAIL_PATTERN}`;

    await expect(
      useCase.ejecutar(comando(email, { fechaEvento: hoyUtc() })),
    ).rejects.toThrow();

    const reservas = await prisma.reserva.count({
      where: { tenantId: TENANT, fechaEvento: hoyUtc() },
    });
    const bloqueos = await prisma.fechaBloqueada.count({
      where: { tenantId: TENANT, fecha: hoyUtc() },
    });
    expect(reservas).toBe(0);
    expect(bloqueos).toBe(0);
  });

  it('debe_rechazar_fecha_evento_pasada_por_bypass_de_la_ui_sin_crear_nada', async () => {
    const email = `pasada${EMAIL_PATTERN}`;

    await expect(
      useCase.ejecutar(comando(email, { fechaEvento: FECHA_PASADA })),
    ).rejects.toThrow();

    const reservas = await prisma.reserva.count({
      where: { tenantId: TENANT, fechaEvento: FECHA_PASADA },
    });
    expect(reservas).toBe(0);
  });
});

// ===========================================================================
// 3.6 — REGRESIÓN: alta SIN fecha (US-003) sigue dando 2.a, sin bloqueo.
//        (Test verde dentro de una batería roja: prueba la regresión cero.)
// ===========================================================================

describe('Alta SIN fecha — regresión US-003 → 2.a (3.6)', () => {
  it('debe_seguir_creando_la_consulta_en_s2a_sin_FECHA_BLOQUEADA_cuando_no_hay_fecha', async () => {
    const email = `sinfecha${EMAIL_PATTERN}`;

    const out = await useCase.ejecutar(comando(email));

    const cliente = await prisma.cliente.findFirst({
      where: { tenantId: TENANT, email },
    });
    const reserva = await prisma.reserva.findFirst({
      where: { tenantId: TENANT, clienteId: cliente?.idCliente },
    });
    expect(reserva?.subEstado).toBe(SubEstadoConsulta.s2a);
    expect(reserva?.fechaEvento).toBeNull();
    expect(out.reserva.subEstado).toBe('2a');

    const bloqueos = await prisma.fechaBloqueada.count({
      where: { tenantId: TENANT, reservaId: reserva?.idReserva },
    });
    expect(bloqueos).toBe(0);
  });
});
