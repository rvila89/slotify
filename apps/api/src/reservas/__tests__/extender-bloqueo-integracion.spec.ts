/**
 * TESTS DE INTEGRACIÓN de la extensión manual del TTL del bloqueo blando
 * (`POST /reservas/{id}/extender-bloqueo`) (US-006 / UC-05) — fase TDD RED.
 * tasks.md Fase 3: 3.2 (happy path 2b/2c/2v/pre_reserva), 3.3 (invariancia),
 * 3.4 (atomicidad), 3.6 (TTL expirado), 3.7 (sin bloqueo / firme), AUDIT_LOG + RLS.
 *
 * Trazabilidad: US-006, spec-delta `consultas` (Requirements de la extensión atómica
 * de RESERVA + FECHA_BLOQUEADA, auditoría `actualizar`, invariancia D-8, edge cases
 * TTL expirado / sin bloqueo / firme); design.md §D-4/§D-8/§D-9.
 *
 * INTEGRACIÓN REAL contra el Postgres del docker-compose (no mocks): el caso de uso
 * se resuelve por DI (`ReservasModule`) y se verifica el ESTADO DE LA BD tras la
 * extensión. Mismo enfoque que `programar-visita-integracion.spec.ts` (US-008).
 * Requiere `docker compose up -d postgres` + migración + seed.
 *
 * La extensión NO depende de `now()`: el nuevo TTL = `ttl_expiracion` ACTUAL + N días.
 * Para asertarlo de forma determinista se siembra un TTL VIGENTE conocido y se
 * comprueba `nuevoTtl == ttlSembrado + N días` en RESERVA y en FECHA_BLOQUEADA.
 *
 * RED: aún NO existe `application/extender-bloqueo.use-case.ts`. La batería entera
 * está en ROJO por AUSENCIA DE IMPLEMENTACIÓN (no por infraestructura: el Postgres
 * está arriba, como prueban las suites de US-004/005/007/008). GREEN es de
 * `backend-developer`.
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
  ExtenderBloqueoUseCase,
  ExtenderBloqueoValidacionError,
  BloqueoNoExtensibleError,
  ReservaNoEncontradaError,
  type ExtenderBloqueoComando,
} from '../application/extender-bloqueo.use-case';

const TENANT = '00000000-0000-0000-0000-000000000001';
const OTRO_TENANT = '00000000-0000-0000-0000-0000000000ff';
const GESTOR = '00000000-0000-0000-0000-000000000002';
const EMAIL_PATTERN = '@us006-int.test';
const DIA_MS = 24 * 60 * 60 * 1000;

// Fechas de EVENTO (a bloquear) fijas, futuras y aisladas (una por escenario).
const FECHA_2B = new Date('2027-08-01T00:00:00.000Z');
const FECHA_2C = new Date('2027-08-02T00:00:00.000Z');
const FECHA_2V = new Date('2027-08-03T00:00:00.000Z');
const FECHA_PRE = new Date('2027-08-04T00:00:00.000Z');
const FECHA_EXPIRADO = new Date('2027-08-05T00:00:00.000Z');
const FECHA_SIN_BLOQUEO = new Date('2027-08-06T00:00:00.000Z');
const FECHA_FIRME = new Date('2027-08-07T00:00:00.000Z');
const FECHA_2A = new Date('2027-08-08T00:00:00.000Z');
const FECHA_TENANT = new Date('2027-08-09T00:00:00.000Z');
const FECHAS = [
  FECHA_2B,
  FECHA_2C,
  FECHA_2V,
  FECHA_PRE,
  FECHA_EXPIRADO,
  FECHA_SIN_BLOQUEO,
  FECHA_FIRME,
  FECHA_2A,
  FECHA_TENANT,
];

const DIAS = 7;
/** TTL vigente conocido (no relativo a un reloj de test): ahora + 10 días. */
const ttlVigente = (): Date => new Date(Date.now() + 10 * DIA_MS);
/** TTL ya vencido: ahora - 1 día. */
const ttlVencido = (): Date => new Date(Date.now() - DIA_MS);

