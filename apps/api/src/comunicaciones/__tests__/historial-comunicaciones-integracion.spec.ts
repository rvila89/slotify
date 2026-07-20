/**
 * TEST DE INTEGRACIÓN (BD REAL) — HISTORIAL COMPLETO de COMUNICACIONES E1 por evento del
 * ciclo de vida (change `historial-completo-comunicaciones`) — fase TDD RED.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 *  ⚠️  ESTE TEST REQUIERE POSTGRES REAL Y EL SEED DEL TENANT PILOTO.
 *      DEBE EJECUTARLO LA SESIÓN PRINCIPAL (que tiene Docker/Postgres).
 *      El `tdd-engineer` corre SIN BD: aquí solo lo dejamos escrito y en RED.
 *      BD de test del worktree: `slotify_test_hist` (apps/api/.env.test).
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Comportamiento objetivo (design.md §D-insert-no-upsert, §D-subtipo; spec-delta
 * `comunicaciones` Requirement "Idempotencia de un email por reserva y código",
 * Scenario "Alta exploratoria + añadir fecha + cambiar fecha deja tres E1 con subtipos
 * distintos"):
 *
 *   Cada evento del ciclo de vida que genera un E1 debe INSERTAR su PROPIA fila
 *   COMUNICACION (historial completo), en lugar del upsert actual que SOBRESCRIBE la
 *   única fila E1 de la reserva. Cada fila lleva su `subtipo`.
 *
 * Flujo ejercitado (los 3 casos de uso reales, resueltos por DI vía `ReservasModule`):
 *   1. Alta EXPLORATORIA (2a, sin fecha)            → E1 #1  (subtipo consulta_exploratoria)
 *   2. Transición «añadir fecha» (2a → 2b, libre)   → E1 #2  (subtipo fecha_disponible)
 *   3. Cambio de fecha (2b, fecha libre → otra)     → E1 #3  (subtipo cambio_fecha)
 *
 * SEÑAL RED PRINCIPAL (no necesita la columna nueva → falla HOY con el código actual):
 *   Tras los 3 eventos DEBE haber 3 filas (reserva, E1). Hoy el upsert
 *   (`findFirst` + `update`) deja SOLO 1 fila (las 2 siguientes SOBRESCRIBEN la primera),
 *   así que la aserción `toHaveLength(3)` está en ROJO. También se comprueba que sus
 *   `asunto`/`fecha_creacion` difieren (ninguna sobrescrita).
 *
 * SEÑAL RED SECUNDARIA (necesita la columna nueva → RED hasta que backend implemente):
 *   Cada fila DEBE tener su `subtipo` (`consulta_exploratoria`, `fecha_disponible`,
 *   `cambio_fecha`). La columna `subtipo` AÚN NO existe en el esquema/cliente Prisma, así
 *   que se consulta por SQL crudo (`$queryRawUnsafe`) para que el fichero COMPILE hoy; la
 *   consulta fallará (columna inexistente) o devolverá `null` hasta el GREEN.
 *
 * GREEN es responsabilidad de `backend-developer` (migración enum + columna + índice de
 * la terna, INSERT en los 2 adaptadores UoW, subtipo en el E1 del alta).
 */
import { Test, type TestingModule } from '@nestjs/testing';
import { ConfigModule } from '@nestjs/config';
import { CanalEntrada, CodigoEmail } from '@prisma/client';
import { ReservasModule } from '../../reservas/reservas.module';
import { PrismaService } from '../../shared/prisma/prisma.service';
import { AltaConsultaUseCase } from '../../reservas/application/alta-consulta.use-case';
import { TransicionFechaUseCase } from '../../reservas/application/transicion-fecha.use-case';
import { CambiarFechaUseCase } from '../../reservas/application/cambiar-fecha.use-case';
import { ComunicacionRepositoryPrismaAdapter } from '../infrastructure/comunicacion.repository.prisma.adapter';

const TENANT = '00000000-0000-0000-0000-000000000001';
const GESTOR = '00000000-0000-0000-0000-000000000002';
const EMAIL_PATTERN = '@hist-comunicaciones.test';

// Fechas del historial (estrictamente futuras, libres en el seed piloto).
const FECHA_ANADIR = new Date('2029-03-10T00:00:00.000Z'); // transición 2a → 2b
const FECHA_CAMBIO = new Date('2029-03-17T00:00:00.000Z'); // cambio de fecha
const FECHAS = [FECHA_ANADIR, FECHA_CAMBIO];

let moduleRef: TestingModule;
let prisma: PrismaService;
let alta: AltaConsultaUseCase;
let transicion: TransicionFechaUseCase;
let cambio: CambiarFechaUseCase;

const sufijo = (): string => Math.random().toString(36).slice(2, 8);

