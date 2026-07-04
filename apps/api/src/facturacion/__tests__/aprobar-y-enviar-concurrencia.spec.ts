/**
 * TESTS DE CONCURRENCIA REALES de la numeración EN LA EMISIÓN de la liquidación + fianza
 * (US-028 / UC-21) — fase TDD RED. tasks.md Fase 3: 3.5. ZONA CRÍTICA de la numeración:
 * el numero_factura se asigna SOLO al emitir (nunca en borrador); dos emisiones
 * concurrentes del MISMO tenant resuelven la colisión por `UNIQUE(tenant_id,
 * numero_factura)` + reintento aplicativo ante `P2002` (reuso de US-022), NUNCA locks
 * distribuidos. Cubre AMBAS numeraciones (liquidacion + fianza) en la misma unidad de
 * trabajo (D-6): ninguna sin número, sin duplicados, sin huecos consolidados.
 *
 * Trazabilidad: US-028, spec-delta `facturacion` (Requirement "Emisión de la factura de
 * liquidación…" — número en la emisión; §atomicidad; D-6 número propio de la fianza).
 * design.md §D-1/§D-6. CLAUDE.md §Regla crítica (exclusión SOLO en PostgreSQL) y §Testing
 * (concurrencia antes que UI). skill `concurrency-locking`: `Promise.allSettled()`, sin
 * duplicados ni huecos.
 *
 * INTEGRACIÓN con TRANSACCIONES REALES contra el Postgres del docker-compose (no mocks).
 * Mismo enfoque que `generar-factura-senal-concurrencia.spec.ts` (US-022). Requiere
 * `docker compose up -d postgres` + migración + seed. BD aislada `slotify_test`
 * (`.env.test`); códigos/emails propios NO compartidos con otras suites para ser
 * DETERMINISTA (memoria: US-004 deadlock flaky / BD aislada). NO se reintroduce el patrón
 * que provoca deadlock 40P01. Transporte de email en modo FAKE (cero red).
 *
 * RED: aún NO existe `facturacion/application/aprobar-y-enviar-liquidacion.use-case.ts` ni
 * su cableado en `FacturacionModule`. El import falla en compilación y la batería está en
 * ROJO por AUSENCIA DE IMPLEMENTACIÓN (no por infraestructura). GREEN es de
 * `backend-developer`.
 */
import { Test, type TestingModule } from '@nestjs/testing';
import { ConfigModule } from '@nestjs/config';
import {
  CanalEntrada,
  DuracionHoras,
  EstadoReserva,
  FianzaStatus,
  LiquidacionStatus,
  TipoFactura,
  EstadoFactura,
} from '@prisma/client';
import { FacturacionModule } from '../facturacion.module';
import { PrismaService } from '../../shared/prisma/prisma.service';
import {
  AprobarYEnviarLiquidacionUseCase,
  type AprobarYEnviarLiquidacionComando,
} from '../application/aprobar-y-enviar-liquidacion.use-case';

const TENANT = '00000000-0000-0000-0000-000000000001';
const EMAIL_PATTERN = '@us028-conc.test';
const CODIGO_PREFIX = 'TST-U028C-';

let moduleRef: TestingModule;
let prisma: PrismaService;
let useCase: AprobarYEnviarLiquidacionUseCase;

const sufijo = (): string => Math.random().toString(36).slice(2, 8);

const comando = (reservaId: string): AprobarYEnviarLiquidacionComando => ({
  tenantId: TENANT,
  usuarioId: 'usr-gestor-conc',
  reservaId,
});

