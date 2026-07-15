/**
 * TESTS DE CONCURRENCIA REALES [requires-real-db] del descarte por cliente → 2.z
 * (US-013 / UC-10 / A17) — fase TDD RED. tasks.md §"TDD primero (RED)": tests de
 * concurrencia del bloqueo (RC-1/RC-2/RC-3). ZONA CRÍTICA (serialización commit-first
 * por `SELECT … FOR UPDATE` sobre la fila de FECHA_BLOQUEADA y/o la RESERVA; design.md
 * §D-3, sin Redis ni locks distribuidos).
 *
 * Trazabilidad: US-013 §RC-1/§RC-2/§RC-3; spec-delta `consultas` (Requirement
 * "Concurrencia — descarte vs barrido de TTL, doble descarte y re-bloqueo de fecha",
 * escenarios RC-1/RC-2/RC-3). CLAUDE.md §Testing / §Regla crítica (la exclusión mutua
 * vive SOLO en PostgreSQL). Las llamadas concurrentes se lanzan con
 * `Promise.allSettled()` (skill `concurrency-locking`): 1 gana + 1 pierde.
 *
 * ==========================================================================
 * ATENCIÓN — [requires-real-db]: ESTA SUITE REQUIERE POSTGRES REAL.
 * Los subagentes (tdd-engineer / qa-verifier) corren SIN Docker/Postgres, así que esta
 * batería NO puede verificarse en RED aquí: su RED real (import inexistente →
 * compilación falla estando el Postgres arriba) se valida desde la SESIÓN PRINCIPAL con
 * `docker compose up -d postgres` + migración + seed. Está separada por nombre
 * (`…-concurrencia.spec.ts`) y por el marcador `[requires-real-db]` en el describe.
 * ==========================================================================
 *
 * Mismo enfoque que `resultado-visita-interesado-concurrencia.spec.ts` (US-009) y
 * `programar-visita-concurrencia.spec.ts` (US-008): transacciones reales contra el
 * Postgres de `slotify_test`, sin mocks.
 *
 * RED: aún NO existe `application/descartar-consulta-por-cliente.use-case.ts`. El import
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
  DescartarConsultaPorClienteUseCase,
  DescarteEstadoTerminalError,
  type DescartarConsultaComando,
} from '../application/descartar-consulta-por-cliente.use-case';

const TENANT = '00000000-0000-0000-0000-000000000001';
const GESTOR = '00000000-0000-0000-0000-000000000002';
const EMAIL_PATTERN = '@us013-conc.test';
const DIA_MS = 24 * 60 * 60 * 1000;

// Fechas de EVENTO (a bloquear) estrictamente futuras y aisladas por escenario.
const FECHA_RC1 = new Date('2027-11-10T00:00:00.000Z'); // descarte vs barrido TTL
const FECHA_RC2 = new Date('2027-11-11T00:00:00.000Z'); // liberación vs nuevo bloqueo
const FECHA_RC3 = new Date('2027-11-12T00:00:00.000Z'); // doble descarte concurrente
const FECHAS = [FECHA_RC1, FECHA_RC2, FECHA_RC3];

const ttlVigente = (): Date => new Date(Date.now() + 30 * DIA_MS);
const ttlVencido = (): Date => new Date(Date.now() - DIA_MS);
const sufijo = (): string => Math.random().toString(36).slice(2, 8);

let moduleRef: TestingModule;
let prisma: PrismaService;
let useCase: DescartarConsultaPorClienteUseCase;

const comando = (reservaId: string): DescartarConsultaComando => ({
  tenantId: TENANT,
  usuarioId: GESTOR,
  reservaId,
});

/** Siembra una RESERVA en `2b` con su FECHA_BLOQUEADA blanda (bloqueante viva, sin cola). */
const sembrarReserva2b = async (params: {
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
      codigo: `TST-U013C-${sufijo()}`,
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
  useCase = moduleRef.get(DescartarConsultaPorClienteUseCase);
});

afterAll(async () => {
  await limpiar();
  await moduleRef.close();
});

beforeEach(async () => {
  await limpiar();
});

