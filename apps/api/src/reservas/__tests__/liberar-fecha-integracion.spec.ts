/**
 * TESTS DE INTEGRACIÓN de `liberarFecha()` (US-041 / UC-31) — fase TDD RED.
 *
 * ZONA CRÍTICA (orden TDD: PRIMERO la concurrencia). Trazabilidad: US-041,
 * spec-delta `bloqueo-fecha` (requisitos "Exactamente-una-vez en la promoción
 * ante liberaciones concurrentes", "Liberación concurrente con un nuevo intento
 * de bloqueo", "Barrido en lote con transacciones independientes por fecha",
 * idempotencia, no-mutación de la RESERVA), design.md (D-1 transacción
 * `$executeRaw` + DELETE serializado devolviendo rows-affected, D-2 seam
 * `PromocionColaPort`, D-3/D-4 exactamente-una-vez, D-9 lote). Dolores D4/D13.
 *
 * Es un test de INTEGRACIÓN: ejercita la operación de dominio `liberarFecha()` a
 * través del ADAPTADOR Prisma real (`FechaBloqueadaPrismaAdapter`, AMPLIADO en
 * US-041 con `consultarBloqueo()` + `liberar()`) contra el Postgres del
 * docker-compose (servicio `postgres:15`, DATABASE_URL en apps/api/.env). La
 * atomicidad NO usa Redis ni locks distribuidos (regla del proyecto): se apoya en
 * el DELETE serializado por el motor + `@@unique([tenantId, fecha])` de US-040.
 * Requiere `docker compose up -d postgres` y la migración aplicada.
 *
 * RED: en este punto NO existen ni el servicio de dominio
 * (`reservas/domain/liberar-fecha.service.ts`), ni el caso de uso de lote
 * (`reservas/application/liberar-fechas-lote.service.ts`), ni los nuevos métodos
 * `consultarBloqueo()`/`liberar()` del adaptador; los imports/símbolos fallan y
 * toda la batería está en ROJO. GREEN es de `backend-developer`.
 */
import {
  PrismaClient,
  EstadoReserva,
  CanalEntrada,
  SubEstadoConsulta,
  TipoBloqueo,
} from '@prisma/client';
import {
  LiberarFechaService,
  type LiberarFechaComando,
  type EstadoReservaDominio,
  type ReservaEstadoPort,
  type ColaQueryPort,
  type PromocionColaPort,
  type AuditLogPort,
} from '../domain/liberar-fecha.service';
import { LiberarFechasEnLoteService } from '../application/liberar-fechas-lote.service';
import { FechaBloqueadaPrismaAdapter } from '../infrastructure/fecha-bloqueada.prisma.adapter';

const prisma = new PrismaClient();

const TENANT_ID = '00000000-0000-0000-0000-000000000001';
const FECHA_DISPUTADA = new Date('2026-09-12T00:00:00.000Z');
const FECHA_LOTE_A = new Date('2026-10-01T00:00:00.000Z');
const FECHA_LOTE_B = new Date('2026-10-02T00:00:00.000Z');
const FECHA_LOTE_FIRME = new Date('2026-10-03T00:00:00.000Z');

const AYER = new Date(Date.now() - 24 * 60 * 60 * 1000);

const CODIGOS = [
  'TST-U041-A',
  'TST-U041-B',
  'TST-U041-COLA1',
  'TST-U041-COLA2',
  'TST-U041-LOTE-A',
  'TST-U041-LOTE-B',
  'TST-U041-LOTE-FIRME',
];

let clienteId: string;

// ---------------------------------------------------------------------------
// Puertos respaldados por la BD real (dobles finos de lectura) + spies.
// ---------------------------------------------------------------------------

// Lee el estado de la RESERVA para la guarda firme (D-5). Lectura pura.
const reservaEstadoPort: ReservaEstadoPort = {
  obtenerEstado: async ({ reservaId }): Promise<EstadoReservaDominio | null> => {
    const r = await prisma.reserva.findFirst({
      where: { idReserva: reservaId, tenantId: TENANT_ID },
      select: { estado: true },
    });
    return r ? (r.estado as EstadoReservaDominio) : null;
  },
};

// Detecta cola activa: alguna RESERVA en sub_estado `s2d` apuntando a la reserva
// liberada (`consulta_bloqueante_id`). Lectura pura.
const colaQueryPort: ColaQueryPort = {
  hayColaActiva: async ({ reservaBloqueanteId }): Promise<boolean> => {
    const n = await prisma.reserva.count({
      where: {
        tenantId: TENANT_ID,
        subEstado: SubEstadoConsulta.s2d,
        consultaBloqueanteId: reservaBloqueanteId,
      },
    });
    return n > 0;
  },
};

