/**
 * TESTS DE CONCURRENCIA REALES de la finalización manual del evento (US-034 / UC-25)
 * — fase TDD RED. tasks.md Fase 3: 3.9. ZONA CRÍTICA (skill `concurrency-locking`).
 *
 * Trazabilidad: US-034; spec-delta `consultas` (Requirement "Doble finalización concurrente
 * — exactamente una transición gana sin doble efecto"), design.md §D-8:
 *   - Única condición de carrera: dos finalizaciones concurrentes de la MISMA RESERVA
 *     (doble click / doble request). La guarda de origen se RE-EVALÚA dentro de la
 *     transacción bajo `SELECT … FOR UPDATE` de la fila RESERVA: exactamente una UPDATE
 *     gana (`estado = evento_en_curso → post_evento`), la segunda observa `estado ≠
 *     evento_en_curso` (0 filas afectadas) y termina como CONFLICTO (409) sin doble
 *     transición, sin doble AUDIT_LOG y con E5 disparado A LO SUMO una vez.
 *
 * CLAUDE.md §Regla crítica: SIN Redis ni locks distribuidos (hook `no-distributed-lock`);
 * la serialización la da PostgreSQL sobre la fila RESERVA (`SELECT … FOR UPDATE` +
 * re-evaluación de la guarda DENTRO de la transacción). US-034 NO toca FECHA_BLOQUEADA ni la
 * cola: el lock es sobre la propia RESERVA.
 *
 * INTEGRACIÓN con TRANSACCIONES REALES contra el Postgres AISLADO de tests (`slotify_test`,
 * `.env.test`). Las dos finalizaciones rivales se lanzan con `Promise.allSettled()` para
 * FORZAR la carrera (patrón del skill y de `confirmar-pago-senal-concurrencia.spec.ts` de
 * US-021 / `iniciar-eventos-del-dia-concurrencia.spec.ts` de US-031). Emails/reservas
 * propios; se limpia el sembrado; NO depende del deadlock 40P01 flaky de US-004 (ajeno).
 *
 * RED: aún NO existe `reservas/application/finalizar-evento.use-case.ts` ni su cableado en
 * `ReservasModule`; los imports/símbolos fallan y la batería está en ROJO por AUSENCIA DE
 * IMPLEMENTACIÓN (el Postgres está arriba: no es fallo de infra). GREEN es de
 * `backend-developer`.
 */
import { Test, type TestingModule } from '@nestjs/testing';
import { ConfigModule } from '@nestjs/config';
import { CanalEntrada, EstadoReserva, FianzaStatus } from '@prisma/client';
import { ReservasModule } from '../reservas.module';
import { PrismaService } from '../../shared/prisma/prisma.service';
import {
  FinalizarEventoUseCase,
  type FinalizarEventoComando,
} from '../application/finalizar-evento.use-case';

const TENANT = '00000000-0000-0000-0000-000000000001';
const GESTOR = '00000000-0000-0000-0000-000000000002';
const EMAIL_PATTERN = '@us034-conc.test';

let moduleRef: TestingModule;
let prisma: PrismaService;
let useCase: FinalizarEventoUseCase;

const sufijo = (): string => Math.random().toString(36).slice(2, 8);

const sembrarEnCurso = async (): Promise<string> => {
  const cliente = await prisma.cliente.create({
    data: { tenantId: TENANT, nombre: 'Conc', email: `c-${sufijo()}${EMAIL_PATTERN}` },
  });
  const reserva = await prisma.reserva.create({
    data: {
      tenantId: TENANT,
      clienteId: cliente.idCliente,
      codigo: `TST-U034C-${sufijo()}`,
      estado: EstadoReserva.evento_en_curso,
      canalEntrada: CanalEntrada.web,
      fechaEvento: new Date('2028-06-20T00:00:00.000Z'),
      fianzaEur: '1000.00',
      fianzaStatus: FianzaStatus.cobrada,
    },
  });
  return reserva.idReserva;
};

const comando = (reservaId: string): FinalizarEventoComando => ({
  tenantId: TENANT,
  usuarioId: GESTOR,
  reservaId,
});

const leerReserva = (reservaId: string) =>
  prisma.reserva.findUnique({ where: { idReserva: reservaId } });
const contarTransiciones = (reservaId: string): Promise<number> =>
  prisma.auditLog.count({ where: { entidadId: reservaId, accion: 'transicion' } });
const contarE5 = (reservaId: string): Promise<number> =>
  prisma.comunicacion.count({ where: { reservaId, codigoEmail: 'E5' } });

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
    await prisma.comunicacion.deleteMany({ where: { reservaId: { in: ids } } });
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
  useCase = moduleRef.get(FinalizarEventoUseCase);
});

afterAll(async () => {
  await limpiar();
  await moduleRef.close();
});

beforeEach(async () => {
  await limpiar();
});

// ===========================================================================
// 3.9 — Doble finalización CONCURRENTE de la MISMA RESERVA: EXACTAMENTE una gana
//        (post_evento), la otra recibe conflicto (transicion_no_permitida). UNA sola
//        transición en AUDIT_LOG y E5 disparado A LO SUMO una vez.
// ===========================================================================

describe('Finalizar evento US-034 — doble finalización simultánea, una sola transición (3.9)', () => {
  it('debe_permitir_una_finalizacion_y_rechazar_la_segunda_cuando_son_concurrentes', async () => {
    const reservaId = await sembrarEnCurso();

    const resultados = await Promise.allSettled([
      useCase.ejecutar(comando(reservaId)),
      useCase.ejecutar(comando(reservaId)),
    ]);

    // EXACTAMENTE una gana (fulfilled) y una pierde la carrera (rejected con conflicto).
    const cumplidas = resultados.filter((r) => r.status === 'fulfilled');
    const rechazadas = resultados.filter((r) => r.status === 'rejected');
    expect(cumplidas).toHaveLength(1);
    expect(rechazadas).toHaveLength(1);

    // La perdedora falla como conflicto de estado (code=transicion_no_permitida).
    const perdedora = rechazadas[0] as PromiseRejectedResult;
    expect(perdedora.reason).toMatchObject({ codigo: 'transicion_no_permitida' });

    // Estado final DETERMINISTA: post_evento (la ganadora lo commiteó).
    expect((await leerReserva(reservaId))?.estado).toBe(EstadoReserva.post_evento);
  });

  it('no_debe_duplicar_la_transicion_en_audit_log_ni_disparar_e5_dos_veces', async () => {
    const reservaId = await sembrarEnCurso();

    await Promise.allSettled([
      useCase.ejecutar(comando(reservaId)),
      useCase.ejecutar(comando(reservaId)),
    ]);

    // EXACTAMENTE una entrada de transición (la 2.ª UPDATE afectó 0 filas: no audita).
    expect(await contarTransiciones(reservaId)).toBe(1);
    // E5 a lo sumo una vez (se dispara solo tras un commit exitoso de la transición).
    expect(await contarE5(reservaId)).toBeLessThanOrEqual(1);
  });
});
