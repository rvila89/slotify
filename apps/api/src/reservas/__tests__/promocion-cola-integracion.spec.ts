/**
 * TESTS DE INTEGRACIÓN de la PROMOCIÓN de cola (US-018 / UC-12, A15) — fase TDD RED.
 * tasks.md Fase 3: 3.2 (efecto real en BD), 3.4 (anomalía no contigua).
 *
 * Trazabilidad: US-018, spec-delta `consultas` (Requirements: promoción FIFO 2d→2b;
 * re-creación atómica del bloqueo blando vía `bloquearFecha()` con
 * `ttl = now()+ttl_consulta_dias`; reordenación FIFO del resto; cola de 1;
 * idempotencia guarda "ya promovida"; AUDIT_LOG por RESERVA con
 * `origen: promocion_automatica`; alerta interna al gestor SIN email/US-045;
 * anomalía no contigua audita+aborta); design.md §D-2/§D-3/§D-4/§D-5/§D-7/§D-8.
 *
 * Es un test de INTEGRACIÓN: ejercita el caso de uso REAL
 * (`PromoverPrimeroEnColaService`, resuelto del `ReservasModule`) contra el adaptador
 * Prisma real y el Postgres AISLADO de tests (`slotify_test`, `.env.test`; ver memoria
 * "Tests con BD aislada slotify_test"). La atomicidad NO usa Redis ni locks
 * distribuidos (regla del proyecto): se apoya en `SELECT … FOR UPDATE` +
 * `@@unique([tenantId, fecha])` (US-040). Reutiliza `bloquearFecha()` para el
 * re-bloqueo. Requiere el Postgres arriba + migración aplicada sobre `slotify_test`.
 *
 * DEUDA CONOCIDA: el test de concurrencia de US-004 tiene un deadlock 40P01 flaky
 * (memoria "US-004 concurrency test flaky"). Esta suite NO depende de él: usa fechas de
 * evento propias/aisladas y limpia su propio sembrado.
 *
 * RED: aún NO existen `application/promover-primero-en-cola.service.ts`, sus puertos,
 * ni el adaptador `infrastructure/promocion-cola.prisma.adapter.ts` (el binding del
 * módulo sigue apuntando al stub no-op). Los imports/símbolos fallan y toda la batería
 * está en ROJO por AUSENCIA DE IMPLEMENTACIÓN. GREEN es de `backend-developer`.
 */
import { Test, type TestingModule } from '@nestjs/testing';
import { ConfigModule } from '@nestjs/config';
import {
  AccionAudit,
  CanalEntrada,
  EstadoReserva,
  SubEstadoConsulta,
  TipoBloqueo,
} from '@prisma/client';
import { ReservasModule } from '../reservas.module';
import { PrismaService } from '../../shared/prisma/prisma.service';
import { PromoverPrimeroEnColaService } from '../application/promover-primero-en-cola.service';

const TENANT = '00000000-0000-0000-0000-000000000001';
const EMAIL_PATTERN = '@us018-int.test';

// Fechas de EVENTO aisladas por escenario (estrictamente futuras, no colisionan con
// otras suites ni con la flakiness de US-004).
const F_UNO = new Date('2029-06-01T00:00:00.000Z');
const F_TRES = new Date('2029-06-02T00:00:00.000Z');
const F_IDEMP = new Date('2029-06-03T00:00:00.000Z');
const F_ANOMALIA = new Date('2029-06-04T00:00:00.000Z');
const F_SIN_COLA = new Date('2029-06-05T00:00:00.000Z');
const TODAS = [F_UNO, F_TRES, F_IDEMP, F_ANOMALIA, F_SIN_COLA];

let moduleRef: TestingModule;
let prisma: PrismaService;
let promocion: PromoverPrimeroEnColaService;

const sufijo = (): string => Math.random().toString(36).slice(2, 8);

/**
 * Siembra el escenario típico: una bloqueante YA LIBERADA (su FECHA_BLOQUEADA fue
 * eliminada por `liberarFecha()`, la reserva bloqueante en 2x) + una cola de N
 * reservas en s2d apuntando a ella con posiciones 1..N. Devuelve los ids de la cola en
 * orden de posición.
 */
