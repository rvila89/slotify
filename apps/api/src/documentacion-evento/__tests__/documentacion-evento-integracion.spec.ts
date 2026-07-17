/**
 * TESTS DE INTEGRACIÓN de la captura de documentación del evento (US-033 / UC-24)
 * — fase TDD RED. tasks.md Fase 3: 3.2/3.4 (persistencia real + RLS).
 *
 * Trazabilidad: US-033; spec-delta `documentacion-evento` (creación de DOCUMENTO +
 * AUDIT_LOG `crear`, re-subida NO idempotente conservando histórico, checklist derivado
 * por lectura, RLS multi-tenant 404 cross-tenant); design.md §D-almacenamiento,
 * §D-documento-repo, §D-no-idempotencia, §D-checklist.
 *
 * INTEGRACIÓN REAL contra el Postgres AISLADO de tests (`slotify_test`, `.env.test`) — NO
 * mocks (memoria del proyecto: "US-049 backend nunca probado contra BD real"): la creación
 * de la fila DOCUMENTO, la no-idempotencia (2 filas para el mismo tipo), el AUDIT_LOG
 * `crear` y la RLS se verifican por el ESTADO DE LA BD real. El almacén de documentos usa
 * el adaptador `local` durable (sin credenciales cloud). Fechas/emails propios; se limpia
 * el sembrado. US-033 NO toca FECHA_BLOQUEADA (no depende del deadlock 40P01 flaky de
 * US-004). BD aislada (memoria: "Tests con BD aislada slotify_test").
 *
 * ⚠️ EJECUTAR DESDE LA SESIÓN PRINCIPAL (con Docker/Postgres). Los subagentes QA corren
 * sin BD real (memoria: "Subagentes sin Docker/Postgres"): este .spec queda PENDIENTE de
 * ejecución hasta que se lance con `docker compose up -d postgres` + migración + seed.
 *
 * RED: aún NO existe `documentacion-evento/documentacion-evento.module.ts` ni los
 * use-cases con su cableado. El import falla en compilación y la batería está en ROJO por
 * AUSENCIA DE IMPLEMENTACIÓN. GREEN es de `backend-developer`.
 */
import { Test, type TestingModule } from '@nestjs/testing';
import { ConfigModule } from '@nestjs/config';
import { CanalEntrada, EstadoReserva, TipoDocumento } from '@prisma/client';
import { DocumentacionEventoModule } from '../documentacion-evento.module';
import { PrismaService } from '../../shared/prisma/prisma.service';
import {
  SubirDocumentoEventoUseCase,
  type SubirDocumentoEventoComando,
  type ArchivoDocumentoEventoSubido,
} from '../application/subir-documento-evento.use-case';
import { ObtenerChecklistDocumentacionEventoQuery } from '../application/obtener-checklist-documentacion-evento.query';

const TENANT = '00000000-0000-0000-0000-000000000001';
const OTRO_TENANT = '00000000-0000-0000-0000-0000000000ff';
const GESTOR = '00000000-0000-0000-0000-000000000002';
const EMAIL_PATTERN = '@us033-int.test';
const MB = 1024 * 1024;

let moduleRef: TestingModule;
let prisma: PrismaService;
let useCase: SubirDocumentoEventoUseCase;
let checklistQuery: ObtenerChecklistDocumentacionEventoQuery;

const sufijo = (): string => Math.random().toString(36).slice(2, 8);

const archivoValido = (
  over: Partial<ArchivoDocumentoEventoSubido> = {},
): ArchivoDocumentoEventoSubido => ({
  nombreArchivo: 'dni-anverso.jpg',
  mimeType: 'image/jpeg',
  tamanoBytes: 1 * MB,
  buffer: Buffer.from('fake-jpeg-bytes'),
  ...over,
});

