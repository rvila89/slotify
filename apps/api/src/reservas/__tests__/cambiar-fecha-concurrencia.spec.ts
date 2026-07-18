/**
 * TESTS DE CONCURRENCIA REALES de la operación atómica «cambiar fecha ya bloqueada»
 * (US-051 §Punto 2 / UC-05/UC-12/UC-18) — fase TDD RED. tasks.md Fase 3: 3.1.
 * ZONA CRÍTICA (anti-doble-reserva D4, skill `concurrency-locking` / `atomic-date-lock`).
 *
 * Trazabilidad: US-051, spec-delta `consultas` (Requirement "Cambio atómico de una fecha
 * ya bloqueada", escenarios "Dos cambios concurrentes a la misma fecha nueva solo dejan
 * pasar a uno" y "Liberar una fecha con cola promueve al primero en cola"); design.md
 * §D-2.1 (liberar antigua + bloquear nueva en UNA transacción con `SELECT … FOR UPDATE`),
 * §D-2.2 (TDD de concurrencia OBLIGATORIO primero). CLAUDE.md §Regla crítica / §Testing:
 * la exclusión mutua vive SOLO en PostgreSQL (`SELECT … FOR UPDATE` + `UNIQUE(tenant_id,
 * fecha)`); NUNCA Redis ni locks distribuidos.
 *
 * INTEGRACIÓN con TRANSACCIONES REALES contra el Postgres AISLADO de tests
 * (`slotify_test`, `.env.test`). Las operaciones rivales se lanzan con
 * `Promise.allSettled()` para FORZAR la carrera (mismo enfoque que
 * `transicion-fecha-concurrencia.spec.ts` / `promocion-cola-concurrencia.spec.ts`).
 *
 * A diferencia de US-005 (que asigna la PRIMERA fecha 2a→2b), aquí las RESERVA ya tienen
 * una fecha bloqueada: se siembran con su FECHA_BLOQUEADA y luego se pide moverlas a otra.
 *
 * RED: aún NO existe `application/cambiar-fecha.use-case.ts` ni su binding en el módulo.
 * El import falla en compilación y la batería entera está en ROJO por AUSENCIA DE
 * IMPLEMENTACIÓN (no por infraestructura: el Postgres está arriba, como prueban las suites
 * de US-005/US-018). GREEN es de `backend-developer`.
 *
 * NOTA sesión principal: este spec REQUIERE Postgres real; NO corre en subagentes sin BD.
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
const EMAIL_PATTERN = '@us051-conc.test';

// Fechas de evento aisladas por escenario (no usadas por el seed ni otras suites).
const F1_A = new Date('2028-11-01T00:00:00.000Z'); // fecha antigua de la reserva A
const F1_B = new Date('2028-11-02T00:00:00.000Z'); // fecha antigua de la reserva B
const F2 = new Date('2028-11-03T00:00:00.000Z'); // fecha nueva DISPUTADA (libre)
const F1_COLA = new Date('2028-11-04T00:00:00.000Z'); // fecha antigua con cola
const F2_LIBRE = new Date('2028-11-05T00:00:00.000Z'); // fecha nueva libre (promoción)
const FECHAS = [F1_A, F1_B, F2, F1_COLA, F2_LIBRE];

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

/** Siembra una RESERVA del TENANT en `consulta`/`2b` con su FECHA_BLOQUEADA blanda. */
const sembrarReservaConBloqueo = async (fecha: Date): Promise<string> => {
  const cliente = await prisma.cliente.create({
    data: { tenantId: TENANT, nombre: 'Conc', email: `c-${sufijo()}${EMAIL_PATTERN}` },
  });
  const reserva = await prisma.reserva.create({
    data: {
      tenantId: TENANT,
      clienteId: cliente.idCliente,
      codigo: `TST-U051C-${sufijo()}`,
      estado: EstadoReserva.consulta,
      subEstado: SubEstadoConsulta.s2b,
      canalEntrada: CanalEntrada.web,
      fechaEvento: fecha,
      ttlExpiracion: new Date('2028-12-31'),
    },
  });
  await prisma.fechaBloqueada.create({
    data: {
      tenantId: TENANT,
      fecha,
      reservaId: reserva.idReserva,
      tipoBloqueo: TipoBloqueo.blando,
      ttlExpiracion: new Date('2028-12-31'),
    },
  });
  return reserva.idReserva;
};

/** Siembra una consulta en cola (2.d) sobre la fecha antigua, apuntando a la bloqueante. */
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
      codigo: `TST-U051C-Q-${sufijo()}`,
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
  await prisma.fechaBloqueada.deleteMany({ where: { tenantId: TENANT, fecha: { in: FECHAS } } });
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
// Escenario 2 — Dos "cambiar fecha" concurrentes hacia la MISMA F2 libre: exactamente
//   uno gana (invariante UNIQUE(tenant_id, fecha)); el otro recibe conflicto y su
//   RESERVA + fecha antigua quedan intactas (sin doble bloqueo de F2).
// ===========================================================================

