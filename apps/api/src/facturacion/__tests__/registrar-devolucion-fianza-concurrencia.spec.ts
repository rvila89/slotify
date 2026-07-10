/**
 * TESTS DE CONCURRENCIA REALES del registro de la DEVOLUCIÓN de la FIANZA (US-036 / UC-27 pasos
 * 4-8) — fase TDD RED. tasks.md Fase 3: 3.9. ZONA CRÍTICA (design.md §D-1/§D-4, patrón US-030): la
 * guarda contra el DOBLE REGISTRO se serializa releyendo la fila de RESERVA con
 * `SELECT ... FOR UPDATE` DENTRO de la `$transaction` (lock de fila PostgreSQL, NUNCA locks
 * distribuidos / Redis — CLAUDE.md §Regla crítica, hook `no-distributed-lock`). Dos peticiones
 * concurrentes de devolución sobre la MISMA reserva → la primera aplica el estado final
 * (`devuelta`/`retenida_parcial`) y la segunda ve el estado final y aborta (409
 * DEVOLUCION_YA_REGISTRADA). Un único registro, irreversible.
 *
 * Trazabilidad: US-036, spec-delta `facturacion` (Requirement "Guarda contra el doble registro …",
 * scenario "Dos registros de devolución concurrentes solo aplican uno"). Skill
 * `concurrency-locking`: `Promise.allSettled()`, 1 OK + 1 rechazo, sin efectos duplicados.
 *
 * INTEGRACIÓN con TRANSACCIONES REALES contra el Postgres del docker-compose (NO mocks del
 * adapter — requisito duro tras la lección US-049: un adapter mockeado ocultó bugs en la BD real).
 * Mismo enfoque que `registrar-cobro-fianza-concurrencia.spec.ts` (US-030). Requiere
 * `docker compose up -d postgres` + migración (incl. la ADITIVA de `RESERVA.motivo_retencion`,
 * G1-1, que aplica el backend-developer) + seed. BD aislada `slotify_test` (`.env.test`); códigos/
 * emails propios NO compartidos con otras suites para ser DETERMINISTA (memoria: US-004 deadlock
 * flaky / BD aislada). NO se reintroduce el patrón que provoca deadlock 40P01.
 *
 * NOTA ENTORNO: este spec se ejecuta desde la SESIÓN PRINCIPAL (que sí tiene Postgres); los
 * subagentes QA corren sin BD real (memoria: subagentes-sin-docker-postgres).
 *
 * RED: aún NO existe `facturacion/application/registrar-devolucion-fianza.use-case.ts` ni su
 * cableado en `FacturacionModule`. El import falla en compilación y la batería está en ROJO por
 * AUSENCIA DE IMPLEMENTACIÓN (no por infraestructura: el Postgres está arriba). GREEN es de
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
  TipoDocumento,
} from '@prisma/client';
import { FacturacionModule } from '../facturacion.module';
import { PrismaService } from '../../shared/prisma/prisma.service';
import {
  RegistrarDevolucionFianzaUseCase,
  DevolucionYaRegistradaError,
  PrecondicionNoCumplidaError,
  ImporteSuperaFianzaError,
  FechaDevolucionInvalidaError,
  MotivoRetencionRequeridoError,
  JustificanteNoEncontradoError,
  ReservaDevolucionNoEncontradaError,
  type RegistrarDevolucionFianzaComando,
} from '../application/registrar-devolucion-fianza.use-case';

const TENANT = '00000000-0000-0000-0000-000000000001';
const TENANT_OTRO = '00000000-0000-0000-0000-0000000000ff';
const EMAIL_PATTERN = '@us036-conc.test';
const CODIGO_PREFIX = 'TST-U036C-';
const IBAN = 'ES9121000418450200051332';

let moduleRef: TestingModule;
let prisma: PrismaService;
let useCase: RegistrarDevolucionFianzaUseCase;

const sufijo = (): string => Math.random().toString(36).slice(2, 8);

const comando = (
  reservaId: string,
  over: Partial<RegistrarDevolucionFianzaComando> = {},
): RegistrarDevolucionFianzaComando => ({
  tenantId: TENANT,
  usuarioId: 'usr-gestor-conc-36',
  reservaId,
  importeDevuelto: '1000.00',
  fechaCobro: '2026-06-05',
  ...over,
});

/**
 * Siembra una RESERVA `post_evento` con `fianza_status='cobrada'`, `fianza_eur`,
 * `fianza_cobrada_fecha` y su CLIENTE con `iban_devolucion` presente (precondición triple del
 * happy path). Devuelve los ids relevantes.
 */