// ===========================================================================
// RC-1 [requires-real-db] — descarte vs barrido de TTL (US-012) sobre la MISMA RESERVA
// cuyo `ttl_expiracion` acaba de vencer. Ambas transacciones se serializan por el lock
// de la fila bloqueante. Estado final COHERENTE: 2.z XOR 2.x — nunca ambos ni un estado
// intermedio. La perdedora observa la RESERVA fuera de sub-estado activo bajo el lock y
// no actúa (el descarte perdedor recibe la guarda de origen → DescarteEstadoTerminalError).
//   spec-delta: "RC-1 — descarte vs expiración TTL nunca deja doble estado".
// ===========================================================================

describe('[requires-real-db] Descarte por cliente — RC-1 descarte vs barrido TTL', () => {
  it('debe_terminar_en_2z_XOR_2x_sin_estado_intermedio', async () => {
    const reservaId = await sembrarReserva2b({
      fecha: FECHA_RC1,
      ttlBloqueo: ttlVencido(), // el ttl acaba de vencer: el barrido la expiraría a 2x
    });

    // Simulación del barrido de TTL de US-012: transacción que toma el MISMO lock de la
    // fila bloqueante (`SELECT … FOR UPDATE`) y, si el ttl venció, expira la RESERVA a 2x
    // liberando el bloqueo. Compite con el descarte.
    const barridoTtl = prisma.$transaction(async (tx) => {
      await prisma.fijarTenant(tx, TENANT);
      await tx.$queryRaw`
        SELECT id_bloqueo FROM fecha_bloqueada
        WHERE tenant_id = ${TENANT}::uuid
          AND fecha = ${FECHA_RC1.toISOString().slice(0, 10)}::date
        FOR UPDATE
      `;
      await tx.reserva.update({
        where: { idReserva: reservaId },
        data: { subEstado: SubEstadoConsulta.s2x, ttlExpiracion: null },
      });
      await tx.fechaBloqueada.deleteMany({
        where: { tenantId: TENANT, fecha: FECHA_RC1 },
      });
    });

    const resultados = await Promise.allSettled([
      useCase.ejecutar(comando(reservaId)),
      barridoTtl,
    ]);

    const reserva = await prisma.reserva.findUnique({ where: { idReserva: reservaId } });
    const bloqueos = await prisma.fechaBloqueada.findMany({
      where: { tenantId: TENANT, fecha: FECHA_RC1 },
    });

    const descarte = resultados[0];
    if (descarte.status === 'fulfilled') {
      // Ganó el descarte: RESERVA en 2.z terminal y su fila de bloqueo liberada.
      expect(reserva?.subEstado).toBe(SubEstadoConsulta.s2z);
      expect(bloqueos).toHaveLength(0);
    } else {
      // Ganó el barrido: RESERVA en 2.x y el descarte recibió la guarda de origen (409).
      expect(descarte.reason).toBeInstanceOf(DescarteEstadoTerminalError);
      expect(reserva?.subEstado).toBe(SubEstadoConsulta.s2x);
    }
    // NUNCA queda 2.z con bloqueo activo apuntándola (sin estado intermedio observable).
    if (reserva?.subEstado === SubEstadoConsulta.s2z) {
      expect(bloqueos).toHaveLength(0);
    }
    // Coherencia terminal exclusiva: exactamente uno de los dos terminales.
    expect([SubEstadoConsulta.s2z, SubEstadoConsulta.s2x]).toContain(reserva?.subEstado);
  });
});

// ===========================================================================
// RC-2 [requires-real-db] — liberación de FECHA_BLOQUEADA por descarte vs nuevo bloqueo
// de la misma (tenant_id, fecha). La `UNIQUE(tenant_id, fecha)` impide dos bloqueos
// activos: el descarte elimina la fila dentro de su transacción y solo DESPUÉS puede
// insertarse la nueva. Nunca coexisten dos filas para la misma fecha.
//   spec-delta: "RC-2 — liberación vs nuevo bloqueo no produce doble bloqueo".
// ===========================================================================

