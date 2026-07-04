/**
 * TESTS DE ATOMICIDAD REAL estado↔E4 de la emisión de la liquidación (US-028 / UC-21) —
 * fase TDD RED. tasks.md Fase 3: 3.4. INVIERTE el patrón post-commit de US-045: si falla
 * la generación del PDF o el envío de E4, la transacción REVIERTE por completo.
 *
 * Trazabilidad: US-028, spec-delta `facturacion` (Requirement "Atomicidad entre la
 * transición de estado y el envío de E4 (rollback ante fallo)", escenarios "Fallo del PDF
 * o del email deja todo en borrador y permite reintento" y "Solo con E4 confirmado se
 * consolidan los cambios de estado"). design.md §D-1 opción A (envío síncrono confirmado;
 * commit SOLO si E4 confirma; transporte FAKE en test/CI). CLAUDE.md §Regla crítica
 * (exclusión SOLO en PostgreSQL; nada de locks distribuidos).
 *
 * INTEGRACIÓN con TRANSACCIONES REALES contra el Postgres del docker-compose (no mocks del
 * repo). Mismo enfoque que `generar-borradores-idempotencia.spec.ts` (US-027). Requiere
 * `docker compose up -d postgres` + migración + seed. BD aislada `slotify_test`
 * (`.env.test`); códigos/emails propios NO compartidos con otras suites para ser
 * DETERMINISTA (memoria: US-004 deadlock flaky / BD aislada). El fallo de E4 se fuerza con
 * el modo FAKE del transporte (`forzarFallo`), sin red.
 *
 * RED: aún NO existe `facturacion/application/aprobar-y-enviar-liquidacion.use-case.ts` ni
 * su cableado en `FacturacionModule` (ni la inyección del transporte E4 en modo fallo). El
 * import falla en compilación y la batería está en ROJO por AUSENCIA DE IMPLEMENTACIÓN (no
 * por infraestructura: el Postgres está arriba). GREEN es de `backend-developer`.
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
  TipoFactura,
  EstadoFactura,
  type Prisma,
} from '@prisma/client';
import { FacturacionModule } from '../facturacion.module';
import { PrismaService } from '../../shared/prisma/prisma.service';
import { FakeEmailAdapter } from '../../comunicaciones/infrastructure/fake-email.adapter';
import { ENVIAR_EMAIL_PORT } from '../../comunicaciones/comunicaciones.tokens';
import {
  AprobarYEnviarLiquidacionUseCase,
  type AprobarYEnviarLiquidacionComando,
} from '../application/aprobar-y-enviar-liquidacion.use-case';

const TENANT = '00000000-0000-0000-0000-000000000001';
const EMAIL_PATTERN = '@us028-atom.test';
const CODIGO_PREFIX = 'TST-U028A-';

let moduleRef: TestingModule;
let prisma: PrismaService;
let useCase: AprobarYEnviarLiquidacionUseCase;
let fakeEmail: FakeEmailAdapter;

const sufijo = (): string => Math.random().toString(36).slice(2, 8);

const comando = (reservaId: string): AprobarYEnviarLiquidacionComando => ({
  tenantId: TENANT,
  usuarioId: 'usr-gestor-atom',
  reservaId,
});

/**
 * Siembra una RESERVA reserva_confirmada con los borradores de liquidación (con extras
 * factura_id NULL) y de fianza ya creados en `borrador` con numero_factura NULL (estado de
 * partida de US-027). Devuelve ids relevantes para las aserciones.
 */
const sembrarReservaConBorradores = async (params: {
  fecha: Date;
}): Promise<{ reservaId: string; liqId: string; fianzaId: string; extraId: string }> => {
  const cliente = await prisma.cliente.create({
    data: {
      tenantId: TENANT,
      nombre: 'Atom',
      apellidos: 'Liquidacion',
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
      tipoEvento: 'boda',
      numAdultosNinosMayores4: 40,
      numNinosMenores4: 5,
      importeTotal: '6000.00',
      importeSenal: '2400.00',
      importeLiquidacion: '3600.00',
      liquidacionStatus: LiquidacionStatus.pendiente,
      fianzaStatus: FianzaStatus.pendiente,
      ttlExpiracion: null,
    },
  });
  const desglose = (total: string): Pick<
    Prisma.FacturaUncheckedCreateInput,
    'baseImponible' | 'ivaPorcentaje' | 'ivaImporte'
  > => ({
    baseImponible: total,
    ivaPorcentaje: '21.00',
    ivaImporte: '0.00',
  });
  const liq = await prisma.factura.create({
    data: {
      tenantId: TENANT,
      reservaId: reserva.idReserva,
      numeroFactura: null,
      tipo: TipoFactura.liquidacion,
      estado: EstadoFactura.borrador,
      total: '4100.00',
      ...desglose('4100.00'),
      pdfUrl: 'https://storage.local/facturas/liq.pdf',
      fechaEmision: null,
    },
  });
  const fianza = await prisma.factura.create({
    data: {
      tenantId: TENANT,
      reservaId: reserva.idReserva,
      numeroFactura: null,
      tipo: TipoFactura.fianza,
      estado: EstadoFactura.borrador,
      total: '1000.00',
      ...desglose('1000.00'),
      pdfUrl: 'https://storage.local/facturas/fianza.pdf',
      fechaEmision: null,
    },
  });
  const extra = await prisma.reservaExtra.create({
    data: {
      reservaId: reserva.idReserva,
      origen: OrigenExtra.presupuesto,
      conceptoLibre: 'Extra pendiente',
      cantidad: 1,
      precioUnitario: '500.00',
      subtotal: '500.00',
      facturaId: null,
    },
  });
  return {
    reservaId: reserva.idReserva,
    liqId: liq.idFactura,
    fianzaId: fianza.idFactura,
    extraId: extra.idReservaExtra,
  };
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
    await prisma.comunicacion.deleteMany({ where: { reservaId: { in: ids } } });
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
  useCase = moduleRef.get(AprobarYEnviarLiquidacionUseCase);
  // El transporte de email en test es el FAKE (cero red): lo obtenemos para forzar fallo.
  fakeEmail = moduleRef.get(ENVIAR_EMAIL_PORT) as unknown as FakeEmailAdapter;
});

