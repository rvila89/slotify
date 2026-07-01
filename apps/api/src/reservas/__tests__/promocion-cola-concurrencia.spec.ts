/**
 * TESTS DE CONCURRENCIA REALES de la PROMOCIÓN de cola (US-018 / UC-12, A15) —
 * fase TDD RED. tasks.md Fase 3: 3.3 (RC-1, RC-2, RC-3). ZONA CRÍTICA
 * (skill `concurrency-locking`).
 *
 * Trazabilidad: US-018, spec-delta `consultas` (Requirements RC-1 "dos instancias
 * del job promueven exactamente una vez", RC-2 "barrido TTL (US-012) vs promoción
 * sobre la misma fecha", RC-3 "coordinación con la promoción manual del Gestor
 * (US-019)"); design.md §D-3 (guarda "ya promovida" bajo `SELECT … FOR UPDATE`),
 * §D-4 (atomicidad solo PostgreSQL), §D-6 (FIFO + gana el primer lock). CLAUDE.md
 * §Regla crítica / §Testing: la exclusión mutua vive SOLO en PostgreSQL
 * (`SELECT … FOR UPDATE` + re-evaluación de la guarda dentro de la TX +
 * `UNIQUE(tenant_id, fecha)`); NUNCA Redis ni locks distribuidos.
 *
 * INTEGRACIÓN con TRANSACCIONES REALES contra el Postgres AISLADO de tests
 * (`slotify_test`, `.env.test`). Las operaciones rivales se lanzan con
 * `Promise.allSettled()` para FORZAR la carrera (patrón del skill y de
 * `expirar-consultas-concurrencia.spec.ts` / `liberar-fecha-integracion.spec.ts`).
 *
 * DEUDA CONOCIDA: US-004 tiene un deadlock 40P01 flaky (memoria "US-004 concurrency
 * test flaky"). Esta suite NO depende de él: usa fechas de evento propias/aisladas y
 * limpia su propio sembrado.
 *
 * RED: aún NO existen `PromoverPrimeroEnColaService` ni el adaptador Prisma real; el
 * binding del módulo sigue en el stub no-op (que NO promueve), por lo que estas
 * aserciones (una promoción efectiva, exactamente una, sin doble bloqueo) FALLAN por
 * AUSENCIA DE IMPLEMENTACIÓN. GREEN es de `backend-developer`.
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
import { PromoverPrimeroEnColaService } from '../application/promover-primero-en-cola.service';
import { ExpirarConsultasVencidasService } from '../application/expirar-consultas-vencidas.service';

const TENANT = '00000000-0000-0000-0000-000000000001';
const EMAIL_PATTERN = '@us018-conc.test';
const DIA_MS = 24 * 60 * 60 * 1000;

// Fechas de EVENTO aisladas por escenario.
const F_RC1 = new Date('2029-07-01T00:00:00.000Z');
const F_RC2 = new Date('2029-07-02T00:00:00.000Z');
const F_RC3 = new Date('2029-07-03T00:00:00.000Z');
const TODAS = [F_RC1, F_RC2, F_RC3];

let moduleRef: TestingModule;
let prisma: PrismaService;
let promocion: PromoverPrimeroEnColaService;
let barrido: ExpirarConsultasVencidasService;

const sufijo = (): string => Math.random().toString(36).slice(2, 8);
const ttlVencido = (): Date => new Date(Date.now() - DIA_MS);

/** Cola YA sin bloqueo (bloqueante liberada en 2x) + N en s2d posiciones 1..N. */
const sembrarColaSinBloqueo = async (params: {
  fecha: Date;
  n: number;
}): Promise<{ bloqueanteId: string; colaIds: string[] }> => {
  const clienteBloq = await prisma.cliente.create({
    data: { tenantId: TENANT, nombre: 'Bloq', email: `b-${sufijo()}${EMAIL_PATTERN}` },
  });
  const bloqueante = await prisma.reserva.create({
    data: {
      tenantId: TENANT,
      clienteId: clienteBloq.idCliente,
      codigo: `TST-U018C-B-${sufijo()}`,
      estado: EstadoReserva.consulta,
      subEstado: SubEstadoConsulta.s2x,
      canalEntrada: CanalEntrada.web,
      fechaEvento: params.fecha,
    },
  });
  const colaIds: string[] = [];
  for (let i = 1; i <= params.n; i += 1) {
    const cliente = await prisma.cliente.create({
      data: { tenantId: TENANT, nombre: 'Cola', email: `q-${sufijo()}${EMAIL_PATTERN}` },
    });
    const r = await prisma.reserva.create({
      data: {
        tenantId: TENANT,
        clienteId: cliente.idCliente,
        codigo: `TST-U018C-Q-${sufijo()}`,
        estado: EstadoReserva.consulta,
        subEstado: SubEstadoConsulta.s2d,
        canalEntrada: CanalEntrada.web,
        fechaEvento: params.fecha,
        consultaBloqueanteId: bloqueante.idReserva,
        posicionCola: i,
      },
    });
    colaIds.push(r.idReserva);
  }
  return { bloqueanteId: bloqueante.idReserva, colaIds };
};

