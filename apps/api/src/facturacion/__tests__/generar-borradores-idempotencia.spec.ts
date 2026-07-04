/**
 * TESTS DE IDEMPOTENCIA + CONCURRENCIA REALES de la generación de los borradores de
 * liquidación y fianza (US-027 / UC-21, UC-22) — fase TDD RED. tasks.md Fase 3: 3.7.
 *
 * ZONA de idempotencia (design.md §D-4/§D-8): guarda de existencia por `(reserva_id, tipo)`
 * + constraint `UNIQUE(reserva_id, tipo)` (ya migrado en US-022, cubre liquidacion/fianza)
 * como red de seguridad ante disparos concurrentes del trigger post-commit. Ante colisión
 * `P2002` el use-case recupera la existente. NUNCA locks distribuidos (hook
 * `no-distributed-lock`, CLAUDE.md §Regla crítica).
 *
 * Trazabilidad: US-027, spec-delta `facturacion` (Requirement "Idempotencia — una única
 * liquidación y un único recibo de fianza por reserva", escenario "Reinvocación del trigger
 * no duplica los borradores de liquidación ni de fianza"). skill `concurrency-locking`:
 * `Promise.allSettled()`, resultado sin duplicados.
 *
 * INTEGRACIÓN con TRANSACCIONES REALES contra el Postgres del docker-compose (no mocks).
 * Mismo enfoque que `generar-factura-senal-concurrencia.spec.ts` (US-022). Requiere
 * `docker compose up -d postgres` + migración + seed (tenant piloto). BD aislada
 * `slotify_test` (`.env.test`); códigos/emails propios no compartidos con otras suites para
 * ser DETERMINISTA (memoria: US-004 deadlock flaky / BD aislada). NO se reintroduce el patrón
 * que provoca deadlock 40P01.
 *
 * RED: aún NO existe `facturacion/application/generar-borradores-liquidacion-fianza.use-case.ts`
 * ni su cableado en `FacturacionModule`. El import falla en compilación y la batería está en
 * ROJO por AUSENCIA DE IMPLEMENTACIÓN (no por infraestructura: el Postgres está arriba).
 * GREEN es de `backend-developer`.
 */
import { Test, type TestingModule } from '@nestjs/testing';
import { ConfigModule } from '@nestjs/config';
import {
  CanalEntrada,
  DuracionHoras,
  EstadoReserva,
  FianzaStatus,
  LiquidacionStatus,
  OrigenExtra,
  TipoEvento,
} from '@prisma/client';
import { FacturacionModule } from '../facturacion.module';
import { PrismaService } from '../../shared/prisma/prisma.service';
import {
  GenerarBorradoresLiquidacionFianzaUseCase,
  type GenerarBorradoresComando,
} from '../application/generar-borradores-liquidacion-fianza.use-case';

const TENANT = '00000000-0000-0000-0000-000000000001';
const EMAIL_PATTERN = '@us027-idem.test';
const CODIGO_PREFIX = 'TST-U027I-';

let moduleRef: TestingModule;
let prisma: PrismaService;
let useCase: GenerarBorradoresLiquidacionFianzaUseCase;

const sufijo = (): string => Math.random().toString(36).slice(2, 8);

const comando = (reservaId: string): GenerarBorradoresComando => ({
  tenantId: TENANT,
  reservaId,
});

/**
 * Siembra una RESERVA en `reserva_confirmada` con importe_liquidacion congelado, sus
 * sub-procesos liquidacion/fianza en `pendiente` y N extras con factura_id IS NULL.
 * Fechas propias no compartidas con otras suites.
 */
