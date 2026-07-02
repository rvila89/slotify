/**
 * TESTS DE INTEGRACIÓN de la vista de cola de espera (`GET /reservas/{id}/cola`,
 * US-017 / UC-11, SOLO LECTURA) — fase TDD RED. tasks.md Fase 3: 3.2 (proyección real),
 * 3.3 (filtrado: solo s2d + consulta_bloqueante_id; excluye bloqueante y terminales),
 * 3.4 (los 5 FA sobre BD real), 3.5 (aislamiento multi-tenant RLS).
 *
 * Trazabilidad: US-017, spec-delta `consultas` (Requirements: bloqueante+cola FIFO;
 * ordenación FIFO estricta ASC por posicion_cola; filtrado s2d + consulta_bloqueante_id
 * excluyendo la bloqueante y terminales 2x/2y/2z; TTL restante / tiempo en cola desde
 * instantes; FA-01 sin cola; FA-02 2c; FA-03 2v con visitaProgramadaFecha; FA-04 fecha
 * disponible → estaBloqueada:false; FA-05 cola de 1; aislamiento multi-tenant RLS);
 * design.md §D-3 (FA-04), §D-6 (adaptador reutiliza el patrón de ColaQueryPrismaAdapter:
 * RLS fijarTenant, filtro s2d + consulta_bloqueante_id, ORDER BY posicion_cola ASC),
 * §D-7 (lectura pura; sin concurrencia ni mutación).
 *
 * INTEGRACIÓN REAL contra el Postgres AISLADO de tests (`slotify_test`, `.env.test`;
 * memoria "Tests con BD aislada slotify_test"): el query se resuelve por DI del
 * `ReservasModule` y se verifica la forma del read model, el filtrado/orden FIFO y el
 * aislamiento RLS. Lectura PURA: NO muta estado, NO registra AUDIT_LOG (se verifica que
 * la BD no cambia). La suite limpia su propio sembrado (fechas de evento propias).
 *
 * NO hay tests de concurrencia (lectura pura, design.md §D-7).
 *
 * RED: aún NO existen `application/obtener-cola-espera.query.ts`, su puerto, ni el
 * adaptador `infrastructure/cola-espera-query.prisma.adapter.ts` (ni su binding en
 * `reservas.module.ts`). Los imports/símbolos fallan y la batería está en ROJO por
 * AUSENCIA DE IMPLEMENTACIÓN. GREEN es de `backend-developer`.
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
  ObtenerColaEsperaUseCase,
  ColaEsperaNoEncontradaError,
} from '../application/obtener-cola-espera.query';

const TENANT = '00000000-0000-0000-0000-000000000001';
const OTRO_TENANT = '00000000-0000-0000-0000-0000000000ff';
const EMAIL_PATTERN = '@us017-cola.test';

// Fechas de EVENTO aisladas por escenario (futuras; no colisionan con otras suites).
const F_HAPPY = new Date('2029-07-01T00:00:00.000Z');
const F_FILTRADO = new Date('2029-07-02T00:00:00.000Z');
const F_SIN_COLA = new Date('2029-07-03T00:00:00.000Z');
const F_2C = new Date('2029-07-04T00:00:00.000Z');
const F_2V = new Date('2029-07-05T00:00:00.000Z');
const F_UNO = new Date('2029-07-06T00:00:00.000Z');
const F_DISPONIBLE = new Date('2029-07-07T00:00:00.000Z');
const F_TENANT = new Date('2029-07-08T00:00:00.000Z');
const TODAS = [
  F_HAPPY,
  F_FILTRADO,
  F_SIN_COLA,
  F_2C,
  F_2V,
  F_UNO,
  F_DISPONIBLE,
  F_TENANT,
];

let moduleRef: TestingModule;
let prisma: PrismaService;
let useCase: ObtenerColaEsperaUseCase;

const sufijo = (): string => Math.random().toString(36).slice(2, 8);

const crearCliente = (nombre: string, tenantId: string): Promise<{ idCliente: string }> =>
  prisma.cliente.create({
    data: { tenantId, nombre, email: `c-${sufijo()}${EMAIL_PATTERN}` },
  });

/**
 * Siembra una BLOQUEANTE con su FECHA_BLOQUEADA activa (tipo blando, ttl futuro) y su
 * cola de N reservas en s2d apuntando a ella (posiciones 1..N por defecto). Devuelve
 * los ids en orden de posición y el id de la bloqueante.
 */
