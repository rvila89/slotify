/**
 * TESTS DE CONCURRENCIA REALES de la RAMA `2d` de «cambiar fecha desde la cola»
 * (change `cambiar-fecha-consulta-en-cola`) — fase TDD RED. ZONA CRÍTICA
 * (anti-doble-reserva D4, skill `concurrency-locking` / `atomic-date-lock`).
 *
 * >>> INTEGRACIÓN: REQUIERE Postgres real (`slotify_test`, `.env.test`). NO corre en
 * >>> subagentes sin BD (nota MEMORY "Subagentes sin Docker/Postgres"). Se ejecuta desde la
 * >>> SESIÓN PRINCIPAL. Aquí queda LISTO en RED; el GREEN es de `backend-developer`.
 *
 * Trazabilidad: design.md §D-5 (bloqueo atómico de F2 en UNA transacción con RLS; la
 * serialización la da PostgreSQL vía `UNIQUE(tenant_id, fecha)` + `SELECT … FOR UPDATE`);
 * spec-delta `consultas` (escenario "Dos cambios concurrentes a la misma fecha nueva solo
 * dejan pasar a uno", aplicado a orígenes `2d`); tasks.md §"TDD primero" (concurrencia: dos
 * `2d` a la misma F2 libre → una gana, otra 409). CLAUDE.md §Regla crítica: la exclusión
 * mutua vive SOLO en PostgreSQL; NUNCA Redis ni locks distribuidos.
 *
 * Las operaciones rivales se lanzan con `Promise.allSettled()` para FORZAR la carrera
 * (mismo enfoque que `cambiar-fecha-concurrencia.spec.ts`).
 *
 * RED: la rama `2d` aún NO existe en el use-case / adaptador UoW; ambas peticiones fallarán
 * hoy (la guarda de origen rechaza `2d` con 422), por lo que las aserciones de "1 gana / 1
 * conflicto 409" no se cumplen. GREEN es de `backend-developer`.
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
  CambiarFechaUseCase,
  CambiarFechaConflictoError,
  type CambiarFechaComando,
} from '../application/cambiar-fecha.use-case';

const TENANT = '00000000-0000-0000-0000-000000000001';
const GESTOR = '00000000-0000-0000-0000-000000000002';
const EMAIL_PATTERN = '@ccfcola-conc.test';

// Fechas aisladas por escenario (no usadas por el seed ni otras suites).
const F1_A = new Date('2029-03-01T00:00:00.000Z'); // fecha antigua (bloqueante de la cola A)
const F1_B = new Date('2029-03-02T00:00:00.000Z'); // fecha antigua (bloqueante de la cola B)
const F2 = new Date('2029-03-03T00:00:00.000Z'); // fecha nueva DISPUTADA (libre)
const FECHAS = [F1_A, F1_B, F2];

let moduleRef: TestingModule;
let prisma: PrismaService;
let useCase: CambiarFechaUseCase;

const sufijo = (): string => Math.random().toString(36).slice(2, 8);

const comando = (reservaId: string, fecha: Date): CambiarFechaComando => ({
  tenantId: TENANT,
  usuarioId: GESTOR,
  reservaId,
  fechaEvento: fecha,
});

/** Siembra una RESERVA bloqueante en `2b` con su FECHA_BLOQUEADA blanda. */
const sembrarBloqueante = async (fecha: Date): Promise<string> => {
  const cliente = await prisma.cliente.create({
    data: { tenantId: TENANT, nombre: 'Bloq', email: `b-${sufijo()}${EMAIL_PATTERN}` },
  });
  const reserva = await prisma.reserva.create({
    data: {
      tenantId: TENANT,
      clienteId: cliente.idCliente,
      codigo: `TST-CCFQ-B-${sufijo()}`,
      estado: EstadoReserva.consulta,
      subEstado: SubEstadoConsulta.s2b,
      canalEntrada: CanalEntrada.web,
      fechaEvento: fecha,
      ttlExpiracion: new Date('2029-12-31'),
    },
  });
  await prisma.fechaBloqueada.create({
    data: {
      tenantId: TENANT,
      fecha,
      reservaId: reserva.idReserva,
      tipoBloqueo: TipoBloqueo.blando,
      ttlExpiracion: new Date('2029-12-31'),
    },
  });
  return reserva.idReserva;
};

/** Siembra una consulta EN COLA (2.d) sobre la fecha del bloqueante, SIN FECHA_BLOQUEADA. */
const sembrarEnCola = async (params: {
  fecha: Date;
  bloqueanteId: string;
  posicion: number;
}): Promise<string> => {
  const cliente = await prisma.cliente.create({
    data: { tenantId: TENANT, nombre: 'Cola', email: `q-${sufijo()}${EMAIL_PATTERN}` },
  });
  const r = await prisma.reserva.create({
    data: {
      tenantId: TENANT,
      clienteId: cliente.idCliente,
      codigo: `TST-CCFQ-Q-${sufijo()}`,
      estado: EstadoReserva.consulta,
      subEstado: SubEstadoConsulta.s2d,
      canalEntrada: CanalEntrada.web,
      fechaEvento: params.fecha,
      consultaBloqueanteId: params.bloqueanteId,
      posicionCola: params.posicion,
    },
  });
  return r.idReserva;
};

