/**
 * TESTS DE CONCURRENCIA REALES de la confirmación del presupuesto / activación de
 * pre_reserva (US-014 / UC-14) — fase TDD RED. tasks.md Fase 3: 3.1. ZONA CRÍTICA
 * (anti-doble-reserva D4: serialización por `UNIQUE(tenant_id, fecha)` + `SELECT …
 * FOR UPDATE` sobre la fila bloqueante).
 *
 * Trazabilidad: US-014, spec-delta `consultas` (Requirement "Concurrencia
 * anti-doble-reserva (D4) al activar pre_reserva", escenarios "Dos confirmaciones
 * sobre la misma fecha — una gana, la otra Fecha no disponible" y "Doble clic sobre
 * el mismo presupuesto aplica la transición una sola vez"). CLAUDE.md §Testing
 * ("tests de concurrencia del bloqueo atómico de fecha antes que UI o CRUD") y
 * §Regla crítica (la exclusión mutua vive SOLO en PostgreSQL; nada de Redis/locks
 * distribuidos). skill `concurrency-locking`: `Promise.allSettled()`, 1 OK + 1 rechazo.
 *
 * INTEGRACIÓN con TRANSACCIONES REALES contra el Postgres del docker-compose (no
 * mocks). Mismo enfoque que `transicion-fecha-concurrencia.spec.ts` (US-005) y
 * `alta-consulta-con-fecha-concurrencia.spec.ts` (US-004). Requiere `docker compose
 * up -d postgres` + migración + seed. NOTA (deuda conocida US-004): NO se reintroduce
 * el patrón que provoca deadlock 40P01; se sigue el patrón vigente del repo.
 *
 * RED: aún NO existe `presupuestos/application/generar-presupuesto.use-case.ts` ni el
 * cableado de `PresupuestosModule`. El import falla en compilación y la batería está en
 * ROJO por AUSENCIA DE IMPLEMENTACIÓN (no por infraestructura: el Postgres está arriba).
 * GREEN es de `backend-developer`.
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
import { PresupuestosModule } from '../presupuestos.module';
import { PrismaService } from '../../shared/prisma/prisma.service';
import {
  GenerarPresupuestoUseCase,
  type ConfirmarPresupuestoComando,
} from '../application/generar-presupuesto.use-case';

const TENANT = '00000000-0000-0000-0000-000000000001';
const GESTOR = '00000000-0000-0000-0000-000000000002';
const EMAIL_PATTERN = '@us014-conc.test';
const DIA_MS = 24 * 60 * 60 * 1000;

// Fechas estrictamente futuras y aisladas (no usadas por el seed ni otras suites).
const FECHA_DOS_RESERVAS = new Date('2028-01-12T00:00:00.000Z');
const FECHA_DOBLE_CLIC = new Date('2028-01-13T00:00:00.000Z');
const FECHAS = [FECHA_DOS_RESERVAS, FECHA_DOBLE_CLIC];

const ttlVigente = (): Date => new Date(Date.now() + 3 * DIA_MS);

let moduleRef: TestingModule;
let prisma: PrismaService;
let useCase: GenerarPresupuestoUseCase;

const sufijo = (): string => Math.random().toString(36).slice(2, 8);

const comandoConfirmar = (reservaId: string): ConfirmarPresupuestoComando => ({
  tenantId: TENANT,
  usuarioId: GESTOR,
  reservaId,
  extras: [],
  // 6.2: método de pago obligatorio; concurrencia sobre la variante CON IVA.
  metodoPago: 'transferencia',
});

/**
 * Siembra una consulta activa con CLIENTE fiscalmente completo y datos de reserva
 * completos. `conBloqueo=true` para 2.b (UPDATE); `false` para 2.a (INSERT).
 */
const sembrarConsulta = async (params: {
  fecha: Date;
  subEstado: SubEstadoConsulta;
  conBloqueo: boolean;
}): Promise<string> => {
  const cliente = await prisma.cliente.create({
    data: {
      tenantId: TENANT,
      nombre: 'Conc',
      email: `cli-${sufijo()}${EMAIL_PATTERN}`,
      dniNif: '12345678Z',
      direccion: 'C/ Mayor 1',
      codigoPostal: '08001',
      poblacion: 'Barcelona',
      provincia: 'Barcelona',
    },
  });
  const reserva = await prisma.reserva.create({
    data: {
      tenantId: TENANT,
      clienteId: cliente.idCliente,
      codigo: `TST-U014C-${sufijo()}`,
      estado: EstadoReserva.consulta,
      subEstado: params.subEstado,
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
        tenantId: TENANT,
        fecha: params.fecha,
        reservaId: reserva.idReserva,
        tipoBloqueo: TipoBloqueo.blando,
        ttlExpiracion: ttlVigente(),
      },
    });
  }
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
  await prisma.fechaBloqueada.deleteMany({ where: { tenantId: TENANT, fecha: { in: FECHAS } } });
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
// 3.1 — Dos RESERVA distintas para la MISMA (tenant, fecha): una en 2.a (INSERT),
//        otra en 2.b (UPDATE). Dos confirmaciones concurrentes → exactamente UNA
//        gana; la otra choca con UNIQUE(tenant,fecha) / FOR UPDATE ("Fecha no
//        disponible"). NUNCA doble bloqueo. (Promise.allSettled: 1 OK + 1 rechazo.)
// ===========================================================================

