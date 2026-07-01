/**
 * TESTS DE INTEGRACIÓN del barrido de expiración por TTL (US-012 / UC-09) — fase
 * TDD RED. tasks.md Fase 3: 3.2, 3.4, 3.5, 3.6, 3.7, 3.8, 3.9.
 *
 * Trazabilidad: US-012, spec-delta `consultas` (Requirements: expiración 2.b/2.c/
 * 2.v/pre_reserva atómica con transición + `FECHA_BLOQUEADA` liberada + `AUDIT_LOG
 * accion='transicion'`; idempotencia; TTL extendido prevalece; selección por
 * instante; atomicidad por RESERVA + fallo aislado), design.md §D-3/§D-4/§D-6/§D-7/
 * §D-9. Reutiliza `liberarFecha()` (US-041) para la liberación + auditoría + seam.
 *
 * Es un test de INTEGRACIÓN: ejercita el caso de uso REAL contra el adaptador Prisma
 * de la UoW de expiración (`SELECT … FOR UPDATE` + `SET LOCAL app.tenant_id` +
 * transición + `liberarFecha()`) sobre el Postgres AISLADO de tests (`slotify_test`,
 * `.env.test`; ver memoria "Tests con BD aislada slotify_test"). La atomicidad NO usa
 * Redis ni locks distribuidos (regla del proyecto): se apoya en la transacción
 * serializada por el motor + `@@unique([tenantId, fecha])` (US-040). Requiere el
 * Postgres arriba + migración aplicada sobre `slotify_test`.
 *
 * RED: aún NO existen `application/expirar-consultas-vencidas.service.ts`, sus
 * puertos, ni el adaptador `infrastructure/expiracion-reserva-uow.prisma.adapter.ts`
 * ni el adaptador de candidatas; los imports/símbolos fallan y toda la batería está
 * en ROJO por AUSENCIA DE IMPLEMENTACIÓN. GREEN es de `backend-developer`.
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
import { ExpirarConsultasVencidasService } from '../application/expirar-consultas-vencidas.service';

const TENANT = '00000000-0000-0000-0000-000000000001';
const EMAIL_PATTERN = '@us012-int.test';
const DIA_MS = 24 * 60 * 60 * 1000;

// Fechas de EVENTO a bloquear, aisladas y estrictamente futuras (no colisionan con
// otras suites). Una por escenario para evitar UNIQUE(tenant, fecha) cruzado.
const F_2B = new Date('2028-03-01T00:00:00.000Z');
const F_2B_COLA = new Date('2028-03-02T00:00:00.000Z');
const F_2C = new Date('2028-03-03T00:00:00.000Z');
const F_2V = new Date('2028-03-04T00:00:00.000Z');
const F_2V_COLA = new Date('2028-03-05T00:00:00.000Z');
const F_PRE = new Date('2028-03-06T00:00:00.000Z');
const F_EXTENDIDO = new Date('2028-03-07T00:00:00.000Z');
const F_PARCIAL = new Date('2028-03-08T00:00:00.000Z');
const F_NO_CANDIDATA = new Date('2028-03-09T00:00:00.000Z');
const TODAS = [F_2B, F_2B_COLA, F_2C, F_2V, F_2V_COLA, F_PRE, F_EXTENDIDO, F_PARCIAL, F_NO_CANDIDATA];

const ttlVencido = (): Date => new Date(Date.now() - DIA_MS);
const ttlVigente = (): Date => new Date(Date.now() + 30 * DIA_MS);

let moduleRef: TestingModule;
let prisma: PrismaService;
let servicio: ExpirarConsultasVencidasService;

const sufijo = (): string => Math.random().toString(36).slice(2, 8);

/** Siembra una RESERVA candidata + su FECHA_BLOQUEADA blanda con el TTL indicado. */
const sembrar = async (params: {
  fecha: Date;
  estado?: EstadoReserva;
  subEstado?: SubEstadoConsulta | null;
  ttl?: Date | null;
  conBloqueo?: boolean;
}): Promise<{ reservaId: string }> => {
  const ttl = params.ttl === undefined ? ttlVencido() : params.ttl;
  const cliente = await prisma.cliente.create({
    data: { tenantId: TENANT, nombre: 'Int', email: `c-${sufijo()}${EMAIL_PATTERN}` },
  });
  const reserva = await prisma.reserva.create({
    data: {
      tenantId: TENANT,
      clienteId: cliente.idCliente,
      codigo: `TST-U012I-${sufijo()}`,
      estado: params.estado ?? EstadoReserva.consulta,
      subEstado: params.subEstado === undefined ? SubEstadoConsulta.s2b : params.subEstado,
      canalEntrada: CanalEntrada.web,
      fechaEvento: params.fecha,
      ttlExpiracion: ttl,
    },
  });
  if (params.conBloqueo !== false) {
    await prisma.fechaBloqueada.create({
      data: {
        tenantId: TENANT,
        fecha: params.fecha,
        reservaId: reserva.idReserva,
        tipoBloqueo: TipoBloqueo.blando,
        ttlExpiracion: ttl,
      },
    });
  }
  return { reservaId: reserva.idReserva };
};

