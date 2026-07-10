/**
 * TESTS DE CONCURRENCIA REALES del barrido de ARCHIVADO AUTOMÁTICO en T+7d
 * (US-037 / UC-28, actor Sistema) — fase TDD RED. tasks.md Fase 4: 4.13.
 * ZONA CRÍTICA (skill `concurrency-locking`).
 *
 * ⚠️ REQUIERE POSTGRES REAL — NO EJECUTAR EN SUBAGENTES (memoria "Subagentes sin
 * Docker/Postgres"). Se lanza desde la sesión principal con el Postgres AISLADO de tests
 * (`slotify_test`, `.env.test`) y la migración de `fechaPostEvento` (D-2=A) aplicada.
 *
 * Trazabilidad: US-037; spec-delta `consultas` (Requirements "Idempotencia del barrido —
 * reserva ya en reserva_completada no se re-archiva" y "Concurrencia cron vs archivado
 * manual (US-038) — exactamente una transición gana sin error"), design.md §D-7:
 *   - RC-1: doble ejecución del cron sobre la MISMA RESERVA → EXACTAMENTE una transición,
 *     0 auditorías duplicadas. El segundo pase re-evalúa la guarda de ORIGEN
 *     (`resolverArchivadoAutomatico`) bajo `SELECT … FOR UPDATE`, la ve ya
 *     `reserva_completada` (la UPDATE afecta 0 filas) y termina no-op sin error.
 *   - RC-2: cron (US-037) vs "SEGUNDO ACTOR" (US-038 archivado manual, aún NO implementado
 *     — se SIMULA con una segunda transacción concurrente sobre la MISMA fila que usa la
 *     MISMA guarda de origen a través del puerto de UoW `ARCHIVADO_PORT`) → EXACTAMENTE
 *     uno gana `→ reserva_completada`; el otro re-evalúa bajo el lock, su UPDATE afecta 0
 *     filas y termina no-op sin error. `AUDIT_LOG` contiene EXACTAMENTE una entrada de
 *     transición. Cuando US-038 aterrice sobre esta MISMA guarda, hereda la garantía sin
 *     cambios en US-037.
 *
 * CLAUDE.md §Regla crítica / §Jobs asíncronos: SIN Redis ni locks distribuidos (hook
 * `no-distributed-lock`); la serialización la da PostgreSQL sobre la fila RESERVA
 * (`SELECT … FOR UPDATE` + re-evaluación de la guarda DENTRO de la transacción). El
 * bloqueo atómico de fecha (`FECHA_BLOQUEADA`/cola) NO aplica aquí (US-037 no lo toca).
 *
 * Las operaciones rivales se lanzan con `Promise.allSettled()` para FORZAR la carrera
 * (patrón del skill y de `iniciar-eventos-del-dia-concurrencia.spec.ts` de US-031 /
 * `cerrar-fichas-vencidas-concurrencia.spec.ts` de US-026). Los tests usan clientes/reservas
 * propios y limpian su sembrado; NO dependen del deadlock 40P01 flaky de US-004 (memoria
 * "US-004 concurrency test flaky"), ajeno a este change.
 *
 * RED: aún NO existen `application/archivar-reservas-completadas.service.ts`, el puerto de
 * UoW `ArchivadoPort` ni su token `ARCHIVADO_PORT`, ni su registro en `ReservasModule`;
 * los imports/símbolos fallan y la batería está en ROJO por AUSENCIA DE IMPLEMENTACIÓN
 * (el Postgres está arriba, no es fallo de infra). GREEN es de `backend-developer`.
 */
import { Test, type TestingModule } from '@nestjs/testing';
import { ConfigModule } from '@nestjs/config';
import {
  CanalEntrada,
  EstadoReserva,
  FianzaStatus,
} from '@prisma/client';
import { ReservasModule } from '../reservas.module';
import { PrismaService } from '../../shared/prisma/prisma.service';
import {
  ArchivarReservasCompletadasService,
  type ArchivadoPort,
  type ReservaCompletableCandidata,
} from '../application/archivar-reservas-completadas.service';
import { ARCHIVADO_PORT } from '../reservas.tokens';

const TENANT = '00000000-0000-0000-0000-000000000001';
const EMAIL_PATTERN = '@us037-conc.test';
const DIA_MS = 24 * 60 * 60 * 1000;

const aMediodiaUTC = (offsetDias: number): Date => {
  const base = new Date();
  base.setUTCHours(12, 0, 0, 0);
  return new Date(base.getTime() + offsetDias * DIA_MS);
};
const HACE_8_DIAS = aMediodiaUTC(-8);

let moduleRef: TestingModule;
let prisma: PrismaService;
let barrido: ArchivarReservasCompletadasService;
let archivadoUoW: ArchivadoPort;

