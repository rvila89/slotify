/**
 * TESTS DE CONCURRENCIA REALES del registro del cobro de la liquidación (US-029 / UC-21
 * pasos 7-10) — fase TDD RED. tasks.md Fase 3: 3.7. ZONA CRÍTICA (design.md §D-2 opción A):
 * la guarda contra el DOBLE COBRO se serializa releyendo la fila de RESERVA con
 * `SELECT ... FOR UPDATE` DENTRO de la `$transaction` (lock de fila PostgreSQL, NUNCA locks
 * distribuidos / Redis — CLAUDE.md §Regla crítica, hook `no-distributed-lock`). Dos
 * peticiones concurrentes de cobro sobre la MISMA reserva → la primera crea el PAGO y deja
 * `liquidacion_status='cobrada'`; la segunda ve `cobrada` y aborta (409). Un único PAGO, sin
 * doble cobro.
 *
 * Trazabilidad: US-029, spec-delta `facturacion` (Requirement "Guarda contra el doble cobro",
 * escenario "Dos registros de cobro concurrentes solo crean un PAGO"). skill
 * `concurrency-locking`: `Promise.allSettled()`, 1 OK + 1 rechazo, sin efectos duplicados.
 *
 * INTEGRACIÓN con TRANSACCIONES REALES contra el Postgres del docker-compose (no mocks).
 * Mismo enfoque que `generar-factura-senal-concurrencia.spec.ts` (US-022) y
 * `aprobar-y-enviar-concurrencia.spec.ts` (US-028). Requiere `docker compose up -d postgres`
 * + migración + seed. BD aislada `slotify_test` (`.env.test`); códigos/emails propios NO
 * compartidos con otras suites para ser DETERMINISTA (memoria: US-004 deadlock flaky / BD
 * aislada). NO se reintroduce el patrón que provoca deadlock 40P01.
 *
 * RED: aún NO existe `facturacion/application/registrar-cobro-liquidacion.use-case.ts` ni su
 * cableado en `FacturacionModule`. El import falla en compilación y la batería está en ROJO
 * por AUSENCIA DE IMPLEMENTACIÓN (no por infraestructura: el Postgres está arriba). GREEN es
 * de `backend-developer`.
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
  TipoDocumento,
} from '@prisma/client';
import { FacturacionModule } from '../facturacion.module';
import { PrismaService } from '../../shared/prisma/prisma.service';
import {
  RegistrarCobroLiquidacionUseCase,
  LiquidacionYaCobradaError,
  LiquidacionNoFacturadaError,
  JustificanteNoEncontradoError,
  CobroInvalidoError,
  type RegistrarCobroLiquidacionComando,
} from '../application/registrar-cobro-liquidacion.use-case';

const TENANT = '00000000-0000-0000-0000-000000000001';
const TENANT_OTRO = '00000000-0000-0000-0000-0000000000ff';
const EMAIL_PATTERN = '@us029-conc.test';
const CODIGO_PREFIX = 'TST-U029C-';

let moduleRef: TestingModule;
let prisma: PrismaService;
let useCase: RegistrarCobroLiquidacionUseCase;

const sufijo = (): string => Math.random().toString(36).slice(2, 8);

const comando = (
  reservaId: string,
  over: Partial<RegistrarCobroLiquidacionComando> = {},
): RegistrarCobroLiquidacionComando => ({
  tenantId: TENANT,
  usuarioId: 'usr-gestor-conc',
  reservaId,
  importe: '4100.00',
  fechaCobro: '2026-06-15',
  ...over,
});

/**
 * Siembra una RESERVA `reserva_confirmada` con `liquidacion_status='facturada'` y su FACTURA
 * de liquidación en `estado='enviada'` con numero_factura asignado (estado de partida de
 * US-028). Devuelve los ids relevantes.
 */
