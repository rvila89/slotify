/**
 * TESTS del caso de uso `ObtenerFacturaLiquidacionUseCase`
 * (fix-liquidacion-fianza-independientes / UC-21) — solo lectura, espejo de
 * `obtener-factura-senal`.
 *
 * Trazabilidad: spec-delta `facturacion` ADDED "Emisión standalone…" (banner permanente
 * "Liquidación enviada el {fecha/hora}"). Deriva `e4Enviado` (COMUNICACION E4 `enviado`),
 * `esBorradorInvalido` (datos fiscales faltantes + PDF null) y `pdfPendiente` (PDF null pero
 * datos fiscales completos). Aislado por tenant (RLS).
 *
 * Dobles de puertos in-memory (hexagonal, hook `no-infra-in-domain`), sin Prisma.
 */
import {
  ObtenerFacturaLiquidacionUseCase,
  FacturaLiquidacionNoEncontradaError,
  type ObtenerFacturaLiquidacionDeps,
  type ObtenerFacturaLiquidacionComando,
  type FacturaLiquidacion,
} from '../application/obtener-factura-liquidacion.use-case';
import type {
  ReservaFacturable,
  ClienteFiscal,
} from '../application/generar-factura-senal.use-case';

const TENANT = '00000000-0000-0000-0000-000000000001';
const RESERVA_ID = 'res-conf-1';
const CLIENTE_ID = 'cli-1';
const FAC_LIQ_ID = 'fac-liq-1';

const EMISION = new Date('2026-07-20T10:00:00.000Z');

// ---------------------------------------------------------------------------
// Dobles de datos.
// ---------------------------------------------------------------------------

const reservaFacturable = (over: Partial<ReservaFacturable> = {}): ReservaFacturable => ({
  idReserva: RESERVA_ID,
  tenantId: TENANT,
  clienteId: CLIENTE_ID,
  codigo: 'SLO-2026-0028',
  estado: 'reserva_confirmada',
  importeSenal: '2733.33',
  regimenIva: 'con_iva',
  ...over,
});

const clienteCompleto = (over: Partial<ClienteFiscal> = {}): ClienteFiscal => ({
  idCliente: CLIENTE_ID,
  nombre: 'Marta',
  apellidos: 'Soler',
  dniNif: '12345678Z',
  direccion: 'Carrer Major 1',
  codigoPostal: '08000',
  poblacion: 'Barcelona',
  provincia: 'Barcelona',
  ...over,
});

const liquidacion = (over: Partial<FacturaLiquidacion> = {}): FacturaLiquidacion => ({
  idFactura: FAC_LIQ_ID,
  tenantId: TENANT,
  reservaId: RESERVA_ID,
  numeroFactura: null,
  tipo: 'liquidacion',
  estado: 'borrador',
  total: '4100.00',
  baseImponible: '3388.43',
  ivaPorcentaje: '21.00',
  ivaImporte: '711.57',
  pdfUrl: 'https://storage.local/facturas/liq.pdf',
  fechaEmision: null,
  ...over,
});

const montar = (opciones: {
  reserva?: ReservaFacturable | null;
  factura?: FacturaLiquidacion | null;
  cliente?: ClienteFiscal;
  e4Enviado?: boolean;
} = {}) => {
  const reserva = 'reserva' in opciones ? opciones.reserva : reservaFacturable();
  const factura = 'factura' in opciones ? opciones.factura : liquidacion();
  const cargarReserva = jest.fn(async () => reserva);
  const cargarLiquidacion = jest.fn(async () => factura);
  const cargarCliente = jest.fn(async () => opciones.cliente ?? clienteCompleto());
  const verificarE4Enviado = jest.fn(async () => opciones.e4Enviado ?? false);
  const deps: ObtenerFacturaLiquidacionDeps = {
    cargarReserva,
    cargarLiquidacion,
    cargarCliente,
    verificarE4Enviado,
  };
  return {
    useCase: new ObtenerFacturaLiquidacionUseCase(deps),
    cargarReserva,
    cargarLiquidacion,
    cargarCliente,
    verificarE4Enviado,
  };
};