// Seam de promoción (US-018): doble-espía que solo CUENTA invocaciones. El
// adaptador real (stub no-op) llega en la implementación; aquí verificamos el
// contrato exactamente-una-vez del trigger.
const crearPromocionSpy = (): PromocionColaPort & { promoverPrimeroEnCola: jest.Mock } => ({
  promoverPrimeroEnCola: jest.fn(async () => undefined),
});

// Auditoría: doble-espía que cuenta; la persistencia real (adaptador Prisma) se
// verifica en QA. Aquí basta el contrato del puerto.
const crearAuditSpy = (): AuditLogPort & { registrar: jest.Mock } => ({
  registrar: jest.fn(async () => undefined),
});

const montarServicio = (
  promocion: PromocionColaPort,
  auditoria: AuditLogPort,
): LiberarFechaService =>
  new LiberarFechaService({
    repositorio: new FechaBloqueadaPrismaAdapter(prisma),
    reservaEstado: reservaEstadoPort,
    cola: colaQueryPort,
    promocion,
    auditoria,
  });

// ---------------------------------------------------------------------------
// Helpers de arranque (insertan estado real en la BD del docker-compose).
// ---------------------------------------------------------------------------

const crearReserva = async (
  codigo: string,
  over: {
    estado?: EstadoReserva;
    subEstado?: SubEstadoConsulta | null;
    consultaBloqueanteId?: string | null;
    posicionCola?: number | null;
  } = {},
): Promise<string> => {
  const reserva = await prisma.reserva.create({
    data: {
      tenantId: TENANT_ID,
      clienteId,
      codigo,
      estado: over.estado ?? EstadoReserva.pre_reserva,
      subEstado: over.subEstado ?? null,
      consultaBloqueanteId: over.consultaBloqueanteId ?? null,
      posicionCola: over.posicionCola ?? null,
      canalEntrada: CanalEntrada.web,
    },
  });
  return reserva.idReserva;
};

const insertarBloqueo = async (params: {
  reservaId: string;
  fecha: Date;
  tipo: TipoBloqueo;
  ttl?: Date | null;
}): Promise<void> => {
  await prisma.fechaBloqueada.create({
    data: {
      tenantId: TENANT_ID,
      fecha: params.fecha,
      reservaId: params.reservaId,
      tipoBloqueo: params.tipo,
      ttlExpiracion: params.ttl ?? null,
    },
  });
};

const contarBloqueos = (fecha: Date): Promise<number> =>
  prisma.fechaBloqueada.count({ where: { tenantId: TENANT_ID, fecha } });

const comando = (fecha: Date, causa: LiberarFechaComando['causa'] = 'TTL'): LiberarFechaComando => ({
  tenantId: TENANT_ID,
  fecha,
  causa,
});

const limpiar = async (): Promise<void> => {
  await prisma.fechaBloqueada.deleteMany({ where: { tenantId: TENANT_ID } });
  await prisma.reserva.deleteMany({ where: { tenantId: TENANT_ID, codigo: { in: CODIGOS } } });
};

beforeAll(async () => {
  await limpiar();
  await prisma.cliente.deleteMany({ where: { tenantId: TENANT_ID, nombre: 'Cliente Test US-041' } });
  const cliente = await prisma.cliente.create({
    data: { tenantId: TENANT_ID, nombre: 'Cliente Test US-041' },
  });
  clienteId = cliente.idCliente;
});

afterAll(async () => {
  await limpiar();
  await prisma.cliente.deleteMany({ where: { idCliente: clienteId } });
  await prisma.$disconnect();
});

beforeEach(async () => {
  await prisma.fechaBloqueada.deleteMany({ where: { tenantId: TENANT_ID } });
  await prisma.reserva.deleteMany({ where: { tenantId: TENANT_ID, codigo: { in: CODIGOS } } });
});

// ===========================================================================
// 3.1 ZONA CRÍTICA: dos liberaciones concurrentes de la misma (tenant, fecha)
//     spec-delta: "Exactamente-una-vez en la promoción ante liberaciones concurrentes"
// ===========================================================================

