/**
 * TEST DE INTEGRACIÓN — recálculo en cascada de reserva viva
 * (change reserva-viva-edicion-recalculo-ficha) — fase TDD RED. tasks.md §3.6.
 *
 * Trazabilidad: design.md §D-4 (orden transaccional), §D-5 (presupuesto modificación),
 * §D-3 (guarda ventana viva); specs/facturacion/spec.md (recálculo + regeneración);
 * specs/reserva-viva/spec.md (guarda declarativa); memoria "importe_total nunca escrito
 * → confirmar-señal 422 siempre".
 *
 * Verifica con SQL real (Postgres slotify_test) que RecalcularReservaVivaUseCase:
 *   (a) escribe importe_total e importe_liquidacion — NO sembrados con el valor final
 *   (b) NO modifica importe_senal (congelado al confirmar señal, invariante DURA)
 *   (c) crea nueva versión de PRESUPUESTO (version = MAX+1)
 *   (d) regenera la FACTURA liquidación con el nuevo importe
 *   (e) rechaza el recálculo fuera de la ventana viva (422 FueraDeVentanaVivaError)
 *
 * RED: RecalcularReservaVivaUseCase no existe →
 *   `import` falla en compilación → suite en ROJO por ausencia de implementación.
 *   GREEN es de `backend-developer`. Requiere `docker compose up -d postgres` +
 *   migración aplicada a slotify_test + seed del tenant piloto.
 *
 * Fechas propias 2029-07-XX para no colisionar con otras suites (2028-03-XX confirmación,
 * 2028-04-XX barrido fichas, etc.).
 */
import { Test, type TestingModule } from '@nestjs/testing';
import { ConfigModule } from '@nestjs/config';
import {
  CanalEntrada,
  DuracionHoras,
  EstadoFactura,
  EstadoPresupuesto,
  EstadoReserva,
  LiquidacionStatus,
  PreEventoStatus,
  TipoBloqueo,
  TipoEvento,
  TipoFactura,
} from '@prisma/client';
import { FichaEventoModule } from '../ficha-evento.module';
import { PrismaService } from '../../shared/prisma/prisma.service';
// RED: este import falla porque el módulo aún no existe
import {
  RecalcularReservaVivaUseCase,
  type RecalcularReservaVivaComando,
} from '../application/recalcular-reserva-viva.use-case';

const TENANT = '00000000-0000-0000-0000-000000000001';
const GESTOR = '00000000-0000-0000-0000-000000000002';
const EMAIL_PATTERN = '@recalculo-viva-int.test';

// Fechas de evento aisladas para esta suite (2029-07-XX)
const FECHA_HAPPY_PATH = new Date('2029-07-01T12:00:00.000Z');
const FECHA_FUERA_VENTANA = new Date('2029-07-02T12:00:00.000Z');
const FECHA_LIQUIDACION_COBRADA = new Date('2029-07-03T12:00:00.000Z');
const FECHA_FACTURA_ENVIADA = new Date('2029-07-04T12:00:00.000Z');
const FECHAS = [
  FECHA_HAPPY_PATH,
  FECHA_FUERA_VENTANA,
  FECHA_LIQUIDACION_COBRADA,
  FECHA_FACTURA_ENVIADA,
];

let moduleRef: TestingModule;
let prisma: PrismaService;
let useCase: RecalcularReservaVivaUseCase;

const sufijo = (): string => Math.random().toString(36).slice(2, 8);

/** Limpia todas las filas sembradas por esta suite (por EMAIL_PATTERN). */
const limpiar = async (): Promise<void> => {
  const clientes = await prisma.cliente.findMany({
    where: { tenantId: TENANT, email: { contains: EMAIL_PATTERN } },
    select: { idCliente: true },
  });
  const clienteIds = clientes.map((c) => c.idCliente);
  if (!clienteIds.length) return;

  const reservas = await prisma.reserva.findMany({
    where: { tenantId: TENANT, clienteId: { in: clienteIds } },
    select: { idReserva: true },
  });
  const reservaIds = reservas.map((r) => r.idReserva);

  if (reservaIds.length) {
    await prisma.comunicacion.deleteMany({ where: { reservaId: { in: reservaIds } } });
    await prisma.factura.deleteMany({ where: { reservaId: { in: reservaIds } } });
    await prisma.presupuesto.deleteMany({ where: { reservaId: { in: reservaIds } } });
    await prisma.fichaOperativa.deleteMany({ where: { reservaId: { in: reservaIds } } });
    await prisma.fechaBloqueada.deleteMany({
      where: { tenantId: TENANT, fecha: { in: FECHAS } },
    });
    await prisma.auditLog.deleteMany({ where: { entidadId: { in: reservaIds } } });
    await prisma.reserva.deleteMany({ where: { idReserva: { in: reservaIds } } });
  }
  await prisma.cliente.deleteMany({ where: { idCliente: { in: clienteIds } } });
};

