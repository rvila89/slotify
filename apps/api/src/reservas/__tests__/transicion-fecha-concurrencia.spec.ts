/**
 * TESTS DE CONCURRENCIA REALES de la transición «añadir fecha» (US-005 / UC-04) —
 * fase TDD RED. tasks.md Fase 3: 3.5. ZONA CRÍTICA (anti-doble-reserva D4).
 *
 * Trazabilidad: US-005, spec-delta `consultas` (Requirement "Concurrencia
 * anti-doble-reserva (D4) en la transición a 2.b", escenario "Dos transiciones
 * simultáneas sobre fecha libre — una 2.b, la otra cola"), design.md §D-5 (catch
 * `UNIQUE(tenant,fecha)` → re-derivar a 2.d; `posicion_cola` serializada por la fila
 * bloqueante + UNIQUE parcial). CLAUDE.md §Testing ("tests de concurrencia del
 * bloqueo atómico de fecha antes que UI o CRUD").
 *
 * INTEGRACIÓN con TRANSACCIONES REALES contra el Postgres del docker-compose (no
 * mocks): la garantía D4 vive en el motor (`UNIQUE(tenant_id, fecha)` + `SELECT … FOR
 * UPDATE`), nunca en Redis/locks distribuidos (regla dura del proyecto). Mismo
 * enfoque que `alta-consulta-con-fecha-concurrencia.spec.ts` (US-004) y
 * `bloquear-fecha-integracion.spec.ts` (US-040). Requiere `docker compose up -d
 * postgres` + migración + seed.
 *
 * A diferencia de US-004 (que CREA leads nuevos), aquí se transicionan RESERVA que ya
 * existen en 2.a: se siembran primero y luego se llama a la transición en paralelo.
 *
 * RED: aún NO existe `application/transicion-fecha.use-case.ts`. El import falla en
 * compilación y la batería entera está en ROJO por AUSENCIA DE IMPLEMENTACIÓN (no por
 * infraestructura: el Postgres está arriba, como prueban las suites de US-040/US-004).
 * GREEN es de `backend-developer`.
 */
import { Test, type TestingModule } from '@nestjs/testing';
import { ConfigModule } from '@nestjs/config';
import { CanalEntrada, EstadoReserva, SubEstadoConsulta } from '@prisma/client';
import { ReservasModule } from '../reservas.module';
import { PrismaService } from '../../shared/prisma/prisma.service';
import {
  TransicionFechaUseCase,
  AsignarFechaConflictoError,
  type TransicionFechaComando,
} from '../application/transicion-fecha.use-case';

const TENANT = '00000000-0000-0000-0000-000000000001';
const GESTOR = '00000000-0000-0000-0000-000000000002';
const EMAIL_PATTERN = '@us005-conc.test';

// Fechas estrictamente futuras y aisladas (no usadas por el seed ni otras suites).
const FECHA_DOS = new Date('2027-10-12T00:00:00.000Z');
const FECHA_N = new Date('2027-10-13T00:00:00.000Z');
const FECHAS = [FECHA_DOS, FECHA_N];

let moduleRef: TestingModule;
let prisma: PrismaService;
let useCase: TransicionFechaUseCase;

const sufijo = (): string => Math.random().toString(36).slice(2, 8);

const comando = (
  reservaId: string,
  fecha: Date,
  aceptarCola?: boolean,
): TransicionFechaComando => ({
  tenantId: TENANT,
  usuarioId: GESTOR,
  reservaId,
  fechaEvento: fecha,
  ...(aceptarCola !== undefined ? { aceptarCola } : {}),
});