const comando = (
  over: Partial<ObtenerFacturaLiquidacionComando> = {},
): ObtenerFacturaLiquidacionComando => ({
  tenantId: TENANT,
  reservaId: RESERVA_ID,
  ...over,
});

// ===========================================================================
// e4Enviado: derivado del puerto de verificación (banner permanente).
// ===========================================================================

describe('ObtenerFacturaLiquidacion — derivación de e4Enviado', () => {
  it('debe_derivar_e4Enviado_true_cuando_existe_COMUNICACION_E4_enviado', async () => {
    const { useCase } = montar({
      factura: liquidacion({ estado: 'enviada', numeroFactura: 'F-2026-0042', fechaEmision: EMISION }),
      e4Enviado: true,
    });

    const resultado = await useCase.ejecutar(comando());

    expect(resultado.e4Enviado).toBe(true);
    expect(resultado.fechaEmision).toEqual(EMISION);
  });

  it('debe_derivar_e4Enviado_false_cuando_aun_no_se_ha_enviado', async () => {
    const { useCase } = montar({ e4Enviado: false });

    const resultado = await useCase.ejecutar(comando());

    expect(resultado.e4Enviado).toBe(false);
  });
});

// ===========================================================================
// esBorradorInvalido / pdfPendiente: derivados de datos fiscales + pdf_url.
// ===========================================================================

describe('ObtenerFacturaLiquidacion — flags esBorradorInvalido y pdfPendiente', () => {
  it('debe_marcar_esBorradorInvalido_cuando_faltan_datos_fiscales_y_no_hay_pdf', async () => {
    const { useCase } = montar({
      factura: liquidacion({ pdfUrl: null }),
      cliente: clienteCompleto({ dniNif: null, direccion: null }),
    });

    const resultado = await useCase.ejecutar(comando());

    expect(resultado.esBorradorInvalido).toBe(true);
    expect(resultado.pdfPendiente).toBe(false);
    expect(resultado.camposFiscalesFaltantes).toEqual(
      expect.arrayContaining(['dniNif', 'direccion']),
    );
  });

  it('debe_marcar_pdfPendiente_cuando_no_hay_pdf_pero_los_datos_fiscales_estan_completos', async () => {
    const { useCase } = montar({ factura: liquidacion({ pdfUrl: null }) });

    const resultado = await useCase.ejecutar(comando());

    expect(resultado.pdfPendiente).toBe(true);
    expect(resultado.esBorradorInvalido).toBe(false);
    expect(resultado.camposFiscalesFaltantes).toHaveLength(0);
  });

  it('no_debe_marcar_ninguno_cuando_el_pdf_esta_disponible', async () => {
    const { useCase } = montar();

    const resultado = await useCase.ejecutar(comando());

    expect(resultado.esBorradorInvalido).toBe(false);
    expect(resultado.pdfPendiente).toBe(false);
  });
});

// ===========================================================================
// 404 / RLS: reserva inexistente o sin factura de liquidación.
// ===========================================================================

describe('ObtenerFacturaLiquidacion — 404 / cross-tenant', () => {
  it('debe_lanzar_FacturaLiquidacionNoEncontrada_cuando_la_reserva_no_existe', async () => {
    const { useCase } = montar({ reserva: null });

    await expect(useCase.ejecutar(comando())).rejects.toBeInstanceOf(
      FacturaLiquidacionNoEncontradaError,
    );
  });

  it('debe_lanzar_FacturaLiquidacionNoEncontrada_cuando_la_reserva_no_tiene_liquidacion', async () => {
    const { useCase } = montar({ factura: null });

    await expect(useCase.ejecutar(comando())).rejects.toBeInstanceOf(
      FacturaLiquidacionNoEncontradaError,
    );
  });
});