describe('liberarFecha() — dos liberaciones concurrentes (zona crítica)', () => {
  it('debe_eliminar_la_fila_una_sola_vez_con_la_otra_en_noop_y_promover_exactamente_una_vez', async () => {
    // Arrange: un bloqueo blando con cola activa (2 reservas en s2d apuntando a A).
    const reservaA = await crearReserva('TST-U041-A', { estado: EstadoReserva.pre_reserva });
    await insertarBloqueo({ reservaId: reservaA, fecha: FECHA_DISPUTADA, tipo: TipoBloqueo.blando, ttl: AYER });
    await crearReserva('TST-U041-COLA1', {
      estado: EstadoReserva.consulta,
      subEstado: SubEstadoConsulta.s2d,
      consultaBloqueanteId: reservaA,
      posicionCola: 1,
    });
    await crearReserva('TST-U041-COLA2', {
      estado: EstadoReserva.consulta,
      subEstado: SubEstadoConsulta.s2d,
      consultaBloqueanteId: reservaA,
      posicionCola: 2,
    });

    const promocion = crearPromocionSpy();
    const auditoria = crearAuditSpy();
    const servicio = montarServicio(promocion, auditoria);

    // Act: dos liberaciones de la MISMA (tenant, fecha) en paralelo.
    const resultados = await Promise.allSettled([
      servicio.ejecutar(comando(FECHA_DISPUTADA)),
      servicio.ejecutar(comando(FECHA_DISPUTADA)),
    ]);

    // Assert: ninguna falla (idempotencia: el no-op es éxito silencioso).
    const exitos = resultados.filter((r) => r.status === 'fulfilled') as PromiseFulfilledResult<{
      filasAfectadas: number;
      liberada: boolean;
    }>[];
    expect(exitos).toHaveLength(2);

    // Exactamente una eliminó la fila (1 row) y la otra obtuvo 0 filas.
    const liberadas = exitos.filter((r) => r.value.liberada);
    const noops = exitos.filter((r) => !r.value.liberada);
    expect(liberadas).toHaveLength(1);
    expect(noops).toHaveLength(1);
    expect(liberadas[0].value.filasAfectadas).toBe(1);
    expect(noops[0].value.filasAfectadas).toBe(0);

    // Estado final: NINGUNA fila para esa (tenant, fecha).
    expect(await contarBloqueos(FECHA_DISPUTADA)).toBe(0);

    // La promoción se dispara EXACTAMENTE UNA VEZ (solo el worker con rows=1).
    expect(promocion.promoverPrimeroEnCola).toHaveBeenCalledTimes(1);
  });
});

// ===========================================================================
// 3.2 Race liberación vs nuevo bloqueo: nunca (T, D) doble-bloqueada
//     spec-delta: "Liberación concurrente con un nuevo intento de bloqueo"
// ===========================================================================

describe('liberarFecha() — race liberación vs nuevo intento de bloqueo', () => {
  it('nunca_deja_la_fecha_doble_bloqueada_la_liberacion_completa_y_el_bloqueo_se_resuelve', async () => {
    // Arrange: A tiene un bloqueo blando vigente sobre la fecha; B intentará
    // bloquear la MISMA fecha en paralelo a la liberación de A.
    const reservaA = await crearReserva('TST-U041-A', { estado: EstadoReserva.pre_reserva });
    const reservaB = await crearReserva('TST-U041-B', { estado: EstadoReserva.pre_reserva });
    await insertarBloqueo({ reservaId: reservaA, fecha: FECHA_DISPUTADA, tipo: TipoBloqueo.blando, ttl: AYER });

    const promocion = crearPromocionSpy();
    const auditoria = crearAuditSpy();
    const servicio = montarServicio(promocion, auditoria);

    // Act: liberación de A en paralelo a un INSERT directo del bloqueo de B
    // (simula el nuevo intento de bloqueo sobre la misma fecha).
    const nuevoBloqueoDeB = prisma.fechaBloqueada
      .create({
        data: {
          tenantId: TENANT_ID,
          fecha: FECHA_DISPUTADA,
          reservaId: reservaB,
          tipoBloqueo: TipoBloqueo.blando,
          ttlExpiracion: new Date(Date.now() + 24 * 60 * 60 * 1000),
        },
      })
      .then(
        () => 'insertado' as const,
        () => 'rechazado' as const,
      );

    const [liberacion] = await Promise.allSettled([
      servicio.ejecutar(comando(FECHA_DISPUTADA)),
      nuevoBloqueoDeB,
    ]);

    // Assert: la liberación se resuelve sin error.
    expect(liberacion.status).toBe('fulfilled');

    // INVARIANTE DURO (cualquier interleaving): jamás coexisten 2 bloqueos para (T, D).
    const filas = await contarBloqueos(FECHA_DISPUTADA);
    expect(filas).toBeLessThanOrEqual(1);
  });
});

// ===========================================================================
// 3.3 Idempotencia en BD real: liberar una fecha sin bloqueo no lanza error
//     spec-delta: "Liberación de fecha sin bloqueo activo no lanza error"
// ===========================================================================

describe('liberarFecha() — idempotencia contra la BD real', () => {
  it('debe_terminar_con_exito_y_0_filas_y_no_promover_cuando_no_hay_bloqueo', async () => {
    const promocion = crearPromocionSpy();
    const auditoria = crearAuditSpy();
    const servicio = montarServicio(promocion, auditoria);

    // No hay ninguna fila para (T, D): DELETE de 0 filas.
    const out = await servicio.ejecutar(comando(FECHA_DISPUTADA));

    expect(out.liberada).toBe(false);
    expect(out.filasAfectadas).toBe(0);
    expect(await contarBloqueos(FECHA_DISPUTADA)).toBe(0);
    expect(promocion.promoverPrimeroEnCola).not.toHaveBeenCalled();
  });
});

