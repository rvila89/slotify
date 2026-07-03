/**
 * TESTS DE INTEGRACIÓN de la confirmación del presupuesto / activación de
 * pre_reserva (US-014 / UC-14) — fase TDD RED. tasks.md Fase 3: 3.8 (bloqueo
 * insert 2.a vs update 2.b/2.c/2.v a 7 días, TTL derivado de ttl_prereserva_dias),
 * 3.9 (vaciado de cola A16 2.d→2.y), 3.10 (atomicidad/rollback real), 3.11 (E2
 * post-commit + idempotencia (reserva_id, codigo_email=E2)).
 *
 * Trazabilidad: US-014; spec-delta `consultas` (transición {2a,2b,2c,2v}→pre_reserva,
 * bloqueo insert-o-update a 7 d, vaciado atómico de cola A16, atomicidad
 * all-or-nothing, auditoría `transicion`) y spec-delta `comunicaciones` (E2
 * post-commit idempotente con el PDF adjunto). design.md §D-3/§D-4/§D-7.
 *
 * INTEGRACIÓN REAL contra el Postgres del docker-compose (no mocks): la transacción
 * única (PRESUPUESTO + RESERVA + FECHA_BLOQUEADA + cola + AUDIT_LOG) y el bloqueo
 * atómico (`UNIQUE(tenant_id, fecha)` + `SELECT … FOR UPDATE`) se verifican por el
 * ESTADO DE LA BD. Mismo enfoque que `transicion-pendiente-invitados-integracion.spec.ts`
 * (US-007). Requiere `docker compose up -d postgres` + migración + seed (tenant piloto
 * con `ttl_prereserva_dias = 7`, `pct_senal = 40`). El transporte de email va en modo
 * FAKE en test/CI (no red).
 *
 * RED: aún NO existe `presupuestos/application/generar-presupuesto.use-case.ts` ni el
 * cableado de `PresupuestosModule`. El import falla en compilación y la batería está en
 * ROJO por AUSENCIA DE IMPLEMENTACIÓN. GREEN es de `backend-developer`.
 */
import { Test, type TestingModule } from '@nestjs/testing';
import { ConfigModule } from '@nestjs/config';
import {
  CanalEntrada,
  CodigoEmail,
  DuracionHoras,
  EstadoPresupuesto,
  EstadoReserva,
  SubEstadoConsulta,
  TipoBloqueo,
  TipoEvento,
} from '@prisma/client';
import { PresupuestosModule } from '../presupuestos.module';
import { PrismaService } from '../../shared/prisma/prisma.service';
import {
  GenerarPresupuestoUseCase,
  type ConfirmarPresupuestoComando,
} from '../application/generar-presupuesto.use-case';

const TENANT = '00000000-0000-0000-0000-000000000001';
const OTRO_TENANT = '00000000-0000-0000-0000-0000000000ff';
const GESTOR = '00000000-0000-0000-0000-000000000002';
const EMAIL_PATTERN = '@us014-int.test';
const DIA_MS = 24 * 60 * 60 * 1000;

// Fechas estrictamente futuras y aisladas (no usadas por el seed ni otras suites).
const FECHA_DESDE_2A = new Date('2027-12-01T00:00:00.000Z');
const FECHA_DESDE_2B = new Date('2027-12-02T00:00:00.000Z');
const FECHA_CON_COLA = new Date('2027-12-03T00:00:00.000Z');
const FECHA_ROLLBACK = new Date('2027-12-04T00:00:00.000Z');
const FECHA_E2 = new Date('2027-12-05T00:00:00.000Z');
const FECHA_TENANT = new Date('2027-12-06T00:00:00.000Z');
const FECHAS = [
  FECHA_DESDE_2A,
  FECHA_DESDE_2B,
  FECHA_CON_COLA,
  FECHA_ROLLBACK,
  FECHA_E2,
  FECHA_TENANT,
];

const ttlVigente = (): Date => new Date(Date.now() + 3 * DIA_MS);

let moduleRef: TestingModule;
let prisma: PrismaService;
let useCase: GenerarPresupuestoUseCase;

const sufijo = (): string => Math.random().toString(36).slice(2, 8);

