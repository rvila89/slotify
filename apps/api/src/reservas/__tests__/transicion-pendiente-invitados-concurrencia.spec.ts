/**
 * TESTS DE CONCURRENCIA REALES de la transición «pendiente de invitados» (`2.b →
 * 2.c`) (US-007 / UC-06) — fase TDD RED. tasks.md Fase 3: 3.5. ZONA CRÍTICA
 * (serialización por `SELECT … FOR UPDATE` sobre la fila bloqueante, D13/D4).
 *
 * Trazabilidad: US-007, spec-delta `consultas` (Requirement "Concurrencia — la
 * transición a 2.c y el vaciado de cola se serializan sin estado intermedio (D13/D4)",
 * escenarios "Transición a 2.c concurrente con operación de cola sobre la misma
 * fecha" y "Dos transiciones simultáneas a 2.c sobre la misma RESERVA aplican una
 * sola vez"), design.md §D-5b. CLAUDE.md §Testing / §Regla crítica (la exclusión
 * mutua vive SOLO en PostgreSQL; nada de Redis/locks distribuidos).
 *
 * INTEGRACIÓN con TRANSACCIONES REALES contra el Postgres del docker-compose (no
 * mocks). Mismo enfoque que `transicion-fecha-concurrencia.spec.ts` (US-005). Las
 * llamadas se lanzan con `Promise.allSettled()` (skill `concurrency-locking`).
 * Requiere `docker compose up -d postgres` + migración + seed.
 *
 * RED: aún NO existe `application/transicion-pendiente-invitados.use-case.ts`. El
 * import falla en compilación y la batería entera está en ROJO por AUSENCIA DE
 * IMPLEMENTACIÓN (no por infraestructura: el Postgres está arriba). GREEN es de
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
  TransicionPendienteInvitadosUseCase,
  TransicionPendienteInvitadosValidacionError,
  type TransicionPendienteInvitadosComando,
} from '../application/transicion-pendiente-invitados.use-case';

const TENANT = '00000000-0000-0000-0000-000000000001';
const GESTOR = '00000000-0000-0000-0000-000000000002';
const EMAIL_PATTERN = '@us007-conc.test';
const DIA_MS = 24 * 60 * 60 * 1000;

// Fechas estrictamente futuras y aisladas (no usadas por el seed ni otras suites).
const FECHA_DOBLE = new Date('2027-11-12T00:00:00.000Z');
const FECHA_CON_COLA = new Date('2027-11-13T00:00:00.000Z');
const FECHAS = [FECHA_DOBLE, FECHA_CON_COLA];

const ttlVigente = (): Date => new Date(Date.now() + 30 * DIA_MS);

let moduleRef: TestingModule;
let prisma: PrismaService;
let useCase: TransicionPendienteInvitadosUseCase;

const sufijo = (): string => Math.random().toString(36).slice(2, 8);

const comando = (
  reservaId: string,
): TransicionPendienteInvitadosComando => ({
  tenantId: TENANT,
  usuarioId: GESTOR,
  reservaId,
});

/** Siembra la RESERVA bloqueante en `2.b` con su FECHA_BLOQUEADA vigente. */
const sembrarBloqueante = async (fecha: Date): Promise<string> => {
  const cliente = await prisma.cliente.create({
    data: { tenantId: TENANT, nombre: 'Conc', email: `c-${sufijo()}${EMAIL_PATTERN}` },
  });
  const ttl = ttlVigente();
  const reserva = await prisma.reserva.create({
    data: {
      tenantId: TENANT,
      clienteId: cliente.idCliente,
      codigo: `TST-U007C-${sufijo()}`,
      estado: EstadoReserva.consulta,
      subEstado: SubEstadoConsulta.s2b,
      canalEntrada: CanalEntrada.web,
      fechaEvento: fecha,
      ttlExpiracion: ttl,
    },
  });
  await prisma.fechaBloqueada.create({
    data: {
      tenantId: TENANT,
      fecha,
      reservaId: reserva.idReserva,
      tipoBloqueo: TipoBloqueo.blando,
      ttlExpiracion: ttl,
    },
  });
  return reserva.idReserva;
};

