/**
 * TESTS del caso de uso `EnviarReciboFianzaSeparadoUseCase` (US-028 / UC-22, D-3) —
 * fase TDD RED. tasks.md Fase 3: 3.6.
 *
 * Trazabilidad: US-028, spec-delta `facturacion` (Requirement "Envío del recibo de fianza
 * por separado (sin la liquidación)", escenario "El envío separado marca la fianza sin
 * tocar la liquidación"); spec-delta `comunicaciones` (Requirement "Envío del recibo de
 * fianza por separado como email manual sin código E", escenario "El envío separado del
 * recibo se registra como manual, no como E4"). design.md §D-3 (email `manual` — NO E4;
 * avanza SOLO fianza_status; queda FUERA del índice de idempotencia parcial (reserva_id,
 * codigo_email)), §D-6 (la fianza recibe su numero_factura propio al emitirse).
 *
 * Ejercita la APLICACIÓN contra DOBLES DE LOS PUERTOS (in-memory), sin tocar Prisma
 * (hexagonal, hook `no-infra-in-domain`). Fija la ORQUESTACIÓN: guarda de estado del
 * recibo (borrador), emisión de la fianza (enviada + número propio + fecha), avance de
 * fianza_status a recibo_enviado SIN tocar liquidacion_status, envío con SOLO el recibo
 * adjunto y COMUNICACION codigo_email='manual'.
 *
 * RED: aún NO existe `facturacion/application/enviar-recibo-fianza-separado.use-case.ts`.
 * El import falla y la batería está en ROJO por AUSENCIA DE IMPLEMENTACIÓN. GREEN es de
 * `backend-developer`.
 */
import {
  EnviarReciboFianzaSeparadoUseCase,
  FacturaFianzaNoEncontradaError,
  FacturaNoBorradorError,
  type EnviarReciboFianzaSeparadoDeps,
  type EnviarReciboFianzaSeparadoComando,
  type FacturaFianzaEmitible,
  type ReservaFianza,
  type RepositoriosFianzaSeparada,
  type UnidadDeTrabajoFianzaPort,
  type ClockPort,
} from '../application/enviar-recibo-fianza-separado.use-case';

const TENANT = '00000000-0000-0000-0000-000000000001';
const RESERVA_ID = 'res-conf-1';
const CLIENTE_ID = 'cli-1';
const FAC_FIANZA_ID = 'fac-fianza-1';
const USUARIO_ID = 'usr-gestor-1';

const AHORA = new Date('2026-07-04T10:00:00.000Z');
const relojFijo: ClockPort = { ahora: () => AHORA };

const fianzaBorrador = (over: Partial<FacturaFianzaEmitible> = {}): FacturaFianzaEmitible => ({
  idFactura: FAC_FIANZA_ID,
  tenantId: TENANT,
  reservaId: RESERVA_ID,
  numeroFactura: null,
  tipo: 'fianza',
  estado: 'borrador',
  total: '1000.00',
  baseImponible: '826.45',
  ivaPorcentaje: '21.00',
  ivaImporte: '173.55',
  pdfUrl: 'https://storage.local/facturas/fianza.pdf',
  fechaEmision: null,
  ...over,
});

const reservaFianza = (over: Partial<ReservaFianza> = {}): ReservaFianza => ({
  idReserva: RESERVA_ID,
  tenantId: TENANT,
  clienteId: CLIENTE_ID,
  codigo: 'SLO-2026-0028',
  liquidacionStatus: 'pendiente',
  fianzaStatus: 'pendiente',
  clienteEmail: 'marta.soler@example.com',
  ...over,
});

interface ReposFake extends RepositoriosFianzaSeparada {
  facturas: { buscarPorReservaYTipo: jest.Mock; ultimoNumeroDelAnio: jest.Mock; emitir: jest.Mock };
  reservas: { avanzarFianzaStatus: jest.Mock; avanzarLiquidacionStatus: jest.Mock };
  comunicaciones: { crear: jest.Mock };
  auditoria: { registrar: jest.Mock };
}

const crearReposFake = (opciones: {
  fianza?: FacturaFianzaEmitible | null;
  ultimoNumero?: string | null;
} = {}): ReposFake => ({
  facturas: {
    buscarPorReservaYTipo: jest.fn(async () =>
      'fianza' in opciones ? opciones.fianza : fianzaBorrador(),
    ),
    ultimoNumeroDelAnio: jest.fn(async () => opciones.ultimoNumero ?? null),
    emitir: jest.fn(async () => undefined),
  },
  reservas: {
    avanzarFianzaStatus: jest.fn(async () => undefined),
    avanzarLiquidacionStatus: jest.fn(async () => undefined),
  },
  comunicaciones: {
    crear: jest.fn(async (p: Record<string, unknown>) => ({ idComunicacion: 'com-man-1', ...p })),
  },
  auditoria: { registrar: jest.fn(async () => undefined) },
});

const crearUowFake = (
  repos: ReposFake,
): UnidadDeTrabajoFianzaPort & { ejecutar: jest.Mock } => ({
  ejecutar: jest.fn(
    async <T,>(_tenantId: string, trabajo: (r: RepositoriosFianzaSeparada) => Promise<T>) =>
      trabajo(repos),
  ),
});

