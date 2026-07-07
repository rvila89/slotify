/**
 * TESTS DE CONCURRENCIA REALES del registro del cobro de la FIANZA (US-030 / UC-22 pasos 5-9) —
 * fase TDD RED. tasks.md Fase 3: 3.7. ZONA CRÍTICA (design.md §D-1, patrón US-029 opción A): la
 * guarda contra el DOBLE COBRO se serializa releyendo la fila de RESERVA con
 * `SELECT ... FOR UPDATE` DENTRO de la `$transaction` (lock de fila PostgreSQL, NUNCA locks
 * distribuidos / Redis — CLAUDE.md §Regla crítica, hook `no-distributed-lock`). Dos peticiones
 * concurrentes de cobro de fianza sobre la MISMA reserva → la primera crea el PAGO y deja
 * `fianza_status='cobrada'`; la segunda ve `cobrada` y aborta (409 FIANZA_YA_COBRADA). Un único
 * PAGO, sin doble cobro.
 *
 * Trazabilidad: US-030, spec-delta `facturacion` (Requirement "Guarda contra el doble cobro de la
 * fianza", escenario "Dos registros de cobro de fianza concurrentes solo crean un PAGO"). Skill
 * `concurrency-locking`: `Promise.allSettled()`, 1 OK + 1 rechazo, sin efectos duplicados.
 *
 * INTEGRACIÓN con TRANSACCIONES REALES contra el Postgres del docker-compose (NO mocks del
 * adapter — requisito duro tras la lección US-049: un adapter mockeado ocultó bugs en la BD
 * real). Mismo enfoque que `registrar-cobro-concurrencia.spec.ts` (US-029),
 * `aprobar-y-enviar-concurrencia.spec.ts` (US-028) y `generar-factura-senal-concurrencia.spec.ts`
 * (US-022). Requiere `docker compose up -d postgres` + migración + seed. BD aislada
 * `slotify_test` (`.env.test`); códigos/emails propios NO compartidos con otras suites para ser
 * DETERMINISTA (memoria: US-004 deadlock flaky / BD aislada). NO se reintroduce el patrón que
 * provoca deadlock 40P01.
 *
 * RED: aún NO existe `facturacion/application/registrar-cobro-fianza.use-case.ts` ni su cableado
 * en `FacturacionModule`. El import falla en compilación y la batería está en ROJO por AUSENCIA
 * DE IMPLEMENTACIÓN (no por infraestructura: el Postgres está arriba). GREEN es de
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
  TipoDocumento,
} from '@prisma/client';
import { FacturacionModule } from '../facturacion.module';
import { PrismaService } from '../../shared/prisma/prisma.service';
import {
  RegistrarCobroFianzaUseCase,
  FianzaYaCobradaError,
  FacturaFianzaNoEncontradaError,
  JustificanteNoEncontradoError,
  CobroInvalidoError,
  type RegistrarCobroFianzaComando,
} from '../application/registrar-cobro-fianza.use-case';

const TENANT = '00000000-0000-0000-0000-000000000001';
const TENANT_OTRO = '00000000-0000-0000-0000-0000000000ff';
const EMAIL_PATTERN = '@us030-conc.test';
const CODIGO_PREFIX = 'TST-U030C-';

let moduleRef: TestingModule;
let prisma: PrismaService;
let useCase: RegistrarCobroFianzaUseCase;

const sufijo = (): string => Math.random().toString(36).slice(2, 8);

const comando = (
  reservaId: string,
  fechaCobro: string,
  over: Partial<RegistrarCobroFianzaComando> = {},
): RegistrarCobroFianzaComando => ({
  tenantId: TENANT,
  usuarioId: 'usr-gestor-conc-30',
  reservaId,
  importe: '1000.00',
  fechaCobro,
  ...over,
});

/**
 * Siembra una RESERVA `reserva_confirmada` con `fianza_status='recibo_enviado'` y su FACTURA de
 * fianza en `estado='enviada'` con numero_factura asignado (estado de partida de US-028). Devuelve
 * los ids relevantes. La `fechaCobro` de los comandos debe ser `<= fechaEvento`.
 */