const contarBloqueos = (fecha: Date): Promise<number> =>
  prisma.fechaBloqueada.count({ where: { tenantId: TENANT, fecha } });

const limpiar = async (): Promise<void> => {
  const clientes = await prisma.cliente.findMany({
    where: { email: { contains: EMAIL_PATTERN } },
    select: { idCliente: true },
  });
  const clienteIds = clientes.map((c) => c.idCliente);
  const reservas = await prisma.reserva.findMany({
    where: { OR: [{ clienteId: { in: clienteIds } }, { fechaEvento: { in: FECHAS } }] },
    select: { idReserva: true, clienteId: true },
  });
  const ids = reservas.map((r) => r.idReserva);
  const allClientes = [...new Set([...clienteIds, ...reservas.map((r) => r.clienteId)])];
  if (ids.length > 0) {
    await prisma.fechaBloqueada.deleteMany({ where: { reservaId: { in: ids } } });
    await prisma.comunicacion.deleteMany({ where: { reservaId: { in: ids } } });
    await prisma.auditLog.deleteMany({ where: { entidadId: { in: ids } } });
    await prisma.reserva.updateMany({
      where: { idReserva: { in: ids } },
      data: { consultaBloqueanteId: null, posicionCola: null },
    });
    await prisma.reserva.deleteMany({ where: { idReserva: { in: ids } } });
  }
  await prisma.fechaBloqueada.deleteMany({
    where: { tenantId: TENANT, fecha: { in: FECHAS } },
  });
  if (allClientes.length > 0) {
    await prisma.cliente.deleteMany({ where: { idCliente: { in: allClientes } } });
  }
};

beforeAll(async () => {
  moduleRef = await Test.createTestingModule({
    imports: [ConfigModule.forRoot({ isGlobal: true }), ReservasModule],
  }).compile();
  await moduleRef.init();
  prisma = moduleRef.get(PrismaService);
  useCase = moduleRef.get(CambiarFechaUseCase);
});

afterAll(async () => {
  await limpiar();
  await moduleRef.close();
});

beforeEach(async () => {
  await limpiar();
});

// ===========================================================================
// Dos consultas EN COLA (2.d) de distinta cola cambian a la MISMA F2 libre: exactamente
//   una bloquea F2 (invariante UNIQUE(tenant_id, fecha)) y sale a 2.b; la otra recibe
//   conflicto 409 y CONSERVA su posición de cola (rollback total).
// ===========================================================================

describe('CambiarFecha rama 2d — D4: dos 2d concurrentes a la misma F2 (1 gana, 1 conflicto 409)', () => {
  it('debe_dejar_exactamente_una_reserva_en_F2_con_un_solo_bloqueo_y_conflicto_a_la_otra', async () => {
    const bloqueanteA = await sembrarBloqueante(F1_A);
    const bloqueanteB = await sembrarBloqueante(F1_B);
    const colaA = await sembrarEnCola({ fecha: F1_A, bloqueanteId: bloqueanteA, posicion: 1 });
    const colaB = await sembrarEnCola({ fecha: F1_B, bloqueanteId: bloqueanteB, posicion: 1 });

    const resultados = await Promise.allSettled([
      useCase.ejecutar(comando(colaA, F2)),
      useCase.ejecutar(comando(colaB, F2)),
    ]);

    // Exactamente 1 sale de la cola a 2.b y 1 se rechaza con conflicto (F2 ocupada).
    const cumplidas = resultados.filter((r) => r.status === 'fulfilled');
    const rechazadas = resultados.filter((r) => r.status === 'rejected');
    expect(cumplidas).toHaveLength(1);
    expect(rechazadas).toHaveLength(1);
    expect((rechazadas[0] as PromiseRejectedResult).reason).toBeInstanceOf(
      CambiarFechaConflictoError,
    );

    // Un ÚNICO bloqueo sobre F2 (invariante UNIQUE(tenant, fecha)); ninguna doble reserva.
    expect(await contarBloqueos(F2)).toBe(1);

    // Exactamente una de las dos consultas de cola quedó en F2 y en 2.b.
    const enF2 = await prisma.reserva.count({
      where: { idReserva: { in: [colaA, colaB] }, fechaEvento: F2 },
    });
    expect(enF2).toBe(1);

    const rA = await prisma.reserva.findUnique({ where: { idReserva: colaA } });
    const rB = await prisma.reserva.findUnique({ where: { idReserva: colaB } });
    const ganadora = rA?.fechaEvento?.getTime() === F2.getTime() ? rA : rB;
    const perdedora = ganadora === rA ? rB : rA;

    // La ganadora salió de la cola (2.b, posicion_cola null, bloqueante null).
    expect(ganadora?.subEstado).toBe(SubEstadoConsulta.s2b);
    expect(ganadora?.posicionCola).toBeNull();
    expect(ganadora?.consultaBloqueanteId).toBeNull();

    // La perdedora CONSERVA su 2.d y su posición de cola (rollback total de su intento).
    expect(perdedora?.subEstado).toBe(SubEstadoConsulta.s2d);
    expect(perdedora?.posicionCola).toBe(1);

    // Las fechas antiguas de la cola (F1_A / F1_B) siguen bloqueadas por sus bloqueantes:
    // la rama 2d NO libera nada.
    expect(await contarBloqueos(F1_A)).toBe(1);
    expect(await contarBloqueos(F1_B)).toBe(1);
  });
});
