/**
 * TESTS DE INTEGRACIÓN de `bloquearFecha()` (US-040 / UC-30) — fase TDD RED.
 *
 * ZONA CRÍTICA (orden TDD: PRIMERO la concurrencia). Trazabilidad: US-040,
 * spec-delta `bloqueo-fecha` (requisitos "Serialización de solicitudes
 * concurrentes", "Rechazo atómico determinista", "Idempotencia del bloqueo
 * firme"), design.md (D-1 transacción `$queryRaw` + `SELECT … FOR UPDATE`,
 * D-4 traducción P2002 → FECHA_YA_BLOQUEADA). Dolor D4.
 *
 * Es un test de INTEGRACIÓN: ejercita la operación de dominio `bloquearFecha()`
 * a través del ADAPTADOR Prisma real contra el Postgres del docker-compose
 * (servicio `postgres:15`, DATABASE_URL en apps/api/.env). La garantía atómica
 * NO usa Redis ni locks distribuidos (regla del proyecto): se apoya en
 * `@@unique([tenantId, fecha])` + `SELECT … FOR UPDATE` dentro de `$transaction`.
 * Requiere `docker compose up -d postgres` y la migración aplicada.
 *
 * RED: en este punto NO existen ni el servicio de dominio
 * (`reservas/domain/bloquear-fecha.service.ts`) ni el adaptador
 * (`reservas/infrastructure/fecha-bloqueada.prisma.adapter.ts`); los imports
 * fallan y toda la batería está en ROJO. GREEN es de `backend-developer`.
 */
import { PrismaClient, EstadoReserva, CanalEntrada } from '@prisma/client';
import {
  BloquearFechaService,
  ExtensionSobreBloqueoFirmeError,
  FechaYaBloqueadaError,
  ReservaYaTieneBloqueoError,
  type TenantSettingsPort,
  type TenantSettingsBloqueo,
  type ClockPort,
  type BloquearFechaComando,
} from '../domain/bloquear-fecha.service';
import { FechaBloqueadaPrismaAdapter } from '../infrastructure/fecha-bloqueada.prisma.adapter';

const prisma = new PrismaClient();

const TENANT_ID = '00000000-0000-0000-0000-000000000001';
const FECHA_DISPUTADA = new Date('2026-09-12T00:00:00.000Z');
// Segunda fecha (distinta) para ejercitar la colisión del UNIQUE `reserva_id`.
const FECHA_OTRA = new Date('2026-10-01T00:00:00.000Z');

let reservaA: string;
let reservaB: string;
let clienteId: string;

// Puerto de settings respaldado por la BD real (doble fino, lectura directa).
const settingsPortReal: TenantSettingsPort = {
  obtener: async (tenantId: string): Promise<TenantSettingsBloqueo | null> => {
    const s = await prisma.tenantSettings.findUnique({ where: { tenantId } });
    return s ? { ttlConsultaDias: s.ttlConsultaDias, ttlPrereservaDias: s.ttlPrereservaDias } : null;
  },
};

// Reloj fijo: "ahora" anterior a la fecha disputada (2026-09-12), para que la
// validación de fecha futura pase.
const clock: ClockPort = { ahora: () => new Date('2026-06-27T00:00:00.000Z') };

const montarServicio = (): BloquearFechaService =>
  new BloquearFechaService({
    repositorio: new FechaBloqueadaPrismaAdapter(prisma),
    tenantSettings: settingsPortReal,
    clock,
  });

const comando = (reservaId: string, over: Partial<BloquearFechaComando> = {}): BloquearFechaComando => ({
  tenantId: TENANT_ID,
  fase: '2.b',
  fecha: FECHA_DISPUTADA,
  reserva: { idReserva: reservaId, tenantId: TENANT_ID },
  ...over,
});

const crearReservaMinima = async (codigo: string): Promise<string> => {
  const reserva = await prisma.reserva.create({
    data: {
      tenantId: TENANT_ID,
      clienteId,
      codigo,
      estado: EstadoReserva.pre_reserva,
      canalEntrada: CanalEntrada.web,
    },
  });
  return reserva.idReserva;
};

beforeAll(async () => {
  await prisma.fechaBloqueada.deleteMany({ where: { tenantId: TENANT_ID } });
  await prisma.reserva.deleteMany({
    where: { tenantId: TENANT_ID, codigo: { in: ['TST-U040-A', 'TST-U040-B'] } },
  });
  const cliente = await prisma.cliente.create({
    data: { tenantId: TENANT_ID, nombre: 'Cliente Test US-040' },
  });
  clienteId = cliente.idCliente;
  reservaA = await crearReservaMinima('TST-U040-A');
  reservaB = await crearReservaMinima('TST-U040-B');
});

