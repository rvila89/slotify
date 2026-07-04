/**
 * TESTS DE CONCURRENCIA del barrido de CIERRE AUTOMÁTICO de ficha operativa en T-1d
 * (US-026 / UC-20 FA-01, actor Sistema) — fase TDD RED. tasks.md Fase 3: 3.10.
 * ZONA CRÍTICA (skill `concurrency-locking`).
 *
 * Trazabilidad: US-026; spec-delta `ficha-operativa` (Requirement "Idempotencia del
 * barrido" + escenarios de concurrencia); design.md §D-6:
 *   - C-1: doble ejecución del cron sobre la MISMA RESERVA → EXACTAMENTE un cierre.
 *   - C-2: cierre manual (US-025) vs cierre automático concurrentes → EXACTAMENTE uno
 *     aplica la transición `→ cerrado`, sin estado intermedio ni DOBLE auditoría.
 * CLAUDE.md §Regla crítica: SIN Redis ni locks distribuidos (hook `no-distributed-lock`);
 * la serialización la da el motor de PostgreSQL sobre la fila de RESERVA/FICHA_OPERATIVA
 * (re-evaluación de la guarda DENTRO de la transacción de cada RESERVA).
 *
 * INTEGRACIÓN con TRANSACCIONES REALES contra el Postgres AISLADO de tests
 * (`slotify_test`, `.env.test`). Las operaciones rivales se lanzan con
 * `Promise.allSettled()` para FORZAR la carrera (patrón del skill y de
 * `expirar-consultas-concurrencia.spec.ts` de US-012). Los tests usan fechas de evento
 * propias/aisladas para no agravar la flakiness conocida de US-004 (deadlock 40P01,
 * PRE-EXISTENTE y ajena a este change).
 *
 * RED: aún NO existe `application/cerrar-fichas-vencidas.service.ts` ni su adaptador de
 * UoW/registro en `FichaEventoModule`; los imports/símbolos fallan y la batería está en
 * ROJO por AUSENCIA DE IMPLEMENTACIÓN (el Postgres está arriba, no es fallo de infra).
 * GREEN es de `backend-developer`.
 */
import { Test, type TestingModule } from '@nestjs/testing';
import { ConfigModule } from '@nestjs/config';
import { CanalEntrada, EstadoReserva, PreEventoStatus } from '@prisma/client';
import { FichaEventoModule } from '../ficha-evento.module';
import { PrismaService } from '../../shared/prisma/prisma.service';
import { CerrarFichasVencidasService } from '../application/cerrar-fichas-vencidas.service';
import { CerrarFichaOperativaUseCase } from '../application/cerrar-ficha-operativa.use-case';

const TENANT = '00000000-0000-0000-0000-000000000001';
const GESTOR = '00000000-0000-0000-0000-000000000002';
const EMAIL_PATTERN = '@us026-conc.test';
const DIA_MS = 24 * 60 * 60 * 1000;

/** Fecha de calendario de "mañana" a mediodía UTC (candidata determinista del barrido). */
const manana = (): Date => {
  const base = new Date();
  base.setUTCHours(12, 0, 0, 0);
  return new Date(base.getTime() + DIA_MS);
};

let moduleRef: TestingModule;
let prisma: PrismaService;
let barrido: CerrarFichasVencidasService;
let cierreManual: CerrarFichaOperativaUseCase;

const sufijo = (): string => Math.random().toString(36).slice(2, 8);

const sembrar = async (): Promise<{ reservaId: string }> => {
  const cliente = await prisma.cliente.create({
    data: { tenantId: TENANT, nombre: 'Conc', email: `c-${sufijo()}${EMAIL_PATTERN}` },
  });
  const reserva = await prisma.reserva.create({
    data: {
      tenantId: TENANT,
      clienteId: cliente.idCliente,
      codigo: `TST-U026C-${sufijo()}`,
      estado: EstadoReserva.reserva_confirmada,
      canalEntrada: CanalEntrada.web,
      fechaEvento: manana(),
      preEventoStatus: PreEventoStatus.en_curso,
    },
  });
  await prisma.fichaOperativa.create({
    data: { reservaId: reserva.idReserva, fichaCerrada: false },
  });
  return { reservaId: reserva.idReserva };
};

const leerReserva = (reservaId: string) =>
  prisma.reserva.findUnique({ where: { idReserva: reservaId } });
const leerFicha = (reservaId: string) =>
  prisma.fichaOperativa.findUnique({ where: { reservaId } });
const contarTransiciones = (reservaId: string): Promise<number> =>
  prisma.auditLog.count({ where: { entidadId: reservaId, accion: 'transicion' } });

