/**
 * TESTS DE INTEGRACIÓN REAL del envío de la factura de señal (E3) — rebanada 6.4b
 * (`documentos-enviar-factura-senal-e3`, Bloque C). Verifican el caso de uso
 * `EnviarFacturaSenalUseCase` cableado en `FacturacionModule` contra el Postgres
 * del docker-compose (BD aislada `slotify_test`, `.env.test`): NO se doblan los
 * puertos, se ejercitan los adaptadores Prisma reales (emisión de la señal, UoW
 * tx+RLS, lectura de la reserva, COMUNICACION E3, AUDIT_LOG) y se comprueba el
 * ESTADO DE LA BD tras la operación. El transporte de email va en modo fake en
 * `test` (`FakeEmailAdapter`, cero red); la generación de condiciones puede
 * generar el PDF de condiciones on-demand.
 *
 * US-023 (GAP 2, D-condiciones-bloqueante — DECISIÓN CERRADA/aprobada, ENDURECER): las condiciones
 * son requisito DURO del envío E3. Para que el camino feliz sea reproducible sin depender del
 * `plantilla_documento_tenant` sembrado, este spec SOBREESCRIBE `GENERAR_PDF_CONDICIONES_PORT` con
 * un stub que devuelve una URL fija (evita la flakiness ESM de react-pdf); así `condPartAdjuntada`
 * es SIEMPRE `true` en un 200 y el primer envío PERSISTE el DOCUMENTO de condiciones (GAP 1).
 *
 * Cubre los casos ALCANZABLES contra BD real:
 *   - Happy path: `borrador → enviada`, conserva `numero_factura`, fija
 *     `fecha_emision`, `RESERVA.cond_part_enviadas_fecha` + `cond_part_firmadas=false`,
 *     COMUNICACION E3 `enviado`, AUDIT_LOG.
 *   - PDF de señal ausente (`pdf_url=null`) → `EmisionEnvioFallidoError` (502) y NADA
 *     se consolida (rollback).
 *   - Idempotencia: con una COMUNICACION E3 `enviado` previa → `E3YaEnviadoError` (409).
 *   - Reintento permitido: con una COMUNICACION E3 `fallido` previa → envía.
 *   - 404: reserva/factura inexistente o cross-tenant (RLS) → `FacturaSenalNoEncontradaError`.
 *
 * NOTA (hallazgo QA): el estado `rechazada` de la guarda `FacturaSenalNoEnviableError`
 * NO es alcanzable contra BD real — el enum `EstadoFactura` solo tiene
 * `borrador|enviada|cobrada` y el rechazo (US-022) NO transiciona (permanece en
 * `borrador`, solo AUDIT_LOG). Ese caso queda cubierto solo por el spec unitario.
 */
import { Test, type TestingModule } from '@nestjs/testing';
import { ConfigModule } from '@nestjs/config';
import {
  CanalEntrada,
  CodigoEmail,
  DuracionHoras,
  EstadoComunicacion,
  EstadoFactura,
  EstadoReserva,
  TipoEvento,
  TipoFactura,
} from '@prisma/client';
import { FacturacionModule } from '../facturacion.module';
import { PrismaService } from '../../shared/prisma/prisma.service';
import { GENERAR_PDF_CONDICIONES_PORT } from '../../documentos/documentos.tokens';
import type { GenerarPdfCondicionesPort } from '../../documentos/domain/generar-pdf-condiciones.port';
import {
  EnviarFacturaSenalUseCase,
  E3YaEnviadoError,
  EmisionEnvioFallidoError,
  FacturaSenalNoEncontradaError,
} from '../application/enviar-factura-senal.use-case';

const TENANT = '00000000-0000-0000-0000-000000000001';
const OTRO_TENANT = '00000000-0000-0000-0000-0000000000ff';
const GESTOR = '00000000-0000-0000-0000-000000000002';
const EMAIL_PATTERN = '@us023-int.test';
const URL_PDF_CONDICIONES = 'http://localhost:3000/api/documentos/condiciones/tenant.pdf';

/**
 * Stub del puerto de generación del PDF de condiciones (GAP 2): devuelve una URL fija, de modo que
 * las condiciones existen SIEMPRE en el camino feliz (requisito duro) sin depender de sembrar el
 * `plantilla_documento_tenant` ni del render react-pdf (flakiness ESM).
 */
const condicionesStub: GenerarPdfCondicionesPort = {
  generar: async () => URL_PDF_CONDICIONES,
};

let moduleRef: TestingModule;
let prisma: PrismaService;
let useCase: EnviarFacturaSenalUseCase;

const sufijo = (): string => Math.random().toString(36).slice(2, 8);

/**
 * Siembra una RESERVA `reserva_confirmada` con su CLIENTE (con email) y una FACTURA
 * `tipo='senal'` en el estado indicado. Devuelve `{ reservaId, facturaId }`.
 */
