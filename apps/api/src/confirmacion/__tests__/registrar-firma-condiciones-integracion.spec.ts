/**
 * TESTS DE INTEGRACIÓN del registro de la firma de las condiciones particulares
 * (US-024 / UC-19 segundo flujo) — verificación con BD REAL.
 *
 * Ejecutados por la SESIÓN PRINCIPAL (los subagentes QA corren sin Postgres). Arrancan
 * el contexto de `ConfirmacionModule` completo contra el Postgres del docker-compose
 * (`slotify_test`, `.env.test`) y ejercitan `RegistrarFirmaCondicionesUseCase` →
 * adaptadores Prisma (UoW tx+RLS, carga de reserva, almacén local) → BD real. Verifican
 * por ESTADO DE LA BD lo que los unit specs (puertos mockeados) no pueden: atomicidad de
 * la unidad de trabajo, RLS efectiva cross-tenant, y que el DOCUMENTO original no firmado
 * de US-023 permanece.
 *
 * Mismo enfoque/harness que `confirmar-pago-senal-integracion.spec.ts` (US-021). BD
 * aislada, fechas futuras propias y limpieza por patrón de email para no colisionar con
 * otras suites (memoria: US-004 flaky / BD aislada).
 */
import { Test, type TestingModule } from '@nestjs/testing';
import { ConfigModule } from '@nestjs/config';
import {
  CanalEntrada,
  DuracionHoras,
  EstadoReserva,
  TipoDocumento,
  TipoEvento,
} from '@prisma/client';
import { ConfirmacionModule } from '../confirmacion.module';
import { PrismaService } from '../../shared/prisma/prisma.service';
import {
  RegistrarFirmaCondicionesUseCase,
  type CondicionesFirmadasSubidas,
  type RegistrarFirmaCondicionesComando,
} from '../application/registrar-firma-condiciones.use-case';

const TENANT = '00000000-0000-0000-0000-000000000001';
const OTRO_TENANT = '00000000-0000-0000-0000-0000000000ff';
const GESTOR = '00000000-0000-0000-0000-000000000002';
const EMAIL_PATTERN = '@us024-int.test';
const MB = 1024 * 1024;

const FECHA_HAPPY = new Date('2028-05-01T00:00:00.000Z');
const FECHA_ORIGINAL = new Date('2028-05-02T00:00:00.000Z');
const FECHA_REFIRMA = new Date('2028-05-03T00:00:00.000Z');
const FECHA_NO_ENVIADAS = new Date('2028-05-04T00:00:00.000Z');
const FECHA_TERMINAL = new Date('2028-05-05T00:00:00.000Z');
const FECHA_RLS = new Date('2028-05-06T00:00:00.000Z');
const FECHA_EVENTO_CURSO = new Date('2028-05-07T00:00:00.000Z');
const FECHA_POST_EVENTO = new Date('2028-05-08T00:00:00.000Z');
const FECHAS = [
  FECHA_HAPPY,
  FECHA_ORIGINAL,
  FECHA_REFIRMA,
  FECHA_NO_ENVIADAS,
  FECHA_TERMINAL,
  FECHA_RLS,
  FECHA_EVENTO_CURSO,
  FECHA_POST_EVENTO,
];

let moduleRef: TestingModule;
let prisma: PrismaService;
let useCase: RegistrarFirmaCondicionesUseCase;

const sufijo = (): string => Math.random().toString(36).slice(2, 8);

const condicionesValidas = (
  over: Partial<CondicionesFirmadasSubidas> = {},
): CondicionesFirmadasSubidas => ({
  nombreArchivo: 'condiciones-firmadas.pdf',
  mimeType: 'application/pdf',
  tamanoBytes: 1 * MB,
  buffer: Buffer.from('%PDF-1.4 firma fake'),
  ...over,
});