const limpiar = async (): Promise<void> => {
  const clientes = await prisma.cliente.findMany({
    where: { email: { contains: EMAIL_PATTERN } },
    select: { idCliente: true },
  });
  const clienteIds = clientes.map((c) => c.idCliente);
  const reservas = await prisma.reserva.findMany({
    where: { clienteId: { in: clienteIds } },
    select: { idReserva: true },
  });
  const ids = reservas.map((r) => r.idReserva);
  if (ids.length > 0) {
    await prisma.fichaOperativa.deleteMany({ where: { reservaId: { in: ids } } });
    await prisma.auditLog.deleteMany({ where: { entidadId: { in: ids } } });
    await prisma.reserva.deleteMany({ where: { idReserva: { in: ids } } });
  }
  if (clienteIds.length > 0) {
    await prisma.cliente.deleteMany({ where: { idCliente: { in: clienteIds } } });
  }
};

beforeAll(async () => {
  moduleRef = await Test.createTestingModule({
    imports: [ConfigModule.forRoot({ isGlobal: true }), FichaEventoModule],
  }).compile();
  await moduleRef.init();
  prisma = moduleRef.get(PrismaService);
  barrido = moduleRef.get(CerrarFichasVencidasService);
  cierreManual = moduleRef.get(CerrarFichaOperativaUseCase);
});

afterAll(async () => {
  await limpiar();
  await moduleRef.close();
});

beforeEach(async () => {
  await limpiar();
});

// ===========================================================================
// C-1 — Doble ejecución CONCURRENTE del barrido sobre la MISMA RESERVA: EXACTAMENTE
//        un cierre; el segundo re-evalúa la guarda bajo transacción, la ve ya
//        `cerrado` y no muta. Sin doble transición ni doble auditoría.
//        (skill concurrency-locking: Promise.allSettled.)
// ===========================================================================

describe('Barrido US-026 — C-1: doble barrido simultáneo, un solo cierre', () => {
  it('debe_cerrar_la_ficha_exactamente_una_vez_ante_dos_barridos_concurrentes', async () => {
    const { reservaId } = await sembrar();

    const resultados = await Promise.allSettled([barrido.ejecutar(), barrido.ejecutar()]);

    // Ninguno FALLA (idempotencia: el que llega tarde es no-op silencioso).
    const cumplidos = resultados.filter((r) => r.status === 'fulfilled') as
      PromiseFulfilledResult<{ fichasCerradas: number }>[];
    expect(cumplidos).toHaveLength(2);

    // Estado final DETERMINISTA: una sola transición a cerrado.
    expect((await leerReserva(reservaId))?.preEventoStatus).toBe(PreEventoStatus.cerrado);
    expect((await leerFicha(reservaId))?.fichaCerrada).toBe(true);

    // La suma de fichasCerradas de AMBAS pasadas es exactamente 1 (nunca 2).
    const total = cumplidos.reduce((acc, r) => acc + r.value.fichasCerradas, 0);
    expect(total).toBe(1);

    // Exactamente UNA entrada de transición (sin duplicados).
    expect(await contarTransiciones(reservaId)).toBe(1);
  });
});

// ===========================================================================
// C-2 — Cierre manual (US-025) vs cierre automático (US-026), concurrentes sobre la
//        MISMA RESERVA: EXACTAMENTE uno aplica la transición `→ cerrado`; el otro
//        re-evalúa y no re-cierra. Nunca estado intermedio ni DOBLE auditoría.
// ===========================================================================

describe('Barrido US-026 — C-2: cierre manual (US-025) vs automático concurrentes', () => {
  it('debe_aplicar_exactamente_un_cierre_sin_estado_intermedio_ni_doble_auditoria', async () => {
    const { reservaId } = await sembrar();

    const resultados = await Promise.allSettled([
      barrido.ejecutar(),
      cierreManual.ejecutar({ tenantId: TENANT, usuarioId: GESTOR, reservaId }),
    ]);

    // El barrido nunca falla (idempotente); el cierre manual puede fallar o no según
    // el interleaving, pero el estado final es SIEMPRE coherente.
    expect(resultados[0].status).toBe('fulfilled');

    const reserva = await leerReserva(reservaId);
    const ficha = await leerFicha(reservaId);
    // INVARIANTE: exactamente `cerrado`, ficha cerrada; nunca un estado intermedio.
    expect(reserva?.preEventoStatus).toBe(PreEventoStatus.cerrado);
    expect(ficha?.fichaCerrada).toBe(true);

    // Exactamente UNA transición de cierre (uno gana, el otro se autoexcluye): sin
    // doble auditoría aunque ambas vías compitan.
    expect(await contarTransiciones(reservaId)).toBe(1);
  });
});
