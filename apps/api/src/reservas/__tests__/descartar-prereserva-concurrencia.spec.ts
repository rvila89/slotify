/**
 * TESTS DE CONCURRENCIA REALES [requires-real-db] del descarte de PRE-RESERVA →
 * reserva_cancelada (workstream B del change `presupuesto-prereserva-cta-descarte-y-e2`) —
 * fase TDD RED. ZONA CRÍTICA (serialización commit-first por `SELECT … FOR UPDATE` sobre la
 * fila de FECHA_BLOQUEADA y/o la RESERVA; design.md §"Workstream B", sin Redis ni locks
 * distribuidos).
 *
 * Trazabilidad: design.md §"Workstream B" ("Re-evaluar la guarda de origen bajo el lock
 * (detecta doble clic / carrera → 409)"; "liberarFecha() … exactamente-una-vez"; "promover el
 * primero en cola … exactamente la misma operación que US-013/US-018"; "all-or-nothing");
 * spec-delta `consultas` (Requirement "El descarte de la pre-reserva libera la fecha y promueve
 * la cola en la misma transacción": "garantizando exactamente-una-vez la promoción"). CLAUDE.md
 * §Testing / §Regla crítica. Las llamadas concurrentes se lanzan con `Promise.allSettled()`
 * (skill `concurrency-locking`): 1 gana + 1 pierde.
 *
 * ==========================================================================
 * ATENCIÓN — [requires-real-db]: ESTA SUITE REQUIERE POSTGRES REAL.
 * Los subagentes (tdd-engineer / qa-verifier) corren SIN Docker/Postgres, así que esta
 * batería NO puede verificarse en RED aquí: su RED real (import inexistente → la compilación
 * falla estando el Postgres arriba) se valida desde la SESIÓN PRINCIPAL con
 * `docker compose up -d postgres` + migración + seed sobre la BD `slotify_test` AISLADA del
 * worktree. Está separada por nombre (`…-concurrencia.spec.ts`) y por el marcador
 * `[requires-real-db]` en el describe. Mismo enfoque que
 * `descartar-consulta-por-cliente-concurrencia.spec.ts` (US-013).
 * ==========================================================================
 *
 * RED: aún NO existe `application/descartar-prereserva.use-case.ts`. El import falla en
 * compilación y la batería entera está en ROJO por AUSENCIA DE IMPLEMENTACIÓN (no por
 * infraestructura: el Postgres está arriba). GREEN es de `backend-developer`.
 */
import { Test, type TestingModule } from '@nestjs/testing';
import { ConfigModule } from '@nestjs/config';
import {
  CanalEntrada,
  EstadoReserva as EstadoReservaPrisma,
  SubEstadoConsulta as SubEstadoConsultaPrisma,
  TipoBloqueo,
} from '@prisma/client';
import { ReservasModule } from '../reservas.module';
import { PrismaService } from '../../shared/prisma/prisma.service';
import {
  DescartarPreReservaUseCase,
  DescartePreReservaEstadoTerminalError,
  type DescartarPreReservaComando,
} from '../application/descartar-prereserva.use-case';

const TENANT = '00000000-0000-0000-0000-000000000001';
const GESTOR = '00000000-0000-0000-0000-000000000002';
const EMAIL_PATTERN = '@prereserva-conc.test';
const DIA_MS = 24 * 60 * 60 * 1000;

// Fechas de EVENTO (a bloquear) estrictamente futuras y aisladas por escenario.
const FECHA_SIN_COLA = new Date('2027-12-10T00:00:00.000Z'); // doble descarte sin cola
const FECHA_CON_COLA = new Date('2027-12-11T00:00:00.000Z'); // doble descarte con cola
const FECHAS = [FECHA_SIN_COLA, FECHA_CON_COLA];

const ttlVigente = (): Date => new Date(Date.now() + 30 * DIA_MS);
const sufijo = (): string => Math.random().toString(36).slice(2, 8);

let moduleRef: TestingModule;
let prisma: PrismaService;
let useCase: DescartarPreReservaUseCase;

const comando = (reservaId: string): DescartarPreReservaComando => ({
  tenantId: TENANT,
  usuarioId: GESTOR,
  reservaId,
});

/** Siembra una RESERVA en `pre_reserva` con su FECHA_BLOQUEADA firme viva. */
const sembrarPreReserva = async (fecha: Date): Promise<string> => {
  const cliente = await prisma.cliente.create({
    data: { tenantId: TENANT, nombre: 'Conc', email: `c-${sufijo()}${EMAIL_PATTERN}` },
  });
  const reserva = await prisma.reserva.create({
    data: {
      tenantId: TENANT,
      clienteId: cliente.idCliente,
      codigo: `TST-PREC-${sufijo()}`,
      estado: EstadoReservaPrisma.pre_reserva,
      subEstado: null,
      canalEntrada: CanalEntrada.web,
      fechaEvento: fecha,
      ttlExpiracion: ttlVigente(),
    },
  });
  await prisma.fechaBloqueada.create({
    data: {
      tenantId: TENANT,
      fecha,
      reservaId: reserva.idReserva,
      // Un bloqueo FIRME (pre_reserva con señal confirmada) NO lleva TTL: la restricción
      // `chk_firme_sin_ttl` exige `ttl_expiracion = NULL` cuando `tipo_bloqueo = firme`.
      tipoBloqueo: TipoBloqueo.firme,
      ttlExpiracion: null,
    },
  });
  return reserva.idReserva;
};