const sembrarReservaFacturada = async (params: {
  fecha: Date;
  tenantId?: string;
  liquidacionStatus?: LiquidacionStatus;
  facturaEstado?: EstadoFactura;
  total?: string;
}): Promise<{ reservaId: string; facturaId: string; clienteId: string }> => {
  const tenantId = params.tenantId ?? TENANT;
  const cliente = await prisma.cliente.create({
    data: {
      tenantId,
      nombre: 'Conc',
      apellidos: 'Cobro',
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
      tenantId,
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
      importeLiquidacion: params.total ?? '4100.00',
      liquidacionStatus: params.liquidacionStatus ?? LiquidacionStatus.facturada,
      fianzaStatus: FianzaStatus.pendiente,
      ttlExpiracion: null,
    },
  });
  const factura = await prisma.factura.create({
    data: {
      tenantId,
      reservaId: reserva.idReserva,
      numeroFactura: `F-2026-${Math.floor(Math.random() * 9000 + 1000)}`,
      tipo: TipoFactura.liquidacion,
      estado: params.facturaEstado ?? EstadoFactura.enviada,
      total: params.total ?? '4100.00',
      baseImponible: '3388.43',
      ivaPorcentaje: '21.00',
      ivaImporte: '711.57',
      pdfUrl: 'https://storage.local/facturas/liq.pdf',
      fechaEmision: new Date(Date.UTC(2026, 5, 1)),
    },
  });
  return {
    reservaId: reserva.idReserva,
    facturaId: factura.idFactura,
    clienteId: cliente.idCliente,
  };
};

const contarPagosDeFactura = async (facturaId: string): Promise<number> =>
  prisma.pago.count({ where: { facturaId } });

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
    await prisma.comunicacion.deleteMany({ where: { reservaId: { in: ids } } });
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
  useCase = moduleRef.get(RegistrarCobroLiquidacionUseCase);
});

afterAll(async () => {
  await limpiar();
  await moduleRef.close();
});

beforeEach(async () => {
  await limpiar();
});

// ===========================================================================
// 3.7 — DOS cobros CONCURRENTES sobre la MISMA reserva: FOR UPDATE serializa →
//        1 OK + 1 rechazo (409 LIQUIDACION_YA_COBRADA); UN único PAGO.
// ===========================================================================