/** Siembra una RESERVA en cola (`2.d`) apuntando a la bloqueante. */
const sembrarEnCola = async (
  fecha: Date,
  bloqueanteId: string,
  posicion: number,
): Promise<string> => {
  const cliente = await prisma.cliente.create({
    data: { tenantId: TENANT, nombre: 'Cola', email: `cola-${sufijo()}${EMAIL_PATTERN}` },
  });
  const reserva = await prisma.reserva.create({
    data: {
      tenantId: TENANT,
      clienteId: cliente.idCliente,
      codigo: `TST-U007C-COLA-${sufijo()}`,
      estado: EstadoReserva.consulta,
      subEstado: SubEstadoConsulta.s2d,
      canalEntrada: CanalEntrada.web,
      fechaEvento: fecha,
      posicionCola: posicion,
      consultaBloqueanteId: bloqueanteId,
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
  await prisma.fechaBloqueada.deleteMany({ where: { tenantId: TENANT, fecha: { in: FECHAS } } });
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
// 1. Dos transiciones simultáneas a 2.c sobre la MISMA RESERVA → exactamente UNA
//    aplica (2.c + TTL extendido una sola vez); la otra observa que ya no está en
//    2.b y recibe la guarda de origen. Sin doble extensión de TTL ni doble vaciado.
//    (skill concurrency-locking: Promise.allSettled, 1 fulfilled + 1 rejected.)
// ===========================================================================

describe('Transición a 2.c — D13: dos simultáneas sobre la misma RESERVA aplican una sola vez', () => {
  it('debe_aplicar_exactamente_una_y_rechazar_la_otra_con_la_guarda_de_origen', async () => {
    const reservaId = await sembrarBloqueante(FECHA_DOBLE);
    const antes = await prisma.reserva.findUnique({ where: { idReserva: reservaId } });
    const ttlBase = antes!.ttlExpiracion!.getTime();

    const resultados = await Promise.allSettled([
      useCase.ejecutar(comando(reservaId)),
      useCase.ejecutar(comando(reservaId)),
    ]);

    // Exactamente 1 aplica la transición; 1 se rechaza por la guarda de origen.
    const cumplidas = resultados.filter((r) => r.status === 'fulfilled');
    const rechazadas = resultados.filter((r) => r.status === 'rejected');
    expect(cumplidas).toHaveLength(1);
    expect(rechazadas).toHaveLength(1);
    expect((rechazadas[0] as PromiseRejectedResult).reason).toBeInstanceOf(
      TransicionPendienteInvitadosValidacionError,
    );

    // Estado final coherente: RESERVA en 2.c y TTL extendido UNA sola vez.
    const reserva = await prisma.reserva.findUnique({ where: { idReserva: reservaId } });
    expect(reserva?.subEstado).toBe(SubEstadoConsulta.s2c);

    const bloqueo = await prisma.fechaBloqueada.findFirst({
      where: { tenantId: TENANT, fecha: FECHA_DOBLE },
    });
    const ttlNuevo = bloqueo!.ttlExpiracion!.getTime();
    const deltaDias = (ttlNuevo - ttlBase) / DIA_MS;
    // Una sola extensión: ~ttl_consulta_dias del seed, NO el doble.
    expect(deltaDias).toBeGreaterThan(2.5);
    expect(deltaDias).toBeLessThan(8); // margen amplio, pero descarta doble extensión grande
    // RESERVA y FECHA_BLOQUEADA con el MISMO TTL final (coherencia).
    expect(reserva?.ttlExpiracion?.getTime()).toBe(ttlNuevo);
  });
});

// ===========================================================================
// 2. Transición a 2.c concurrente con una operación de cola sobre la MISMA fecha:
//    una RESERVA en 2.d sale de cola (UC-13: la ponemos en 2.z) mientras la
//    bloqueante transiciona a 2.c. Ambas se serializan por el lock de la fila
//    bloqueante; estado final coherente: 0 consultas en 2.d apuntando a la
//    bloqueante (todas en 2.y por el vaciado, o las que salieron por su vía), sin
//    estados intermedios observables.
// ===========================================================================

describe('Transición a 2.c — concurrente con operación de cola sobre la misma fecha', () => {
  it('debe_serializar_y_no_dejar_consultas_en_2d_apuntando_a_la_bloqueante', async () => {
    const bloqueanteId = await sembrarBloqueante(FECHA_CON_COLA);
    const cola1 = await sembrarEnCola(FECHA_CON_COLA, bloqueanteId, 1);
    const cola2 = await sembrarEnCola(FECHA_CON_COLA, bloqueanteId, 2);

    // Operación de cola concurrente: una salida voluntaria simulada (UC-13) que saca
    // a `cola2` de la cola (2.d → 2.z) DENTRO de una transacción que toma el mismo
    // lock de la fila bloqueante (serialización por `SELECT … FOR UPDATE`).
    const salidaDeCola = prisma.$transaction(async (tx) => {
      await prisma.fijarTenant(tx, TENANT);
      await tx.$queryRaw`
        SELECT id_bloqueo FROM fecha_bloqueada
        WHERE tenant_id = ${TENANT} AND fecha = ${FECHA_CON_COLA.toISOString().slice(0, 10)}::date
        FOR UPDATE
      `;
      await tx.reserva.update({
        where: { idReserva: cola2 },
        data: { subEstado: SubEstadoConsulta.s2z, posicionCola: null, consultaBloqueanteId: null },
      });
    });

    const resultados = await Promise.allSettled([
      useCase.ejecutar(comando(bloqueanteId)),
      salidaDeCola,
    ]);

    // Ambas operaciones se completan (serializadas por el lock, sin deadlock).
    expect(resultados.filter((r) => r.status === 'rejected')).toHaveLength(0);

    // La bloqueante queda en 2.c con TTL extendido.
    const principal = await prisma.reserva.findUnique({ where: { idReserva: bloqueanteId } });
    expect(principal?.subEstado).toBe(SubEstadoConsulta.s2c);

    // Estado final coherente: 0 consultas en 2.d apuntando a la bloqueante.
    const enColaAun = await prisma.reserva.count({
      where: { consultaBloqueanteId: bloqueanteId, subEstado: SubEstadoConsulta.s2d },
    });
    expect(enColaAun).toBe(0);

    // cola1 fue descartada por el vaciado (2.y); cola2 salió por su vía (2.z). En
    // ambos casos sin posicion_cola ni consulta_bloqueante_id colgando.
    const c1 = await prisma.reserva.findUnique({ where: { idReserva: cola1 } });
    const c2 = await prisma.reserva.findUnique({ where: { idReserva: cola2 } });
    expect(c1?.subEstado).toBe(SubEstadoConsulta.s2y);
    expect(c1?.posicionCola).toBeNull();
    expect(c1?.consultaBloqueanteId).toBeNull();
    expect(c2?.subEstado).toBe(SubEstadoConsulta.s2z);
    expect(c2?.posicionCola).toBeNull();
    expect(c2?.consultaBloqueanteId).toBeNull();
  });
});
