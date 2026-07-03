/**
 * TESTS DE INTEGRACIÓN de la transición «resultado de visita — reserva inmediata»
 * (`2.v` → `pre_reserva`) (US-010 / UC-08 FA-08 / UC-14) — fase TDD RED. tasks.md
 * Fase 3: 3.1 (guarda de origen → 422), 3.2 (datos obligatorios UC-14 → 422 con
 * camposFaltantes, RESERVA intacta), 3.3 (transición + UPDATE FECHA_BLOQUEADA a 7d +
 * AUDIT_LOG + sin email), 3.4 (vaciado de cola A16), multi-tenancy/RLS.
 *
 * Trazabilidad: US-010, spec-delta `consultas` (Requirements de la transición a
 * pre_reserva, validación de datos obligatorios UC-14, UPDATE del ttl de FECHA_BLOQUEADA
 * a 7d con tipo_bloqueo blando, vaciado de cola A16, guarda de origen mono-estado,
 * atomicidad, auditoría `transicion`); design.md §D-1..§D-5.
 *
 * INTEGRACIÓN REAL contra el Postgres del docker-compose / slotify_test (no mocks): el
 * caso de uso se resuelve por DI (`ReservasModule`) y se verifica el ESTADO DE LA BD
 * tras la transición. Mismo enfoque que `resultado-visita-interesado-integracion.spec.ts`
 * (US-009). Requiere `docker compose up -d postgres` + migración + seed (tenant piloto
 * con `ttl_prereserva_dias = 7`).
 *
 * El TTL se valida como `now + ttl_prereserva_dias` (7 días), independiente del TTL previo
 * de 2.v y de la fecha de visita. Las fechas de EVENTO son fijas y lejanas, aisladas por
 * patrón de email.
 *
 * RED: hoy `registrar-resultado-visita.use-case.ts` RECHAZA `reserva_inmediata` con 422
 * (solo `interesado`). La transición a pre_reserva no existe todavía; la batería está en
 * ROJO por AUSENCIA DE IMPLEMENTACIÓN (no por infraestructura: el Postgres está arriba,
 * como en las suites de US-004/005/007/008/009). GREEN es de `backend-developer`.
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
  ReservaNoEncontradaError,
  DatosObligatoriosIncompletosError,
  type RegistrarResultadoVisitaComando,
} from '../application/registrar-resultado-visita.use-case';

const TENANT = '00000000-0000-0000-0000-000000000001';
const OTRO_TENANT = '00000000-0000-0000-0000-0000000000ff';
const GESTOR = '00000000-0000-0000-0000-000000000002';
const EMAIL_PATTERN = '@us010-int.test';
const DIA_MS = 24 * 60 * 60 * 1000;
/** ttl_prereserva_dias del tenant piloto sembrado (default del modelo = 7). */
const TTL_PRERESERVA_DIAS = 7;
/** Tolerancia (ms) al comparar el TTL con `now` real de la transición. */
const TOLERANCIA_MS = 60 * 1000;

// Fechas de EVENTO (a bloquear) fijas, futuras y aisladas (una por escenario).
const FECHA_OK = new Date('2028-07-01T00:00:00.000Z');
const FECHA_COLA = new Date('2028-07-02T00:00:00.000Z');
const FECHA_SIN_DATOS = new Date('2028-07-03T00:00:00.000Z');
const FECHA_NO_2V = new Date('2028-07-04T00:00:00.000Z');
const FECHA_TENANT = new Date('2028-07-05T00:00:00.000Z');
const FECHAS = [FECHA_OK, FECHA_COLA, FECHA_SIN_DATOS, FECHA_NO_2V, FECHA_TENANT];

const ttlDiaPostVisita = (): Date => new Date(Date.now() - DIA_MS); // TTL previo de 2.v

let moduleRef: TestingModule;
let prisma: PrismaService;
let useCase: RegistrarResultadoVisitaUseCase;

const sufijo = (): string => Math.random().toString(36).slice(2, 8);

const comando = (
  reservaId: string,
  over: Partial<RegistrarResultadoVisitaComando> = {},
): RegistrarResultadoVisitaComando => ({
  tenantId: TENANT,
  usuarioId: GESTOR,
  reservaId,
  resultado: 'reserva_inmediata',
  ...over,
});

