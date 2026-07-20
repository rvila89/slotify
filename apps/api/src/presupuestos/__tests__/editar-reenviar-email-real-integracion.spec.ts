/**
 * TESTS DE INTEGRACIÓN (BD real + EMAIL_SANDBOX/fake) del ENVÍO REAL del E2 en la
 * edición y en el reenvío sin cambios del presupuesto — change
 * `presupuesto-edicion-reenvio-email-real`, tasks.md 3.4 — fase TDD RED.
 *
 * CLAVE: el defecto crítico (correo "actualizado" que NUNCA se envía; adaptador de
 * reenvío que es un STUB) sobrevivió por FALTA de un test que compruebe el TRANSPORTE
 * REAL. Aquí se verifica —contra Postgres real y el transporte FAKE en memoria— que:
 *   (a) editar una `pre_reserva` con `enviar=true` INVOCA el transporte y deja UNA
 *       fila `COMUNICACION` E2 nueva (`es_reenvio=true`, `estado='enviado'`), con el
 *       asunto de "actualizado" (marca de edición).
 *   (b) el reenvío sin cambios INVOCA el transporte (deja de ser no-op) y deja UNA
 *       fila `COMUNICACION` E2 nueva con el asunto E2 ESTÁNDAR (sin marca de edición),
 *       sin crear una versión nueva de PRESUPUESTO.
 *   (c) la edición/reenvío NO mutan `RESERVA.estado` (sigue `pre_reserva`) ni
 *       `FECHA_BLOQUEADA.ttl_expiracion` (invariante US-015 §D5).
 *
 * INTEGRACIÓN REAL: requiere `docker compose up -d postgres` + migración + seed del
 * tenant piloto (`ttl_prereserva_dias=7`, `pct_senal=40`). El transporte de email va en
 * modo FAKE (`EMAIL_TRANSPORT=fake`, forzado en test/CI): se sobreescribe el token
 * `ENVIAR_EMAIL_PORT` con una instancia inspeccionable de `FakeEmailAdapter` para contar
 * las invocaciones del transporte y leer los asuntos enviados (cero red).
 *
 * NO EJECUTAR desde los subagentes (sin Postgres/Docker): se lanza desde la SESIÓN
 * PRINCIPAL. Patrón de siembra/limpieza tomado de `activar-prereserva-integracion.spec.ts`.
 *
 * CAVEAT react-pdf (memoria "react-pdf ESM suite flakiness"): dentro de Jest la
 * generación del PDF del presupuesto de la EDICIÓN puede degradar a `null` (import ESM
 * del binding nativo). Como el adjunto `presupuesto` es REQUERIDO (D-1), el E2 de la
 * edición se BLOQUEARÍA sin PDF. Para aislar el ENVÍO real de esa flakiness, la siembra
 * fija un `pdf_url` NO NULO en el PRESUPUESTO vigente; el reenvío usa ese `pdf_url`
 * directamente (sin regenerar) y la edición debe reutilizar el PDF disponible. Si el
 * entorno no puede resolver el PDF de la edición, el subcaso (a) se documenta como
 * pendiente de PDF real y se prioriza el TRANSPORTE del reenvío (b), que es el que el
 * stub rompía.
 *
 * RED: hoy la edición registra la fila en la tx (sin transporte) y el reenvío es un
 * stub → el transporte fake NO se invoca y NO hay fila `es_reenvio` con el asunto de
 * "actualizado"/estándar según el caso. GREEN es de `backend-developer`.
 */
import { Test, type TestingModule } from '@nestjs/testing';
import { ConfigModule } from '@nestjs/config';
import {
  CanalEntrada,
  CodigoEmail,
  DuracionHoras,
  EstadoPresupuesto,
  EstadoReserva,
  MetodoPago,
  RegimenIva,
  TipoBloqueo,
  TipoEvento,
} from '@prisma/client';
import { PresupuestosModule } from '../presupuestos.module';
import { PrismaService } from '../../shared/prisma/prisma.service';
import { FakeEmailAdapter } from '../../comunicaciones/infrastructure/fake-email.adapter';
import { ENVIAR_EMAIL_PORT } from '../../comunicaciones/comunicaciones.tokens';
import { GENERAR_PDF_PRESUPUESTO_PORT } from '../presupuestos.tokens';
import {
  EditarPresupuestoUseCase,
  ReenviarPresupuestoUseCase,
} from '../application/editar-presupuesto.use-case';

