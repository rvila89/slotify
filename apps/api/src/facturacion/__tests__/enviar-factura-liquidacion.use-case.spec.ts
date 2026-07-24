/**
 * TESTS del caso de uso `EnviarFacturaLiquidacionUseCase`
 * (fix-liquidacion-fianza-independientes / UC-21) — flujo STANDALONE espejo de la señal.
 *
 * Trazabilidad: spec-delta `facturacion` ADDED "Emisión standalone de la factura de
 * liquidación (flujo espejo de la señal)"; design.md §D-1. E4 = SOLO liquidación (no toca la
 * fianza). Acción ÚNICA y ATÓMICA estado↔E4: emite (borrador → enviada, asigna número +
 * fecha_emision), avanza `liquidacion_status='facturada'`, marca RESERVA_EXTRA, registra
 * COMUNICACION E4 + AUDIT_LOG, SOLO si E4 se confirma. Si E4 falla → rollback total.
 *
 * Ejercita la APLICACIÓN contra DOBLES DE LOS PUERTOS (in-memory), sin tocar Prisma
 * (hexagonal, hook `no-infra-in-domain`). El reloj se inyecta (determinismo).
 */
import {
  EnviarFacturaLiquidacionUseCase,
  FacturaLiquidacionNoEncontradaError,
  FacturaNoBorradorError,
  EmisionEnvioFallidoError,
  type EnviarFacturaLiquidacionDeps,
  type EnviarFacturaLiquidacionComando,
  type FacturaLiquidacionEmitible,
  type ReservaLiquidacionEmision,
  type RepositoriosLiquidacionEmision,
  type UnidadDeTrabajoLiquidacionEmisionPort,
  type ClockPort,
} from '../application/enviar-factura-liquidacion.use-case';

const TENANT = '00000000-0000-0000-0000-000000000001';
const RESERVA_ID = 'res-conf-1';
const CLIENTE_ID = 'cli-1';
const FAC_LIQ_ID = 'fac-liq-1';
const USUARIO_ID = 'usr-gestor-1';

const AHORA = new Date('2026-07-20T10:00:00.000Z');
const relojFijo: ClockPort = { ahora: () => AHORA };

// ---------------------------------------------------------------------------
// Dobles de datos: FACTURA(liquidacion) en borrador (numero_factura NULL, PDF
// disponible) y RESERVA con la fianza sin tocar.
// ---------------------------------------------------------------------------