/** Bloqueante VIVA en 2b con TTL vencido + FECHA_BLOQUEADA + cola (para RC-2). */
const sembrarBloqueanteVencidaConCola = async (params: {
  fecha: Date;
  n: number;
}): Promise<{ bloqueanteId: string; colaIds: string[] }> => {
  const ttl = ttlVencido();
  const clienteBloq = await prisma.cliente.create({
    data: { tenantId: TENANT, nombre: 'Bloq', email: `b-${sufijo()}${EMAIL_PATTERN}` },
  });
  const bloqueante = await prisma.reserva.create({
    data: {
      tenantId: TENANT,
      clienteId: clienteBloq.idCliente,
      codigo: `TST-U018C-BV-${sufijo()}`,
      estado: EstadoReserva.consulta,
      subEstado: SubEstadoConsulta.s2b,
      canalEntrada: CanalEntrada.web,
      fechaEvento: params.fecha,
      ttlExpiracion: ttl,
    },
  });
  await prisma.fechaBloqueada.create({
    data: {
      tenantId: TENANT,
      fecha: params.fecha,
      reservaId: bloqueante.idReserva,
      tipoBloqueo: TipoBloqueo.blando,
      ttlExpiracion: ttl,
    },
  });
  const colaIds: string[] = [];
  for (let i = 1; i <= params.n; i += 1) {
    const cliente = await prisma.cliente.create({
      data: { tenantId: TENANT, nombre: 'Cola', email: `q-${sufijo()}${EMAIL_PATTERN}` },
    });
    const r = await prisma.reserva.create({
      data: {
        tenantId: TENANT,
        clienteId: cliente.idCliente,
        codigo: `TST-U018C-QV-${sufijo()}`,
        estado: EstadoReserva.consulta,
        subEstado: SubEstadoConsulta.s2d,
        canalEntrada: CanalEntrada.web,
        fechaEvento: params.fecha,
        consultaBloqueanteId: bloqueante.idReserva,
        posicionCola: i,
      },
    });
    colaIds.push(r.idReserva);
  }
  return { bloqueanteId: bloqueante.idReserva, colaIds };
};

const contarBloqueos = (fecha: Date): Promise<number> =>
  prisma.fechaBloqueada.count({ where: { tenantId: TENANT, fecha } });

const contarPromovidas = (fecha: Date): Promise<number> =>
  prisma.reserva.count({
    where: { tenantId: TENANT, fechaEvento: fecha, subEstado: SubEstadoConsulta.s2b },
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
    await prisma.reserva.updateMany({
      where: { idReserva: { in: ids } },
      data: { consultaBloqueanteId: null, posicionCola: null },
    });
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
  promocion = moduleRef.get(PromoverPrimeroEnColaService);
  barrido = moduleRef.get(ExpirarConsultasVencidasService);
});

afterAll(async () => {
  await limpiar();
  await moduleRef.close();
});

beforeEach(async () => {
  await limpiar();
});

// ===========================================================================
// RC-1 — Doble instancia del job de promoción CONCURRENTE sobre la misma fecha:
//   EXACTAMENTE una promueve (guarda "ya promovida" + lock); la otra aborta sin
//   cambios. Sin doble re-bloqueo (UNIQUE(tenant, fecha)) ni doble decremento.
// ===========================================================================

describe('Promoción US-018 — RC-1: doble job concurrente, una sola promoción', () => {
  it('debe_promover_exactamente_una_vez_ante_dos_promociones_concurrentes', async () => {
    const { colaIds } = await sembrarColaSinBloqueo({ fecha: F_RC1, n: 3 });
    const [r2, r3] = colaIds;

    const resultados = await Promise.allSettled([
      promocion.promoverPrimeroEnCola({ tenantId: TENANT, fecha: F_RC1 }),
      promocion.promoverPrimeroEnCola({ tenantId: TENANT, fecha: F_RC1 }),
    ]);

    // Ninguna FALLA (la que llega tarde es no-op silencioso por la guarda).
    const cumplidos = resultados.filter((r) => r.status === 'fulfilled');
    expect(cumplidos).toHaveLength(2);

    // Estado final DETERMINISTA: exactamente una promovida a 2b, un solo bloqueo.
    expect(await contarPromovidas(F_RC1)).toBe(1);
    expect(await contarBloqueos(F_RC1)).toBe(1);

    const pr2 = await prisma.reserva.findUnique({ where: { idReserva: r2 } });
    expect(pr2?.subEstado).toBe(SubEstadoConsulta.s2b);

    // Sin doble decremento: R3 avanza a posición 1 exactamente UNA vez.
    const pr3 = await prisma.reserva.findUnique({ where: { idReserva: r3 } });
    expect(pr3?.posicionCola).toBe(1);
    expect(pr3?.consultaBloqueanteId).toBe(r2);
  });
});

