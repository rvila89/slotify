/**
 * TESTS DE INTEGRACIÓN de la transición «programar visita al espacio»
 * (`2.a`/`2.b`/`2.c` → `2.v`) (US-008 / UC-07) — fase TDD RED. tasks.md Fase 3:
 * 3.1 (guarda de origen + 409 cola), 3.2 (2a sin fecha_evento), 3.3 (ventana),
 * 3.4 (UPDATE desde 2b/2c), 3.5 (INSERT desde 2a), 3.8 (E6 en COMUNICACION),
 * AUDIT_LOG + multi-tenancy/RLS.
 *
 * Trazabilidad: US-008, spec-delta `consultas` (Requirements de la transición a 2.v,
 * bloqueo insert-o-update fase 2.v, ventana max_dias_programar_visita, guarda de
 * origen, 2a exige fecha_evento, atomicidad, auditoría `transicion`), spec-delta
 * `comunicaciones` (E6 registrado en COMUNICACION); design.md §D-2/§D-3/§D-4/§D-6.
 *
 * INTEGRACIÓN REAL contra el Postgres del docker-compose (no mocks): el caso de uso
 * se resuelve por DI (`ReservasModule`) y se verifica el ESTADO DE LA BD tras la
 * transición. Mismo enfoque que `transicion-pendiente-invitados-integracion.spec.ts`
 * (US-007). Requiere `docker compose up -d postgres` + migración + seed (tenant
 * piloto con `max_dias_programar_visita = 7`).
 *
 * El TTL del bloqueo se valida como "fecha de visita + 1 día (23:59:59)". Las fechas
 * de visita se calculan RELATIVAS a `now()` para caer dentro de la ventana
 * [hoy+1, hoy+7] del setting; las fechas de EVENTO (la que se bloquea) son fijas y
 * lejanas, aisladas de otras suites.
 *
 * RED: aún NO existe `application/programar-visita.use-case.ts`. El import falla en
 * compilación y la batería entera está en ROJO por AUSENCIA DE IMPLEMENTACIÓN (no por
 * infraestructura: el Postgres está arriba, como prueban las suites de US-004/005/007).
 * GREEN es de `backend-developer`.
 */
import { Test, type TestingModule } from '@nestjs/testing';
import { ConfigModule } from '@nestjs/config';
import {
  CanalEntrada,
  EstadoReserva,
  SubEstadoConsulta,
  TipoBloqueo,
} from '@prisma/client';
import { ReservasModule } from '../reservas.module';
import { PrismaService } from '../../shared/prisma/prisma.service';
import {
  ProgramarVisitaUseCase,
  ProgramarVisitaValidacionError,
  VisitaEnColaError,
  ReservaNoEncontradaError,
  type ProgramarVisitaComando,
} from '../application/programar-visita.use-case';

const TENANT = '00000000-0000-0000-0000-000000000001';
const OTRO_TENANT = '00000000-0000-0000-0000-0000000000ff';
const GESTOR = '00000000-0000-0000-0000-000000000002';
const EMAIL_PATTERN = '@us008-int.test';
const DIA_MS = 24 * 60 * 60 * 1000;

// Fechas de EVENTO (a bloquear) fijas, futuras y aisladas (una por escenario).
const FECHA_2B = new Date('2027-06-01T00:00:00.000Z');
const FECHA_2A = new Date('2027-06-02T00:00:00.000Z');
const FECHA_2C = new Date('2027-06-03T00:00:00.000Z');
const FECHA_2D = new Date('2027-06-04T00:00:00.000Z');
const FECHA_TERMINAL = new Date('2027-06-05T00:00:00.000Z');
const FECHA_2A_SIN_EVENTO = new Date('2027-06-06T00:00:00.000Z');
const FECHA_VENTANA = new Date('2027-06-07T00:00:00.000Z');
const FECHA_TENANT = new Date('2027-06-08T00:00:00.000Z');
const FECHAS = [
  FECHA_2B,
  FECHA_2A,
  FECHA_2C,
  FECHA_2D,
  FECHA_TERMINAL,
  FECHA_2A_SIN_EVENTO,
  FECHA_VENTANA,
  FECHA_TENANT,
];

