/**
 * TESTS DE INTEGRACIÓN de la transición «pendiente de invitados» (`2.b → 2.c`)
 * (US-007 / UC-06) — fase TDD RED. tasks.md Fase 3: 3.2 (TTL), 3.3 (vaciado de cola
 * A16), 3.4 (atomicidad/rollback), 3.6 (precondición de bloqueo), guarda de origen
 * (3.1) y multi-tenancy/RLS, 3.7 (no-email D-7).
 *
 * Trazabilidad: US-007, spec-delta `consultas` (Requirements de la transición
 * 2.b→2.c, extensión de TTL en RESERVA y FECHA_BLOQUEADA, vaciado de cola 2.d→2.y,
 * atomicidad de las 4 operaciones, auditoría `transicion`, precondición de bloqueo
 * vigente, guarda de origen 2.b, email fuera de alcance), design.md §D-4/§D-5/§D-7.
 *
 * INTEGRACIÓN REAL contra el Postgres del docker-compose (no mocks): el caso de uso
 * se resuelve por DI (`ReservasModule`) y se verifica el ESTADO DE LA BD tras la
 * transición. Mismo enfoque que `transicion-fecha-integracion.spec.ts` (US-005).
 * Requiere `docker compose up -d postgres` + migración + seed (tenant piloto con
 * `ttl_consulta_dias` configurado).
 *
 * RED: aún NO existe `application/transicion-pendiente-invitados.use-case.ts`. El
 * import falla en compilación y la batería entera está en ROJO por AUSENCIA DE
 * IMPLEMENTACIÓN (no por infraestructura: el Postgres está arriba, como prueban las
 * suites de US-040/US-004/US-005). GREEN es de `backend-developer`.
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
  TransicionPendienteInvitadosUseCase,
  TransicionPendienteInvitadosValidacionError,
  BloqueoNoVigenteError,
  ReservaNoEncontradaError,
  type TransicionPendienteInvitadosComando,
} from '../application/transicion-pendiente-invitados.use-case';

const TENANT = '00000000-0000-0000-0000-000000000001';
const OTRO_TENANT = '00000000-0000-0000-0000-0000000000ff';
const GESTOR = '00000000-0000-0000-0000-000000000002';
const EMAIL_PATTERN = '@us007-int.test';
const DIA_MS = 24 * 60 * 60 * 1000;

const FECHA_SIN_COLA = new Date('2027-05-01T00:00:00.000Z');
const FECHA_CON_COLA = new Date('2027-05-02T00:00:00.000Z');
const FECHA_GUARDA = new Date('2027-05-03T00:00:00.000Z');
const FECHA_SIN_BLOQUEO = new Date('2027-05-04T00:00:00.000Z');
const FECHA_EXPIRADO = new Date('2027-05-05T00:00:00.000Z');
const FECHA_TENANT = new Date('2027-05-06T00:00:00.000Z');
const FECHAS = [
  FECHA_SIN_COLA,
  FECHA_CON_COLA,
  FECHA_GUARDA,
  FECHA_SIN_BLOQUEO,
  FECHA_EXPIRADO,
  FECHA_TENANT,
];

/** TTL vigente (~30 días en el futuro) y TTL expirado (~ayer). */
const ttlVigente = (): Date => new Date(Date.now() + 30 * DIA_MS);
const ttlExpirado = (): Date => new Date(Date.now() - DIA_MS);

let moduleRef: TestingModule;
let prisma: PrismaService;
let useCase: TransicionPendienteInvitadosUseCase;

const sufijo = (): string => Math.random().toString(36).slice(2, 8);

const comando = (
  reservaId: string,
  over: Partial<TransicionPendienteInvitadosComando> = {},
): TransicionPendienteInvitadosComando => ({
  tenantId: TENANT,
  usuarioId: GESTOR,
  reservaId,
  ...over,
});

