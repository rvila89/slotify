/**
 * TESTS DE CONCURRENCIA REALES de la transición «programar visita» (`2.a`/`2.b`/`2.c`
 * → `2.v`) (US-008 / UC-07) — fase TDD RED. tasks.md Fase 3: 3.7. ZONA CRÍTICA
 * (serialización por `SELECT … FOR UPDATE` sobre la fila bloqueante + UNIQUE en el
 * INSERT desde 2.a, design.md §D-4/§D-9).
 *
 * Trazabilidad: US-008, spec-delta `consultas` (Requirement "Concurrencia — la
 * transición a 2.v se serializa con el barrido de TTLs (A4/US-012) sin estado
 * intermedio", escenarios "Transición a 2.v concurrente con el barrido A4 sobre la
 * misma RESERVA" y "Dos transiciones simultáneas a 2.v sobre la misma RESERVA aplican
 * una sola vez"), design.md §D-9. CLAUDE.md §Testing / §Regla crítica (la exclusión
 * mutua vive SOLO en PostgreSQL; nada de Redis/locks distribuidos).
 *
 * INTEGRACIÓN con TRANSACCIONES REALES contra el Postgres del docker-compose (no
 * mocks). Mismo enfoque que `transicion-pendiente-invitados-concurrencia.spec.ts`
 * (US-007). Las llamadas se lanzan con `Promise.allSettled()` (skill
 * `concurrency-locking`). Requiere `docker compose up -d postgres` + migración + seed.
 *
 * RED: aún NO existe `application/programar-visita.use-case.ts`. El import falla en
 * compilación y la batería entera está en ROJO por AUSENCIA DE IMPLEMENTACIÓN (no por
 * infraestructura: el Postgres está arriba). GREEN es de `backend-developer`.
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
  ProgramarVisitaUseCase,
  ProgramarVisitaValidacionError,
  type ProgramarVisitaComando,
} from '../application/programar-visita.use-case';

const TENANT = '00000000-0000-0000-0000-000000000001';
const GESTOR = '00000000-0000-0000-0000-000000000002';
const EMAIL_PATTERN = '@us008-conc.test';
const DIA_MS = 24 * 60 * 60 * 1000;

// Fechas de EVENTO (a bloquear) estrictamente futuras y aisladas.
const FECHA_DOBLE = new Date('2027-12-12T00:00:00.000Z');
const FECHA_BARRIDO = new Date('2027-12-13T00:00:00.000Z');
const FECHA_2A = new Date('2027-12-14T00:00:00.000Z');
const FECHAS = [FECHA_DOBLE, FECHA_BARRIDO, FECHA_2A];

const ttlVigente = (): Date => new Date(Date.now() + 30 * DIA_MS);
const ttlVencido = (): Date => new Date(Date.now() - DIA_MS);

/** Fecha de visita dentro de la ventana [hoy+1, hoy+7] del setting. */
const diaUtc = (offsetDias: number): Date => {
  const d = new Date(Date.now() + offsetDias * DIA_MS);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
};

const ttlEsperado = (visita: Date): number =>
  Date.UTC(
    visita.getUTCFullYear(),
    visita.getUTCMonth(),
    visita.getUTCDate() + 1,
    23,
    59,
    59,
  );

let moduleRef: TestingModule;
let prisma: PrismaService;
let useCase: ProgramarVisitaUseCase;

const sufijo = (): string => Math.random().toString(36).slice(2, 8);

const comando = (
  reservaId: string,
  fechaVisita: Date,
): ProgramarVisitaComando => ({
  tenantId: TENANT,
  usuarioId: GESTOR,
  reservaId,
  fechaVisita,
  horaVisita: '18:00',
});