const comando = (
  reservaId: string,
  over: Partial<RegistrarFirmaCondicionesComando> = {},
): RegistrarFirmaCondicionesComando => ({
  tenantId: TENANT,
  usuarioId: GESTOR,
  reservaId,
  condiciones: condicionesValidas(),
  ...over,
});

/**
 * Siembra una RESERVA lista para registrar la firma: estado dado, con
 * `cond_part_enviadas_fecha` informado (E3 enviado, salvo override) y
 * `cond_part_firmadas=false`.
 */
const sembrarReserva = async (params: {
  fecha: Date;
  estado?: EstadoReserva;
  condPartEnviadasFecha?: Date | null;
  condPartFirmadas?: boolean;
  tenantId?: string;
}): Promise<string> => {
  const tenantId = params.tenantId ?? TENANT;
  const cliente = await prisma.cliente.create({
    data: {
      tenantId,
      nombre: 'Lucía',
      apellidos: 'Márquez',
      email: `cli-${sufijo()}${EMAIL_PATTERN}`,
      dniNif: '12345678Z',
      direccion: 'C/ Mayor 1',
      codigoPostal: '08001',
      poblacion: 'Barcelona',
      provincia: 'Barcelona',
    },
  });
  const enviadas =
    params.condPartEnviadasFecha === undefined
      ? new Date('2028-04-01T10:00:00.000Z')
      : params.condPartEnviadasFecha;
  const reserva = await prisma.reserva.create({
    data: {
      tenantId,
      clienteId: cliente.idCliente,
      codigo: `TST-U024-${sufijo()}`,
      estado: params.estado ?? EstadoReserva.reserva_confirmada,
      subEstado: null,
      canalEntrada: CanalEntrada.web,
      fechaEvento: params.fecha,
      duracionHoras: DuracionHoras.h8,
      tipoEvento: TipoEvento.boda,
      numAdultosNinosMayores4: 40,
      numNinosMenores4: 5,
      importeTotal: '3000.00',
      ttlExpiracion: null,
      condPartEnviadasFecha: enviadas,
      condPartFirmadas: params.condPartFirmadas ?? false,
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
    where: { OR: [{ clienteId: { in: clienteIds } }, { fechaEvento: { in: FECHAS } }] },
    select: { idReserva: true, clienteId: true },
  });
  const ids = reservas.map((r) => r.idReserva);
  const todosClienteIds = [...new Set([...clienteIds, ...reservas.map((r) => r.clienteId)])];
  if (ids.length > 0) {
    await prisma.documento.deleteMany({ where: { reservaId: { in: ids } } });
    await prisma.comunicacion.deleteMany({ where: { reservaId: { in: ids } } });
    await prisma.pago.deleteMany({ where: { factura: { reservaId: { in: ids } } } });
    await prisma.factura.deleteMany({ where: { reservaId: { in: ids } } });
    await prisma.auditLog.deleteMany({ where: { entidadId: { in: ids } } });
    await prisma.reserva.deleteMany({ where: { idReserva: { in: ids } } });
  }
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
  useCase = moduleRef.get(RegistrarFirmaCondicionesUseCase);
});

afterAll(async () => {
  await limpiar();
  await moduleRef.close();
});

beforeEach(async () => {
  await limpiar();
});

// ===========================================================================
// Happy path — crea DOCUMENTO firmado, marca la firma, audita 'actualizar',
//   NO transiciona el estado.
// ===========================================================================