/** Siembra una RESERVA del TENANT en `consulta`/`2a` (origen de la transición). */
const sembrarReserva2a = async (): Promise<string> => {
  const cliente = await prisma.cliente.create({
    data: { tenantId: TENANT, nombre: 'Conc', email: `c-${sufijo()}${EMAIL_PATTERN}` },
  });
  const reserva = await prisma.reserva.create({
    data: {
      tenantId: TENANT,
      clienteId: cliente.idCliente,
      codigo: `TST-U005C-${sufijo()}`,
      estado: EstadoReserva.consulta,
      subEstado: SubEstadoConsulta.s2a,
      canalEntrada: CanalEntrada.web,
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
  useCase = moduleRef.get(TransicionFechaUseCase);
});

afterAll(async () => {
  await limpiar();
  await moduleRef.close();
});

beforeEach(async () => {
  await limpiar();
});

// ===========================================================================
// 1. Dos transiciones concurrentes SIN aceptarCola → 1 gana (2.b), 1 ofrecida cola.
//    Variante del flujo interactivo: la perdedora recibe 409 colaDisponible y
//    permanece en 2.a (no hay doble bloqueo).
// ===========================================================================

describe('Transición — D4: dos concurrentes sin aceptarCola (1×2.b + 1 conflicto cola)', () => {
  it('debe_dejar_exactamente_una_2b_con_bloqueo_y_ofrecer_cola_a_la_otra_sin_doble_bloqueo', async () => {
    const reservaA = await sembrarReserva2a();
    const reservaB = await sembrarReserva2a();

    const resultados = await Promise.allSettled([
      useCase.ejecutar(comando(reservaA, FECHA_DOS)),
      useCase.ejecutar(comando(reservaB, FECHA_DOS)),
    ]);

    // Exactamente 1 transición confirma (2.b) y 1 se rechaza con oferta de cola.
    const cumplidas = resultados.filter((r) => r.status === 'fulfilled');
    const rechazadas = resultados.filter((r) => r.status === 'rejected');
    expect(cumplidas).toHaveLength(1);
    expect(rechazadas).toHaveLength(1);

    const rechazo = (rechazadas[0] as PromiseRejectedResult).reason;
    expect(rechazo).toBeInstanceOf(AsignarFechaConflictoError);
    expect((rechazo as AsignarFechaConflictoError).colaDisponible).toBe(true);

    // Estado final: 1 sola fila de FECHA_BLOQUEADA y 1 sola RESERVA en s2b.
    const bloqueos = await prisma.fechaBloqueada.count({
      where: { tenantId: TENANT, fecha: FECHA_DOS },
    });
    expect(bloqueos).toBe(1);

    const enDosB = await prisma.reserva.count({
      where: { idReserva: { in: [reservaA, reservaB] }, subEstado: SubEstadoConsulta.s2b },
    });
    expect(enDosB).toBe(1);

    // La perdedora permanece en 2.a (no se ha mutado: el conflicto la dejó intacta).
    const enDosA = await prisma.reserva.count({
      where: { idReserva: { in: [reservaA, reservaB] }, subEstado: SubEstadoConsulta.s2a },
    });
    expect(enDosA).toBe(1);
  });
});

// ===========================================================================
// 2. Dos transiciones concurrentes CON aceptarCola=true → 1×2.b + 1×2.d (pos 1).
// ===========================================================================

describe('Transición — D4: dos concurrentes con aceptarCola (1×2.b + 1×2.d pos 1)', () => {
  it('debe_producir_una_2b_con_bloqueo_y_una_2d_con_posicion_1_apuntando_a_la_ganadora', async () => {
    const reservaA = await sembrarReserva2a();
    const reservaB = await sembrarReserva2a();

    const resultados = await Promise.allSettled([
      useCase.ejecutar(comando(reservaA, FECHA_DOS, true)),
      useCase.ejecutar(comando(reservaB, FECHA_DOS, true)),
    ]);

    // Con aceptarCola la perdedora entra directamente en cola: ninguna se rechaza.
    expect(resultados.filter((r) => r.status === 'rejected')).toHaveLength(0);

    const bloqueos = await prisma.fechaBloqueada.count({
      where: { tenantId: TENANT, fecha: FECHA_DOS },
    });
    expect(bloqueos).toBe(1);

    const ganadora = await prisma.reserva.findFirst({
      where: { idReserva: { in: [reservaA, reservaB] }, subEstado: SubEstadoConsulta.s2b },
      select: { idReserva: true },
    });
    expect(ganadora).not.toBeNull();

    const enCola = await prisma.reserva.findMany({
      where: { idReserva: { in: [reservaA, reservaB] }, subEstado: SubEstadoConsulta.s2d },
      select: { posicionCola: true, consultaBloqueanteId: true },
    });
    expect(enCola).toHaveLength(1);
    expect(enCola[0].posicionCola).toBe(1);
    expect(enCola[0].consultaBloqueanteId).toBe(ganadora?.idReserva);
  });
});

// ===========================================================================
// 3. N transiciones concurrentes con aceptarCola → 1×2.b + (N-1)×2.d, posiciones
//    1..N-1 ÚNICAS y CONTIGUAS, 1 solo bloqueo.
// ===========================================================================

describe('Transición — D5: N concurrentes con aceptarCola (1×2.b + N-1×2.d contiguas)', () => {
  it('debe_producir_un_unico_bloqueo_y_posiciones_de_cola_unicas_y_contiguas_1_a_N_menos_1', async () => {
    const N = 5;
    const reservaIds = await Promise.all(
      Array.from({ length: N }, () => sembrarReserva2a()),
    );

    const resultados = await Promise.allSettled(
      reservaIds.map((id) => useCase.ejecutar(comando(id, FECHA_N, true))),
    );
    expect(resultados.filter((r) => r.status === 'rejected')).toHaveLength(0);

    const bloqueos = await prisma.fechaBloqueada.count({
      where: { tenantId: TENANT, fecha: FECHA_N },
    });
    expect(bloqueos).toBe(1);

    const enDosB = await prisma.reserva.count({
      where: { idReserva: { in: reservaIds }, subEstado: SubEstadoConsulta.s2b },
    });
    expect(enDosB).toBe(1);

    const enCola = await prisma.reserva.findMany({
      where: { idReserva: { in: reservaIds }, subEstado: SubEstadoConsulta.s2d },
      select: { posicionCola: true },
    });
    expect(enCola).toHaveLength(N - 1);

    const posiciones = enCola
      .map((r) => r.posicionCola)
      .sort((a, b) => (a ?? 0) - (b ?? 0));
    expect(new Set(posiciones).size).toBe(N - 1); // únicas
    expect(posiciones).toEqual(Array.from({ length: N - 1 }, (_, i) => i + 1)); // contiguas
  });
});