/**
 * Siembra una RESERVA bloqueante (origen de la transición) con su CLIENTE y su fila
 * `FECHA_BLOQUEADA`. Por defecto en `consulta`/`2b` con TTL vigente.
 */
const sembrarBloqueante = async (params: {
  fecha: Date;
  estado?: EstadoReserva;
  subEstado?: SubEstadoConsulta | null;
  conBloqueo?: boolean;
  ttlExpiracion?: Date;
  tenantId?: string;
}): Promise<string> => {
  const tenantId = params.tenantId ?? TENANT;
  const cliente = await prisma.cliente.create({
    data: { tenantId, nombre: 'Bloqueante', email: `blq-${sufijo()}${EMAIL_PATTERN}` },
  });
  const ttl = params.ttlExpiracion ?? ttlVigente();
  const reserva = await prisma.reserva.create({
    data: {
      tenantId,
      clienteId: cliente.idCliente,
      codigo: `TST-U007-${sufijo()}`,
      estado: params.estado ?? EstadoReserva.consulta,
      subEstado: params.subEstado === undefined ? SubEstadoConsulta.s2b : params.subEstado,
      canalEntrada: CanalEntrada.web,
      fechaEvento: params.fecha,
      ttlExpiracion: ttl,
    },
  });
  if (params.conBloqueo !== false) {
    await prisma.fechaBloqueada.create({
      data: {
        tenantId,
        fecha: params.fecha,
        reservaId: reserva.idReserva,
        tipoBloqueo: TipoBloqueo.blando,
        ttlExpiracion: ttl,
      },
    });
  }
  return reserva.idReserva;
};

/** Siembra una RESERVA en cola (`2.d`) apuntando a la bloqueante. */
const sembrarEnCola = async (params: {
  fecha: Date;
  bloqueanteId: string;
  posicion: number;
}): Promise<string> => {
  const cliente = await prisma.cliente.create({
    data: { tenantId: TENANT, nombre: 'Cola', email: `cola-${sufijo()}${EMAIL_PATTERN}` },
  });
  const reserva = await prisma.reserva.create({
    data: {
      tenantId: TENANT,
      clienteId: cliente.idCliente,
      codigo: `TST-U007-COLA-${sufijo()}`,
      estado: EstadoReserva.consulta,
      subEstado: SubEstadoConsulta.s2d,
      canalEntrada: CanalEntrada.web,
      fechaEvento: params.fecha,
      posicionCola: params.posicion,
      consultaBloqueanteId: params.bloqueanteId,
    },
  });
  return reserva.idReserva;
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
  useCase = moduleRef.get(TransicionPendienteInvitadosUseCase);
});

afterAll(async () => {
  await limpiar();
  await moduleRef.close();
});

beforeEach(async () => {
  await limpiar();
});

// ===========================================================================
// 3.2 — Cola vacía → 2.c + TTL extendido (base = ttl actual) en RESERVA y
//        FECHA_BLOQUEADA + AUDIT_LOG `transicion`. Vaciado afecta a 0 filas.
// ===========================================================================