/** Siembra una RESERVA en `subEstado` con su FECHA_BLOQUEADA (salvo `conBloqueo:false`). */
const sembrarReserva = async (params: {
  fecha: Date;
  subEstado: SubEstadoConsulta;
  conBloqueo?: boolean;
  ttlBloqueo?: Date;
}): Promise<string> => {
  const cliente = await prisma.cliente.create({
    data: { tenantId: TENANT, nombre: 'Conc', email: `c-${sufijo()}${EMAIL_PATTERN}` },
  });
  const reserva = await prisma.reserva.create({
    data: {
      tenantId: TENANT,
      clienteId: cliente.idCliente,
      codigo: `TST-U008C-${sufijo()}`,
      estado: EstadoReserva.consulta,
      subEstado: params.subEstado,
      canalEntrada: CanalEntrada.web,
      fechaEvento: params.fecha,
      ttlExpiracion: params.ttlBloqueo ?? ttlVigente(),
    },
  });
  if (params.conBloqueo !== false) {
    await prisma.fechaBloqueada.create({
      data: {
        tenantId: TENANT,
        fecha: params.fecha,
        reservaId: reserva.idReserva,
        tipoBloqueo: TipoBloqueo.blando,
        ttlExpiracion: params.ttlBloqueo ?? ttlVigente(),
      },
    });
  }
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
  useCase = moduleRef.get(ProgramarVisitaUseCase);
});

afterAll(async () => {
  await limpiar();
  await moduleRef.close();
});

beforeEach(async () => {
  await limpiar();
});

// ===========================================================================
// 1. Dos transiciones simultáneas a 2.v sobre la MISMA RESERVA → exactamente UNA
//    aplica (2.v + campos de visita + bloqueo); la otra observa que ya no está en
//    {2a,2b,2c} y recibe la guarda de origen. Sin doble bloqueo.
//    (skill concurrency-locking: Promise.allSettled, 1 fulfilled + 1 rejected.)
// ===========================================================================

describe('Programar visita — D-9: dos simultáneas sobre la misma RESERVA aplican una sola vez', () => {
  it('debe_aplicar_exactamente_una_y_rechazar_la_otra_con_la_guarda_de_origen', async () => {
    const reservaId = await sembrarReserva({
      fecha: FECHA_DOBLE,
      subEstado: SubEstadoConsulta.s2b,
    });
    const visita = diaUtc(3);

    const resultados = await Promise.allSettled([
      useCase.ejecutar(comando(reservaId, visita)),
      useCase.ejecutar(comando(reservaId, visita)),
    ]);

    const cumplidas = resultados.filter((r) => r.status === 'fulfilled');
    const rechazadas = resultados.filter((r) => r.status === 'rejected');
    expect(cumplidas).toHaveLength(1);
    expect(rechazadas).toHaveLength(1);
    expect((rechazadas[0] as PromiseRejectedResult).reason).toBeInstanceOf(
      ProgramarVisitaValidacionError,
    );

    // Estado final coherente: RESERVA en 2.v y UNA sola fila de bloqueo con el TTL
    // de visita (no se duplicó ni se aplicó dos veces).
    const reserva = await prisma.reserva.findUnique({ where: { idReserva: reservaId } });
    expect(reserva?.subEstado).toBe(SubEstadoConsulta.s2v);

    const bloqueos = await prisma.fechaBloqueada.findMany({
      where: { tenantId: TENANT, fecha: FECHA_DOBLE },
    });
    expect(bloqueos).toHaveLength(1);
    expect(bloqueos[0].ttlExpiracion?.getTime()).toBe(ttlEsperado(visita));
  });
});

// ===========================================================================
// 2. Transición a 2.v concurrente con el BARRIDO A4 (US-012) sobre la misma RESERVA:
//    su ttl de 2.b acaba de vencer. Ambas se serializan por el lock de la fila
//    bloqueante. Estado final COHERENTE: o bien 2.v con FECHA_BLOQUEADA actualizada a
//    la fecha post-visita, o bien terminal (2.x) por el barrido + transición
//    rechazada. NUNCA 2.v sin bloqueo actualizado ni viceversa.
// ===========================================================================