const sembrarReservaFianzaCobrada = async (params: {
  tenantId?: string;
  fianzaStatus?: FianzaStatus;
  fianzaEur?: string;
  fianzaCobradaFecha?: Date;
  ibanDevolucion?: string | null;
  estado?: EstadoReserva;
}): Promise<{ reservaId: string; clienteId: string }> => {
  const tenantId = params.tenantId ?? TENANT;
  const cliente = await prisma.cliente.create({
    data: {
      tenantId,
      nombre: 'Conc',
      apellidos: 'Devolucion',
      email: `cli-${sufijo()}${EMAIL_PATTERN}`,
      dniNif: '12345678Z',
      direccion: 'C/ Mayor 1',
      codigoPostal: '08001',
      poblacion: 'Barcelona',
      provincia: 'Barcelona',
      ibanDevolucion:
        'ibanDevolucion' in params ? params.ibanDevolucion : IBAN,
    },
  });
  const reserva = await prisma.reserva.create({
    data: {
      tenantId,
      clienteId: cliente.idCliente,
      codigo: `${CODIGO_PREFIX}${sufijo()}`,
      estado: params.estado ?? EstadoReserva.post_evento,
      subEstado: null,
      canalEntrada: CanalEntrada.web,
      fechaEvento: new Date(Date.UTC(2026, 4, 10)),
      duracionHoras: DuracionHoras.h8,
      tipoEvento: 'boda',
      numAdultosNinosMayores4: 40,
      numNinosMenores4: 5,
      importeTotal: '6000.00',
      importeSenal: '2400.00',
      importeLiquidacion: '4100.00',
      liquidacionStatus: LiquidacionStatus.cobrada,
      fianzaStatus: params.fianzaStatus ?? FianzaStatus.cobrada,
      fianzaEur: params.fianzaEur ?? '1000.00',
      fianzaCobradaFecha: params.fianzaCobradaFecha ?? new Date(Date.UTC(2026, 4, 15)),
      ttlExpiracion: null,
    },
  });
  return { reservaId: reserva.idReserva, clienteId: cliente.idCliente };
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
  useCase = moduleRef.get(RegistrarDevolucionFianzaUseCase);
});

afterAll(async () => {
  await limpiar();
  await moduleRef.close();
});

beforeEach(async () => {
  await limpiar();
});

// ===========================================================================
// 3.9 — DOS devoluciones CONCURRENTES sobre la MISMA reserva: FOR UPDATE
//        serializa → 1 OK + 1 rechazo (409 DEVOLUCION_YA_REGISTRADA); un único
//        registro de devolución.
// ===========================================================================