describe('Registrar firma — happy path (BD real)', () => {
  it('debe_crear_DOCUMENTO_firmado_marcar_firma_y_auditar_actualizar_sin_transicionar', async () => {
    const reservaId = await sembrarReserva({ fecha: FECHA_HAPPY });

    const resultado = await useCase.ejecutar(comando(reservaId));

    // DOCUMENTO condiciones_particulares creado.
    const documentos = await prisma.documento.findMany({ where: { reservaId } });
    expect(documentos).toHaveLength(1);
    expect(documentos[0].tipo).toBe(TipoDocumento.condiciones_particulares);
    expect(documentos[0].tenantId).toBe(TENANT);
    expect(documentos[0].url).toBeTruthy();
    expect(resultado.documento.idDocumento).toBe(documentos[0].idDocumento);

    // RESERVA: firma marcada, estado INTACTO (no transición).
    const reserva = await prisma.reserva.findUnique({ where: { idReserva: reservaId } });
    expect(reserva?.condPartFirmadas).toBe(true);
    expect(reserva?.condPartFirmadasFecha).not.toBeNull();
    expect(reserva?.estado).toBe(EstadoReserva.reserva_confirmada);

    // AUDIT_LOG: 'actualizar' (NUNCA 'transicion').
    const audit = await prisma.auditLog.findFirst({
      where: { tenantId: TENANT, entidadId: reservaId, accion: 'actualizar' },
    });
    expect(audit).not.toBeNull();
    expect(audit?.entidad).toBe('RESERVA');
    expect((audit?.datosAnteriores as { condPartFirmadas?: boolean })?.condPartFirmadas).toBe(
      false,
    );
    expect((audit?.datosNuevos as { condPartFirmadas?: boolean })?.condPartFirmadas).toBe(true);
    const transicion = await prisma.auditLog.count({
      where: { entidadId: reservaId, accion: 'transicion' },
    });
    expect(transicion).toBe(0);
  });

  it('debe_conservar_el_DOCUMENTO_original_no_firmado_de_US023', async () => {
    const reservaId = await sembrarReserva({ fecha: FECHA_ORIGINAL });
    // DOCUMENTO original NO firmado (US-023) preexistente, mismo tipo.
    const original = await prisma.documento.create({
      data: {
        reservaId,
        tenantId: TENANT,
        tipo: TipoDocumento.condiciones_particulares,
        url: `condiciones/${TENANT}.pdf`,
        mimeType: 'application/pdf',
        nombreArchivo: 'condiciones.pdf',
      },
    });

    await useCase.ejecutar(comando(reservaId));

    // Conviven ambas filas: el original permanece + la copia firmada nueva.
    const documentos = await prisma.documento.findMany({
      where: { reservaId, tipo: TipoDocumento.condiciones_particulares },
    });
    expect(documentos).toHaveLength(2);
    expect(documentos.some((d) => d.idDocumento === original.idDocumento)).toBe(true);
  });
});

// ===========================================================================
// Re-firma (§D-re-firma) — no idempotente: nueva versión, fecha actualizada,
//   flag se mantiene true, histórico conservado.
// ===========================================================================

describe('Registrar firma — re-firma no idempotente (BD real)', () => {
  it('debe_crear_otra_version_actualizar_fecha_y_mantener_flag_true', async () => {
    const reservaId = await sembrarReserva({ fecha: FECHA_REFIRMA });

    await useCase.ejecutar(comando(reservaId));
    const tras1 = await prisma.reserva.findUnique({ where: { idReserva: reservaId } });
    const fecha1 = tras1?.condPartFirmadasFecha;

    // Segundo registro (versión más legible): NO se rechaza.
    await useCase.ejecutar(comando(reservaId));

    const documentos = await prisma.documento.findMany({
      where: { reservaId, tipo: TipoDocumento.condiciones_particulares },
    });
    expect(documentos).toHaveLength(2); // histórico conservado (2 versiones firmadas).
    const tras2 = await prisma.reserva.findUnique({ where: { idReserva: reservaId } });
    expect(tras2?.condPartFirmadas).toBe(true);
    expect(tras2?.condPartFirmadasFecha?.getTime()).toBeGreaterThanOrEqual(
      fecha1?.getTime() ?? 0,
    );

    // La auditoría de la re-firma registra datos_anteriores.condPartFirmadas = true.
    const audits = await prisma.auditLog.findMany({
      where: { entidadId: reservaId, accion: 'actualizar' },
      orderBy: { fechaCreacion: 'asc' },
    });
    expect(audits).toHaveLength(2);
    expect((audits[1].datosAnteriores as { condPartFirmadas?: boolean })?.condPartFirmadas).toBe(
      true,
    );
  });
});

