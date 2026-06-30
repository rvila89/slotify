/**
 * TESTS DE CONCURRENCIA REALES de la extensión manual del TTL del bloqueo blando
 * (`POST /reservas/{id}/extender-bloqueo`) (US-006 / UC-05) — fase TDD RED.
 * tasks.md Fase 3: 3.5. ZONA CRÍTICA (serialización por `SELECT … FOR UPDATE` sobre
 * la fila bloqueante de FECHA_BLOQUEADA, design.md §D-7). Skill `concurrency-locking`.
 *
 * Trazabilidad: US-006, spec-delta `consultas` (Requirement "Concurrencia — la
 * extensión se serializa con el barrido de expiración sin estado intermedio";
 * escenarios "Extensión concurrente con el barrido de expiración sobre la misma
 * fecha" y "Dos extensiones simultáneas sobre la misma RESERVA se serializan");
 * design.md §D-7. CLAUDE.md §Testing / §Regla crítica (la exclusión mutua vive SOLO
 * en PostgreSQL; nada de Redis/locks distribuidos).
 *
 * INTEGRACIÓN con TRANSACCIONES REALES contra el Postgres del docker-compose (no
 * mocks). Mismo enfoque que `programar-visita-concurrencia.spec.ts` (US-008): las
 * operaciones rivales se lanzan con `Promise.allSettled()` para FORZAR la carrera.
 * El barrido de expiración US-012 AÚN NO existe; aquí se SIMULA su acción (una
 * transacción que toma el MISMO lock `SELECT … FOR UPDATE` sobre la fila bloqueante y,
 * si el TTL ya venció, expira la RESERVA a su terminal liberando el bloqueo). Así se
 * verifica la SERIALIZACIÓN; el test queda listo para acoplarse al barrido real.
 * Requiere `docker compose up -d postgres` + migración + seed.
 *
 * RED: aún NO existe `application/extender-bloqueo.use-case.ts`. La batería entera
 * está en ROJO por AUSENCIA DE IMPLEMENTACIÓN (no por infraestructura: el Postgres
 * está arriba). GREEN es de `backend-developer`.
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
import {
  ExtenderBloqueoUseCase,
  BloqueoNoExtensibleError,
  type ExtenderBloqueoComando,
} from '../application/extender-bloqueo.use-case';

const TENANT = '00000000-0000-0000-0000-000000000001';
const GESTOR = '00000000-0000-0000-0000-000000000002';
const EMAIL_PATTERN = '@us006-conc.test';
const DIA_MS = 24 * 60 * 60 * 1000;

// Fechas de EVENTO (a bloquear) estrictamente futuras y aisladas.
const FECHA_DOBLE = new Date('2027-11-11T00:00:00.000Z');
const FECHA_BARRIDO = new Date('2027-11-12T00:00:00.000Z');
const FECHAS = [FECHA_DOBLE, FECHA_BARRIDO];

const ttlVigente = (): Date => new Date(Date.now() + 30 * DIA_MS);
const ttlVencido = (): Date => new Date(Date.now() - DIA_MS);

let moduleRef: TestingModule;
let prisma: PrismaService;
let useCase: ExtenderBloqueoUseCase;

const sufijo = (): string => Math.random().toString(36).slice(2, 8);

const comando = (reservaId: string, dias: number): ExtenderBloqueoComando => ({
  tenantId: TENANT,
  usuarioId: GESTOR,
  reservaId,
  dias,
});

/** Siembra una RESERVA en `2.b` con su FECHA_BLOQUEADA blanda (TTL compartido). */
const sembrarReserva = async (params: {
  fecha: Date;
  ttl?: Date;
}): Promise<{ reservaId: string; ttl: Date }> => {
  const ttl = params.ttl ?? ttlVigente();
  const cliente = await prisma.cliente.create({
    data: { tenantId: TENANT, nombre: 'Conc', email: `c-${sufijo()}${EMAIL_PATTERN}` },
  });
  const reserva = await prisma.reserva.create({
    data: {
      tenantId: TENANT,
      clienteId: cliente.idCliente,
      codigo: `TST-U006C-${sufijo()}`,
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
      reservaId: reserva.idReserva,
      tipoBloqueo: TipoBloqueo.blando,
      ttlExpiracion: ttl,
    },
  });
  return { reservaId: reserva.idReserva, ttl };
};

const limpiar = async (): Promise<void> => {
  const clientesPattern = await prisma.cliente.findMany({
    where: { email: { contains: EMAIL_PATTERN } },
    select: { idCliente: true },
  });
  const clienteIds = clientesPattern.map((c) => c.idCliente);
  const reservas = await prisma.reserva.findMany({
    where: { OR: [{ clienteId: { in: clienteIds } }, { fechaEvento: { in: FECHAS } }] },
    select: { idReserva: true, clienteId: true },
  });
  const ids = reservas.map((r) => r.idReserva);
  const todosClienteIds = [...new Set([...clienteIds, ...reservas.map((r) => r.clienteId)])];
  if (ids.length > 0) {
    await prisma.fechaBloqueada.deleteMany({ where: { reservaId: { in: ids } } });
    await prisma.comunicacion.deleteMany({ where: { reservaId: { in: ids } } });
    await prisma.auditLog.deleteMany({ where: { entidadId: { in: ids } } });
    await prisma.reserva.deleteMany({ where: { idReserva: { in: ids } } });
  }
  await prisma.fechaBloqueada.deleteMany({ where: { tenantId: TENANT, fecha: { in: FECHAS } } });
  if (todosClienteIds.length > 0) {
    await prisma.cliente.deleteMany({ where: { idCliente: { in: todosClienteIds } } });
  }
};