const sembrarBloqueanteConCola = async (params: {
  fecha: Date;
  subEstadoBloqueante: SubEstadoConsulta;
  ttlExpiracion?: Date;
  visitaProgramadaFecha?: Date;
  colaCreadaHace?: number[]; // ms de antigüedad de cada elemento de la cola.
  tenantId?: string;
}): Promise<{ bloqueanteId: string; colaIds: string[] }> => {
  const tenantId = params.tenantId ?? TENANT;
  const ttl = params.ttlExpiracion ?? new Date(Date.now() + 22 * 60 * 60 * 1000);
  const clienteBloq = await crearCliente('Bloqueante', tenantId);
  const bloqueante = await prisma.reserva.create({
    data: {
      tenantId,
      clienteId: clienteBloq.idCliente,
      codigo: `TST-U017-B-${sufijo()}`,
      estado: EstadoReserva.consulta,
      subEstado: params.subEstadoBloqueante,
      canalEntrada: CanalEntrada.web,
      fechaEvento: params.fecha,
      ttlExpiracion: ttl,
      ...(params.visitaProgramadaFecha !== undefined
        ? { visitaProgramadaFecha: params.visitaProgramadaFecha }
        : {}),
    },
  });
  await prisma.fechaBloqueada.create({
    data: {
      tenantId,
      fecha: params.fecha,
      reservaId: bloqueante.idReserva,
      tipoBloqueo: TipoBloqueo.blando,
      ttlExpiracion: ttl,
    },
  });
  const antiguedades = params.colaCreadaHace ?? [];
  const colaIds: string[] = [];
  for (let i = 0; i < antiguedades.length; i += 1) {
    const cliente = await crearCliente(`Cola ${i + 1}`, tenantId);
    const r = await prisma.reserva.create({
      data: {
        tenantId,
        clienteId: cliente.idCliente,
        codigo: `TST-U017-Q-${sufijo()}`,
        estado: EstadoReserva.consulta,
        subEstado: SubEstadoConsulta.s2d,
        canalEntrada: CanalEntrada.web,
        fechaEvento: params.fecha,
        consultaBloqueanteId: bloqueante.idReserva,
        posicionCola: i + 1,
        fechaCreacion: new Date(Date.now() - antiguedades[i]),
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
  useCase = moduleRef.get(ObtenerColaEsperaUseCase);
});

afterAll(async () => {
  await limpiar();
  await moduleRef.close();
});

beforeEach(async () => {
  await limpiar();
});

// ===========================================================================
// Happy path del spec — bloqueante 2b + R2 (pos1, hace 2 h) + R3 (pos2, hace 30 min),
//   TTL ≈ 22 h. Proyección real: bloqueante con cliente/subEstado/ttl + cola FIFO con
//   tiempos derivados de instantes.
// ===========================================================================

describe('GET cola — happy path (bloqueante 2b + dos en cola)', () => {
  it('debe_proyectar_la_bloqueante_y_la_cola_ordenada_con_ttl_y_tiempos', async () => {
    const { bloqueanteId, colaIds } = await sembrarBloqueanteConCola({
      fecha: F_HAPPY,
      subEstadoBloqueante: SubEstadoConsulta.s2b,
      colaCreadaHace: [2 * 60 * 60 * 1000, 30 * 60 * 1000], // 2 h y 30 min.
    });
    const [r2, r3] = colaIds;

    const cola = await useCase.ejecutar({ tenantId: TENANT, reservaId: bloqueanteId });

    expect(cola.estaBloqueada).toBe(true);
    expect(cola.bloqueante?.idReserva).toBe(bloqueanteId);
    expect(cola.bloqueante?.subEstado).toBe('2b');
    expect(cola.bloqueante?.clienteNombre).toBe('Bloqueante');
    expect(cola.bloqueante?.ttlExpiracion).not.toBeNull();
    expect(cola.bloqueante?.ttlRestante).not.toBeNull(); // derivado de ttl − now().

    expect(cola.cola.map((c) => c.idReserva)).toEqual([r2, r3]);
    expect(cola.cola.map((c) => c.posicionCola)).toEqual([1, 2]);
    expect(cola.cola[0].tiempoEnCola).not.toBeNull(); // derivado de now() − fecha_creacion.
  });
});

// ===========================================================================
// Filtrado + orden FIFO estricto (3.3): solo s2d apuntando a la bloqueante, ordenadas
//   ASC por posicion_cola; la propia bloqueante y una terminal 2y quedan EXCLUIDAS; una
//   reserva 2d de OTRA bloqueante/fecha NO aparece.
//   spec-delta: "Solo se listan RESERVA en 2.d apuntando a la bloqueante, ordenadas por posición".
// ===========================================================================

describe('GET cola — filtrado y orden FIFO estricto', () => {
  it('debe_listar_solo_s2d_de_esta_bloqueante_ordenadas_por_posicion_y_excluir_terminales_y_la_bloqueante', async () => {
    // Bloqueante + dos en cola SEMBRADAS DESORDENADAS (pos 2 primero, pos 1 después).
    const clienteBloq = await crearCliente('Bloqueante', TENANT);
    const bloqueante = await prisma.reserva.create({
      data: {
        tenantId: TENANT,
        clienteId: clienteBloq.idCliente,
        codigo: `TST-U017-B-${sufijo()}`,
        estado: EstadoReserva.consulta,
        subEstado: SubEstadoConsulta.s2b,
        canalEntrada: CanalEntrada.web,
        fechaEvento: F_FILTRADO,
        ttlExpiracion: new Date(Date.now() + 20 * 60 * 60 * 1000),
      },
    });
    await prisma.fechaBloqueada.create({
      data: {
        tenantId: TENANT,
        fecha: F_FILTRADO,
        reservaId: bloqueante.idReserva,
        tipoBloqueo: TipoBloqueo.blando,
        ttlExpiracion: new Date(Date.now() + 20 * 60 * 60 * 1000),
      },
    });
    const crearEnCola = async (pos: number): Promise<string> => {
      const c = await crearCliente(`Cola pos ${pos}`, TENANT);
      const r = await prisma.reserva.create({
        data: {
          tenantId: TENANT,
          clienteId: c.idCliente,
          codigo: `TST-U017-Q-${sufijo()}`,
          estado: EstadoReserva.consulta,
          subEstado: SubEstadoConsulta.s2d,
          canalEntrada: CanalEntrada.web,
          fechaEvento: F_FILTRADO,
          consultaBloqueanteId: bloqueante.idReserva,
          posicionCola: pos,
        },
      });
      return r.idReserva;
    };
    const r_pos2 = await crearEnCola(2);
    const r_pos1 = await crearEnCola(1);

    // Ruido excluible: una terminal 2y que antes estuvo en cola apuntando a la bloqueante.
    const cTerm = await crearCliente('Terminal', TENANT);
    await prisma.reserva.create({
      data: {
        tenantId: TENANT,
        clienteId: cTerm.idCliente,
        codigo: `TST-U017-T-${sufijo()}`,
        estado: EstadoReserva.consulta,
        subEstado: SubEstadoConsulta.s2y,
        canalEntrada: CanalEntrada.web,
        fechaEvento: F_FILTRADO,
        consultaBloqueanteId: bloqueante.idReserva,
      },
    });

    const cola = await useCase.ejecutar({
      tenantId: TENANT,
      reservaId: bloqueante.idReserva,
    });

    // Orden ASC por posicion: pos1 primero (r_pos1), luego pos2 (r_pos2).
    expect(cola.cola.map((c) => c.posicionCola)).toEqual([1, 2]);
    expect(cola.cola.map((c) => c.idReserva)).toEqual([r_pos1, r_pos2]);
    // La terminal 2y y la propia bloqueante NO aparecen en la cola.
    const idsEnCola = cola.cola.map((c) => c.idReserva);
    expect(idsEnCola).not.toContain(bloqueante.idReserva);
    expect(cola.cola).toHaveLength(2);
  });
});

// ===========================================================================
// FA-01 — bloqueante sin cola: sección bloqueante presente, cola:[].
// ===========================================================================

describe('GET cola — FA-01 bloqueante sin consultas en cola', () => {
  it('debe_devolver_la_bloqueante_y_una_cola_vacia', async () => {
    const { bloqueanteId } = await sembrarBloqueanteConCola({
      fecha: F_SIN_COLA,
      subEstadoBloqueante: SubEstadoConsulta.s2b,
      colaCreadaHace: [],
    });

    const cola = await useCase.ejecutar({ tenantId: TENANT, reservaId: bloqueanteId });

    expect(cola.estaBloqueada).toBe(true);
    expect(cola.bloqueante?.idReserva).toBe(bloqueanteId);
    expect(cola.cola).toEqual([]);
  });
});

// ===========================================================================
// FA-02 — bloqueante en 2.c con una consulta en cola.
// ===========================================================================

describe('GET cola — FA-02 bloqueante en 2c', () => {
  it('debe_proyectar_subEstado_2c_con_ttl_y_la_cola_con_el_mismo_formato', async () => {
    const { bloqueanteId, colaIds } = await sembrarBloqueanteConCola({
      fecha: F_2C,
      subEstadoBloqueante: SubEstadoConsulta.s2c,
      colaCreadaHace: [45 * 60 * 1000],
    });

    const cola = await useCase.ejecutar({ tenantId: TENANT, reservaId: bloqueanteId });

    expect(cola.bloqueante?.subEstado).toBe('2c');
    expect(cola.bloqueante?.ttlRestante).not.toBeNull();
    expect(cola.cola).toHaveLength(1);
    expect(cola.cola[0].idReserva).toBe(colaIds[0]);
    expect(cola.cola[0].posicionCola).toBe(1);
  });
});

// ===========================================================================
// FA-03 — bloqueante en 2.v: incluye visitaProgramadaFecha + TTL vigente.
// ===========================================================================

describe('GET cola — FA-03 bloqueante en 2v con visita programada', () => {
  it('debe_incluir_visitaProgramadaFecha_y_ttl_vigente', async () => {
    const visita = new Date('2029-06-30T00:00:00.000Z');
    const { bloqueanteId } = await sembrarBloqueanteConCola({
      fecha: F_2V,
      subEstadoBloqueante: SubEstadoConsulta.s2v,
      visitaProgramadaFecha: visita,
      colaCreadaHace: [10 * 60 * 1000],
    });

    const cola = await useCase.ejecutar({ tenantId: TENANT, reservaId: bloqueanteId });

    expect(cola.bloqueante?.subEstado).toBe('2v');
    expect(cola.bloqueante?.visitaProgramadaFecha).toEqual(visita);
    expect(cola.bloqueante?.ttlRestante).not.toBeNull();
    expect(cola.cola).toHaveLength(1);
  });
});

// ===========================================================================
// FA-05 — cola de UN único elemento (posicion 1).
// ===========================================================================

describe('GET cola — FA-05 cola de un único elemento', () => {
  it('debe_proyectar_la_bloqueante_y_exactamente_un_elemento_en_posicion_1', async () => {
    const { bloqueanteId, colaIds } = await sembrarBloqueanteConCola({
      fecha: F_UNO,
      subEstadoBloqueante: SubEstadoConsulta.s2b,
      colaCreadaHace: [15 * 60 * 1000],
    });

    const cola = await useCase.ejecutar({ tenantId: TENANT, reservaId: bloqueanteId });

    expect(cola.cola).toHaveLength(1);
    expect(cola.cola[0].posicionCola).toBe(1);
    expect(cola.cola[0].idReserva).toBe(colaIds[0]);
  });
});

// ===========================================================================
// FA-04 — reserva EXISTE en el tenant pero NO bloquea ninguna fecha activa:
//   200 con estaBloqueada:false, bloqueante:null, cola:[] (D-3). Reserva inexistente /
//   de otro tenant → 404 (ColaEsperaNoEncontradaError).
// ===========================================================================

describe('GET cola — FA-04 fecha disponible vs 404', () => {
  it('reserva_del_tenant_sin_FECHA_BLOQUEADA_devuelve_estaBloqueada_false_sin_404', async () => {
    // Reserva 2a del tenant SIN FECHA_BLOQUEADA (no bloquea nada).
    const cliente = await crearCliente('Sin bloqueo', TENANT);
    const reserva = await prisma.reserva.create({
      data: {
        tenantId: TENANT,
        clienteId: cliente.idCliente,
        codigo: `TST-U017-D-${sufijo()}`,
        estado: EstadoReserva.consulta,
        subEstado: SubEstadoConsulta.s2a,
        canalEntrada: CanalEntrada.web,
        fechaEvento: F_DISPONIBLE,
      },
    });

    const cola = await useCase.ejecutar({
      tenantId: TENANT,
      reservaId: reserva.idReserva,
    });

    expect(cola.estaBloqueada).toBe(false);
    expect(cola.bloqueante).toBeNull();
    expect(cola.cola).toEqual([]);
  });

  it('id_inexistente_lanza_ColaEsperaNoEncontrada_404', async () => {
    await expect(
      useCase.ejecutar({
        tenantId: TENANT,
        reservaId: '00000000-0000-0000-0000-999999999999',
      }),
    ).rejects.toBeInstanceOf(ColaEsperaNoEncontradaError);
  });
});

// ===========================================================================
// Aislamiento multi-tenant (RLS, 3.5): la bloqueante + cola de OTRO tenant es
//   INVISIBLE para el tenant del JWT → tratada como no encontrada (404).
//   spec-delta: "La cola de otro tenant no es alcanzable".
// ===========================================================================

describe('GET cola — aislamiento multi-tenant (RLS)', () => {
  it('la_bloqueante_de_otro_tenant_es_invisible_y_lanza_ColaEsperaNoEncontrada', async () => {
    const { bloqueanteId } = await sembrarBloqueanteConCola({
      fecha: F_TENANT,
      subEstadoBloqueante: SubEstadoConsulta.s2b,
      colaCreadaHace: [5 * 60 * 1000],
      tenantId: OTRO_TENANT,
    });

    await expect(
      useCase.ejecutar({ tenantId: TENANT, reservaId: bloqueanteId }),
    ).rejects.toBeInstanceOf(ColaEsperaNoEncontradaError);
  });
});