/** Encola N reservas en s2d apuntando a la reserva bloqueante. */
const encolar = async (bloqueanteId: string, n: number): Promise<void> => {
  for (let i = 1; i <= n; i += 1) {
    const cliente = await prisma.cliente.create({
      data: { tenantId: TENANT, nombre: 'Cola', email: `q-${sufijo()}${EMAIL_PATTERN}` },
    });
    await prisma.reserva.create({
      data: {
        tenantId: TENANT,
        clienteId: cliente.idCliente,
        codigo: `TST-U012Q-${sufijo()}`,
        estado: EstadoReserva.consulta,
        subEstado: SubEstadoConsulta.s2d,
        canalEntrada: CanalEntrada.web,
        consultaBloqueanteId: bloqueanteId,
        posicionCola: i,
      },
    });
  }
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
  servicio = moduleRef.get(ExpirarConsultasVencidasService);
});

afterAll(async () => {
  await limpiar();
  await moduleRef.close();
});

beforeEach(async () => {
  await limpiar();
});

// ===========================================================================
// 3.2 — 2.b sin cola: 2b→2x + FECHA_BLOQUEADA liberada + AUDIT_LOG transicion.
// ===========================================================================

describe('Barrido US-012 — 2.b sin cola expira a 2x y libera la fecha (A4)', () => {
  it('debe_transicionar_2b_a_2x_liberar_la_fecha_y_auditar_la_transicion', async () => {
    const { reservaId } = await sembrar({ fecha: F_2B, subEstado: SubEstadoConsulta.s2b });

    const resumen = await servicio.ejecutar();

    expect(resumen.expiradas).toBeGreaterThanOrEqual(1);

    const reserva = await prisma.reserva.findUnique({ where: { idReserva: reservaId } });
    expect(reserva?.estado).toBe(EstadoReserva.consulta);
    expect(reserva?.subEstado).toBe(SubEstadoConsulta.s2x);
    // Fecha liberada dentro de la MISMA transacción atómica.
    expect(await contarBloqueos(F_2B)).toBe(0);

    // AUDIT_LOG de la TRANSICIÓN (accion='transicion', entidad='RESERVA'), además de
    // la de la liberación (accion='eliminar' / entidad='FECHA_BLOQUEADA', de US-041).
    const transiciones = await prisma.auditLog.findMany({
      where: { entidadId: reservaId, accion: AccionAudit.transicion },
    });
    expect(transiciones.length).toBeGreaterThanOrEqual(1);
  });
});

// ===========================================================================
// 3.3 — 2.b con cola: transición + liberación + seam disparado exactamente una vez;
//     la cola permanece intacta en 2.d (deuda US-018: US-012 solo dispara).
// ===========================================================================

describe('Barrido US-012 — 2.b con cola dispara la promoción una vez (seam US-018)', () => {
  it('debe_expirar_y_marcar_una_promocion_dejando_la_cola_intacta_en_2d', async () => {
    const { reservaId } = await sembrar({ fecha: F_2B_COLA, subEstado: SubEstadoConsulta.s2b });
    await encolar(reservaId, 2);

    const resumen = await servicio.ejecutar();

    const reserva = await prisma.reserva.findUnique({ where: { idReserva: reservaId } });
    expect(reserva?.subEstado).toBe(SubEstadoConsulta.s2x);
    expect(await contarBloqueos(F_2B_COLA)).toBe(0);
    // El seam se dispara una vez; A15 (reordenación) es de US-018 → cola sigue en 2d.
    expect(resumen.promocionesDisparadas).toBeGreaterThanOrEqual(1);
    const enCola = await prisma.reserva.count({
      where: { consultaBloqueanteId: reservaId, subEstado: SubEstadoConsulta.s2d },
    });
    expect(enCola).toBe(2);
  });
});

// ===========================================================================
// 3.4 — 2.c (sin promoción posible) y 2.v (con/sin cola heredada).
// ===========================================================================