afterAll(async () => {
  await prisma.fechaBloqueada.deleteMany({ where: { tenantId: TENANT_ID } });
  await prisma.reserva.deleteMany({
    where: { tenantId: TENANT_ID, codigo: { in: ['TST-U040-A', 'TST-U040-B'] } },
  });
  await prisma.cliente.deleteMany({ where: { idCliente: clienteId } });
  await prisma.$disconnect();
});

beforeEach(async () => {
  await prisma.fechaBloqueada.deleteMany({ where: { tenantId: TENANT_ID } });
});

// ===========================================================================
// 1. ZONA CRÍTICA: serialización de solicitudes concurrentes
//    spec-delta: "Serialización de solicitudes concurrentes sobre la misma fecha"
// ===========================================================================

describe('bloquearFecha() — serialización de bloqueos concurrentes (zona crítica)', () => {
  it('debe_permitir_un_bloqueo_y_rechazar_el_segundo_cuando_son_concurrentes', async () => {
    const servicio = montarServicio();

    // Act: dos bloqueos sobre la MISMA (tenant, fecha) en paralelo.
    const resultados = await Promise.allSettled([
      servicio.ejecutar(comando(reservaA)),
      servicio.ejecutar(comando(reservaB)),
    ]);

    // Assert: exactamente 1 éxito + 1 rechazo.
    const exitos = resultados.filter((r) => r.status === 'fulfilled');
    const rechazos = resultados.filter((r) => r.status === 'rejected');
    expect(exitos).toHaveLength(1);
    expect(rechazos).toHaveLength(1);

    // El rechazo es FECHA_YA_BLOQUEADA (traducción de P2002 en el adaptador).
    const rechazo = rechazos[0] as PromiseRejectedResult;
    expect(rechazo.reason).toBeInstanceOf(FechaYaBloqueadaError);

    // Estado final: EXACTAMENTE 1 fila para esa (tenant, fecha).
    const filas = await prisma.fechaBloqueada.count({
      where: { tenantId: TENANT_ID, fecha: FECHA_DISPUTADA },
    });
    expect(filas).toBe(1);
  });
});

// ===========================================================================
// 2. Rechazo determinista cuando la fecha ya está bloqueada por otra reserva
//    spec-delta: "Rechazo atómico determinista …"
// ===========================================================================

describe('bloquearFecha() — rechazo cuando la fecha ya está ocupada por otra reserva', () => {
  it('debe_rechazar_con_FECHA_YA_BLOQUEADA_y_no_insertar_fila_adicional', async () => {
    const servicio = montarServicio();
    await servicio.ejecutar(comando(reservaA));

    await expect(servicio.ejecutar(comando(reservaB))).rejects.toBeInstanceOf(
      FechaYaBloqueadaError,
    );

    const filas = await prisma.fechaBloqueada.count({
      where: { tenantId: TENANT_ID, fecha: FECHA_DISPUTADA },
    });
    expect(filas).toBe(1);
  });
});

// ===========================================================================
// 3. Idempotencia del bloqueo firme por reserva_id
//    spec-delta: "Idempotencia del bloqueo firme por reserva_id"
// ===========================================================================

describe('bloquearFecha() — idempotencia del upgrade firme por reserva_id', () => {
  it('debe_ser_idempotente_ante_un_segundo_bloqueo_firme_con_el_mismo_reserva_id', async () => {
    const servicio = montarServicio();
    // Primer bloqueo blando 2.b, luego upgrade a firme.
    await servicio.ejecutar(comando(reservaA));
    await servicio.ejecutar(comando(reservaA, { fase: 'reserva_confirmada' }));

    // Retry del firme con el MISMO reserva_id: UPDATE idempotente, sin error.
    await expect(
      servicio.ejecutar(comando(reservaA, { fase: 'reserva_confirmada' })),
    ).resolves.toMatchObject({ tipoBloqueo: 'firme', ttlExpiracion: null });

    const fila = await prisma.fechaBloqueada.findFirst({
      where: { tenantId: TENANT_ID, fecha: FECHA_DISPUTADA },
    });
    expect(fila?.reservaId).toBe(reservaA);
    expect(fila?.tipoBloqueo).toBe('firme');
    expect(fila?.ttlExpiracion).toBeNull();
  });

  it('debe_rechazar_un_bloqueo_firme_con_reserva_id_distinto_sobre_la_misma_fecha', async () => {
    const servicio = montarServicio();
    await servicio.ejecutar(comando(reservaA, { fase: 'reserva_confirmada' }));

    await expect(
      servicio.ejecutar(comando(reservaB, { fase: 'reserva_confirmada' })),
    ).rejects.toBeInstanceOf(FechaYaBloqueadaError);
  });
});