/**
 * Siembra una reserva en `reserva_confirmada` con importes pre-congelados,
 * PRESUPUESTO versión 1 (aceptado), FICHA_OPERATIVA (en_curso) y FACTURA
 * liquidación (borrador). No siembra el importe_total con el valor post-recálculo
 * — el recálculo es quien lo escribe (invariante del test, memoria "importe_total
 * nunca escrito → confirmar-señal 422").
 */
const sembrarReservaConfirmada = async (params: {
  fechaEvento: Date;
  importeTotal?: string;
  importeSenal?: string;
  importeLiquidacion?: string;
  preEventoStatus?: PreEventoStatus;
  liquidacionStatus?: LiquidacionStatus;
  duracionHoras?: DuracionHoras;
  numAdultos?: number;
  numNinos?: number;
}): Promise<{ reservaId: string; idPresupuesto: string; idFacturaLiquidacion: string }> => {
  const {
    fechaEvento,
    importeTotal = '3000.00',
    importeSenal = '1200.00',
    importeLiquidacion = '1800.00',
    preEventoStatus = PreEventoStatus.en_curso,
    liquidacionStatus = LiquidacionStatus.pendiente,
    duracionHoras = DuracionHoras.h8,
    numAdultos = 30,
    numNinos = 5,
  } = params;

  const cliente = await prisma.cliente.create({
    data: {
      tenantId: TENANT,
      nombre: 'Integral',
      apellidos: 'Recalculo',
      email: `cli-${sufijo()}${EMAIL_PATTERN}`,
      telefono: '600000000',
    },
  });

  const reserva = await prisma.reserva.create({
    data: {
      tenantId: TENANT,
      clienteId: cliente.idCliente,
      codigo: `TST-RVIVA-${sufijo()}`,
      estado: EstadoReserva.reserva_confirmada,
      subEstado: null,
      canalEntrada: CanalEntrada.web,
      fechaEvento,
      duracionHoras,
      tipoEvento: TipoEvento.boda,
      numAdultosNinosMayores4: numAdultos,
      numNinosMenores4: numNinos,
      importeTotal,
      importeSenal,
      importeLiquidacion,
      preEventoStatus,
      liquidacionStatus,
    },
  });

  await prisma.fechaBloqueada.create({
    data: {
      tenantId: TENANT,
      fecha: fechaEvento,
      reservaId: reserva.idReserva,
      tipoBloqueo: TipoBloqueo.firme,
    },
  });

  const presupuesto = await prisma.presupuesto.create({
    data: {
      tenantId: TENANT,
      reservaId: reserva.idReserva,
      version: 1,
      baseImponible: (Number(importeTotal) / 1.21).toFixed(2),
      ivaPorcentaje: '21.00',
      ivaImporte: (Number(importeTotal) - Number(importeTotal) / 1.21).toFixed(2),
      total: importeTotal,
      estado: EstadoPresupuesto.aceptado,
    },
  });

  await prisma.fichaOperativa.create({
    data: {
      reservaId: reserva.idReserva,
      contactoEventoCorreo: cliente.email ?? '',
    },
  });

  const facturaLiquidacion = await prisma.factura.create({
    data: {
      tenantId: TENANT,
      reservaId: reserva.idReserva,
      tipo: TipoFactura.liquidacion,
      baseImponible: (Number(importeLiquidacion) / 1.21).toFixed(2),
      ivaPorcentaje: '21.00',
      ivaImporte: (Number(importeLiquidacion) - Number(importeLiquidacion) / 1.21).toFixed(2),
      total: importeLiquidacion,
      estado: EstadoFactura.borrador,
    },
  });

  return {
    reservaId: reserva.idReserva,
    idPresupuesto: presupuesto.idPresupuesto,
    idFacturaLiquidacion: facturaLiquidacion.idFactura,
  };
};