describe('RegistrarCobroLiquidacion — doble cobro concurrente serializado por FOR UPDATE (3.7)', () => {
  it('debe_permitir_un_cobro_y_rechazar_el_segundo_cuando_son_concurrentes', async () => {
    const { reservaId } = await sembrarReservaFacturada({
      fecha: new Date(Date.UTC(2031, 0, 1)),
    });

    const resultados = await Promise.allSettled([
      useCase.ejecutar(comando(reservaId)),
      useCase.ejecutar(comando(reservaId)),
    ]);

    // Exactamente 1 OK + 1 rechazo (la segunda ve `cobrada` bajo el lock de fila).
    expect(resultados.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(resultados.filter((r) => r.status === 'rejected')).toHaveLength(1);
  });

  it('debe_dejar_un_UNICO_PAGO_para_la_factura_tras_dos_cobros_concurrentes', async () => {
    const { reservaId, facturaId } = await sembrarReservaFacturada({
      fecha: new Date(Date.UTC(2031, 0, 2)),
    });

    await Promise.allSettled([
      useCase.ejecutar(comando(reservaId)),
      useCase.ejecutar(comando(reservaId)),
    ]);

    // Sin doble cobro: un solo registro PAGO conciliado contra la factura.
    expect(await contarPagosDeFactura(facturaId)).toBe(1);
  });

  it('debe_dejar_la_liquidacion_en_cobrada_y_la_factura_cobrada_tras_la_carrera', async () => {
    const { reservaId, facturaId } = await sembrarReservaFacturada({
      fecha: new Date(Date.UTC(2031, 0, 3)),
    });

    await Promise.allSettled([
      useCase.ejecutar(comando(reservaId)),
      useCase.ejecutar(comando(reservaId)),
    ]);

    const reserva = await prisma.reserva.findUnique({
      where: { idReserva: reservaId },
      select: { liquidacionStatus: true, estado: true },
    });
    const factura = await prisma.factura.findUnique({
      where: { idFactura: facturaId },
      select: { estado: true },
    });
    expect(reserva?.liquidacionStatus).toBe('cobrada');
    expect(factura?.estado).toBe('cobrada');
    // Scenario 10: RESERVA.estado NO transiciona a evento_en_curso.
    expect(reserva?.estado).toBe('reserva_confirmada');
  });
});

// ===========================================================================
// 3.4/3.7 — Happy path REAL: un solo cobro crea el PAGO, marca cobrada y deja
//            RESERVA.estado en reserva_confirmada (persistencia verificada en BD).
// ===========================================================================

describe('RegistrarCobroLiquidacion — happy path con persistencia real', () => {
  it('debe_crear_el_PAGO_con_importe_y_fecha_cobro_y_marcar_cobrada', async () => {
    const { reservaId, facturaId } = await sembrarReservaFacturada({
      fecha: new Date(Date.UTC(2031, 1, 1)),
    });

    await useCase.ejecutar(comando(reservaId));

    const pago = await prisma.pago.findFirst({ where: { facturaId } });
    expect(pago).not.toBeNull();
    expect(pago?.importe.toString()).toBe('4100');
    expect(pago?.justificanteDocId).toBeNull();

    const reserva = await prisma.reserva.findUnique({
      where: { idReserva: reservaId },
      select: { liquidacionStatus: true, estado: true },
    });
    expect(reserva?.liquidacionStatus).toBe('cobrada');
    expect(reserva?.estado).toBe('reserva_confirmada');
  });

  it('debe_vincular_el_DOCUMENTO_justificante_pago_al_PAGO_cuando_se_adjunta', async () => {
    const { reservaId, facturaId } = await sembrarReservaFacturada({
      fecha: new Date(Date.UTC(2031, 1, 2)),
    });
    const doc = await prisma.documento.create({
      data: {
        tenantId: TENANT,
        reservaId,
        tipo: TipoDocumento.justificante_pago,
        nombreArchivo: 'transferencia.pdf',
        url: 'https://storage.local/justificantes/t.pdf',
        mimeType: 'application/pdf',
        tamanoBytes: 1024,
      },
    });

    await useCase.ejecutar(comando(reservaId, { justificanteDocId: doc.idDocumento }));

    const pago = await prisma.pago.findFirst({ where: { facturaId } });
    expect(pago?.justificanteDocId).toBe(doc.idDocumento);
  });
});

// ===========================================================================
// 3.8 — Precondición pendiente y doble cobro (secuencial, contra BD real):
//        bloquean sin crear PAGO.
// ===========================================================================

describe('RegistrarCobroLiquidacion — bloqueos con persistencia real (3.8)', () => {
  it('debe_bloquear_y_no_crear_PAGO_cuando_liquidacion_status_es_pendiente', async () => {
    const { reservaId, facturaId } = await sembrarReservaFacturada({
      fecha: new Date(Date.UTC(2031, 2, 1)),
      liquidacionStatus: LiquidacionStatus.pendiente,
      facturaEstado: EstadoFactura.enviada,
    });

    await expect(useCase.ejecutar(comando(reservaId))).rejects.toBeInstanceOf(
      LiquidacionNoFacturadaError,
    );

    expect(await contarPagosDeFactura(facturaId)).toBe(0);
  });

  it('debe_bloquear_el_segundo_cobro_secuencial_sin_crear_PAGO_adicional', async () => {
    const { reservaId, facturaId } = await sembrarReservaFacturada({
      fecha: new Date(Date.UTC(2031, 2, 2)),
    });

    await useCase.ejecutar(comando(reservaId));
    // El segundo cobro secuencial ve `cobrada` bajo el lock de fila → doble cobro (409).
    await expect(useCase.ejecutar(comando(reservaId))).rejects.toBeInstanceOf(
      LiquidacionYaCobradaError,
    );

    expect(await contarPagosDeFactura(facturaId)).toBe(1);
  });
});

// ===========================================================================
// 3.4 — Validaciones de negocio (BD real): importe<=0 y fecha_cobro futura
//        rechazan sin crear PAGO. Multi-tenancy: justificante de otro tenant → 404.
// ===========================================================================

describe('RegistrarCobroLiquidacion — validaciones y multi-tenancy con BD real', () => {
  it('debe_rechazar_importe_no_positivo_sin_crear_PAGO', async () => {
    const { reservaId, facturaId } = await sembrarReservaFacturada({
      fecha: new Date(Date.UTC(2031, 3, 1)),
    });

    await expect(
      useCase.ejecutar(comando(reservaId, { importe: '0.00' })),
    ).rejects.toBeInstanceOf(CobroInvalidoError);

    expect(await contarPagosDeFactura(facturaId)).toBe(0);
  });

  it('debe_rechazar_una_fecha_de_cobro_futura_sin_crear_PAGO', async () => {
    const { reservaId, facturaId } = await sembrarReservaFacturada({
      fecha: new Date(Date.UTC(2031, 3, 2)),
    });

    await expect(
      useCase.ejecutar(comando(reservaId, { fechaCobro: '2999-01-01' })),
    ).rejects.toBeInstanceOf(CobroInvalidoError);

    expect(await contarPagosDeFactura(facturaId)).toBe(0);
  });

  it('debe_rechazar_un_justificante_que_pertenece_a_OTRO_tenant_sin_crear_PAGO', async () => {
    const { reservaId, facturaId } = await sembrarReservaFacturada({
      fecha: new Date(Date.UTC(2031, 3, 3)),
    });
    // Justificante creado en OTRO tenant: invisible por RLS → 404 JUSTIFICANTE_NO_ENCONTRADO.
    const docOtroTenant = await prisma.documento.create({
      data: {
        tenantId: TENANT_OTRO,
        reservaId: null,
        tipo: TipoDocumento.justificante_pago,
        nombreArchivo: 'ajeno.pdf',
        url: 'https://storage.local/justificantes/ajeno.pdf',
        mimeType: 'application/pdf',
        tamanoBytes: 512,
      },
    });

    await expect(
      useCase.ejecutar(comando(reservaId, { justificanteDocId: docOtroTenant.idDocumento })),
    ).rejects.toBeInstanceOf(JustificanteNoEncontradoError);

    expect(await contarPagosDeFactura(facturaId)).toBe(0);

    await prisma.documento.delete({ where: { idDocumento: docOtroTenant.idDocumento } });
  });

  it('debe_rechazar_un_justificante_de_tipo_incorrecto_o_de_OTRA_reserva_con_404', async () => {
    // MEJORA 1 (post-review): `buscarJustificante` acota por tipo=justificante_pago Y reservaId.
    const { reservaId, facturaId } = await sembrarReservaFacturada({
      fecha: new Date(Date.UTC(2031, 3, 5)),
    });

    // (a) DOCUMENTO del MISMO tenant y reserva pero de TIPO incorrecto (no es justificante_pago).
    const docTipoIncorrecto = await prisma.documento.create({
      data: {
        tenantId: TENANT,
        reservaId,
        tipo: TipoDocumento.presupuesto,
        nombreArchivo: 'presupuesto.pdf',
        url: 'https://storage.local/otros/presupuesto.pdf',
        mimeType: 'application/pdf',
        tamanoBytes: 256,
      },
    });

    await expect(
      useCase.ejecutar(comando(reservaId, { justificanteDocId: docTipoIncorrecto.idDocumento })),
    ).rejects.toBeInstanceOf(JustificanteNoEncontradoError);
    expect(await contarPagosDeFactura(facturaId)).toBe(0);

    // (b) DOCUMENTO justificante_pago del MISMO tenant pero vinculado a OTRA reserva.
    const otra = await sembrarReservaFacturada({ fecha: new Date(Date.UTC(2031, 3, 6)) });
    const docOtraReserva = await prisma.documento.create({
      data: {
        tenantId: TENANT,
        reservaId: otra.reservaId,
        tipo: TipoDocumento.justificante_pago,
        nombreArchivo: 'otra-reserva.pdf',
        url: 'https://storage.local/justificantes/otra.pdf',
        mimeType: 'application/pdf',
        tamanoBytes: 128,
      },
    });

    await expect(
      useCase.ejecutar(comando(reservaId, { justificanteDocId: docOtraReserva.idDocumento })),
    ).rejects.toBeInstanceOf(JustificanteNoEncontradoError);
    expect(await contarPagosDeFactura(facturaId)).toBe(0);
  });

  it('debe_registrar_alertaDiscrepancia_y_crear_PAGO_con_importe_real_cuando_difiere', async () => {
    const { reservaId, facturaId } = await sembrarReservaFacturada({
      fecha: new Date(Date.UTC(2031, 3, 4)),
      total: '4100.00',
    });

    const resultado = await useCase.ejecutar(comando(reservaId, { importe: '4000.00' }));

    expect(resultado.alertaDiscrepancia).toEqual({
      importeFacturado: '4100.00',
      importeCobrado: '4000.00',
      diferencia: '100.00',
    });
    const pago = await prisma.pago.findFirst({ where: { facturaId } });
    expect(pago?.importe.toString()).toBe('4000');
    expect(await contarPagosDeFactura(facturaId)).toBe(1);
  });
});
