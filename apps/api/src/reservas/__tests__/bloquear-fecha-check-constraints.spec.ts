/**
 * TESTS DE INTEGRACIÓN de los CHECK CONSTRAINTS de coherencia tipo↔TTL
 * (US-040 / UC-30) — fase TDD RED.
 *
 * Trazabilidad: US-040, spec-delta `bloqueo-fecha` (requisito "Invariantes de
 * coherencia tipo↔TTL impuestas en BD"), design.md D-3:
 *   - chk_firme_sin_ttl :  tipo='firme'  ⟹ ttl_expiracion IS NULL
 *   - chk_blando_con_ttl:  tipo='blando' ⟹ ttl_expiracion IS NOT NULL
 *
 * Defensa en profundidad: además de la validación de dominio, la BD es la
 * última línea (igual que el `UNIQUE`). Estos tests escriben filas INCOHERENTES
 * directamente con Prisma (saltándose el dominio) y esperan que el MOTOR las
 * rechace por violación del check constraint.
 *
 * RED: la migración con los check constraints (tarea 4.1) AÚN NO está aplicada,
 * por lo que la BD admite hoy las filas incoherentes y estos tests FALLAN
 * (las escrituras se resuelven en vez de rechazarse). GREEN llega cuando
 * `backend-developer` añade la migración SQL cruda (D-3).
 *
 * Es un test de INTEGRACIÓN contra el Postgres del docker-compose. Requiere
 * `docker compose up -d postgres`.
 */
import { PrismaClient, TipoBloqueo, EstadoReserva, CanalEntrada } from '@prisma/client';

const prisma = new PrismaClient();

const TENANT_ID = '00000000-0000-0000-0000-000000000001';
const FECHA = new Date('2026-10-05T00:00:00.000Z');

let reservaId: string;
let clienteId: string;

beforeAll(async () => {
  await prisma.fechaBloqueada.deleteMany({ where: { tenantId: TENANT_ID } });
  await prisma.reserva.deleteMany({
    where: { tenantId: TENANT_ID, codigo: 'TST-U040-CHK' },
  });
  const cliente = await prisma.cliente.create({
    data: { tenantId: TENANT_ID, nombre: 'Cliente Test US-040 CHK' },
  });
  clienteId = cliente.idCliente;
  const reserva = await prisma.reserva.create({
    data: {
      tenantId: TENANT_ID,
      clienteId,
      codigo: 'TST-U040-CHK',
      estado: EstadoReserva.pre_reserva,
      canalEntrada: CanalEntrada.web,
    },
  });
  reservaId = reserva.idReserva;
});

afterEach(async () => {
  await prisma.fechaBloqueada.deleteMany({ where: { tenantId: TENANT_ID } });
});

afterAll(async () => {
  await prisma.fechaBloqueada.deleteMany({ where: { tenantId: TENANT_ID } });
  await prisma.reserva.deleteMany({
    where: { tenantId: TENANT_ID, codigo: 'TST-U040-CHK' },
  });
  await prisma.cliente.deleteMany({ where: { idCliente: clienteId } });
  await prisma.$disconnect();
});

describe('Check constraints de coherencia tipo↔TTL en fecha_bloqueada (D-3)', () => {
  it('debe_rechazar_un_bloqueo_firme_con_ttl_no_nulo_por_chk_firme_sin_ttl', async () => {
    // Fila incoherente: tipo='firme' con ttl_expiracion NO nulo.
    await expect(
      prisma.fechaBloqueada.create({
        data: {
          tenantId: TENANT_ID,
          fecha: FECHA,
          reservaId,
          tipoBloqueo: TipoBloqueo.firme,
          ttlExpiracion: new Date('2026-11-01T00:00:00.000Z'),
        },
      }),
    ).rejects.toThrow();
  });

  it('debe_rechazar_un_bloqueo_blando_sin_ttl_por_chk_blando_con_ttl', async () => {
    // Fila incoherente: tipo='blando' con ttl_expiracion NULO.
    await expect(
      prisma.fechaBloqueada.create({
        data: {
          tenantId: TENANT_ID,
          fecha: FECHA,
          reservaId,
          tipoBloqueo: TipoBloqueo.blando,
          ttlExpiracion: null,
        },
      }),
    ).rejects.toThrow();
  });

  it('debe_aceptar_un_bloqueo_firme_con_ttl_nulo_fila_coherente', async () => {
    // Caso coherente de control: firme + ttl NULL es válido (sanity check).
    const fila = await prisma.fechaBloqueada.create({
      data: {
        tenantId: TENANT_ID,
        fecha: FECHA,
        reservaId,
        tipoBloqueo: TipoBloqueo.firme,
        ttlExpiracion: null,
      },
    });
    expect(fila.tipoBloqueo).toBe('firme');
    expect(fila.ttlExpiracion).toBeNull();
  });
});