const sembrarReservaConfirmada = async (params: {
  fecha: Date;
  importeLiquidacion?: string;
  subtotalesExtras?: ReadonlyArray<string>;
}): Promise<string> => {
  const cliente = await prisma.cliente.create({
    data: {
      tenantId: TENANT,
      nombre: 'Idem',
      apellidos: 'Borradores',
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
      codigo: `${CODIGO_PREFIX}${sufijo()}`,
      estado: EstadoReserva.reserva_confirmada,
      subEstado: null,
      canalEntrada: CanalEntrada.web,
      fechaEvento: params.fecha,
      duracionHoras: DuracionHoras.h8,
      tipoEvento: TipoEvento.boda,
      numAdultosNinosMayores4: 40,
      numNinosMenores4: 5,
      importeTotal: '6000.00',
      importeSenal: '2400.00',
      importeLiquidacion: params.importeLiquidacion ?? '3600.00',
      liquidacionStatus: LiquidacionStatus.pendiente,
      fianzaStatus: FianzaStatus.pendiente,
      ttlExpiracion: null,
    },
  });
  for (const subtotal of params.subtotalesExtras ?? []) {
    await prisma.reservaExtra.create({
      data: {
        reservaId: reserva.idReserva,
        origen: OrigenExtra.presupuesto,
        conceptoLibre: 'Extra pendiente',
        cantidad: 1,
        precioUnitario: subtotal,
        subtotal,
        facturaId: null,
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
    where: {
      OR: [{ clienteId: { in: clienteIds } }, { codigo: { startsWith: CODIGO_PREFIX } }],
    },
    select: { idReserva: true, clienteId: true },
  });
  const ids = reservas.map((r) => r.idReserva);
  const todosClienteIds = [...new Set([...clienteIds, ...reservas.map((r) => r.clienteId)])];
  if (ids.length > 0) {
    await prisma.pago.deleteMany({ where: { factura: { reservaId: { in: ids } } } });
    await prisma.reservaExtra.deleteMany({ where: { reservaId: { in: ids } } });
    await prisma.factura.deleteMany({ where: { reservaId: { in: ids } } });
    await prisma.documento.deleteMany({ where: { reservaId: { in: ids } } });
    await prisma.auditLog.deleteMany({ where: { entidadId: { in: ids } } });
    await prisma.reserva.deleteMany({ where: { idReserva: { in: ids } } });
  }
  if (todosClienteIds.length > 0) {
    await prisma.cliente.deleteMany({ where: { idCliente: { in: todosClienteIds } } });
  }
};

beforeAll(async () => {
  moduleRef = await Test.createTestingModule({
    imports: [ConfigModule.forRoot({ isGlobal: true }), FacturacionModule],
  }).compile();
  await moduleRef.init();
  prisma = moduleRef.get(PrismaService);
  useCase = moduleRef.get(GenerarBorradoresLiquidacionFianzaUseCase);
});

afterAll(async () => {
  await limpiar();
  await moduleRef.close();
});

beforeEach(async () => {
  await limpiar();
});

// ===========================================================================
// 3.7 — Reinvocación SECUENCIAL del trigger: el segundo disparo NO duplica los
//        borradores (guarda por (reserva_id, tipo)); una liquidación y una fianza.
// ===========================================================================

describe('GenerarBorradores — reinvocación secuencial del trigger no duplica (3.7)', () => {
  it('debe_dejar_una_sola_liquidacion_y_una_sola_fianza_tras_dos_disparos_secuenciales', async () => {
    const reservaId = await sembrarReservaConfirmada({
      fecha: new Date(Date.UTC(2029, 5, 1)),
      importeLiquidacion: '3600.00',
      subtotalesExtras: ['300.00', '200.00'],
    });

    await useCase.ejecutar(comando(reservaId));
    // Segundo disparo (p. ej. reintento tras fallo transitorio): idempotente.
    await useCase.ejecutar(comando(reservaId));

    const facturas = await prisma.factura.findMany({
      where: { reservaId },
      select: { tipo: true, total: true, numeroFactura: true, estado: true },
    });
    const liquidaciones = facturas.filter((f) => f.tipo === 'liquidacion');
    const fianzas = facturas.filter((f) => f.tipo === 'fianza');
    expect(liquidaciones).toHaveLength(1);
    expect(fianzas).toHaveLength(1);
    // Borradores sin número; liquidación con el total 60 % + extras.
    expect(liquidaciones[0].numeroFactura).toBeNull();
    expect(Number(liquidaciones[0].total)).toBe(4100);
    expect(liquidaciones[0].estado).toBe('borrador');
  });
});

// ===========================================================================
// 3.7 — Reinvocación CONCURRENTE del trigger (doble disparo simultáneo de la
//        MISMA reserva): la colisión (P2002 del UNIQUE(reserva_id, tipo)) la
//        resuelve la guarda + reintento; NO se crean duplicados.
// ===========================================================================

describe('GenerarBorradores — doble disparo concurrente de la misma reserva no duplica (3.7)', () => {
  it('debe_crear_como_maximo_una_liquidacion_y_una_fianza_con_dos_disparos_simultaneos', async () => {
    const reservaId = await sembrarReservaConfirmada({
      fecha: new Date(Date.UTC(2029, 5, 2)),
      importeLiquidacion: '3600.00',
      subtotalesExtras: ['300.00', '200.00'],
    });

    // Dos disparos SIMULTÁNEOS del trigger sobre la misma reserva.
    const resultados = await Promise.allSettled([
      useCase.ejecutar(comando(reservaId)),
      useCase.ejecutar(comando(reservaId)),
    ]);

    // Ninguno debe explotar sin control: la colisión P2002 se recupera (idempotencia).
    const rechazados = resultados.filter((r) => r.status === 'rejected');
    expect(rechazados).toHaveLength(0);

    // Estado de BD: exactamente una liquidación y una fianza (sin duplicados).
    const facturas = await prisma.factura.findMany({
      where: { reservaId },
      select: { tipo: true },
    });
    expect(facturas.filter((f) => f.tipo === 'liquidacion')).toHaveLength(1);
    expect(facturas.filter((f) => f.tipo === 'fianza')).toHaveLength(1);
  });
});
