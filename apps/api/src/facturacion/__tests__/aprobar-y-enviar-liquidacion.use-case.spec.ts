/**
 * TESTS del caso de uso `AprobarYEnviarLiquidacionUseCase` (US-028 / UC-21 pasos 3–6) —
 * fase TDD RED. tasks.md Fase 3: 3.2 (emisión de la liquidación), 3.3 (efecto sobre la
 * fianza), 3.8 (reglas de validación: no aprobar si no está en borrador → 409, no
 * retroceso facturada → pendiente). Incluye el descuento negociado (D-2) en la emisión.
 *
 * Trazabilidad: US-028, spec-delta `facturacion` (Requirements "Emisión de la factura de
 * liquidación al aprobar y enviar", "Emisión del recibo de fianza como efecto del envío
 * de E4", "Ajuste del importe (descuento negociado) antes de aprobar", "Solo se puede
 * aprobar y enviar desde borrador; el estado facturada no retrocede"); spec-delta
 * `comunicaciones` (E4 con ambos PDFs). design.md §D-1 opción A (atomicidad síncrona
 * estado↔E4), §D-2 (descuento), §D-3 (fianza ya enviada por separado), §D-6 (numeración
 * en la emisión). Contrato: `aprobarEnviarLiquidacion` (200 / 409 FACTURA_NO_BORRADOR /
 * 422 / 502-503).
 *
 * Ejercita la APLICACIÓN contra DOBLES DE LOS PUERTOS (in-memory), sin tocar Prisma
 * (hexagonal, hook `no-infra-in-domain`). La atomicidad REAL con transacción y el
 * rollback viven en `aprobar-y-enviar-atomicidad.spec.ts`; la numeración concurrente en
 * `aprobar-y-enviar-concurrencia.spec.ts`. Aquí se fija la ORQUESTACIÓN: guardas de
 * estado, asignación del número EN la emisión, transición de ambas facturas, marcado de
 * RESERVA_EXTRA, actualización de importe_liquidacion con descuento, envío E4 síncrono y
 * AUDIT_LOG `actualizar`.
 *
 * RED: aún NO existe `facturacion/application/aprobar-y-enviar-liquidacion.use-case.ts`.
 * El import falla y la batería está en ROJO por AUSENCIA DE IMPLEMENTACIÓN. GREEN es de
 * `backend-developer`.
 */
import {
  AprobarYEnviarLiquidacionUseCase,
  FacturaLiquidacionNoEncontradaError,
  FacturaNoBorradorError,
  EmisionEnvioFallidoError,
  type AprobarYEnviarLiquidacionDeps,
  type AprobarYEnviarLiquidacionComando,
  type FacturaEmitible,
  type ReservaEmision,
  type RepositoriosEmision,
  type UnidadDeTrabajoEmisionPort,
  type ClockPort,
} from '../application/aprobar-y-enviar-liquidacion.use-case';

const TENANT = '00000000-0000-0000-0000-000000000001';
const RESERVA_ID = 'res-conf-1';
const CLIENTE_ID = 'cli-1';
const FAC_LIQ_ID = 'fac-liq-1';
const FAC_FIANZA_ID = 'fac-fianza-1';
const USUARIO_ID = 'usr-gestor-1';

const AHORA = new Date('2026-07-04T10:00:00.000Z');
const relojFijo: ClockPort = { ahora: () => AHORA };

// ---------------------------------------------------------------------------
// Dobles de datos: FACTURA(liquidacion) y FACTURA(fianza) en borrador con
// numero_factura NULL (US-027); RESERVA con sub-procesos en pendiente.
// ---------------------------------------------------------------------------

const facturaBorrador = (
  tipo: 'liquidacion' | 'fianza',
  over: Partial<FacturaEmitible> = {},
): FacturaEmitible => ({
  idFactura: tipo === 'liquidacion' ? FAC_LIQ_ID : FAC_FIANZA_ID,
  tenantId: TENANT,
  reservaId: RESERVA_ID,
  numeroFactura: null,
  tipo,
  estado: 'borrador',
  total: tipo === 'liquidacion' ? '4100.00' : '1000.00',
  baseImponible: tipo === 'liquidacion' ? '3388.43' : '826.45',
  ivaPorcentaje: '21.00',
  ivaImporte: tipo === 'liquidacion' ? '711.57' : '173.55',
  pdfUrl:
    tipo === 'liquidacion'
      ? 'https://storage.local/facturas/liq.pdf'
      : 'https://storage.local/facturas/fianza.pdf',
  fechaEmision: null,
  ...over,
});