describe('Confirmar — dos reservas sobre la misma fecha (2.a INSERT vs 2.b UPDATE) (3.1)', () => {
  it('debe_permitir_exactamente_una_confirmacion_y_rechazar_la_otra_por_fecha_no_disponible', async () => {
    // OJO: la 2.b ya tiene su propia fila FECHA_BLOQUEADA de la misma (tenant, fecha);
    // por eso la 2.a que intenta INSERTAR choca con el UNIQUE. Ambas apuntan a la
    // misma fecha (escenario de doble-reserva D4).
    const reservaUpdate2b = await sembrarConsulta({
      fecha: FECHA_DOS_RESERVAS,
      subEstado: SubEstadoConsulta.s2b,
      conBloqueo: true,
    });
    const reservaInsert2a = await sembrarConsulta({
      fecha: FECHA_DOS_RESERVAS,
      subEstado: SubEstadoConsulta.s2a,
      conBloqueo: false,
    });

    const resultados = await Promise.allSettled([
      useCase.confirmar(comandoConfirmar(reservaUpdate2b)),
      useCase.confirmar(comandoConfirmar(reservaInsert2a)),
    ]);

    // Exactamente 1 gana, 1 se rechaza (Fecha no disponible / conflicto de lock).
    const cumplidas = resultados.filter((r) => r.status === 'fulfilled');
    const rechazadas = resultados.filter((r) => r.status === 'rejected');
    expect(cumplidas).toHaveLength(1);
    expect(rechazadas).toHaveLength(1);

    // Estado final coherente: EXACTAMENTE UNA fila de FECHA_BLOQUEADA para (tenant, fecha).
    const filas = await prisma.fechaBloqueada.findMany({
      where: { tenantId: TENANT, fecha: FECHA_DOS_RESERVAS },
    });
    expect(filas).toHaveLength(1);

    // Exactamente UNA de las dos reservas quedó en pre_reserva (la ganadora); la otra
    // permanece en su sub_estado origen, sin PRESUPUESTO.
    const enPreReserva = await prisma.reserva.count({
      where: {
        idReserva: { in: [reservaUpdate2b, reservaInsert2a] },
        estado: EstadoReserva.pre_reserva,
      },
    });
    expect(enPreReserva).toBe(1);

    const presupuestos = await prisma.presupuesto.findMany({
      where: { reservaId: { in: [reservaUpdate2b, reservaInsert2a] } },
    });
    // Sin doble bloqueo ni doble presupuesto: exactamente uno.
    expect(presupuestos).toHaveLength(1);
  });
});

// ===========================================================================
// 3.1 — Doble clic sobre el MISMO presupuesto: dos confirmaciones simultáneas de la
//        MISMA reserva → exactamente una aplica la transición (pre_reserva + bloqueo
//        + presupuesto); la otra observa que ya no está en {2a,2b,2c,2v} (guarda de
//        origen) o choca con la unicidad. Sin doble PRESUPUESTO ni doble bloqueo.
// ===========================================================================

describe('Confirmar — doble clic sobre el mismo presupuesto aplica una sola vez (3.1)', () => {
  it('debe_aplicar_la_transicion_una_sola_vez_y_rechazar_la_segunda_sin_doble_presupuesto', async () => {
    const reservaId = await sembrarConsulta({
      fecha: FECHA_DOBLE_CLIC,
      subEstado: SubEstadoConsulta.s2b,
      conBloqueo: true,
    });

    const resultados = await Promise.allSettled([
      useCase.confirmar(comandoConfirmar(reservaId)),
      useCase.confirmar(comandoConfirmar(reservaId)),
    ]);

    // Exactamente 1 aplica; 1 se rechaza (guarda de origen / unicidad).
    expect(resultados.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(resultados.filter((r) => r.status === 'rejected')).toHaveLength(1);

    // La RESERVA quedó en pre_reserva (transición aplicada una sola vez).
    const reserva = await prisma.reserva.findUnique({ where: { idReserva: reservaId } });
    expect(reserva?.estado).toBe(EstadoReserva.pre_reserva);

    // UN solo PRESUPUESTO (sin doble por doble clic).
    const presupuestos = await prisma.presupuesto.findMany({ where: { reservaId } });
    expect(presupuestos).toHaveLength(1);

    // UNA sola fila de FECHA_BLOQUEADA para (tenant, fecha).
    const filas = await prisma.fechaBloqueada.findMany({
      where: { tenantId: TENANT, fecha: FECHA_DOBLE_CLIC },
    });
    expect(filas).toHaveLength(1);
  });
});