// ===========================================================================
// RC-2 — Barrido TTL (US-012) que libera + dispara el seam VS promoción concurrente
//   sobre la misma fecha: coherencia, sin estado intermedio, sin doble reserva. La
//   liberación (DELETE) commitea antes del disparo del seam; el UNIQUE(tenant,fecha)
//   + la guarda garantizan que nunca coexisten dos bloqueos ni se promueve dos veces.
// ===========================================================================

describe('Promoción US-018 — RC-2: barrido TTL (US-012) vs promoción concurrente', () => {
  it('nunca_deja_doble_bloqueo_ni_doble_promocion_al_encadenar_liberacion_y_promocion', async () => {
    const { colaIds } = await sembrarBloqueanteVencidaConCola({ fecha: F_RC2, n: 2 });
    const [r2] = colaIds;

    // El barrido expira la bloqueante, libera la fecha y dispara el seam de promoción
    // (contrato heredado). En paralelo, una promoción directa sobre la misma fecha.
    const resultados = await Promise.allSettled([
      barrido.ejecutar(),
      promocion.promoverPrimeroEnCola({ tenantId: TENANT, fecha: F_RC2 }),
    ]);

    // El barrido se resuelve sin error (idempotente).
    expect(resultados[0].status).toBe('fulfilled');

    // INVARIANTE DURO: jamás coexisten dos bloqueos para (T, D), y a lo sumo una
    // promovida a 2b (sin doble reserva / doble promoción).
    expect(await contarBloqueos(F_RC2)).toBeLessThanOrEqual(1);
    expect(await contarPromovidas(F_RC2)).toBeLessThanOrEqual(1);

    // Coherencia: si hay un bloqueo, apunta a una reserva viva en 2b (la promovida),
    // no a la bloqueante ya expirada.
    const bloqueos = await prisma.fechaBloqueada.findMany({
      where: { tenantId: TENANT, fecha: F_RC2 },
    });
    if (bloqueos.length === 1) {
      const apuntada = await prisma.reserva.findUnique({
        where: { idReserva: bloqueos[0].reservaId },
      });
      expect(apuntada?.subEstado).toBe(SubEstadoConsulta.s2b);
      expect(apuntada?.idReserva).toBe(r2);
    }
  });
});

// ===========================================================================
// RC-3 — Coordinación con promoción manual (US-019, simulada disparando el MISMO
//   seam/caso de uso concurrentemente): FIFO + gana el primer lock; la guarda "ya
//   promovida" evita la doble promoción. Exactamente una promueve; la otra aborta
//   limpio (sin inconsistencia).
// ===========================================================================

describe('Promoción US-018 — RC-3: automática vs manual US-019 (simulada), guarda coordina', () => {
  it('exactamente_una_promueve_la_otra_aborta_limpio_por_la_guarda_ya_promovida', async () => {
    const { colaIds } = await sembrarColaSinBloqueo({ fecha: F_RC3, n: 2 });
    const [r2, r3] = colaIds;

    // Ruta automática y ruta "manual" (misma operación) compiten sobre la fecha.
    const resultados = await Promise.allSettled([
      promocion.promoverPrimeroEnCola({ tenantId: TENANT, fecha: F_RC3 }),
      promocion.promoverPrimeroEnCola({ tenantId: TENANT, fecha: F_RC3 }),
    ]);

    // Ambas rutas se resuelven sin error (la perdedora es no-op por la guarda).
    expect(resultados.filter((r) => r.status === 'fulfilled')).toHaveLength(2);

    // FIFO + primer lock: R2 (posición 1) es la promovida, exactamente una vez.
    expect(await contarPromovidas(F_RC3)).toBe(1);
    expect(await contarBloqueos(F_RC3)).toBe(1);
    const pr2 = await prisma.reserva.findUnique({ where: { idReserva: r2 } });
    expect(pr2?.subEstado).toBe(SubEstadoConsulta.s2b);

    // Sin inconsistencia: R3 reordenado a posición 1 una sola vez, apuntando a R2.
    const pr3 = await prisma.reserva.findUnique({ where: { idReserva: r3 } });
    expect(pr3?.posicionCola).toBe(1);
    expect(pr3?.consultaBloqueanteId).toBe(r2);
  });
});