const reservaEmision = (over: Partial<ReservaEmision> = {}): ReservaEmision => ({
  idReserva: RESERVA_ID,
  tenantId: TENANT,
  clienteId: CLIENTE_ID,
  codigo: 'SLO-2026-0028',
  liquidacionStatus: 'pendiente',
  fianzaStatus: 'pendiente',
  importeLiquidacion: '3600.00',
  clienteEmail: 'marta.soler@example.com',
  ...over,
});

// ---------------------------------------------------------------------------
// Repositorios + UoW + puerto de envío E4 fake. La consolidación (número +
// estado + status + marcado de extras + COMUNICACION) SOLO ocurre si E4 confirma.
// ---------------------------------------------------------------------------

interface ReposFake extends RepositoriosEmision {
  facturas: {
    buscarPorReservaYTipo: jest.Mock;
    ultimoNumeroDelAnio: jest.Mock;
    emitir: jest.Mock;
  };
  reservas: {
    avanzarLiquidacionStatus: jest.Mock;
    avanzarFianzaStatus: jest.Mock;
    actualizarImporteLiquidacion: jest.Mock;
  };
  extras: { marcarConFactura: jest.Mock };
  comunicaciones: { crear: jest.Mock };
  auditoria: { registrar: jest.Mock };
}

const crearReposFake = (opciones: {
  liquidacion?: FacturaEmitible | null;
  fianza?: FacturaEmitible | null;
  ultimoNumero?: string | null;
} = {}): ReposFake => ({
  facturas: {
    buscarPorReservaYTipo: jest.fn(async (_reservaId: string, tipo: string) => {
      if (tipo === 'liquidacion') {
        return 'liquidacion' in opciones ? opciones.liquidacion : facturaBorrador('liquidacion');
      }
      if (tipo === 'fianza') {
        return 'fianza' in opciones ? opciones.fianza : facturaBorrador('fianza');
      }
      return null;
    }),
    ultimoNumeroDelAnio: jest.fn(async () => opciones.ultimoNumero ?? null),
    emitir: jest.fn(async () => undefined),
  },
  reservas: {
    avanzarLiquidacionStatus: jest.fn(async () => undefined),
    avanzarFianzaStatus: jest.fn(async () => undefined),
    actualizarImporteLiquidacion: jest.fn(async () => undefined),
  },
  extras: { marcarConFactura: jest.fn(async () => undefined) },
  comunicaciones: {
    crear: jest.fn(async (p: Record<string, unknown>) => ({ idComunicacion: 'com-e4-1', ...p })),
  },
  auditoria: { registrar: jest.fn(async () => undefined) },
});

const crearUowFake = (
  repos: ReposFake,
): UnidadDeTrabajoEmisionPort & { ejecutar: jest.Mock } => ({
  ejecutar: jest.fn(
    async <T,>(_tenantId: string, trabajo: (r: RepositoriosEmision) => Promise<T>) =>
      trabajo(repos),
  ),
});

const montar = (opciones: {
  liquidacion?: FacturaEmitible | null;
  fianza?: FacturaEmitible | null;
  reserva?: ReservaEmision | null;
  ultimoNumero?: string | null;
  e4Falla?: boolean;
} = {}) => {
  const reserva = 'reserva' in opciones ? opciones.reserva : reservaEmision();
  const repos = crearReposFake({
    ...('liquidacion' in opciones ? { liquidacion: opciones.liquidacion } : {}),
    ...('fianza' in opciones ? { fianza: opciones.fianza } : {}),
    ultimoNumero: opciones.ultimoNumero,
  });
  const uow = crearUowFake(repos);
  const cargarReserva = jest.fn(async () => reserva);
  const enviarE4 = jest.fn(async (_params: Record<string, unknown>) => {
    if (opciones.e4Falla) throw new Error('PROVEEDOR_EMAIL_CAIDO');
    return { idComunicacion: 'com-e4-1', estado: 'enviado' as const, fechaEnvio: AHORA };
  });
  const deps: AprobarYEnviarLiquidacionDeps = {
    unidadDeTrabajo: uow,
    cargarReserva,
    enviarE4,
    clock: relojFijo,
  };
  return {
    useCase: new AprobarYEnviarLiquidacionUseCase(deps),
    repos,
    uow,
    cargarReserva,
    enviarE4,
    deps,
  };
};

const comando = (
  over: Partial<AprobarYEnviarLiquidacionComando> = {},
): AprobarYEnviarLiquidacionComando => ({
  tenantId: TENANT,
  usuarioId: USUARIO_ID,
  reservaId: RESERVA_ID,
  ...over,
});