const liquidacionBorrador = (
  over: Partial<FacturaLiquidacionEmitible> = {},
): FacturaLiquidacionEmitible => ({
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

const reservaEmision = (
  over: Partial<ReservaLiquidacionEmision> = {},
): ReservaLiquidacionEmision => ({
  idReserva: RESERVA_ID,
  tenantId: TENANT,
  clienteId: CLIENTE_ID,
  codigo: 'SLO-2026-0028',
  liquidacionStatus: 'pendiente',
  fianzaStatus: 'pendiente',
  clienteEmail: 'marta.soler@example.com',
  idioma: 'ca',
  clienteNombre: 'Marta',
  clienteApellidos: 'Soler',
  fianzaEur: '500.00',
  // change condiciones-…-liquidacion: gobierna el recordatorio condicional de E4. El campo
  // aún no existe en `ReservaLiquidacionEmision` (RED); se añade vía cast.
  ...(({ condPartFirmadas: false }) as unknown as Partial<ReservaLiquidacionEmision>),
  ...over,
});

// ---------------------------------------------------------------------------
// Repositorios + UoW fake. La consolidación (emisión + status + extras +
// COMUNICACION + AUDIT_LOG) SOLO ocurre si E4 confirma.
// ---------------------------------------------------------------------------

interface ReposFake extends RepositoriosLiquidacionEmision {
  facturas: {
    buscarPorReservaYTipo: jest.Mock;
    ultimoNumeroDelAnio: jest.Mock;
    emitir: jest.Mock;
  };
  reservas: { avanzarLiquidacionStatus: jest.Mock };
  extras: { marcarConFactura: jest.Mock };
  comunicaciones: { crear: jest.Mock };
  auditoria: { registrar: jest.Mock };
}

const crearReposFake = (opciones: {
  liquidacion?: FacturaLiquidacionEmitible | null;
  ultimoNumero?: string | null;
} = {}): ReposFake => ({
  facturas: {
    buscarPorReservaYTipo: jest.fn(async (_reservaId: string, tipo: string) => {
      if (tipo === 'liquidacion') {
        return 'liquidacion' in opciones ? opciones.liquidacion : liquidacionBorrador();
      }
      return null;
    }),
    ultimoNumeroDelAnio: jest.fn(async () => opciones.ultimoNumero ?? null),
    emitir: jest.fn(async () => undefined),
  },
  reservas: { avanzarLiquidacionStatus: jest.fn(async () => undefined) },
  extras: { marcarConFactura: jest.fn(async () => undefined) },
  comunicaciones: {
    crear: jest.fn(async (p: Record<string, unknown>) => ({
      idComunicacion: 'com-e4-1',
      estado: 'enviado',
      fechaEnvio: AHORA,
      ...p,
    })),
  },
  auditoria: { registrar: jest.fn(async () => undefined) },
});

const crearUowFake = (
  repos: ReposFake,
): UnidadDeTrabajoLiquidacionEmisionPort & { ejecutar: jest.Mock } => ({
  ejecutar: jest.fn(
    async <T,>(_tenantId: string, trabajo: (r: RepositoriosLiquidacionEmision) => Promise<T>) =>
      trabajo(repos),
  ),
});

const montar = (opciones: {
  liquidacion?: FacturaLiquidacionEmitible | null;
  reserva?: ReservaLiquidacionEmision | null;
  ultimoNumero?: string | null;
  e4Falla?: boolean;
} = {}) => {
  const reserva = 'reserva' in opciones ? opciones.reserva : reservaEmision();
  const repos = crearReposFake({
    ...('liquidacion' in opciones ? { liquidacion: opciones.liquidacion } : {}),
    ultimoNumero: opciones.ultimoNumero,
  });
  const uow = crearUowFake(repos);
  const cargarReserva = jest.fn(async () => reserva);
  const enviarE4 = jest.fn(async (_params: Record<string, unknown>) => {
    if (opciones.e4Falla) throw new Error('PROVEEDOR_EMAIL_CAIDO');
    return { idComunicacion: 'com-e4-1', estado: 'enviado' as const, fechaEnvio: AHORA };
  });
  const deps: EnviarFacturaLiquidacionDeps = {
    unidadDeTrabajo: uow,
    cargarReserva,
    enviarE4,
    clock: relojFijo,
  };
  return {
    useCase: new EnviarFacturaLiquidacionUseCase(deps),
    repos,
    uow,
    cargarReserva,
    enviarE4,
    deps,
  };
};

const comando = (
  over: Partial<EnviarFacturaLiquidacionComando> = {},
): EnviarFacturaLiquidacionComando => ({
  tenantId: TENANT,
  usuarioId: USUARIO_ID,
  reservaId: RESERVA_ID,
  ...over,
});

const emitirArgs = (repos: ReposFake): Record<string, unknown> | undefined =>
  repos.facturas.emitir.mock.calls.map((c) => c[0])[0];

// ===========================================================================
// Camino feliz: borrador → enviada, número asignado, fecha_emision, E4 confirmado
// con SOLO el PDF de la liquidación, status='facturada', extras marcados.
// ===========================================================================

describe('EnviarFacturaLiquidacion — camino feliz (solo liquidación)', () => {
  it('debe_emitir_la_liquidacion_a_enviada_cuando_E4_confirma', async () => {
    const { useCase, repos } = montar();

    await useCase.ejecutar(comando());

    const liq = emitirArgs(repos);
    expect(liq).toBeDefined();
    expect(liq!.estado).toBe('enviada');
  });

  it('debe_asignar_numero_factura_F_del_anio_y_fecha_emision_en_la_emision', async () => {
    const { useCase, repos } = montar({ ultimoNumero: 'F-2026-0041' });

    await useCase.ejecutar(comando());

    const liq = emitirArgs(repos);
    expect(liq!.numeroFactura).toBe('F-2026-0042');
    expect(liq!.fechaEmision).toEqual(AHORA);
  });

  it('debe_disparar_E4_con_SOLO_el_pdf_de_la_liquidacion_al_email_del_cliente', async () => {
    const { useCase, enviarE4 } = montar();

    await useCase.ejecutar(comando());

    expect(enviarE4).toHaveBeenCalledTimes(1);
    const args = enviarE4.mock.calls[0][0];
    expect(args.destinatario).toBe('marta.soler@example.com');
    const adjuntos = args.adjuntos as ReadonlyArray<{ clave: string; pdfUrl: string }>;
    // E4 = solo liquidación: un único adjunto, ninguna entrada de fianza.
    expect(adjuntos).toHaveLength(1);
    expect(adjuntos[0].clave).toBe('liquidacion');
    expect(adjuntos.some((a) => a.clave === 'fianza')).toBe(false);
    expect(adjuntos[0].pdfUrl).toBe('https://storage.local/facturas/liq.pdf');
  });

  it('debe_propagar_idioma_y_fianzaEur_en_los_params_de_E4_para_el_recordatorio', async () => {
    const { useCase, enviarE4 } = montar({ reserva: reservaEmision({ idioma: 'es', fianzaEur: '600.00' }) });

    await useCase.ejecutar(comando());

    const args = enviarE4.mock.calls[0][0] as Record<string, unknown>;
    expect(args.idioma).toBe('es');
    expect(args.fianzaEur).toBe('600.00');
  });

  it('debe_avanzar_liquidacion_status_a_facturada_y_marcar_los_extras_con_el_factura_id', async () => {
    const { useCase, repos } = montar();

    await useCase.ejecutar(comando());

    expect(repos.reservas.avanzarLiquidacionStatus).toHaveBeenCalledTimes(1);
    expect(repos.reservas.avanzarLiquidacionStatus.mock.calls[0][0].estado).toBe('facturada');
    expect(repos.extras.marcarConFactura).toHaveBeenCalledTimes(1);
    expect(repos.extras.marcarConFactura.mock.calls[0][0].facturaId).toBe(FAC_LIQ_ID);
  });

  it('debe_registrar_COMUNICACION_E4_enviado_con_fecha_de_envio', async () => {
    const { useCase, repos } = montar();

    await useCase.ejecutar(comando());

    expect(repos.comunicaciones.crear).toHaveBeenCalledTimes(1);
    const args = repos.comunicaciones.crear.mock.calls[0][0];
    expect(args.codigoEmail).toBe('E4');
    expect(args.estado).toBe('enviado');
    expect(args.fechaEnvio).toEqual(AHORA);
    expect(args.reservaId).toBe(RESERVA_ID);
    expect(args.clienteId).toBe(CLIENTE_ID);
    expect(args.tenantId).toBe(TENANT);
  });

  it('debe_registrar_AUDIT_LOG_actualizar_borrador_a_enviada_para_la_liquidacion', async () => {
    const { useCase, repos } = montar();

    await useCase.ejecutar(comando());

    const audit = repos.auditoria.registrar.mock.calls
      .map((c) => c[0])
      .find((a) => a.accion === 'actualizar' && a.entidadId === FAC_LIQ_ID);
    expect(audit).toBeDefined();
    expect(audit.entidad).toBe('FACTURA');
    expect(audit.datosAnteriores.estado).toBe('borrador');
    expect(audit.datosNuevos.estado).toBe('enviada');
  });

  it('debe_devolver_la_liquidacion_emitida_con_status_facturada', async () => {
    const { useCase } = montar();

    const resultado = await useCase.ejecutar(comando());

    expect(resultado.liquidacion.estado).toBe('enviada');
    expect(resultado.liquidacionStatus).toBe('facturada');
  });

  it('NO_debe_tocar_la_fianza_ni_exponer_ningun_puerto_de_avance_de_fianza', async () => {
    const { useCase, repos, deps } = montar();

    await useCase.ejecutar(comando());

    // Ni el repositorio de reservas ni las deps exponen mutación de fianza.
    expect((repos.reservas as Record<string, unknown>).avanzarFianzaStatus).toBeUndefined();
    expect((deps as unknown as Record<string, unknown>).avanzarFianzaStatus).toBeUndefined();
  });

  it('debe_orquestar_la_consolidacion_dentro_de_una_unica_unidad_de_trabajo', async () => {
    const { useCase, uow } = montar();

    await useCase.ejecutar(comando());

    expect(uow.ejecutar).toHaveBeenCalledTimes(1);
  });
});

// ===========================================================================
// RECORDATORIO CONDICIONAL DE E4 (change condiciones-…-recordatorio-liquidacion):
//   El email E4 recuerda al cliente que las CONDICIONES PARTICULARES FIRMADAS están
//   pendientes de devolver SI Y SOLO SI `RESERVA.cond_part_firmadas = false`. El use-case
//   propaga `recordarCondicionesPendientes = !condPartFirmadas` a `EnviarE4EmisionParams`.
//   OJO: es `cond_part_firmadas` (lo RECIBIDO), NO `cond_part_enviadas_fecha` (lo enviado).
// RED: `ReservaLiquidacionEmision` aún no tiene `condPartFirmadas` ni el use-case propaga el
// flag → estos asserts FALLAN. GREEN es de `backend-developer`.
// ===========================================================================

describe('EnviarFacturaLiquidacion — recordatorio condicional de condiciones en E4', () => {
  it('debe_propagar_recordarCondicionesPendientes_true_cuando_cond_part_firmadas_es_false', async () => {
    const { useCase, enviarE4 } = montar({
      reserva: reservaEmision({
        ...(({ condPartFirmadas: false }) as unknown as Partial<ReservaLiquidacionEmision>),
      }),
    });

    await useCase.ejecutar(comando());

    const args = enviarE4.mock.calls[0][0] as Record<string, unknown>;
    expect(args.recordarCondicionesPendientes).toBe(true);
  });

  it('debe_propagar_recordarCondicionesPendientes_false_cuando_cond_part_firmadas_es_true', async () => {
    const { useCase, enviarE4 } = montar({
      reserva: reservaEmision({
        ...(({ condPartFirmadas: true }) as unknown as Partial<ReservaLiquidacionEmision>),
      }),
    });

    await useCase.ejecutar(comando());

    const args = enviarE4.mock.calls[0][0] as Record<string, unknown>;
    expect(args.recordarCondicionesPendientes).toBe(false);
  });
});

// ===========================================================================
// Atomicidad estado↔E4: si E4 falla → EmisionEnvioFallidoError y rollback total
// (no se emite, no se avanza status, no se marcan extras, no se registra E4).
// ===========================================================================

describe('EnviarFacturaLiquidacion — atomicidad estado↔E4 (rollback ante fallo)', () => {
  it('debe_lanzar_EmisionEnvioFallido_cuando_el_envio_de_E4_falla', async () => {
    const { useCase } = montar({ e4Falla: true });

    await expect(useCase.ejecutar(comando())).rejects.toBeInstanceOf(EmisionEnvioFallidoError);
  });

  it('no_debe_consolidar_nada_cuando_E4_falla', async () => {
    const { useCase, repos } = montar({ e4Falla: true });

    await expect(useCase.ejecutar(comando())).rejects.toBeInstanceOf(EmisionEnvioFallidoError);
    expect(repos.facturas.emitir).not.toHaveBeenCalled();
    expect(repos.reservas.avanzarLiquidacionStatus).not.toHaveBeenCalled();
    expect(repos.extras.marcarConFactura).not.toHaveBeenCalled();
    expect(repos.comunicaciones.crear).not.toHaveBeenCalled();
  });

  it('debe_intentar_enviar_E4_ANTES_de_confirmar_los_cambios_de_estado', async () => {
    const { useCase, enviarE4 } = montar({ e4Falla: true });

    await expect(useCase.ejecutar(comando())).rejects.toBeInstanceOf(EmisionEnvioFallidoError);
    expect(enviarE4).toHaveBeenCalledTimes(1);
  });
});

// ===========================================================================
// Guarda de datos: PDF de la liquidación ausente (pdf_url=null) → NO envía E4;
// se trata como fallo de emisión (EmisionEnvioFallidoError, 502).
// ===========================================================================

describe('EnviarFacturaLiquidacion — PDF de la liquidación ausente', () => {
  it('debe_lanzar_EmisionEnvioFallido_cuando_la_liquidacion_no_tiene_pdf_url', async () => {
    const { useCase } = montar({ liquidacion: liquidacionBorrador({ pdfUrl: null }) });

    await expect(useCase.ejecutar(comando())).rejects.toBeInstanceOf(EmisionEnvioFallidoError);
  });

  it('no_debe_enviar_E4_ni_consolidar_cuando_falta_el_pdf_de_la_liquidacion', async () => {
    const { useCase, enviarE4, repos } = montar({
      liquidacion: liquidacionBorrador({ pdfUrl: null }),
    });

    await expect(useCase.ejecutar(comando())).rejects.toBeInstanceOf(EmisionEnvioFallidoError);
    expect(enviarE4).not.toHaveBeenCalled();
    expect(repos.facturas.emitir).not.toHaveBeenCalled();
  });
});

// ===========================================================================
// Guarda de estado / idempotencia: la liquidación ya emitida (enviada) NO es
// re-emitible → FacturaNoBorradorError (409); no se muta nada ni se envía E4.
// ===========================================================================

describe('EnviarFacturaLiquidacion — no está en borrador (ya emitida)', () => {
  it('debe_rechazar_con_FacturaNoBorrador_cuando_la_liquidacion_ya_esta_enviada', async () => {
    const { useCase } = montar({
      liquidacion: liquidacionBorrador({ estado: 'enviada', numeroFactura: 'F-2026-0042' }),
    });

    await expect(useCase.ejecutar(comando())).rejects.toBeInstanceOf(FacturaNoBorradorError);
  });

  it('no_debe_enviar_E4_ni_mutar_nada_cuando_la_liquidacion_ya_esta_enviada', async () => {
    const { useCase, enviarE4, repos } = montar({
      liquidacion: liquidacionBorrador({ estado: 'enviada', numeroFactura: 'F-2026-0042' }),
    });

    await expect(useCase.ejecutar(comando())).rejects.toBeInstanceOf(FacturaNoBorradorError);
    expect(enviarE4).not.toHaveBeenCalled();
    expect(repos.facturas.emitir).not.toHaveBeenCalled();
  });
});

// ===========================================================================
// 404 / RLS: no existe liquidación en borrador para la reserva; reserva
// cross-tenant. Sin efectos ni envío de E4.
// ===========================================================================

describe('EnviarFacturaLiquidacion — no encontrada / cross-tenant', () => {
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

  it('no_debe_enviar_E4_ni_mutar_nada_cuando_la_reserva_es_cross_tenant', async () => {
    const { useCase, enviarE4, repos } = montar({ reserva: null });

    await expect(useCase.ejecutar(comando())).rejects.toBeInstanceOf(
      FacturaLiquidacionNoEncontradaError,
    );
    expect(enviarE4).not.toHaveBeenCalled();
    expect(repos.facturas.emitir).not.toHaveBeenCalled();
  });
});
