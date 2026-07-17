/**
 * TESTS DE CONCURRENCIA REALES del FORZADO MANUAL del inicio de evento (US-032 / UC-23
 * FA-01, actor Gestor) — fase TDD RED. tasks.md Fase 3: 3.8. ZONA CRÍTICA (skill
 * `concurrency-locking`).
 *
 * Trazabilidad: US-032, spec-delta `consultas` (Requirements "Cron llegó primero — el
 * forzado es idempotente y no genera doble efecto" y "Concurrencia — cron vs gestor (o
 * doble sesión) exactamente una transición gana sin error"), design.md §D-3:
 *   - RC-A: DOBLE SESIÓN del gestor (doble click / doble request) sobre la MISMA RESERVA
 *     en `reserva_confirmada`: bajo el `SELECT … FOR UPDATE`, la UPDATE condicional
 *     `WHERE estado='reserva_confirmada'` la gana EXACTAMENTE una; la otra ve 0 filas →
 *     no-op → 409 `conflicto_estado`. EXACTAMENTE una entrada de transición en AUDIT_LOG.
 *   - RC-B: CRON (US-031) vs GESTOR (US-032) sobre la MISMA fila y la MISMA guarda de
 *     origen (`resolverInicioEvento`): exactamente uno aplica `→ evento_en_curso`; el
 *     otro re-evalúa bajo el lock, su UPDATE afecta 0 filas y termina no-op sin error.
 *     US-032 hereda la garantía RC-2 que US-031 ya blindó, sin cambios en US-031.
 *
 * CLAUDE.md §Regla crítica / §Jobs asíncronos: SIN Redis ni locks distribuidos (hook
 * `no-distributed-lock`); la serialización la da PostgreSQL sobre la fila RESERVA
 * (`SELECT … FOR UPDATE` + UPDATE condicional). US-032 NO toca `FECHA_BLOQUEADA` ni la
 * cola (D-3). Mismo patrón que `finalizar-evento-concurrencia.spec.ts` (US-034) y
 * `iniciar-eventos-del-dia-concurrencia.spec.ts` (US-031).
 *
 * INTEGRACIÓN con TRANSACCIONES REALES contra el Postgres AISLADO de tests
 * (`slotify_test`, `.env.test`). Las operaciones rivales se lanzan con
 * `Promise.allSettled()` para FORZAR la carrera. Emails/reservas propios; se limpia el
 * sembrado; NO depende del deadlock 40P01 flaky de US-004 (ajeno: US-032 no toca
 * FECHA_BLOQUEADA).
 *
 * NOTA DE EJECUCIÓN: este fichero necesita Postgres arriba (BD real). Los subagentes QA
 * NO tienen Docker/Postgres — debe ejecutarse desde la SESIÓN PRINCIPAL. La rama del
 * "0 filas bajo el lock" (no-op → 409) está ADEMÁS cubierta con MOCK, sin BD, en
 * `forzar-inicio-evento.use-case.spec.ts` (`debe_traducir_0_filas_bajo_el_lock_a_conflicto_estado`).
 *
 * RED: aún NO existe `reservas/application/forzar-inicio-evento.use-case.ts`, el puerto de
 * UoW `UnidadDeTrabajoForzarInicioPort` ni su token `UNIDAD_DE_TRABAJO_FORZAR_INICIO_PORT`,
 * ni el barrido de US-031 (`IniciarEventosDelDiaService`). Los imports/símbolos fallan y la
 * batería está en ROJO por AUSENCIA DE IMPLEMENTACIÓN (el Postgres está arriba: no es fallo
 * de infra). GREEN es de `backend-developer`.
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
  ForzarInicioEventoUseCase,
  type ForzarInicioEventoComando,
} from '../application/forzar-inicio-evento.use-case';
import { IniciarEventosDelDiaService } from '../application/iniciar-eventos-del-dia.service';

const TENANT = '00000000-0000-0000-0000-000000000001';
const GESTOR = '00000000-0000-0000-0000-000000000002';
const EMAIL_PATTERN = '@us032-conc.test';

/** Fecha de calendario de "hoy" a mediodía UTC (candidata determinista del forzado). */
const hoy = (): Date => {
  const base = new Date();
  base.setUTCHours(12, 0, 0, 0);
  return base;
};

let moduleRef: TestingModule;
let prisma: PrismaService;
let forzar: ForzarInicioEventoUseCase;
let barrido: IniciarEventosDelDiaService;

const sufijo = (): string => Math.random().toString(36).slice(2, 8);