describe('[requires-real-db] Descarte por cliente — RC-2 liberación vs nuevo bloqueo (UNIQUE)', () => {
  it('no_debe_coexistir_dos_filas_de_FECHA_BLOQUEADA_para_la_misma_fecha', async () => {
    const reservaId = await sembrarReserva2b({ fecha: FECHA_RC2 });

    // Nuevo lead que intenta bloquear la MISMA fecha concurrentemente. Con la fila previa
    // aún presente, su INSERT viola `UNIQUE(tenant_id, fecha)` (P2002) y falla; solo tras
    // el commit del descarte (que borra la fila) podría insertarse. Se lanza en paralelo.
    const nuevoBloqueo = prisma.$transaction(async (tx) => {
      await prisma.fijarTenant(tx, TENANT);
      const cliente = await tx.cliente.create({
        data: { tenantId: TENANT, nombre: 'Nuevo', email: `n-${sufijo()}${EMAIL_PATTERN}` },
      });
      const nueva = await tx.reserva.create({
        data: {
          tenantId: TENANT,
          clienteId: cliente.idCliente,
          codigo: `TST-U013C-${sufijo()}`,
          estado: EstadoReserva.consulta,
          subEstado: SubEstadoConsulta.s2b,
          canalEntrada: CanalEntrada.web,
          fechaEvento: FECHA_RC2,
          ttlExpiracion: ttlVigente(),
        },
      });
      await tx.fechaBloqueada.create({
        data: {
          tenantId: TENANT,
          fecha: FECHA_RC2,
          reservaId: nueva.idReserva,
          tipoBloqueo: TipoBloqueo.blando,
          ttlExpiracion: ttlVigente(),
        },
      });
    });

    await Promise.allSettled([useCase.ejecutar(comando(reservaId)), nuevoBloqueo]);

    // INVARIANTE DURA: como mucho UNA fila activa de FECHA_BLOQUEADA para (tenant, fecha).
    const bloqueos = await prisma.fechaBloqueada.findMany({
      where: { tenantId: TENANT, fecha: FECHA_RC2 },
    });
    expect(bloqueos.length).toBeLessThanOrEqual(1);
  });
});

// ===========================================================================
// RC-3 [requires-real-db] — dos gestores descartan la MISMA RESERVA a la vez. La primera
// transacción la pasa a 2.z; la segunda relee bajo el lock, observa 2.z (terminal) y
// recibe un error controlado (`DescarteEstadoTerminalError`), sin doble transición, sin
// doble AUDIT_LOG ni doble liberación.
//   spec-delta: "RC-3 — doble descarte concurrente: el segundo recibe error controlado".
// ===========================================================================

describe('[requires-real-db] Descarte por cliente — RC-3 doble descarte concurrente', () => {
  it('debe_aplicar_exactamente_uno_y_rechazar_el_otro_con_error_terminal', async () => {
    const reservaId = await sembrarReserva2b({ fecha: FECHA_RC3 });

    const resultados = await Promise.allSettled([
      useCase.ejecutar(comando(reservaId)),
      useCase.ejecutar(comando(reservaId)),
    ]);

    const cumplidas = resultados.filter((r) => r.status === 'fulfilled');
    const rechazadas = resultados.filter((r) => r.status === 'rejected');
    expect(cumplidas).toHaveLength(1);
    expect(rechazadas).toHaveLength(1);
    expect((rechazadas[0] as PromiseRejectedResult).reason).toBeInstanceOf(
      DescarteEstadoTerminalError,
    );

    // Estado final coherente: RESERVA en 2.z terminal, sin bloqueo activo (una sola
    // liberación) y con UN solo AUDIT_LOG de la transición de descarte.
    const reserva = await prisma.reserva.findUnique({ where: { idReserva: reservaId } });
    expect(reserva?.subEstado).toBe(SubEstadoConsulta.s2z);

    const bloqueos = await prisma.fechaBloqueada.findMany({
      where: { tenantId: TENANT, fecha: FECHA_RC3 },
    });
    expect(bloqueos).toHaveLength(0);

    const transiciones = await prisma.auditLog.findMany({
      where: { entidadId: reservaId, accion: 'transicion', entidad: 'RESERVA' },
    });
    expect(transiciones).toHaveLength(1);
  });
});
