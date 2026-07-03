/**
 * TESTS DE CONCURRENCIA REALES de la transición «resultado de visita — reserva
 * inmediata» (`2.v` → `pre_reserva`) (US-010 / UC-08 FA-08 / UC-14) — fase TDD RED.
 * tasks.md Fase 3: 3.6. ZONA CRÍTICA (serialización por `SELECT … FOR UPDATE` sobre la
 * fila bloqueante de FECHA_BLOQUEADA + `UNIQUE(tenant_id, fecha)`, design.md §D-3/§D-5).
 *
 * Trazabilidad: US-010, spec-delta `consultas` (Requirement "Concurrencia — la
 * transición 2.v → pre_reserva es atómica frente a doble bloqueo (D4) y a mutaciones de
 * la cola", escenarios "Doble bloqueo de la misma fecha (D4) — solo una fila sobrevive",
 * "Vaciado de cola concurrente con mutación de posicion_cola — sin estado inconsistente";
 * también "dos reserva_inmediata simultáneas → exactamente una aplica"). CLAUDE.md
 * §Testing / §Regla crítica (la exclusión mutua vive SOLO en PostgreSQL; nada de
 * Redis/locks distribuidos). skill `concurrency-locking`: `Promise.allSettled()`.
 *
 * INTEGRACIÓN con TRANSACCIONES REALES contra el Postgres del docker-compose /
 * slotify_test (no mocks). Mismo enfoque que `resultado-visita-interesado-concurrencia.spec.ts`
 * (US-009) y `activar-prereserva-concurrencia.spec.ts` (US-014). Requiere
 * `docker compose up -d postgres` + migración + seed.
 *
 * RED: hoy `registrar-resultado-visita.use-case.ts` RECHAZA `reserva_inmediata` con 422;
 * la transición a pre_reserva + vaciado de cola no existe. La batería está en ROJO por
 * AUSENCIA DE IMPLEMENTACIÓN (no por infraestructura: el Postgres está arriba). GREEN es
 * de `backend-developer`.
 */
