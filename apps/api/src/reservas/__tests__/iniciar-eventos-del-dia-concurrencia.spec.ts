/**
 * TESTS DE CONCURRENCIA REALES del barrido de INICIO AUTOMÁTICO DE EVENTO en T-0
 * (US-031 / UC-23, actor Sistema) — fase TDD RED. tasks.md Fase 3: 3.11.
 * ZONA CRÍTICA (skill `concurrency-locking`).
 *
 * Trazabilidad: US-031; spec-delta `consultas` (Requirements "Idempotencia del barrido"
 * y "Concurrencia cron vs gestor — exactamente una transición gana sin error"),
 * design.md §D-6:
 *   - RC-1: doble ejecución del cron sobre la MISMA RESERVA → EXACTAMENTE una transición,
 *     0 auditorías duplicadas. El segundo pase re-evalúa la guarda de ORIGEN bajo
 *     `SELECT … FOR UPDATE`, la ve ya `evento_en_curso` (la UPDATE afecta 0 filas) y
 *     termina no-op sin error.
 *   - RC-2: cron vs "SEGUNDO ACTOR" (US-032 forzado manual, aún NO implementado —se
 *     SIMULA con una segunda transacción concurrente sobre la MISMA fila que usa la
 *     MISMA guarda de origen a través del puerto de UoW `INICIO_EVENTO_PORT`) →
 *     EXACTAMENTE uno gana `→ evento_en_curso`; el otro re-evalúa bajo el lock, su UPDATE
 *     afecta 0 filas y termina no-op sin error. `AUDIT_LOG` contiene EXACTAMENTE una
 *     entrada de transición. Cuando US-032 aterrice sobre esta MISMA guarda, hereda la
 *     garantía sin cambios en US-031.
 *
 * CLAUDE.md §Regla crítica / §Jobs asíncronos: SIN Redis ni locks distribuidos (hook
 * `no-distributed-lock`); la serialización la da PostgreSQL sobre la fila RESERVA
 * (`SELECT … FOR UPDATE` + re-evaluación de la guarda DENTRO de la transacción). El
 * bloqueo atómico de fecha (`FECHA_BLOQUEADA`/cola) NO aplica aquí (US-031 no lo toca).
 *
 * INTEGRACIÓN con TRANSACCIONES REALES contra el Postgres AISLADO de tests
 * (`slotify_test`, `.env.test`). Las operaciones rivales se lanzan con
 * `Promise.allSettled()` para FORZAR la carrera (patrón del skill y de
 * `expirar-consultas-concurrencia.spec.ts` de US-012 / `cerrar-fichas-vencidas-
 * concurrencia.spec.ts` de US-026). Los tests usan fechas/clientes propios y limpian su
 * sembrado; NO dependen del deadlock 40P01 flaky de US-004 (memoria "US-004 concurrency
 * test flaky"), ajeno a este change.
 *
 * RED: aún NO existen `application/iniciar-eventos-del-dia.service.ts`, el puerto de UoW
 * `InicioEventoPort` ni su token `INICIO_EVENTO_PORT`, ni su registro en `ReservasModule`;
 * los imports/símbolos fallan y la batería está en ROJO por AUSENCIA DE IMPLEMENTACIÓN
 * (el Postgres está arriba, no es fallo de infra). GREEN es de `backend-developer`.
 */
import { Test, type TestingModule } from '@nestjs/testing';
import { ConfigModule } from '@nestjs/config';
import {
  CanalEntrada,
  EstadoReserva,
  FianzaStatus,
  LiquidacionStatus,
  PreEventoStatus,
} from '@prisma/client';
import { ReservasModule } from '../reservas.module';
import { PrismaService } from '../../shared/prisma/prisma.service';
import {
  IniciarEventosDelDiaService,
  type InicioEventoPort,
  type EventoCandidato,
} from '../application/iniciar-eventos-del-dia.service';
import { INICIO_EVENTO_PORT } from '../reservas.tokens';

const TENANT = '00000000-0000-0000-0000-000000000001';
const EMAIL_PATTERN = '@us031-conc.test';

/** Fecha de calendario de "hoy" a mediodía UTC (candidata determinista del barrido). */
const hoy = (): Date => {
  const base = new Date();
  base.setUTCHours(12, 0, 0, 0);
  return base;
};

let moduleRef: TestingModule;
let prisma: PrismaService;
let barrido: IniciarEventosDelDiaService;
let inicioUoW: InicioEventoPort;

const sufijo = (): string => Math.random().toString(36).slice(2, 8);