const sembrarReservaFianzaEnviada = async (params: {
  fechaEvento: Date;
  tenantId?: string;
  fianzaStatus?: FianzaStatus;
  facturaEstado?: EstadoFactura;
  sinFactura?: boolean;
  total?: string;
}): Promise<{ reservaId: string; facturaId: string | null; clienteId: string }> => {
  const tenantId = params.tenantId ?? TENANT;
  const cliente = await prisma.cliente.create({
    data: {
      tenantId,
      nombre: 'Conc',
      apellidos: 'Fianza',
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
      fechaEvento: params.fechaEvento,
      duracionHoras: DuracionHoras.h8,
      tipoEvento: 'boda',
      numAdultosNinosMayores4: 40,
      numNinosMenores4: 5,
      importeTotal: '6000.00',
      importeSenal: '2400.00',
      importeLiquidacion: '4100.00',
      liquidacionStatus: LiquidacionStatus.cobrada,
      fianzaStatus: params.fianzaStatus ?? FianzaStatus.recibo_enviado,
      ttlExpiracion: null,
    },
  });
  let facturaId: string | null = null;
  if (!params.sinFactura) {
    const factura = await prisma.factura.create({
      data: {
        tenantId,
        reservaId: reserva.idReserva,
        numeroFactura: `FZ-2026-${Math.floor(Math.random() * 9000 + 1000)}`,
        tipo: TipoFactura.fianza,
        estado: params.facturaEstado ?? EstadoFactura.enviada,
        total: params.total ?? '1000.00',
        baseImponible: '1000.00',
        ivaPorcentaje: '0.00',
        ivaImporte: '0.00',
        pdfUrl: 'https://storage.local/facturas/fianza.pdf',
        fechaEmision: new Date(Date.UTC(2026, 5, 1)),
      },
    });
    facturaId = factura.idFactura;
  }
  return { reservaId: reserva.idReserva, facturaId, clienteId: cliente.idCliente };
};

const contarPagosDeReserva = async (reservaId: string): Promise<number> =>
  prisma.pago.count({ where: { factura: { reservaId } } });

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
  useCase = moduleRef.get(RegistrarCobroFianzaUseCase);
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
//        1 OK + 1 rechazo (409 FIANZA_YA_COBRADA); UN único PAGO.
// ===========================================================================