const TENANT = '00000000-0000-0000-0000-000000000001';
const GESTOR = '00000000-0000-0000-0000-000000000002';
const EMAIL_PATTERN = '@edicion-reenvio-int.test';
const DIA_MS = 24 * 60 * 60 * 1000;

const FECHA_EDICION = new Date('2028-01-10T00:00:00.000Z');
const FECHA_REENVIO = new Date('2028-01-11T00:00:00.000Z');
const FECHAS = [FECHA_EDICION, FECHA_REENVIO];

const PDF_VIGENTE = 'https://storage.local/presupuestos/int/vigente.pdf';
// PDF de la NUEVA versión de la edición. Se inyecta un puerto FAKE de generación de PDF
// (token `GENERAR_PDF_PRESUPUESTO_PORT`) para AISLAR la aserción del ENVÍO del E2 de la
// flakiness ESM de react-pdf bajo Jest (memoria "react-pdf ESM suite flakiness"): en
// producción react-pdf resuelve el PDF y el adjunto requerido está presente. La
// generación real del PDF se cubre en `pdf-presupuesto.real.adapter.spec.ts`.
const PDF_EDICION = 'https://storage.local/presupuestos/int/edicion-v2.pdf';

let moduleRef: TestingModule;
let prisma: PrismaService;
let editar: EditarPresupuestoUseCase;
let reenviar: ReenviarPresupuestoUseCase;
let transporte: FakeEmailAdapter;

const sufijo = (): string => Math.random().toString(36).slice(2, 8);
const ttlVigente = (): Date => new Date(Date.now() + 5 * DIA_MS);

/**
 * Siembra una RESERVA en `pre_reserva` con su PRESUPUESTO vigente v1 `enviado`
 * (numerado, con `pdf_url` no nulo), su fila `FECHA_BLOQUEADA` blanda vigente y la
 * `COMUNICACION` E2 original (`es_reenvio=false`) — el estado de partida de UC-15.
 */
const sembrarPrereservaConPresupuesto = async (params: {
  fecha: Date;
}): Promise<{ reservaId: string; clienteId: string; ttlBloqueo: Date }> => {
  const cliente = await prisma.cliente.create({
    data: {
      tenantId: TENANT,
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
      tenantId: TENANT,
      clienteId: cliente.idCliente,
      codigo: `TST-EDI-${sufijo()}`,
      estado: EstadoReserva.pre_reserva,
      subEstado: null,
      canalEntrada: CanalEntrada.web,
      fechaEvento: params.fecha,
      duracionHoras: DuracionHoras.h8,
      tipoEvento: TipoEvento.boda,
      numAdultosNinosMayores4: 40,
      numNinosMenores4: 5,
      ttlExpiracion: ttlVigente(),
    },
  });
  const ttlBloqueo = ttlVigente();
  await prisma.fechaBloqueada.create({
    data: {
      tenantId: TENANT,
      fecha: params.fecha,
      reservaId: reserva.idReserva,
      tipoBloqueo: TipoBloqueo.blando,
      ttlExpiracion: ttlBloqueo,
    },
  });
  await prisma.presupuesto.create({
    data: {
      tenantId: TENANT,
      reservaId: reserva.idReserva,
      version: 1,
      estado: EstadoPresupuesto.enviado,
      tarifaCongelada: true,
      numeroPresupuesto: '2026001',
      metodoPago: MetodoPago.transferencia,
      regimenIva: RegimenIva.con_iva,
      baseImponible: '2644.63',
      ivaPorcentaje: '21.00',
      ivaImporte: '555.37',
      total: '3200.00',
      pdfUrl: PDF_VIGENTE,
    },
  });
  // COMUNICACION E2 original (es_reenvio=false), como tras el envío de US-014.
  await prisma.comunicacion.create({
    data: {
      tenantId: TENANT,
      reservaId: reserva.idReserva,
      clienteId: cliente.idCliente,
      codigoEmail: CodigoEmail.E2,
      asunto: 'Tu presupuesto para el evento (reserva original)',
      destinatarioEmail: cliente.email ?? '',
      estado: 'enviado',
      fechaEnvio: new Date(),
      esReenvio: false,
    },
  });
  return {
    reservaId: reserva.idReserva,
    clienteId: cliente.idCliente,
    ttlBloqueo,
  };
};