const sembrar = async (): Promise<{ reservaId: string; candidata: EventoCandidato }> => {
  const cliente = await prisma.cliente.create({
    data: { tenantId: TENANT, nombre: 'Conc', email: `c-${sufijo()}${EMAIL_PATTERN}` },
  });
  const reserva = await prisma.reserva.create({
    data: {
      tenantId: TENANT,
      clienteId: cliente.idCliente,
      codigo: `TST-U031C-${sufijo()}`,
      estado: EstadoReserva.reserva_confirmada,
      canalEntrada: CanalEntrada.web,
      fechaEvento: hoy(),
      preEventoStatus: PreEventoStatus.cerrado,
      liquidacionStatus: LiquidacionStatus.cobrada,
      fianzaStatus: FianzaStatus.cobrada,
      condPartFirmadas: true,
    },
  });
  // Proyección de candidata equivalente a la que emite la lectura cross-tenant, para que
  // el "segundo actor" (US-032 simulado) invoque la MISMA UoW/guarda sobre la fila.
  const candidata: EventoCandidato = {
    reservaId: reserva.idReserva,
    tenantId: TENANT,
    fechaEvento: hoy(),
    preEventoStatus: 'cerrado',
    liquidacionStatus: 'cobrada',
    fianzaStatus: 'cobrada',
    condPartFirmadas: true,
  };
  return { reservaId: reserva.idReserva, candidata };
};

const leerReserva = (reservaId: string) =>
  prisma.reserva.findUnique({ where: { idReserva: reservaId } });
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
    await prisma.auditLog.deleteMany({ where: { entidadId: { in: ids } } });
    await prisma.reserva.deleteMany({ where: { idReserva: { in: ids } } });
  }
  if (clienteIds.length > 0) {
    await prisma.cliente.deleteMany({ where: { idCliente: { in: clienteIds } } });
  }
};

beforeAll(async () => {
  moduleRef = await Test.createTestingModule({
    imports: [ConfigModule.forRoot({ isGlobal: true }), ReservasModule],
  }).compile();
  await moduleRef.init();
  prisma = moduleRef.get(PrismaService);
  barrido = moduleRef.get(IniciarEventosDelDiaService);
  inicioUoW = moduleRef.get(INICIO_EVENTO_PORT);
});

afterAll(async () => {
  await limpiar();
  await moduleRef.close();
});

beforeEach(async () => {
  await limpiar();
});

// ===========================================================================
// RC-1 — Doble ejecución CONCURRENTE del barrido sobre la MISMA RESERVA: EXACTAMENTE una
//        transición; el segundo re-evalúa la guarda de origen bajo transacción, la ve ya
//        `evento_en_curso` y no muta. Sin doble transición ni doble auditoría.
//        (skill concurrency-locking: Promise.allSettled.)
// ===========================================================================

describe('Barrido US-031 — RC-1: doble barrido simultáneo, una sola transición', () => {
  it('debe_iniciar_el_evento_exactamente_una_vez_ante_dos_barridos_concurrentes', async () => {
    const { reservaId } = await sembrar();

    const resultados = await Promise.allSettled([barrido.ejecutar(), barrido.ejecutar()]);

    // Ninguno FALLA (idempotencia: el que llega tarde es no-op silencioso).
    const cumplidos = resultados.filter((r) => r.status === 'fulfilled') as
      PromiseFulfilledResult<{ eventosIniciados: number }>[];
    expect(cumplidos).toHaveLength(2);

    // Estado final DETERMINISTA: una sola transición a evento_en_curso.
    expect((await leerReserva(reservaId))?.estado).toBe(EstadoReserva.evento_en_curso);

    // La suma de eventosIniciados de AMBAS pasadas es exactamente 1 (nunca 2).
    const total = cumplidos.reduce((acc, r) => acc + r.value.eventosIniciados, 0);
    expect(total).toBe(1);

    // Exactamente UNA entrada de transición (sin duplicados).
    expect(await contarTransiciones(reservaId)).toBe(1);
  });
});

// ===========================================================================
// RC-2 — Cron vs SEGUNDO ACTOR (US-032 forzado manual SIMULADO), concurrentes sobre la
//        MISMA RESERVA a través de la MISMA UoW/guarda de origen: EXACTAMENTE uno aplica
//        `→ evento_en_curso`; el otro re-evalúa bajo el lock, su UPDATE afecta 0 filas y
//        termina no-op sin error. Nunca estado intermedio ni DOBLE auditoría. Cuando
//        US-032 aterrice sobre esta guarda, hereda la garantía sin cambios en US-031.
// ===========================================================================

describe('Barrido US-031 — RC-2: cron vs segundo actor (US-032 simulado) concurrentes', () => {
  it('debe_aplicar_exactamente_una_transicion_sin_doble_auditoria_ni_estado_intermedio', async () => {
    const { reservaId, candidata } = await sembrar();

    // El barrido (cron) y el "segundo actor" (US-032 simulado) invocan la MISMA UoW de
    // transición sobre la MISMA fila, en la misma ventana temporal.
    const resultados = await Promise.allSettled([
      barrido.ejecutar(),
      inicioUoW.iniciarEvento(candidata),
    ]);

    // El barrido nunca falla (idempotente). El segundo actor re-evalúa bajo el lock: o
    // gana la transición o la encuentra ya hecha (0 filas), sin error.
    expect(resultados[0].status).toBe('fulfilled');
    expect(resultados[1].status).toBe('fulfilled');

    // INVARIANTE: exactamente `evento_en_curso`; nunca un estado intermedio.
    expect((await leerReserva(reservaId))?.estado).toBe(EstadoReserva.evento_en_curso);

    // Exactamente UNA transición (uno gana, el otro se autoexcluye): sin doble auditoría
    // aunque ambas vías compitan por la misma fila.
    expect(await contarTransiciones(reservaId)).toBe(1);
  });
});