// ===========================================================================
// 4. Upgrade blando → firme por UPDATE (nunca DELETE+INSERT)
//    spec-delta: "Upgrade de bloqueo blando a firme al confirmar"
// ===========================================================================

describe('bloquearFecha() — upgrade blando a firme por UPDATE preservando reserva_id', () => {
  it('debe_promover_el_blando_existente_a_firme_con_ttl_null_y_mismo_reserva_id', async () => {
    const servicio = montarServicio();
    const blando = await servicio.ejecutar(comando(reservaA)); // 2.b
    expect(blando.tipoBloqueo).toBe('blando');
    expect(blando.ttlExpiracion).not.toBeNull();
    const idBloqueoBlando = blando.idBloqueo;

    const firme = await servicio.ejecutar(comando(reservaA, { fase: 'reserva_confirmada' }));

    expect(firme.tipoBloqueo).toBe('firme');
    expect(firme.ttlExpiracion).toBeNull();
    expect(firme.reservaId).toBe(reservaA);
    // Es un UPDATE de la MISMA fila (no DELETE+INSERT): el id de bloqueo se conserva.
    expect(firme.idBloqueo).toBe(idBloqueoBlando);
  });
});

// ===========================================================================
// 5. [M1] Guard anti-degradado firme→blando en `extend` (fase 2.c)
//    Defensa en profundidad: un `extend` sobre una fila firme NO debe
//    degradarla silenciosamente; debe rechazarse con error de dominio.
// ===========================================================================

describe('bloquearFecha() — guard contra degradado firme→blando en extend (M1)', () => {
  it('debe_rechazar_un_extend_sobre_un_bloqueo_firme_sin_degradarlo', async () => {
    const servicio = montarServicio();
    // Arrange: bloqueo FIRME (ttl null) para reservaA sobre la fecha.
    const firme = await servicio.ejecutar(
      comando(reservaA, { fase: 'reserva_confirmada' }),
    );
    expect(firme.tipoBloqueo).toBe('firme');
    expect(firme.ttlExpiracion).toBeNull();

    // Act + Assert: un extend (fase 2.c) de la MISMA reserva sobre la fila
    // firme debe rechazarse en vez de degradar a blando.
    await expect(
      servicio.ejecutar(comando(reservaA, { fase: '2.c' })),
    ).rejects.toBeInstanceOf(ExtensionSobreBloqueoFirmeError);

    // La fila sigue FIRME e intacta (no se degradó a blando ni se le puso TTL).
    const fila = await prisma.fechaBloqueada.findFirst({
      where: { tenantId: TENANT_ID, fecha: FECHA_DISPUTADA },
    });
    expect(fila?.tipoBloqueo).toBe('firme');
    expect(fila?.ttlExpiracion).toBeNull();
    expect(fila?.idBloqueo).toBe(firme.idBloqueo);
  });
});

// ===========================================================================
// 6. [M2] Colisión del UNIQUE `reserva_id` NO se reporta como FECHA_YA_BLOQUEADA
//    `reservaId @unique`: si una reserva que ya bloquea una fecha intenta
//    bloquear OTRA, el P2002 es sobre `reserva_id`, no sobre (tenant_id, fecha).
// ===========================================================================

describe('bloquearFecha() — discriminación del P2002 por reserva_id (M2)', () => {
  it('debe_lanzar_RESERVA_YA_TIENE_BLOQUEO_y_no_FECHA_YA_BLOQUEADA', async () => {
    const servicio = montarServicio();
    // Arrange: reservaA ya tiene un bloqueo blando sobre FECHA_DISPUTADA.
    await servicio.ejecutar(comando(reservaA));

    // Act: la MISMA reservaA intenta bloquear una fecha DISTINTA. No hay fila
    // para (tenant, FECHA_OTRA), así que entra por `insert` y choca con el
    // UNIQUE `reserva_id` → P2002 sobre reserva_id.
    const ejecutar = servicio.ejecutar(comando(reservaA, { fecha: FECHA_OTRA }));

    // Assert: error específico de reserva, NO el engañoso FECHA_YA_BLOQUEADA.
    await expect(ejecutar).rejects.toBeInstanceOf(ReservaYaTieneBloqueoError);
    await expect(ejecutar).rejects.not.toBeInstanceOf(FechaYaBloqueadaError);

    // No se creó fila para la segunda fecha.
    const filasOtra = await prisma.fechaBloqueada.count({
      where: { tenantId: TENANT_ID, fecha: FECHA_OTRA },
    });
    expect(filasOtra).toBe(0);
  });
});
