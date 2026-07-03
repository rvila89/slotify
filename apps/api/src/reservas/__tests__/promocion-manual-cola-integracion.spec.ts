/**
 * TESTS DE INTEGRACIÓN de la PROMOCIÓN MANUAL de cola (US-019 / UC-12 FA manual) —
 * fase TDD RED. tasks.md Fase 3: 3.2 (efecto real en BD), 3.4 (atomicidad
 * all-or-nothing), multi-tenancy/RLS.
 *
 * Trazabilidad: US-019, spec-delta `consultas` (Requirements: expiración forzosa de la
 * bloqueante a 2x `ttl_expiracion → NULL`; promoción de la elegida a 2b con
 * `ttl = now()+ttl_consulta_dias` derivado del setting; re-asignación de la fila de
 * FECHA_BLOQUEADA a la promovida — una sola fila activa por (tenant,fecha);
 * reordenación por cierre de hueco; AUDIT_LOG por RESERVA con `origen: promocion_manual`
 * + el `usuario_id` del Gestor; all-or-nothing sin estado intermedio observable;
 * multi-tenancy: no se promueve una reserva de otro tenant); design.md
 * §D-2/§D-3/§D-4/§D-5/§D-7.
 *
 * Es un test de INTEGRACIÓN: ejercita el caso de uso REAL
 * (`PromoverManualEnColaService`, resuelto del `ReservasModule`) contra el adaptador
 * Prisma real y el Postgres AISLADO de tests (`slotify_test`, `.env.test`; memoria
 * "Tests con BD aislada slotify_test"). La atomicidad NO usa Redis ni locks
 * distribuidos: se apoya en `SELECT … FOR UPDATE` sobre FECHA_BLOQUEADA +
 * `@@unique([tenantId, fecha])` (US-040), reutilizando `bloquearFecha()` para el
 * re-bloqueo/reasignación. Requiere Postgres arriba + migración sobre `slotify_test`.
 *
 * DEUDA CONOCIDA: el test de concurrencia de US-004 tiene un deadlock 40P01 flaky
 * (memoria). Esta suite NO depende de él: usa fechas propias/aisladas y limpia su
 * propio sembrado.
 *
 * RED: aún NO existen `application/promover-manual-en-cola.service.ts`, sus puertos ni
 * el adaptador Prisma; el binding del módulo aún no los provee. Los imports/símbolos
 * fallan y toda la batería está en ROJO por AUSENCIA DE IMPLEMENTACIÓN. GREEN es de
 * `backend-developer`.
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
  PromoverManualEnColaService,
  PromocionManualConsultaNoEnColaError,
  PromocionManualReservaNoEncontradaError,
  PromocionManualSinBloqueoError,
} from '../application/promover-manual-en-cola.service';

const TENANT = '00000000-0000-0000-0000-000000000001';
const OTRO_TENANT = '00000000-0000-0000-0000-0000000000c9';
const GESTOR = '00000000-0000-0000-0000-0000000000a1';
const EMAIL_PATTERN = '@us019-int.test';
const DIA_MS = 24 * 60 * 60 * 1000;

// Fechas de EVENTO aisladas por escenario.
const F_INTERMEDIA = new Date('2029-08-10T00:00:00.000Z');
const F_UNO = new Date('2029-08-11T00:00:00.000Z');
const F_VENCIDA = new Date('2029-08-12T00:00:00.000Z');
const F_FA05 = new Date('2029-08-13T00:00:00.000Z');
const F_SIN_BLOQUEO = new Date('2029-08-14T00:00:00.000Z');
const F_TENANT = new Date('2029-08-15T00:00:00.000Z');
const TODAS = [F_INTERMEDIA, F_UNO, F_VENCIDA, F_FA05, F_SIN_BLOQUEO, F_TENANT];

let moduleRef: TestingModule;
let prisma: PrismaService;
let manual: PromoverManualEnColaService;

const sufijo = (): string => Math.random().toString(36).slice(2, 8);
const ttlVigente = (): Date => new Date(Date.now() + 3 * DIA_MS);
const ttlVencido = (): Date => new Date(Date.now() - DIA_MS);

/**
 * Siembra una fecha con bloqueante VIVA en `sub_estado` dado (default 2b) + FECHA_BLOQUEADA
 * existente + cola de N en s2d (posiciones 1..N) apuntando a la bloqueante. Devuelve
 * los ids en orden de posición.
 */