const sembrarColaSinBloqueo = async (params: {
  fecha: Date;
  n: number;
  posiciones?: number[];
}): Promise<{ bloqueanteId: string; colaIds: string[] }> => {
  const clienteBloq = await prisma.cliente.create({
    data: { tenantId: TENANT, nombre: 'Bloq', email: `b-${sufijo()}${EMAIL_PATTERN}` },
  });
  // Bloqueante ya EXPIRADA/liberada (2x) — su FECHA_BLOQUEADA no existe (fue liberada).
  const bloqueante = await prisma.reserva.create({
    data: {
      tenantId: TENANT,
      clienteId: clienteBloq.idCliente,
      codigo: `TST-U018I-B-${sufijo()}`,
      estado: EstadoReserva.consulta,
      subEstado: SubEstadoConsulta.s2x,
      canalEntrada: CanalEntrada.web,
      fechaEvento: params.fecha,
    },
  });
  const posiciones = params.posiciones ?? Array.from({ length: params.n }, (_, i) => i + 1);
  const colaIds: string[] = [];
  for (const pos of posiciones) {
    const cliente = await prisma.cliente.create({
      data: { tenantId: TENANT, nombre: 'Cola', email: `q-${sufijo()}${EMAIL_PATTERN}` },
    });
    const r = await prisma.reserva.create({
      data: {
        tenantId: TENANT,
        clienteId: cliente.idCliente,
        codigo: `TST-U018I-Q-${sufijo()}`,
        estado: EstadoReserva.consulta,
        subEstado: SubEstadoConsulta.s2d,
        canalEntrada: CanalEntrada.web,
        fechaEvento: params.fecha,
        consultaBloqueanteId: bloqueante.idReserva,
        posicionCola: pos,
      },
    });
    colaIds.push(r.idReserva);
  }
  return { bloqueanteId: bloqueante.idReserva, colaIds };
};

const contarBloqueos = (fecha: Date): Promise<number> =>
  prisma.fechaBloqueada.count({ where: { tenantId: TENANT, fecha } });

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
    // Romper la auto-referencia de cola antes de borrar (FK ColaEspera).
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
});

afterAll(async () => {
  await limpiar();
  await moduleRef.close();
});

beforeEach(async () => {
  await limpiar();
});

// ===========================================================================
// FA-01 — cola de UN elemento: promueve a 2b, re-crea FECHA_BLOQUEADA (blando,
//   ttl futuro), pone posicion_cola/consulta_bloqueante_id a NULL; cola vacía.
// ===========================================================================

describe('Promoción US-018 — cola de un elemento (FA-01)', () => {
  it('debe_promover_el_unico_a_2b_re_crear_el_bloqueo_y_vaciar_la_cola', async () => {
    const { colaIds } = await sembrarColaSinBloqueo({ fecha: F_UNO, n: 1 });
    const [r2] = colaIds;

    await promocion.promoverPrimeroEnCola({ tenantId: TENANT, fecha: F_UNO });

    const promovida = await prisma.reserva.findUnique({ where: { idReserva: r2 } });
    expect(promovida?.estado).toBe(EstadoReserva.consulta);
    expect(promovida?.subEstado).toBe(SubEstadoConsulta.s2b);
    expect(promovida?.posicionCola).toBeNull();
    expect(promovida?.consultaBloqueanteId).toBeNull();
    // TTL blando re-calculado como instante futuro (now()+ttl_consulta_dias).
    expect(promovida?.ttlExpiracion).not.toBeNull();
    expect(promovida?.ttlExpiracion?.getTime()).toBeGreaterThan(Date.now());

    // FECHA_BLOQUEADA re-creada apuntando a la promovida, tipo blando, ttl futuro.
    const bloqueos = await prisma.fechaBloqueada.findMany({
      where: { tenantId: TENANT, fecha: F_UNO },
    });
    expect(bloqueos).toHaveLength(1);
    expect(bloqueos[0].reservaId).toBe(r2);
    expect(bloqueos[0].tipoBloqueo).toBe(TipoBloqueo.blando);
    expect(bloqueos[0].ttlExpiracion?.getTime()).toBeGreaterThan(Date.now());

    // La cola queda vacía.
    const enCola = await prisma.reserva.count({
      where: { tenantId: TENANT, subEstado: SubEstadoConsulta.s2d, fechaEvento: F_UNO },
    });
    expect(enCola).toBe(0);
  });

  it('debe_registrar_AUDIT_LOG_transicion_con_origen_promocion_automatica_y_no_invocar_comunicaciones', async () => {
    const { colaIds } = await sembrarColaSinBloqueo({ fecha: F_UNO, n: 1 });
    const [r2] = colaIds;

    await promocion.promoverPrimeroEnCola({ tenantId: TENANT, fecha: F_UNO });

    const transiciones = await prisma.auditLog.findMany({
      where: { entidadId: r2, accion: AccionAudit.transicion, entidad: 'RESERVA' },
    });
    expect(transiciones.length).toBeGreaterThanOrEqual(1);
    const datosNuevos = transiciones[0].datosNuevos as Record<string, unknown> | null;
    expect(datosNuevos?.subEstado).toBe('2b');
    expect(datosNuevos?.origen).toBe('promocion_automatica');

    // Alerta interna al gestor (D-5), SIN email al cliente: no se crea COMUNICACION.
    const comunicaciones = await prisma.comunicacion.count({ where: { reservaId: r2 } });
    expect(comunicaciones).toBe(0);
  });
});