const comando = (
  reservaId: string,
  over: Partial<RecalcularReservaVivaComando> = {},
): RecalcularReservaVivaComando => ({
  tenantId: TENANT,
  usuarioId: GESTOR,
  reservaId,
  // precioManualEur = 5000 → tarifaAConsultar, independiente de la config de tarifa en BD
  precioManualEur: 5000,
  ...over,
});

// ─────────────────────────────────────────────────────────────────────────────
// Setup / Teardown
// ─────────────────────────────────────────────────────────────────────────────

beforeAll(async () => {
  moduleRef = await Test.createTestingModule({
    imports: [ConfigModule.forRoot({ isGlobal: true }), FichaEventoModule],
  }).compile();
  await moduleRef.init();
  prisma = moduleRef.get(PrismaService);
  useCase = moduleRef.get(RecalcularReservaVivaUseCase);
});

afterAll(async () => {
  await limpiar();
  await moduleRef.close();
});

beforeEach(async () => {
  await limpiar();
});

// ─────────────────────────────────────────────────────────────────────────────
// 3.6-A — Invariante dura: importe_senal intacto; importe_total y
//          importe_liquidacion escritos POR EL USE-CASE (no sembrados)
// ─────────────────────────────────────────────────────────────────────────────

it(
  'debe reescribir importe_total e importe_liquidacion sin tocar importe_senal',
  async () => {
    const { reservaId } = await sembrarReservaConfirmada({
      fechaEvento: FECHA_HAPPY_PATH,
      importeTotal: '3000.00',
      importeSenal: '1200.00',      // congelado al confirmar señal → NO debe cambiar
      importeLiquidacion: '1800.00', // será reemplazado por el recálculo
    });

    await useCase.ejecutar(
      comando(reservaId, { precioManualEur: 5000 }),
    );

    const reserva = await prisma.reserva.findUniqueOrThrow({
      where: { idReserva: reservaId },
    });

    // Invariante DURA: importe_senal no se toca nunca
    expect(Number(reserva.importeSenal)).toBe(1200);

    // El use-case escribió el nuevo total (era 3000, ahora es 5000)
    expect(Number(reserva.importeTotal)).toBe(5000);

    // Consistencia: liquidacion = total − senal
    expect(Number(reserva.importeLiquidacion)).toBe(
      Number(reserva.importeTotal) - Number(reserva.importeSenal),
    );
    expect(Number(reserva.importeLiquidacion)).toBe(3800);
  },
  15_000,
);

// ─────────────────────────────────────────────────────────────────────────────
// 3.6-B — Nueva versión de PRESUPUESTO de modificación creada
// ─────────────────────────────────────────────────────────────────────────────

it(
  'debe crear una segunda versión de presupuesto (version=2) con pagoInicial=importe_senal original',
  async () => {
    const { reservaId } = await sembrarReservaConfirmada({
      fechaEvento: FECHA_HAPPY_PATH,
    });

    await useCase.ejecutar(comando(reservaId, { precioManualEur: 5000 }));

    const presupuestos = await prisma.presupuesto.findMany({
      where: { reservaId },
      orderBy: { version: 'asc' },
    });

    // Debe haber exactamente 2 versiones
    expect(presupuestos).toHaveLength(2);

    const v2 = presupuestos[1];
    expect(v2.version).toBe(2);
    // El total del presupuesto de modificación = nuevo_total
    expect(Number(v2.total)).toBe(5000);
    // El presupuesto de modificación no tiene el estado 'rechazado' ni 'aceptado' aún
    expect([EstadoPresupuesto.borrador, EstadoPresupuesto.enviado]).toContain(v2.estado);

    // Verificar campo `origen = 'modificacion'` vía SQL crudo (campo nuevo post-migración)
    // El backend-developer añadirá la columna `origen` al modelo Presupuesto
    const rows = await prisma.$queryRaw<{ origen: string | null }[]>`
      SELECT origen FROM presupuesto
      WHERE reserva_id = ${reservaId} AND version = 2
      LIMIT 1
    `;
    expect(rows[0]?.origen).toBe('modificacion');
  },
  15_000,
);

