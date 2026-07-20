/**
 * TEST DE INTEGRACIÓN (BD REAL) — Invariante del ÍNDICE UNIQUE PARCIAL para el email
 * `manual` y del listado por reserva (US-046 / UC-36; design.md D-5 Opción C —MIGRACIÓN—
 * y D-3) — fase TDD RED.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 *  ⚠️  ESTE TEST REQUIERE POSTGRES REAL Y LA MIGRACIÓN DE US-046 APLICADA.
 *      DEBE EJECUTARLO LA SESIÓN PRINCIPAL (que tiene Docker/Postgres).
 *      El `tdd-engineer` corre SIN BD: aquí sólo lo dejamos escrito y en RED.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Por qué es OBLIGATORIO (no basta con dobles): la invariante que permite VARIOS
 * emails `manual` por la MISMA reserva (con `reserva_id` NO nulo y `es_reenvio = false`,
 * decisión D-5 Opción C) depende del PREDICADO REAL del índice UNIQUE parcial en
 * PostgreSQL. Con el índice de US-045
 * (`(reserva_id, codigo_email) WHERE reserva_id IS NOT NULL AND es_reenvio = false`),
 * un segundo `manual` con `reserva_id` no nulo y `es_reenvio=false` COLISIONARÍA (P2002).
 * La migración de US-046 recrea el índice añadiendo `AND codigo_email <> 'manual'`, de
 * modo que los `manual` quedan fuera del constraint. Un doble en memoria NO puede
 * demostrar esto: sólo el motor de PostgreSQL con el índice migrado lo hace.
 *
 * Trazabilidad: spec-delta `comunicaciones` Requirement "Creación y envío de un email
 * manual desde la ficha de la RESERVA" (Scenario "Varios emails manuales sobre la misma
 * reserva no colisionan por idempotencia") y Requirement "Listado de las comunicaciones
 * de una RESERVA …" (Scenario "El gestor lista las comunicaciones de su reserva").
 * Además se comprueba que E1–E8 CONSERVAN su idempotencia (un segundo E-código con
 * `reserva_id` no nulo y `es_reenvio=false` SÍ debe colisionar — regresión de US-045).
 *
 * Ejercita el ADAPTADOR Prisma real `ComunicacionRepositoryPrismaAdapter` contra el
 * Postgres del docker-compose (`DATABASE_URL` en apps/api/.env(.test)). Verifica el
 * método nuevo `listarPorReserva` (D-3) y la coexistencia de varios `manual`.
 *
 * RED: en este punto (a) la MIGRACIÓN del índice de US-046 NO está aplicada, así que un
 * segundo `manual` colisiona con P2002; y (b) el método `listarPorReserva` NO existe en
 * el adaptador/puerto. La batería está en ROJO. GREEN es de `backend-developer`
 * (migración + método) y se verifica ejecutando ESTE test desde la sesión principal.
 */
import { PrismaClient } from '@prisma/client';
import { ComunicacionRepositoryPrismaAdapter } from '../infrastructure/comunicacion.repository.prisma.adapter';

const prisma = new PrismaClient();

const TENANT_ID = '00000000-0000-0000-0000-000000000001';
const EMAIL = 'marta.integracion.us046@example.com';
const CODIGO_RESERVA = 'TST-U046-A';

let reservaId: string;
let clienteId: string;

const montarAdaptador = (): ComunicacionRepositoryPrismaAdapter =>
  new ComunicacionRepositoryPrismaAdapter(prisma);

const limpiar = async (): Promise<void> => {
  await prisma.comunicacion.deleteMany({
    where: { tenantId: TENANT_ID, reservaId },
  });
};

beforeAll(async () => {
  const cliente = await prisma.cliente.create({
    data: { tenantId: TENANT_ID, nombre: 'Cliente Test US-046', email: EMAIL },
  });
  clienteId = cliente.idCliente;
  const reserva = await prisma.reserva.create({
    data: {
      tenantId: TENANT_ID,
      clienteId,
      codigo: CODIGO_RESERVA,
      estado: 'pre_reserva',
      canalEntrada: 'web',
    },
  });
  reservaId = reserva.idReserva;
});

afterAll(async () => {
  await prisma.comunicacion.deleteMany({ where: { tenantId: TENANT_ID, reservaId } });
  await prisma.reserva.deleteMany({ where: { idReserva: reservaId } });
  await prisma.cliente.deleteMany({ where: { idCliente: clienteId } });
  await prisma.$disconnect();
});

beforeEach(async () => {
  await limpiar();
});

// ===========================================================================
// 1. INVARIANTE D-5: varios `manual` con reserva_id NO nulo y es_reenvio=false
//    NO colisionan (el predicado del índice migrado los excluye por codigo_email).
// ===========================================================================