const ttlVigente = (): Date => new Date(Date.now() + 30 * DIA_MS);

/** Día UTC truncado (para una `fecha_visita` sin hora). */
const diaUtc = (offsetDias: number): Date => {
  const d = new Date(Date.now() + offsetDias * DIA_MS);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
};

/** TTL esperado del bloqueo de visita: fecha_visita + 1 día a las 23:59:59 UTC. */
const ttlEsperado = (visita: Date): number =>
  Date.UTC(
    visita.getUTCFullYear(),
    visita.getUTCMonth(),
    visita.getUTCDate() + 1,
    23,
    59,
    59,
  );

let moduleRef: TestingModule;
let prisma: PrismaService;
let useCase: ProgramarVisitaUseCase;

const sufijo = (): string => Math.random().toString(36).slice(2, 8);

const comando = (
  reservaId: string,
  over: Partial<ProgramarVisitaComando> = {},
): ProgramarVisitaComando => ({
  tenantId: TENANT,
  usuarioId: GESTOR,
  reservaId,
  fechaVisita: diaUtc(3), // hoy + 3 días: dentro de [hoy+1, hoy+7]
  horaVisita: '17:30',
  ...over,
});

/**
 * Siembra una RESERVA (origen de la transición) con su CLIENTE. Por defecto en
 * `consulta`/`2b` con fila `FECHA_BLOQUEADA` vigente. `conBloqueo:false` (origen 2a)
 * NO crea la fila de bloqueo.
 */
const sembrarReserva = async (params: {
  fecha: Date;
  estado?: EstadoReserva;
  subEstado?: SubEstadoConsulta | null;
  conBloqueo?: boolean;
  fechaEvento?: Date | null;
  tenantId?: string;
}): Promise<{ reservaId: string; clienteId: string }> => {
  const tenantId = params.tenantId ?? TENANT;
  const cliente = await prisma.cliente.create({
    data: { tenantId, nombre: 'Lead', email: `lead-${sufijo()}${EMAIL_PATTERN}` },
  });
  const fechaEvento =
    params.fechaEvento === undefined ? params.fecha : params.fechaEvento;
  const reserva = await prisma.reserva.create({
    data: {
      tenantId,
      clienteId: cliente.idCliente,
      codigo: `TST-U008-${sufijo()}`,
      estado: params.estado ?? EstadoReserva.consulta,
      subEstado:
        params.subEstado === undefined ? SubEstadoConsulta.s2b : params.subEstado,
      canalEntrada: CanalEntrada.web,
      fechaEvento,
      ttlExpiracion: ttlVigente(),
    },
  });
  if (params.conBloqueo !== false && fechaEvento !== null) {
    await prisma.fechaBloqueada.create({
      data: {
        tenantId,
        fecha: fechaEvento,
        reservaId: reserva.idReserva,
        tipoBloqueo: TipoBloqueo.blando,
        ttlExpiracion: ttlVigente(),
      },
    });
  }
  return { reservaId: reserva.idReserva, clienteId: cliente.idCliente };
};

const limpiar = async (): Promise<void> => {
  const clientesPattern = await prisma.cliente.findMany({
    where: { email: { contains: EMAIL_PATTERN } },
    select: { idCliente: true },
  });
  const clienteIds = clientesPattern.map((c) => c.idCliente);
  const reservas = await prisma.reserva.findMany({
    where: { OR: [{ clienteId: { in: clienteIds } }, { fechaEvento: { in: FECHAS } }] },
    select: { idReserva: true, clienteId: true },
  });
  const ids = reservas.map((r) => r.idReserva);
  const todosClienteIds = [...new Set([...clienteIds, ...reservas.map((r) => r.clienteId)])];
  if (ids.length > 0) {
    await prisma.fechaBloqueada.deleteMany({ where: { reservaId: { in: ids } } });
    await prisma.comunicacion.deleteMany({ where: { reservaId: { in: ids } } });
    await prisma.auditLog.deleteMany({ where: { entidadId: { in: ids } } });
    await prisma.reserva.deleteMany({ where: { idReserva: { in: ids } } });
  }
  await prisma.fechaBloqueada.deleteMany({ where: { fecha: { in: FECHAS } } });
  if (todosClienteIds.length > 0) {
    await prisma.cliente.deleteMany({ where: { idCliente: { in: todosClienteIds } } });
  }
};