/**
 * Siembra una RESERVA (origen de la transición) con su CLIENTE fiscalmente completo y su
 * fila de FECHA_BLOQUEADA (que SIEMPRE existe al venir de 2.v). Por defecto en
 * `consulta`/`2v`, visita_realizada=false, con TTL previo = día post-visita y datos
 * obligatorios UC-14 completos.
 */
const sembrarReserva = async (params: {
  fecha: Date;
  estado?: EstadoReserva;
  subEstado?: SubEstadoConsulta | null;
  conBloqueo?: boolean;
  clienteIncompleto?: boolean;
  reservaSinDatos?: boolean;
  tenantId?: string;
}): Promise<{ reservaId: string; clienteId: string }> => {
  const tenantId = params.tenantId ?? TENANT;
  const cliente = await prisma.cliente.create({
    data: {
      tenantId,
      nombre: 'Lead',
      email: `lead-${sufijo()}${EMAIL_PATTERN}`,
      // Datos fiscales UC-14 (omitidos si clienteIncompleto).
      dniNif: params.clienteIncompleto ? null : '12345678Z',
      direccion: params.clienteIncompleto ? null : 'C/ Mayor 1',
      codigoPostal: params.clienteIncompleto ? null : '08001',
      poblacion: params.clienteIncompleto ? null : 'Barcelona',
      provincia: params.clienteIncompleto ? null : 'Barcelona',
    },
  });
  const reserva = await prisma.reserva.create({
    data: {
      tenantId,
      clienteId: cliente.idCliente,
      codigo: `TST-U010-${sufijo()}`,
      estado: params.estado ?? EstadoReserva.consulta,
      subEstado:
        params.subEstado === undefined ? SubEstadoConsulta.s2v : params.subEstado,
      canalEntrada: CanalEntrada.web,
      fechaEvento: params.fecha,
      // Datos de RESERVA UC-14 (omitidos si reservaSinDatos).
      duracionHoras: params.reservaSinDatos ? null : DuracionHoras.h8,
      tipoEvento: params.reservaSinDatos ? null : TipoEvento.boda,
      numAdultosNinosMayores4: params.reservaSinDatos ? null : 40,
      numNinosMenores4: 5,
      visitaProgramadaFecha: new Date(params.fecha),
      visitaProgramadaHora: '17:30',
      visitaRealizada: false,
      ttlExpiracion: ttlDiaPostVisita(),
    },
  });
  if (params.conBloqueo !== false) {
    await prisma.fechaBloqueada.create({
      data: {
        tenantId,
        fecha: params.fecha,
        reservaId: reserva.idReserva,
        tipoBloqueo: TipoBloqueo.blando,
        ttlExpiracion: ttlDiaPostVisita(),
      },
    });
  }
  return { reservaId: reserva.idReserva, clienteId: cliente.idCliente };
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
      data: { tenantId: TENANT, nombre: `Cola${i}`, email: `cola-${sufijo()}${EMAIL_PATTERN}` },
    });
    const enCola = await prisma.reserva.create({
      data: {
        tenantId: TENANT,
        clienteId: cliente.idCliente,
        codigo: `TST-U010Q-${sufijo()}`,
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
// 3.3 — Happy path desde 2.v con datos completos y sin cola: → pre_reserva +
//        subEstado=NULL + visita_realizada=true + TTL de 7 días (now +
//        ttl_prereserva_dias) + UPDATE del ttl de la MISMA fila de FECHA_BLOQUEADA al
//        mismo valor (blando) + AUDIT_LOG transicion + SIN email.
// ===========================================================================

describe('Reserva inmediata desde 2.v → pre_reserva sin cola (3.3)', () => {
  it('debe_pasar_a_pre_reserva_subEstado_null_visita_true_ttl_7d_actualizar_bloqueo_y_auditar', async () => {
    const { reservaId } = await sembrarReserva({ fecha: FECHA_OK });
    const antes = Date.now();

    const out = await useCase.ejecutar(comando(reservaId));
    expect(out.reserva.estado).toBe('pre_reserva');

    const reserva = await prisma.reserva.findUnique({ where: { idReserva: reservaId } });
    expect(reserva?.estado).toBe(EstadoReserva.pre_reserva);
    expect(reserva?.subEstado).toBeNull();
    expect(reserva?.visitaRealizada).toBe(true);

    // TTL de 7 días: now + ttl_prereserva_dias (con tolerancia por el `now` real).
    const esperado = antes + TTL_PRERESERVA_DIAS * DIA_MS;
    const ttlReserva = reserva?.ttlExpiracion?.getTime() ?? 0;
    expect(Math.abs(ttlReserva - esperado)).toBeLessThan(TOLERANCIA_MS + DIA_MS);

    // FECHA_BLOQUEADA: la MISMA fila se actualiza al MISMO valor de TTL; blando; sin
    // crear ni borrar filas.
    const bloqueos = await prisma.fechaBloqueada.findMany({
      where: { tenantId: TENANT, fecha: FECHA_OK },
    });
    expect(bloqueos).toHaveLength(1);
    expect(bloqueos[0].tipoBloqueo).toBe(TipoBloqueo.blando);
    expect(bloqueos[0].reservaId).toBe(reservaId);
    expect(bloqueos[0].ttlExpiracion?.getTime()).toBe(ttlReserva);

    // AUDIT_LOG de la transición 2.v → pre_reserva con datos antes/después.
    const audit = await prisma.auditLog.findFirst({
      where: { tenantId: TENANT, entidadId: reservaId, accion: 'transicion' },
    });
    expect(audit).not.toBeNull();
    const anteriores = audit?.datosAnteriores as { subEstado?: string };
    const nuevos = audit?.datosNuevos as {
      estado?: string;
      subEstado?: string | null;
      visitaRealizada?: boolean;
    };
    expect(anteriores?.subEstado).toBe('2v');
    expect(nuevos?.estado).toBe('pre_reserva');
    expect(nuevos?.subEstado ?? null).toBeNull();
    expect(nuevos?.visitaRealizada).toBe(true);

    // SIN email propio (a diferencia de US-009): no hay COMUNICACION para esta reserva.
    const com = await prisma.comunicacion.findFirst({
      where: { tenantId: TENANT, reservaId },
    });
    expect(com).toBeNull();
  });
});

// ===========================================================================
// 3.4 — Happy path con cola activa: N consultas en 2.d apuntando a la bloqueante → todas
//        pasan a 2.y (posicion_cola=NULL, consulta_bloqueante_id=NULL) en la misma tx;
//        AUDIT_LOG por cada consulta vaciada; ninguna 2.d queda apuntando a la reserva.
// ===========================================================================

describe('Reserva inmediata con cola activa — vaciado A16 (3.4)', () => {
  it('debe_vaciar_la_cola_a_2y_y_auditar_cada_consulta_al_pasar_a_pre_reserva', async () => {
    const { reservaId } = await sembrarReserva({ fecha: FECHA_COLA });
    const idsCola = await sembrarCola({
      fecha: FECHA_COLA,
      bloqueanteId: reservaId,
      cantidad: 3,
    });

    await useCase.ejecutar(comando(reservaId));

    // La bloqueante quedó en pre_reserva.
    const reserva = await prisma.reserva.findUnique({ where: { idReserva: reservaId } });
    expect(reserva?.estado).toBe(EstadoReserva.pre_reserva);

    // Todas las consultas de la cola pasaron a 2.y con vínculo NULLeado.
    const cola = await prisma.reserva.findMany({
      where: { idReserva: { in: idsCola } },
    });
    for (const c of cola) {
      expect(c.subEstado).toBe(SubEstadoConsulta.s2y);
      expect(c.posicionCola).toBeNull();
      expect(c.consultaBloqueanteId).toBeNull();
    }

    // Ninguna 2.d apuntando a la reserva transitada.
    const restantes2d = await prisma.reserva.count({
      where: {
        tenantId: TENANT,
        consultaBloqueanteId: reservaId,
        subEstado: SubEstadoConsulta.s2d,
      },
    });
    expect(restantes2d).toBe(0);

    // AUDIT_LOG por cada consulta vaciada (2d → 2y).
    for (const idCola of idsCola) {
      const audit = await prisma.auditLog.findFirst({
        where: { tenantId: TENANT, entidadId: idCola, accion: 'transicion' },
      });
      expect(audit).not.toBeNull();
      const nuevos = audit?.datosNuevos as { subEstado?: string };
      expect(nuevos?.subEstado).toBe('2y');
    }
  });

  it('debe_completar_la_transicion_cuando_la_cola_esta_vacia_sin_error', async () => {
    const { reservaId } = await sembrarReserva({ fecha: FECHA_OK });

    await useCase.ejecutar(comando(reservaId));

    const reserva = await prisma.reserva.findUnique({ where: { idReserva: reservaId } });
    expect(reserva?.estado).toBe(EstadoReserva.pre_reserva);
  });
});

// ===========================================================================
// 3.2 — FA datos obligatorios incompletos: falta un dato → 422 con camposFaltantes;
//        RESERVA intacta en 2.v (estado, ttl, FECHA_BLOQUEADA y cola sin cambios).
// ===========================================================================

describe('Reserva inmediata — datos obligatorios incompletos → 422 sin efectos (3.2)', () => {
  it('debe_rechazar_con_camposFaltantes_y_dejar_la_reserva_intacta_en_2v_cuando_falta_dni', async () => {
    const { reservaId } = await sembrarReserva({
      fecha: FECHA_SIN_DATOS,
      clienteIncompleto: true, // falta dni_nif y resto de datos fiscales
    });
    const bloqueoAntes = await prisma.fechaBloqueada.findFirst({
      where: { tenantId: TENANT, fecha: FECHA_SIN_DATOS },
    });

    await expect(useCase.ejecutar(comando(reservaId))).rejects.toBeInstanceOf(
      DatosObligatoriosIncompletosError,
    );

    // RESERVA intacta: sigue en consulta/2v, visita_realizada=false.
    const reserva = await prisma.reserva.findUnique({ where: { idReserva: reservaId } });
    expect(reserva?.estado).toBe(EstadoReserva.consulta);
    expect(reserva?.subEstado).toBe(SubEstadoConsulta.s2v);
    expect(reserva?.visitaRealizada).toBe(false);

    // FECHA_BLOQUEADA sin cambios (mismo TTL previo).
    const bloqueoDespues = await prisma.fechaBloqueada.findFirst({
      where: { tenantId: TENANT, fecha: FECHA_SIN_DATOS },
    });
    expect(bloqueoDespues?.ttlExpiracion?.getTime()).toBe(
      bloqueoAntes?.ttlExpiracion?.getTime(),
    );
  });
});

// ===========================================================================
// 3.1 — Guarda de origen: RESERVA no en 2.v (p. ej. 2.b) → 422; RESERVA intacta.
// ===========================================================================

describe('Reserva inmediata — origen no en 2.v → 422 (3.1)', () => {
  it('debe_rechazar_con_validacion_y_dejar_la_reserva_intacta_cuando_esta_en_2b', async () => {
    const { reservaId } = await sembrarReserva({
      fecha: FECHA_NO_2V,
      subEstado: SubEstadoConsulta.s2b,
    });

    await expect(useCase.ejecutar(comando(reservaId))).rejects.toBeInstanceOf(
      ResultadoVisitaValidacionError,
    );

    const reserva = await prisma.reserva.findUnique({ where: { idReserva: reservaId } });
    expect(reserva?.subEstado).toBe(SubEstadoConsulta.s2b);
    expect(reserva?.estado).toBe(EstadoReserva.consulta);
  });
});

// ===========================================================================
// Multi-tenancy / RLS — un tenant no puede transicionar la RESERVA de otro (404).
// ===========================================================================

describe('Reserva inmediata — aislamiento multi-tenant / RLS', () => {
  it('debe_lanzar_ReservaNoEncontrada_cuando_el_tenant_del_jwt_no_es_dueno', async () => {
    const { reservaId } = await sembrarReserva({ fecha: FECHA_TENANT });

    await expect(
      useCase.ejecutar(comando(reservaId, { tenantId: OTRO_TENANT })),
    ).rejects.toBeInstanceOf(ReservaNoEncontradaError);

    const reserva = await prisma.reserva.findUnique({ where: { idReserva: reservaId } });
    expect(reserva?.subEstado).toBe(SubEstadoConsulta.s2v);
    expect(reserva?.estado).toBe(EstadoReserva.consulta);
  });
});