const montar = (opciones: {
  fianza?: FacturaFianzaEmitible | null;
  reserva?: ReservaFianza | null;
  ultimoNumero?: string | null;
} = {}) => {
  const reserva = 'reserva' in opciones ? opciones.reserva : reservaFianza();
  const repos = crearReposFake({
    ...('fianza' in opciones ? { fianza: opciones.fianza } : {}),
    ultimoNumero: opciones.ultimoNumero,
  });
  const uow = crearUowFake(repos);
  const cargarReserva = jest.fn(async () => reserva);
  const enviarRecibo = jest.fn(async (_params: Record<string, unknown>) => ({
    idComunicacion: 'com-man-1',
    estado: 'enviado' as const,
    fechaEnvio: AHORA,
  }));
  const deps: EnviarReciboFianzaSeparadoDeps = {
    unidadDeTrabajo: uow,
    cargarReserva,
    enviarRecibo,
    clock: relojFijo,
  };
  return {
    useCase: new EnviarReciboFianzaSeparadoUseCase(deps),
    repos,
    uow,
    enviarRecibo,
    deps,
  };
};

const comando = (
  over: Partial<EnviarReciboFianzaSeparadoComando> = {},
): EnviarReciboFianzaSeparadoComando => ({
  tenantId: TENANT,
  usuarioId: USUARIO_ID,
  reservaId: RESERVA_ID,
  ...over,
});

// ===========================================================================
// 3.6 — Envío separado: fianza a enviada con número propio, fianza_status a
//        recibo_enviado, liquidacion_status intacto, COMUNICACION 'manual' (no E4).
// ===========================================================================

describe('EnviarReciboFianzaSeparado — emisión y envío del recibo (3.6)', () => {
  const anio = AHORA.getUTCFullYear();

  it('debe_emitir_la_fianza_a_enviada_con_numero_propio_y_fecha_emision', async () => {
    const { useCase, repos } = montar({ ultimoNumero: `F-${anio}-0007` });

    await useCase.ejecutar(comando());

    const args = repos.facturas.emitir.mock.calls[0][0];
    expect(args.estado).toBe('enviada');
    expect(args.numeroFactura).toBe(`F-${anio}-0008`);
    expect(args.fechaEmision).toEqual(AHORA);
  });

  it('debe_avanzar_fianza_status_a_recibo_enviado', async () => {
    const { useCase, repos } = montar();

    await useCase.ejecutar(comando());

    expect(repos.reservas.avanzarFianzaStatus).toHaveBeenCalledWith(
      expect.objectContaining({ reservaId: RESERVA_ID, estado: 'recibo_enviado' }),
    );
  });

  it('no_debe_tocar_liquidacion_status', async () => {
    const { useCase, repos } = montar();

    await useCase.ejecutar(comando());

    expect(repos.reservas.avanzarLiquidacionStatus).not.toHaveBeenCalled();
  });

  it('debe_enviar_SOLO_el_recibo_de_fianza_adjunto_al_email_del_cliente', async () => {
    const { useCase, enviarRecibo } = montar();

    await useCase.ejecutar(comando());

    expect(enviarRecibo).toHaveBeenCalledTimes(1);
    const args = enviarRecibo.mock.calls[0][0];
    expect(args.destinatario).toBe('marta.soler@example.com');
    const adjuntos = args.adjuntos as ReadonlyArray<{ pdfUrl: string }>;
    expect(adjuntos.map((a) => a.pdfUrl)).toEqual(['https://storage.local/facturas/fianza.pdf']);
  });

  it('debe_registrar_COMUNICACION_con_codigo_email_manual_y_NO_E4', async () => {
    const { useCase, repos, enviarRecibo } = montar();

    await useCase.ejecutar(comando());

    // El comando de envío usa codigo_email='manual'.
    expect(enviarRecibo.mock.calls[0][0].codigoEmail).toBe('manual');
    // La COMUNICACION registrada es 'manual', 'enviado', con fecha.
    const args = repos.comunicaciones.crear.mock.calls[0][0];
    expect(args.codigoEmail).toBe('manual');
    expect(args.codigoEmail).not.toBe('E4');
    expect(args.estado).toBe('enviado');
    expect(args.fechaEnvio).toEqual(AHORA);
    expect(args.reservaId).toBe(RESERVA_ID);
    expect(args.tenantId).toBe(TENANT);
  });

  it('debe_devolver_la_fianza_emitida_y_fianza_status_recibo_enviado', async () => {
    const { useCase } = montar({ ultimoNumero: `F-${anio}-0007` });

    const resultado = await useCase.ejecutar(comando());

    expect(resultado.fianza.estado).toBe('enviada');
    expect(resultado.fianza.numeroFactura).toBe(`F-${anio}-0008`);
    expect(resultado.fianzaStatus).toBe('recibo_enviado');
  });
});

// ===========================================================================
// 3.6 — Guardas: recibo no en borrador (409); recibo/reserva inexistente (404).
// ===========================================================================

describe('EnviarReciboFianzaSeparado — guardas de estado (3.6)', () => {
  it('debe_rechazar_con_FacturaNoBorrador_cuando_el_recibo_ya_esta_enviado', async () => {
    const { useCase, repos } = montar({
      fianza: fianzaBorrador({ estado: 'enviada', numeroFactura: 'F-2026-0009' }),
    });

    await expect(useCase.ejecutar(comando())).rejects.toBeInstanceOf(FacturaNoBorradorError);
    expect(repos.facturas.emitir).not.toHaveBeenCalled();
  });

  it('debe_rechazar_con_FacturaFianzaNoEncontrada_cuando_no_hay_recibo_de_fianza', async () => {
    const { useCase } = montar({ fianza: null });

    await expect(useCase.ejecutar(comando())).rejects.toBeInstanceOf(
      FacturaFianzaNoEncontradaError,
    );
  });

  it('debe_rechazar_con_FacturaFianzaNoEncontrada_cuando_la_reserva_no_existe_en_el_tenant', async () => {
    const { useCase } = montar({ reserva: null });

    await expect(useCase.ejecutar(comando())).rejects.toBeInstanceOf(
      FacturaFianzaNoEncontradaError,
    );
  });
});