const limpiar = async (): Promise<void> => {
  const clientes = await prisma.cliente.findMany({
    where: { email: { contains: EMAIL_PATTERN } },
    select: { idCliente: true },
  });
  const clienteIds = clientes.map((c) => c.idCliente);
  const reservas = await prisma.reserva.findMany({
    where: { OR: [{ clienteId: { in: clienteIds } }, { fechaEvento: { in: FECHAS } }] },
    select: { idReserva: true, clienteId: true },
  });
  const ids = reservas.map((r) => r.idReserva);
  const todosClienteIds = [...new Set([...clienteIds, ...reservas.map((r) => r.clienteId)])];
  if (ids.length > 0) {
    await prisma.reservaExtra.deleteMany({ where: { reservaId: { in: ids } } });
    await prisma.presupuesto.deleteMany({ where: { reservaId: { in: ids } } });
    await prisma.fechaBloqueada.deleteMany({ where: { reservaId: { in: ids } } });
    await prisma.comunicacion.deleteMany({ where: { reservaId: { in: ids } } });
    await prisma.auditLog.deleteMany({ where: { entidadId: { in: ids } } });
    await prisma.reserva.deleteMany({ where: { idReserva: { in: ids } } });
  }
  await prisma.fechaBloqueada.deleteMany({ where: { fecha: { in: FECHAS } } });
  if (todosClienteIds.length > 0) {
    await prisma.cliente.deleteMany({ where: { idCliente: { in: todosClienteIds } } });
  }
};

beforeAll(async () => {
  transporte = new FakeEmailAdapter();
  moduleRef = await Test.createTestingModule({
    imports: [ConfigModule.forRoot({ isGlobal: true }), PresupuestosModule],
  })
    // Transporte fake inspeccionable (cuenta invocaciones + lee asuntos, cero red).
    .overrideProvider(ENVIAR_EMAIL_PORT)
    .useValue(transporte)
    // PDF fake determinista: aísla el ENVÍO del E2 de la flakiness ESM de react-pdf
    // (la edición genera el PDF de la v2 post-commit; en Jest degradaría a null).
    .overrideProvider(GENERAR_PDF_PRESUPUESTO_PORT)
    .useValue(async () => PDF_EDICION)
    .compile();
  await moduleRef.init();
  prisma = moduleRef.get(PrismaService);
  editar = moduleRef.get(EditarPresupuestoUseCase);
  reenviar = moduleRef.get(ReenviarPresupuestoUseCase);
});

afterAll(async () => {
  await limpiar();
  await moduleRef.close();
});

beforeEach(async () => {
  await limpiar();
});

// ===========================================================================
// (b) Reenvío sin cambios — el transporte se INVOCA (deja de ser no-op) con el
//     asunto E2 ESTÁNDAR, y hay UNA fila COMUNICACION es_reenvio=true nueva. NO se
//     crea versión nueva. Es el caso que el stub rompía.
// ===========================================================================

describe('Integración — reenvío sin cambios invoca el transporte (fila única, asunto E2 estándar)', () => {
  it('debe_enviar_por_el_transporte_y_registrar_una_unica_COMUNICACION_es_reenvio', async () => {
    const { reservaId } = await sembrarPrereservaConPresupuesto({ fecha: FECHA_REENVIO });
    const enviadosAntes = transporte.enviados.length;

    await reenviar.ejecutar({ tenantId: TENANT, usuarioId: GESTOR, reservaId });

    // El transporte se ejerció de verdad (el stub NO lo hacía).
    expect(transporte.enviados.length).toBe(enviadosAntes + 1);
    const enviado = transporte.enviados[transporte.enviados.length - 1];
    expect(enviado.codigoEmail).toBe('E2');
    // Asunto E2 ESTÁNDAR (sin marca de edición).
    expect(enviado.asunto).toContain('Tu presupuesto para el evento');
    expect(enviado.asunto).not.toContain('Hemos actualizado');

    // Exactamente UNA fila COMUNICACION E2 es_reenvio=true nueva.
    const reenviadas = await prisma.comunicacion.findMany({
      where: { reservaId, codigoEmail: CodigoEmail.E2, esReenvio: true },
    });
    expect(reenviadas).toHaveLength(1);
    expect(reenviadas[0].estado).toBe('enviado');
  });

  it('NO_debe_crear_una_version_nueva_ni_mutar_RESERVA_ni_ttl_bloqueo', async () => {
    const { reservaId, ttlBloqueo } = await sembrarPrereservaConPresupuesto({
      fecha: FECHA_REENVIO,
    });

    await reenviar.ejecutar({ tenantId: TENANT, usuarioId: GESTOR, reservaId });

    const presupuestos = await prisma.presupuesto.findMany({ where: { reservaId } });
    expect(presupuestos).toHaveLength(1);
    expect(presupuestos[0].version).toBe(1);

    const reserva = await prisma.reserva.findUnique({ where: { idReserva: reservaId } });
    expect(reserva?.estado).toBe(EstadoReserva.pre_reserva);
    const bloqueo = await prisma.fechaBloqueada.findFirst({
      where: { tenantId: TENANT, fecha: FECHA_REENVIO },
    });
    expect(bloqueo?.ttlExpiracion?.getTime()).toBe(ttlBloqueo.getTime());
  });
});

