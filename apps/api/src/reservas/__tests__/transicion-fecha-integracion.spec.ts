/**
 * TESTS DE INTEGRACIÓN de la transición «añadir fecha» (US-005 / UC-04).
 *
 * Fase TDD RED del change `email-transicion-fecha-borrador`: reescribe las
 * expectativas del EMAIL de la transición. El correo E1 ya NO se auto-envía con texto
 * hardcodeado — pasa a quedar en `borrador` con redacción DINÁMICA (dos plantillas:
 * "disponible" para la rama libre 2.b, "cola" para la rama 2.d) para revisión/envío
 * manual del gestor (flujo US-046). La rama cola, que antes no generaba correo, ahora
 * TAMBIÉN crea su borrador.
 *
 * Trazabilidad: US-005; spec-delta `consultas` del change (Requirements
 * "Email de confirmación de bloqueo provisional…" MODIFIED, "Plantillas dinámicas de
 * la transición de fecha", "Selección de idioma", "Placeholder"); plan aprobado.
 * design.md US-005: §D-1 (`> hoy`), §D-2 (endpoint/`aceptarCola`), §D-4 (`bloquearEnTx`
 * en la misma tx, `ttl = now()+ttl_consulta_dias`), §D-5 (cola `MAX+1`).
 *
 * INTEGRACIÓN REAL contra el Postgres del docker-compose (no mocks): el caso de uso
 * se resuelve por DI (`ReservasModule`) y se verifica el ESTADO DE LA BD tras la
 * transición. Mismo enfoque que `alta-consulta-con-fecha-integracion.spec.ts`.
 * Requiere `docker compose up -d postgres` + migración + seed (tenant piloto con
 * `ttl_consulta_dias = 3`). La ejecuta la SESIÓN PRINCIPAL (BD `slotify_test_email`);
 * los subagentes QA no tienen Postgres.
 *
 * RED contra el código ACTUAL: hoy la rama libre auto-envía (estado `enviado`) el texto
 * viejo ("Hemos reservado provisionalmente tu fecha") y la rama cola no crea ninguna
 * COMUNICACION. Estos tests esperan el comportamiento NUEVO (borrador + texto dinámico,
 * sin envío; borrador también en cola), por lo que fallan hasta que
 * `backend-developer` implemente el GREEN.
 */
import { Test, type TestingModule } from '@nestjs/testing';
import { ConfigModule } from '@nestjs/config';
import {
  CanalEntrada,
  CodigoEmail,
  EstadoComunicacion,
  EstadoReserva,
  SubEstadoConsulta,
  TipoBloqueo,
} from '@prisma/client';
import { ReservasModule } from '../reservas.module';
import { PrismaService } from '../../shared/prisma/prisma.service';
import {
  TransicionFechaUseCase,
  AsignarFechaConflictoError,
  TransicionFechaValidacionError,
  ReservaNoEncontradaError,
  type TransicionFechaComando,
} from '../application/transicion-fecha.use-case';

const TENANT = '00000000-0000-0000-0000-000000000001';
const OTRO_TENANT = '00000000-0000-0000-0000-0000000000ff';
const GESTOR = '00000000-0000-0000-0000-000000000002';
const EMAIL_PATTERN = '@us005-int.test';

const FECHA_LIBRE = new Date('2027-04-01T00:00:00.000Z');
const FECHA_COLA = new Date('2027-04-02T00:00:00.000Z');
const FECHA_NO_DISP = new Date('2027-04-03T00:00:00.000Z');
const FECHA_GUARDA = new Date('2027-04-04T00:00:00.000Z');
const FECHA_TENANT = new Date('2027-04-05T00:00:00.000Z');
const FECHA_E1_PREVIA = new Date('2027-04-06T00:00:00.000Z');
const hoyUtc = (): Date => {
  const n = new Date();
  return new Date(Date.UTC(n.getUTCFullYear(), n.getUTCMonth(), n.getUTCDate()));
};
const FECHAS = [
  FECHA_LIBRE,
  FECHA_COLA,
  FECHA_NO_DISP,
  FECHA_GUARDA,
  FECHA_TENANT,
  FECHA_E1_PREVIA,
  hoyUtc(),
];

