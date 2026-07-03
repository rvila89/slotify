/**
 * TESTS DE CONCURRENCIA REALES de la transición «resultado de visita — cliente
 * interesado» (`2.v` → `2.b`) (US-009 / UC-08) — fase TDD RED. tasks.md Fase 3: 3.6.
 * ZONA CRÍTICA (serialización commit-first por `SELECT … FOR UPDATE` sobre la fila
 * bloqueante de FECHA_BLOQUEADA, design.md §D-3).
 *
 * Trazabilidad: US-009, spec-delta `consultas` (Requirement "Concurrencia — la
 * transición 2.v → 2.b se serializa con el barrido de TTLs (A21/US-012) commit-first,
 * sin estado intermedio", escenarios "Registro de resultado concurrente con el barrido
 * A21 sobre la misma RESERVA" y "Dos registros simultáneos de resultado sobre la misma
 * RESERVA aplican una sola vez"), design.md §D-3. CLAUDE.md §Testing / §Regla crítica
 * (la exclusión mutua vive SOLO en PostgreSQL; nada de Redis/locks distribuidos).
 *
 * INTEGRACIÓN con TRANSACCIONES REALES contra el Postgres del docker-compose /
 * slotify_test (no mocks). Mismo enfoque que `programar-visita-concurrencia.spec.ts`
 * (US-008) y `transicion-pendiente-invitados-concurrencia.spec.ts` (US-007). Las
 * llamadas se lanzan con `Promise.allSettled()` (skill `concurrency-locking`). Requiere
 * `docker compose up -d postgres` + migración + seed.
 *
 * RED: aún NO existe `application/registrar-resultado-visita.use-case.ts`. El import
 * falla en compilación y la batería entera está en ROJO por AUSENCIA DE IMPLEMENTACIÓN
 * (no por infraestructura: el Postgres está arriba). GREEN es de `backend-developer`.
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
  RegistrarResultadoVisitaUseCase,
  ResultadoVisitaValidacionError,
  type RegistrarResultadoVisitaComando,
} from '../application/registrar-resultado-visita.use-case';

const TENANT = '00000000-0000-0000-0000-000000000001';
const GESTOR = '00000000-0000-0000-0000-000000000002';
const EMAIL_PATTERN = '@us009-conc.test';
const DIA_MS = 24 * 60 * 60 * 1000;

// Fechas de EVENTO (a bloquear) estrictamente futuras y aisladas.
const FECHA_DOBLE = new Date('2027-12-20T00:00:00.000Z');
const FECHA_BARRIDO = new Date('2027-12-21T00:00:00.000Z');
const FECHAS = [FECHA_DOBLE, FECHA_BARRIDO];

const ttlVigente = (): Date => new Date(Date.now() + 30 * DIA_MS);
const ttlVencido = (): Date => new Date(Date.now() - DIA_MS);

let moduleRef: TestingModule;
let prisma: PrismaService;
let useCase: RegistrarResultadoVisitaUseCase;

const sufijo = (): string => Math.random().toString(36).slice(2, 8);

const comando = (reservaId: string): RegistrarResultadoVisitaComando => ({
  tenantId: TENANT,
  usuarioId: GESTOR,
  reservaId,
  resultado: 'interesado',
});

/** Siembra una RESERVA en `2v` con su FECHA_BLOQUEADA (la fila siempre existe). */
const sembrarReserva = async (params: {
  fecha: Date;
  ttlBloqueo?: Date;
}): Promise<string> => {
  const cliente = await prisma.cliente.create({
    data: { tenantId: TENANT, nombre: 'Conc', email: `c-${sufijo()}${EMAIL_PATTERN}` },
  });
  const ttl = params.ttlBloqueo ?? ttlVigente();
  const reserva = await prisma.reserva.create({
    data: {
      tenantId: TENANT,
      clienteId: cliente.idCliente,
      codigo: `TST-U009C-${sufijo()}`,
      estado: EstadoReserva.consulta,
      subEstado: SubEstadoConsulta.s2v,
      canalEntrada: CanalEntrada.web,
      fechaEvento: params.fecha,
      visitaProgramadaFecha: new Date(params.fecha),
      visitaProgramadaHora: '18:00',
      visitaRealizada: false,
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
  return reserva.idReserva;
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
  useCase = moduleRef.get(RegistrarResultadoVisitaUseCase);
});

afterAll(async () => {
  await limpiar();
  await moduleRef.close();
});

beforeEach(async () => {
  await limpiar();
});

// ===========================================================================
// 1. Dos registros simultáneos de "interesado" sobre la MISMA RESERVA → exactamente
//    UNO aplica (2.b + visita_realizada=true + TTL fresco + UPDATE de FECHA_BLOQUEADA);
//    el otro observa que ya no está en 2.v y recibe la guarda de origen. Sin doble
//    actualización del bloqueo.
//    (skill concurrency-locking: Promise.allSettled, 1 fulfilled + 1 rejected.)
// ===========================================================================

describe('Resultado visita interesado — dos registros simultáneos aplican una sola vez', () => {
  it('debe_aplicar_exactamente_uno_y_rechazar_el_otro_con_la_guarda_de_origen', async () => {
    const reservaId = await sembrarReserva({ fecha: FECHA_DOBLE });

    const resultados = await Promise.allSettled([
      useCase.ejecutar(comando(reservaId)),
      useCase.ejecutar(comando(reservaId)),
    ]);

    const cumplidas = resultados.filter((r) => r.status === 'fulfilled');
    const rechazadas = resultados.filter((r) => r.status === 'rejected');
    expect(cumplidas).toHaveLength(1);
    expect(rechazadas).toHaveLength(1);
    expect((rechazadas[0] as PromiseRejectedResult).reason).toBeInstanceOf(
      ResultadoVisitaValidacionError,
    );

    // Estado final coherente: RESERVA en 2.b, visita_realizada=true y UNA sola fila de
    // bloqueo actualizada (no se aplicó dos veces ni se duplicó).
    const reserva = await prisma.reserva.findUnique({ where: { idReserva: reservaId } });
    expect(reserva?.subEstado).toBe(SubEstadoConsulta.s2b);
    expect(reserva?.visitaRealizada).toBe(true);

    const bloqueos = await prisma.fechaBloqueada.findMany({
      where: { tenantId: TENANT, fecha: FECHA_DOBLE },
    });
    expect(bloqueos).toHaveLength(1);
    expect(bloqueos[0].tipoBloqueo).toBe(TipoBloqueo.blando);
    // El TTL de la fila de bloqueo coincide con el de la RESERVA (misma fuente de verdad).
    expect(bloqueos[0].ttlExpiracion?.getTime()).toBe(reserva?.ttlExpiracion?.getTime());
  });
});

// ===========================================================================
// 2. Registro de "interesado" concurrente con el BARRIDO A21 (US-012) sobre la misma
//    RESERVA: su ttl de 2.v (día post-visita) acaba de vencer. Ambas se serializan por
//    el lock de la fila bloqueante. Estado final COHERENTE:
//      - Gana el registro: 2.b con FECHA_BLOQUEADA actualizada al TTL fresco (futuro);
//        el barrido (si opera después) no la expira (ya no es candidata en 2.v).
//      - Gana el barrido: RESERVA en terminal 2.x + registro rechazado por la guarda.
//    NUNCA 2.b sin bloqueo actualizado ni viceversa (sin estado intermedio observable).
// ===========================================================================

describe('Resultado visita interesado — concurrente con el barrido A21 sobre la misma RESERVA', () => {
  it('debe_serializar_commit_first_y_dejar_un_estado_final_coherente_sin_estado_intermedio', async () => {
    const reservaId = await sembrarReserva({
      fecha: FECHA_BARRIDO,
      ttlBloqueo: ttlVencido(), // el ttl de 2.v acaba de vencer
    });

    // Simulación del barrido A21 (US-012): una transacción que toma el MISMO lock de la
    // fila bloqueante (`SELECT … FOR UPDATE`) y, si el ttl está vencido, expira la
    // RESERVA de 2.v a su terminal (2.x) liberando el bloqueo. Compite con el registro.
    const barridoA21 = prisma.$transaction(async (tx) => {
      await prisma.fijarTenant(tx, TENANT);
      await tx.$queryRaw`
        SELECT id_bloqueo FROM fecha_bloqueada
        WHERE tenant_id = ${TENANT}::uuid
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
      useCase.ejecutar(comando(reservaId)),
      barridoA21,
    ]);

    const reserva = await prisma.reserva.findUnique({ where: { idReserva: reservaId } });
    const bloqueos = await prisma.fechaBloqueada.findMany({
      where: { tenantId: TENANT, fecha: FECHA_BARRIDO },
    });

    const registro = resultados[0];
    if (registro.status === 'fulfilled') {
      // Ganó el registro: 2.b con visita_realizada=true y su fila de bloqueo actualizada
      // al TTL fresco (mismo valor que la RESERVA).
      expect(reserva?.subEstado).toBe(SubEstadoConsulta.s2b);
      expect(reserva?.visitaRealizada).toBe(true);
      expect(bloqueos).toHaveLength(1);
      expect(bloqueos[0].ttlExpiracion?.getTime()).toBe(reserva?.ttlExpiracion?.getTime());
    } else {
      // Ganó el barrido: RESERVA en terminal 2.x y el registro recibió la guarda de origen.
      expect(registro.reason).toBeInstanceOf(ResultadoVisitaValidacionError);
      expect(reserva?.subEstado).toBe(SubEstadoConsulta.s2x);
      // Coherencia: NO queda 2.b sin bloqueo (no hay estado intermedio observable).
      expect(reserva?.subEstado).not.toBe(SubEstadoConsulta.s2b);
    }
  });
});