describe('RegistrarDevolucionFianza — doble registro concurrente serializado por FOR UPDATE (3.9)', () => {
  it('debe_permitir_una_devolucion_y_rechazar_la_segunda_cuando_son_concurrentes', async () => {
    const { reservaId } = await sembrarReservaFianzaCobrada({});

    const resultados = await Promise.allSettled([
      useCase.ejecutar(comando(reservaId)),
      useCase.ejecutar(comando(reservaId)),
    ]);

    // Exactamente 1 OK + 1 rechazo (la segunda ve el estado final bajo el lock de fila).
    expect(resultados.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(resultados.filter((r) => r.status === 'rejected')).toHaveLength(1);
  });

  it('debe_dejar_la_fianza_en_un_UNICO_estado_final_tras_dos_devoluciones_concurrentes', async () => {
    const { reservaId } = await sembrarReservaFianzaCobrada({});

    await Promise.allSettled([
      useCase.ejecutar(comando(reservaId)),
      useCase.ejecutar(comando(reservaId)),
    ]);

    const reserva = await prisma.reserva.findUnique({
      where: { idReserva: reservaId },
      select: { fianzaStatus: true, fianzaDevueltaEur: true, fianzaDevueltaFecha: true },
    });
    // Devolución completa (1000 == 1000) ⇒ 'devuelta', sin doble aplicación.
    expect(reserva?.fianzaStatus).toBe('devuelta');
    expect(reserva?.fianzaDevueltaEur?.toString()).toBe('1000');
    expect(reserva?.fianzaDevueltaFecha).not.toBeNull();
  });
});

// ===========================================================================
// 3.3/3.4 — Happy path REAL: devolución completa y parcial persisten el estado
//            final y los campos fianza_devuelta_*.
// ===========================================================================

describe('RegistrarDevolucionFianza — happy path con persistencia real', () => {
  it('debe_registrar_la_devolucion_completa_y_dejar_la_fianza_en_devuelta', async () => {
    const { reservaId } = await sembrarReservaFianzaCobrada({ fianzaEur: '1000.00' });

    await useCase.ejecutar(comando(reservaId, { importeDevuelto: '1000.00' }));

    const reserva = await prisma.reserva.findUnique({
      where: { idReserva: reservaId },
      select: {
        fianzaStatus: true,
        fianzaDevueltaEur: true,
        fianzaDevueltaFecha: true,
        estado: true,
      },
    });
    expect(reserva?.fianzaStatus).toBe('devuelta');
    expect(reserva?.fianzaDevueltaEur?.toString()).toBe('1000');
    expect(reserva?.fianzaDevueltaFecha).not.toBeNull();
    // La devolución NO transiciona RESERVA.estado.
    expect(reserva?.estado).toBe('post_evento');
  });

  it('debe_registrar_la_devolucion_parcial_y_dejar_la_fianza_en_retenida_parcial', async () => {
    const { reservaId } = await sembrarReservaFianzaCobrada({ fianzaEur: '1500.00' });

    await useCase.ejecutar(
      comando(reservaId, {
        importeDevuelto: '1000.00',
        motivoRetencion: 'Daños en vajilla valorados en 500 €',
        fechaCobro: '2026-06-06',
      }),
    );

    const reserva = await prisma.reserva.findUnique({
      where: { idReserva: reservaId },
      select: { fianzaStatus: true, fianzaDevueltaEur: true },
    });
    expect(reserva?.fianzaStatus).toBe('retenida_parcial');
    expect(reserva?.fianzaDevueltaEur?.toString()).toBe('1000');
  });

  it('debe_aceptar_la_retencion_total_importe_0_00_como_retenida_parcial', async () => {
    const { reservaId } = await sembrarReservaFianzaCobrada({ fianzaEur: '1000.00' });

    await useCase.ejecutar(
      comando(reservaId, {
        importeDevuelto: '0.00',
        motivoRetencion: 'Fianza retenida íntegramente',
        fechaCobro: '2026-06-06',
      }),
    );

    const reserva = await prisma.reserva.findUnique({
      where: { idReserva: reservaId },
      select: { fianzaStatus: true, fianzaDevueltaEur: true },
    });
    expect(reserva?.fianzaStatus).toBe('retenida_parcial');
    expect(reserva?.fianzaDevueltaEur?.toString()).toBe('0');
  });

  it('debe_vincular_el_DOCUMENTO_justificante_pago_cuando_se_adjunta', async () => {
    const { reservaId } = await sembrarReservaFianzaCobrada({});
    const doc = await prisma.documento.create({
      data: {
        tenantId: TENANT,
        reservaId,
        tipo: TipoDocumento.justificante_pago,
        nombreArchivo: 'devolucion.pdf',
        url: 'https://storage.local/justificantes/devolucion.pdf',
        mimeType: 'application/pdf',
        tamanoBytes: 1024,
      },
    });

    const resultado = await useCase.ejecutar(
      comando(reservaId, { justificanteDocId: doc.idDocumento }),
    );

    expect(resultado.avisoSinJustificante).toBe(false);
    expect(resultado.documentoJustificante?.idDocumento).toBe(doc.idDocumento);
  });

  it('debe_registrar_sin_justificante_con_aviso_y_sin_crear_DOCUMENTO_FA04', async () => {
    const { reservaId } = await sembrarReservaFianzaCobrada({});

    const resultado = await useCase.ejecutar(comando(reservaId, { justificanteDocId: undefined }));

    expect(resultado.avisoSinJustificante).toBe(true);
    // No se creó ningún DOCUMENTO para esta reserva.
    const docs = await prisma.documento.count({ where: { reservaId } });
    expect(docs).toBe(0);
    const reserva = await prisma.reserva.findUnique({
      where: { idReserva: reservaId },
      select: { fianzaStatus: true },
    });
    expect(reserva?.fianzaStatus).toBe('devuelta');
  });
});

// ===========================================================================
// 3.9 — Doble registro secuencial (BD real): el segundo ve el estado final y aborta.
// ===========================================================================

describe('RegistrarDevolucionFianza — irreversibilidad con persistencia real (3.9)', () => {
  it('debe_bloquear_el_segundo_registro_secuencial_sin_alterar_el_estado_final', async () => {
    const { reservaId } = await sembrarReservaFianzaCobrada({});

    await useCase.ejecutar(comando(reservaId));
    await expect(useCase.ejecutar(comando(reservaId))).rejects.toBeInstanceOf(
      DevolucionYaRegistradaError,
    );

    const reserva = await prisma.reserva.findUnique({
      where: { idReserva: reservaId },
      select: { fianzaStatus: true, fianzaDevueltaEur: true },
    });
    expect(reserva?.fianzaStatus).toBe('devuelta');
    expect(reserva?.fianzaDevueltaEur?.toString()).toBe('1000');
  });
});

// ===========================================================================
// 3.5/3.6/3.8 — Validaciones y precondición (BD real): sin mutar la RESERVA.
//        Multi-tenancy: justificante/reserva de otro tenant → 404.
// ===========================================================================

describe('RegistrarDevolucionFianza — validaciones, precondición y multi-tenancy con BD real', () => {
  it('debe_rechazar_importe_superior_a_la_fianza_sin_mutar_FA02', async () => {
    const { reservaId } = await sembrarReservaFianzaCobrada({ fianzaEur: '1000.00' });

    await expect(
      useCase.ejecutar(comando(reservaId, { importeDevuelto: '1500.00' })),
    ).rejects.toBeInstanceOf(ImporteSuperaFianzaError);

    const reserva = await prisma.reserva.findUnique({
      where: { idReserva: reservaId },
      select: { fianzaStatus: true, fianzaDevueltaEur: true },
    });
    expect(reserva?.fianzaStatus).toBe('cobrada');
    expect(reserva?.fianzaDevueltaEur).toBeNull();
  });

  it('debe_rechazar_una_fecha_anterior_al_cobro_de_fianza_sin_mutar_FA03', async () => {
    const { reservaId } = await sembrarReservaFianzaCobrada({
      fianzaCobradaFecha: new Date(Date.UTC(2026, 4, 15)),
    });

    await expect(
      useCase.ejecutar(comando(reservaId, { fechaCobro: '2026-05-10' })),
    ).rejects.toBeInstanceOf(FechaDevolucionInvalidaError);

    const reserva = await prisma.reserva.findUnique({
      where: { idReserva: reservaId },
      select: { fianzaStatus: true },
    });
    expect(reserva?.fianzaStatus).toBe('cobrada');
  });

  it('debe_rechazar_devolucion_parcial_sin_motivo_sin_mutar', async () => {
    const { reservaId } = await sembrarReservaFianzaCobrada({ fianzaEur: '1500.00' });

    await expect(
      useCase.ejecutar(comando(reservaId, { importeDevuelto: '1000.00', fechaCobro: '2026-06-06' })),
    ).rejects.toBeInstanceOf(MotivoRetencionRequeridoError);

    const reserva = await prisma.reserva.findUnique({
      where: { idReserva: reservaId },
      select: { fianzaStatus: true },
    });
    expect(reserva?.fianzaStatus).toBe('cobrada');
  });

  it('debe_rechazar_con_PrecondicionNoCumplida_cuando_el_cliente_no_tiene_iban', async () => {
    const { reservaId } = await sembrarReservaFianzaCobrada({ ibanDevolucion: null });

    await expect(useCase.ejecutar(comando(reservaId))).rejects.toBeInstanceOf(
      PrecondicionNoCumplidaError,
    );

    const reserva = await prisma.reserva.findUnique({
      where: { idReserva: reservaId },
      select: { fianzaStatus: true },
    });
    expect(reserva?.fianzaStatus).toBe('cobrada');
  });

  it('debe_rechazar_con_PrecondicionNoCumplida_cuando_no_esta_en_post_evento', async () => {
    const { reservaId } = await sembrarReservaFianzaCobrada({
      estado: EstadoReserva.evento_en_curso,
    });

    await expect(useCase.ejecutar(comando(reservaId))).rejects.toBeInstanceOf(
      PrecondicionNoCumplidaError,
    );
  });

  it('debe_rechazar_con_ReservaDevolucionNoEncontrada_cuando_la_reserva_no_existe', async () => {
    await expect(
      useCase.ejecutar(comando('00000000-0000-0000-0000-0000000c0ffe')),
    ).rejects.toBeInstanceOf(ReservaDevolucionNoEncontradaError);
  });

  it('debe_rechazar_un_justificante_que_pertenece_a_OTRO_tenant_sin_mutar', async () => {
    const { reservaId } = await sembrarReservaFianzaCobrada({});
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

    const reserva = await prisma.reserva.findUnique({
      where: { idReserva: reservaId },
      select: { fianzaStatus: true },
    });
    expect(reserva?.fianzaStatus).toBe('cobrada');

    await prisma.documento.delete({ where: { idDocumento: docOtroTenant.idDocumento } });
  });
});
