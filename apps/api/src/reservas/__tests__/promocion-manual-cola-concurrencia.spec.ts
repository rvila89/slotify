/**
 * TESTS DE CONCURRENCIA REALES de la PROMOCIÓN MANUAL de cola (US-019 / UC-12 FA
 * manual) — fase TDD RED. tasks.md Fase 3: 3.3 (RC-A manual vs automática, RC-B dos
 * Gestores). ZONA CRÍTICA (skill `concurrency-locking`).
 *
 * Trazabilidad: US-019, spec-delta `consultas` (Requirements RC-A "coordinación
 * anti-doble-promoción manual vs automática US-018: ambas contienden por el
 * `SELECT … FOR UPDATE` sobre FECHA_BLOQUEADA, gana el primer lock, la otra aborta;
 * la manual que pierde recibe 409" y RC-B "dos Gestores promueven consultas distintas
 * de la misma cola → exactamente una promueve, la otra aborta"); design.md §D-4 (guarda
 * "ya promovida" bajo `FOR UPDATE` sobre FECHA_BLOQUEADA; FIFO estricto + gana el primer
 * lock, SIN cesión al Gestor), §D-4.1 (race entre dos Gestores), §D-5 (atomicidad solo
 * PostgreSQL). CLAUDE.md §Regla crítica / §Testing: la exclusión mutua vive SOLO en
 * PostgreSQL (`SELECT … FOR UPDATE` + re-evaluación de la guarda dentro de la TX +
 * `UNIQUE(tenant_id, fecha)`); NUNCA Redis ni locks distribuidos.
 *
 * INTEGRACIÓN con TRANSACCIONES REALES contra el Postgres AISLADO de tests
 * (`slotify_test`, `.env.test`; memoria "Tests con BD aislada slotify_test"). Las
 * operaciones rivales se lanzan con `Promise.allSettled()` para FORZAR la carrera
 * (patrón del skill y de `promocion-cola-concurrencia.spec.ts` de US-018). A diferencia
 * de US-018, aquí la bloqueante está VIVA (2b) y su FECHA_BLOQUEADA EXISTE: es el
 * recurso natural del `FOR UPDATE` (design §D-4).
 *
 * DEUDA CONOCIDA: US-004 tiene un deadlock 40P01 flaky (memoria "US-004 concurrency
 * test flaky"). Esta suite NO depende de él: usa fechas de evento propias/aisladas y
 * limpia su propio sembrado.
 *
 * RED: aún NO existen `PromoverManualEnColaService` ni su adaptador Prisma real, ni el
 * binding en el `ReservasModule`. Los imports/símbolos fallan y toda la batería está en
 * ROJO por AUSENCIA DE IMPLEMENTACIÓN. GREEN es de `backend-developer`.
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
import { PromoverManualEnColaService } from '../application/promover-manual-en-cola.service';
import { ExpirarConsultasVencidasService } from '../application/expirar-consultas-vencidas.service';

const TENANT = '00000000-0000-0000-0000-000000000001';
const GESTOR_A = '00000000-0000-0000-0000-0000000000a1';
const GESTOR_B = '00000000-0000-0000-0000-0000000000a2';
const EMAIL_PATTERN = '@us019-conc.test';
const DIA_MS = 24 * 60 * 60 * 1000;

// Fechas de EVENTO aisladas por escenario (estrictamente futuras, no colisionan).
const F_RCA = new Date('2029-08-01T00:00:00.000Z');
const F_RCB = new Date('2029-08-02T00:00:00.000Z');
const TODAS = [F_RCA, F_RCB];

let moduleRef: TestingModule;
let prisma: PrismaService;
let manual: PromoverManualEnColaService;
let barrido: ExpirarConsultasVencidasService;

const sufijo = (): string => Math.random().toString(36).slice(2, 8);
const ttlVigente = (): Date => new Date(Date.now() + 3 * DIA_MS);
const ttlVencido = (): Date => new Date(Date.now() - DIA_MS);

/**
 * Siembra una fecha con BLOQUEANTE VIVA en 2b (FECHA_BLOQUEADA existente) + N en la cola
 * (s2d, posiciones 1..N) apuntando a ella. `ttl` controla si la bloqueante está vigente
 * (RC-B) o vencida no barrida (RC-A, para que el barrido automático la libere).
 */