/**
 * Siembra una consulta en cola (`2d`, `posicion_cola = 1`) apuntando por
 * `consulta_bloqueante_id` a la pre-reserva que bloquea esa fecha, tal como la promoción de
 * US-018 espera para poder promover al primero en cola al liberarse la fecha.
 */
const sembrarConsultaEnCola = async (
  fecha: Date,
  bloqueanteId: string,
): Promise<string> => {
  const cliente = await prisma.cliente.create({
    data: { tenantId: TENANT, nombre: 'Cola', email: `q-${sufijo()}${EMAIL_PATTERN}` },
  });
  const reserva = await prisma.reserva.create({
    data: {
      tenantId: TENANT,
      clienteId: cliente.idCliente,
      codigo: `TST-PREC-Q-${sufijo()}`,
      estado: EstadoReservaPrisma.consulta,
      subEstado: SubEstadoConsultaPrisma.s2d,
      canalEntrada: CanalEntrada.web,
      fechaEvento: fecha,
      posicionCola: 1,
      consultaBloqueanteId: bloqueanteId,
      ttlExpiracion: ttlVigente(),
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
  useCase = moduleRef.get(DescartarPreReservaUseCase);
});

afterAll(async () => {
  await limpiar();
  await moduleRef.close();
});

beforeEach(async () => {
  await limpiar();
});

// ===========================================================================
// C-1 [requires-real-db] — DOBLE descarte concurrente de la MISMA pre_reserva SIN cola. La
// primera tx la pasa a `reserva_cancelada` y libera su FECHA_BLOQUEADA; la segunda relee bajo
// el lock, observa el terminal y recibe `DescartePreReservaEstadoTerminalError` (409), sin doble
// transición, sin doble liberación ni doble AUDIT_LOG.
//   spec-delta: "Descartar una reserva ya terminal se rechaza como conflicto (409)" +
//   "exactamente-una-vez".
// ===========================================================================

describe('[requires-real-db] Descarte de pre-reserva — C-1 doble descarte concurrente sin cola', () => {
  it('debe_aplicar_exactamente_uno_y_rechazar_el_otro_con_error_terminal', async () => {
    const reservaId = await sembrarPreReserva(FECHA_SIN_COLA);

    const resultados = await Promise.allSettled([
      useCase.ejecutar(comando(reservaId)),
      useCase.ejecutar(comando(reservaId)),
    ]);

    const cumplidas = resultados.filter((r) => r.status === 'fulfilled');
    const rechazadas = resultados.filter((r) => r.status === 'rejected');
    expect(cumplidas).toHaveLength(1);
    expect(rechazadas).toHaveLength(1);
    expect((rechazadas[0] as PromiseRejectedResult).reason).toBeInstanceOf(
      DescartePreReservaEstadoTerminalError,
    );

    // Estado final coherente: RESERVA cancelada, sin bloqueo activo (una sola liberación) y
    // con UN solo AUDIT_LOG de la transición de descarte.
    const reserva = await prisma.reserva.findUnique({ where: { idReserva: reservaId } });
    expect(reserva?.estado).toBe(EstadoReservaPrisma.reserva_cancelada);
    expect(reserva?.ttlExpiracion).toBeNull();

    const bloqueos = await prisma.fechaBloqueada.findMany({
      where: { tenantId: TENANT, fecha: FECHA_SIN_COLA },
    });
    expect(bloqueos).toHaveLength(0);

    const transiciones = await prisma.auditLog.findMany({
      where: { entidadId: reservaId, accion: 'transicion', entidad: 'RESERVA' },
    });
    expect(transiciones).toHaveLength(1);
  });
});

// ===========================================================================
// C-2 [requires-real-db] — DOBLE descarte concurrente de la MISMA pre_reserva CON cola. Además
// de C-1, la cola de esa fecha se promueve EXACTAMENTE UNA vez (idempotencia de la promoción):
// la consulta primera en cola (`2d`) pasa a `2b` una sola vez, nunca dos.
//   spec-delta: "Descartar una pre-reserva con cola libera la fecha y promueve al primero
//   exactamente una vez".
// ===========================================================================

describe('[requires-real-db] Descarte de pre-reserva — C-2 doble descarte concurrente con cola promueve una vez', () => {
  it('debe_promover_al_primero_de_la_cola_exactamente_una_vez', async () => {
    const reservaId = await sembrarPreReserva(FECHA_CON_COLA);
    const enColaId = await sembrarConsultaEnCola(FECHA_CON_COLA, reservaId);

    const resultados = await Promise.allSettled([
      useCase.ejecutar(comando(reservaId)),
      useCase.ejecutar(comando(reservaId)),
    ]);

    expect(resultados.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(resultados.filter((r) => r.status === 'rejected')).toHaveLength(1);

    // La pre-reserva quedó cancelada.
    const cancelada = await prisma.reserva.findUnique({ where: { idReserva: reservaId } });
    expect(cancelada?.estado).toBe(EstadoReservaPrisma.reserva_cancelada);

    // La consulta en cola se promovió a `2b` UNA sola vez (no hay doble promoción).
    const promovida = await prisma.reserva.findUnique({ where: { idReserva: enColaId } });
    expect(promovida?.estado).toBe(EstadoReservaPrisma.consulta);
    expect(promovida?.subEstado).toBe(SubEstadoConsultaPrisma.s2b);

    // Como mucho UNA fila activa de FECHA_BLOQUEADA para (tenant, fecha) tras la promoción.
    const bloqueos = await prisma.fechaBloqueada.findMany({
      where: { tenantId: TENANT, fecha: FECHA_CON_COLA },
    });
    expect(bloqueos.length).toBeLessThanOrEqual(1);
  });
});