describe('Transición 2.b→2.c sin cola → extiende TTL en RESERVA y FECHA_BLOQUEADA (3.2)', () => {
  it('debe_pasar_la_reserva_a_s2c_extender_el_ttl_en_ambas_tablas_y_AUDIT_LOG_transicion', async () => {
    const reservaId = await sembrarBloqueante({ fecha: FECHA_SIN_COLA });
    const antes = await prisma.reserva.findUnique({ where: { idReserva: reservaId } });
    const ttlBase = antes!.ttlExpiracion!.getTime();

    const out = await useCase.ejecutar(comando(reservaId));

    expect(out.consultasDescartadas).toBe(0);

    const reserva = await prisma.reserva.findUnique({ where: { idReserva: reservaId } });
    expect(reserva?.subEstado).toBe(SubEstadoConsulta.s2c);
    // TTL nuevo = base (ttl ACTUAL) + ttl_consulta_dias del seed (no now()+delta).
    const ttlNuevo = reserva!.ttlExpiracion!.getTime();
    const deltaDias = (ttlNuevo - ttlBase) / DIA_MS;
    expect(deltaDias).toBeGreaterThan(2.5); // seed ttl_consulta_dias (≥3)
    expect(ttlNuevo).toBeGreaterThan(ttlBase);

    // FECHA_BLOQUEADA extendida al MISMO TTL que la RESERVA.
    const bloqueo = await prisma.fechaBloqueada.findFirst({
      where: { tenantId: TENANT, fecha: FECHA_SIN_COLA },
    });
    expect(bloqueo?.ttlExpiracion?.getTime()).toBe(ttlNuevo);

    const audit = await prisma.auditLog.findFirst({
      where: { tenantId: TENANT, entidadId: reservaId, accion: 'transicion' },
    });
    expect(audit).not.toBeNull();
    expect((audit?.datosAnteriores as { subEstado?: string })?.subEstado).toBe('2b');
    expect((audit?.datosNuevos as { subEstado?: string })?.subEstado).toBe('2c');
  });
});

// ===========================================================================
// 3.3 — Cola activa (A16): N consultas en 2.d → 2.y con posicion_cola=NULL y
//        consulta_bloqueante_id=NULL; auditoría por cada descartada; en la misma tx.
// ===========================================================================

describe('Transición 2.b→2.c vacía la cola: 2.d→2.y (A16) (3.3)', () => {
  it('debe_pasar_las_consultas_en_cola_a_s2y_con_posicion_y_bloqueante_en_NULL', async () => {
    const bloqueanteId = await sembrarBloqueante({ fecha: FECHA_CON_COLA });
    const cola1 = await sembrarEnCola({ fecha: FECHA_CON_COLA, bloqueanteId, posicion: 1 });
    const cola2 = await sembrarEnCola({ fecha: FECHA_CON_COLA, bloqueanteId, posicion: 2 });

    const out = await useCase.ejecutar(comando(bloqueanteId));

    expect(out.consultasDescartadas).toBe(2);

    const descartadas = await prisma.reserva.findMany({
      where: { idReserva: { in: [cola1, cola2] } },
    });
    for (const r of descartadas) {
      expect(r.subEstado).toBe(SubEstadoConsulta.s2y);
      expect(r.posicionCola).toBeNull();
      expect(r.consultaBloqueanteId).toBeNull();
    }

    // Auditoría por cada descartada (2d→2y) + la de la principal (2b→2c).
    const auditDescartadas = await prisma.auditLog.findMany({
      where: { tenantId: TENANT, entidadId: { in: [cola1, cola2] }, accion: 'transicion' },
    });
    expect(auditDescartadas).toHaveLength(2);

    // La principal queda en 2.c.
    const principal = await prisma.reserva.findUnique({ where: { idReserva: bloqueanteId } });
    expect(principal?.subEstado).toBe(SubEstadoConsulta.s2c);
  });
});

// ===========================================================================
// 3.6 — Precondición de bloqueo vigente: sin FECHA_BLOQUEADA → 409; expirado → 409.
//        En ambos casos la RESERVA permanece intacta (2.b).
// ===========================================================================