const sembrarBloqueanteVivaConCola = async (params: {
  fecha: Date;
  n: number;
  ttl: Date;
}): Promise<{ bloqueanteId: string; colaIds: string[] }> => {
  const clienteBloq = await prisma.cliente.create({
    data: { tenantId: TENANT, nombre: 'Bloq', email: `b-${sufijo()}${EMAIL_PATTERN}` },
  });
  const bloqueante = await prisma.reserva.create({
    data: {
      tenantId: TENANT,
      clienteId: clienteBloq.idCliente,
      codigo: `TST-U019C-B-${sufijo()}`,
      estado: EstadoReserva.consulta,
      subEstado: SubEstadoConsulta.s2b,
      canalEntrada: CanalEntrada.web,
      fechaEvento: params.fecha,
      ttlExpiracion: params.ttl,
    },
  });
  await prisma.fechaBloqueada.create({
    data: {
      tenantId: TENANT,
      fecha: params.fecha,
      reservaId: bloqueante.idReserva,
      tipoBloqueo: TipoBloqueo.blando,
      ttlExpiracion: params.ttl,
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
        codigo: `TST-U019C-Q-${sufijo()}`,
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
  manual = moduleRef.get(PromoverManualEnColaService);
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
// RC-A — Promoción MANUAL del Gestor VS barrido AUTOMÁTICO de US-018 sobre la MISMA
//   fecha. La bloqueante tiene TTL vencido (no barrida aún): el barrido la libera y
//   promueve la primera FIFO; a la vez el Gestor promueve manualmente una posición
//   arbitraria. Ambas contienden por el `FOR UPDATE` sobre FECHA_BLOQUEADA. EXACTAMENTE
//   una promoción efectiva; la perdedora aborta sin corromper cola ni FECHA_BLOQUEADA
//   (una sola fila activa por (tenant,fecha)). Si pierde el Gestor → error de carrera.
//   spec-delta RC-A; design §D-4.
// ===========================================================================

describe('Promoción manual US-019 — RC-A: manual vs barrido automático US-018', () => {
  it('debe_materializar_exactamente_una_promocion_y_dejar_una_sola_fila_de_bloqueo', async () => {
    // Bloqueante con TTL VENCIDO (candidata al barrido) + cola R2 (pos1), R3 (pos2).
    const { colaIds } = await sembrarBloqueanteVivaConCola({
      fecha: F_RCA,
      n: 2,
      ttl: ttlVencido(),
    });
    const [, r3] = colaIds; // el Gestor elige R3 (posición 2, arbitraria).

    const resultados = await Promise.allSettled([
      barrido.ejecutar(), // ruta automática US-018: expira bloqueante + libera + promueve FIFO.
      manual.ejecutar({
        tenantId: TENANT,
        usuarioId: GESTOR_A,
        reservaId: r3,
        confirmado: true,
      }),
    ]);

    // El barrido siempre se resuelve (idempotente). La manual puede ganar o perder:
    // si pierde, RECHAZA (carrera) — nunca corrompe estado.
    expect(resultados[0].status).toBe('fulfilled');

    // INVARIANTE DURO: jamás coexisten dos bloqueos para (T, D) ni dos promovidas a 2b.
    expect(await contarBloqueos(F_RCA)).toBe(1);
    expect(await contarPromovidas(F_RCA)).toBe(1);

    // La única fila de bloqueo apunta a una reserva VIVA en 2b (la promovida), no a la
    // bloqueante ya expirada.
    const bloqueos = await prisma.fechaBloqueada.findMany({
      where: { tenantId: TENANT, fecha: F_RCA },
    });
    const apuntada = await prisma.reserva.findUnique({
      where: { idReserva: bloqueos[0].reservaId },
    });
    expect(apuntada?.subEstado).toBe(SubEstadoConsulta.s2b);
  });

  it('la_manual_que_pierde_la_carrera_rechaza_sin_corromper_la_cola', async () => {
    const { colaIds } = await sembrarBloqueanteVivaConCola({
      fecha: F_RCA,
      n: 2,
      ttl: ttlVencido(),
    });
    const [, r3] = colaIds;

    const resultados = await Promise.allSettled([
      barrido.ejecutar(),
      manual.ejecutar({
        tenantId: TENANT,
        usuarioId: GESTOR_A,
        reservaId: r3,
        confirmado: true,
      }),
    ]);

    const manualResult = resultados[1];
    // FIFO + gana el primer lock (sin cesión): si el automático ganó, la manual RECHAZA.
    // Si la manual ganó, se resuelve. En AMBOS casos el estado queda coherente:
    if (manualResult.status === 'rejected') {
      // No hay corrupción: exactamente una promovida y un solo bloqueo (comprobado arriba).
      expect(await contarPromovidas(F_RCA)).toBe(1);
      expect(await contarBloqueos(F_RCA)).toBe(1);
    } else {
      expect(await contarPromovidas(F_RCA)).toBe(1);
    }
  });
});

// ===========================================================================
// RC-B — DOS Gestores promueven consultas DISTINTAS de la misma cola simultáneamente.
//   Bloqueante VIGENTE (no barrido). Ambas transacciones contienden por el `FOR UPDATE`
//   sobre FECHA_BLOQUEADA. EXACTAMENTE una completa (expira la bloqueante, promueve su
//   elegida, reordena); la otra, al obtener el lock, ve la bloqueante ya en 2x / la
//   fecha ya re-bloqueada por otra y ABORTA (rechaza). Una sola promoción efectiva.
//   spec-delta RC-B; design §D-4.1.
// ===========================================================================

describe('Promoción manual US-019 — RC-B: dos Gestores promueven distinto simultáneamente', () => {
  it('debe_completar_exactamente_una_promocion_y_abortar_la_otra', async () => {
    const { colaIds } = await sembrarBloqueanteVivaConCola({
      fecha: F_RCB,
      n: 2,
      ttl: ttlVigente(),
    });
    const [r2, r3] = colaIds; // Gestor A elige R2 (pos1); Gestor B elige R3 (pos2).

    const resultados = await Promise.allSettled([
      manual.ejecutar({ tenantId: TENANT, usuarioId: GESTOR_A, reservaId: r2, confirmado: true }),
      manual.ejecutar({ tenantId: TENANT, usuarioId: GESTOR_B, reservaId: r3, confirmado: true }),
    ]);

    // Exactamente una cumple y una rechaza (la que llega tarde ve el estado ya cambiado).
    const cumplidos = resultados.filter((r) => r.status === 'fulfilled');
    const rechazados = resultados.filter((r) => r.status === 'rejected');
    expect(cumplidos).toHaveLength(1);
    expect(rechazados).toHaveLength(1);

    // INVARIANTE DURO: una sola promovida a 2b y un solo bloqueo para (T, D).
    expect(await contarPromovidas(F_RCB)).toBe(1);
    expect(await contarBloqueos(F_RCB)).toBe(1);

    // La bloqueante original NUNCA queda viva: fue expirada por la ganadora.
    const bloqueos = await prisma.fechaBloqueada.findMany({
      where: { tenantId: TENANT, fecha: F_RCB },
    });
    const apuntada = await prisma.reserva.findUnique({
      where: { idReserva: bloqueos[0].reservaId },
    });
    expect(apuntada?.subEstado).toBe(SubEstadoConsulta.s2b);
    expect([r2, r3]).toContain(apuntada?.idReserva);
  });
});
