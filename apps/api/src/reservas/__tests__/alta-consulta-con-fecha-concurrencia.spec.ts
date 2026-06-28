/**
 * TESTS DE CONCURRENCIA REALES del alta CON FECHA (US-004 / UC-03) — fase TDD RED.
 * tasks.md Fase 3: 3.5. ZONA CRÍTICA (anti-doble-reserva D4).
 *
 * Trazabilidad: US-004, spec-delta `consultas` (Requirement "Concurrencia
 * anti-doble-reserva (D4) en el alta con fecha", escenarios "Dos altas simultáneas
 * sobre fecha libre — una 2.b, otra 2.d" y "N altas simultáneas producen 1 bloqueo
 * y N-1 posiciones de cola únicas"), design.md §D-5 (`posicion_cola` serializada
 * por la fila bloqueante + UNIQUE parcial) y §D-6 (catch `UNIQUE(tenant,fecha)` →
 * reabrir tx → re-derivar a 2.d). CLAUDE.md §Testing ("tests de concurrencia del
 * bloqueo atómico de fecha antes que UI o CRUD").
 *
 * Es un test de INTEGRACIÓN con CONEXIONES/TRANSACCIONES REALES contra el Postgres
 * del docker-compose (no mocks): la garantía D4 vive en el motor
 * (`UNIQUE(tenant_id, fecha)` + `SELECT … FOR UPDATE`), nunca en Redis/locks
 * distribuidos (regla del proyecto). Mismo enfoque que
 * `bloquear-fecha-integracion.spec.ts` (US-040). Requiere
 * `docker compose up -d postgres` + migración + seed aplicados.
 *
 * El caso de uso se resuelve por DI real (`ReservasModule`), de modo que el test
 * sea robusto a cómo `backend-developer` cablee los nuevos puertos.
 *
 * RED: hoy `AltaConsultaUseCase` IGNORA `fechaEvento` (crea siempre 2.a sin
 * FECHA_BLOQUEADA): no aparece ninguna RESERVA en `s2b`, ni fila en
 * `fecha_bloqueada`, ni `s2d` con posición de cola → las aserciones fallan. La
 * batería está en ROJO. GREEN es responsabilidad de `backend-developer`.
 */
import { Test, type TestingModule } from '@nestjs/testing';
import { ConfigModule } from '@nestjs/config';
import { ReservasModule } from '../reservas.module';
import { PrismaService } from '../../shared/prisma/prisma.service';
import {
  AltaConsultaUseCase,
  type AltaConsultaComando,
} from '../application/alta-consulta.use-case';

const TENANT = '00000000-0000-0000-0000-000000000001';
const GESTOR = '00000000-0000-0000-0000-000000000002';
// Fecha estrictamente futura y aislada (no usada por el seed ni otras suites).
const FECHA = new Date('2027-09-12T00:00:00.000Z');

let moduleRef: TestingModule;
let prisma: PrismaService;
let useCase: AltaConsultaUseCase;

/** Construye un comando de alta CON FECHA (cast: `fechaEvento` aún no está en el tipo). */
type ComandoConFecha = AltaConsultaComando & { fechaEvento: Date };
const comando = (email: string): AltaConsultaComando =>
  ({
    tenantId: TENANT,
    usuarioId: GESTOR,
    canalEntrada: 'web',
    fechaEvento: FECHA,
    cliente: { nombre: 'Conc', apellidos: 'Test', email, telefono: '600000000' },
  } as ComandoConFecha);

/**
 * Borra todo lo que el alta haya creado, en orden FK-safe. Filtra por la FECHA en
 * disputa Y por los CLIENTES del patrón de email: en la fase RED el use-case ignora
 * `fechaEvento` (crea reservas con `fecha_evento = NULL`), por lo que el filtro por
 * fecha no basta para evitar violar `reserva_cliente_id_fkey` al borrar clientes.
 */
const limpiar = async (): Promise<void> => {
  const clientesPattern = await prisma.cliente.findMany({
    where: { tenantId: TENANT, email: { contains: '@us004-conc.test' } },
    select: { idCliente: true },
  });
  const clienteIdsPattern = clientesPattern.map((c) => c.idCliente);
  const reservas = await prisma.reserva.findMany({
    where: {
      tenantId: TENANT,
      OR: [{ fechaEvento: FECHA }, { clienteId: { in: clienteIdsPattern } }],
    },
    select: { idReserva: true, clienteId: true },
  });
  const ids = reservas.map((r) => r.idReserva);
  const clienteIds = [...new Set([...clienteIdsPattern, ...reservas.map((r) => r.clienteId)])];
  if (ids.length > 0) {
    await prisma.fechaBloqueada.deleteMany({ where: { reservaId: { in: ids } } });
    await prisma.comunicacion.deleteMany({ where: { reservaId: { in: ids } } });
    await prisma.auditLog.deleteMany({ where: { tenantId: TENANT, entidadId: { in: ids } } });
    await prisma.reserva.deleteMany({ where: { idReserva: { in: ids } } });
  }
  // Por si una fila de bloqueo quedó huérfana sobre la fecha.
  await prisma.fechaBloqueada.deleteMany({ where: { tenantId: TENANT, fecha: FECHA } });
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
  useCase = moduleRef.get(AltaConsultaUseCase);
});

