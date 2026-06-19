/**
 * TEST DE CONCURRENCIA DEL BLOQUEO ATÓMICO DE FECHA — primer test del proyecto.
 *
 * Trazabilidad: US-000 (TDD-RED) · invariante crítico anti-doble-reserva.
 *
 * RED → GREEN: este test define el contrato del invariante ANTES de cualquier
 * lógica de negocio (`bloquearFecha()`). En este punto NO existe caso de uso ni
 * controlador; el test verifica la garantía directamente contra el MOTOR DE BD,
 * que es donde vive realmente la atomicidad: la restricción
 * `@@unique([tenantId, fecha])` (índice `fecha_bloqueada_tenant_id_fecha_key`)
 * sobre `fecha_bloqueada` en PostgreSQL.
 *
 * Como el schema/migración ya están aplicados, el test pasa directamente: la
 * fase RED quedó cubierta por la ausencia de la tabla/índice antes de la
 * migración. A partir de aquí, este test es el guardián GREEN del invariante:
 * NO uses Redis ni locks distribuidos (regla del proyecto) — la única fuente de
 * verdad de la exclusión mutua es esta UNIQUE constraint.
 *
 * Es un test de INTEGRACIÓN: habla con el Postgres del docker-compose
 * (servicio `postgres:15`, DATABASE_URL en apps/api/.env). Requiere
 * `docker compose up -d postgres` y la migración aplicada.
 */
import { PrismaClient, Prisma, TipoBloqueo, EstadoReserva, CanalEntrada } from '@prisma/client';

const prisma = new PrismaClient();

// Tenant piloto sembrado con id fijo (ver prisma/seed.ts).
const TENANT_ID = '00000000-0000-0000-0000-000000000001';

// Fecha objeto del bloqueo en disputa (columna @db.Date).
const FECHA_DISPUTADA = new Date('2026-09-12T00:00:00.000Z');

// IDs de reserva creados en el setup, reutilizados por los tests.
let reservaA: string;
let reservaB: string;
let clienteId: string;

/** Crea una reserva mínima válida (satisface los FK/NOT NULL del schema). */
async function crearReservaMinima(codigo: string): Promise<string> {
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
}

/** Inserta un bloqueo firme de FECHA_DISPUTADA para una reserva dada. */
function bloquearFecha(reservaId: string): Promise<unknown> {
  return prisma.fechaBloqueada.create({
    data: {
      tenantId: TENANT_ID,
      fecha: FECHA_DISPUTADA,
      reservaId,
      tipoBloqueo: TipoBloqueo.firme,
    },
  });
}

beforeAll(async () => {
  // Arrange global: estado limpio y reservas necesarias para los FK.
  await prisma.fechaBloqueada.deleteMany({ where: { tenantId: TENANT_ID } });
  await prisma.reserva.deleteMany({
    where: { tenantId: TENANT_ID, codigo: { in: ['TST-CONC-A', 'TST-CONC-B'] } },
  });

  // Cliente mínimo para las reservas (FK reserva.cliente_id NOT NULL).
  const cliente = await prisma.cliente.create({
    data: { tenantId: TENANT_ID, nombre: 'Cliente Test Concurrencia' },
  });
  clienteId = cliente.idCliente;

  reservaA = await crearReservaMinima('TST-CONC-A');
  reservaB = await crearReservaMinima('TST-CONC-B');
});

afterAll(async () => {
  await prisma.fechaBloqueada.deleteMany({ where: { tenantId: TENANT_ID } });
  await prisma.reserva.deleteMany({
    where: { tenantId: TENANT_ID, codigo: { in: ['TST-CONC-A', 'TST-CONC-B'] } },
  });
  await prisma.cliente.deleteMany({ where: { idCliente: clienteId } });
  await prisma.$disconnect();
});

beforeEach(async () => {
  // Cada test parte sin bloqueos sobre la fecha disputada.
  await prisma.fechaBloqueada.deleteMany({ where: { tenantId: TENANT_ID } });
});

describe('Bloqueo atómico de fecha — invariante anti-doble-reserva', () => {
  it('debe_permitir_un_bloqueo_y_rechazar_el_segundo_cuando_son_concurrentes', async () => {
    // Arrange: dos intentos de bloquear LA MISMA (tenant, fecha) en paralelo,
    // con reservas distintas (reservaId es además @unique).

    // Act: ambas inserciones se lanzan concurrentemente.
    const resultados = await Promise.allSettled([
      bloquearFecha(reservaA),
      bloquearFecha(reservaB),
    ]);

    // Assert: exactamente 1 éxito y 1 rechazo.
    const exitos = resultados.filter((r) => r.status === 'fulfilled');
    const rechazos = resultados.filter((r) => r.status === 'rejected');
    expect(exitos).toHaveLength(1);
    expect(rechazos).toHaveLength(1);

    // El rechazo es una violación de unicidad de Prisma (P2002).
    const rechazo = rechazos[0] as PromiseRejectedResult;
    expect(rechazo.reason).toBeInstanceOf(Prisma.PrismaClientKnownRequestError);
    expect((rechazo.reason as Prisma.PrismaClientKnownRequestError).code).toBe('P2002');

    // Y en BD queda EXACTAMENTE 1 fila para esa (tenant, fecha).
    const filas = await prisma.fechaBloqueada.count({
      where: { tenantId: TENANT_ID, fecha: FECHA_DISPUTADA },
    });
    expect(filas).toBe(1);
  });

  it('debe_rechazar_segunda_reserva_con_P2002_cuando_fecha_ya_bloqueada', async () => {
    // Arrange: la fecha ya está bloqueada por la reserva A.
    await bloquearFecha(reservaA);

    // Act + Assert: un segundo bloqueo de la misma (tenant, fecha) viola la
    // UNIQUE constraint -> Prisma lanza P2002.
    expect.assertions(3);
    try {
      await bloquearFecha(reservaB);
    } catch (error) {
      expect(error).toBeInstanceOf(Prisma.PrismaClientKnownRequestError);
      const prismaError = error as Prisma.PrismaClientKnownRequestError;
      expect(prismaError.code).toBe('P2002');
      // El target del conflicto incluye el índice (tenant_id, fecha).
      const target = prismaError.meta?.target as string[] | string | undefined;
      const targetStr = Array.isArray(target) ? target.join(',') : String(target);
      expect(targetStr).toMatch(/tenant_id|fecha/i);
    }
  });
});