let moduleRef: TestingModule;
let prisma: PrismaService;
let useCase: TransicionFechaUseCase;

const sufijo = (): string => Math.random().toString(36).slice(2, 8);

const comando = (
  reservaId: string,
  over: Partial<TransicionFechaComando> = {},
): TransicionFechaComando => ({
  tenantId: TENANT,
  usuarioId: GESTOR,
  reservaId,
  fechaEvento: FECHA_LIBRE,
  ...over,
});

/** Inserta una RESERVA con su CLIENTE y devuelve ambos ids (origen de la transición). */
const sembrarReservaConCliente = async (params: {
  estado: EstadoReserva;
  subEstado: SubEstadoConsulta | null;
  fechaEvento?: Date;
  tenantId?: string;
}): Promise<{ reservaId: string; clienteId: string }> => {
  const cliente = await prisma.cliente.create({
    data: {
      tenantId: params.tenantId ?? TENANT,
      nombre: 'Origen',
      email: `origen-${sufijo()}${EMAIL_PATTERN}`,
    },
  });
  const reserva = await prisma.reserva.create({
    data: {
      tenantId: params.tenantId ?? TENANT,
      clienteId: cliente.idCliente,
      codigo: `TST-U005-${sufijo()}`,
      estado: params.estado,
      subEstado: params.subEstado,
      canalEntrada: CanalEntrada.web,
      ...(params.fechaEvento !== undefined ? { fechaEvento: params.fechaEvento } : {}),
    },
  });
  return { reservaId: reserva.idReserva, clienteId: cliente.idCliente };
};

/** Inserta una RESERVA en un estado/sub-estado dado (origen de la transición). */
const sembrarReserva = async (params: {
  estado: EstadoReserva;
  subEstado: SubEstadoConsulta | null;
  fechaEvento?: Date;
  tenantId?: string;
}): Promise<string> => {
  const { reservaId } = await sembrarReservaConCliente(params);
  return reservaId;
};