beforeAll(async () => {
  moduleRef = await Test.createTestingModule({
    imports: [ConfigModule.forRoot({ isGlobal: true }), ReservasModule],
  }).compile();
  await moduleRef.init();
  prisma = moduleRef.get(PrismaService);
  useCase = moduleRef.get(ExtenderBloqueoUseCase);
});

afterAll(async () => {
  await limpiar();
  await moduleRef.close();
});

beforeEach(async () => {
  await limpiar();
});

// ===========================================================================
// 1. Dos extensiones simultáneas sobre la MISMA RESERVA → se serializan por el lock
//    `SELECT … FOR UPDATE` de la fila bloqueante; resultado DETERMINISTA sin
//    lost-update: el TTL final = ttl_inicial + N1 + N2 (en cualquier orden), y
//    RESERVA y FECHA_BLOQUEADA quedan con EL MISMO valor (no medio extendido).
//    (skill concurrency-locking: Promise.allSettled.)
// ===========================================================================

describe('Extender bloqueo — D-7: dos extensiones simultáneas se serializan sin lost-update', () => {
  it('debe_aplicar_ambas_de_forma_serializada_y_sumar_los_dos_deltas_sin_perder_ninguna', async () => {
    const { reservaId, ttl } = await sembrarReserva({ fecha: FECHA_DOBLE });
    const N1 = 3;
    const N2 = 5;

    const resultados = await Promise.allSettled([
      useCase.ejecutar(comando(reservaId, N1)),
      useCase.ejecutar(comando(reservaId, N2)),
    ]);

    // Ambas extensiones son legales (bloqueo vigente): se serializan, no se pierden.
    const cumplidas = resultados.filter((r) => r.status === 'fulfilled');
    expect(cumplidas).toHaveLength(2);

    // Estado final: TTL = inicial + N1 + N2 (cada extensión SUMA sobre el TTL ACTUAL).
    const esperado = ttl.getTime() + (N1 + N2) * DIA_MS;
    const reserva = await prisma.reserva.findUnique({ where: { idReserva: reservaId } });
    expect(reserva?.ttlExpiracion?.getTime()).toBe(esperado);

    // RESERVA y FECHA_BLOQUEADA quedan SINCRONIZADAS (no medio extendido).
    const bloqueos = await prisma.fechaBloqueada.findMany({
      where: { tenantId: TENANT, fecha: FECHA_DOBLE },
    });
    expect(bloqueos).toHaveLength(1);
    expect(bloqueos[0].ttlExpiracion?.getTime()).toBe(esperado);
  });
});

// ===========================================================================
// 2. Extensión en el límite del vencimiento concurrente con el BARRIDO de expiración
//    (A4/A5, US-012, SIMULADO): el TTL acaba de vencer. Ambas toman el MISMO lock de
//    la fila bloqueante. Estado final COHERENTE y DETERMINISTA, sin estado intermedio:
//      - o bien la extensión gana: RESERVA con TTL extendido y bloqueo vigente;
//      - o bien el barrido gana: RESERVA expirada (terminal) + bloqueo liberado y la
//        extensión RECHAZADA (no resucita un bloqueo ya expirado-y-procesado).
// ===========================================================================

describe('Extender bloqueo — D-7: concurrente con el barrido de expiración sobre la misma fecha', () => {
  it('debe_serializar_y_dejar_estado_coherente_sin_resucitar_un_bloqueo_expirado', async () => {
    const vencido = ttlVencido();
    const { reservaId } = await sembrarReserva({ fecha: FECHA_BARRIDO, ttl: vencido });
    const N = 7;

    // Simulación del barrido A4/A5 (US-012): transacción que toma el MISMO lock
    // (`SELECT … FOR UPDATE`) de la fila bloqueante y, al ver el TTL vencido, expira la
    // RESERVA a su terminal (2.x) liberando el bloqueo. Compite con la extensión.
    const barrido = prisma.$transaction(async (tx) => {
      await prisma.fijarTenant(tx, TENANT);
      await tx.$queryRaw`
        SELECT id_bloqueo FROM fecha_bloqueada
        WHERE tenant_id = ${TENANT}
          AND fecha = ${FECHA_BARRIDO.toISOString().slice(0, 10)}::date
        FOR UPDATE
      `;
      await tx.reserva.update({
        where: { idReserva: reservaId },
        data: { subEstado: SubEstadoConsulta.s2x, ttlExpiracion: null },
      });
      await tx.fechaBloqueada.deleteMany({
        where: { tenantId: TENANT, fecha: FECHA_BARRIDO },
      });
    });

    const resultados = await Promise.allSettled([
      useCase.ejecutar(comando(reservaId, N)),
      barrido,
    ]);

    const reserva = await prisma.reserva.findUnique({ where: { idReserva: reservaId } });
    const bloqueos = await prisma.fechaBloqueada.findMany({
      where: { tenantId: TENANT, fecha: FECHA_BARRIDO },
    });

    const extension = resultados[0];
    if (extension.status === 'fulfilled') {
      // Ganó la extensión: RESERVA sigue en 2.b con el TTL extendido y su fila vigente.
      expect(reserva?.subEstado).toBe(SubEstadoConsulta.s2b);
      expect(bloqueos).toHaveLength(1);
      expect(bloqueos[0].ttlExpiracion).not.toBeNull();
    } else {
      // Ganó el barrido: RESERVA terminal (2.x), bloqueo liberado y la extensión
      // RECHAZADA (no resucita el bloqueo ni deja estado intermedio observable).
      expect(extension.reason).toBeInstanceOf(BloqueoNoExtensibleError);
      expect(reserva?.subEstado).toBe(SubEstadoConsulta.s2x);
      expect(bloqueos).toHaveLength(0);
    }
  });
});