let moduleRef: TestingModule;
let prisma: PrismaService;
let useCase: ExtenderBloqueoUseCase;

const sufijo = (): string => Math.random().toString(36).slice(2, 8);

const comando = (
  reservaId: string,
  over: Partial<ExtenderBloqueoComando> = {},
): ExtenderBloqueoComando => ({
  tenantId: TENANT,
  usuarioId: GESTOR,
  reservaId,
  dias: DIAS,
  ...over,
});

/**
 * Siembra una RESERVA con su CLIENTE y (salvo `conBloqueo:false`) su fila
 * FECHA_BLOQUEADA. RESERVA y bloqueo comparten el MISMO `ttlExpiracion` sembrado
 * (coherente con la operación, que los mantiene sincronizados).
 */
const sembrarReserva = async (params: {
  fecha: Date;
  estado?: EstadoReserva;
  subEstado?: SubEstadoConsulta | null;
  conBloqueo?: boolean;
  tipoBloqueo?: TipoBloqueo;
  ttlReserva?: Date | null;
  ttlBloqueo?: Date | null;
  tenantId?: string;
}): Promise<{ reservaId: string; ttlSembrado: Date | null }> => {
  const tenantId = params.tenantId ?? TENANT;
  const cliente = await prisma.cliente.create({
    data: { tenantId, nombre: 'Lead', email: `lead-${sufijo()}${EMAIL_PATTERN}` },
  });
  const ttlReserva = params.ttlReserva === undefined ? ttlVigente() : params.ttlReserva;
  const reserva = await prisma.reserva.create({
    data: {
      tenantId,
      clienteId: cliente.idCliente,
      codigo: `TST-U006-${sufijo()}`,
      estado: params.estado ?? EstadoReserva.consulta,
      subEstado: params.subEstado === undefined ? SubEstadoConsulta.s2b : params.subEstado,
      canalEntrada: CanalEntrada.web,
      fechaEvento: params.fecha,
      ttlExpiracion: ttlReserva,
    },
  });
  if (params.conBloqueo !== false) {
    await prisma.fechaBloqueada.create({
      data: {
        tenantId,
        fecha: params.fecha,
        reservaId: reserva.idReserva,
        tipoBloqueo: params.tipoBloqueo ?? TipoBloqueo.blando,
        ttlExpiracion:
          params.ttlBloqueo === undefined ? ttlReserva : params.ttlBloqueo,
      },
    });
  }
  return { reservaId: reserva.idReserva, ttlSembrado: ttlReserva };
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
  useCase = moduleRef.get(ExtenderBloqueoUseCase);
});

afterAll(async () => {
  await limpiar();
  await moduleRef.close();
});

beforeEach(async () => {
  await limpiar();
});

// ===========================================================================
// 3.2 — Happy path: extiende RESERVA + FECHA_BLOQUEADA al MISMO nuevo TTL (= ttl
//        ACTUAL + N días); AUDIT_LOG `actualizar` con ttl anterior/nuevo.
// ===========================================================================

describe('Extender bloqueo desde 2.b prorroga RESERVA y FECHA_BLOQUEADA (3.2)', () => {
  it('debe_sumar_N_dias_al_ttl_actual_en_RESERVA_y_FECHA_BLOQUEADA_y_auditar', async () => {
    const { reservaId, ttlSembrado } = await sembrarReserva({ fecha: FECHA_2B });
    const esperado = (ttlSembrado as Date).getTime() + DIAS * DIA_MS;

    const out = await useCase.ejecutar(comando(reservaId));
    expect(out.reserva.ttlExpiracion?.getTime()).toBe(esperado);

    const reserva = await prisma.reserva.findUnique({ where: { idReserva: reservaId } });
    expect(reserva?.ttlExpiracion?.getTime()).toBe(esperado);

    const bloqueos = await prisma.fechaBloqueada.findMany({
      where: { tenantId: TENANT, fecha: FECHA_2B },
    });
    expect(bloqueos).toHaveLength(1);
    expect(bloqueos[0].ttlExpiracion?.getTime()).toBe(esperado);

    const audit = await prisma.auditLog.findFirst({
      where: { tenantId: TENANT, entidadId: reservaId, accion: 'actualizar' },
    });
    expect(audit).not.toBeNull();
    expect(
      new Date(
        (audit?.datosAnteriores as { ttlExpiracion?: string })?.ttlExpiracion as string,
      ).getTime(),
    ).toBe((ttlSembrado as Date).getTime());
    expect(
      new Date(
        (audit?.datosNuevos as { ttlExpiracion?: string })?.ttlExpiracion as string,
      ).getTime(),
    ).toBe(esperado);
  });
});

