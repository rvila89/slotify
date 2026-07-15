/**
 * TESTS DE INTEGRACIÓN REAL del REENVÍO de la factura de señal (E3) — US-023 / GAP 3
 * (`condiciones-particulares-e3-us023`, §D-reenvio-e3). Verifican el caso de uso
 * `ReenviarE3UseCase` cableado en `FacturacionModule` contra el Postgres del
 * docker-compose (BD aislada `slotify_test`, `.env.test`): NO se doblan los puertos de
 * lectura ni de persistencia, se ejercitan los adaptadores Prisma reales
 * (`lecturas-emision.prisma.adapter` → carga de reserva/factura de señal, COMUNICACION E3
 * previa y DOCUMENTO de condiciones; `reenvio-comunicacion.prisma.adapter` → NUEVA
 * COMUNICACION E3 `es_reenvio=true`, `cond_part_enviadas_fecha`, AUDIT_LOG) y se comprueba
 * el ESTADO DE LA BD tras la operación. El transporte de email va en modo fake en `test`
 * (`FakeEmailAdapter`, cero red).
 *
 * ESPEJO EXACTO de `enviar-factura-senal-integracion.spec.ts`: mismo bootstrap con
 * `moduleRef`, mismo sembrado/limpieza con Prisma real, misma gestión de tenant/RLS. Se
 * SOBREESCRIBE `GENERAR_PDF_CONDICIONES_PORT` con un stub de URL fija (esquiva la flakiness
 * ESM de react-pdf); el reenvío NO regenera el PDF, así que el stub solo blinda el bootstrap
 * del módulo (`EnviarFacturaSenalUseCase` lo inyecta).
 *
 * Cierra la lección US-049 (adaptadores Prisma del reenvío jamás ejercitados contra BD real):
 *   - Happy path: sobre un E3 ya enviado (FACTURA señal `enviada`, DOCUMENTO condiciones
 *     persistido, COMUNICACION E3 `es_reenvio=false`) → NUEVA COMUNICACION E3 `es_reenvio=true`
 *     (esquiva el índice UNIQUE parcial), NO re-emite la FACTURA (mismo `numero_factura`, misma
 *     `fecha_emision`, mismo `estado`), NO duplica el DOCUMENTO (sigue habiendo 1), actualiza
 *     `RESERVA.cond_part_enviadas_fecha`, NO transiciona el estado de la RESERVA. AUDIT_LOG.
 *   - Rollback: si el envío de email falla (override de `REENVIAR_E3_PORT`), NO se consolida
 *     la nueva COMUNICACION `es_reenvio=true` ni se muta nada (`cond_part_enviadas_fecha`
 *     intacto) → `EmisionEnvioFallidoError`.
 *   - RLS: reenvío de una reserva de OTRO tenant → `FacturaSenalNoEncontradaError`.
 *   - Sin E3 previo (E3 aún no enviado por primera vez) → `E3NoEnviadoPreviamenteError`.
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
  TipoDocumento,
  TipoEvento,
  TipoFactura,
} from '@prisma/client';
import { FacturacionModule } from '../facturacion.module';
import { PrismaService } from '../../shared/prisma/prisma.service';
import { GENERAR_PDF_CONDICIONES_PORT } from '../../documentos/documentos.tokens';
import type { GenerarPdfCondicionesPort } from '../../documentos/domain/generar-pdf-condiciones.port';
import { REENVIAR_E3_PORT } from '../facturacion.tokens';
import type { ReenviarE3Port } from '../application/reenviar-e3.use-case';
import {
  ReenviarE3UseCase,
  E3NoEnviadoPreviamenteError,
  EmisionEnvioFallidoError,
  FacturaSenalNoEncontradaError,
} from '../application/reenviar-e3.use-case';

const TENANT = '00000000-0000-0000-0000-000000000001';
const OTRO_TENANT = '00000000-0000-0000-0000-0000000000ff';
const GESTOR = '00000000-0000-0000-0000-000000000002';
const EMAIL_PATTERN = '@us023-reenvio-int.test';
const URL_PDF_SENAL = 'http://localhost:3000/api/documentos/facturas/senal.pdf';
const URL_PDF_CONDICIONES = 'http://localhost:3000/api/documentos/condiciones/tenant.pdf';

/**
 * Stub del puerto de generación del PDF de condiciones: el reenvío NO regenera nada, pero
 * `EnviarFacturaSenalUseCase` (co-registrado en `FacturacionModule`) inyecta este puerto, así
 * que el stub solo blinda el bootstrap del módulo frente a la flakiness ESM de react-pdf.
 */