// ─────────────────────────────────────────────────────────────────────────────
// 3.6-C — FACTURA liquidación regenerada con el nuevo importe
// ─────────────────────────────────────────────────────────────────────────────

it(
  'debe regenerar la factura de liquidacion con el nuevo importe_liquidacion',
  async () => {
    const { reservaId, idFacturaLiquidacion } = await sembrarReservaConfirmada({
      fechaEvento: FECHA_HAPPY_PATH,
      importeLiquidacion: '1800.00',
    });

    await useCase.ejecutar(comando(reservaId, { precioManualEur: 5000 }));

    const factura = await prisma.factura.findUniqueOrThrow({
      where: { idFactura: idFacturaLiquidacion },
    });

    // La factura fue regenerada con el nuevo importe (era 1800, ahora es 3800)
    expect(Number(factura.total)).toBe(3800);
    // Sigue siendo borrador (no cobrada) tras el recálculo
    expect(factura.estado).toBe(EstadoFactura.borrador);
  },
  15_000,
);

// ─────────────────────────────────────────────────────────────────────────────
// 3.6-D — FACTURA enviada también se regenera (no cobrada)
// ─────────────────────────────────────────────────────────────────────────────

it(
  'debe regenerar la factura de liquidacion aunque esté en estado enviada',
  async () => {
    const { reservaId, idFacturaLiquidacion } = await sembrarReservaConfirmada({
      fechaEvento: FECHA_FACTURA_ENVIADA,
      importeLiquidacion: '1800.00',
    });

    // Marcar factura como enviada antes del recálculo
    await prisma.factura.update({
      where: { idFactura: idFacturaLiquidacion },
      data: { estado: EstadoFactura.enviada },
    });

    await useCase.ejecutar(comando(reservaId, { precioManualEur: 5000 }));

    const factura = await prisma.factura.findUniqueOrThrow({
      where: { idFactura: idFacturaLiquidacion },
    });

    expect(Number(factura.total)).toBe(3800);
  },
  15_000,
);

// ─────────────────────────────────────────────────────────────────────────────
// 3.6-E — Fuera de ventana viva (ficha cerrada) → FueraDeVentanaVivaError
// ─────────────────────────────────────────────────────────────────────────────

it(
  'debe lanzar FueraDeVentanaVivaError cuando la ficha está cerrada (pre_evento_status=cerrado)',
  async () => {
    const { reservaId } = await sembrarReservaConfirmada({
      fechaEvento: FECHA_FUERA_VENTANA,
      preEventoStatus: PreEventoStatus.cerrado,
    });

    await expect(
      useCase.ejecutar(comando(reservaId, { precioManualEur: 5000 })),
    ).rejects.toMatchObject({ codigo: 'fuera_de_ventana_viva' });

    // La reserva NO fue mutada
    const reserva = await prisma.reserva.findUniqueOrThrow({
      where: { idReserva: reservaId },
    });
    expect(Number(reserva.importeTotal)).toBe(3000); // sin cambio
    expect(Number(reserva.importeSenal)).toBe(1200); // sin cambio
  },
  15_000,
);

// ─────────────────────────────────────────────────────────────────────────────
// 3.6-F — Fuera de ventana viva (liquidación cobrada) → FueraDeVentanaVivaError
// ─────────────────────────────────────────────────────────────────────────────

it(
  'debe lanzar FueraDeVentanaVivaError cuando la liquidación está cobrada',
  async () => {
    const { reservaId } = await sembrarReservaConfirmada({
      fechaEvento: FECHA_LIQUIDACION_COBRADA,
      liquidacionStatus: LiquidacionStatus.cobrada,
    });

    await expect(
      useCase.ejecutar(comando(reservaId, { precioManualEur: 5000 })),
    ).rejects.toMatchObject({ codigo: 'fuera_de_ventana_viva' });
  },
  15_000,
);