// ===========================================================================
// 3.2 + 3.3 — Happy path desde 2.c / 2.v / pre_reserva con INVARIANCIA: tras extender,
//             estado/subEstado/tipoBloqueo/fecha NO cambian.
// ===========================================================================

describe('Extender bloqueo desde 2.c/2.v/pre_reserva con invariancia (3.2/3.3)', () => {
  const casos: ReadonlyArray<{
    nombre: string;
    fecha: Date;
    estado: EstadoReserva;
    subEstado: SubEstadoConsulta | null;
  }> = [
    { nombre: '2c', fecha: FECHA_2C, estado: EstadoReserva.consulta, subEstado: SubEstadoConsulta.s2c },
    { nombre: '2v', fecha: FECHA_2V, estado: EstadoReserva.consulta, subEstado: SubEstadoConsulta.s2v },
    { nombre: 'pre_reserva', fecha: FECHA_PRE, estado: EstadoReserva.pre_reserva, subEstado: null },
  ];

  it.each(casos)(
    'debe_extender_desde_$nombre_sin_cambiar_estado_subEstado_tipoBloqueo_ni_fecha',
    async ({ fecha, estado, subEstado }) => {
      const { reservaId, ttlSembrado } = await sembrarReserva({
        fecha,
        estado,
        subEstado,
      });
      const esperado = (ttlSembrado as Date).getTime() + DIAS * DIA_MS;

      await useCase.ejecutar(comando(reservaId));

      const reserva = await prisma.reserva.findUnique({ where: { idReserva: reservaId } });
      expect(reserva?.ttlExpiracion?.getTime()).toBe(esperado);
      // INVARIANCIA: estado/subEstado/fecha intactos.
      expect(reserva?.estado).toBe(estado);
      expect(reserva?.subEstado).toBe(subEstado);
      expect(reserva?.fechaEvento?.getTime()).toBe(fecha.getTime());

      const bloqueos = await prisma.fechaBloqueada.findMany({
        where: { tenantId: TENANT, fecha },
      });
      expect(bloqueos).toHaveLength(1);
      // INVARIANCIA: tipo_bloqueo y fecha de la fila intactos; solo cambia el TTL.
      expect(bloqueos[0].tipoBloqueo).toBe(TipoBloqueo.blando);
      expect(bloqueos[0].fecha.getTime()).toBe(fecha.getTime());
      expect(bloqueos[0].ttlExpiracion?.getTime()).toBe(esperado);
    },
  );
});

// ===========================================================================
// 3.6 — TTL ya expirado → 409, sin mutar RESERVA ni FECHA_BLOQUEADA.
// ===========================================================================

describe('Extender bloqueo — TTL expirado → 409 sin efectos (3.6)', () => {
  it('debe_rechazar_y_no_modificar_nada_cuando_el_ttl_ya_vencio', async () => {
    const vencido = ttlVencido();
    const { reservaId } = await sembrarReserva({
      fecha: FECHA_EXPIRADO,
      ttlReserva: vencido,
      ttlBloqueo: vencido,
    });

    await expect(useCase.ejecutar(comando(reservaId))).rejects.toBeInstanceOf(
      BloqueoNoExtensibleError,
    );

    const reserva = await prisma.reserva.findUnique({ where: { idReserva: reservaId } });
    expect(reserva?.ttlExpiracion?.getTime()).toBe(vencido.getTime());
    const bloqueos = await prisma.fechaBloqueada.findMany({
      where: { tenantId: TENANT, fecha: FECHA_EXPIRADO },
    });
    expect(bloqueos[0].ttlExpiracion?.getTime()).toBe(vencido.getTime());
  });
});