beforeAll(async () => {
  moduleRef = await Test.createTestingModule({
    imports: [ConfigModule.forRoot({ isGlobal: true }), ReservasModule],
  }).compile();
  await moduleRef.init();
  prisma = moduleRef.get(PrismaService);
  useCase = moduleRef.get(ProgramarVisitaUseCase);
});

afterAll(async () => {
  await limpiar();
  await moduleRef.close();
});

beforeEach(async () => {
  await limpiar();
});

// ===========================================================================
// 3.4 — Happy path desde 2.b: → 2.v + campos de visita + UPDATE del ttl de la fila
//        existente de FECHA_BLOQUEADA a visita+1día + E6 en COMUNICACION + AUDIT_LOG.
// ===========================================================================

describe('Programar visita desde 2.b → 2.v actualiza el bloqueo existente (3.4)', () => {
  it('debe_pasar_a_s2v_fijar_campos_de_visita_actualizar_ttl_y_registrar_E6_y_audit', async () => {
    const { reservaId, clienteId } = await sembrarReserva({ fecha: FECHA_2B });
    const visita = diaUtc(3);

    const out = await useCase.ejecutar(comando(reservaId, { fechaVisita: visita }));
    expect(out.reserva.subEstado).toBe('2v');

    const reserva = await prisma.reserva.findUnique({ where: { idReserva: reservaId } });
    expect(reserva?.subEstado).toBe(SubEstadoConsulta.s2v);
    expect(reserva?.visitaProgramadaFecha?.getTime()).toBe(visita.getTime());
    expect(reserva?.visitaProgramadaHora).toBe('17:30');
    expect(reserva?.visitaRealizada).toBe(false);

    // FECHA_BLOQUEADA: la MISMA fila se actualiza (no se crea una segunda).
    const bloqueos = await prisma.fechaBloqueada.findMany({
      where: { tenantId: TENANT, fecha: FECHA_2B },
    });
    expect(bloqueos).toHaveLength(1);
    expect(bloqueos[0].tipoBloqueo).toBe(TipoBloqueo.blando);
    expect(bloqueos[0].ttlExpiracion?.getTime()).toBe(ttlEsperado(visita));

    // E6 registrado en COMUNICACION.
    const com = await prisma.comunicacion.findFirst({
      where: { tenantId: TENANT, reservaId, codigoEmail: 'E6' },
    });
    expect(com).not.toBeNull();
    expect(com?.estado).toBe('enviado');
    expect(com?.clienteId).toBe(clienteId);

    // AUDIT_LOG de la transición.
    const audit = await prisma.auditLog.findFirst({
      where: { tenantId: TENANT, entidadId: reservaId, accion: 'transicion' },
    });
    expect(audit).not.toBeNull();
    expect((audit?.datosAnteriores as { subEstado?: string })?.subEstado).toBe('2b');
    expect((audit?.datosNuevos as { subEstado?: string })?.subEstado).toBe('2v');
  });
});

// ===========================================================================
// 3.5 — Happy path desde 2.a sin bloqueo: → 2.v + INSERT de una NUEVA fila blanda
//        con TTL = visita+1día; E6 en COMUNICACION.
// ===========================================================================