const emitirArgsDe = (repos: ReposFake, tipo: string): Record<string, unknown> | undefined =>
  repos.facturas.emitir.mock.calls.map((c) => c[0]).find((f) => f.tipo === tipo);

// ===========================================================================
// 3.2 — Emisión de la liquidación con E4 confirmado: estado='enviada',
//        numero_factura='F-YYYY-NNNN', fecha_emision, liquidacion_status='facturada',
//        RESERVA_EXTRA marcados con factura_id, AUDIT_LOG 'actualizar'.
// ===========================================================================

describe('AprobarYEnviarLiquidacion — emisión de la liquidación (3.2)', () => {
  const anio = AHORA.getUTCFullYear();

  it('debe_emitir_la_liquidacion_a_enviada_con_fecha_emision_cuando_E4_confirma', async () => {
    const { useCase, repos } = montar();

    await useCase.ejecutar(comando());

    const liq = emitirArgsDe(repos, 'liquidacion');
    expect(liq).toBeDefined();
    expect(liq!.estado).toBe('enviada');
    expect(liq!.fechaEmision).toEqual(AHORA);
  });

  it('debe_asignar_el_numero_F_YYYY_NNNN_en_la_emision_derivandolo_del_ultimo_del_ano', async () => {
    const { useCase, repos } = montar({ ultimoNumero: `F-${anio}-0041` });

    await useCase.ejecutar(comando());

    const liq = emitirArgsDe(repos, 'liquidacion');
    expect(liq!.numeroFactura).toBe(`F-${anio}-0042`);
  });

  it('debe_asignar_F_YYYY_0001_como_primera_del_tenant_en_el_ano', async () => {
    const { useCase, repos } = montar({ ultimoNumero: null });

    await useCase.ejecutar(comando());

    const liq = emitirArgsDe(repos, 'liquidacion');
    expect(liq!.numeroFactura).toBe(`F-${anio}-0001`);
  });

  it('debe_avanzar_liquidacion_status_a_facturada', async () => {
    const { useCase, repos } = montar();

    await useCase.ejecutar(comando());

    expect(repos.reservas.avanzarLiquidacionStatus).toHaveBeenCalledWith(
      expect.objectContaining({ reservaId: RESERVA_ID, estado: 'facturada' }),
    );
  });

  it('debe_marcar_los_RESERVA_EXTRA_pendientes_con_el_factura_id_de_la_liquidacion', async () => {
    const { useCase, repos } = montar();

    await useCase.ejecutar(comando());

    expect(repos.extras.marcarConFactura).toHaveBeenCalledWith(
      expect.objectContaining({ reservaId: RESERVA_ID, facturaId: FAC_LIQ_ID }),
    );
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

  it('debe_disparar_E4_con_los_dos_pdf_url_al_email_del_cliente', async () => {
    const { useCase, enviarE4 } = montar();

    await useCase.ejecutar(comando());

    expect(enviarE4).toHaveBeenCalledTimes(1);
    const args = enviarE4.mock.calls[0][0];
    expect(args.destinatario).toBe('marta.soler@example.com');
    const adjuntosArgs = args.adjuntos as ReadonlyArray<{ pdfUrl: string }>;
    expect(adjuntosArgs.map((a: { pdfUrl: string }) => a.pdfUrl)).toEqual(
      expect.arrayContaining([
        'https://storage.local/facturas/liq.pdf',
        'https://storage.local/facturas/fianza.pdf',
      ]),
    );
  });

  it('debe_registrar_COMUNICACION_E4_enviado_con_fecha_envio', async () => {
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

  it('debe_devolver_la_liquidacion_emitida_y_los_status_actualizados', async () => {
    const { useCase } = montar({ ultimoNumero: null });

    const resultado = await useCase.ejecutar(comando());

    expect(resultado.liquidacion.estado).toBe('enviada');
    expect(resultado.liquidacion.numeroFactura).toBe(`F-${anio}-0001`);
    expect(resultado.liquidacionStatus).toBe('facturada');
    expect(resultado.fianzaStatus).toBe('recibo_enviado');
  });
});

// ===========================================================================
// 3.2 — Descuento negociado (D-2) en la emisión: total recalculado 3.900,
//        importe_liquidacion actualizado y descuento en AUDIT_LOG.
// ===========================================================================

describe('AprobarYEnviarLiquidacion — descuento negociado en la emisión (3.2 / D-2)', () => {
  it('debe_emitir_por_3900_con_desglose_recalculado_cuando_se_aplica_descuento_de_200', async () => {
    const { useCase, repos } = montar();

    await useCase.ejecutar(comando({ descuento: '200.00', motivo: 'Cliente recurrente' }));

    const liq = emitirArgsDe(repos, 'liquidacion');
    expect(liq!.total).toBe('3900.00');
    expect(liq!.baseImponible).toBe('3223.14');
    expect(liq!.ivaImporte).toBe('676.86');
  });

  it('debe_actualizar_importe_liquidacion_de_la_reserva_al_nuevo_total_con_descuento', async () => {
    const { useCase, repos } = montar();

    await useCase.ejecutar(comando({ descuento: '200.00', motivo: 'Cliente recurrente' }));

    expect(repos.reservas.actualizarImporteLiquidacion).toHaveBeenCalledWith(
      expect.objectContaining({ reservaId: RESERVA_ID, importeLiquidacion: '3900.00' }),
    );
  });

  it('debe_dejar_el_total_original_e_no_tocar_importe_liquidacion_sin_descuento', async () => {
    const { useCase, repos } = montar();

    await useCase.ejecutar(comando());

    expect(emitirArgsDe(repos, 'liquidacion')!.total).toBe('4100.00');
    expect(repos.reservas.actualizarImporteLiquidacion).not.toHaveBeenCalled();
  });

  it('debe_trazar_el_descuento_en_AUDIT_LOG_con_el_total_anterior_y_el_nuevo', async () => {
    const { useCase, repos } = montar();

    await useCase.ejecutar(comando({ descuento: '200.00', motivo: 'Cliente recurrente' }));

    const trazas = JSON.stringify(repos.auditoria.registrar.mock.calls);
    expect(trazas).toContain('4100.00');
    expect(trazas).toContain('3900.00');
  });
});

// ===========================================================================
// 3.3 — Efecto sobre la fianza: al confirmar E4 la fianza pasa a enviada y
//        fianza_status='recibo_enviado'; si ya se envió por separado, E4 no la
//        re-emite ni retrocede el status y adjunta solo la liquidación.
// ===========================================================================

describe('AprobarYEnviarLiquidacion — efecto sobre la fianza (3.3)', () => {
  it('debe_emitir_la_fianza_a_enviada_y_avanzar_fianza_status_a_recibo_enviado', async () => {
    const { useCase, repos } = montar();

    await useCase.ejecutar(comando());

    expect(emitirArgsDe(repos, 'fianza')!.estado).toBe('enviada');
    expect(repos.reservas.avanzarFianzaStatus).toHaveBeenCalledWith(
      expect.objectContaining({ reservaId: RESERVA_ID, estado: 'recibo_enviado' }),
    );
  });

  it('debe_asignar_numero_propio_a_la_fianza_distinto_del_de_la_liquidacion', async () => {
    const { useCase, repos } = montar({ ultimoNumero: null });

    await useCase.ejecutar(comando());

    const liq = emitirArgsDe(repos, 'liquidacion');
    const fianza = emitirArgsDe(repos, 'fianza');
    expect(fianza!.numeroFactura).toBeTruthy();
    expect(fianza!.numeroFactura).not.toBe(liq!.numeroFactura);
  });

  it('no_debe_re_emitir_la_fianza_ni_retroceder_su_status_cuando_ya_se_envio_por_separado', async () => {
    const { useCase, repos } = montar({
      fianza: facturaBorrador('fianza', { estado: 'enviada', numeroFactura: 'F-2026-0009' }),
      reserva: reservaEmision({ fianzaStatus: 'recibo_enviado' }),
    });

    await useCase.ejecutar(comando());

    // La fianza ya está enviada: no se vuelve a emitir.
    expect(emitirArgsDe(repos, 'fianza')).toBeUndefined();
    // fianza_status NO retrocede (permanece recibo_enviado; no se re-avanza).
    expect(repos.reservas.avanzarFianzaStatus).not.toHaveBeenCalled();
  });

  it('debe_adjuntar_solo_la_liquidacion_en_E4_cuando_la_fianza_ya_se_envio_por_separado', async () => {
    const { useCase, enviarE4 } = montar({
      fianza: facturaBorrador('fianza', { estado: 'enviada', numeroFactura: 'F-2026-0009' }),
      reserva: reservaEmision({ fianzaStatus: 'recibo_enviado' }),
    });

    await useCase.ejecutar(comando());

    const adjuntos = enviarE4.mock.calls[0][0].adjuntos as ReadonlyArray<{ pdfUrl: string }>;
    expect(adjuntos.map((a) => a.pdfUrl)).toEqual([
      'https://storage.local/facturas/liq.pdf',
    ]);
  });

  it('debe_devolver_fianza_null_cuando_ya_se_habia_enviado_por_separado', async () => {
    const { useCase } = montar({
      fianza: facturaBorrador('fianza', { estado: 'enviada', numeroFactura: 'F-2026-0009' }),
      reserva: reservaEmision({ fianzaStatus: 'recibo_enviado' }),
    });

    const resultado = await useCase.ejecutar(comando());

    expect(resultado.fianza).toBeNull();
  });
});

// ===========================================================================
// 3.8 — Reglas de validación: no aprobar si no está en borrador (409); reserva
//        inexistente (404); no retroceso facturada → pendiente. Ante guarda que
//        falla NO se muta nada (ni número, ni estado, ni E4).
// ===========================================================================

describe('AprobarYEnviarLiquidacion — reglas de validación (3.8)', () => {
  it('debe_rechazar_con_FacturaNoBorrador_cuando_la_liquidacion_ya_esta_enviada', async () => {
    const { useCase } = montar({
      liquidacion: facturaBorrador('liquidacion', {
        estado: 'enviada',
        numeroFactura: 'F-2026-0042',
      }),
    });

    await expect(useCase.ejecutar(comando())).rejects.toBeInstanceOf(FacturaNoBorradorError);
  });

  it('no_debe_mutar_nada_ni_enviar_E4_cuando_la_liquidacion_ya_esta_enviada', async () => {
    const { useCase, repos, enviarE4 } = montar({
      liquidacion: facturaBorrador('liquidacion', {
        estado: 'enviada',
        numeroFactura: 'F-2026-0042',
      }),
    });

    await expect(useCase.ejecutar(comando())).rejects.toBeInstanceOf(FacturaNoBorradorError);
    expect(repos.facturas.emitir).not.toHaveBeenCalled();
    expect(repos.reservas.avanzarLiquidacionStatus).not.toHaveBeenCalled();
    expect(enviarE4).not.toHaveBeenCalled();
  });

  it('debe_rechazar_con_FacturaLiquidacionNoEncontrada_cuando_no_hay_liquidacion_en_borrador', async () => {
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

  it('no_debe_permitir_aprobar_cuando_liquidacion_status_ya_es_facturada_aunque_llegue_la_llamada', async () => {
    // Guarda de no-retroceso / doble aprobación: si el sub-proceso ya está facturada
    // la acción se rechaza (coherente con la factura ya emitida).
    const { useCase, repos } = montar({
      liquidacion: facturaBorrador('liquidacion', {
        estado: 'enviada',
        numeroFactura: 'F-2026-0042',
      }),
      reserva: reservaEmision({ liquidacionStatus: 'facturada' }),
    });

    await expect(useCase.ejecutar(comando())).rejects.toBeInstanceOf(FacturaNoBorradorError);
    expect(repos.reservas.avanzarLiquidacionStatus).not.toHaveBeenCalled();
  });
});

// ===========================================================================
// Atomicidad (orquestación): si E4 falla, el use-case propaga
// EmisionEnvioFallidoError y NO consolida (mock: la UoW no debe commitear). El
// rollback REAL se verifica en aprobar-y-enviar-atomicidad.spec.ts.
// ===========================================================================

describe('AprobarYEnviarLiquidacion — atomicidad estado↔E4 (orquestación, D-1)', () => {
  it('debe_lanzar_EmisionEnvioFallido_cuando_el_envio_de_E4_falla', async () => {
    const { useCase } = montar({ e4Falla: true });

    await expect(useCase.ejecutar(comando())).rejects.toBeInstanceOf(EmisionEnvioFallidoError);
  });

  it('debe_verificar_los_adjuntos_y_enviar_E4_ANTES_de_confirmar_los_cambios_de_estado', async () => {
    // §D-1 opción A: la consolidación (emitir/avanzar status) ocurre DESPUÉS de que
    // E4 confirme. Con E4 en fallo, el use-case no debe dejar la emisión consolidada.
    const { useCase, repos, enviarE4 } = montar({ e4Falla: true });

    await expect(useCase.ejecutar(comando())).rejects.toBeInstanceOf(EmisionEnvioFallidoError);
    expect(enviarE4).toHaveBeenCalledTimes(1);
    // La COMUNICACION 'enviado' NO se registra si E4 no confirma.
    const enviadas = repos.comunicaciones.crear.mock.calls.filter(
      (c) => c[0].estado === 'enviado',
    );
    expect(enviadas).toHaveLength(0);
  });

  it('debe_orquestar_la_consolidacion_dentro_de_una_unica_unidad_de_trabajo', async () => {
    const { useCase, uow } = montar();

    await useCase.ejecutar(comando());

    expect(uow.ejecutar).toHaveBeenCalledTimes(1);
  });
});
