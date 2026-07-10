/**
 * TESTS DE CONCURRENCIA REALES del ARCHIVADO MANUAL del gestor (US-038 / UC-28 flujo
 * alternativo manual) — fase TDD RED. tasks.md Fase 4: 4.7. ZONA CRÍTICA (skill
 * `concurrency-locking`).
 *
 * ⚠️ REQUIERE POSTGRES REAL — NO EJECUTAR EN SUBAGENTES (memoria "Subagentes sin
 * Docker/Postgres"). Se lanza desde la SESIÓN PRINCIPAL con el Postgres AISLADO de tests
 * (`slotify_test`, `.env.test`; memoria "Tests con BD aislada slotify_test").
 *
 * Trazabilidad: US-038; spec-delta `consultas` (Requirement "Idempotencia y concurrencia del
 * archivado manual frente al cron de US-037" — Scenarios "Cron (US-037) y archivado manual
 * (US-038) compiten por la misma RESERVA" y "Doble clic del gestor sobre archivar — la
 * segunda petición no re-archiva"); design.md §D-6:
 *   - RC-1: cron US-037 (`ArchivarReservasCompletadasService.ejecutar()`) vs. gestor US-038
 *     (`ArchivarReservaManualUseCase.ejecutar()`) sobre la MISMA RESERVA `post_evento` con la
 *     fianza resuelta → EXACTAMENTE una transición gana; la otra re-evalúa
 *     `resolverArchivadoAutomatico` bajo `SELECT … FOR UPDATE`, la ve ya `reserva_completada`
 *     (0 filas) y termina sin transicionar (no-op para el cron; 409 `transicion_no_permitida`
 *     para el gestor). `AUDIT_LOG` contiene EXACTAMENTE una entrada de transición.
 *   - RC-2: DOBLE CLIC del gestor — dos `ArchivarReservaManualUseCase.ejecutar()` concurrentes
 *     sobre la MISMA RESERVA → una gana (transiciona), la otra 409 `transicion_no_permitida`.
 *     Sin doble auditoría.
 *
 * CLAUDE.md §Regla crítica / §Jobs asíncronos: SIN Redis ni locks distribuidos (hook
 * `no-distributed-lock`); la serialización la da PostgreSQL sobre la fila RESERVA
 * (`SELECT … FOR UPDATE` + re-evaluación de la guarda DENTRO de la transacción). US-038 NO
 * toca `FECHA_BLOQUEADA` ni la cola: el lock es sobre la propia RESERVA. Las operaciones
 * rivales se lanzan con `Promise.allSettled()` para FORZAR la carrera (patrón del skill y de
 * `finalizar-evento-concurrencia.spec.ts` de US-034 /
 * `archivar-reservas-completadas-concurrencia.spec.ts` de US-037). Emails/reservas propios; se
 * limpia el sembrado; NO depende del deadlock 40P01 flaky de US-004 (ajeno).
 *
 * RED: aún NO existen `application/archivar-reserva-manual.use-case.ts` ni su cableado en
 * `ReservasModule`; los imports/símbolos fallan y la batería está en ROJO por AUSENCIA DE
 * IMPLEMENTACIÓN (el Postgres está arriba: no es fallo de infra). GREEN es de
 * `backend-developer`.
 */
import { Test, type TestingModule } from '@nestjs/testing';
import { ConfigModule } from '@nestjs/config';
import { CanalEntrada, EstadoReserva, FianzaStatus } from '@prisma/client';
import { ReservasModule } from '../reservas.module';
import { PrismaService } from '../../shared/prisma/prisma.service';
import { ArchivarReservasCompletadasService } from '../application/archivar-reservas-completadas.service';
import {
  ArchivarReservaManualUseCase,
  type ArchivarReservaManualComando,
} from '../application/archivar-reserva-manual.use-case';

const TENANT = '00000000-0000-0000-0000-000000000001';
const GESTOR = '00000000-0000-0000-0000-000000000002';
const EMAIL_PATTERN = '@us038-conc.test';
const DIA_MS = 24 * 60 * 60 * 1000;

const aMediodiaUTC = (offsetDias: number): Date => {
  const base = new Date();
  base.setUTCHours(12, 0, 0, 0);
  return new Date(base.getTime() + offsetDias * DIA_MS);
};
// El cron de US-037 solo archiva candidatas con fecha_post_evento en T+7d o más: para que la
// RC-1 sea real, la RESERVA debe ser candidata TAMBIÉN para el cron (hace 8 días).
const HACE_8_DIAS = aMediodiaUTC(-8);

let moduleRef: TestingModule;
let prisma: PrismaService;
let barridoCron: ArchivarReservasCompletadasService;
let archivadoManual: ArchivarReservaManualUseCase;

const sufijo = (): string => Math.random().toString(36).slice(2, 8);

/**
 * Siembra una RESERVA en `post_evento` con la fianza RESUELTA (devuelta) para que AMBAS vías
 * (cron y manual) sean candidatas y compitan por la misma transición. `fechaPostEvento` hace
 * 8 días para que el cron US-037 la considere candidata por antigüedad.
 */