describe('Programar visita desde 2.a → 2.v crea una nueva fila de bloqueo (3.5)', () => {
  it('debe_pasar_a_s2v_e_insertar_una_fila_blanda_con_ttl_visita_mas_un_dia_y_E6', async () => {
    const { reservaId } = await sembrarReserva({
      fecha: FECHA_2A,
      subEstado: SubEstadoConsulta.s2a,
      conBloqueo: false,
      fechaEvento: FECHA_2A,
    });
    const visita = diaUtc(2);

    // Sin fila de bloqueo de partida.
    const antes = await prisma.fechaBloqueada.count({
      where: { tenantId: TENANT, fecha: FECHA_2A },
    });
    expect(antes).toBe(0);

    await useCase.ejecutar(comando(reservaId, { fechaVisita: visita }));

    const reserva = await prisma.reserva.findUnique({ where: { idReserva: reservaId } });
    expect(reserva?.subEstado).toBe(SubEstadoConsulta.s2v);

    const bloqueos = await prisma.fechaBloqueada.findMany({
      where: { tenantId: TENANT, fecha: FECHA_2A },
    });
    expect(bloqueos).toHaveLength(1);
    expect(bloqueos[0].tipoBloqueo).toBe(TipoBloqueo.blando);
    expect(bloqueos[0].ttlExpiracion?.getTime()).toBe(ttlEsperado(visita));

    const com = await prisma.comunicacion.findFirst({
      where: { tenantId: TENANT, reservaId, codigoEmail: 'E6' },
    });
    expect(com).not.toBeNull();
  });
});

// ===========================================================================
// 3.4 — Happy path desde 2.c: → 2.v + UPDATE del ttl de la fila existente (extiende
//        el bloqueo previo de 2.c) + E6.
// ===========================================================================

describe('Programar visita desde 2.c → 2.v extiende el bloqueo previo (3.4)', () => {
  it('debe_pasar_a_s2v_y_actualizar_el_ttl_de_la_fila_existente_de_2c', async () => {
    const { reservaId } = await sembrarReserva({
      fecha: FECHA_2C,
      subEstado: SubEstadoConsulta.s2c,
    });
    const visita = diaUtc(5);

    await useCase.ejecutar(comando(reservaId, { fechaVisita: visita }));

    const reserva = await prisma.reserva.findUnique({ where: { idReserva: reservaId } });
    expect(reserva?.subEstado).toBe(SubEstadoConsulta.s2v);

    const bloqueos = await prisma.fechaBloqueada.findMany({
      where: { tenantId: TENANT, fecha: FECHA_2C },
    });
    expect(bloqueos).toHaveLength(1);
    expect(bloqueos[0].ttlExpiracion?.getTime()).toBe(ttlEsperado(visita));
  });
});

// ===========================================================================
// 3.1 — Guarda de origen: 2.d → 409 (promover primero, UC-12); RESERVA intacta.
// ===========================================================================

describe('Programar visita — cola 2.d → 409 (UC-12) (3.1)', () => {
  it('debe_rechazar_con_409_y_dejar_la_reserva_en_2d', async () => {
    const { reservaId } = await sembrarReserva({
      fecha: FECHA_2D,
      subEstado: SubEstadoConsulta.s2d,
      conBloqueo: false,
    });

    await expect(useCase.ejecutar(comando(reservaId))).rejects.toBeInstanceOf(
      VisitaEnColaError,
    );

    const reserva = await prisma.reserva.findUnique({ where: { idReserva: reservaId } });
    expect(reserva?.subEstado).toBe(SubEstadoConsulta.s2d);
    expect(reserva?.visitaProgramadaFecha).toBeNull();
  });
});

// ===========================================================================
// 3.1 — Guarda de origen: estado terminal → 422; RESERVA intacta.
// ===========================================================================