afterAll(async () => {
  await limpiar();
  await moduleRef.close();
});

beforeEach(async () => {
  await limpiar();
});

// ===========================================================================
// 3.4 — Fallo de E4 → ROLLBACK TOTAL: ambas FACTURA siguen en borrador,
//        numero_factura NULL, liquidacion_status pendiente, RESERVA_EXTRA sin
//        factura_id, fianza_status pendiente. El Gestor puede reintentar.
// ===========================================================================

describe('AprobarYEnviarLiquidacion — rollback total ante fallo de E4 (3.4)', () => {
  it('debe_dejar_ambas_facturas_en_borrador_sin_numero_cuando_el_envio_de_E4_falla', async () => {
    const { reservaId } = await sembrarReservaConBorradores({
      fecha: new Date(Date.UTC(2029, 8, 1)),
    });
    fakeEmail.forzarFallo(new Error('PROVEEDOR_EMAIL_CAIDO'));

    await expect(useCase.ejecutar(comando(reservaId))).rejects.toBeDefined();

    const facturas = await prisma.factura.findMany({
      where: { reservaId },
      select: { tipo: true, estado: true, numeroFactura: true, fechaEmision: true },
    });
    expect(facturas).toHaveLength(2);
    facturas.forEach((f) => {
      expect(f.estado).toBe('borrador');
      expect(f.numeroFactura).toBeNull();
      expect(f.fechaEmision).toBeNull();
    });
  });

  it('debe_dejar_liquidacion_status_y_fianza_status_en_pendiente_tras_el_fallo', async () => {
    const { reservaId } = await sembrarReservaConBorradores({
      fecha: new Date(Date.UTC(2029, 8, 2)),
    });
    fakeEmail.forzarFallo(new Error('PROVEEDOR_EMAIL_CAIDO'));

    await expect(useCase.ejecutar(comando(reservaId))).rejects.toBeDefined();

    const reserva = await prisma.reserva.findUnique({
      where: { idReserva: reservaId },
      select: { liquidacionStatus: true, fianzaStatus: true },
    });
    expect(reserva?.liquidacionStatus).toBe('pendiente');
    expect(reserva?.fianzaStatus).toBe('pendiente');
  });

  it('no_debe_marcar_los_RESERVA_EXTRA_con_factura_id_tras_el_fallo', async () => {
    const { reservaId, extraId } = await sembrarReservaConBorradores({
      fecha: new Date(Date.UTC(2029, 8, 3)),
    });
    fakeEmail.forzarFallo(new Error('PROVEEDOR_EMAIL_CAIDO'));

    await expect(useCase.ejecutar(comando(reservaId))).rejects.toBeDefined();

    const extra = await prisma.reservaExtra.findUnique({
      where: { idReservaExtra: extraId },
      select: { facturaId: true },
    });
    expect(extra?.facturaId).toBeNull();
  });

  it('no_debe_dejar_ninguna_COMUNICACION_E4_enviado_tras_el_fallo', async () => {
    const { reservaId } = await sembrarReservaConBorradores({
      fecha: new Date(Date.UTC(2029, 8, 4)),
    });
    fakeEmail.forzarFallo(new Error('PROVEEDOR_EMAIL_CAIDO'));

    await expect(useCase.ejecutar(comando(reservaId))).rejects.toBeDefined();

    const enviadas = await prisma.comunicacion.findMany({
      where: { reservaId, codigoEmail: 'E4', estado: 'enviado' },
    });
    expect(enviadas).toHaveLength(0);
  });

  it('debe_permitir_reintentar_con_exito_tras_un_fallo_previo_de_E4', async () => {
    const anio = new Date().getUTCFullYear();
    const { reservaId } = await sembrarReservaConBorradores({
      fecha: new Date(Date.UTC(2029, 8, 5)),
    });

    // Primer intento: E4 falla → rollback total.
    fakeEmail.forzarFallo(new Error('PROVEEDOR_EMAIL_CAIDO'));
    await expect(useCase.ejecutar(comando(reservaId))).rejects.toBeDefined();

    // Segundo intento SIN forzar fallo (nuevo fake sin fallo programado): éxito.
    // El transporte fake se re-crea por el módulo entre módulos; aquí basta con no
    // volver a forzar fallo y reintentar la MISMA reserva (sigue en borrador).
    const resultado = await useCase.ejecutar(comando(reservaId));

    expect(resultado.liquidacion.estado).toBe('enviada');
    expect(resultado.liquidacion.numeroFactura).toMatch(new RegExp(`^F-${anio}-\\d{4,}$`));

    const liq = await prisma.factura.findFirst({
      where: { reservaId, tipo: 'liquidacion' },
      select: { estado: true, numeroFactura: true },
    });
    expect(liq?.estado).toBe('enviada');
    expect(liq?.numeroFactura).toBeTruthy();
  });
});