describe('Barrido US-012 — 2.c y 2.v', () => {
  it('debe_expirar_2c_a_2x_sin_disparar_promocion', async () => {
    const { reservaId } = await sembrar({ fecha: F_2C, subEstado: SubEstadoConsulta.s2c });

    await servicio.ejecutar();

    const reserva = await prisma.reserva.findUnique({ where: { idReserva: reservaId } });
    expect(reserva?.subEstado).toBe(SubEstadoConsulta.s2x);
    expect(await contarBloqueos(F_2C)).toBe(0);
  });

  it('debe_expirar_2v_sin_cola_a_2x_sin_promocion', async () => {
    const { reservaId } = await sembrar({ fecha: F_2V, subEstado: SubEstadoConsulta.s2v });

    await servicio.ejecutar();

    const reserva = await prisma.reserva.findUnique({ where: { idReserva: reservaId } });
    expect(reserva?.subEstado).toBe(SubEstadoConsulta.s2x);
    expect(await contarBloqueos(F_2V)).toBe(0);
  });

  it('debe_disparar_promocion_cuando_2v_hereda_cola', async () => {
    const { reservaId } = await sembrar({ fecha: F_2V_COLA, subEstado: SubEstadoConsulta.s2v });
    await encolar(reservaId, 1);

    const resumen = await servicio.ejecutar();

    expect(resumen.promocionesDisparadas).toBeGreaterThanOrEqual(1);
  });
});

// ===========================================================================
// 3.5 — pre_reserva → reserva_cancelada (sub_estado NULL) + fecha liberada +
//     AUDIT_LOG con datos_anteriores.estado='pre_reserva'/datos_nuevos.estado=
//     'reserva_cancelada'; sin promoción.
// ===========================================================================

describe('Barrido US-012 — pre_reserva cancela y libera la fecha (A5)', () => {
  it('debe_pasar_pre_reserva_a_reserva_cancelada_con_sub_estado_null_y_liberar', async () => {
    const { reservaId } = await sembrar({
      fecha: F_PRE,
      estado: EstadoReserva.pre_reserva,
      subEstado: null,
    });

    await servicio.ejecutar();

    const reserva = await prisma.reserva.findUnique({ where: { idReserva: reservaId } });
    expect(reserva?.estado).toBe(EstadoReserva.reserva_cancelada);
    expect(reserva?.subEstado).toBeNull();
    expect(await contarBloqueos(F_PRE)).toBe(0);

    const transiciones = await prisma.auditLog.findMany({
      where: { entidadId: reservaId, accion: AccionAudit.transicion },
    });
    expect(transiciones.length).toBeGreaterThanOrEqual(1);
  });
});

// ===========================================================================
// 3.6 — Idempotencia: 2.ª ejecución sobre reserva ya terminal → 0 cambios, 0
//     auditorías nuevas. Y candidata con FECHA_BLOQUEADA ya eliminada (expiración
//     parcial) → transición a 2x sin error (DELETE 0 filas = éxito silencioso).
// ===========================================================================

describe('Barrido US-012 — idempotencia', () => {
  it('la_segunda_ejecucion_no_cambia_nada_ni_duplica_auditorias', async () => {
    const { reservaId } = await sembrar({ fecha: F_2B, subEstado: SubEstadoConsulta.s2b });

    await servicio.ejecutar();
    const auditsTras1 = await prisma.auditLog.count({ where: { entidadId: reservaId } });

    const resumen2 = await servicio.ejecutar();
    const auditsTras2 = await prisma.auditLog.count({ where: { entidadId: reservaId } });

    // La reserva ya está en 2x: no es candidata en la 2.ª pasada → 0 expiradas.
    expect(resumen2.expiradas).toBe(0);
    expect(auditsTras2).toBe(auditsTras1);
  });

  it('candidata_con_fecha_bloqueada_ya_eliminada_se_expira_sin_error', async () => {
    // 2.b candidata PERO sin fila de FECHA_BLOQUEADA (expiración parcial previa).
    const { reservaId } = await sembrar({
      fecha: F_PARCIAL,
      subEstado: SubEstadoConsulta.s2b,
      conBloqueo: false,
    });

    await expect(servicio.ejecutar()).resolves.toBeDefined();

    const reserva = await prisma.reserva.findUnique({ where: { idReserva: reservaId } });
    // La transición se aplica; el DELETE de 0 filas es éxito silencioso (US-041).
    expect(reserva?.subEstado).toBe(SubEstadoConsulta.s2x);
  });
});