afterAll(async () => {
  await limpiar();
  await moduleRef.close();
});

beforeEach(async () => {
  await limpiar();
});

// ===========================================================================
// 1. Dos altas simultáneas sobre fecha libre → 1×2.b (+FECHA_BLOQUEADA) y 1×2.d.
// ===========================================================================

describe('Alta con fecha — D4: dos altas concurrentes (1×2.b + 1×2.d)', () => {
  it('debe_producir_exactamente_una_2b_con_bloqueo_y_una_2d_con_posicion_cola_1', async () => {
    // Act: dos altas con la MISMA (tenant, fecha) libre, en paralelo.
    const resultados = await Promise.allSettled([
      useCase.ejecutar(comando('a@us004-conc.test')),
      useCase.ejecutar(comando('b@us004-conc.test')),
    ]);

    // Ninguna debe rechazarse: la perdedora del bloqueo se re-deriva a 2.d (D-6).
    const rechazos = resultados.filter((r) => r.status === 'rejected');
    expect(rechazos).toHaveLength(0);

    // Estado final en BD: exactamente 1 fila de FECHA_BLOQUEADA para (tenant, fecha).
    const bloqueos = await prisma.fechaBloqueada.count({
      where: { tenantId: TENANT, fecha: FECHA },
    });
    expect(bloqueos).toBe(1);

    const enDosB = await prisma.reserva.count({
      where: { tenantId: TENANT, fechaEvento: FECHA, subEstado: 's2b' },
    });
    const enDosD = await prisma.reserva.findMany({
      where: { tenantId: TENANT, fechaEvento: FECHA, subEstado: 's2d' },
      select: { posicionCola: true, consultaBloqueanteId: true },
    });

    expect(enDosB).toBe(1);
    expect(enDosD).toHaveLength(1);
    expect(enDosD[0].posicionCola).toBe(1);
    // La 2.d apunta a la ganadora (la 2.b) como bloqueante.
    const ganadora = await prisma.reserva.findFirst({
      where: { tenantId: TENANT, fechaEvento: FECHA, subEstado: 's2b' },
      select: { idReserva: true },
    });
    expect(enDosD[0].consultaBloqueanteId).toBe(ganadora?.idReserva);
  });
});

// ===========================================================================
// 2. N altas simultáneas → 1×2.b + (N-1)×2.d con posiciones ÚNICAS y CONTIGUAS.
// ===========================================================================

describe('Alta con fecha — D5/D6: N altas concurrentes (1×2.b + N-1×2.d contiguas)', () => {
  it('debe_producir_un_unico_bloqueo_y_posiciones_de_cola_unicas_y_contiguas_1_a_N_menos_1', async () => {
    const N = 5;
    const comandos = Array.from({ length: N }, (_, i) =>
      useCase.ejecutar(comando(`w${i}@us004-conc.test`)),
    );

    const resultados = await Promise.allSettled(comandos);
    const rechazos = resultados.filter((r) => r.status === 'rejected');
    expect(rechazos).toHaveLength(0);

    // Exactamente 1 bloqueo y 1 RESERVA en 2.b.
    const bloqueos = await prisma.fechaBloqueada.count({
      where: { tenantId: TENANT, fecha: FECHA },
    });
    expect(bloqueos).toBe(1);

    const enDosB = await prisma.reserva.count({
      where: { tenantId: TENANT, fechaEvento: FECHA, subEstado: 's2b' },
    });
    expect(enDosB).toBe(1);

    // Las N-1 restantes en 2.d con posiciones 1..N-1, únicas y contiguas.
    const enCola = await prisma.reserva.findMany({
      where: { tenantId: TENANT, fechaEvento: FECHA, subEstado: 's2d' },
      select: { posicionCola: true },
    });
    expect(enCola).toHaveLength(N - 1);

    const posiciones = enCola
      .map((r) => r.posicionCola)
      .sort((a, b) => (a ?? 0) - (b ?? 0));
    expect(new Set(posiciones).size).toBe(N - 1); // únicas
    expect(posiciones).toEqual(Array.from({ length: N - 1 }, (_, i) => i + 1)); // contiguas 1..N-1
  });
});