// ===========================================================================
// 3.7 No-mutación de la RESERVA: tras liberar, estado/sub_estado intactos
//     spec-delta: "La liberación no muta el estado de la RESERVA"
// ===========================================================================

describe('liberarFecha() — no muta el estado de la RESERVA', () => {
  it('debe_dejar_estado_y_sub_estado_de_la_reserva_intactos_tras_liberar', async () => {
    const reservaA = await crearReserva('TST-U041-A', {
      estado: EstadoReserva.consulta,
      subEstado: SubEstadoConsulta.s2b,
    });
    await insertarBloqueo({ reservaId: reservaA, fecha: FECHA_DISPUTADA, tipo: TipoBloqueo.blando, ttl: AYER });

    const servicio = montarServicio(crearPromocionSpy(), crearAuditSpy());
    await servicio.ejecutar(comando(FECHA_DISPUTADA));

    const reserva = await prisma.reserva.findFirst({ where: { idReserva: reservaA } });
    expect(reserva?.estado).toBe(EstadoReserva.consulta);
    expect(reserva?.subEstado).toBe(SubEstadoConsulta.s2b);
    // La fila de bloqueo SÍ desaparece (la liberación solo toca FECHA_BLOQUEADA).
    expect(await contarBloqueos(FECHA_DISPUTADA)).toBe(0);
  });
});

// ===========================================================================
// 3.6 Liberación en lote con fallo aislado (transacciones independientes)
//     spec-delta: "Barrido en lote con transacciones independientes por fecha"
// ===========================================================================

describe('liberarFechasEnLote() — fallo aislado por fecha (D-9)', () => {
  it('debe_liberar_las_demas_aunque_una_falle_y_promover_solo_donde_hay_cola', async () => {
    // Arrange: 3 fechas.
    //  - LOTE_A: blando expirado CON cola activa  -> liberada + promoción.
    //  - LOTE_B: blando expirado SIN cola          -> liberada, sin promoción.
    //  - LOTE_FIRME: firme de reserva NO cancelada -> falla la guarda (aislada).
    const reservaA = await crearReserva('TST-U041-LOTE-A', { estado: EstadoReserva.pre_reserva });
    const reservaB = await crearReserva('TST-U041-LOTE-B', { estado: EstadoReserva.pre_reserva });
    const reservaFirme = await crearReserva('TST-U041-LOTE-FIRME', {
      estado: EstadoReserva.reserva_confirmada,
    });

    await insertarBloqueo({ reservaId: reservaA, fecha: FECHA_LOTE_A, tipo: TipoBloqueo.blando, ttl: AYER });
    await insertarBloqueo({ reservaId: reservaB, fecha: FECHA_LOTE_B, tipo: TipoBloqueo.blando, ttl: AYER });
    await insertarBloqueo({ reservaId: reservaFirme, fecha: FECHA_LOTE_FIRME, tipo: TipoBloqueo.firme, ttl: null });

    // Cola activa solo para LOTE_A.
    await crearReserva('TST-U041-COLA1', {
      estado: EstadoReserva.consulta,
      subEstado: SubEstadoConsulta.s2d,
      consultaBloqueanteId: reservaA,
      posicionCola: 1,
    });

    const promocion = crearPromocionSpy();
    const auditoria = crearAuditSpy();
    const lote = new LiberarFechasEnLoteService(montarServicio(promocion, auditoria));

    // Act: lote con la fecha firme intercalada para probar el aislamiento.
    const resultados = await lote.ejecutar([
      comando(FECHA_LOTE_A, 'TTL'),
      comando(FECHA_LOTE_FIRME, 'cancelacion'),
      comando(FECHA_LOTE_B, 'TTL'),
    ]);

    // Assert: el fallo de la firme NO impide liberar A y B.
    expect(await contarBloqueos(FECHA_LOTE_A)).toBe(0);
    expect(await contarBloqueos(FECHA_LOTE_B)).toBe(0);
    // La firme permanece intacta (guarda rechazó su liberación).
    expect(await contarBloqueos(FECHA_LOTE_FIRME)).toBe(1);

    // El lote informa por-ítem: 2 liberadas + 1 fallida (aislada).
    const liberadas = resultados.filter((r) => r.estado === 'liberada');
    const fallidas = resultados.filter((r) => r.estado === 'fallida');
    expect(liberadas).toHaveLength(2);
    expect(fallidas).toHaveLength(1);

    // Solo LOTE_A tenía cola: promoción disparada exactamente una vez.
    expect(promocion.promoverPrimeroEnCola).toHaveBeenCalledTimes(1);
  });
});