describe('RegistrarCobroFianza — doble cobro concurrente serializado por FOR UPDATE (3.7)', () => {
  it('debe_permitir_un_cobro_y_rechazar_el_segundo_cuando_son_concurrentes', async () => {
    const { reservaId } = await sembrarReservaFianzaEnviada({
      fechaEvento: new Date(Date.UTC(2031, 0, 1)),
    });

    const resultados = await Promise.allSettled([
      useCase.ejecutar(comando(reservaId, '2031-01-01')),
      useCase.ejecutar(comando(reservaId, '2031-01-01')),
    ]);

    // Exactamente 1 OK + 1 rechazo (la segunda ve `cobrada` bajo el lock de fila).
    expect(resultados.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(resultados.filter((r) => r.status === 'rejected')).toHaveLength(1);
  });

  it('debe_dejar_un_UNICO_PAGO_para_la_fianza_tras_dos_cobros_concurrentes', async () => {
    const { reservaId } = await sembrarReservaFianzaEnviada({
      fechaEvento: new Date(Date.UTC(2031, 0, 2)),
    });

    await Promise.allSettled([
      useCase.ejecutar(comando(reservaId, '2031-01-02')),
      useCase.ejecutar(comando(reservaId, '2031-01-02')),
    ]);

    // Sin doble cobro: un solo registro PAGO conciliado contra la factura de fianza.
    expect(await contarPagosDeReserva(reservaId)).toBe(1);
  });

  it('debe_dejar_la_fianza_en_cobrada_y_la_factura_cobrada_tras_la_carrera', async () => {
    const { reservaId, facturaId } = await sembrarReservaFianzaEnviada({
      fechaEvento: new Date(Date.UTC(2031, 0, 3)),
    });

    await Promise.allSettled([
      useCase.ejecutar(comando(reservaId, '2031-01-03')),
      useCase.ejecutar(comando(reservaId, '2031-01-03')),
    ]);

    const reserva = await prisma.reserva.findUnique({
      where: { idReserva: reservaId },
      select: { fianzaStatus: true, estado: true, fianzaEur: true, fianzaCobradaFecha: true },
    });
    const factura = await prisma.factura.findUnique({
      where: { idFactura: facturaId as string },
      select: { estado: true },
    });
    expect(reserva?.fianzaStatus).toBe('cobrada');
    expect(reserva?.fianzaEur?.toString()).toBe('1000');
    expect(factura?.estado).toBe('cobrada');
    // El cobro de fianza NO transiciona RESERVA.estado a evento_en_curso (US-031).
    expect(reserva?.estado).toBe('reserva_confirmada');
  });
});

// ===========================================================================
// 3.3/3.5 — Happy path REAL: un solo cobro crea el PAGO, marca cobrada, registra
//            fianza_eur/fianza_cobrada_fecha y deja RESERVA.estado sin avanzar.
// ===========================================================================

describe('RegistrarCobroFianza — happy path con persistencia real', () => {
  it('debe_crear_el_PAGO_con_importe_y_fecha_cobro_y_marcar_cobrada', async () => {
    const { reservaId } = await sembrarReservaFianzaEnviada({
      fechaEvento: new Date(Date.UTC(2031, 1, 1)),
    });

    await useCase.ejecutar(comando(reservaId, '2031-01-15'));

    const pago = await prisma.pago.findFirst({ where: { factura: { reservaId } } });
    expect(pago).not.toBeNull();
    expect(pago?.importe.toString()).toBe('1000');
    expect(pago?.justificanteDocId).toBeNull();

    const reserva = await prisma.reserva.findUnique({
      where: { idReserva: reservaId },
      select: { fianzaStatus: true, estado: true, fianzaEur: true, fianzaCobradaFecha: true },
    });
    expect(reserva?.fianzaStatus).toBe('cobrada');
    expect(reserva?.fianzaEur?.toString()).toBe('1000');
    expect(reserva?.fianzaCobradaFecha).not.toBeNull();
    expect(reserva?.estado).toBe('reserva_confirmada');
  });

  it('debe_aceptar_el_cobro_en_T0_con_fecha_cobro_igual_a_la_fecha_del_evento', async () => {
    // Cobro en T-0 (3.5): fecha_cobro = fecha_evento se procesa como el happy path.
    const { reservaId } = await sembrarReservaFianzaEnviada({
      fechaEvento: new Date(Date.UTC(2031, 1, 20)),
    });

    await useCase.ejecutar(comando(reservaId, '2031-02-20'));

    const reserva = await prisma.reserva.findUnique({
      where: { idReserva: reservaId },
      select: { fianzaStatus: true },
    });
    expect(reserva?.fianzaStatus).toBe('cobrada');
    expect(await contarPagosDeReserva(reservaId)).toBe(1);
  });

  it('debe_vincular_el_DOCUMENTO_justificante_pago_al_PAGO_cuando_se_adjunta', async () => {
    const { reservaId } = await sembrarReservaFianzaEnviada({
      fechaEvento: new Date(Date.UTC(2031, 1, 2)),
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

    await useCase.ejecutar(comando(reservaId, '2031-01-16', { justificanteDocId: doc.idDocumento }));

    const pago = await prisma.pago.findFirst({ where: { factura: { reservaId } } });
    expect(pago?.justificanteDocId).toBe(doc.idDocumento);
  });
});

// ===========================================================================
// 3.6 — Política "Negociable" con persistencia real: pendiente sin flag → NO
//        crea PAGO; con flag → registra (incl. D-2b factura borrador / al vuelo).
// ===========================================================================

describe('RegistrarCobroFianza — política Negociable con persistencia real (3.6)', () => {
  it('no_debe_crear_PAGO_cuando_pendiente_y_sin_confirmarSinRecibo', async () => {
    const { reservaId } = await sembrarReservaFianzaEnviada({
      fechaEvento: new Date(Date.UTC(2031, 4, 1)),
      fianzaStatus: FianzaStatus.pendiente,
      facturaEstado: EstadoFactura.borrador,
    });

    const resultado = await useCase.ejecutar(
      comando(reservaId, '2031-05-01', { confirmarSinRecibo: false }),
    );

    expect(resultado.resultado).toBe('confirmacion_requerida');
    expect(await contarPagosDeReserva(reservaId)).toBe(0);
    const reserva = await prisma.reserva.findUnique({
      where: { idReserva: reservaId },
      select: { fianzaStatus: true },
    });
    expect(reserva?.fianzaStatus).toBe('pendiente');
  });

  it('debe_registrar_el_cobro_confirmado_saltando_la_FACTURA_borrador_a_cobrada_D2b', async () => {
    const { reservaId, facturaId } = await sembrarReservaFianzaEnviada({
      fechaEvento: new Date(Date.UTC(2031, 4, 2)),
      fianzaStatus: FianzaStatus.pendiente,
      facturaEstado: EstadoFactura.borrador,
    });

    const resultado = await useCase.ejecutar(
      comando(reservaId, '2031-05-02', { confirmarSinRecibo: true }),
    );

    expect(resultado.resultado).toBe('cobrado');
    const factura = await prisma.factura.findUnique({
      where: { idFactura: facturaId as string },
      select: { estado: true },
    });
    expect(factura?.estado).toBe('cobrada');
    expect(await contarPagosDeReserva(reservaId)).toBe(1);
    const reserva = await prisma.reserva.findUnique({
      where: { idReserva: reservaId },
      select: { fianzaStatus: true },
    });
    expect(reserva?.fianzaStatus).toBe('cobrada');
  });

  it('debe_crear_la_FACTURA_de_fianza_al_vuelo_y_marcarla_cobrada_cuando_no_existe_D2b', async () => {
    const { reservaId } = await sembrarReservaFianzaEnviada({
      fechaEvento: new Date(Date.UTC(2031, 4, 3)),
      fianzaStatus: FianzaStatus.pendiente,
      sinFactura: true,
    });

    const resultado = await useCase.ejecutar(
      comando(reservaId, '2031-05-03', { confirmarSinRecibo: true }),
    );

    expect(resultado.resultado).toBe('cobrado');
    // Se creó una FACTURA(fianza) al vuelo, ya cobrada, con su PAGO conciliado.
    const facturas = await prisma.factura.findMany({
      where: { reservaId, tipo: TipoFactura.fianza },
      select: { estado: true },
    });
    expect(facturas).toHaveLength(1);
    expect(facturas[0].estado).toBe('cobrada');
    expect(await contarPagosDeReserva(reservaId)).toBe(1);
  });
});

// ===========================================================================
// 3.8 — Doble cobro secuencial (BD real): el segundo ve `cobrada` y aborta.
// ===========================================================================

describe('RegistrarCobroFianza — bloqueo de doble cobro con persistencia real (3.8)', () => {
  it('debe_bloquear_el_segundo_cobro_secuencial_sin_crear_PAGO_adicional', async () => {
    const { reservaId } = await sembrarReservaFianzaEnviada({
      fechaEvento: new Date(Date.UTC(2031, 2, 2)),
    });

    await useCase.ejecutar(comando(reservaId, '2031-03-01'));
    // El segundo cobro secuencial ve `cobrada` bajo el lock de fila → doble cobro (409).
    await expect(useCase.ejecutar(comando(reservaId, '2031-03-01'))).rejects.toBeInstanceOf(
      FianzaYaCobradaError,
    );

    expect(await contarPagosDeReserva(reservaId)).toBe(1);
  });
});

// ===========================================================================
// 3.1 — Validaciones (BD real): importe<=0 y fecha_cobro posterior al evento
//        rechazan sin crear PAGO. Multi-tenancy: justificante de otro tenant → 404.
// ===========================================================================

describe('RegistrarCobroFianza — validaciones y multi-tenancy con BD real', () => {
  it('debe_rechazar_importe_no_positivo_sin_crear_PAGO', async () => {
    const { reservaId } = await sembrarReservaFianzaEnviada({
      fechaEvento: new Date(Date.UTC(2031, 3, 1)),
    });

    await expect(
      useCase.ejecutar(comando(reservaId, '2031-04-01', { importe: '0.00' })),
    ).rejects.toBeInstanceOf(CobroInvalidoError);

    expect(await contarPagosDeReserva(reservaId)).toBe(0);
  });

  it('debe_rechazar_una_fecha_de_cobro_posterior_al_evento_sin_crear_PAGO', async () => {
    const { reservaId } = await sembrarReservaFianzaEnviada({
      fechaEvento: new Date(Date.UTC(2031, 3, 2)),
    });

    // fechaCobro (2031-04-03) posterior a fechaEvento (2031-04-02) → COBRO_INVALIDO.
    await expect(
      useCase.ejecutar(comando(reservaId, '2031-04-03')),
    ).rejects.toBeInstanceOf(CobroInvalidoError);

    expect(await contarPagosDeReserva(reservaId)).toBe(0);
  });

  it('debe_rechazar_con_FacturaFianzaNoEncontrada_cuando_la_reserva_no_existe', async () => {
    await expect(
      useCase.ejecutar(comando('00000000-0000-0000-0000-0000000c0ffe', '2031-01-01')),
    ).rejects.toBeInstanceOf(FacturaFianzaNoEncontradaError);
  });

  it('debe_rechazar_un_justificante_que_pertenece_a_OTRO_tenant_sin_crear_PAGO', async () => {
    const { reservaId } = await sembrarReservaFianzaEnviada({
      fechaEvento: new Date(Date.UTC(2031, 3, 3)),
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
      useCase.ejecutar(
        comando(reservaId, '2031-04-01', { justificanteDocId: docOtroTenant.idDocumento }),
      ),
    ).rejects.toBeInstanceOf(JustificanteNoEncontradoError);

    expect(await contarPagosDeReserva(reservaId)).toBe(0);

    await prisma.documento.delete({ where: { idDocumento: docOtroTenant.idDocumento } });
  });
});