describe('COMUNICACION manual — índice UNIQUE parcial excluye codigo_email=manual (D-5)', () => {
  it('debe_permitir_dos_manuales_de_la_misma_reserva_sin_colision_P2002', async () => {
    const repo = montarAdaptador();

    const primero = await repo.crear({
      tenantId: TENANT_ID,
      reservaId,
      clienteId,
      codigoEmail: 'manual',
      asunto: 'Primer manual',
      cuerpo: '<p>uno</p>',
      destinatarioEmail: EMAIL,
      estado: 'enviado',
      fechaEnvio: new Date('2026-07-17T10:00:00.000Z'),
      esReenvio: false,
    });

    // El segundo `manual` con reserva_id NO nulo y es_reenvio=false NO debe colisionar
    // (con el índice de US-045 colisionaría → P2002; con la migración de US-046, no).
    await expect(
      repo.crear({
        tenantId: TENANT_ID,
        reservaId,
        clienteId,
        codigoEmail: 'manual',
        asunto: 'Segundo manual',
        cuerpo: '<p>dos</p>',
        destinatarioEmail: EMAIL,
        estado: 'enviado',
        fechaEnvio: new Date('2026-07-17T11:00:00.000Z'),
        esReenvio: false,
      }),
    ).resolves.toBeDefined();

    const total = await prisma.comunicacion.count({
      where: { tenantId: TENANT_ID, reservaId, codigoEmail: 'manual' },
    });
    expect(total).toBe(2);
    expect(primero.codigoEmail).toBe('manual');
  });

  it('debe_persistir_el_manual_con_es_reenvio_false_semantica_honesta', async () => {
    const repo = montarAdaptador();

    const creado = await repo.crear({
      tenantId: TENANT_ID,
      reservaId,
      clienteId,
      codigoEmail: 'manual',
      asunto: 'Manual honesto',
      cuerpo: '<p>x</p>',
      destinatarioEmail: EMAIL,
      estado: 'enviado',
      fechaEnvio: new Date('2026-07-17T10:00:00.000Z'),
      esReenvio: false,
    });

    const fila = await prisma.comunicacion.findUnique({
      where: { idComunicacion: creado.idComunicacion },
      select: { esReenvio: true, codigoEmail: true, reservaId: true },
    });
    // D-5 Opción C: `manual` con reserva_id NO nulo y es_reenvio=false (no miente).
    expect(fila?.esReenvio).toBe(false);
    expect(fila?.codigoEmail).toBe('manual');
    expect(fila?.reservaId).toBe(reservaId);
  });
});

// ===========================================================================
// 2. TERNA (historial-completo-comunicaciones §D-indice-terna): la idempotencia se
//    clava sobre `(reserva, codigo, subtipo)` con predicado `estado = 'enviado'` y
//    `NULLS NOT DISTINCT`. Dos `enviado` de la MISMA terna colisionan; de subtipos
//    DISTINTOS coexisten. Se preserva la idempotencia de E2–E8 (subtipo NULL) gracias a
//    `NULLS NOT DISTINCT`. Regresión de US-045 reexpresada a la terna.
// ===========================================================================

describe('COMUNICACION E-código — idempotencia por terna (reserva, codigo, subtipo) enviado', () => {
  it('debe_rechazar_un_segundo_E1_enviado_de_la_MISMA_terna_subtipo', async () => {
    const repo = montarAdaptador();

    await repo.crear({
      tenantId: TENANT_ID,
      reservaId,
      clienteId,
      codigoEmail: 'E1',
      asunto: 'E1',
      cuerpo: '<p>e1</p>',
      destinatarioEmail: EMAIL,
      estado: 'enviado',
      fechaEnvio: new Date('2026-07-17T10:00:00.000Z'),
      esReenvio: false,
      subtipo: 'fecha_disponible',
    });

    // Segundo E1 `enviado` del MISMO subtipo (misma terma) DEBE colisionar (P2002 → dominio).
    await expect(
      repo.crear({
        tenantId: TENANT_ID,
        reservaId,
        clienteId,
        codigoEmail: 'E1',
        asunto: 'E1 duplicado',
        cuerpo: '<p>e1 dup</p>',
        destinatarioEmail: EMAIL,
        estado: 'enviado',
        fechaEnvio: new Date('2026-07-17T11:00:00.000Z'),
        esReenvio: false,
        subtipo: 'fecha_disponible',
      }),
    ).rejects.toThrow();

    const total = await prisma.comunicacion.count({
      where: { tenantId: TENANT_ID, reservaId, codigoEmail: 'E1' },
    });
    expect(total).toBe(1);
  });

  it('debe_permitir_dos_E1_enviado_de_subtipos_DISTINTOS_sin_colision', async () => {
    const repo = montarAdaptador();

    await repo.crear({
      tenantId: TENANT_ID,
      reservaId,
      clienteId,
      codigoEmail: 'E1',
      asunto: 'E1 exploratoria',
      cuerpo: '<p>e1a</p>',
      destinatarioEmail: EMAIL,
      estado: 'enviado',
      fechaEnvio: new Date('2026-07-17T10:00:00.000Z'),
      esReenvio: false,
      subtipo: 'consulta_exploratoria',
    });

    // Subtipo DISTINTO → email legítimo distinto, NO reenvío: coexiste en `enviado`.
    await expect(
      repo.crear({
        tenantId: TENANT_ID,
        reservaId,
        clienteId,
        codigoEmail: 'E1',
        asunto: 'E1 cambio',
        cuerpo: '<p>e1b</p>',
        destinatarioEmail: EMAIL,
        estado: 'enviado',
        fechaEnvio: new Date('2026-07-17T11:00:00.000Z'),
        esReenvio: false,
        subtipo: 'cambio_fecha',
      }),
    ).resolves.toBeDefined();

    const total = await prisma.comunicacion.count({
      where: { tenantId: TENANT_ID, reservaId, codigoEmail: 'E1' },
    });
    expect(total).toBe(2);
  });

  it('debe_rechazar_un_segundo_E2_enviado_subtipo_NULL_por_NULLS_NOT_DISTINCT', async () => {
    const repo = montarAdaptador();

    // E2–E8 llevan subtipo NULL: `NULLS NOT DISTINCT` los trata como la MISMA terna, de
    // modo que dos `enviado` de la misma (reserva, codigo, NULL) SIGUEN colisionando.
    await repo.crear({
      tenantId: TENANT_ID,
      reservaId,
      clienteId,
      codigoEmail: 'E2',
      asunto: 'E2',
      cuerpo: '<p>e2</p>',
      destinatarioEmail: EMAIL,
      estado: 'enviado',
      fechaEnvio: new Date('2026-07-17T10:00:00.000Z'),
      esReenvio: false,
    });

    await expect(
      repo.crear({
        tenantId: TENANT_ID,
        reservaId,
        clienteId,
        codigoEmail: 'E2',
        asunto: 'E2 duplicado',
        cuerpo: '<p>e2 dup</p>',
        destinatarioEmail: EMAIL,
        estado: 'enviado',
        fechaEnvio: new Date('2026-07-17T11:00:00.000Z'),
        esReenvio: false,
      }),
    ).rejects.toThrow();

    const total = await prisma.comunicacion.count({
      where: { tenantId: TENANT_ID, reservaId, codigoEmail: 'E2' },
    });
    expect(total).toBe(1);
  });
});

