/**
 * TESTS DE INTEGRACIÓN de la confirmación del pago de la señal (US-021 / UC-17)
 * — fase TDD RED. tasks.md Fase 3: 3.3 (atomicidad/rollback), 3.4 (upgrade a
 * firme por UPDATE conservando reserva_id), 3.5 (congelado de importes), 3.6
 * (idempotencia FICHA_OPERATIVA), y auditoría `transicion`.
 *
 * Trazabilidad: US-021; spec-delta `consultas` (transición pre_reserva →
 * reserva_confirmada, upgrade blando→firme sin TTL como UPDATE de la fila
 * existente, atomicidad all-or-nothing, auditoría `accion='transicion'`) y
 * spec-delta `confirmacion` (DOCUMENTO justificante_pago, congelado de importes,
 * init de sub-procesos, FICHA_OPERATIVA vacía idempotente). design.md §D-2/§D-3/
 * §D-4.
 *
 * INTEGRACIÓN REAL contra el Postgres del docker-compose (no mocks): la transacción
 * única (DOCUMENTO + RESERVA + FECHA_BLOQUEADA + FICHA_OPERATIVA + AUDIT_LOG) y el
 * upgrade atómico a firme se verifican por el ESTADO DE LA BD. Mismo enfoque que
 * `activar-prereserva-integracion.spec.ts` (US-014). Requiere `docker compose up -d
 * postgres` + migración + seed (tenant piloto con `pct_senal = 40`). BD aislada
 * `slotify_test` (`.env.test`), fechas futuras propias para no colisionar con otras
 * suites (memoria: US-004 flaky / BD aislada).
 *
 * RED: aún NO existe `confirmacion/application/confirmar-pago-senal.use-case.ts` ni
 * el cableado de `ConfirmacionModule`. El import falla en compilación y la batería
 * está en ROJO por AUSENCIA DE IMPLEMENTACIÓN. GREEN es de `backend-developer`.
 */
import { Test, type TestingModule } from '@nestjs/testing';
import { ConfigModule } from '@nestjs/config';
import {
  CanalEntrada,
  DuracionHoras,
  EstadoReserva,
  TipoBloqueo,
  TipoDocumento,
  TipoEvento,
} from '@prisma/client';
import { ConfirmacionModule } from '../confirmacion.module';
import { PrismaService } from '../../shared/prisma/prisma.service';
import {
  ConfirmarPagoSenalUseCase,
  type ConfirmarPagoSenalComando,
  type JustificanteSubido,
} from '../application/confirmar-pago-senal.use-case';

const TENANT = '00000000-0000-0000-0000-000000000001';
const OTRO_TENANT = '00000000-0000-0000-0000-0000000000ff';
const GESTOR = '00000000-0000-0000-0000-000000000002';
const EMAIL_PATTERN = '@us021-int.test';
const MB = 1024 * 1024;

// Fechas estrictamente futuras y aisladas (no usadas por el seed ni otras suites).
const FECHA_UPGRADE = new Date('2028-03-01T00:00:00.000Z');
const FECHA_IMPORTES = new Date('2028-03-02T00:00:00.000Z');
const FECHA_FICHA_IDEMP = new Date('2028-03-03T00:00:00.000Z');
const FECHA_ROLLBACK = new Date('2028-03-04T00:00:00.000Z');
const FECHA_OCUPANTE = new Date('2028-03-05T00:00:00.000Z');
const FECHA_TENANT = new Date('2028-03-06T00:00:00.000Z');
const FECHAS = [
  FECHA_UPGRADE,
  FECHA_IMPORTES,
  FECHA_FICHA_IDEMP,
  FECHA_ROLLBACK,
  FECHA_OCUPANTE,
  FECHA_TENANT,
];

let moduleRef: TestingModule;
let prisma: PrismaService;
let useCase: ConfirmarPagoSenalUseCase;

const sufijo = (): string => Math.random().toString(36).slice(2, 8);