const comando = (
  reservaId: string,
  over: Partial<SubirDocumentoEventoComando> = {},
): SubirDocumentoEventoComando => ({
  tenantId: TENANT,
  usuarioId: GESTOR,
  reservaId,
  tipo: 'dni_anverso',
  archivo: archivoValido(),
  ...over,
});

/** Siembra una RESERVA en el estado dado (por defecto `evento_en_curso`) con su CLIENTE. */
const sembrarReserva = async (params: {
  estado?: EstadoReserva;
  tenantId?: string;
} = {}): Promise<string> => {
  const tenantId = params.tenantId ?? TENANT;
  const cliente = await prisma.cliente.create({
    data: {
      tenantId,
      nombre: 'Nadia',
      apellidos: 'Ferrer',
      email: `cli-${sufijo()}${EMAIL_PATTERN}`,
    },
  });
  const reserva = await prisma.reserva.create({
    data: {
      tenantId,
      clienteId: cliente.idCliente,
      codigo: `TST-U033-${sufijo()}`,
      estado: params.estado ?? EstadoReserva.evento_en_curso,
      canalEntrada: CanalEntrada.web,
      fechaEvento: new Date('2028-05-10T00:00:00.000Z'),
    },
  });
  return reserva.idReserva;
};

const limpiar = async (): Promise<void> => {
  const clientes = await prisma.cliente.findMany({
    where: { email: { contains: EMAIL_PATTERN } },
    select: { idCliente: true },
  });
  const clienteIds = clientes.map((c) => c.idCliente);
  const reservas = await prisma.reserva.findMany({
    where: { clienteId: { in: clienteIds } },
    select: { idReserva: true },
  });
  const ids = reservas.map((r) => r.idReserva);
  if (ids.length > 0) {
    await prisma.documento.deleteMany({ where: { reservaId: { in: ids } } });
    await prisma.auditLog.deleteMany({ where: { entidadId: { in: ids } } });
    await prisma.reserva.deleteMany({ where: { idReserva: { in: ids } } });
  }
  if (clienteIds.length > 0) {
    await prisma.cliente.deleteMany({ where: { idCliente: { in: clienteIds } } });
  }
};

beforeAll(async () => {
  moduleRef = await Test.createTestingModule({
    imports: [ConfigModule.forRoot({ isGlobal: true }), DocumentacionEventoModule],
  }).compile();
  await moduleRef.init();
  prisma = moduleRef.get(PrismaService);
  useCase = moduleRef.get(SubirDocumentoEventoUseCase);
  checklistQuery = moduleRef.get(ObtenerChecklistDocumentacionEventoQuery);
});

afterAll(async () => {
  await limpiar();
  await moduleRef.close();
});

beforeEach(async () => {
  await limpiar();
});

// ===========================================================================
// Persistencia real: subir un DOCUMENTO del evento crea la fila con url/mime/
//        tamano>0 y tenant heredado, y AUDIT_LOG `crear`/`DOCUMENTO`.
// ===========================================================================

describe('Documentación evento — persistencia real del DOCUMENTO + auditoría', () => {
  it('debe_crear_una_fila_DOCUMENTO_dni_anverso_con_url_mime_y_tamano', async () => {
    const reservaId = await sembrarReserva();

    await useCase.ejecutar(
      comando(reservaId, { archivo: archivoValido({ mimeType: 'image/png' }) }),
    );

    const documentos = await prisma.documento.findMany({ where: { reservaId } });
    expect(documentos).toHaveLength(1);
    expect(documentos[0].tipo).toBe(TipoDocumento.dni_anverso);
    expect(documentos[0].tenantId).toBe(TENANT);
    expect(documentos[0].mimeType).toBe('image/png');
    expect(documentos[0].url).toBeTruthy();
    expect(Number(documentos[0].tamanoBytes)).toBeGreaterThan(0);

    const audit = await prisma.auditLog.findFirst({
      where: { tenantId: TENANT, entidadId: reservaId, accion: 'crear', entidad: 'DOCUMENTO' },
    });
    expect(audit).not.toBeNull();
  });
});

