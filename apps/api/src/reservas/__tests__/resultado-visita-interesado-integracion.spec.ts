/**
 * TESTS DE INTEGRACIÓN de la transición «resultado de visita — cliente interesado»
 * (`2.v` → `2.b`) (US-009 / UC-08) — fase TDD RED. tasks.md Fase 3: 3.1 (guarda de
 * origen → 422), 3.2 (transición + UPDATE FECHA_BLOQUEADA + AUDIT_LOG), 3.3 (TTL
 * fresco), 3.4 (registro antes de la fecha de visita), 3.7 (E7 en COMUNICACION),
 * multi-tenancy/RLS.
 *
 * Trazabilidad: US-009, spec-delta `consultas` (Requirements de la transición a 2.b,
 * UPDATE del ttl de FECHA_BLOQUEADA al mismo valor fresco con tipo_bloqueo blando,
 * guarda de origen mono-estado, registro sin depender de la fecha de visita,
 * atomicidad, auditoría `transicion`), spec-delta `comunicaciones` (E7 registrado en
 * COMUNICACION); design.md §D-2/§D-3/§D-4.
 *
 * INTEGRACIÓN REAL contra el Postgres del docker-compose / slotify_test (no mocks): el
 * caso de uso se resuelve por DI (`ReservasModule`) y se verifica el ESTADO DE LA BD
 * tras la transición. Mismo enfoque que `programar-visita-integracion.spec.ts` (US-008)
 * y `transicion-pendiente-invitados-integracion.spec.ts` (US-007). Requiere
 * `docker compose up -d postgres` + migración + seed (tenant piloto con
 * `ttl_consulta_dias = 3` y plantilla E7 del motor de US-045).
 *
 * El TTL fresco se valida como `now + ttl_consulta_dias` (independiente del TTL previo
 * de 2.v y de la fecha de visita). Las fechas de EVENTO (la que está bloqueada) son
 * fijas y lejanas, aisladas de otras suites por patrón de email.
 *
 * RED: aún NO existe `application/registrar-resultado-visita.use-case.ts`. El import
 * falla en compilación y la batería entera está en ROJO por AUSENCIA DE IMPLEMENTACIÓN
 * (no por infraestructura: el Postgres está arriba, como prueban las suites de
 * US-004/005/007/008). GREEN es de `backend-developer`.
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
  RegistrarResultadoVisitaUseCase,
  ResultadoVisitaValidacionError,
  ReservaNoEncontradaError,
  type RegistrarResultadoVisitaComando,
} from '../application/registrar-resultado-visita.use-case';

const TENANT = '00000000-0000-0000-0000-000000000001';
const OTRO_TENANT = '00000000-0000-0000-0000-0000000000ff';
const GESTOR = '00000000-0000-0000-0000-000000000002';
const EMAIL_PATTERN = '@us009-int.test';
const DIA_MS = 24 * 60 * 60 * 1000;
/** ttl_consulta_dias del tenant piloto sembrado (default del modelo = 3). */
const TTL_CONSULTA_DIAS = 3;
/** Tolerancia (ms) al comparar el TTL fresco con `now` real de la transición. */
const TOLERANCIA_MS = 60 * 1000;

// Fechas de EVENTO (a bloquear) fijas, futuras y aisladas (una por escenario).
const FECHA_OK = new Date('2027-07-01T00:00:00.000Z');
const FECHA_ANTES = new Date('2027-07-02T00:00:00.000Z');
const FECHA_NO_2V = new Date('2027-07-03T00:00:00.000Z');
const FECHA_TERMINAL = new Date('2027-07-04T00:00:00.000Z');
const FECHA_TENANT = new Date('2027-07-05T00:00:00.000Z');
const FECHAS = [FECHA_OK, FECHA_ANTES, FECHA_NO_2V, FECHA_TERMINAL, FECHA_TENANT];

const ttlDiaPostVisita = (): Date => new Date(Date.now() - DIA_MS); // TTL previo de 2.v
const ttlVigente = (): Date => new Date(Date.now() + 30 * DIA_MS);

let moduleRef: TestingModule;
let prisma: PrismaService;
let useCase: RegistrarResultadoVisitaUseCase;

const sufijo = (): string => Math.random().toString(36).slice(2, 8);

const comando = (
  reservaId: string,
  over: Partial<RegistrarResultadoVisitaComando> = {},
): RegistrarResultadoVisitaComando => ({
  tenantId: TENANT,
  usuarioId: GESTOR,
  reservaId,
  resultado: 'interesado',
  ...over,
});