describe('Programar visita — D-9: concurrente con el barrido A4 sobre la misma RESERVA', () => {
  it('debe_serializar_y_dejar_un_estado_final_coherente_sin_estado_intermedio', async () => {
    const reservaId = await sembrarReserva({
      fecha: FECHA_BARRIDO,
      subEstado: SubEstadoConsulta.s2b,
      ttlBloqueo: ttlVencido(), // el ttl de 2.b acaba de vencer
    });
    const visita = diaUtc(4);

    // Simulación del barrido A4 (US-012): una transacción que toma el MISMO lock de la
    // fila bloqueante (`SELECT … FOR UPDATE`) y, si el ttl está vencido, expira la
    // RESERVA a su terminal (2.x) liberando el bloqueo. Compite con la transición a 2.v.
    const barridoA4 = prisma.$transaction(async (tx) => {
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
      useCase.ejecutar(comando(reservaId, visita)),
      barridoA4,
    ]);

    // El barrido siempre commitea (no hay razón para que falle). La transición puede
    // ganar (2.v) o perder (guarda de origen porque la RESERVA ya está en 2.x).
    const reserva = await prisma.reserva.findUnique({ where: { idReserva: reservaId } });
    const bloqueos = await prisma.fechaBloqueada.findMany({
      where: { tenantId: TENANT, fecha: FECHA_BARRIDO },
    });

    const transicion = resultados[0];
    if (transicion.status === 'fulfilled') {
      // Ganó la transición: 2.v CON su fila de bloqueo actualizada a visita+1día.
      expect(reserva?.subEstado).toBe(SubEstadoConsulta.s2v);
      expect(bloqueos).toHaveLength(1);
      expect(bloqueos[0].ttlExpiracion?.getTime()).toBe(ttlEsperado(visita));
    } else {
      // Ganó el barrido: RESERVA en terminal 2.x y la transición recibió la guarda.
      expect(transicion.reason).toBeInstanceOf(ProgramarVisitaValidacionError);
      expect(reserva?.subEstado).toBe(SubEstadoConsulta.s2x);
      // Coherencia: NO queda 2.v sin bloqueo (no hay estado intermedio observable).
      expect(reserva?.subEstado).not.toBe(SubEstadoConsulta.s2v);
    }
  });
});

// ===========================================================================
// 3. INSERT desde 2.a concurrente con otro bloqueo de la MISMA fecha: el
//    UNIQUE(tenant_id, fecha) serializa. Una de las dos gana el INSERT; la otra se
//    reordena/resuelve sin duplicar la fila (exactamente 1 fila de FECHA_BLOQUEADA).
// ===========================================================================

describe('Programar visita — D-9: INSERT desde 2.a vs bloqueo concurrente de la misma fecha', () => {
  it('debe_serializar_por_el_UNIQUE_y_no_duplicar_la_fila_de_bloqueo', async () => {
    const reservaId = await sembrarReserva({
      fecha: FECHA_2A,
      subEstado: SubEstadoConsulta.s2a,
      conBloqueo: false,
    });
    const visita = diaUtc(5);

    // Otra RESERVA del tenant que intenta bloquear la MISMA fecha del evento a la vez.
    const otroCliente = await prisma.cliente.create({
      data: { tenantId: TENANT, nombre: 'Otra', email: `o-${sufijo()}${EMAIL_PATTERN}` },
    });
    const otraReserva = await prisma.reserva.create({
      data: {
        tenantId: TENANT,
        clienteId: otroCliente.idCliente,
        codigo: `TST-U008C-OTRA-${sufijo()}`,
        estado: EstadoReserva.consulta,
        subEstado: SubEstadoConsulta.s2a,
        canalEntrada: CanalEntrada.web,
        fechaEvento: FECHA_2A,
      },
    });

    const bloqueoConcurrente = prisma.$transaction(async (tx) => {
      await prisma.fijarTenant(tx, TENANT);
      await tx.fechaBloqueada.create({
        data: {
          tenantId: TENANT,
          fecha: FECHA_2A,
          reservaId: otraReserva.idReserva,
          tipoBloqueo: TipoBloqueo.blando,
          ttlExpiracion: ttlVigente(),
        },
      });
    });

    const resultados = await Promise.allSettled([
      useCase.ejecutar(comando(reservaId, visita)),
      bloqueoConcurrente,
    ]);

    // Exactamente UNA fila de FECHA_BLOQUEADA para esa (tenant, fecha): el UNIQUE no
    // se viola; el segundo intento colisiona y no duplica.
    const bloqueos = await prisma.fechaBloqueada.count({
      where: { tenantId: TENANT, fecha: FECHA_2A },
    });
    expect(bloqueos).toBe(1);

    // Al menos una de las dos operaciones fracasa (la que pierde el UNIQUE): no pueden
    // tener éxito ambas (no hay doble bloqueo de la misma fecha).
    const cumplidas = resultados.filter((r) => r.status === 'fulfilled');
    expect(cumplidas.length).toBeLessThanOrEqual(1);
  });
});