// ===========================================================================
// 3. D-3: listarPorReserva devuelve la proyección de la ficha, scoped por tenant.
// ===========================================================================

describe('ComunicacionRepositoryPrismaAdapter.listarPorReserva — proyección + RLS (D-3)', () => {
  it('debe_listar_todas_las_comunicaciones_de_la_reserva_con_los_campos_de_la_ficha', async () => {
    const repo = montarAdaptador();

    await repo.crear({
      tenantId: TENANT_ID,
      reservaId,
      clienteId,
      codigoEmail: 'E1',
      asunto: 'Consulta recibida',
      cuerpo: '<p>borrador</p>',
      destinatarioEmail: EMAIL,
      estado: 'borrador',
      fechaEnvio: null,
      esReenvio: false,
    });
    await repo.crear({
      tenantId: TENANT_ID,
      reservaId,
      clienteId,
      codigoEmail: 'manual',
      asunto: 'Manual enviado',
      cuerpo: '<p>manual</p>',
      destinatarioEmail: EMAIL,
      estado: 'enviado',
      fechaEnvio: new Date('2026-07-17T12:00:00.000Z'),
      esReenvio: false,
    });

    const filas = await repo.listarPorReserva({
      tenantId: TENANT_ID,
      reservaId,
    });

    expect(filas).toHaveLength(2);
    const borrador = filas.find((f) => f.estado === 'borrador');
    const enviado = filas.find((f) => f.estado === 'enviado');
    // Campos de la ficha + `accionable` derivado de `estado === 'borrador'`.
    // US-046: incluye `clienteId` y `cuerpo` reales (el diálogo de revisión precarga
    // el cuerpo; el contrato `ComunicacionListItem` allOf `Comunicacion` los exige).
    expect(borrador).toEqual(
      expect.objectContaining({
        clienteId,
        codigoEmail: 'E1',
        asunto: 'Consulta recibida',
        cuerpo: '<p>borrador</p>',
        destinatarioEmail: EMAIL,
        fechaEnvio: null,
        esReenvio: false,
        accionable: true,
      }),
    );
    expect(borrador?.fechaCreacion).toBeInstanceOf(Date);
    expect(enviado?.accionable).toBe(false);
    expect(enviado?.fechaEnvio).toBeInstanceOf(Date);
  });

  it('no_debe_listar_comunicaciones_de_una_reserva_de_otro_tenant', async () => {
    const repo = montarAdaptador();
    await repo.crear({
      tenantId: TENANT_ID,
      reservaId,
      clienteId,
      codigoEmail: 'E1',
      asunto: 'De este tenant',
      cuerpo: '<p>x</p>',
      destinatarioEmail: EMAIL,
      estado: 'borrador',
      fechaEnvio: null,
      esReenvio: false,
    });

    // Con un tenant que NO es el dueño, el RLS no devuelve la fila.
    const filas = await repo.listarPorReserva({
      tenantId: '00000000-0000-0000-0000-0000000000ff',
      reservaId,
    });

    expect(filas).toHaveLength(0);
  });
});