const condicionesStub: GenerarPdfCondicionesPort = {
  generar: async () => URL_PDF_CONDICIONES,
};

let moduleRef: TestingModule;
let prisma: PrismaService;
let useCase: ReenviarE3UseCase;

const sufijo = (): string => Math.random().toString(36).slice(2, 8);

/**
 * Siembra el ESTADO POST-E3 de una reserva: CLIENTE (con email), RESERVA `reserva_confirmada`
 * con `cond_part_enviadas_fecha` fijada, FACTURA `tipo='senal'` YA `enviada` (con
 * `numero_factura` + `fecha_emision`), DOCUMENTO `condiciones_particulares` persistido (GAP 1)
 * y COMUNICACION E3 original (`es_reenvio=false`) en el estado indicado (por defecto `enviado`).
 * Con `sinE3Previa=true` NO siembra la COMUNICACION E3 (para probar el 409).
 */
const sembrarE3Enviado = async (params: {
  tenantId?: string;
  estadoE3Previa?: EstadoComunicacion;
  sinE3Previa?: boolean;
  sinDocumentoCondiciones?: boolean;
} = {}): Promise<{
  reservaId: string;
  facturaId: string;
  numeroFactura: string;
  fechaEmision: Date;
  condPartEnviadasFecha: Date;
}> => {
  const tenantId = params.tenantId ?? TENANT;
  const numeroFactura = `F-2028-${sufijo()}`;
  const fechaEmision = new Date('2028-04-01T10:00:00.000Z');
  const condPartEnviadasFecha = new Date('2028-04-01T10:00:00.000Z');

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
      codigo: `TST-U023R-${sufijo()}`,
      estado: EstadoReserva.reserva_confirmada,
      canalEntrada: CanalEntrada.web,
      fechaEvento: new Date('2028-05-01T00:00:00.000Z'),
      duracionHoras: DuracionHoras.h8,
      tipoEvento: TipoEvento.boda,
      numAdultosNinosMayores4: 40,
      numNinosMenores4: 5,
      importeTotal: '3000.00',
      condPartEnviadasFecha,
      condPartFirmadas: false,
    },
  });
  const factura = await prisma.factura.create({
    data: {
      tenantId,
      reservaId: reserva.idReserva,
      numeroFactura,
      tipo: TipoFactura.senal,
      baseImponible: '826.45',
      ivaPorcentaje: '21.00',
      ivaImporte: '173.55',
      total: '1000.00',
      concepto: `Señal reserva ${reserva.codigo}`,
      pdfUrl: URL_PDF_SENAL,
      estado: EstadoFactura.enviada,
      fechaEmision,
    },
  });
  if (params.sinDocumentoCondiciones !== true) {
    await prisma.documento.create({
      data: {
        tenantId,
        reservaId: reserva.idReserva,
        tipo: TipoDocumento.condiciones_particulares,
        nombreArchivo: 'condicions-particulars.pdf',
        url: URL_PDF_CONDICIONES,
        mimeType: 'application/pdf',
      },
    });
  }
  if (params.sinE3Previa !== true) {
    await prisma.comunicacion.create({
      data: {
        tenantId,
        reservaId: reserva.idReserva,
        clienteId: cliente.idCliente,
        codigoEmail: CodigoEmail.E3,
        asunto: 'Confirmación de tu reserva y factura de señal',
        cuerpo: null,
        destinatarioEmail: cliente.email ?? '',
        estado: params.estadoE3Previa ?? EstadoComunicacion.enviado,
        fechaEnvio: condPartEnviadasFecha,
        esReenvio: false,
      },
    });
  }
  return {
    reservaId: reserva.idReserva,
    facturaId: factura.idFactura,
    numeroFactura,
    fechaEmision,
    condPartEnviadasFecha,
  };
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
    // Blinda el bootstrap del módulo frente a la flakiness ESM de react-pdf (el reenvío no lo usa).
    .overrideProvider(GENERAR_PDF_CONDICIONES_PORT)
    .useValue(condicionesStub)
    .compile();
  await moduleRef.init();
  prisma = moduleRef.get(PrismaService);
  useCase = moduleRef.get(ReenviarE3UseCase);
});

afterAll(async () => {
  await limpiar();
  await moduleRef.close();
});

beforeEach(async () => {
  await limpiar();
});

// ===========================================================================
// Happy path del reenvío: NUEVA COMUNICACION E3 es_reenvio=true, sin re-emitir
// la FACTURA, sin duplicar el DOCUMENTO, actualizando cond_part_enviadas_fecha y
// sin transicionar la RESERVA. Estado de BD real.
// ===========================================================================