const sufijo = (): string => Math.random().toString(36).slice(2, 8);

const sembrar = async (): Promise<{
  reservaId: string;
  candidata: ReservaCompletableCandidata;
}> => {
  const cliente = await prisma.cliente.create({
    data: { tenantId: TENANT, nombre: 'Conc', email: `c-${sufijo()}${EMAIL_PATTERN}` },
  });
  const codigo = `TST-U037C-${sufijo()}`;
  const reserva = await prisma.reserva.create({
    data: {
      tenantId: TENANT,
      clienteId: cliente.idCliente,
      codigo,
      estado: EstadoReserva.post_evento,
      canalEntrada: CanalEntrada.web,
      fechaEvento: aMediodiaUTC(-10),
      fechaPostEvento: HACE_8_DIAS,
      fianzaStatus: FianzaStatus.devuelta,
      fianzaEur: 300,
    },
  });
  // Proyección de candidata equivalente a la que emite la lectura cross-tenant, para que
  // el "segundo actor" (US-038 simulado) invoque la MISMA UoW/guarda sobre la fila.
  const candidata: ReservaCompletableCandidata = {
    reservaId: reserva.idReserva,
    codigo,
    tenantId: TENANT,
    fechaPostEvento: HACE_8_DIAS,
    fianzaStatus: 'devuelta',
    fianzaEur: 300,
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
  barrido = moduleRef.get(ArchivarReservasCompletadasService);
  archivadoUoW = moduleRef.get(ARCHIVADO_PORT);
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
//        `reserva_completada` y no muta. Sin doble transición ni doble auditoría.
//        (skill concurrency-locking: Promise.allSettled.)
// ===========================================================================

describe('Barrido US-037 — RC-1: doble barrido simultáneo, una sola transición', () => {
  it('debe_archivar_exactamente_una_vez_ante_dos_barridos_concurrentes', async () => {
    const { reservaId } = await sembrar();

    const resultados = await Promise.allSettled([barrido.ejecutar(), barrido.ejecutar()]);

    // Ninguno FALLA (idempotencia: el que llega tarde es no-op silencioso).
    const cumplidos = resultados.filter((r) => r.status === 'fulfilled') as
      PromiseFulfilledResult<{ archivadas: number }>[];
    expect(cumplidos).toHaveLength(2);

    // Estado final DETERMINISTA: una sola transición a reserva_completada.
    expect((await leerReserva(reservaId))?.estado).toBe(EstadoReserva.reserva_completada);

    // La suma de archivadas de AMBAS pasadas es exactamente 1 (nunca 2).
    const total = cumplidos.reduce((acc, r) => acc + r.value.archivadas, 0);
    expect(total).toBe(1);

    // Exactamente UNA entrada de transición (sin duplicados).
    expect(await contarTransiciones(reservaId)).toBe(1);
  });
});

// ===========================================================================
// RC-2 — Cron vs SEGUNDO ACTOR (US-038 archivado manual SIMULADO), concurrentes sobre la
//        MISMA RESERVA a través de la MISMA UoW/guarda de origen: EXACTAMENTE uno aplica
//        `→ reserva_completada`; el otro re-evalúa bajo el lock, su UPDATE afecta 0 filas y
//        termina no-op sin error. Nunca estado intermedio ni DOBLE auditoría. Cuando US-038
//        aterrice sobre esta guarda, hereda la garantía sin cambios en US-037.
// ===========================================================================

describe('Barrido US-037 — RC-2: cron vs segundo actor (US-038 simulado) concurrentes', () => {
  it('debe_aplicar_exactamente_una_transicion_sin_doble_auditoria_ni_estado_intermedio', async () => {
    const { reservaId, candidata } = await sembrar();

    // El barrido (cron) y el "segundo actor" (US-038 simulado) invocan la MISMA UoW de
    // transición sobre la MISMA fila, en la misma ventana temporal.
    const resultados = await Promise.allSettled([
      barrido.ejecutar(),
      archivadoUoW.archivarReserva(candidata),
    ]);

    // El barrido nunca falla (idempotente). El segundo actor re-evalúa bajo el lock: o
    // gana la transición o la encuentra ya hecha (0 filas), sin error.
    expect(resultados[0].status).toBe('fulfilled');
    expect(resultados[1].status).toBe('fulfilled');

    // INVARIANTE: exactamente `reserva_completada`; nunca un estado intermedio.
    expect((await leerReserva(reservaId))?.estado).toBe(EstadoReserva.reserva_completada);

    // Exactamente UNA transición (uno gana, el otro se autoexcluye): sin doble auditoría
    // aunque ambas vías compitan por la misma fila.
    expect(await contarTransiciones(reservaId)).toBe(1);
  });
});