const sembrarBloqueanteVivaConCola = async (params: {
  fecha: Date;
  n: number;
  ttl?: Date;
  tenant?: string;
}): Promise<{ bloqueanteId: string; colaIds: string[] }> => {
  const tenant = params.tenant ?? TENANT;
  const ttl = params.ttl ?? ttlVigente();
  const clienteBloq = await prisma.cliente.create({
    data: { tenantId: tenant, nombre: 'Bloq', email: `b-${sufijo()}${EMAIL_PATTERN}` },
  });
  const bloqueante = await prisma.reserva.create({
    data: {
      tenantId: tenant,
      clienteId: clienteBloq.idCliente,
      codigo: `TST-U019I-B-${sufijo()}`,
      estado: EstadoReserva.consulta,
      subEstado: SubEstadoConsulta.s2b,
      canalEntrada: CanalEntrada.web,
      fechaEvento: params.fecha,
      ttlExpiracion: ttl,
    },
  });
  await prisma.fechaBloqueada.create({
    data: {
      tenantId: tenant,
      fecha: params.fecha,
      reservaId: bloqueante.idReserva,
      tipoBloqueo: TipoBloqueo.blando,
      ttlExpiracion: ttl,
    },
  });
  const colaIds: string[] = [];
  for (let i = 1; i <= params.n; i += 1) {
    const cliente = await prisma.cliente.create({
      data: { tenantId: tenant, nombre: 'Cola', email: `q-${sufijo()}${EMAIL_PATTERN}` },
    });
    const r = await prisma.reserva.create({
      data: {
        tenantId: tenant,
        clienteId: cliente.idCliente,
        codigo: `TST-U019I-Q-${sufijo()}`,
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
  await prisma.fechaBloqueada.deleteMany({ where: { fecha: { in: TODAS } } });
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
});

afterAll(async () => {
  await limpiar();
  await moduleRef.close();
});

beforeEach(async () => {
  await limpiar();
});

// ===========================================================================
// Happy path — promover una posición INTERMEDIA (R3, pos 2): expira R1 a 2x, promueve
// R3 a 2b, re-asigna FECHA_BLOQUEADA a R3, cierra el hueco (R2 conserva pos 1 y
// re-apunta a R3), audita cada RESERVA con `origen: promocion_manual` y el Gestor.
//   spec-delta: escenarios de promoción intermedia + expiración forzosa + reordenación.
// ===========================================================================

describe('Promoción manual US-019 — happy path promover posición intermedia', () => {
  it('debe_expirar_la_bloqueante_promover_la_elegida_reasignar_el_bloqueo_y_cerrar_el_hueco', async () => {
    const { bloqueanteId, colaIds } = await sembrarBloqueanteVivaConCola({
      fecha: F_INTERMEDIA,
      n: 2,
    });
    const [r2, r3] = colaIds;

    await manual.ejecutar({ tenantId: TENANT, usuarioId: GESTOR, reservaId: r3, confirmado: true });

    // R1 (bloqueante) → 2x, ttl NULL.
    const r1 = await prisma.reserva.findUnique({ where: { idReserva: bloqueanteId } });
    expect(r1?.subEstado).toBe(SubEstadoConsulta.s2x);
    expect(r1?.ttlExpiracion).toBeNull();

    // R3 (elegida) → 2b, fuera de la cola, con nuevo TTL vigente.
    const pr3 = await prisma.reserva.findUnique({ where: { idReserva: r3 } });
    expect(pr3?.subEstado).toBe(SubEstadoConsulta.s2b);
    expect(pr3?.posicionCola).toBeNull();
    expect(pr3?.consultaBloqueanteId).toBeNull();
    expect(pr3?.ttlExpiracion).not.toBeNull();
    expect(pr3?.ttlExpiracion?.getTime()).toBeGreaterThan(Date.now());

    // R2 conserva posición 1 (cierra el hueco) y re-apunta a la nueva bloqueante R3.
    const pr2 = await prisma.reserva.findUnique({ where: { idReserva: r2 } });
    expect(pr2?.subEstado).toBe(SubEstadoConsulta.s2d);
    expect(pr2?.posicionCola).toBe(1);
    expect(pr2?.consultaBloqueanteId).toBe(r3);

    // Una sola fila de FECHA_BLOQUEADA, ahora apuntando a R3.
    const bloqueos = await prisma.fechaBloqueada.findMany({
      where: { tenantId: TENANT, fecha: F_INTERMEDIA },
    });
    expect(bloqueos).toHaveLength(1);
    expect(bloqueos[0].reservaId).toBe(r3);
    expect(bloqueos[0].tipoBloqueo).toBe(TipoBloqueo.blando);
  });

  it('debe_auditar_cada_reserva_modificada_con_origen_promocion_manual_y_el_gestor', async () => {
    const { bloqueanteId, colaIds } = await sembrarBloqueanteVivaConCola({
      fecha: F_INTERMEDIA,
      n: 2,
    });
    const [r2, r3] = colaIds;

    await manual.ejecutar({ tenantId: TENANT, usuarioId: GESTOR, reservaId: r3, confirmado: true });

    const auditR3 = await prisma.auditLog.findMany({ where: { entidadId: r3 } });
    // La promovida deja rastro con el Gestor y `origen: promocion_manual`.
    expect(auditR3.length).toBeGreaterThanOrEqual(1);
    expect(auditR3.some((a) => a.usuarioId === GESTOR)).toBe(true);
    expect(
      auditR3.some((a) => JSON.stringify(a.datosNuevos ?? {}).includes('promocion_manual')),
    ).toBe(true);

    // La bloqueante expirada y la reordenada también dejan rastro con el Gestor.
    const auditR1 = await prisma.auditLog.findMany({ where: { entidadId: bloqueanteId } });
    expect(auditR1.some((a) => a.usuarioId === GESTOR)).toBe(true);
    const auditR2 = await prisma.auditLog.findMany({ where: { entidadId: r2 } });
    expect(auditR2.some((a) => a.usuarioId === GESTOR)).toBe(true);
  });

  it('no_debe_crear_ninguna_COMUNICACION_al_cliente_en_MVP_D6', async () => {
    const { colaIds } = await sembrarBloqueanteVivaConCola({ fecha: F_INTERMEDIA, n: 2 });
    const [, r3] = colaIds;

    await manual.ejecutar({ tenantId: TENANT, usuarioId: GESTOR, reservaId: r3, confirmado: true });

    const comunicaciones = await prisma.comunicacion.findMany({
      where: { reservaId: r3 },
    });
    expect(comunicaciones).toHaveLength(0);
  });
});

// ===========================================================================
// FA-01 — promover la PRIMERA (P=1): R2 → 2b; R3 decrementa a posición 1 re-apuntando
// a R2. Coincide con el decremento FIFO de US-018.
// ===========================================================================

describe('Promoción manual US-019 — FA-01 promover P=1', () => {
  it('debe_promover_la_primera_y_decrementar_al_resto', async () => {
    const { colaIds } = await sembrarBloqueanteVivaConCola({ fecha: F_UNO, n: 2 });
    const [r2, r3] = colaIds;

    await manual.ejecutar({ tenantId: TENANT, usuarioId: GESTOR, reservaId: r2, confirmado: true });

    const pr2 = await prisma.reserva.findUnique({ where: { idReserva: r2 } });
    expect(pr2?.subEstado).toBe(SubEstadoConsulta.s2b);

    const pr3 = await prisma.reserva.findUnique({ where: { idReserva: r3 } });
    expect(pr3?.posicionCola).toBe(1);
    expect(pr3?.consultaBloqueanteId).toBe(r2);
  });
});

// ===========================================================================
// FA-02 — bloqueante con TTL YA VENCIDO pero no barrida: la promoción manual la expira
// igualmente a 2x (la guarda de expiración forzosa admite TTL vigente O vencido).
//   spec-delta: "Bloqueante con TTL ya vencido pero no barrida — se expira igualmente".
// ===========================================================================

describe('Promoción manual US-019 — FA-02 bloqueante con TTL vencido no barrida', () => {
  it('debe_expirar_la_bloqueante_vencida_y_promover_igual', async () => {
    const { bloqueanteId, colaIds } = await sembrarBloqueanteVivaConCola({
      fecha: F_VENCIDA,
      n: 1,
      ttl: ttlVencido(),
    });
    const [r2] = colaIds;

    await manual.ejecutar({ tenantId: TENANT, usuarioId: GESTOR, reservaId: r2, confirmado: true });

    const r1 = await prisma.reserva.findUnique({ where: { idReserva: bloqueanteId } });
    expect(r1?.subEstado).toBe(SubEstadoConsulta.s2x);

    const pr2 = await prisma.reserva.findUnique({ where: { idReserva: r2 } });
    expect(pr2?.subEstado).toBe(SubEstadoConsulta.s2b);
  });
});

// ===========================================================================
// FA-03 — cola de UN elemento queda vacía: R1 → 2x; R2 → 2b; FECHA_BLOQUEADA → R2; la
// cola queda vacía.
//   spec-delta: "Cola de un único elemento queda vacía tras la promoción (FA-03)".
// ===========================================================================

describe('Promoción manual US-019 — FA-03 cola de un elemento queda vacía', () => {
  it('debe_promover_el_unico_y_dejar_la_cola_vacia', async () => {
    const { colaIds } = await sembrarBloqueanteVivaConCola({ fecha: F_UNO, n: 1 });
    const [r2] = colaIds;

    await manual.ejecutar({ tenantId: TENANT, usuarioId: GESTOR, reservaId: r2, confirmado: true });

    const pr2 = await prisma.reserva.findUnique({ where: { idReserva: r2 } });
    expect(pr2?.subEstado).toBe(SubEstadoConsulta.s2b);

    const enCola = await prisma.reserva.count({
      where: { tenantId: TENANT, fechaEvento: F_UNO, subEstado: SubEstadoConsulta.s2d },
    });
    expect(enCola).toBe(0);
  });
});

// ===========================================================================
// FA-05 — la RESERVA elegida ya NO está en 2.d (transitó a terminal): la promoción se
// rechaza SIN efectos (la bloqueante sigue viva, la cola intacta).
//   spec-delta: "Promover una consulta que ya no está en 2.d se rechaza sin efectos".
// ===========================================================================

describe('Promoción manual US-019 — FA-05 consulta ya no en 2.d se rechaza sin efectos', () => {
  it('debe_rechazar_y_no_modificar_nada_cuando_la_elegida_es_terminal', async () => {
    const { bloqueanteId, colaIds } = await sembrarBloqueanteVivaConCola({
      fecha: F_FA05,
      n: 2,
    });
    const [, r3] = colaIds;
    // R3 transita a terminal 2z ANTES de que el Gestor confirme (descarte por cliente).
    await prisma.reserva.update({
      where: { idReserva: r3 },
      data: { subEstado: SubEstadoConsulta.s2z, posicionCola: null, consultaBloqueanteId: null },
    });

    await expect(
      manual.ejecutar({ tenantId: TENANT, usuarioId: GESTOR, reservaId: r3, confirmado: true }),
    ).rejects.toBeInstanceOf(PromocionManualConsultaNoEnColaError);

    // Sin efectos: la bloqueante sigue viva en 2b y su bloqueo intacto.
    const r1 = await prisma.reserva.findUnique({ where: { idReserva: bloqueanteId } });
    expect(r1?.subEstado).toBe(SubEstadoConsulta.s2b);
    const bloqueos = await prisma.fechaBloqueada.count({
      where: { tenantId: TENANT, fecha: F_FA05 },
    });
    expect(bloqueos).toBe(1);
  });
});

// ===========================================================================
// Inconsistencia — sin FECHA_BLOQUEADA activa para la fecha (una consulta en 2.d sin
// fecha bloqueada): la promoción se rechaza sin modificar nada.
//   spec-delta: "Sin FECHA_BLOQUEADA para la fecha — la promoción se rechaza".
// ===========================================================================

describe('Promoción manual US-019 — sin FECHA_BLOQUEADA activa se rechaza', () => {
  it('debe_rechazar_cuando_la_fecha_de_la_elegida_no_tiene_bloqueo_activo', async () => {
    // Cola sembrada pero SIN fila de FECHA_BLOQUEADA (se elimina para simular inconsistencia).
    const { colaIds } = await sembrarBloqueanteVivaConCola({ fecha: F_SIN_BLOQUEO, n: 1 });
    const [r2] = colaIds;
    await prisma.fechaBloqueada.deleteMany({
      where: { tenantId: TENANT, fecha: F_SIN_BLOQUEO },
    });

    await expect(
      manual.ejecutar({ tenantId: TENANT, usuarioId: GESTOR, reservaId: r2, confirmado: true }),
    ).rejects.toBeInstanceOf(PromocionManualSinBloqueoError);

    const pr2 = await prisma.reserva.findUnique({ where: { idReserva: r2 } });
    expect(pr2?.subEstado).toBe(SubEstadoConsulta.s2d);
  });
});

// ===========================================================================
// Multi-tenancy / RLS (D-7) + H-1 (code-review US-019) — no se puede promover una
// RESERVA de OTRO tenant: el caso de uso resuelve el `reservaId` SIEMPRE dentro del
// tenant del JWT, así que una reserva de otro tenant NO es resoluble bajo RLS. El
// desenlace es `PromocionManualReservaNoEncontradaError` (→ 404), DISTINTO de FA-05
// "existe pero no en 2.d" (→ 422). Hoy el adaptador lanza
// `PromocionManualConsultaNoEnColaError` en ambos casos, así que este test está en ROJO.
//   spec-delta / design §D-7; contrato op `promoverConsultaCola` 404 "Reserva {id}
//   inexistente o de otro tenant (RLS)".
// ===========================================================================

describe('Promoción manual US-019 — multi-tenancy/RLS no promueve reserva de otro tenant', () => {
  it('debe_rechazar_como_no_encontrada_una_reserva_de_otro_tenant_sin_modificarla', async () => {
    // La cola pertenece a OTRO_TENANT; el Gestor autenticado es del TENANT por defecto.
    const { bloqueanteId, colaIds } = await sembrarBloqueanteVivaConCola({
      fecha: F_TENANT,
      n: 2,
      tenant: OTRO_TENANT,
    });
    const [, r3] = colaIds;

    // El Gestor de TENANT intenta promover una reserva de OTRO_TENANT: bajo RLS del JWT
    // la reserva no es resoluble → "no encontrada" (404), no FA-05, sin efectos.
    await expect(
      manual.ejecutar({ tenantId: TENANT, usuarioId: GESTOR, reservaId: r3, confirmado: true }),
    ).rejects.toBeInstanceOf(PromocionManualReservaNoEncontradaError);

    // La reserva de OTRO_TENANT y su bloqueante quedan intactas.
    const pr3 = await prisma.reserva.findUnique({ where: { idReserva: r3 } });
    expect(pr3?.subEstado).toBe(SubEstadoConsulta.s2d);
    const r1 = await prisma.reserva.findUnique({ where: { idReserva: bloqueanteId } });
    expect(r1?.subEstado).toBe(SubEstadoConsulta.s2b);
  });

  it('debe_rechazar_como_no_encontrada_una_reserva_inexistente', async () => {
    // No sembramos nada para este id: no resoluble bajo RLS → 404 (no 422 FA-05).
    await expect(
      manual.ejecutar({
        tenantId: TENANT,
        usuarioId: GESTOR,
        reservaId: 'reserva-inexistente-rls-0000',
        confirmado: true,
      }),
    ).rejects.toBeInstanceOf(PromocionManualReservaNoEncontradaError);
  });

  // El error de "no encontrada" NO debe ser instancia del de FA-05: garantiza que el
  // controller pueda distinguir 404 de 422 y no colapsen en un solo código.
  it('el_error_de_no_encontrada_no_es_instancia_del_error_de_FA05', async () => {
    await expect(
      manual.ejecutar({
        tenantId: TENANT,
        usuarioId: GESTOR,
        reservaId: 'reserva-inexistente-rls-0001',
        confirmado: true,
      }),
    ).rejects.not.toBeInstanceOf(PromocionManualConsultaNoEnColaError);
  });
});

// ===========================================================================
// Atomicidad all-or-nothing (§D-5): un fallo parcial revierte toda la promoción. Se
// fuerza el fallo pidiendo promover una reserva INEXISTENTE tras sembrar el escenario:
// nada debe cambiar (la bloqueante sigue viva, la cola intacta, el bloqueo intacto).
//   spec-delta: "Un fallo parcial revierte toda la promoción manual".
// ===========================================================================

describe('Promoción manual US-019 — atomicidad all-or-nothing ante fallo', () => {
  it('debe_dejar_el_escenario_intacto_cuando_la_operacion_falla', async () => {
    const { bloqueanteId, colaIds } = await sembrarBloqueanteVivaConCola({
      fecha: F_INTERMEDIA,
      n: 2,
    });
    const [r2, r3] = colaIds;

    await expect(
      manual.ejecutar({
        tenantId: TENANT,
        usuarioId: GESTOR,
        reservaId: 'reserva-inexistente-0000',
        confirmado: true,
      }),
    ).rejects.toBeDefined();

    // Estado INTACTO: R1 sigue bloqueante en 2b, R2/R3 siguen en cola, bloqueo intacto.
    const r1 = await prisma.reserva.findUnique({ where: { idReserva: bloqueanteId } });
    expect(r1?.subEstado).toBe(SubEstadoConsulta.s2b);
    const pr2 = await prisma.reserva.findUnique({ where: { idReserva: r2 } });
    expect(pr2?.posicionCola).toBe(1);
    const pr3 = await prisma.reserva.findUnique({ where: { idReserva: r3 } });
    expect(pr3?.posicionCola).toBe(2);
    const bloqueos = await prisma.fechaBloqueada.findMany({
      where: { tenantId: TENANT, fecha: F_INTERMEDIA },
    });
    expect(bloqueos).toHaveLength(1);
    expect(bloqueos[0].reservaId).toBe(bloqueanteId);
  });
});