const sembrarReservaConBorradores = async (params: { fecha: Date }): Promise<string> => {
  const cliente = await prisma.cliente.create({
    data: {
      tenantId: TENANT,
      nombre: 'Conc',
      apellidos: 'Emision',
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
  await prisma.factura.create({
    data: {
      tenantId: TENANT,
      reservaId: reserva.idReserva,
      numeroFactura: null,
      tipo: TipoFactura.liquidacion,
      estado: EstadoFactura.borrador,
      total: '3600.00',
      baseImponible: '2975.21',
      ivaPorcentaje: '21.00',
      ivaImporte: '624.79',
      pdfUrl: 'https://storage.local/facturas/liq.pdf',
      fechaEmision: null,
    },
  });
  await prisma.factura.create({
    data: {
      tenantId: TENANT,
      reservaId: reserva.idReserva,
      numeroFactura: null,
      tipo: TipoFactura.fianza,
      estado: EstadoFactura.borrador,
      total: '1000.00',
      baseImponible: '826.45',
      ivaPorcentaje: '21.00',
      ivaImporte: '173.55',
      pdfUrl: 'https://storage.local/facturas/fianza.pdf',
      fechaEmision: null,
    },
  });
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
});

afterAll(async () => {
  await limpiar();
  await moduleRef.close();
});

beforeEach(async () => {
  await limpiar();
});

// ===========================================================================
// 3.5 — El número se asigna SOLO en la emisión (borrador → NULL).
// ===========================================================================

describe('AprobarYEnviarLiquidacion — el número se asigna solo al emitir (3.5)', () => {
  it('debe_mantener_numero_factura_NULL_mientras_las_facturas_esten_en_borrador', async () => {
    const reservaId = await sembrarReservaConBorradores({
      fecha: new Date(Date.UTC(2030, 0, 1)),
    });

    // Antes de emitir: ambas en borrador con numero_factura NULL.
    const previas = await prisma.factura.findMany({
      where: { reservaId },
      select: { estado: true, numeroFactura: true },
    });
    expect(previas).toHaveLength(2);
    previas.forEach((f) => {
      expect(f.estado).toBe('borrador');
      expect(f.numeroFactura).toBeNull();
    });

    await useCase.ejecutar(comando(reservaId));

    // Tras emitir: ambas con número asignado.
    const posteriores = await prisma.factura.findMany({
      where: { reservaId },
      select: { estado: true, numeroFactura: true },
    });
    posteriores.forEach((f) => {
      expect(f.estado).toBe('enviada');
      expect(f.numeroFactura).toBeTruthy();
    });
  });
});

// ===========================================================================
// 3.5 — N emisiones concurrentes de reservas DISTINTAS del MISMO tenant: la
//        colisión de numero_factura la resuelve UNIQUE(tenant_id, numero_factura)
//        (P2002) + reintento; todas terminan con número ÚNICO, sin duplicados ni
//        huecos. Cubre AMBAS numeraciones (liquidacion + fianza).
// ===========================================================================

describe('AprobarYEnviarLiquidacion — numeración concurrente en la emisión (3.5)', () => {
  const anio = new Date().getUTCFullYear();

  it('debe_asignar_numeros_unicos_a_las_facturas_de_6_emisiones_concurrentes_del_mismo_tenant', async () => {
    const reservaIds = await Promise.all(
      Array.from({ length: 6 }, (_, i) =>
        sembrarReservaConBorradores({ fecha: new Date(Date.UTC(2030, 1, 1 + i)) }),
      ),
    );

    const resultados = await Promise.allSettled(
      reservaIds.map((id) => useCase.ejecutar(comando(id))),
    );

    // Ninguna emisión se pierde: el reintento ante P2002 las resuelve todas.
    expect(resultados.filter((r) => r.status === 'fulfilled')).toHaveLength(6);

    // 12 facturas emitidas (6 liquidaciones + 6 fianzas), TODAS con número único.
    const facturas = await prisma.factura.findMany({
      where: { reservaId: { in: reservaIds } },
      select: { numeroFactura: true, tipo: true },
    });
    expect(facturas).toHaveLength(12);
    facturas.forEach((f) => expect(f.numeroFactura).toBeTruthy());

    const numeros = facturas.map((f) => f.numeroFactura ?? '');
    // Sin duplicados: tantos números distintos como facturas.
    expect(new Set(numeros).size).toBe(12);
    // Todos con formato F-YYYY-NNNN del año en curso.
    numeros.forEach((n) => expect(n).toMatch(new RegExp(`^F-${anio}-\\d{4,}$`)));
  });

  it('no_debe_dejar_ninguna_factura_sin_numero_ni_dos_con_el_mismo_numero_bajo_concurrencia', async () => {
    const reservaIds = await Promise.all(
      Array.from({ length: 4 }, (_, i) =>
        sembrarReservaConBorradores({ fecha: new Date(Date.UTC(2030, 2, 1 + i)) }),
      ),
    );

    await Promise.allSettled(reservaIds.map((id) => useCase.ejecutar(comando(id))));

    const facturas = await prisma.factura.findMany({
      where: { reservaId: { in: reservaIds } },
      select: { numeroFactura: true },
    });
    expect(facturas.every((f) => !!f.numeroFactura)).toBe(true);
    const numeros = facturas.map((f) => f.numeroFactura ?? '');
    expect(new Set(numeros).size).toBe(numeros.length);
  });

  it('debe_formar_un_rango_contiguo_sin_huecos_consolidados_entre_las_facturas_emitidas', async () => {
    const reservaIds = await Promise.all(
      Array.from({ length: 5 }, (_, i) =>
        sembrarReservaConBorradores({ fecha: new Date(Date.UTC(2030, 3, 1 + i)) }),
      ),
    );

    await Promise.allSettled(reservaIds.map((id) => useCase.ejecutar(comando(id))));

    const facturas = await prisma.factura.findMany({
      where: { reservaId: { in: reservaIds } },
      select: { numeroFactura: true },
    });
    const secuencias = facturas
      .map((f) => Number((f.numeroFactura ?? '').split('-')[2]))
      .sort((a, b) => a - b);
    // 10 facturas emitidas (5 liq + 5 fianza) → 10 secuencias contiguas.
    expect(secuencias).toHaveLength(10);
    for (let i = 1; i < secuencias.length; i += 1) {
      expect(secuencias[i]).toBe(secuencias[i - 1] + 1);
    }
  });
});