/**
 * Siembra una RESERVA en `reserva_confirmada`, `fecha_evento = hoy` y con UNA precondición
 * incumplida (`liquidacion_status = facturada`), el caso canónico del forzado (US-031 NO la
 * iniciaría automáticamente; el gestor la fuerza). El cron de US-031 sobre esta fila la
 * verá como candidata por estado+fecha pero NO transicionará (precondición incumplida): eso
 * hace la carrera RC-B DETERMINISTA (solo el forzado puede ganar; el cron es no-op). Para
 * RC-B "ambos pueden ganar" se usa una fila con las tres cumplidas (ver el 2.º test).
 */
const sembrar = async (
  cumplidas = false,
): Promise<string> => {
  const cliente = await prisma.cliente.create({
    data: { tenantId: TENANT, nombre: 'Conc', email: `c-${sufijo()}${EMAIL_PATTERN}` },
  });
  const reserva = await prisma.reserva.create({
    data: {
      tenantId: TENANT,
      clienteId: cliente.idCliente,
      codigo: `TST-U032C-${sufijo()}`,
      estado: EstadoReserva.reserva_confirmada,
      canalEntrada: CanalEntrada.web,
      fechaEvento: hoy(),
      preEventoStatus: PreEventoStatus.cerrado,
      liquidacionStatus: cumplidas
        ? LiquidacionStatus.cobrada
        : LiquidacionStatus.facturada,
      fianzaStatus: FianzaStatus.cobrada,
      condPartFirmadas: true,
    },
  });
  return reserva.idReserva;
};

const comando = (reservaId: string): ForzarInicioEventoComando => ({
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
  forzar = moduleRef.get(ForzarInicioEventoUseCase);
  barrido = moduleRef.get(IniciarEventosDelDiaService);
});

afterAll(async () => {
  await limpiar();
  await moduleRef.close();
});

beforeEach(async () => {
  await limpiar();
});

// ===========================================================================
// RC-A — DOBLE SESIÓN del gestor (doble click) sobre la MISMA RESERVA en
//        reserva_confirmada: EXACTAMENTE una gana (evento_en_curso), la otra recibe
//        conflicto (conflicto_estado). UNA sola entrada de transición en AUDIT_LOG.
// ===========================================================================

describe('Forzar inicio US-032 — RC-A: doble sesión del gestor, una sola transición', () => {
  it('debe_permitir_un_forzado_y_rechazar_el_segundo_cuando_son_concurrentes', async () => {
    const reservaId = await sembrar();

    const resultados = await Promise.allSettled([
      forzar.ejecutar(comando(reservaId)),
      forzar.ejecutar(comando(reservaId)),
    ]);

    // EXACTAMENTE una gana (fulfilled) y una pierde la carrera (rejected con conflicto).
    const cumplidas = resultados.filter((r) => r.status === 'fulfilled');
    const rechazadas = resultados.filter((r) => r.status === 'rejected');
    expect(cumplidas).toHaveLength(1);
    expect(rechazadas).toHaveLength(1);

    // La perdedora falla como conflicto de estado (code=conflicto_estado).
    const perdedora = rechazadas[0] as PromiseRejectedResult;
    expect(perdedora.reason).toMatchObject({ codigo: 'conflicto_estado' });

    // Estado final DETERMINISTA: evento_en_curso (la ganadora lo commiteó).
    expect((await leerReserva(reservaId))?.estado).toBe(EstadoReserva.evento_en_curso);

    // EXACTAMENTE una entrada de transición en AUDIT_LOG (la 2.ª UPDATE afectó 0 filas).
    expect(await contarTransiciones(reservaId)).toBe(1);
  });
});

// ===========================================================================
// RC-B — CRON (US-031) vs GESTOR (US-032) sobre la MISMA fila (las tres precondiciones
//        cumplidas, para que AMBOS puedan ganar): exactamente una transición aplica; el
//        otro re-evalúa bajo el lock, su UPDATE afecta 0 filas y termina no-op sin error.
//        Nunca estado intermedio ni doble auditoría.
// ===========================================================================

describe('Forzar inicio US-032 — RC-B: cron vs gestor concurrentes, una sola transición', () => {
  it('debe_aplicar_exactamente_una_transicion_sin_doble_auditoria_ni_estado_intermedio', async () => {
    const reservaId = await sembrar(true); // tres precondiciones cumplidas.

    const resultados = await Promise.allSettled([
      barrido.ejecutar(),
      forzar.ejecutar(comando(reservaId)),
    ]);

    // El barrido nunca falla (idempotente). El forzado re-evalúa bajo el lock: o gana la
    // transición o la encuentra ya hecha (0 filas → 409), sin estado intermedio.
    expect(resultados[0].status).toBe('fulfilled');

    // INVARIANTE: exactamente evento_en_curso; nunca un estado intermedio.
    expect((await leerReserva(reservaId))?.estado).toBe(EstadoReserva.evento_en_curso);

    // EXACTAMENTE una transición (uno gana, el otro se autoexcluye): sin doble auditoría.
    expect(await contarTransiciones(reservaId)).toBe(1);
  });
});