import { Test, type TestingModule } from '@nestjs/testing';
import { ConfigModule } from '@nestjs/config';
import {
  CanalEntrada,
  DuracionHoras,
  EstadoReserva,
  SubEstadoConsulta,
  TipoBloqueo,
  TipoEvento,
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
const EMAIL_PATTERN = '@us010-conc.test';
const DIA_MS = 24 * 60 * 60 * 1000;

// Fechas de EVENTO (a bloquear) estrictamente futuras y aisladas.
const FECHA_DOBLE = new Date('2028-12-20T00:00:00.000Z');
const FECHA_D4 = new Date('2028-12-21T00:00:00.000Z');
const FECHA_COLA = new Date('2028-12-22T00:00:00.000Z');
const FECHAS = [FECHA_DOBLE, FECHA_D4, FECHA_COLA];

const ttlVigente = (): Date => new Date(Date.now() + 30 * DIA_MS);

let moduleRef: TestingModule;
let prisma: PrismaService;
let useCase: RegistrarResultadoVisitaUseCase;

const sufijo = (): string => Math.random().toString(36).slice(2, 8);

const comando = (reservaId: string): RegistrarResultadoVisitaComando => ({
  tenantId: TENANT,
  usuarioId: GESTOR,
  reservaId,
  resultado: 'reserva_inmediata',
});

/** Siembra una RESERVA en `2v` fiscalmente completa con su FECHA_BLOQUEADA. */
const sembrarReserva = async (params: { fecha: Date }): Promise<string> => {
  const cliente = await prisma.cliente.create({
    data: {
      tenantId: TENANT,
      nombre: 'Conc',
      email: `c-${sufijo()}${EMAIL_PATTERN}`,
      dniNif: '12345678Z',
      direccion: 'C/ Mayor 1',
      codigoPostal: '08001',
      poblacion: 'Barcelona',
      provincia: 'Barcelona',
    },
  });
  const ttl = ttlVigente();
  const reserva = await prisma.reserva.create({
    data: {
      tenantId: TENANT,
      clienteId: cliente.idCliente,
      codigo: `TST-U010C-${sufijo()}`,
      estado: EstadoReserva.consulta,
      subEstado: SubEstadoConsulta.s2v,
      canalEntrada: CanalEntrada.web,
      fechaEvento: params.fecha,
      duracionHoras: DuracionHoras.h8,
      tipoEvento: TipoEvento.boda,
      numAdultosNinosMayores4: 40,
      numNinosMenores4: 5,
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

/** Siembra N consultas en cola (2.d) apuntando a la bloqueante indicada. */
const sembrarCola = async (params: {
  fecha: Date;
  bloqueanteId: string;
  cantidad: number;
}): Promise<string[]> => {
  const ids: string[] = [];
  for (let i = 1; i <= params.cantidad; i += 1) {
    const cliente = await prisma.cliente.create({
      data: { tenantId: TENANT, nombre: `Cola${i}`, email: `q-${sufijo()}${EMAIL_PATTERN}` },
    });
    const enCola = await prisma.reserva.create({
      data: {
        tenantId: TENANT,
        clienteId: cliente.idCliente,
        codigo: `TST-U010QC-${sufijo()}`,
        estado: EstadoReserva.consulta,
        subEstado: SubEstadoConsulta.s2d,
        canalEntrada: CanalEntrada.web,
        fechaEvento: params.fecha,
        posicionCola: i,
        consultaBloqueanteId: params.bloqueanteId,
      },
    });
    ids.push(enCola.idReserva);
  }
  return ids;
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
// (c) Dos "reserva_inmediata" simultáneas sobre la MISMA RESERVA en 2.v → exactamente
//      UNA aplica (pre_reserva + FECHA_BLOQUEADA a 7d); la otra observa que ya no está
//      en 2.v y recibe la guarda de origen. Sin doble mutación del bloqueo.
//      (skill concurrency-locking: Promise.allSettled, 1 fulfilled + 1 rejected.)
// ===========================================================================

describe('Reserva inmediata — dos transiciones simultáneas aplican una sola vez', () => {
  it('debe_aplicar_exactamente_una_y_rechazar_la_otra_con_la_guarda_de_origen', async () => {
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

    // Estado final coherente: pre_reserva, subEstado NULL y UNA sola fila de bloqueo.
    const reserva = await prisma.reserva.findUnique({ where: { idReserva: reservaId } });
    expect(reserva?.estado).toBe(EstadoReserva.pre_reserva);
    expect(reserva?.subEstado).toBeNull();

    const bloqueos = await prisma.fechaBloqueada.findMany({
      where: { tenantId: TENANT, fecha: FECHA_DOBLE },
    });
    expect(bloqueos).toHaveLength(1);
    expect(bloqueos[0].tipoBloqueo).toBe(TipoBloqueo.blando);
    expect(bloqueos[0].ttlExpiracion?.getTime()).toBe(reserva?.ttlExpiracion?.getTime());
  });
});

// ===========================================================================
// (a) D4 — mientras la transición corre, otra tx intenta INSERTAR un bloqueo NUEVO para
//      la MISMA (tenant_id, fecha_evento): el UNIQUE(tenant_id, fecha) garantiza una sola
//      fila; la insertadora recibe violación de unicidad. No hay doble bloqueo.
// ===========================================================================

describe('Reserva inmediata — D4 doble bloqueo de la misma fecha (solo una fila sobrevive)', () => {
  it('debe_impedir_el_segundo_bloqueo_de_la_misma_fecha_por_UNIQUE_tenant_fecha', async () => {
    const reservaId = await sembrarReserva({ fecha: FECHA_D4 });

    // Nuevo lead que intenta insertar un bloqueo para la MISMA (tenant, fecha).
    const clienteRival = await prisma.cliente.create({
      data: { tenantId: TENANT, nombre: 'Rival', email: `rv-${sufijo()}${EMAIL_PATTERN}` },
    });
    const reservaRival = await prisma.reserva.create({
      data: {
        tenantId: TENANT,
        clienteId: clienteRival.idCliente,
        codigo: `TST-U010R-${sufijo()}`,
        estado: EstadoReserva.consulta,
        subEstado: SubEstadoConsulta.s2a,
        canalEntrada: CanalEntrada.web,
        fechaEvento: FECHA_D4,
      },
    });

    const insertarBloqueoRival = prisma.fechaBloqueada.create({
      data: {
        tenantId: TENANT,
        fecha: FECHA_D4,
        reservaId: reservaRival.idReserva,
        tipoBloqueo: TipoBloqueo.blando,
        ttlExpiracion: ttlVigente(),
      },
    });

    const resultados = await Promise.allSettled([
      useCase.ejecutar(comando(reservaId)),
      insertarBloqueoRival,
    ]);

    // La transición aplica (la fila de bloqueo ya existía y es suya, UPDATE puro).
    expect(resultados[0].status).toBe('fulfilled');
    // El INSERT del rival choca con UNIQUE(tenant_id, fecha).
    expect(resultados[1].status).toBe('rejected');

    // Exactamente UNA fila de bloqueo para (tenant, fecha), la de la reserva transitada.
    const bloqueos = await prisma.fechaBloqueada.findMany({
      where: { tenantId: TENANT, fecha: FECHA_D4 },
    });
    expect(bloqueos).toHaveLength(1);
    expect(bloqueos[0].reservaId).toBe(reservaId);
  });
});

// ===========================================================================
// (b) Vaciado de cola vs mutación concurrente de posicion_cola: el SELECT … FOR UPDATE
//      sobre la fila bloqueante serializa ambas. Estado final coherente: ninguna 2.d
//      queda apuntando a una RESERVA ya en pre_reserva.
// ===========================================================================

describe('Reserva inmediata — vaciado de cola concurrente con mutación de posicion_cola', () => {
  it('debe_serializar_por_FOR_UPDATE_y_dejar_estado_coherente_sin_2d_colgando', async () => {
    const reservaId = await sembrarReserva({ fecha: FECHA_COLA });
    const idsCola = await sembrarCola({
      fecha: FECHA_COLA,
      bloqueanteId: reservaId,
      cantidad: 2,
    });

    // Mutación concurrente de posicion_cola de una consulta en 2.d de esa misma cola
    // (p. ej. una promoción/reordenación manual) que toma el MISMO lock de la fila
    // bloqueante antes de tocar la cola.
    const mutarPosicion = prisma.$transaction(async (tx) => {
      await prisma.fijarTenant(tx, TENANT);
      await tx.$queryRaw`
        SELECT id_bloqueo FROM fecha_bloqueada
        WHERE tenant_id = ${TENANT}::uuid
          AND fecha = ${FECHA_COLA.toISOString().slice(0, 10)}::date
        FOR UPDATE
      `;
      await tx.reserva.update({
        where: { idReserva: idsCola[0] },
        data: { posicionCola: 99 },
      });
    });

    const resultados = await Promise.allSettled([
      useCase.ejecutar(comando(reservaId)),
      mutarPosicion,
    ]);

    // La transición a pre_reserva aplica (el FOR UPDATE la serializa con la mutación).
    const transicion = resultados[0];
    expect(transicion.status).toBe('fulfilled');

    const reserva = await prisma.reserva.findUnique({ where: { idReserva: reservaId } });
    expect(reserva?.estado).toBe(EstadoReserva.pre_reserva);

    // Coherencia dura: NINGUNA RESERVA en 2.d apuntando a la ya-pre_reserva.
    const restantes2d = await prisma.reserva.count({
      where: {
        tenantId: TENANT,
        consultaBloqueanteId: reservaId,
        subEstado: SubEstadoConsulta.s2d,
      },
    });
    expect(restantes2d).toBe(0);

    // Las consultas de la cola quedaron en 2.y con el vínculo NULLeado, sin importar el
    // orden de commit (una de las dos tx esperó al lock).
    const cola = await prisma.reserva.findMany({ where: { idReserva: { in: idsCola } } });
    for (const c of cola) {
      expect(c.subEstado).toBe(SubEstadoConsulta.s2y);
      expect(c.consultaBloqueanteId).toBeNull();
      expect(c.posicionCola).toBeNull();
    }
  });
});
