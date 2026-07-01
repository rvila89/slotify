/**
 * TESTS DE CONCURRENCIA REALES del barrido de expiración por TTL (US-012 / UC-09) —
 * fase TDD RED. tasks.md Fase 3: 3.10. ZONA CRÍTICA (skill `concurrency-locking`).
 *
 * Trazabilidad: US-012, spec-delta `consultas` (Requirements RC-1 "doble ejecución
 * del cron sobre la misma RESERVA", RC-2 "expiración vs extensión manual concurrente"
 * (US-006), RC-3 "expiración vs nuevo bloqueo de la misma fecha" (US-040)); design.md
 * §D-5. CLAUDE.md §Regla crítica / §Testing: la exclusión mutua vive SOLO en
 * PostgreSQL (`SELECT … FOR UPDATE` + re-evaluación de la guarda dentro de la TX +
 * `UNIQUE(tenant_id, fecha)`); NUNCA Redis ni locks distribuidos.
 *
 * INTEGRACIÓN con TRANSACCIONES REALES contra el Postgres AISLADO de tests
 * (`slotify_test`, `.env.test`). Las operaciones rivales se lanzan con
 * `Promise.allSettled()` para FORZAR la carrera (patrón del skill y de
 * `liberar-fecha-integracion.spec.ts` / `extender-bloqueo-concurrencia.spec.ts`).
 *
 * DEUDA CONOCIDA: el test de concurrencia de US-004 tiene un deadlock 40P01 flaky
 * (memoria "US-004 concurrency test flaky"). Estas suites se diseñan para NO depender
 * de ese estado: usan fechas de evento propias/aisladas y limpian su propio sembrado,
 * de modo que no agravan la flakiness global.
 *
 * RED: aún NO existe `application/expirar-consultas-vencidas.service.ts` ni su
 * adaptador de UoW; los imports/símbolos fallan y la batería está en ROJO por
 * AUSENCIA DE IMPLEMENTACIÓN (el Postgres está arriba, no es fallo de infra). GREEN
 * es de `backend-developer`.
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
import { ExpirarConsultasVencidasService } from '../application/expirar-consultas-vencidas.service';
import {
  ExtenderBloqueoUseCase,
  type ExtenderBloqueoComando,
} from '../application/extender-bloqueo.use-case';

const TENANT = '00000000-0000-0000-0000-000000000001';
const GESTOR = '00000000-0000-0000-0000-000000000002';
const EMAIL_PATTERN = '@us012-conc.test';
const DIA_MS = 24 * 60 * 60 * 1000;

// Fechas de EVENTO aisladas por escenario (evitan cruces con otras suites y con la
// flakiness de US-004 sobre sus propias fechas).
const F_RC1 = new Date('2029-05-01T00:00:00.000Z');
const F_RC2 = new Date('2029-05-02T00:00:00.000Z');
const F_RC3 = new Date('2029-05-03T00:00:00.000Z');
const TODAS = [F_RC1, F_RC2, F_RC3];

const ttlVencido = (): Date => new Date(Date.now() - DIA_MS);
// TTL "en el límite": ya vencido por poco, para que barrido y extensión compitan.
const ttlEnElLimite = (): Date => new Date(Date.now() - 1000);

let moduleRef: TestingModule;
let prisma: PrismaService;
let barrido: ExpirarConsultasVencidasService;
let extender: ExtenderBloqueoUseCase;

const sufijo = (): string => Math.random().toString(36).slice(2, 8);

const sembrar = async (params: {
  fecha: Date;
  subEstado?: SubEstadoConsulta;
  ttl?: Date;
}): Promise<{ reservaId: string }> => {
  const ttl = params.ttl ?? ttlVencido();
  const cliente = await prisma.cliente.create({
    data: { tenantId: TENANT, nombre: 'Conc', email: `c-${sufijo()}${EMAIL_PATTERN}` },
  });
  const reserva = await prisma.reserva.create({
    data: {
      tenantId: TENANT,
      clienteId: cliente.idCliente,
      codigo: `TST-U012C-${sufijo()}`,
      estado: EstadoReserva.consulta,
      subEstado: params.subEstado ?? SubEstadoConsulta.s2b,
      canalEntrada: CanalEntrada.web,
      fechaEvento: params.fecha,
      ttlExpiracion: ttl,
    },
  });
  await prisma.fechaBloqueada.create({
    data: {
      tenantId: TENANT,
      fecha: params.fecha,
      reservaId: reserva.idReserva,
      tipoBloqueo: TipoBloqueo.blando,
      ttlExpiracion: ttl,
    },
  });
  return { reservaId: reserva.idReserva };
};

const contarBloqueos = (fecha: Date): Promise<number> =>
  prisma.fechaBloqueada.count({ where: { tenantId: TENANT, fecha } });

const comandoExtender = (reservaId: string, dias: number): ExtenderBloqueoComando => ({
  tenantId: TENANT,
  usuarioId: GESTOR,
  reservaId,
  dias,
});

const limpiar = async (): Promise<void> => {
  const clientes = await prisma.cliente.findMany({
    where: { email: { contains: EMAIL_PATTERN } },
    select: { idCliente: true },
  });
  const clienteIds = clientes.map((c) => c.idCliente);
  const reservas = await prisma.reserva.findMany({
    where: { OR: [{ clienteId: { in: clienteIds } }, { fechaEvento: { in: TODAS } }] },
    select: { idReserva: true, clienteId: true },
  });
  const ids = reservas.map((r) => r.idReserva);
  const allClientes = [...new Set([...clienteIds, ...reservas.map((r) => r.clienteId)])];
  if (ids.length > 0) {
    await prisma.fechaBloqueada.deleteMany({ where: { reservaId: { in: ids } } });
    await prisma.comunicacion.deleteMany({ where: { reservaId: { in: ids } } });
    await prisma.auditLog.deleteMany({ where: { entidadId: { in: ids } } });
    await prisma.reserva.deleteMany({ where: { idReserva: { in: ids } } });
  }
  await prisma.fechaBloqueada.deleteMany({ where: { tenantId: TENANT, fecha: { in: TODAS } } });
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
  barrido = moduleRef.get(ExpirarConsultasVencidasService);
  extender = moduleRef.get(ExtenderBloqueoUseCase);
});

afterAll(async () => {
  await limpiar();
  await moduleRef.close();
});

beforeEach(async () => {
  await limpiar();
});

// ===========================================================================
// RC-1 — Doble ejecución CONCURRENTE del barrido sobre la MISMA RESERVA:
//   EXACTAMENTE una aplica la transición; la otra re-evalúa la guarda bajo lock,
//   ya no la ve candidata y NO actúa. Sin doble transición ni doble promoción.
//   (skill concurrency-locking: Promise.allSettled.)
// ===========================================================================

describe('Barrido US-012 — RC-1: doble cron simultáneo, una sola transición', () => {
  it('debe_expirar_la_reserva_exactamente_una_vez_ante_dos_barridos_concurrentes', async () => {
    const { reservaId } = await sembrar({ fecha: F_RC1, subEstado: SubEstadoConsulta.s2b });

    // Dos barridos en paralelo (p. ej. reinicio del proceso): fuerzan la carrera.
    const resultados = await Promise.allSettled([barrido.ejecutar(), barrido.ejecutar()]);

    // Ninguno FALLA (idempotencia: el que llega tarde es no-op silencioso).
    const cumplidos = resultados.filter((r) => r.status === 'fulfilled') as
      PromiseFulfilledResult<{ expiradas: number }>[];
    expect(cumplidos).toHaveLength(2);

    // Estado final DETERMINISTA: una sola transición a 2x, fecha liberada una vez.
    const reserva = await prisma.reserva.findUnique({ where: { idReserva: reservaId } });
    expect(reserva?.subEstado).toBe(SubEstadoConsulta.s2x);
    expect(await contarBloqueos(F_RC1)).toBe(0);

    // La suma de expiradas de AMBAS pasadas es exactamente 1 (nunca 2): la reserva
    // se expira una sola vez aunque dos barridos la vean como candidata.
    const totalExpiradas = cumplidos.reduce((acc, r) => acc + r.value.expiradas, 0);
    expect(totalExpiradas).toBe(1);
  });
});

// ===========================================================================
// RC-2 — Expiración del barrido vs EXTENSIÓN manual del TTL (US-006), concurrentes
//   sobre la misma fila bloqueante: EXACTAMENTE una gana, sin estado intermedio.
//   - gana la extensión → RESERVA sigue en 2.b con TTL futuro y bloqueo vigente
//     (el barrido no la selecciona / re-evalúa y se autoexcluye);
//   - gana la expiración → RESERVA en 2.x, fecha liberada (la extensión se rechaza).
// ===========================================================================

describe('Barrido US-012 — RC-2: expiración vs extensión manual concurrente (US-006)', () => {
  it('debe_prevalecer_exactamente_una_sin_estado_intermedio_incoherente', async () => {
    const { reservaId } = await sembrar({
      fecha: F_RC2,
      subEstado: SubEstadoConsulta.s2b,
      ttl: ttlEnElLimite(),
    });

    const resultados = await Promise.allSettled([
      barrido.ejecutar(),
      extender.ejecutar(comandoExtender(reservaId, 7)),
    ]);

    const reserva = await prisma.reserva.findUnique({ where: { idReserva: reservaId } });
    const bloqueos = await prisma.fechaBloqueada.findMany({
      where: { tenantId: TENANT, fecha: F_RC2 },
    });

    const extension = resultados[1];
    if (extension.status === 'fulfilled') {
      // Ganó la extensión: sigue en 2.b con su bloqueo vigente y TTL futuro.
      expect(reserva?.subEstado).toBe(SubEstadoConsulta.s2b);
      expect(bloqueos).toHaveLength(1);
      expect(bloqueos[0].ttlExpiracion?.getTime()).toBeGreaterThan(Date.now());
    } else {
      // Ganó el barrido: RESERVA terminal (2.x) + fecha liberada; extensión rechazada.
      expect(reserva?.subEstado).toBe(SubEstadoConsulta.s2x);
      expect(bloqueos).toHaveLength(0);
    }
    // NUNCA un estado intermedio: o 2.b con bloqueo, o 2.x sin bloqueo.
    const coherente =
      (reserva?.subEstado === SubEstadoConsulta.s2b && bloqueos.length === 1) ||
      (reserva?.subEstado === SubEstadoConsulta.s2x && bloqueos.length === 0);
    expect(coherente).toBe(true);
  });
});

// ===========================================================================
// RC-3 — Liberación por expiración vs NUEVO bloqueo de la MISMA (tenant, fecha):
//   nunca coexisten dos bloqueos activos (lo previene UNIQUE(tenant_id, fecha),
//   US-040). O el barrido libera primero y el nuevo bloqueo entra, o el nuevo
//   bloqueo espera al commit del barrido; en ningún interleaving hay 2 filas.
// ===========================================================================

describe('Barrido US-012 — RC-3: expiración vs nuevo bloqueo de la misma fecha (US-040)', () => {
  it('nunca_deja_la_fecha_doble_bloqueada_ante_liberacion_y_nuevo_bloqueo_concurrentes', async () => {
    const { reservaId } = await sembrar({ fecha: F_RC3, subEstado: SubEstadoConsulta.s2b });

    // Nuevo lead que intenta bloquear la MISMA fecha en paralelo al barrido: INSERT
    // directo (simula el nuevo `bloquearFecha`). El UNIQUE(tenant, fecha) arbitra.
    const clienteNuevo = await prisma.cliente.create({
      data: { tenantId: TENANT, nombre: 'Nuevo', email: `n-${sufijo()}${EMAIL_PATTERN}` },
    });
    const reservaNueva = await prisma.reserva.create({
      data: {
        tenantId: TENANT,
        clienteId: clienteNuevo.idCliente,
        codigo: `TST-U012N-${sufijo()}`,
        estado: EstadoReserva.consulta,
        subEstado: SubEstadoConsulta.s2b,
        canalEntrada: CanalEntrada.web,
        fechaEvento: F_RC3,
        ttlExpiracion: new Date(Date.now() + DIA_MS),
      },
    });
    const nuevoBloqueo = prisma.fechaBloqueada
      .create({
        data: {
          tenantId: TENANT,
          fecha: F_RC3,
          reservaId: reservaNueva.idReserva,
          tipoBloqueo: TipoBloqueo.blando,
          ttlExpiracion: new Date(Date.now() + DIA_MS),
        },
      })
      .then(
        () => 'insertado' as const,
        () => 'rechazado' as const,
      );

    const [expiracion] = await Promise.allSettled([barrido.ejecutar(), nuevoBloqueo]);

    // El barrido se resuelve sin error (idempotente).
    expect(expiracion.status).toBe('fulfilled');

    // INVARIANTE DURO (cualquier interleaving): jamás coexisten 2 bloqueos para (T, D).
    const filas = await contarBloqueos(F_RC3);
    expect(filas).toBeLessThanOrEqual(1);

    // La reserva original queda expirada a 2.x (su bloqueo se liberó).
    const reservaOriginal = await prisma.reserva.findUnique({ where: { idReserva: reservaId } });
    expect(reservaOriginal?.subEstado).toBe(SubEstadoConsulta.s2x);
  });
});