/**
 * Siembra una RESERVA (origen de la transición) con su CLIENTE y su fila de
 * FECHA_BLOQUEADA (que SIEMPRE existe al venir de 2.v). Por defecto en `consulta`/`2v`,
 * visita_realizada=false, con TTL previo = día post-visita.
 */
const sembrarReserva = async (params: {
  fecha: Date;
  estado?: EstadoReserva;
  subEstado?: SubEstadoConsulta | null;
  conBloqueo?: boolean;
  visitaProgramadaFecha?: Date | null;
  ttlPrevio?: Date;
  tenantId?: string;
}): Promise<{ reservaId: string; clienteId: string }> => {
  const tenantId = params.tenantId ?? TENANT;
  const cliente = await prisma.cliente.create({
    data: { tenantId, nombre: 'Lead', email: `lead-${sufijo()}${EMAIL_PATTERN}` },
  });
  const ttlPrevio = params.ttlPrevio ?? ttlDiaPostVisita();
  const reserva = await prisma.reserva.create({
    data: {
      tenantId,
      clienteId: cliente.idCliente,
      codigo: `TST-U009-${sufijo()}`,
      estado: params.estado ?? EstadoReserva.consulta,
      subEstado:
        params.subEstado === undefined ? SubEstadoConsulta.s2v : params.subEstado,
      canalEntrada: CanalEntrada.web,
      fechaEvento: params.fecha,
      visitaProgramadaFecha:
        params.visitaProgramadaFecha === undefined
          ? new Date(params.fecha)
          : params.visitaProgramadaFecha,
      visitaProgramadaHora: '17:30',
      visitaRealizada: false,
      ttlExpiracion: ttlPrevio,
    },
  });
  if (params.conBloqueo !== false) {
    await prisma.fechaBloqueada.create({
      data: {
        tenantId,
        fecha: params.fecha,
        reservaId: reserva.idReserva,
        tipoBloqueo: TipoBloqueo.blando,
        ttlExpiracion: ttlPrevio,
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
  useCase = moduleRef.get(RegistrarResultadoVisitaUseCase);
});

afterAll(async () => {
  await limpiar();
  await moduleRef.close();
});

beforeEach(async () => {
  await limpiar();
});

// ===========================================================================
// 3.2 / 3.3 — Happy path desde 2.v: → 2.b + visita_realizada=true + TTL fresco
//              (now + ttl_consulta_dias) + UPDATE del ttl de la MISMA fila de
//              FECHA_BLOQUEADA al mismo valor (blando) + E7 en COMUNICACION + AUDIT_LOG.
// ===========================================================================

describe('Resultado visita interesado desde 2.v → 2.b (3.2 / 3.3)', () => {
  it('debe_pasar_a_s2b_visita_realizada_true_ttl_fresco_actualizar_bloqueo_y_registrar_E7_y_audit', async () => {
    const { reservaId, clienteId } = await sembrarReserva({ fecha: FECHA_OK });
    const antes = Date.now();

    const out = await useCase.ejecutar(comando(reservaId));
    expect(out.reserva.subEstado).toBe('2b');

    const reserva = await prisma.reserva.findUnique({ where: { idReserva: reservaId } });
    expect(reserva?.subEstado).toBe(SubEstadoConsulta.s2b);
    expect(reserva?.visitaRealizada).toBe(true);

    // TTL fresco: now + ttl_consulta_dias (con tolerancia por el `now` real).
    const esperado = antes + TTL_CONSULTA_DIAS * DIA_MS;
    const ttlReserva = reserva?.ttlExpiracion?.getTime() ?? 0;
    expect(Math.abs(ttlReserva - esperado)).toBeLessThan(TOLERANCIA_MS + DIA_MS);

    // FECHA_BLOQUEADA: la MISMA fila se actualiza (no se crea una segunda ni se borra),
    // al MISMO valor de TTL que la RESERVA, y tipo_bloqueo permanece 'blando'.
    const bloqueos = await prisma.fechaBloqueada.findMany({
      where: { tenantId: TENANT, fecha: FECHA_OK },
    });
    expect(bloqueos).toHaveLength(1);
    expect(bloqueos[0].tipoBloqueo).toBe(TipoBloqueo.blando);
    expect(bloqueos[0].reservaId).toBe(reservaId);
    expect(bloqueos[0].ttlExpiracion?.getTime()).toBe(ttlReserva);

    // E7 registrado en COMUNICACION.
    const com = await prisma.comunicacion.findFirst({
      where: { tenantId: TENANT, reservaId, codigoEmail: 'E7' },
    });
    expect(com).not.toBeNull();
    expect(com?.estado).toBe('enviado');
    expect(com?.clienteId).toBe(clienteId);

    // AUDIT_LOG de la transición 2.v → 2.b con datos antes/después.
    const audit = await prisma.auditLog.findFirst({
      where: { tenantId: TENANT, entidadId: reservaId, accion: 'transicion' },
    });
    expect(audit).not.toBeNull();
    const anteriores = audit?.datosAnteriores as {
      subEstado?: string;
      visitaRealizada?: boolean;
    };
    const nuevos = audit?.datosNuevos as {
      subEstado?: string;
      visitaRealizada?: boolean;
    };
    expect(anteriores?.subEstado).toBe('2v');
    expect(anteriores?.visitaRealizada).toBe(false);
    expect(nuevos?.subEstado).toBe('2b');
    expect(nuevos?.visitaRealizada).toBe(true);
  });
});

// ===========================================================================
// 3.4 — FA: registro ANTES de la fecha de visita (visita_programada_fecha > hoy) NO
//        bloquea el registro; la transición procede y el TTL se calcula desde now.
// ===========================================================================

describe('Resultado visita interesado — registro antes de la fecha de visita (3.4)', () => {
  it('debe_permitir_la_transicion_cuando_la_visita_aun_no_ha_llegado_en_el_calendario', async () => {
    const { reservaId } = await sembrarReserva({
      fecha: FECHA_ANTES,
      visitaProgramadaFecha: new Date(Date.now() + 2 * DIA_MS), // futura
    });
    const antes = Date.now();

    await useCase.ejecutar(comando(reservaId));

    const reserva = await prisma.reserva.findUnique({ where: { idReserva: reservaId } });
    expect(reserva?.subEstado).toBe(SubEstadoConsulta.s2b);
    expect(reserva?.visitaRealizada).toBe(true);

    // TTL desde now, NO derivado de la fecha de visita futura.
    const esperado = antes + TTL_CONSULTA_DIAS * DIA_MS;
    expect(Math.abs((reserva?.ttlExpiracion?.getTime() ?? 0) - esperado)).toBeLessThan(
      TOLERANCIA_MS + DIA_MS,
    );
  });
});

// ===========================================================================
// 3.1 — Guarda de origen: RESERVA no en 2.v (p. ej. 2.b) → 422; RESERVA intacta.
// ===========================================================================

describe('Resultado visita interesado — origen no en 2.v → 422 (3.1)', () => {
  it('debe_rechazar_con_validacion_y_dejar_la_reserva_intacta_cuando_esta_en_2b', async () => {
    const { reservaId } = await sembrarReserva({
      fecha: FECHA_NO_2V,
      subEstado: SubEstadoConsulta.s2b,
      ttlPrevio: ttlVigente(),
    });

    await expect(useCase.ejecutar(comando(reservaId))).rejects.toBeInstanceOf(
      ResultadoVisitaValidacionError,
    );

    const reserva = await prisma.reserva.findUnique({ where: { idReserva: reservaId } });
    expect(reserva?.subEstado).toBe(SubEstadoConsulta.s2b);
    expect(reserva?.visitaRealizada).toBe(false);
  });
});

// ===========================================================================
// 3.1 — Guarda de origen: estado terminal → 422; RESERVA intacta.
// ===========================================================================

describe('Resultado visita interesado — estado terminal → 422 (3.1)', () => {
  it('debe_rechazar_con_validacion_cuando_la_reserva_esta_cancelada', async () => {
    const { reservaId } = await sembrarReserva({
      fecha: FECHA_TERMINAL,
      estado: EstadoReserva.reserva_cancelada,
      subEstado: null,
      conBloqueo: false,
    });

    await expect(useCase.ejecutar(comando(reservaId))).rejects.toBeInstanceOf(
      ResultadoVisitaValidacionError,
    );

    const reserva = await prisma.reserva.findUnique({ where: { idReserva: reservaId } });
    expect(reserva?.estado).toBe(EstadoReserva.reserva_cancelada);
  });
});

// ===========================================================================
// Multi-tenancy / RLS — un tenant no puede transicionar la RESERVA de otro (404).
// ===========================================================================

describe('Resultado visita interesado — aislamiento multi-tenant / RLS', () => {
  it('debe_lanzar_ReservaNoEncontrada_cuando_el_tenant_del_jwt_no_es_dueno', async () => {
    const { reservaId } = await sembrarReserva({ fecha: FECHA_TENANT });

    await expect(
      useCase.ejecutar(comando(reservaId, { tenantId: OTRO_TENANT })),
    ).rejects.toBeInstanceOf(ReservaNoEncontradaError);

    const reserva = await prisma.reserva.findUnique({ where: { idReserva: reservaId } });
    expect(reserva?.subEstado).toBe(SubEstadoConsulta.s2v);
    expect(reserva?.visitaRealizada).toBe(false);
  });
});