const comandoConfirmar = (
  reservaId: string,
  over: Partial<ConfirmarPresupuestoComando> = {},
): ConfirmarPresupuestoComando => ({
  tenantId: TENANT,
  usuarioId: GESTOR,
  reservaId,
  extras: [],
  ...over,
});

/**
 * Siembra un CLIENTE con datos fiscales completos + una RESERVA de consulta activa
 * con datos completos (fecha en temporada alta, 8 h, 40 invitados, boda) y,
 * opcionalmente, su fila `FECHA_BLOQUEADA` blanda vigente (para 2.b/2.c/2.v).
 */
const sembrarConsulta = async (params: {
  fecha: Date;
  subEstado?: SubEstadoConsulta | null;
  estado?: EstadoReserva;
  conBloqueo?: boolean;
  tenantId?: string;
}): Promise<string> => {
  const tenantId = params.tenantId ?? TENANT;
  const cliente = await prisma.cliente.create({
    data: {
      tenantId,
      nombre: 'Marta',
      apellidos: 'Soler',
      email: `cli-${sufijo()}${EMAIL_PATTERN}`,
      dniNif: '12345678Z',
      direccion: 'C/ Mayor 1',
      codigoPostal: '08001',
      poblacion: 'Barcelona',
      provincia: 'Barcelona',
    },
  });
  const subEstado =
    params.subEstado === undefined ? SubEstadoConsulta.s2b : params.subEstado;
  const reserva = await prisma.reserva.create({
    data: {
      tenantId,
      clienteId: cliente.idCliente,
      codigo: `TST-U014-${sufijo()}`,
      estado: params.estado ?? EstadoReserva.consulta,
      subEstado,
      canalEntrada: CanalEntrada.web,
      fechaEvento: params.fecha,
      duracionHoras: DuracionHoras.h8,
      tipoEvento: TipoEvento.boda,
      numAdultosNinosMayores4: 40,
      numNinosMenores4: 5,
      ttlExpiracion: ttlVigente(),
    },
  });
  if (params.conBloqueo) {
    await prisma.fechaBloqueada.create({
      data: {
        tenantId,
        fecha: params.fecha,
        reservaId: reserva.idReserva,
        tipoBloqueo: TipoBloqueo.blando,
        ttlExpiracion: ttlVigente(),
      },
    });
  }
  return reserva.idReserva;
};