// ===========================================================================
// No-idempotencia real: re-subir el mismo tipo crea una SEGUNDA fila (histórico).
// ===========================================================================

describe('Documentación evento — re-subida NO idempotente (2 filas para el mismo tipo)', () => {
  it('debe_crear_dos_filas_dni_anverso_conservando_la_anterior', async () => {
    const reservaId = await sembrarReserva();

    await useCase.ejecutar(comando(reservaId, { tipo: 'dni_anverso' }));
    await useCase.ejecutar(
      comando(reservaId, {
        tipo: 'dni_anverso',
        archivo: archivoValido({ nombreArchivo: 'dni-anverso-v2.jpg' }),
      }),
    );

    const documentos = await prisma.documento.findMany({
      where: { reservaId, tipo: TipoDocumento.dni_anverso },
    });
    expect(documentos).toHaveLength(2);
  });
});

// ===========================================================================
// Checklist real derivado: existencia ≥1 por tipo; el ítem completado toma el
//        más reciente; consultable en post_evento.
// ===========================================================================

describe('Documentación evento — checklist real derivado por lectura', () => {
  it('debe_reflejar_completado_por_existencia_de_documento_por_tipo', async () => {
    const reservaId = await sembrarReserva();
    await useCase.ejecutar(comando(reservaId, { tipo: 'dni_anverso' }));

    const checklist = await checklistQuery.ejecutar({ tenantId: TENANT, reservaId });

    expect(checklist.items).toHaveLength(3);
    const anverso = checklist.items.find((i) => i.tipo === 'dni_anverso');
    const reverso = checklist.items.find((i) => i.tipo === 'dni_reverso');
    expect(anverso?.completado).toBe(true);
    expect(reverso?.completado).toBe(false);
  });

  it('debe_seguir_consultable_en_post_evento_para_subida_tardia', async () => {
    const reservaId = await sembrarReserva({ estado: EstadoReserva.post_evento });

    const checklist = await checklistQuery.ejecutar({ tenantId: TENANT, reservaId });

    expect(checklist.items).toHaveLength(3);
    expect(checklist.items.every((i) => i.completado === false)).toBe(true);
  });
});

// ===========================================================================
// Guarda de estado real: subir en un estado != evento_en_curso rechaza SIN crear.
// ===========================================================================

describe('Documentación evento — guarda de estado real (solo evento_en_curso escribe)', () => {
  it('debe_rechazar_sin_crear_documento_cuando_la_reserva_esta_en_reserva_confirmada', async () => {
    const reservaId = await sembrarReserva({ estado: EstadoReserva.reserva_confirmada });

    await expect(useCase.ejecutar(comando(reservaId))).rejects.toMatchObject({
      codigo: 'ESTADO_NO_PERMITE_DOCUMENTACION',
    });

    expect(await prisma.documento.count({ where: { reservaId } })).toBe(0);
  });
});

// ===========================================================================
// RLS multi-tenant — un tenant no puede subir/consultar la RESERVA de otro (404),
//        sin crear documentos.
// ===========================================================================

describe('Documentación evento — aislamiento multi-tenant / RLS', () => {
  it('debe_rechazar_la_subida_y_no_crear_documento_cuando_el_tenant_no_es_dueno', async () => {
    const reservaId = await sembrarReserva();

    await expect(
      useCase.ejecutar(comando(reservaId, { tenantId: OTRO_TENANT })),
    ).rejects.toBeDefined();

    expect(await prisma.documento.count({ where: { reservaId } })).toBe(0);
  });

  it('debe_rechazar_el_checklist_cross_tenant', async () => {
    const reservaId = await sembrarReserva();

    await expect(
      checklistQuery.ejecutar({ tenantId: OTRO_TENANT, reservaId }),
    ).rejects.toBeDefined();
  });
});