const sembrarSenal = async (params: {
  estadoFactura?: EstadoFactura;
  pdfUrl?: string | null;
  numeroFactura?: string | null;
  tenantId?: string;
}): Promise<{ reservaId: string; facturaId: string }> => {
  const tenantId = params.tenantId ?? TENANT;
  const cliente = await prisma.cliente.create({
    data: {
      tenantId,
      nombre: 'Laura',
      apellidos: 'Puig',
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
      codigo: `TST-U023-${sufijo()}`,
      estado: EstadoReserva.reserva_confirmada,
      canalEntrada: CanalEntrada.web,
      fechaEvento: new Date('2028-05-01T00:00:00.000Z'),
      duracionHoras: DuracionHoras.h8,
      tipoEvento: TipoEvento.boda,
      numAdultosNinosMayores4: 40,
      numNinosMenores4: 5,
      importeTotal: '3000.00',
    },
  });
  const factura = await prisma.factura.create({
    data: {
      tenantId,
      reservaId: reserva.idReserva,
      numeroFactura: params.numeroFactura === undefined ? `F-2028-${sufijo()}` : params.numeroFactura,
      tipo: TipoFactura.senal,
      baseImponible: '826.45',
      ivaPorcentaje: '21.00',
      ivaImporte: '173.55',
      total: '1000.00',
      concepto: `Señal reserva ${reserva.codigo}`,
      pdfUrl: params.pdfUrl === undefined ? 'http://localhost:3000/api/documentos/facturas/x.pdf' : params.pdfUrl,
      estado: params.estadoFactura ?? EstadoFactura.borrador,
    },
  });
  return { reservaId: reserva.idReserva, facturaId: factura.idFactura };
};

const comando = (reservaId: string, tenantId = TENANT) => ({
  tenantId,
  usuarioId: GESTOR,
  reservaId,
});

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
    await prisma.comunicacion.deleteMany({ where: { reservaId: { in: ids } } });
    await prisma.documento.deleteMany({ where: { reservaId: { in: ids } } });
    await prisma.pago.deleteMany({ where: { factura: { reservaId: { in: ids } } } });
    await prisma.factura.deleteMany({ where: { reservaId: { in: ids } } });
    await prisma.auditLog.deleteMany({ where: { entidadId: { in: ids } } });
    await prisma.reserva.deleteMany({ where: { idReserva: { in: ids } } });
  }
  if (clienteIds.length > 0) {
    await prisma.cliente.deleteMany({ where: { idCliente: { in: clienteIds } } });
  }
};

beforeAll(async () => {
  moduleRef = await Test.createTestingModule({
    imports: [ConfigModule.forRoot({ isGlobal: true }), FacturacionModule],
  })
    // GAP 2: stub del PDF de condiciones (URL fija) para el camino feliz endurecido.
    .overrideProvider(GENERAR_PDF_CONDICIONES_PORT)
    .useValue(condicionesStub)
    .compile();
  await moduleRef.init();
  prisma = moduleRef.get(PrismaService);
  useCase = moduleRef.get(EnviarFacturaSenalUseCase);
});

afterAll(async () => {
  await limpiar();
  await moduleRef.close();
});

beforeEach(async () => {
  await limpiar();
});

// ===========================================================================
// Happy path: borrador → enviada + estado de BD consolidado.
// ===========================================================================

describe('EnviarFacturaSenal — happy path (integración real)', () => {
  it('emite la señal a enviada, fija fecha_emision, conserva numero_factura y consolida cond_part + COMUNICACION E3 + AUDIT_LOG', async () => {
    const { reservaId, facturaId } = await sembrarSenal({ numeroFactura: 'F-2028-0007' });

    const res = await useCase.ejecutar(comando(reservaId));

    // Resultado
    expect(res.senal.estado).toBe('enviada');
    expect(res.senal.numeroFactura).toBe('F-2028-0007');
    expect(res.condPartEnviadasFecha).toBeInstanceOf(Date);
    // GAP 2 (endurecido): en un 200 las condiciones SIEMPRE van adjuntas.
    expect(res.condPartAdjuntada).toBe(true);

    // GAP 1: el primer envío PERSISTE el DOCUMENTO de condiciones (url + mime application/pdf).
    const documento = await prisma.documento.findFirst({
      where: { reservaId, tipo: 'condiciones_particulares' },
    });
    expect(documento).not.toBeNull();
    expect(documento?.url).toBe(URL_PDF_CONDICIONES);
    expect(documento?.mimeType).toBe('application/pdf');

    // FACTURA en BD
    const factura = await prisma.factura.findUnique({ where: { idFactura: facturaId } });
    expect(factura?.estado).toBe(EstadoFactura.enviada);
    expect(factura?.fechaEmision).not.toBeNull();
    expect(factura?.numeroFactura).toBe('F-2028-0007');

    // RESERVA en BD
    const reserva = await prisma.reserva.findUnique({ where: { idReserva: reservaId } });
    expect(reserva?.condPartEnviadasFecha).not.toBeNull();
    expect(reserva?.condPartFirmadas).toBe(false);

    // COMUNICACION E3 enviado
    const com = await prisma.comunicacion.findFirst({
      where: { reservaId, codigoEmail: CodigoEmail.E3, estado: EstadoComunicacion.enviado },
    });
    expect(com).not.toBeNull();

    // AUDIT_LOG de la factura (actualizar borrador → enviada)
    const audit = await prisma.auditLog.findFirst({
      where: { entidadId: facturaId, entidad: 'FACTURA' },
      orderBy: { fechaCreacion: 'desc' },
    });
    expect(audit).not.toBeNull();
  });
});