/** Siembra una RESERVA en cola (`2.d`) apuntando a la bloqueante. */
const sembrarEnCola = async (params: {
  fecha: Date;
  bloqueanteId: string;
  posicion: number;
}): Promise<string> => {
  const cliente = await prisma.cliente.create({
    data: { tenantId: TENANT, nombre: 'Cola', email: `cola-${sufijo()}${EMAIL_PATTERN}` },
  });
  const reserva = await prisma.reserva.create({
    data: {
      tenantId: TENANT,
      clienteId: cliente.idCliente,
      codigo: `TST-U014-COLA-${sufijo()}`,
      estado: EstadoReserva.consulta,
      subEstado: SubEstadoConsulta.s2d,
      canalEntrada: CanalEntrada.web,
      fechaEvento: params.fecha,
      posicionCola: params.posicion,
      consultaBloqueanteId: params.bloqueanteId,
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
    await prisma.presupuesto.deleteMany({ where: { reservaId: { in: ids } } });
    await prisma.fechaBloqueada.deleteMany({ where: { reservaId: { in: ids } } });
    await prisma.comunicacion.deleteMany({ where: { reservaId: { in: ids } } });
    await prisma.auditLog.deleteMany({ where: { entidadId: { in: ids } } });
    await prisma.reserva.deleteMany({ where: { idReserva: { in: ids } } });
  }
  await prisma.fechaBloqueada.deleteMany({ where: { fecha: { in: FECHAS } } });
  if (todosClienteIds.length > 0) {
    await prisma.cliente.deleteMany({ where: { idCliente: { in: todosClienteIds } } });
  }
};

beforeAll(async () => {
  moduleRef = await Test.createTestingModule({
    imports: [ConfigModule.forRoot({ isGlobal: true }), PresupuestosModule],
  }).compile();
  await moduleRef.init();
  prisma = moduleRef.get(PrismaService);
  useCase = moduleRef.get(GenerarPresupuestoUseCase);
});

afterAll(async () => {
  await limpiar();
  await moduleRef.close();
});

beforeEach(async () => {
  await limpiar();
});

// ===========================================================================
// 3.8 — Bloqueo INSERT desde 2.a (sin fila previa): se crea una fila nueva
//        blanda con ttl = now() + ttl_prereserva_dias (7 d del seed).
// ===========================================================================

describe('Confirmar desde 2.a — INSERT de FECHA_BLOQUEADA a 7 días (3.8)', () => {
  it('debe_insertar_una_fila_blanda_nueva_con_ttl_de_7_dias_y_reserva_en_pre_reserva', async () => {
    const reservaId = await sembrarConsulta({
      fecha: FECHA_DESDE_2A,
      subEstado: SubEstadoConsulta.s2a,
      conBloqueo: false,
    });

    const antesMs = Date.now();
    await useCase.confirmar(comandoConfirmar(reservaId));

    // RESERVA elevada a pre_reserva con TTL ~ now()+7d (derivado del setting).
    const reserva = await prisma.reserva.findUnique({ where: { idReserva: reservaId } });
    expect(reserva?.estado).toBe(EstadoReserva.pre_reserva);
    const ttlRes = reserva!.ttlExpiracion!.getTime();
    const deltaDias = (ttlRes - antesMs) / DIA_MS;
    expect(deltaDias).toBeGreaterThan(6.5);
    expect(deltaDias).toBeLessThan(7.5);

    // Exactamente UNA fila de FECHA_BLOQUEADA para (tenant, fecha), blanda, mismo TTL.
    const filas = await prisma.fechaBloqueada.findMany({
      where: { tenantId: TENANT, fecha: FECHA_DESDE_2A },
    });
    expect(filas).toHaveLength(1);
    expect(filas[0].tipoBloqueo).toBe(TipoBloqueo.blando);
    expect(filas[0].reservaId).toBe(reservaId);
    expect(filas[0].ttlExpiracion?.getTime()).toBe(ttlRes);

    // PRESUPUESTO congelado creado (version 1, enviado, IVA 21).
    const presupuesto = await prisma.presupuesto.findFirst({ where: { reservaId } });
    expect(presupuesto).not.toBeNull();
    expect(presupuesto?.version).toBe(1);
    expect(presupuesto?.estado).toBe(EstadoPresupuesto.enviado);
    expect(presupuesto?.tarifaCongelada).toBe(true);
    expect(Number(presupuesto?.ivaPorcentaje)).toBe(21);
  });
});

// ===========================================================================
// 3.8 — Bloqueo UPDATE desde 2.b (fila activa a 3 d): se ACTUALIZA el ttl de la
//        fila existente a 7 d; NO se crea una segunda fila.
// ===========================================================================

describe('Confirmar desde 2.b — UPDATE del ttl de FECHA_BLOQUEADA a 7 días (3.8)', () => {
  it('debe_actualizar_la_fila_existente_a_7_dias_sin_crear_una_segunda', async () => {
    const reservaId = await sembrarConsulta({
      fecha: FECHA_DESDE_2B,
      subEstado: SubEstadoConsulta.s2b,
      conBloqueo: true,
    });
    const antesMs = Date.now();

    await useCase.confirmar(comandoConfirmar(reservaId));

    const filas = await prisma.fechaBloqueada.findMany({
      where: { tenantId: TENANT, fecha: FECHA_DESDE_2B },
    });
    // No se duplica la fila: sigue habiendo exactamente una para (tenant, fecha).
    expect(filas).toHaveLength(1);
    expect(filas[0].tipoBloqueo).toBe(TipoBloqueo.blando);
    // TTL elevado a ~7 días (antes eran 3).
    const deltaDias = (filas[0].ttlExpiracion!.getTime() - antesMs) / DIA_MS;
    expect(deltaDias).toBeGreaterThan(6.5);

    const reserva = await prisma.reserva.findUnique({ where: { idReserva: reservaId } });
    expect(reserva?.estado).toBe(EstadoReserva.pre_reserva);
    expect(reserva?.ttlExpiracion?.getTime()).toBe(filas[0].ttlExpiracion?.getTime());
  });
});

// ===========================================================================
// 3.9 — Vaciado de cola A16: las consultas en 2.d apuntando a la bloqueante pasan
//        a 2.y con posicion_cola=NULL y consulta_bloqueante_id=NULL; auditoría por
//        cada descartada; sin emails a la cola.
// ===========================================================================

describe('Confirmar con cola activa — vaciado A16 2.d→2.y (3.9)', () => {
  it('debe_pasar_las_consultas_en_cola_a_2y_con_posicion_y_bloqueante_en_NULL_y_auditar', async () => {
    const bloqueanteId = await sembrarConsulta({
      fecha: FECHA_CON_COLA,
      subEstado: SubEstadoConsulta.s2b,
      conBloqueo: true,
    });
    const cola1 = await sembrarEnCola({ fecha: FECHA_CON_COLA, bloqueanteId, posicion: 1 });
    const cola2 = await sembrarEnCola({ fecha: FECHA_CON_COLA, bloqueanteId, posicion: 2 });

    const out = await useCase.confirmar(comandoConfirmar(bloqueanteId));
    expect(out.consultasDescartadas).toBe(2);

    const descartadas = await prisma.reserva.findMany({
      where: { idReserva: { in: [cola1, cola2] } },
    });
    for (const r of descartadas) {
      expect(r.subEstado).toBe(SubEstadoConsulta.s2y);
      expect(r.posicionCola).toBeNull();
      expect(r.consultaBloqueanteId).toBeNull();
    }

    // Auditoría de la principal (transicion) + una por cada descartada.
    const auditPrincipal = await prisma.auditLog.findFirst({
      where: { tenantId: TENANT, entidadId: bloqueanteId, accion: 'transicion' },
    });
    expect(auditPrincipal).not.toBeNull();
    expect((auditPrincipal?.datosNuevos as { estado?: string })?.estado).toBe('pre_reserva');
    const auditDescartadas = await prisma.auditLog.findMany({
      where: { tenantId: TENANT, entidadId: { in: [cola1, cola2] }, accion: 'transicion' },
    });
    expect(auditDescartadas).toHaveLength(2);

    // A16 en MVP: ninguna COMUNICACION a los clientes de la cola.
    const comunicacionesCola = await prisma.comunicacion.count({
      where: { reservaId: { in: [cola1, cola2] } },
    });
    expect(comunicacionesCola).toBe(0);
  });

  it('debe_completar_igualmente_la_activacion_cuando_no_hay_cola_afectando_a_0_filas', async () => {
    const reservaId = await sembrarConsulta({
      fecha: FECHA_DESDE_2B,
      subEstado: SubEstadoConsulta.s2b,
      conBloqueo: true,
    });

    const out = await useCase.confirmar(comandoConfirmar(reservaId));

    expect(out.consultasDescartadas).toBe(0);
    const reserva = await prisma.reserva.findUnique({ where: { idReserva: reservaId } });
    expect(reserva?.estado).toBe(EstadoReserva.pre_reserva);
  });
});

// ===========================================================================
// 3.10 — Atomicidad real: si el bloqueo choca con una fila FIRME de OTRA reserva
//         para la misma fecha, la tx hace rollback total: NO hay PRESUPUESTO, la
//         RESERVA sigue en su sub_estado origen y la cola intacta.
// ===========================================================================

describe('Confirmar — rollback total ante conflicto de bloqueo (3.10)', () => {
  it('no_debe_dejar_presupuesto_ni_pre_reserva_si_la_fecha_ya_esta_bloqueada_en_firme_por_otra', async () => {
    // Otra reserva bloquea la misma fecha en FIRME (colisión UNIQUE al insertar).
    const ocupante = await sembrarConsulta({
      fecha: FECHA_ROLLBACK,
      subEstado: null,
      estado: EstadoReserva.reserva_confirmada,
    });
    await prisma.fechaBloqueada.create({
      data: {
        tenantId: TENANT,
        fecha: FECHA_ROLLBACK,
        reservaId: ocupante,
        tipoBloqueo: TipoBloqueo.firme,
        ttlExpiracion: null,
      },
    });
    // La reserva que intenta confirmar viene de 2.a (INSERT → chocará con el UNIQUE).
    const reservaId = await sembrarConsulta({
      fecha: FECHA_ROLLBACK,
      subEstado: SubEstadoConsulta.s2a,
      conBloqueo: false,
    });

    await expect(useCase.confirmar(comandoConfirmar(reservaId))).rejects.toBeDefined();

    // Rollback: sin PRESUPUESTO, RESERVA en su sub_estado origen (2.a).
    const presupuesto = await prisma.presupuesto.findFirst({ where: { reservaId } });
    expect(presupuesto).toBeNull();
    const reserva = await prisma.reserva.findUnique({ where: { idReserva: reservaId } });
    expect(reserva?.estado).toBe(EstadoReserva.consulta);
    expect(reserva?.subEstado).toBe(SubEstadoConsulta.s2a);
    // La fila FIRME del ocupante sigue siendo la única para (tenant, fecha).
    const filas = await prisma.fechaBloqueada.findMany({
      where: { tenantId: TENANT, fecha: FECHA_ROLLBACK },
    });
    expect(filas).toHaveLength(1);
    expect(filas[0].reservaId).toBe(ocupante);
  });
});

// ===========================================================================
// 3.11 — E2 post-commit + idempotencia: tras el commit se registra la
//         COMUNICACION E2 (modo fake, sin red); un doble disparo NO duplica por
//         (reserva_id, codigo_email=E2). El fallo del proveedor no revierte.
// ===========================================================================

describe('Confirmar — E2 post-commit idempotente por (reserva, E2) (3.11)', () => {
  it('debe_registrar_una_unica_COMUNICACION_E2_tras_el_commit_de_la_pre_reserva', async () => {
    const reservaId = await sembrarConsulta({
      fecha: FECHA_E2,
      subEstado: SubEstadoConsulta.s2b,
      conBloqueo: true,
    });

    await useCase.confirmar(comandoConfirmar(reservaId));

    // La pre_reserva quedó comprometida (efecto de la tx) …
    const reserva = await prisma.reserva.findUnique({ where: { idReserva: reservaId } });
    expect(reserva?.estado).toBe(EstadoReserva.pre_reserva);
    // … y el E2 se disparó post-commit dejando UNA COMUNICACION E2 (fake, sin red).
    const e2 = await prisma.comunicacion.findMany({
      where: { reservaId, codigoEmail: CodigoEmail.E2 },
    });
    expect(e2).toHaveLength(1);
  });

  it('no_debe_duplicar_la_COMUNICACION_E2_ante_un_segundo_disparo_idempotente', async () => {
    const reservaId = await sembrarConsulta({
      fecha: FECHA_E2,
      subEstado: SubEstadoConsulta.s2b,
      conBloqueo: true,
    });

    await useCase.confirmar(comandoConfirmar(reservaId));
    // Segundo disparo explícito del E2 (simula reintento/idempotencia US-045).
    await useCase.reenviarE2({ tenantId: TENANT, reservaId });

    const e2 = await prisma.comunicacion.count({
      where: { reservaId, codigoEmail: CodigoEmail.E2 },
    });
    expect(e2).toBe(1);
  });
});

// ===========================================================================
// Multi-tenancy / RLS — un tenant no puede confirmar la RESERVA de otro (404),
// sin mutar nada.
// ===========================================================================

describe('Confirmar — aislamiento multi-tenant / RLS', () => {
  it('debe_rechazar_y_no_mutar_cuando_el_tenant_del_jwt_no_es_dueno', async () => {
    const reservaId = await sembrarConsulta({
      fecha: FECHA_TENANT,
      subEstado: SubEstadoConsulta.s2b,
      conBloqueo: true,
    });

    await expect(
      useCase.confirmar(comandoConfirmar(reservaId, { tenantId: OTRO_TENANT })),
    ).rejects.toBeDefined();

    const reserva = await prisma.reserva.findUnique({ where: { idReserva: reservaId } });
    expect(reserva?.estado).toBe(EstadoReserva.consulta);
    expect(reserva?.subEstado).toBe(SubEstadoConsulta.s2b);
    const presupuesto = await prisma.presupuesto.findFirst({ where: { reservaId } });
    expect(presupuesto).toBeNull();
  });
});