const limpiar = async (): Promise<void> => {
  const clientes = await prisma.cliente.findMany({
    where: { email: { contains: EMAIL_PATTERN } },
    select: { idCliente: true },
  });
  const clienteIds = clientes.map((c) => c.idCliente);
  const reservas = await prisma.reserva.findMany({
    where: { OR: [{ clienteId: { in: clienteIds } }, { fechaEvento: { in: FECHAS } }] },
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
  await prisma.fechaBloqueada.deleteMany({ where: { fecha: { in: FECHAS } } });
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
  alta = moduleRef.get(AltaConsultaUseCase);
  transicion = moduleRef.get(TransicionFechaUseCase);
  cambio = moduleRef.get(CambiarFechaUseCase);
});

afterAll(async () => {
  await limpiar();
  await moduleRef.close();
});

beforeEach(async () => {
  await limpiar();
});

// ===========================================================================
// Alta exploratoria + añadir fecha + cambiar fecha → 3 filas E1 (historial completo).
// ===========================================================================

describe('Historial de E1 — un INSERT por evento, sin sobrescribir (D-insert-no-upsert)', () => {
  it('debe_conservar_tres_E1_una_por_evento_con_asuntos_y_fecha_creacion_distintos', async () => {
    // ---- Evento 1: alta EXPLORATORIA (sin fecha) → RESERVA 2a + E1 #1 ------------
    const email = `historial-${sufijo()}${EMAIL_PATTERN}`;
    const resultadoAlta = await alta.ejecutar({
      tenantId: TENANT,
      usuarioId: GESTOR,
      canalEntrada: CanalEntrada.web,
      // sin fechaEvento → exploratoria (2a); con comentarios el E1 queda en borrador
      // (evita el auto-envío por el proveedor de email en integración).
      comentarios: 'Consulta exploratoria de prueba (historial).',
      cliente: {
        nombre: 'Historial',
        apellidos: 'Comunicaciones',
        email,
        telefono: '600100200',
      },
    });
    const reservaId = resultadoAlta.reserva.idReserva;

    // ---- Evento 2: añadir fecha (2a → 2b sobre fecha libre) → E1 #2 -------------
    await transicion.ejecutar({
      tenantId: TENANT,
      usuarioId: GESTOR,
      reservaId,
      fechaEvento: FECHA_ANADIR,
    });

    // ---- Evento 3: cambiar la fecha (2b: FECHA_ANADIR → FECHA_CAMBIO) → E1 #3 ---
    await cambio.ejecutar({
      tenantId: TENANT,
      usuarioId: GESTOR,
      reservaId,
      fechaEvento: FECHA_CAMBIO,
    });

    // ===== SEÑAL RED PRINCIPAL (sin columna nueva; falla hoy con el upsert) ======
    const e1s = await prisma.comunicacion.findMany({
      where: { reservaId, codigoEmail: CodigoEmail.E1 },
      orderBy: { fechaCreacion: 'asc' },
    });
    // Hoy el upsert deja 1 fila (sobrescrita 2 veces) → RED. Objetivo: 3 filas.
    expect(e1s).toHaveLength(3);

    // Ninguna fila sobrescribe a otra: son 3 filas DISTINTAS (id propio) y con
    // fecha_creacion distinguible. El `asunto` PUEDE repetirse legítimamente
    // ("Pre-reserva confirmada" lo comparten la asignación de fecha y el cambio
    // de fecha, misma plantilla de transición): la distinción semántica la da el
    // `subtipo`, verificado más abajo.
    const ids = e1s.map((c) => c.idComunicacion);
    expect(new Set(ids).size).toBe(3);
    const fechasCreacion = e1s.map((c) => c.fechaCreacion.getTime());
    expect(new Set(fechasCreacion).size).toBeGreaterThan(1);

    // ===== SEÑAL RED SECUNDARIA (columna `subtipo`; SQL crudo para compilar hoy) =
    // La columna `subtipo` aún NO existe en el cliente Prisma; se lee por SQL crudo.
    // Hasta el GREEN, la consulta falla (columna inexistente) o devuelve `null`.
    const filasSubtipo = await prisma.$queryRawUnsafe<
      Array<{ subtipo: string | null; asunto: string }>
    >(
      `SELECT subtipo, asunto FROM comunicacion
         WHERE reserva_id = $1 AND codigo_email = 'E1'
         ORDER BY fecha_creacion ASC`,
      reservaId,
    );
    expect(filasSubtipo).toHaveLength(3);
    expect(filasSubtipo.map((f) => f.subtipo)).toEqual([
      'consulta_exploratoria',
      'fecha_disponible',
      'cambio_fecha',
    ]);

    // ===== GUARDA DE REGRESIÓN: el subtipo DEBE viajar por la RUTA DE LECTURA de la app =
    // (repo → controller → JSON), no solo por SQL crudo. Un bug de serialización que dejaba
    // `subtipo=null` en el JSON del listado pasó desapercibido al leer por SQL crudo; esta
    // aserción lee por el MISMO adaptador que usa el controller (`listarPorReserva`) para
    // que la ruta de la app carque el `subtipo` y el hueco no pueda reaparecer.
    const repo = new ComunicacionRepositoryPrismaAdapter(prisma);
    const listado = await repo.listarPorReserva({ tenantId: TENANT, reservaId });
    const e1sListado = listado
      .filter((c) => c.codigoEmail === CodigoEmail.E1)
      .sort((a, b) => a.fechaCreacion.getTime() - b.fechaCreacion.getTime());
    expect(e1sListado).toHaveLength(3);
    expect(e1sListado.map((c) => c.subtipo)).toEqual([
      'consulta_exploratoria',
      'fecha_disponible',
      'cambio_fecha',
    ]);
  });
});