// ===========================================================================
// 3.7 — TTL extendido antes del barrido (US-006): ttl_expiracion > now() → NO
//     candidata, sin cambios. La extensión manual prevalece.
// ===========================================================================

describe('Barrido US-012 — el TTL extendido prevalece sobre la expiración (US-006)', () => {
  it('no_debe_expirar_una_reserva_cuyo_ttl_fue_extendido_a_futuro', async () => {
    const { reservaId } = await sembrar({
      fecha: F_EXTENDIDO,
      subEstado: SubEstadoConsulta.s2b,
      ttl: ttlVigente(),
    });

    await servicio.ejecutar();

    const reserva = await prisma.reserva.findUnique({ where: { idReserva: reservaId } });
    // Sigue en 2.b, con su fila de bloqueo intacta: la extensión prevalece.
    expect(reserva?.subEstado).toBe(SubEstadoConsulta.s2b);
    expect(await contarBloqueos(F_EXTENDIDO)).toBe(1);
  });
});

// ===========================================================================
// 3.8 — Selección por INSTANTE (D-7): la candidatura se decide por
//     `ttl_expiracion < now()` (timestamptz), no por fecha formateada. Blindaje del
//     off-by-one de TZ conocido (memoria "TTL display off-by-one por TZ").
// ===========================================================================

describe('Barrido US-012 — selección por instante, no por fecha formateada (D-7)', () => {
  it('debe_incluir_una_candidata_cuyo_ttl_vencio_por_segundos_aunque_sea_hoy', async () => {
    // TTL vencido hace 1 segundo: mismo DÍA natural que now(), pero instante < now().
    const haceUnSegundo = new Date(Date.now() - 1000);
    const { reservaId } = await sembrar({
      fecha: F_2C,
      subEstado: SubEstadoConsulta.s2b,
      ttl: haceUnSegundo,
    });

    await servicio.ejecutar();

    const reserva = await prisma.reserva.findUnique({ where: { idReserva: reservaId } });
    // Se expira porque el INSTANTE ya venció, sin depender del formateo de fecha.
    expect(reserva?.subEstado).toBe(SubEstadoConsulta.s2x);
  });

  it('no_debe_incluir_una_reserva_cuyo_ttl_vence_dentro_de_unos_segundos', async () => {
    const enUnosSegundos = new Date(Date.now() + 5000);
    const { reservaId } = await sembrar({
      fecha: F_NO_CANDIDATA,
      subEstado: SubEstadoConsulta.s2b,
      ttl: enUnosSegundos,
    });

    await servicio.ejecutar();

    const reserva = await prisma.reserva.findUnique({ where: { idReserva: reservaId } });
    expect(reserva?.subEstado).toBe(SubEstadoConsulta.s2b);
  });
});

// ===========================================================================
// 3.9 — Atomicidad / fallo aislado en BD real: varias candidatas, una en un estado
//     que no puede expirar de forma limpia; las demás SE expiran igualmente y el
//     resumen refleja el aislamiento (cada RESERVA en su propia transacción).
// ===========================================================================

describe('Barrido US-012 — atomicidad por RESERVA y fallo aislado (D-9)', () => {
  it('debe_expirar_las_demas_candidatas_aunque_una_transaccion_no_progrese', async () => {
    // Dos candidatas legales + una NO candidata (terminal ya) mezcladas.
    const a = await sembrar({ fecha: F_2B, subEstado: SubEstadoConsulta.s2b });
    const b = await sembrar({ fecha: F_PRE, estado: EstadoReserva.pre_reserva, subEstado: null });
    // Terminal 2x con TTL vencido: NO debe re-expirarse (guarda de origen la excluye).
    const terminal = await sembrar({
      fecha: F_2V,
      subEstado: SubEstadoConsulta.s2x,
      conBloqueo: false,
    });

    const resumen = await servicio.ejecutar();

    const ra = await prisma.reserva.findUnique({ where: { idReserva: a.reservaId } });
    const rb = await prisma.reserva.findUnique({ where: { idReserva: b.reservaId } });
    const rt = await prisma.reserva.findUnique({ where: { idReserva: terminal.reservaId } });

    expect(ra?.subEstado).toBe(SubEstadoConsulta.s2x);
    expect(rb?.estado).toBe(EstadoReserva.reserva_cancelada);
    // El terminal permanece intacto (no re-expirado).
    expect(rt?.subEstado).toBe(SubEstadoConsulta.s2x);
    expect(resumen.fallos).toBe(0);
  });
});