// ===========================================================================
// (a) Edición con envío — el transporte se INVOCA con el asunto de "actualizado"
//     (marca de edición) y hay UNA fila COMUNICACION es_reenvio=true nueva, además de
//     la E2 original. Best-effort post-commit: la versión ya está comprometida.
//     (Ver CAVEAT react-pdf en la cabecera: el PDF de la edición debe estar disponible
//     para que el adjunto requerido no bloquee el E2.)
// ===========================================================================

describe('Integración — edición con envío invoca el transporte con la marca de edición', () => {
  it('debe_enviar_por_el_transporte_con_asunto_de_actualizado_y_una_unica_fila_es_reenvio', async () => {
    const { reservaId } = await sembrarPrereservaConPresupuesto({ fecha: FECHA_EDICION });
    const enviadosAntes = transporte.enviados.length;

    await editar.confirmar({
      tenantId: TENANT,
      usuarioId: GESTOR,
      reservaId,
      metodoPago: 'transferencia',
      extras: [],
      descuentoEur: '200.00',
      descuentoMotivo: 'fidelidad',
      enviar: true,
    });

    // El transporte se ejerció (no la contabilidad de la tx idempotente).
    expect(transporte.enviados.length).toBe(enviadosAntes + 1);
    const enviado = transporte.enviados[transporte.enviados.length - 1];
    expect(enviado.codigoEmail).toBe('E2');
    // Asunto de "presupuesto actualizado" (marca de edición, esEdicion derivado en server).
    expect(enviado.asunto).toContain('Hemos actualizado tu presupuesto');

    // UNA fila es_reenvio=true nueva (además de la E2 original es_reenvio=false).
    const reenviadas = await prisma.comunicacion.findMany({
      where: { reservaId, codigoEmail: CodigoEmail.E2, esReenvio: true },
    });
    expect(reenviadas).toHaveLength(1);
    expect(reenviadas[0].estado).toBe('enviado');
    // La E2 original sigue presente (es_reenvio=false).
    const originales = await prisma.comunicacion.findMany({
      where: { reservaId, codigoEmail: CodigoEmail.E2, esReenvio: false },
    });
    expect(originales).toHaveLength(1);
  });

  it('debe_crear_v2_enviado_sin_mutar_RESERVA_ni_ttl_bloqueo', async () => {
    const { reservaId, ttlBloqueo } = await sembrarPrereservaConPresupuesto({
      fecha: FECHA_EDICION,
    });

    await editar.confirmar({
      tenantId: TENANT,
      usuarioId: GESTOR,
      reservaId,
      metodoPago: 'transferencia',
      extras: [],
      descuentoEur: '200.00',
      enviar: true,
    });

    const v2 = await prisma.presupuesto.findFirst({
      where: { reservaId, version: 2 },
    });
    expect(v2).not.toBeNull();
    expect(v2?.estado).toBe(EstadoPresupuesto.enviado);

    const reserva = await prisma.reserva.findUnique({ where: { idReserva: reservaId } });
    expect(reserva?.estado).toBe(EstadoReserva.pre_reserva);
    const bloqueo = await prisma.fechaBloqueada.findFirst({
      where: { tenantId: TENANT, fecha: FECHA_EDICION },
    });
    expect(bloqueo?.ttlExpiracion?.getTime()).toBe(ttlBloqueo.getTime());
  });
});