// ===========================================================================
// 3.7 — Sin fila bloqueante blanda vigente → 409, sin efectos.
// ===========================================================================

describe('Extender bloqueo — sin fila bloqueante → 409 (3.7)', () => {
  it('debe_rechazar_cuando_la_reserva_no_tiene_fila_en_FECHA_BLOQUEADA', async () => {
    const { reservaId, ttlSembrado } = await sembrarReserva({
      fecha: FECHA_SIN_BLOQUEO,
      conBloqueo: false,
    });

    await expect(useCase.ejecutar(comando(reservaId))).rejects.toBeInstanceOf(
      BloqueoNoExtensibleError,
    );

    const reserva = await prisma.reserva.findUnique({ where: { idReserva: reservaId } });
    expect(reserva?.ttlExpiracion?.getTime()).toBe((ttlSembrado as Date).getTime());
    const bloqueos = await prisma.fechaBloqueada.count({
      where: { tenantId: TENANT, fecha: FECHA_SIN_BLOQUEO },
    });
    expect(bloqueos).toBe(0);
  });
});

// ===========================================================================
// 3.7 — reserva_confirmada (bloqueo firme, sin TTL) → 409, sin efectos.
// ===========================================================================

describe('Extender bloqueo — reserva_confirmada bloqueo firme → 409 (3.7)', () => {
  it('debe_rechazar_cuando_el_bloqueo_es_firme_y_no_tiene_ttl', async () => {
    const { reservaId } = await sembrarReserva({
      fecha: FECHA_FIRME,
      estado: EstadoReserva.reserva_confirmada,
      subEstado: null,
      tipoBloqueo: TipoBloqueo.firme,
      ttlReserva: null,
      ttlBloqueo: null,
    });

    await expect(useCase.ejecutar(comando(reservaId))).rejects.toBeInstanceOf(
      BloqueoNoExtensibleError,
    );

    const bloqueos = await prisma.fechaBloqueada.findMany({
      where: { tenantId: TENANT, fecha: FECHA_FIRME },
    });
    expect(bloqueos[0].tipoBloqueo).toBe(TipoBloqueo.firme);
    expect(bloqueos[0].ttlExpiracion).toBeNull();
  });
});

// ===========================================================================
// 3.7 — Estado sin bloqueo extensible (2.a) → 422, sin efectos.
// ===========================================================================

describe('Extender bloqueo — 2.a (estado no extensible) → 422 (3.7)', () => {
  it('debe_rechazar_con_validacion_cuando_la_reserva_esta_en_2a', async () => {
    const { reservaId } = await sembrarReserva({
      fecha: FECHA_2A,
      subEstado: SubEstadoConsulta.s2a,
      conBloqueo: false,
    });

    await expect(useCase.ejecutar(comando(reservaId))).rejects.toBeInstanceOf(
      ExtenderBloqueoValidacionError,
    );

    const reserva = await prisma.reserva.findUnique({ where: { idReserva: reservaId } });
    expect(reserva?.subEstado).toBe(SubEstadoConsulta.s2a);
  });
});

// ===========================================================================
// Multi-tenancy / RLS — un tenant no puede extender la RESERVA de otro (404).
// ===========================================================================

describe('Extender bloqueo — aislamiento multi-tenant / RLS', () => {
  it('debe_lanzar_ReservaNoEncontrada_cuando_el_tenant_del_jwt_no_es_dueno', async () => {
    const { reservaId, ttlSembrado } = await sembrarReserva({ fecha: FECHA_TENANT });

    await expect(
      useCase.ejecutar(comando(reservaId, { tenantId: OTRO_TENANT })),
    ).rejects.toBeInstanceOf(ReservaNoEncontradaError);

    const reserva = await prisma.reserva.findUnique({ where: { idReserva: reservaId } });
    expect(reserva?.ttlExpiracion?.getTime()).toBe((ttlSembrado as Date).getTime());
  });
});