/** Inserta una RESERVA bloqueante + su FECHA_BLOQUEADA (arrange de cola/no-disp). */
const sembrarBloqueante = async (params: {
  fecha: Date;
  estado: EstadoReserva;
  subEstado: SubEstadoConsulta | null;
}): Promise<string> => {
  const cliente = await prisma.cliente.create({
    data: { tenantId: TENANT, nombre: 'Bloqueante', email: `bloq-${sufijo()}${EMAIL_PATTERN}` },
  });
  const reserva = await prisma.reserva.create({
    data: {
      tenantId: TENANT,
      clienteId: cliente.idCliente,
      codigo: `TST-U005-BLQ-${sufijo()}`,
      estado: params.estado,
      subEstado: params.subEstado,
      canalEntrada: CanalEntrada.web,
      fechaEvento: params.fecha,
    },
  });
  await prisma.fechaBloqueada.create({
    data: {
      tenantId: TENANT,
      fecha: params.fecha,
      reservaId: reserva.idReserva,
      tipoBloqueo: TipoBloqueo.blando,
      ttlExpiracion: new Date('2027-12-31'),
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
  await prisma.fechaBloqueada.deleteMany({ where: { fecha: { in: FECHAS } } });
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
  useCase = moduleRef.get(TransicionFechaUseCase);
});

afterAll(async () => {
  await limpiar();
  await moduleRef.close();
});

beforeEach(async () => {
  await limpiar();
});

// ===========================================================================
// 3.2 — Fecha libre → RESERVA 2.a→2.b + FECHA_BLOQUEADA blando + AUDIT_LOG.
// ===========================================================================

describe('Transición sobre fecha LIBRE → 2.b + bloqueo blando atómico (3.2)', () => {
  it('debe_pasar_la_reserva_a_s2b_crear_FECHA_BLOQUEADA_blando_y_AUDIT_LOG_transicion', async () => {
    const reservaId = await sembrarReserva({
      estado: EstadoReserva.consulta,
      subEstado: SubEstadoConsulta.s2a,
    });

    await useCase.ejecutar(comando(reservaId, { fechaEvento: FECHA_LIBRE }));

    const reserva = await prisma.reserva.findUnique({ where: { idReserva: reservaId } });
    expect(reserva?.subEstado).toBe(SubEstadoConsulta.s2b);
    expect(reserva?.fechaEvento).toEqual(FECHA_LIBRE);
    expect(reserva?.ttlExpiracion).not.toBeNull();

    const bloqueo = await prisma.fechaBloqueada.findFirst({
      where: { tenantId: TENANT, fecha: FECHA_LIBRE },
    });
    expect(bloqueo).not.toBeNull();
    expect(bloqueo?.tipoBloqueo).toBe(TipoBloqueo.blando);
    expect(bloqueo?.reservaId).toBe(reservaId);
    expect(bloqueo?.ttlExpiracion).not.toBeNull();
    // ttl = now() + ttl_consulta_dias (3 en el seed): ventana ~3 días.
    const dias = (bloqueo!.ttlExpiracion!.getTime() - Date.now()) / 86_400_000;
    expect(dias).toBeGreaterThan(2.5);
    expect(dias).toBeLessThan(3.5);

    const audit = await prisma.auditLog.findFirst({
      where: { tenantId: TENANT, entidadId: reservaId, accion: 'transicion' },
    });
    expect(audit).not.toBeNull();
    const anteriores = audit?.datosAnteriores as { subEstado?: string } | null;
    const nuevos = audit?.datosNuevos as { subEstado?: string } | null;
    expect(anteriores?.subEstado).toBe('2a');
    expect(nuevos?.subEstado).toBe('2b');
  });
});

// ===========================================================================
// BUG 2 (US-005 QA) — Colisión de COMUNICACION E1 en el camino normal: el alta
// (US-003/004) crea SIEMPRE una E1 (reserva, E1); la transición sobre una reserva
// que YA tiene su E1 debe HACER UPSERT (no `create`), evitando el P2002 del UNIQUE
// parcial `uq_comunicacion_reserva_codigo`. Tras la operación debe existir EXACTAMENTE
// UNA fila (reserva, E1).
//
// CAMBIO (email-transicion-fecha-borrador): el UPSERT deja la E1 en `borrador` con el
// texto DINÁMICO de la plantilla "disponible" (no el texto viejo hardcodeado) y NO la
// auto-envía (fecha_envio = null, estado NO pasa a `enviado`).
// ===========================================================================

describe('Transición sobre reserva 2.a CON E1 previa → UPSERT a borrador sin P2002 (BUG 2)', () => {
  it('debe_transicionar_a_2b_sin_P2002_y_dejar_exactamente_una_E1_en_borrador_con_la_plantilla_disponible', async () => {
    const { reservaId, clienteId } = await sembrarReservaConCliente({
      estado: EstadoReserva.consulta,
      subEstado: SubEstadoConsulta.s2a,
    });

    // Replica el estado real tras el alta: la RESERVA ya tiene su E1 (respuesta
    // inicial automática enviada en US-003/004).
    await prisma.comunicacion.create({
      data: {
        tenantId: TENANT,
        reservaId,
        clienteId,
        codigoEmail: CodigoEmail.E1,
        asunto: 'Respuesta inicial a tu consulta',
        cuerpo: 'Gracias por tu interés. Te enviamos el dossier inicial.',
        destinatarioEmail: 'origen@us005-int.test',
        estado: EstadoComunicacion.enviado,
        fechaEnvio: new Date('2026-06-01T08:00:00.000Z'),
      },
    });

    // (a) La transición tiene éxito (no P2002 sobre uq_comunicacion_reserva_codigo).
    await useCase.ejecutar(comando(reservaId, { fechaEvento: FECHA_E1_PREVIA }));

    const reserva = await prisma.reserva.findUnique({ where: { idReserva: reservaId } });
    expect(reserva?.subEstado).toBe(SubEstadoConsulta.s2b);

    // (b) Existe EXACTAMENTE UNA fila (reserva, E1): el upsert reutilizó la previa.
    const e1s = await prisma.comunicacion.findMany({
      where: { reservaId, codigoEmail: CodigoEmail.E1 },
    });
    expect(e1s).toHaveLength(1);

    // (c) NUEVO: queda en `borrador`, sin envío (fecha_envio = null), con la plantilla
    //     dinámica "disponible" — no el texto viejo hardcodeado.
    expect(e1s[0]?.estado).toBe(EstadoComunicacion.borrador);
    expect(e1s[0]?.fechaEnvio).toBeNull();
    expect(e1s[0]?.asunto).not.toBe('Hemos reservado provisionalmente tu fecha');
    expect(e1s[0]?.cuerpo).not.toContain('bloqueado provisionalmente la fecha');
    expect(e1s[0]?.cuerpo).toContain('disponible');
    expect(e1s[0]?.cuerpo).toContain("Ari — Masia l'Encís");
  });
});

// ===========================================================================
// RAMA LIBRE (2.a→2.b) — el borrador E1 "disponible" y AUSENCIA de auto-envío.
// (change email-transicion-fecha-borrador — tasks.md §3.2)
// ===========================================================================

describe('Transición LIBRE → borrador E1 "disponible" SIN envío (3.2 email-borrador)', () => {
  it('debe_crear_exactamente_una_E1_en_borrador_con_plantilla_disponible_y_sin_envio', async () => {
    const reservaId = await sembrarReserva({
      estado: EstadoReserva.consulta,
      subEstado: SubEstadoConsulta.s2a,
    });

    await useCase.ejecutar(comando(reservaId, { fechaEvento: FECHA_LIBRE }));

    const e1s = await prisma.comunicacion.findMany({
      where: { reservaId, codigoEmail: CodigoEmail.E1 },
    });
    // Exactamente una E1, en borrador, sin fecha de envío.
    expect(e1s).toHaveLength(1);
    expect(e1s[0]?.estado).toBe(EstadoComunicacion.borrador);
    expect(e1s[0]?.fechaEnvio).toBeNull();
    // Texto de la plantilla "disponible" (redacción dinámica), no el literal viejo.
    expect(e1s[0]?.asunto?.trim().length ?? 0).toBeGreaterThan(0);
    expect(e1s[0]?.cuerpo).toContain('disponible');
    expect(e1s[0]?.cuerpo).toContain("Ari — Masia l'Encís");
    expect(e1s[0]?.cuerpo).not.toContain('bloqueado provisionalmente la fecha');
    // El estado NO puede haber pasado a `enviado`: no hubo auto-envío.
    expect(e1s[0]?.estado).not.toBe(EstadoComunicacion.enviado);
  });
});

// ===========================================================================
// 3.3 — Fecha bloqueada por 2.b → oferta de cola interactiva.
// ===========================================================================

describe('Transición sobre fecha bloqueada por 2.b → cola 2.d (3.3)', () => {
  it('sin_aceptarCola_debe_ofrecer_cola_409_colaDisponible_true_y_dejar_la_reserva_en_2a', async () => {
    await sembrarBloqueante({
      fecha: FECHA_COLA,
      estado: EstadoReserva.consulta,
      subEstado: SubEstadoConsulta.s2b,
    });
    const reservaId = await sembrarReserva({
      estado: EstadoReserva.consulta,
      subEstado: SubEstadoConsulta.s2a,
    });

    const error = await useCase
      .ejecutar(comando(reservaId, { fechaEvento: FECHA_COLA }))
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(AsignarFechaConflictoError);
    expect((error as AsignarFechaConflictoError).colaDisponible).toBe(true);

    // La RESERVA permanece en 2.a y NO se crea un segundo bloqueo.
    const reserva = await prisma.reserva.findUnique({ where: { idReserva: reservaId } });
    expect(reserva?.subEstado).toBe(SubEstadoConsulta.s2a);
    const bloqueos = await prisma.fechaBloqueada.count({
      where: { tenantId: TENANT, fecha: FECHA_COLA },
    });
    expect(bloqueos).toBe(1);

    // NUEVO (email-transicion-fecha-borrador — tasks.md §3.4): sin aceptar la cola
    // (409) no se crea ninguna COMUNICACION para la reserva de origen.
    const comunicaciones = await prisma.comunicacion.count({ where: { reservaId } });
    expect(comunicaciones).toBe(0);
  });

  it('con_aceptarCola_true_debe_pasar_a_s2d_con_posicion_1_y_consulta_bloqueante_sin_nuevo_bloqueo', async () => {
    const bloqueanteId = await sembrarBloqueante({
      fecha: FECHA_COLA,
      estado: EstadoReserva.consulta,
      subEstado: SubEstadoConsulta.s2b,
    });
    const reservaId = await sembrarReserva({
      estado: EstadoReserva.consulta,
      subEstado: SubEstadoConsulta.s2a,
    });

    await useCase.ejecutar(
      comando(reservaId, { fechaEvento: FECHA_COLA, aceptarCola: true }),
    );

    const reserva = await prisma.reserva.findUnique({ where: { idReserva: reservaId } });
    expect(reserva?.subEstado).toBe(SubEstadoConsulta.s2d);
    expect(reserva?.posicionCola).toBe(1);
    expect(reserva?.consultaBloqueanteId).toBe(bloqueanteId);

    const bloqueos = await prisma.fechaBloqueada.count({
      where: { tenantId: TENANT, fecha: FECHA_COLA },
    });
    expect(bloqueos).toBe(1);
  });

  // NUEVO (email-transicion-fecha-borrador — tasks.md §3.3): la rama cola ahora
  // TAMBIÉN crea su borrador E1 con la plantilla "cola" (antes no creaba correo).
  it('con_aceptarCola_true_debe_crear_una_E1_en_borrador_con_plantilla_cola_y_sin_envio', async () => {
    await sembrarBloqueante({
      fecha: FECHA_COLA,
      estado: EstadoReserva.consulta,
      subEstado: SubEstadoConsulta.s2b,
    });
    const reservaId = await sembrarReserva({
      estado: EstadoReserva.consulta,
      subEstado: SubEstadoConsulta.s2a,
    });

    await useCase.ejecutar(
      comando(reservaId, { fechaEvento: FECHA_COLA, aceptarCola: true }),
    );

    const e1s = await prisma.comunicacion.findMany({
      where: { reservaId, codigoEmail: CodigoEmail.E1 },
    });
    expect(e1s).toHaveLength(1);
    expect(e1s[0]?.estado).toBe(EstadoComunicacion.borrador);
    expect(e1s[0]?.fechaEnvio).toBeNull();
    expect(e1s[0]?.asunto?.trim().length ?? 0).toBeGreaterThan(0);
    // Frase clave de la plantilla "cola" (castellano por defecto: reserva sin idioma 'ca').
    expect(e1s[0]?.cuerpo).toContain('bloqueada por otra consulta');
    expect(e1s[0]?.cuerpo).toContain("Ari — Masia l'Encís");
    expect(e1s[0]?.estado).not.toBe(EstadoComunicacion.enviado);
  });
});

// ===========================================================================
// 3.4 — Fecha bloqueada por estado no encolable (pre_reserva) → sin cola, 2.a.
// ===========================================================================

describe('Transición sobre fecha bloqueada por pre_reserva → sin cola, permanece 2.a (3.4)', () => {
  it('debe_rechazar_409_colaDisponible_false_y_no_mutar_la_reserva', async () => {
    await sembrarBloqueante({
      fecha: FECHA_NO_DISP,
      estado: EstadoReserva.pre_reserva,
      subEstado: null,
    });
    const reservaId = await sembrarReserva({
      estado: EstadoReserva.consulta,
      subEstado: SubEstadoConsulta.s2a,
    });

    const error = await useCase
      .ejecutar(comando(reservaId, { fechaEvento: FECHA_NO_DISP, aceptarCola: true }))
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(AsignarFechaConflictoError);
    expect((error as AsignarFechaConflictoError).colaDisponible).toBe(false);

    const reserva = await prisma.reserva.findUnique({ where: { idReserva: reservaId } });
    expect(reserva?.subEstado).toBe(SubEstadoConsulta.s2a);
    expect(reserva?.fechaEvento).toBeNull();
    const bloqueos = await prisma.fechaBloqueada.count({
      where: { tenantId: TENANT, fecha: FECHA_NO_DISP },
    });
    expect(bloqueos).toBe(1);

    // NUEVO (email-transicion-fecha-borrador — tasks.md §3.4): el caso NO encolable no
    // crea ninguna COMUNICACION (ni borrador ni enviada) para la reserva de origen.
    const comunicaciones = await prisma.comunicacion.count({ where: { reservaId } });
    expect(comunicaciones).toBe(0);
  });
});

// ===========================================================================
// Guarda de origen (3.1) — RESERVA no en 2.a → 4xx sin efectos.
// ===========================================================================

describe('Transición sobre RESERVA no en 2.a → rechazo sin efectos (3.1)', () => {
  it('debe_rechazar_con_validacion_cuando_la_reserva_ya_esta_en_2b_y_no_mutar_nada', async () => {
    const reservaId = await sembrarReserva({
      estado: EstadoReserva.consulta,
      subEstado: SubEstadoConsulta.s2b,
      fechaEvento: FECHA_GUARDA,
    });

    await expect(
      useCase.ejecutar(comando(reservaId, { fechaEvento: FECHA_LIBRE })),
    ).rejects.toBeInstanceOf(TransicionFechaValidacionError);

    // No se crea ninguna FECHA_BLOQUEADA sobre la fecha solicitada.
    const bloqueos = await prisma.fechaBloqueada.count({
      where: { tenantId: TENANT, fecha: FECHA_LIBRE },
    });
    expect(bloqueos).toBe(0);
  });
});

// ===========================================================================
// 3.6 — Validación de fecha en servidor: hoy → 4xx sin efectos.
// ===========================================================================

describe('Transición — validación de fecha `> hoy` (3.6)', () => {
  it('debe_rechazar_fecha_igual_a_hoy_sin_mutar_la_reserva_ni_crear_bloqueo', async () => {
    const reservaId = await sembrarReserva({
      estado: EstadoReserva.consulta,
      subEstado: SubEstadoConsulta.s2a,
    });

    await expect(
      useCase.ejecutar(comando(reservaId, { fechaEvento: hoyUtc() })),
    ).rejects.toBeInstanceOf(TransicionFechaValidacionError);

    const reserva = await prisma.reserva.findUnique({ where: { idReserva: reservaId } });
    expect(reserva?.subEstado).toBe(SubEstadoConsulta.s2a);
    const bloqueos = await prisma.fechaBloqueada.count({
      where: { tenantId: TENANT, fecha: hoyUtc() },
    });
    expect(bloqueos).toBe(0);
  });
});

// ===========================================================================
// Multi-tenancy / RLS — un tenant no puede transicionar la RESERVA de otro (404).
// ===========================================================================

describe('Transición — aislamiento multi-tenant / RLS', () => {
  it('debe_lanzar_ReservaNoEncontrada_cuando_el_tenant_del_jwt_no_es_dueno_de_la_reserva', async () => {
    // RESERVA del TENANT piloto; se intenta transicionar desde OTRO_TENANT.
    const reservaId = await sembrarReserva({
      estado: EstadoReserva.consulta,
      subEstado: SubEstadoConsulta.s2a,
    });

    await expect(
      useCase.ejecutar({
        tenantId: OTRO_TENANT,
        usuarioId: GESTOR,
        reservaId,
        fechaEvento: FECHA_TENANT,
      }),
    ).rejects.toBeInstanceOf(ReservaNoEncontradaError);

    // La RESERVA del tenant legítimo no se ha tocado.
    const reserva = await prisma.reserva.findUnique({ where: { idReserva: reservaId } });
    expect(reserva?.subEstado).toBe(SubEstadoConsulta.s2a);
    const bloqueos = await prisma.fechaBloqueada.count({
      where: { fecha: FECHA_TENANT },
    });
    expect(bloqueos).toBe(0);
  });
});