describe('CambiarFecha — D4: dos cambios concurrentes a la misma F2 (1 gana, 1 conflicto)', () => {
  it('debe_dejar_exactamente_una_reserva_en_F2_con_un_solo_bloqueo_y_conflicto_a_la_otra', async () => {
    const reservaA = await sembrarReservaConBloqueo(F1_A);
    const reservaB = await sembrarReservaConBloqueo(F1_B);

    const resultados = await Promise.allSettled([
      useCase.ejecutar(comando(reservaA, F2)),
      useCase.ejecutar(comando(reservaB, F2)),
    ]);

    // Exactamente 1 cambio confirma y 1 se rechaza con conflicto (fecha ocupada).
    const cumplidas = resultados.filter((r) => r.status === 'fulfilled');
    const rechazadas = resultados.filter((r) => r.status === 'rejected');
    expect(cumplidas).toHaveLength(1);
    expect(rechazadas).toHaveLength(1);
    expect((rechazadas[0] as PromiseRejectedResult).reason).toBeInstanceOf(
      CambiarFechaConflictoError,
    );

    // Un ÚNICO bloqueo sobre F2 (invariante UNIQUE(tenant, fecha)).
    expect(await contarBloqueos(F2)).toBe(1);

    // Exactamente una RESERVA quedó en F2; la otra CONSERVA su fecha antigua y su bloqueo.
    const enF2 = await prisma.reserva.count({
      where: { idReserva: { in: [reservaA, reservaB] }, fechaEvento: F2 },
    });
    expect(enF2).toBe(1);

    // Las fechas antiguas: la ganadora liberó la suya, la perdedora la conserva bloqueada.
    const bloqueosAntiguos = await contarBloqueos(F1_A) + (await contarBloqueos(F1_B));
    expect(bloqueosAntiguos).toBe(1);

    const rA = await prisma.reserva.findUnique({ where: { idReserva: reservaA } });
    const rB = await prisma.reserva.findUnique({ where: { idReserva: reservaB } });
    // La perdedora mantiene su fecha antigua exactamente (rollback total de su intento).
    const perdedora = rA?.fechaEvento?.getTime() === F2.getTime() ? rB : rA;
    expect([F1_A.getTime(), F1_B.getTime()]).toContain(
      perdedora?.fechaEvento?.getTime(),
    );
    // Ambas conservan su sub-estado 2.b (el cambio no altera estado/subEstado).
    expect(rA?.subEstado).toBe(SubEstadoConsulta.s2b);
    expect(rB?.subEstado).toBe(SubEstadoConsulta.s2b);
  });
});

// ===========================================================================
// Escenario 3 — Cambiar la fecha de una RESERVA cuya fecha ANTIGUA tiene cola: al
//   liberar F1_COLA se promueve (FIFO, A15) al primero en cola exactamente una vez,
//   sin estado intermedio observable, mientras la RESERVA pasa a F2_LIBRE.
// ===========================================================================

describe('CambiarFecha — liberar fecha con cola promueve al primero en cola (FIFO, A15)', () => {
  it('debe_mover_la_reserva_a_F2_y_promover_al_primero_en_cola_de_F1_exactamente_una_vez', async () => {
    const bloqueanteId = await sembrarReservaConBloqueo(F1_COLA);
    const q1 = await sembrarEnCola({ fecha: F1_COLA, bloqueanteId, posicion: 1 });
    const q2 = await sembrarEnCola({ fecha: F1_COLA, bloqueanteId, posicion: 2 });

    await useCase.ejecutar(comando(bloqueanteId, F2_LIBRE));

    // La bloqueante se movió a F2_LIBRE (nuevo bloqueo) y liberó F1_COLA...
    const bloqueante = await prisma.reserva.findUnique({
      where: { idReserva: bloqueanteId },
    });
    expect(bloqueante?.fechaEvento).toEqual(F2_LIBRE);
    expect(await contarBloqueos(F2_LIBRE)).toBe(1);

    // ...promoviendo al primero en cola de F1_COLA EXACTAMENTE UNA VEZ (q1 → 2.b).
    const promovidas = await prisma.reserva.count({
      where: { fechaEvento: F1_COLA, subEstado: SubEstadoConsulta.s2b },
    });
    expect(promovidas).toBe(1);
    const pq1 = await prisma.reserva.findUnique({ where: { idReserva: q1 } });
    expect(pq1?.subEstado).toBe(SubEstadoConsulta.s2b);

    // Un único bloqueo sobre F1_COLA (el de la promovida, no doble reserva).
    expect(await contarBloqueos(F1_COLA)).toBe(1);

    // El segundo en cola avanza a posición 1 apuntando a la promovida (sin doble decremento).
    const pq2 = await prisma.reserva.findUnique({ where: { idReserva: q2 } });
    expect(pq2?.subEstado).toBe(SubEstadoConsulta.s2d);
    expect(pq2?.posicionCola).toBe(1);
    expect(pq2?.consultaBloqueanteId).toBe(q1);
  });
});
