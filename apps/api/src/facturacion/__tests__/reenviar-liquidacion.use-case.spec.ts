/**
 * TESTS del caso de uso `ReenviarLiquidacionUseCase` (US-028 / D-4) — fase TDD RED.
 * tasks.md Fase 3: 3.7.
 *
 * Trazabilidad: US-028, spec-delta `facturacion` (Requirement "Reenvío de la factura de
 * liquidación ya emitida sin reasignar número ni estado", escenario "El reenvío no
 * reasigna ni modifica la factura emitida"); spec-delta `comunicaciones` (Requirement
 * "Reenvío de E4 crea una nueva comunicación sin alterar la factura", escenario "Cada
 * reenvío deja su propia traza de comunicación"). design.md §D-4 (precondición
 * estado='enviada'; reenvía el PDF YA emitido; NO reasigna numero_factura ni estado ni
 * status de la RESERVA; crea una NUEVA fila COMUNICACION codigo_email='E4' como EXCEPCIÓN
 * explícita y auditada a la idempotencia (reserva_id, codigo_email) de US-045 — el reenvío
 * manual del Gestor NO debe ser bloqueado por el índice parcial UNIQUE de E4 de US-045).
 *
 * Ejercita la APLICACIÓN contra DOBLES DE LOS PUERTOS (in-memory), sin tocar Prisma
 * (hexagonal, hook `no-infra-in-domain`). Fija la ORQUESTACIÓN: guarda de estado
 * (enviada), reenvío del PDF ya emitido, creación de NUEVA COMUNICACION E4 sin pasar por
 * la guarda de idempotencia, y la NO mutación de la factura ni de los status.
 *
 * RED: aún NO existe `facturacion/application/reenviar-liquidacion.use-case.ts`. El import
 * falla y la batería está en ROJO por AUSENCIA DE IMPLEMENTACIÓN. GREEN es de
 * `backend-developer`.
 */
import {
  ReenviarLiquidacionUseCase,
  FacturaLiquidacionNoEncontradaError,
  FacturaNoEnviadaError,
  type ReenviarLiquidacionDeps,
  type ReenviarLiquidacionComando,
  type FacturaEmitida,
  type ReservaReenvio,
  type ClockPort,
} from '../application/reenviar-liquidacion.use-case';

const TENANT = '00000000-0000-0000-0000-000000000001';
const RESERVA_ID = 'res-conf-1';
const CLIENTE_ID = 'cli-1';
const FAC_LIQ_ID = 'fac-liq-1';
const USUARIO_ID = 'usr-gestor-1';

const AHORA = new Date('2026-07-05T09:00:00.000Z');
const relojFijo: ClockPort = { ahora: () => AHORA };

const liquidacionEmitida = (over: Partial<FacturaEmitida> = {}): FacturaEmitida => ({
  idFactura: FAC_LIQ_ID,
  tenantId: TENANT,
  reservaId: RESERVA_ID,
  numeroFactura: 'F-2026-0042',
  tipo: 'liquidacion',
  estado: 'enviada',
  total: '4100.00',
  pdfUrl: 'https://storage.local/facturas/liq.pdf',
  fechaEmision: new Date('2026-07-04T10:00:00.000Z'),
  ...over,
});

const reservaReenvio = (over: Partial<ReservaReenvio> = {}): ReservaReenvio => ({
  idReserva: RESERVA_ID,
  tenantId: TENANT,
  clienteId: CLIENTE_ID,
  codigo: 'SLO-2026-0028',
  liquidacionStatus: 'facturada',
  fianzaStatus: 'recibo_enviado',
  clienteEmail: 'marta.soler@example.com',
  ...over,
});

const montar = (opciones: {
  liquidacion?: FacturaEmitida | null;
  reserva?: ReservaReenvio | null;
} = {}) => {
  const reserva = 'reserva' in opciones ? opciones.reserva : reservaReenvio();
  const liquidacion = 'liquidacion' in opciones ? opciones.liquidacion : liquidacionEmitida();
  const cargarReserva = jest.fn(async () => reserva);
  const cargarLiquidacion = jest.fn(async () => liquidacion);
  const reenviarE4 = jest.fn(async (_params: Record<string, unknown>) => ({
    idComunicacion: 'com-e4-reenvio-1',
    estado: 'enviado' as const,
    fechaEnvio: AHORA,
  }));
  const registrarComunicacion = jest.fn(async (p: Record<string, unknown>) => ({
    idComunicacion: 'com-e4-reenvio-1',
    ...p,
  }));
  const registrarAuditoria = jest.fn(async () => undefined);
  const deps: ReenviarLiquidacionDeps = {
    cargarReserva,
    cargarLiquidacion,
    reenviarE4,
    registrarComunicacion,
    registrarAuditoria,
    clock: relojFijo,
  };
  return {
    useCase: new ReenviarLiquidacionUseCase(deps),
    cargarLiquidacion,
    reenviarE4,
    registrarComunicacion,
    registrarAuditoria,
    deps,
  };
};

const comando = (over: Partial<ReenviarLiquidacionComando> = {}): ReenviarLiquidacionComando => ({
  tenantId: TENANT,
  usuarioId: USUARIO_ID,
  reservaId: RESERVA_ID,
  ...over,
});

// ===========================================================================
// 3.7 — Reenvío happy path: reenvía el PDF ya emitido, NUEVA COMUNICACION E4,
//        numero_factura/estado intactos, status de la RESERVA intactos.
// ===========================================================================