describe('Transición 2.b→2.c — precondición de bloqueo vigente (3.6)', () => {
  it('debe_rechazar_cuando_no_hay_FECHA_BLOQUEADA_activa_y_dejar_la_reserva_en_2b', async () => {
    const reservaId = await sembrarBloqueante({
      fecha: FECHA_SIN_BLOQUEO,
      conBloqueo: false,
    });

    await expect(useCase.ejecutar(comando(reservaId))).rejects.toBeInstanceOf(
      BloqueoNoVigenteError,
    );

    const reserva = await prisma.reserva.findUnique({ where: { idReserva: reservaId } });
    expect(reserva?.subEstado).toBe(SubEstadoConsulta.s2b);
  });

  it('debe_rechazar_cuando_el_ttl_del_bloqueo_ya_expiro_y_no_extender_nada', async () => {
    const reservaId = await sembrarBloqueante({
      fecha: FECHA_EXPIRADO,
      ttlExpiracion: ttlExpirado(),
    });
    const bloqueoAntes = await prisma.fechaBloqueada.findFirst({
      where: { tenantId: TENANT, fecha: FECHA_EXPIRADO },
    });

    await expect(useCase.ejecutar(comando(reservaId))).rejects.toBeInstanceOf(
      BloqueoNoVigenteError,
    );

    const reserva = await prisma.reserva.findUnique({ where: { idReserva: reservaId } });
    expect(reserva?.subEstado).toBe(SubEstadoConsulta.s2b);
    // El TTL no se ha extendido (no se ha tocado nada).
    const bloqueoDespues = await prisma.fechaBloqueada.findFirst({
      where: { tenantId: TENANT, fecha: FECHA_EXPIRADO },
    });
    expect(bloqueoDespues?.ttlExpiracion?.getTime()).toBe(
      bloqueoAntes?.ttlExpiracion?.getTime(),
    );
  });
});

// ===========================================================================
// Guarda de origen (3.1) — RESERVA no en 2.b → 422 sin efectos.
// ===========================================================================

describe('Transición 2.b→2.c — guarda de origen 2.b (3.1)', () => {
  it('debe_rechazar_con_validacion_cuando_la_reserva_ya_esta_en_2c_y_no_mutar_nada', async () => {
    const reservaId = await sembrarBloqueante({
      fecha: FECHA_GUARDA,
      subEstado: SubEstadoConsulta.s2c,
    });
    const bloqueoAntes = await prisma.fechaBloqueada.findFirst({
      where: { tenantId: TENANT, fecha: FECHA_GUARDA },
    });

    await expect(useCase.ejecutar(comando(reservaId))).rejects.toBeInstanceOf(
      TransicionPendienteInvitadosValidacionError,
    );

    const reserva = await prisma.reserva.findUnique({ where: { idReserva: reservaId } });
    expect(reserva?.subEstado).toBe(SubEstadoConsulta.s2c);
    const bloqueoDespues = await prisma.fechaBloqueada.findFirst({
      where: { tenantId: TENANT, fecha: FECHA_GUARDA },
    });
    expect(bloqueoDespues?.ttlExpiracion?.getTime()).toBe(
      bloqueoAntes?.ttlExpiracion?.getTime(),
    );
  });
});

// ===========================================================================
// Multi-tenancy / RLS — un tenant no puede transicionar la RESERVA de otro (404).
// ===========================================================================

describe('Transición 2.b→2.c — aislamiento multi-tenant / RLS', () => {
  it('debe_lanzar_ReservaNoEncontrada_cuando_el_tenant_del_jwt_no_es_dueno', async () => {
    const reservaId = await sembrarBloqueante({ fecha: FECHA_TENANT });

    await expect(
      useCase.ejecutar(comando(reservaId, { tenantId: OTRO_TENANT })),
    ).rejects.toBeInstanceOf(ReservaNoEncontradaError);

    const reserva = await prisma.reserva.findUnique({ where: { idReserva: reservaId } });
    expect(reserva?.subEstado).toBe(SubEstadoConsulta.s2b);
  });
});

// ===========================================================================
// 3.7 — D-7: la transición a 2.c NO crea ninguna COMUNICACION (no se dispara email).
// ===========================================================================

describe('Transición 2.b→2.c — no dispara ningún email (D-7) (3.7)', () => {
  it('no_debe_crear_ninguna_COMUNICACION_al_transicionar_a_2c', async () => {
    const reservaId = await sembrarBloqueante({ fecha: FECHA_SIN_COLA });
    const antes = await prisma.comunicacion.count({ where: { reservaId } });

    await useCase.ejecutar(comando(reservaId));

    const despues = await prisma.comunicacion.count({ where: { reservaId } });
    expect(despues).toBe(antes);
  });
});