// ===========================================================================
// Guardas de precondición (rechazo SIN efectos).
// ===========================================================================

describe('Registrar firma — guardas de precondición (BD real)', () => {
  it('debe_rechazar_con_CONDICIONES_NO_ENVIADAS_si_enviadas_fecha_es_null_sin_efectos', async () => {
    const reservaId = await sembrarReserva({
      fecha: FECHA_NO_ENVIADAS,
      condPartEnviadasFecha: null,
    });

    await expect(useCase.ejecutar(comando(reservaId))).rejects.toMatchObject({
      codigo: 'CONDICIONES_NO_ENVIADAS',
    });

    // Sin efectos: sin DOCUMENTO, flag sigue false.
    expect(await prisma.documento.count({ where: { reservaId } })).toBe(0);
    const reserva = await prisma.reserva.findUnique({ where: { idReserva: reservaId } });
    expect(reserva?.condPartFirmadas).toBe(false);
    expect(reserva?.condPartFirmadasFecha).toBeNull();
  });

  it('debe_rechazar_con_ESTADO_INVALIDO_en_estado_terminal_sin_efectos', async () => {
    const reservaId = await sembrarReserva({
      fecha: FECHA_TERMINAL,
      estado: EstadoReserva.reserva_completada,
    });

    await expect(useCase.ejecutar(comando(reservaId))).rejects.toMatchObject({
      codigo: 'ESTADO_INVALIDO',
    });

    expect(await prisma.documento.count({ where: { reservaId } })).toBe(0);
    const reserva = await prisma.reserva.findUnique({ where: { idReserva: reservaId } });
    expect(reserva?.condPartFirmadas).toBe(false);
  });

  it('debe_aceptar_los_estados_evento_en_curso_y_post_evento', async () => {
    const enCurso = await sembrarReserva({
      fecha: FECHA_EVENTO_CURSO,
      estado: EstadoReserva.evento_en_curso,
    });
    const postEvento = await sembrarReserva({
      fecha: FECHA_POST_EVENTO,
      estado: EstadoReserva.post_evento,
    });

    await expect(useCase.ejecutar(comando(enCurso))).resolves.toMatchObject({
      condPartFirmadas: true,
    });
    await expect(useCase.ejecutar(comando(postEvento))).resolves.toMatchObject({
      condPartFirmadas: true,
    });

    expect(
      (await prisma.reserva.findUnique({ where: { idReserva: enCurso } }))?.estado,
    ).toBe(EstadoReserva.evento_en_curso);
    expect(
      (await prisma.reserva.findUnique({ where: { idReserva: postEvento } }))?.estado,
    ).toBe(EstadoReserva.post_evento);
  });
});

// ===========================================================================
// Multi-tenancy / RLS — un tenant no puede registrar la firma en la reserva de
//   otro; RLS la hace invisible (404) y no muta nada.
// ===========================================================================

describe('Registrar firma — aislamiento multi-tenant / RLS (BD real)', () => {
  it('debe_rechazar_y_no_mutar_cuando_el_tenant_del_jwt_no_es_dueno', async () => {
    const reservaId = await sembrarReserva({ fecha: FECHA_RLS });

    await expect(
      useCase.ejecutar(comando(reservaId, { tenantId: OTRO_TENANT })),
    ).rejects.toMatchObject({ codigo: 'RESERVA_NO_ENCONTRADA' });

    // Sin efectos sobre la reserva real del TENANT dueño.
    expect(await prisma.documento.count({ where: { reservaId } })).toBe(0);
    const reserva = await prisma.reserva.findUnique({ where: { idReserva: reservaId } });
    expect(reserva?.condPartFirmadas).toBe(false);
  });
});