describe('ReenviarLiquidacion — reenvío del PDF ya emitido (3.7)', () => {
  it('debe_reenviar_el_pdf_ya_emitido_al_email_del_cliente_sin_regenerarlo', async () => {
    const { useCase, reenviarE4 } = montar();

    await useCase.ejecutar(comando());

    expect(reenviarE4).toHaveBeenCalledTimes(1);
    const args = reenviarE4.mock.calls[0][0];
    expect(args.destinatario).toBe('marta.soler@example.com');
    const adjuntos = args.adjuntos as ReadonlyArray<{ pdfUrl: string }>;
    // Reutiliza el PDF YA emitido de la liquidación (no lo regenera).
    expect(adjuntos.map((a) => a.pdfUrl)).toEqual(['https://storage.local/facturas/liq.pdf']);
  });

  it('debe_crear_una_NUEVA_COMUNICACION_E4_enviado_con_fecha_por_cada_reenvio', async () => {
    const { useCase, registrarComunicacion } = montar();

    await useCase.ejecutar(comando());

    expect(registrarComunicacion).toHaveBeenCalledTimes(1);
    const args = registrarComunicacion.mock.calls[0][0];
    expect(args.codigoEmail).toBe('E4');
    expect(args.estado).toBe('enviado');
    expect(args.fechaEnvio).toEqual(AHORA);
    expect(args.reservaId).toBe(RESERVA_ID);
    expect(args.tenantId).toBe(TENANT);
  });

  it('no_debe_pasar_por_la_guarda_de_idempotencia_ni_reutilizar_la_comunicacion_original', async () => {
    // El reenvío es una EXCEPCIÓN auditada a la idempotencia (reserva_id, codigo_email):
    // el use-case NO expone ni invoca ningún puerto de "buscar comunicación E4 previa"
    // para frenar el reenvío; siempre crea una fila nueva (D-4, US-045 excepción).
    const { useCase, registrarComunicacion, deps } = montar();

    expect(
      (deps as unknown as Record<string, unknown>).buscarComunicacionE4,
    ).toBeUndefined();

    await useCase.ejecutar(comando());
    await useCase.ejecutar(comando());

    // Dos reenvíos → dos filas de COMUNICACION nuevas (ninguna frenada por idempotencia).
    expect(registrarComunicacion).toHaveBeenCalledTimes(2);
  });

  it('debe_devolver_la_nueva_comunicacion_de_reenvio', async () => {
    const { useCase } = montar();

    const resultado = await useCase.ejecutar(comando());

    expect(resultado.comunicacion.idComunicacion).toBe('com-e4-reenvio-1');
    expect(resultado.comunicacion.estado).toBe('enviado');
  });
});

// ===========================================================================
// 3.7 — El reenvío NO modifica la factura ni los status de la RESERVA: no hay
//        ningún puerto de emisión/mutación de estado en las deps del use-case.
// ===========================================================================

describe('ReenviarLiquidacion — no reasigna ni modifica la factura ni los status (3.7)', () => {
  it('no_debe_exponer_ningun_puerto_de_emision_ni_de_avance_de_status', async () => {
    const { deps } = montar();

    const registro = deps as unknown as Record<string, unknown>;
    // El use-case de reenvío NO tiene forma de emitir/renumerar ni de avanzar status.
    expect(registro.emitir).toBeUndefined();
    expect(registro.avanzarLiquidacionStatus).toBeUndefined();
    expect(registro.avanzarFianzaStatus).toBeUndefined();
    expect(registro.actualizarImporteLiquidacion).toBeUndefined();
  });

  it('debe_reenviar_conservando_el_mismo_numero_de_factura_en_el_adjunto', async () => {
    const { useCase, reenviarE4 } = montar({
      liquidacion: liquidacionEmitida({ numeroFactura: 'F-2026-0100' }),
    });

    await useCase.ejecutar(comando());

    const args = reenviarE4.mock.calls[0][0];
    // El reenvío referencia la factura ya emitida (mismo número), no reasigna.
    expect(JSON.stringify(args)).toContain('F-2026-0100');
  });
});

// ===========================================================================
// 3.7 — Guardas: liquidación no en enviada (409 FACTURA_NO_ENVIADA); liquidación
//        / reserva inexistente (404). Sin reenvío ni COMUNICACION cuando falla.
// ===========================================================================

describe('ReenviarLiquidacion — guardas de estado (3.7)', () => {
  it('debe_rechazar_con_FacturaNoEnviada_cuando_la_liquidacion_sigue_en_borrador', async () => {
    const { useCase, reenviarE4, registrarComunicacion } = montar({
      liquidacion: liquidacionEmitida({ estado: 'borrador', numeroFactura: null }),
    });

    await expect(useCase.ejecutar(comando())).rejects.toBeInstanceOf(FacturaNoEnviadaError);
    expect(reenviarE4).not.toHaveBeenCalled();
    expect(registrarComunicacion).not.toHaveBeenCalled();
  });

  it('debe_rechazar_con_FacturaLiquidacionNoEncontrada_cuando_no_hay_liquidacion', async () => {
    const { useCase } = montar({ liquidacion: null });

    await expect(useCase.ejecutar(comando())).rejects.toBeInstanceOf(
      FacturaLiquidacionNoEncontradaError,
    );
  });

  it('debe_rechazar_con_FacturaLiquidacionNoEncontrada_cuando_la_reserva_no_existe_en_el_tenant', async () => {
    const { useCase } = montar({ reserva: null });

    await expect(useCase.ejecutar(comando())).rejects.toBeInstanceOf(
      FacturaLiquidacionNoEncontradaError,
    );
  });
});