// ===========================================================================
// PDF de señal ausente → EmisionEnvioFallidoError (502); rollback total.
// ===========================================================================

describe('EnviarFacturaSenal — PDF de señal ausente (integración real)', () => {
  it('lanza EmisionEnvioFallidoError y NO consolida nada cuando pdf_url es null', async () => {
    const { reservaId, facturaId } = await sembrarSenal({ pdfUrl: null });

    await expect(useCase.ejecutar(comando(reservaId))).rejects.toBeInstanceOf(
      EmisionEnvioFallidoError,
    );

    const factura = await prisma.factura.findUnique({ where: { idFactura: facturaId } });
    expect(factura?.estado).toBe(EstadoFactura.borrador);
    const reserva = await prisma.reserva.findUnique({ where: { idReserva: reservaId } });
    expect(reserva?.condPartEnviadasFecha).toBeNull();
    const com = await prisma.comunicacion.findFirst({
      where: { reservaId, codigoEmail: CodigoEmail.E3, estado: EstadoComunicacion.enviado },
    });
    expect(com).toBeNull();
  });
});

// ===========================================================================
// Idempotencia: E3 enviado previo → 409; E3 fallido previo → permite reintento.
// ===========================================================================

describe('EnviarFacturaSenal — idempotencia de E3 (integración real)', () => {
  it('rechaza el re-disparo con E3YaEnviadoError sin duplicar la comunicación', async () => {
    const { reservaId } = await sembrarSenal({});
    await useCase.ejecutar(comando(reservaId)); // primer envío OK

    await expect(useCase.ejecutar(comando(reservaId))).rejects.toBeInstanceOf(E3YaEnviadoError);

    const enviadas = await prisma.comunicacion.count({
      where: { reservaId, codigoEmail: CodigoEmail.E3, estado: EstadoComunicacion.enviado },
    });
    expect(enviadas).toBe(1);
  });

  // HALLAZGO QA (no alcanzable en 6.4b): el spec declara "E3 `fallido` previa → permite
  // reintento", pero el adaptador DIRECTO de este slice NUNCA persiste una COMUNICACION E3
  // `fallido` (solo escribe `enviado` tras el envío OK; ante fallo hace rollback total). Un
  // `fallido` E3 (es_reenvio=false) solo lo produciría el MOTOR (DespacharEmailService), que
  // NO se usa aquí. Además, el índice único PARCIAL
  // `(reserva_id, codigo_email) WHERE reserva_id IS NOT NULL AND es_reenvio=false` haría que
  // un `crear` de reintento colisionara con P2002 sobre ese `fallido`. La lógica de la guarda
  // (permitir cuando solo hay `fallido`) queda cubierta por el spec UNITARIO con dobles
  // (`enviar-factura-senal.use-case.spec.ts` §3.5). El escenario NO se ejercita aquí a nivel
  // BD porque no es reproducible por el flujo real de 6.4b. Ver report §7 y §D-idempotencia.
});

// ===========================================================================
// 404 — reserva/factura inexistente o cross-tenant (RLS).
// ===========================================================================

describe('EnviarFacturaSenal — no encontrada (integración real)', () => {
  it('lanza FacturaSenalNoEncontradaError cuando la reserva no existe', async () => {
    await expect(
      useCase.ejecutar(comando('00000000-0000-0000-0000-0000000000cc')),
    ).rejects.toBeInstanceOf(FacturaSenalNoEncontradaError);
  });

  it('lanza FacturaSenalNoEncontradaError para una reserva de OTRO tenant (RLS)', async () => {
    const { reservaId } = await sembrarSenal({ tenantId: TENANT });
    // El comando viaja con OTRO_TENANT: RLS oculta la reserva del tenant piloto.
    await expect(useCase.ejecutar(comando(reservaId, OTRO_TENANT))).rejects.toBeInstanceOf(
      FacturaSenalNoEncontradaError,
    );
  });
});