describe('ReenviarE3 — reenvío happy path (integración real)', () => {
  it('crea una NUEVA COMUNICACION E3 es_reenvio=true, NO re-emite la FACTURA, NO duplica el DOCUMENTO, actualiza cond_part y NO transiciona la RESERVA', async () => {
    const { reservaId, facturaId, numeroFactura, fechaEmision } = await sembrarE3Enviado();

    const antes = await prisma.reserva.findUnique({ where: { idReserva: reservaId } });
    const condPartAntes = antes?.condPartEnviadasFecha;

    const res = await useCase.ejecutar(comando(reservaId));

    // Resultado: nueva fecha de envío del reenvío + comunicación es_reenvio=true.
    expect(res.condPartEnviadasFecha).toBeInstanceOf(Date);
    expect(res.comunicacion.esReenvio).toBe(true);
    expect(res.comunicacion.estado).toBe('enviado');

    // COMUNICACION E3: ahora hay 2 (la original es_reenvio=false + la nueva es_reenvio=true).
    const comunicaciones = await prisma.comunicacion.findMany({
      where: { reservaId, codigoEmail: CodigoEmail.E3 },
      orderBy: { fechaCreacion: 'asc' },
    });
    expect(comunicaciones).toHaveLength(2);
    const original = comunicaciones.find((c) => c.esReenvio === false);
    const reenvio = comunicaciones.find((c) => c.esReenvio === true);
    expect(original).toBeDefined();
    expect(original?.estado).toBe(EstadoComunicacion.enviado);
    expect(reenvio).toBeDefined();
    expect(reenvio?.estado).toBe(EstadoComunicacion.enviado);
    expect(reenvio?.idComunicacion).toBe(res.comunicacion.idComunicacion);

    // FACTURA: NO se re-emite — mismo numero_factura, misma fecha_emision, mismo estado.
    const factura = await prisma.factura.findUnique({ where: { idFactura: facturaId } });
    expect(factura?.estado).toBe(EstadoFactura.enviada);
    expect(factura?.numeroFactura).toBe(numeroFactura);
    expect(factura?.fechaEmision?.getTime()).toBe(fechaEmision.getTime());

    // DOCUMENTO de condiciones: NO se duplica — sigue habiendo exactamente 1.
    const documentos = await prisma.documento.findMany({
      where: { reservaId, tipo: TipoDocumento.condiciones_particulares },
    });
    expect(documentos).toHaveLength(1);
    expect(documentos[0].url).toBe(URL_PDF_CONDICIONES);

    // RESERVA: cond_part_enviadas_fecha se actualiza al nuevo timestamp; el estado NO transiciona.
    const reserva = await prisma.reserva.findUnique({ where: { idReserva: reservaId } });
    expect(reserva?.estado).toBe(EstadoReserva.reserva_confirmada);
    expect(reserva?.condPartFirmadas).toBe(false);
    expect(reserva?.condPartEnviadasFecha).not.toBeNull();
    expect(reserva?.condPartEnviadasFecha?.getTime()).toBe(res.condPartEnviadasFecha.getTime());
    // Se ha movido respecto al valor sembrado (nuevo envío).
    expect(reserva?.condPartEnviadasFecha?.getTime()).not.toBe(condPartAntes?.getTime());

    // AUDIT_LOG del reenvío (entidad COMUNICACION, sobre la nueva fila es_reenvio=true).
    const audit = await prisma.auditLog.findFirst({
      where: { entidadId: res.comunicacion.idComunicacion, entidad: 'COMUNICACION' },
      orderBy: { fechaCreacion: 'desc' },
    });
    expect(audit).not.toBeNull();
  });
});

// ===========================================================================
// Rollback: fallo del email → EmisionEnvioFallidoError y NADA se consolida.
// Se OVERRIDEA el puerto de reenvío (REENVIAR_E3_PORT) con una función que lanza,
// aislando la aserción del transporte fake compartido.
// ===========================================================================