const justificanteValido = (over: Partial<JustificanteSubido> = {}): JustificanteSubido => ({
  nombreArchivo: 'justificante.pdf',
  mimeType: 'application/pdf',
  tamanoBytes: 1 * MB,
  buffer: Buffer.from('%PDF-1.4 fake'),
  ...over,
});

const comando = (
  reservaId: string,
  over: Partial<ConfirmarPagoSenalComando> = {},
): ConfirmarPagoSenalComando => ({
  tenantId: TENANT,
  usuarioId: GESTOR,
  reservaId,
  justificante: justificanteValido(),
  ...over,
});

/**
 * Siembra una RESERVA en `pre_reserva` con su fila FECHA_BLOQUEADA en `blando` +
 * TTL vigente para la fecha dada, y su `importe_total` fijado en la pre-reserva.
 */
const sembrarPreReserva = async (params: {
  fecha: Date;
  importeTotal?: string;
  tenantId?: string;
  conBloqueoBlando?: boolean;
}): Promise<string> => {
  const tenantId = params.tenantId ?? TENANT;
  const cliente = await prisma.cliente.create({
    data: {
      tenantId,
      nombre: 'Marta',
      apellidos: 'Soler',
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
      codigo: `TST-U021-${sufijo()}`,
      estado: EstadoReserva.pre_reserva,
      subEstado: null,
      canalEntrada: CanalEntrada.web,
      fechaEvento: params.fecha,
      duracionHoras: DuracionHoras.h8,
      tipoEvento: TipoEvento.boda,
      numAdultosNinosMayores4: 40,
      numNinosMenores4: 5,
      importeTotal: params.importeTotal ?? '3000.00',
      ttlExpiracion: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    },
  });
  if (params.conBloqueoBlando ?? true) {
    await prisma.fechaBloqueada.create({
      data: {
        tenantId,
        fecha: params.fecha,
        reservaId: reserva.idReserva,
        tipoBloqueo: TipoBloqueo.blando,
        ttlExpiracion: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
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
    await prisma.fichaOperativa.deleteMany({ where: { reservaId: { in: ids } } });
    await prisma.documento.deleteMany({ where: { reservaId: { in: ids } } });
    await prisma.fechaBloqueada.deleteMany({ where: { reservaId: { in: ids } } });
    await prisma.comunicacion.deleteMany({ where: { reservaId: { in: ids } } });
    // US-022: el disparo post-commit crea una FACTURA de señal por la reserva confirmada.
    await prisma.pago.deleteMany({ where: { factura: { reservaId: { in: ids } } } });
    await prisma.factura.deleteMany({ where: { reservaId: { in: ids } } });
    await prisma.auditLog.deleteMany({ where: { entidadId: { in: ids } } });
    await prisma.reserva.deleteMany({ where: { idReserva: { in: ids } } });
  }
  await prisma.fechaBloqueada.deleteMany({ where: { fecha: { in: FECHAS } } });
  if (todosClienteIds.length > 0) {
    await prisma.cliente.deleteMany({ where: { idCliente: { in: todosClienteIds } } });
  }
};

beforeAll(async () => {
  moduleRef = await Test.createTestingModule({
    imports: [ConfigModule.forRoot({ isGlobal: true }), ConfirmacionModule],
  }).compile();
  await moduleRef.init();
  prisma = moduleRef.get(PrismaService);
  useCase = moduleRef.get(ConfirmarPagoSenalUseCase);
});

afterAll(async () => {
  await limpiar();
  await moduleRef.close();
});

beforeEach(async () => {
  await limpiar();
});

// ===========================================================================
// 3.4 — Upgrade blando→firme: la fila de FECHA_BLOQUEADA pasa a firme / ttl NULL
//        por UPDATE (misma fila, conserva reserva_id), sin crear una segunda fila.
// ===========================================================================

describe('Confirmar señal — upgrade del bloqueo blando a firme por UPDATE (3.4)', () => {
  it('debe_promover_la_fila_a_firme_ttl_null_conservando_reserva_id_sin_crear_segunda_fila', async () => {
    const reservaId = await sembrarPreReserva({ fecha: FECHA_UPGRADE });
    const filaAntes = await prisma.fechaBloqueada.findFirst({
      where: { tenantId: TENANT, fecha: FECHA_UPGRADE },
    });
    expect(filaAntes?.tipoBloqueo).toBe(TipoBloqueo.blando);

    await useCase.ejecutar(comando(reservaId));

    // EXACTAMENTE UNA fila para (tenant, fecha): es un UPDATE, no delete+insert.
    const filas = await prisma.fechaBloqueada.findMany({
      where: { tenantId: TENANT, fecha: FECHA_UPGRADE },
    });
    expect(filas).toHaveLength(1);
    // La fila conserva su identidad (id_bloqueo) y su reserva_id; solo cambia tipo/ttl.
    expect(filas[0].idBloqueo).toBe(filaAntes?.idBloqueo);
    expect(filas[0].tipoBloqueo).toBe(TipoBloqueo.firme);
    expect(filas[0].ttlExpiracion).toBeNull();
    expect(filas[0].reservaId).toBe(reservaId);

    // La RESERVA queda en reserva_confirmada con ttl_expiracion NULL.
    const reserva = await prisma.reserva.findUnique({ where: { idReserva: reservaId } });
    expect(reserva?.estado).toBe(EstadoReserva.reserva_confirmada);
    expect(reserva?.ttlExpiracion).toBeNull();
  });

  it('debe_inicializar_los_tres_subprocesos_en_pendiente_al_confirmar', async () => {
    const reservaId = await sembrarPreReserva({ fecha: FECHA_UPGRADE });

    await useCase.ejecutar(comando(reservaId));

    const reserva = await prisma.reserva.findUnique({ where: { idReserva: reservaId } });
    expect(reserva?.preEventoStatus).toBe('pendiente');
    expect(reserva?.liquidacionStatus).toBe('pendiente');
    expect(reserva?.fianzaStatus).toBe('pendiente');
  });
});

// ===========================================================================
// 3.5 — Congelado de importes: total 3000 + pct_senal 40 → señal 1200 /
//        liquidación 1800; señal + liquidación = total EXACTO.
// ===========================================================================

describe('Confirmar señal — congelado de importes 40/60 (3.5)', () => {
  it('debe_congelar_importe_senal_1200_e_importe_liquidacion_1800_para_3000_al_40', async () => {
    const reservaId = await sembrarPreReserva({ fecha: FECHA_IMPORTES, importeTotal: '3000.00' });

    await useCase.ejecutar(comando(reservaId));

    const reserva = await prisma.reserva.findUnique({ where: { idReserva: reservaId } });
    expect(Number(reserva?.importeSenal)).toBe(1200);
    expect(Number(reserva?.importeLiquidacion)).toBe(1800);
    // Invariante contable: señal + liquidación = total.
    expect(Number(reserva?.importeSenal) + Number(reserva?.importeLiquidacion)).toBe(
      Number(reserva?.importeTotal),
    );
  });
});

// ===========================================================================
// DOCUMENTO justificante_pago + FICHA_OPERATIVA vacía creados en la tx.
// ===========================================================================

describe('Confirmar señal — DOCUMENTO justificante + FICHA_OPERATIVA vacía', () => {
  it('debe_crear_un_DOCUMENTO_justificante_pago_y_una_FICHA_OPERATIVA_vacia', async () => {
    const reservaId = await sembrarPreReserva({ fecha: FECHA_IMPORTES });

    await useCase.ejecutar(
      comando(reservaId, { justificante: justificanteValido({ mimeType: 'image/png' }) }),
    );

    const documentos = await prisma.documento.findMany({ where: { reservaId } });
    expect(documentos).toHaveLength(1);
    expect(documentos[0].tipo).toBe(TipoDocumento.justificante_pago);
    expect(documentos[0].tenantId).toBe(TENANT);
    expect(documentos[0].mimeType).toBe('image/png');
    expect(documentos[0].url).toBeTruthy();

    const ficha = await prisma.fichaOperativa.findUnique({ where: { reservaId } });
    expect(ficha).not.toBeNull();
    expect(ficha?.fichaCerrada).toBe(false);
    // Todos los campos de contenido a NULL (ficha vacía).
    expect(ficha?.numInvitadosConfirmado).toBeNull();
    expect(ficha?.menuSeleccionado).toBeNull();
    expect(ficha?.timingDetallado).toBeNull();
    expect(ficha?.contactoEventoNombre).toBeNull();
    expect(ficha?.contactoEventoTelefono).toBeNull();
    expect(ficha?.notasOperativas).toBeNull();
    expect(ficha?.briefingEquipo).toBeNull();
  });
});

// ===========================================================================
// 3.6 — Idempotencia de FICHA_OPERATIVA: si ya existe una con ese reserva_id,
//        NO se duplica y la transición se completa igualmente.
// ===========================================================================

describe('Confirmar señal — idempotencia de FICHA_OPERATIVA (3.6)', () => {
  it('no_debe_duplicar_la_ficha_si_ya_existe_y_debe_completar_la_confirmacion', async () => {
    const reservaId = await sembrarPreReserva({ fecha: FECHA_FICHA_IDEMP });
    // Ficha preexistente (por un error/reintento previo).
    await prisma.fichaOperativa.create({ data: { reservaId, fichaCerrada: false } });

    await useCase.ejecutar(comando(reservaId));

    // Sigue habiendo EXACTAMENTE UNA ficha (1:1 reserva_id @unique, no duplicada).
    const fichas = await prisma.fichaOperativa.findMany({ where: { reservaId } });
    expect(fichas).toHaveLength(1);
    // La transición se completó igualmente.
    const reserva = await prisma.reserva.findUnique({ where: { idReserva: reservaId } });
    expect(reserva?.estado).toBe(EstadoReserva.reserva_confirmada);
  });
});

// ===========================================================================
// Auditoría: AUDIT_LOG accion='transicion', entidad='RESERVA',
//        datos_anteriores.estado='pre_reserva', datos_nuevos.estado='reserva_confirmada'.
// ===========================================================================

describe('Confirmar señal — auditoría de la transición', () => {
  it('debe_registrar_una_entrada_de_transicion_pre_reserva_a_reserva_confirmada', async () => {
    const reservaId = await sembrarPreReserva({ fecha: FECHA_UPGRADE });

    await useCase.ejecutar(comando(reservaId));

    const audit = await prisma.auditLog.findFirst({
      where: { tenantId: TENANT, entidadId: reservaId, accion: 'transicion' },
    });
    expect(audit).not.toBeNull();
    expect(audit?.entidad).toBe('RESERVA');
    expect((audit?.datosAnteriores as { estado?: string })?.estado).toBe('pre_reserva');
    expect((audit?.datosNuevos as { estado?: string })?.estado).toBe('reserva_confirmada');
  });
});

// ===========================================================================
// 3.3 — Atomicidad / rollback real: confirmar sobre una fecha ya en firme de
//        OTRA reserva choca con UNIQUE(tenant,fecha) (P2002). Rollback total:
//        RESERVA sigue en pre_reserva, sin DOCUMENTO, bloqueo sigue blando+TTL,
//        sin FICHA_OPERATIVA; la fila FIRME de la otra reserva sigue intacta.
// ===========================================================================

describe('Confirmar señal — rollback total ante fecha ya en firme de otra reserva (3.3)', () => {
  it('debe_revertir_todo_dejando_la_reserva_en_pre_reserva_sin_documento_ni_ficha', async () => {
    // OTRA reserva ya confirmada bloquea la MISMA fecha en FIRME.
    const ocupante = await sembrarPreReserva({
      fecha: FECHA_ROLLBACK,
      conBloqueoBlando: false,
    });
    await prisma.reserva.update({
      where: { idReserva: ocupante },
      data: { estado: EstadoReserva.reserva_confirmada, ttlExpiracion: null },
    });
    await prisma.fechaBloqueada.create({
      data: {
        tenantId: TENANT,
        fecha: FECHA_ROLLBACK,
        reservaId: ocupante,
        tipoBloqueo: TipoBloqueo.firme,
        ttlExpiracion: null,
      },
    });
    // La reserva que intenta confirmar tiene la MISMA fecha pero sin fila propia:
    // el upgrade intentará fijar (tenant, fecha) que YA está ocupada en firme → P2002.
    const reservaId = await sembrarPreReserva({
      fecha: FECHA_ROLLBACK,
      conBloqueoBlando: false,
    });

    await expect(useCase.ejecutar(comando(reservaId))).rejects.toBeDefined();

    // Rollback: la RESERVA sigue en pre_reserva, sin importes congelados.
    const reserva = await prisma.reserva.findUnique({ where: { idReserva: reservaId } });
    expect(reserva?.estado).toBe(EstadoReserva.pre_reserva);
    expect(reserva?.importeSenal).toBeNull();
    expect(reserva?.importeLiquidacion).toBeNull();
    // Sin DOCUMENTO justificante ni FICHA_OPERATIVA para la reserva rechazada.
    expect(await prisma.documento.count({ where: { reservaId } })).toBe(0);
    expect(await prisma.fichaOperativa.count({ where: { reservaId } })).toBe(0);
    // La fila FIRME del ocupante sigue siendo la única para (tenant, fecha).
    const filas = await prisma.fechaBloqueada.findMany({
      where: { tenantId: TENANT, fecha: FECHA_ROLLBACK },
    });
    expect(filas).toHaveLength(1);
    expect(filas[0].reservaId).toBe(ocupante);
    expect(filas[0].tipoBloqueo).toBe(TipoBloqueo.firme);
  });
});

// ===========================================================================
// Guarda de origen (integración): confirmar sobre una reserva ya confirmada →
//        rechazo SIN efectos (sin DOCUMENTO nuevo, sin segunda ficha).
// ===========================================================================

describe('Confirmar señal — guarda de origen sobre reserva ya confirmada', () => {
  it('debe_rechazar_sin_efectos_cuando_la_reserva_ya_esta_en_reserva_confirmada', async () => {
    const reservaId = await sembrarPreReserva({ fecha: FECHA_OCUPANTE });
    // Confirmamos una primera vez (deja la reserva en reserva_confirmada + firme).
    await useCase.ejecutar(comando(reservaId));
    const docsTras1 = await prisma.documento.count({ where: { reservaId } });

    // Segundo intento sobre la MISMA reserva ya confirmada → ORIGEN_INVALIDO.
    await expect(useCase.ejecutar(comando(reservaId))).rejects.toMatchObject({
      codigo: 'ORIGEN_INVALIDO',
    });

    // No se crea un segundo DOCUMENTO ni una segunda FICHA.
    expect(await prisma.documento.count({ where: { reservaId } })).toBe(docsTras1);
    expect(await prisma.fichaOperativa.count({ where: { reservaId } })).toBe(1);
  });
});

// ===========================================================================
// Multi-tenancy / RLS — un tenant no puede confirmar la RESERVA de otro, sin
//        mutar nada (RESERVA sigue en pre_reserva, bloqueo sigue blando).
// ===========================================================================

describe('Confirmar señal — aislamiento multi-tenant / RLS', () => {
  it('debe_rechazar_y_no_mutar_cuando_el_tenant_del_jwt_no_es_dueno', async () => {
    const reservaId = await sembrarPreReserva({ fecha: FECHA_TENANT });

    await expect(
      useCase.ejecutar(comando(reservaId, { tenantId: OTRO_TENANT })),
    ).rejects.toBeDefined();

    const reserva = await prisma.reserva.findUnique({ where: { idReserva: reservaId } });
    expect(reserva?.estado).toBe(EstadoReserva.pre_reserva);
    const fila = await prisma.fechaBloqueada.findFirst({
      where: { tenantId: TENANT, fecha: FECHA_TENANT },
    });
    expect(fila?.tipoBloqueo).toBe(TipoBloqueo.blando);
    expect(await prisma.documento.count({ where: { reservaId } })).toBe(0);
  });
});