describe('Programar visita — estado terminal → 422 (3.1)', () => {
  it('debe_rechazar_con_validacion_cuando_la_reserva_esta_cancelada', async () => {
    const { reservaId } = await sembrarReserva({
      fecha: FECHA_TERMINAL,
      estado: EstadoReserva.reserva_cancelada,
      subEstado: null,
      conBloqueo: false,
    });

    await expect(useCase.ejecutar(comando(reservaId))).rejects.toBeInstanceOf(
      ProgramarVisitaValidacionError,
    );

    const reserva = await prisma.reserva.findUnique({ where: { idReserva: reservaId } });
    expect(reserva?.estado).toBe(EstadoReserva.reserva_cancelada);
    expect(reserva?.visitaProgramadaFecha).toBeNull();
  });
});

// ===========================================================================
// 3.2 — 2.a sin fecha_evento → 422; RESERVA intacta, sin bloqueo creado.
// ===========================================================================

describe('Programar visita — 2.a sin fecha_evento → 422 (3.2)', () => {
  it('debe_rechazar_y_no_crear_bloqueo_cuando_la_reserva_2a_no_tiene_fecha_evento', async () => {
    const { reservaId } = await sembrarReserva({
      fecha: FECHA_2A_SIN_EVENTO,
      subEstado: SubEstadoConsulta.s2a,
      conBloqueo: false,
      fechaEvento: null,
    });

    await expect(useCase.ejecutar(comando(reservaId))).rejects.toBeInstanceOf(
      ProgramarVisitaValidacionError,
    );

    const reserva = await prisma.reserva.findUnique({ where: { idReserva: reservaId } });
    expect(reserva?.subEstado).toBe(SubEstadoConsulta.s2a);
    const bloqueos = await prisma.fechaBloqueada.count({
      where: { reservaId },
    });
    expect(bloqueos).toBe(0);
  });
});

// ===========================================================================
// 3.3 — Ventana: fecha ≤ hoy y fecha > hoy + max_dias_programar_visita → 422.
// ===========================================================================

describe('Programar visita — ventana de fecha desde el setting (3.3)', () => {
  it('debe_rechazar_cuando_la_fecha_de_visita_es_hoy_o_pasada', async () => {
    const { reservaId } = await sembrarReserva({ fecha: FECHA_VENTANA });

    await expect(
      useCase.ejecutar(comando(reservaId, { fechaVisita: diaUtc(0) })),
    ).rejects.toBeInstanceOf(ProgramarVisitaValidacionError);

    const reserva = await prisma.reserva.findUnique({ where: { idReserva: reservaId } });
    expect(reserva?.subEstado).toBe(SubEstadoConsulta.s2b);
  });

  it('debe_rechazar_cuando_la_fecha_de_visita_excede_el_limite_del_setting', async () => {
    const { reservaId } = await sembrarReserva({ fecha: FECHA_VENTANA });
    // hoy + 30 días: muy por encima de max_dias_programar_visita (=7 en el seed).
    await expect(
      useCase.ejecutar(comando(reservaId, { fechaVisita: diaUtc(30) })),
    ).rejects.toBeInstanceOf(ProgramarVisitaValidacionError);

    const reserva = await prisma.reserva.findUnique({ where: { idReserva: reservaId } });
    expect(reserva?.subEstado).toBe(SubEstadoConsulta.s2b);
  });
});

// ===========================================================================
// Multi-tenancy / RLS — un tenant no puede transicionar la RESERVA de otro (404).
// ===========================================================================

describe('Programar visita — aislamiento multi-tenant / RLS', () => {
  it('debe_lanzar_ReservaNoEncontrada_cuando_el_tenant_del_jwt_no_es_dueno', async () => {
    const { reservaId } = await sembrarReserva({ fecha: FECHA_TENANT });

    await expect(
      useCase.ejecutar(comando(reservaId, { tenantId: OTRO_TENANT })),
    ).rejects.toBeInstanceOf(ReservaNoEncontradaError);

    const reserva = await prisma.reserva.findUnique({ where: { idReserva: reservaId } });
    expect(reserva?.subEstado).toBe(SubEstadoConsulta.s2b);
  });
});