describe('ReenviarE3 — rollback ante fallo del email (integración real)', () => {
  let moduleFallo: TestingModule;
  let prismaFallo: PrismaService;
  let useCaseFallo: ReenviarE3UseCase;

  const reenvioQueFalla: ReenviarE3Port = async () => {
    throw new Error('PROVEEDOR_EMAIL_CAIDO');
  };

  beforeAll(async () => {
    moduleFallo = await Test.createTestingModule({
      imports: [ConfigModule.forRoot({ isGlobal: true }), FacturacionModule],
    })
      .overrideProvider(GENERAR_PDF_CONDICIONES_PORT)
      .useValue(condicionesStub)
      // El envío de email del reenvío falla: el use-case debe abortar y no consolidar nada.
      .overrideProvider(REENVIAR_E3_PORT)
      .useValue(reenvioQueFalla)
      .compile();
    await moduleFallo.init();
    prismaFallo = moduleFallo.get(PrismaService);
    useCaseFallo = moduleFallo.get(ReenviarE3UseCase);
  });

  afterAll(async () => {
    await moduleFallo.close();
  });

  it('lanza EmisionEnvioFallidoError y NO crea la COMUNICACION es_reenvio=true ni muta la RESERVA', async () => {
    // Siembra con el prisma del módulo principal (misma BD `slotify_test`); ambos apuntan a ella.
    const { reservaId } = await sembrarE3Enviado();
    const antes = await prisma.reserva.findUnique({ where: { idReserva: reservaId } });

    await expect(useCaseFallo.ejecutar(comando(reservaId))).rejects.toBeInstanceOf(
      EmisionEnvioFallidoError,
    );

    // NO se crea la COMUNICACION de reenvío: sigue habiendo solo la original (es_reenvio=false).
    const reenvios = await prismaFallo.comunicacion.count({
      where: { reservaId, codigoEmail: CodigoEmail.E3, esReenvio: true },
    });
    expect(reenvios).toBe(0);
    const total = await prismaFallo.comunicacion.count({
      where: { reservaId, codigoEmail: CodigoEmail.E3 },
    });
    expect(total).toBe(1);

    // cond_part_enviadas_fecha intacto (no se movió).
    const despues = await prismaFallo.reserva.findUnique({ where: { idReserva: reservaId } });
    expect(despues?.condPartEnviadasFecha?.getTime()).toBe(antes?.condPartEnviadasFecha?.getTime());
    expect(despues?.estado).toBe(EstadoReserva.reserva_confirmada);
  });
});

// ===========================================================================
// RLS: reenvío sobre una reserva de OTRO tenant → no encontrada.
// ===========================================================================

describe('ReenviarE3 — aislamiento por tenant / RLS (integración real)', () => {
  it('lanza FacturaSenalNoEncontradaError para una reserva de OTRO tenant', async () => {
    const { reservaId } = await sembrarE3Enviado({ tenantId: TENANT });

    // El comando viaja con OTRO_TENANT: RLS oculta la reserva del tenant piloto.
    await expect(useCase.ejecutar(comando(reservaId, OTRO_TENANT))).rejects.toBeInstanceOf(
      FacturaSenalNoEncontradaError,
    );

    // Nada se consolida bajo el otro tenant: no aparece ninguna COMUNICACION de reenvío.
    const reenvios = await prisma.comunicacion.count({
      where: { reservaId, codigoEmail: CodigoEmail.E3, esReenvio: true },
    });
    expect(reenvios).toBe(0);
  });

  it('lanza FacturaSenalNoEncontradaError cuando la reserva no existe', async () => {
    await expect(
      useCase.ejecutar(comando('00000000-0000-0000-0000-0000000000cc')),
    ).rejects.toBeInstanceOf(FacturaSenalNoEncontradaError);
  });
});

// ===========================================================================
// Guarda de negocio: E3 aún no enviado por primera vez → E3NoEnviadoPreviamente.
// ===========================================================================

describe('ReenviarE3 — sin E3 enviado previamente (integración real)', () => {
  it('lanza E3NoEnviadoPreviamenteError cuando no existe una COMUNICACION E3 enviada previa', async () => {
    const { reservaId } = await sembrarE3Enviado({ sinE3Previa: true });

    await expect(useCase.ejecutar(comando(reservaId))).rejects.toBeInstanceOf(
      E3NoEnviadoPreviamenteError,
    );

    // No se crea ninguna COMUNICACION E3 (ni original ni reenvío).
    const total = await prisma.comunicacion.count({
      where: { reservaId, codigoEmail: CodigoEmail.E3 },
    });
    expect(total).toBe(0);
  });

  it('lanza E3NoEnviadoPreviamenteError cuando la E3 previa está en fallido (no cuenta como enviada)', async () => {
    const { reservaId } = await sembrarE3Enviado({ estadoE3Previa: EstadoComunicacion.fallido });

    await expect(useCase.ejecutar(comando(reservaId))).rejects.toBeInstanceOf(
      E3NoEnviadoPreviamenteError,
    );

    // No se añade ningún reenvío: sigue habiendo solo la E3 fallida original.
    const reenvios = await prisma.comunicacion.count({
      where: { reservaId, codigoEmail: CodigoEmail.E3, esReenvio: true },
    });
    expect(reenvios).toBe(0);
  });
});