// ===========================================================================
// FA-03 — cola de MÁS de dos: promueve R2, reordena R3→1 / R4→2 re-apuntando a R2;
//   AUDIT_LOG por cada RESERVA modificada; FECHA_BLOQUEADA → R2.
// ===========================================================================

describe('Promoción US-018 — cola de más de dos reordena (FA-03)', () => {
  it('debe_promover_el_primero_reordenar_el_resto_y_re_apuntar_a_la_nueva_bloqueante', async () => {
    const { colaIds } = await sembrarColaSinBloqueo({ fecha: F_TRES, n: 3 });
    const [r2, r3, r4] = colaIds;

    await promocion.promoverPrimeroEnCola({ tenantId: TENANT, fecha: F_TRES });

    const pr2 = await prisma.reserva.findUnique({ where: { idReserva: r2 } });
    const pr3 = await prisma.reserva.findUnique({ where: { idReserva: r3 } });
    const pr4 = await prisma.reserva.findUnique({ where: { idReserva: r4 } });

    expect(pr2?.subEstado).toBe(SubEstadoConsulta.s2b);
    expect(pr2?.posicionCola).toBeNull();
    expect(pr2?.consultaBloqueanteId).toBeNull();

    expect(pr3?.subEstado).toBe(SubEstadoConsulta.s2d);
    expect(pr3?.posicionCola).toBe(1);
    expect(pr3?.consultaBloqueanteId).toBe(r2);

    expect(pr4?.subEstado).toBe(SubEstadoConsulta.s2d);
    expect(pr4?.posicionCola).toBe(2);
    expect(pr4?.consultaBloqueanteId).toBe(r2);

    const bloqueos = await prisma.fechaBloqueada.findMany({
      where: { tenantId: TENANT, fecha: F_TRES },
    });
    expect(bloqueos).toHaveLength(1);
    expect(bloqueos[0].reservaId).toBe(r2);

    // AUDIT_LOG por cada RESERVA modificada (R2, R3, R4).
    for (const id of [r2, r3, r4]) {
      const audits = await prisma.auditLog.count({
        where: { entidadId: id, accion: AccionAudit.transicion, entidad: 'RESERVA' },
      });
      expect(audits).toBeGreaterThanOrEqual(1);
    }
  });
});

// ===========================================================================
// FA-04 — idempotencia: 2ª pasada sobre una fecha ya promovida no duplica nada
//   (guarda "ya promovida"). Sin doble decremento, sin AUDIT_LOG duplicado, sin
//   doble alerta.
// ===========================================================================