const sembrar = async (): Promise<string> => {
  const cliente = await prisma.cliente.create({
    data: { tenantId: TENANT, nombre: 'Conc38', email: `c-${sufijo()}${EMAIL_PATTERN}` },
  });
  const reserva = await prisma.reserva.create({
    data: {
      tenantId: TENANT,
      clienteId: cliente.idCliente,
      codigo: `TST-U038C-${sufijo()}`,
      estado: EstadoReserva.post_evento,
      canalEntrada: CanalEntrada.web,
      fechaEvento: aMediodiaUTC(-10),
      fechaPostEvento: HACE_8_DIAS,
      fianzaStatus: FianzaStatus.devuelta,
      fianzaEur: '300.00',
    },
  });
  return reserva.idReserva;
};

const comando = (reservaId: string): ArchivarReservaManualComando => ({
  tenantId: TENANT,
  usuarioId: GESTOR,
  reservaId,
});

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
  barridoCron = moduleRef.get(ArchivarReservasCompletadasService);
  archivadoManual = moduleRef.get(ArchivarReservaManualUseCase);
});

afterAll(async () => {
  await limpiar();
  await moduleRef.close();
});

beforeEach(async () => {
  await limpiar();
});

// ===========================================================================
// RC-1 — Cron US-037 vs. gestor US-038 sobre la MISMA RESERVA: EXACTAMENTE una transición
//        gana; la otra re-evalúa la guarda de origen bajo el lock, la ve ya
//        `reserva_completada` (0 filas) y termina sin transicionar (no-op para el cron; 409
//        para el gestor). UNA sola entrada de AUDIT_LOG.
// ===========================================================================

describe('Archivado manual US-038 — RC-1: cron (US-037) vs gestor concurrentes', () => {
  it('debe_aplicar_exactamente_una_transicion_sin_doble_auditoria_ni_estado_intermedio', async () => {
    const reservaId = await sembrar();

    const resultados = await Promise.allSettled([
      barridoCron.ejecutar(),
      archivadoManual.ejecutar(comando(reservaId)),
    ]);

    // El cron nunca falla (idempotente: el que llega tarde es no-op silencioso).
    expect(resultados[0].status).toBe('fulfilled');
    // El gestor: o gana (fulfilled → reserva_completada) o pierde la carrera (rejected con
    // 409 transicion_no_permitida). Nunca otro error.
    if (resultados[1].status === 'rejected') {
      expect((resultados[1] as PromiseRejectedResult).reason).toMatchObject({
        codigo: 'transicion_no_permitida',
      });
    }

    // INVARIANTE: exactamente `reserva_completada`; nunca un estado intermedio.
    expect((await leerReserva(reservaId))?.estado).toBe(EstadoReserva.reserva_completada);

    // Exactamente UNA transición (uno gana, el otro se autoexcluye bajo el lock).
    expect(await contarTransiciones(reservaId)).toBe(1);
  });
});

// ===========================================================================
// RC-2 — Doble clic del gestor: dos archivados manuales CONCURRENTES sobre la MISMA RESERVA
//        → una gana (transiciona), la otra 409 `transicion_no_permitida`. Sin doble
//        auditoría (idempotencia bajo el `SELECT … FOR UPDATE`).
// ===========================================================================

describe('Archivado manual US-038 — RC-2: doble clic del gestor', () => {
  it('debe_permitir_un_archivado_y_rechazar_el_segundo_cuando_son_concurrentes', async () => {
    const reservaId = await sembrar();

    const resultados = await Promise.allSettled([
      archivadoManual.ejecutar(comando(reservaId)),
      archivadoManual.ejecutar(comando(reservaId)),
    ]);

    // EXACTAMENTE una gana (fulfilled) y una pierde la carrera (rejected con conflicto).
    const cumplidas = resultados.filter((r) => r.status === 'fulfilled');
    const rechazadas = resultados.filter((r) => r.status === 'rejected');
    expect(cumplidas).toHaveLength(1);
    expect(rechazadas).toHaveLength(1);

    // La perdedora falla como conflicto de estado (code=transicion_no_permitida).
    const perdedora = rechazadas[0] as PromiseRejectedResult;
    expect(perdedora.reason).toMatchObject({ codigo: 'transicion_no_permitida' });

    // Estado final DETERMINISTA: reserva_completada (la ganadora lo commiteó).
    expect((await leerReserva(reservaId))?.estado).toBe(EstadoReserva.reserva_completada);
  });

  it('no_debe_duplicar_la_transicion_en_audit_log_ante_dos_archivados_concurrentes', async () => {
    const reservaId = await sembrar();

    await Promise.allSettled([
      archivadoManual.ejecutar(comando(reservaId)),
      archivadoManual.ejecutar(comando(reservaId)),
    ]);

    // EXACTAMENTE una entrada de transición (la 2.ª UPDATE afectó 0 filas: no audita).
    expect(await contarTransiciones(reservaId)).toBe(1);
  });
});