describe('Promoción US-018 — idempotencia (guarda "ya promovida", FA-04)', () => {
  it('la_segunda_pasada_no_cambia_nada_ni_duplica_auditorias', async () => {
    const { colaIds } = await sembrarColaSinBloqueo({ fecha: F_IDEMP, n: 2 });
    const [r2, r3] = colaIds;

    await promocion.promoverPrimeroEnCola({ tenantId: TENANT, fecha: F_IDEMP });
    const auditsTras1 = await prisma.auditLog.count({
      where: { entidadId: { in: [r2, r3] } },
    });

    await promocion.promoverPrimeroEnCola({ tenantId: TENANT, fecha: F_IDEMP });
    const auditsTras2 = await prisma.auditLog.count({
      where: { entidadId: { in: [r2, r3] } },
    });

    // Estado estable tras la 2ª pasada.
    const pr2 = await prisma.reserva.findUnique({ where: { idReserva: r2 } });
    const pr3 = await prisma.reserva.findUnique({ where: { idReserva: r3 } });
    expect(pr2?.subEstado).toBe(SubEstadoConsulta.s2b);
    expect(pr3?.posicionCola).toBe(1); // decremento aplicado UNA sola vez.
    // Sin doble bloqueo.
    expect(await contarBloqueos(F_IDEMP)).toBe(1);
    // Sin auditorías duplicadas.
    expect(auditsTras2).toBe(auditsTras1);
  });
});

// ===========================================================================
// Anomalía de posiciones NO contiguas: audita la inconsistencia y aborta sin
//   promover (sin corrección silenciosa). tasks.md 3.4.
// ===========================================================================

describe('Promoción US-018 — anomalía de posiciones no contiguas', () => {
  it('debe_auditar_y_abortar_sin_promover_cuando_las_posiciones_no_son_contiguas', async () => {
    // Cola con hueco: posiciones 1 y 3 (falta 2).
    const { colaIds } = await sembrarColaSinBloqueo({
      fecha: F_ANOMALIA,
      n: 2,
      posiciones: [1, 3],
    });
    const [r_pos1, r_pos3] = colaIds;

    await promocion.promoverPrimeroEnCola({ tenantId: TENANT, fecha: F_ANOMALIA });

    // NO promueve: la cola queda intacta (todos en 2d, sin corregir posiciones).
    const pr1 = await prisma.reserva.findUnique({ where: { idReserva: r_pos1 } });
    const pr3 = await prisma.reserva.findUnique({ where: { idReserva: r_pos3 } });
    expect(pr1?.subEstado).toBe(SubEstadoConsulta.s2d);
    expect(pr1?.posicionCola).toBe(1);
    expect(pr3?.subEstado).toBe(SubEstadoConsulta.s2d);
    expect(pr3?.posicionCola).toBe(3); // NO se corrige silenciosamente a 2.
    // No se re-bloquea la fecha.
    expect(await contarBloqueos(F_ANOMALIA)).toBe(0);

    // Se registra la anomalía en AUDIT_LOG (alguna entrada de la fecha/tenant).
    const anomalias = await prisma.auditLog.count({
      where: { tenantId: TENANT, entidadId: { in: [r_pos1, r_pos3] } },
    });
    expect(anomalias).toBeGreaterThanOrEqual(1);
  });
});

// ===========================================================================
// FA-02 — sin cola: no-op sin error (idempotencia defensiva). No re-bloquea.
// ===========================================================================

describe('Promoción US-018 — sin cola es no-op sin error (FA-02)', () => {
  it('no_debe_re_bloquear_ni_fallar_cuando_no_hay_candidato_en_cola', async () => {
    // Bloqueante liberada sin nadie en cola.
    const clienteBloq = await prisma.cliente.create({
      data: { tenantId: TENANT, nombre: 'Bloq', email: `b-${sufijo()}${EMAIL_PATTERN}` },
    });
    await prisma.reserva.create({
      data: {
        tenantId: TENANT,
        clienteId: clienteBloq.idCliente,
        codigo: `TST-U018I-B-${sufijo()}`,
        estado: EstadoReserva.consulta,
        subEstado: SubEstadoConsulta.s2x,
        canalEntrada: CanalEntrada.web,
        fechaEvento: F_SIN_COLA,
      },
    });

    await expect(
      promocion.promoverPrimeroEnCola({ tenantId: TENANT, fecha: F_SIN_COLA }),
    ).resolves.toBeDefined();

    expect(await contarBloqueos(F_SIN_COLA)).toBe(0);
  });
});
