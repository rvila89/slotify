/**
 * TESTS del caso de uso `EnviarFacturaSenalUseCase` (US-023 / épico #6, rebanada 6.4b
 * Bloque C) — fase TDD RED. tasks.md Fase 3: 3.1 (camino feliz borrador → enviada, E3
 * confirmado, `cond_part_enviadas_fecha` fijada, COMUNICACION E3 + AUDIT_LOG), 3.2
 * (atomicidad/rollback ante fallo de E3), 3.3 (PDF de señal ausente → 502), 3.4 (estado
 * `rechazada` → 409), 3.5 (idempotencia E3 `enviado` → 409 / E3 `fallido` → reintento),
 * 3.6 (adjunto de condiciones degrada/lanza → E3 solo con la señal + condPartAdjuntada
 * false), 3.7 (404 no encontrada / cross-tenant RLS).
 *
 * Trazabilidad: US-023, spec-delta `facturacion` (Requirement: "Envío atómico de la
 * factura de señal con E3"), `comunicaciones` (E3 con la factura de señal + condiciones
 * opcionales), `documentos` (adjunto de condicions particulars degradable). design.md
 * §D-ruta-email (puerto directo, espejo literal de E4), §D-guarda-estado (enviable =
 * borrador o enviada-sin-E3), §D-idempotencia (COMUNICACION E3 `enviado` → 409),
 * §D-adjunto-condiciones (fallo de condiciones NO tumba E3), §D-num (reintento P2002),
 * §Atomicidad. Contrato: `POST /reservas/{id}/facturas/senal/enviar` (200 / 404
 * FACTURA_SENAL_NO_ENCONTRADA / 409 FACTURA_SENAL_NO_ENVIABLE / 409 E3_YA_ENVIADO / 502
 * EMISION_ENVIO_FALLIDO).
 *
 * Espejo literal de `aprobar-y-enviar-liquidacion.use-case.spec.ts`: dobles de puertos
 * in-memory (hexagonal, hook `no-infra-in-domain`), sin Prisma, sin react-pdf. Fija la
 * ORQUESTACIÓN: guardas de estado/existencia, idempotencia por COMUNICACION E3, envío E3
 * síncrono DENTRO de la tx (si falla → rollback), fijación de `cond_part_enviadas_fecha`
 * y `cond_part_firmadas=false`, degradación del adjunto de condiciones y AUDIT_LOG.
 *
 * RED: aún NO existe `facturacion/application/enviar-factura-senal.use-case.ts`. El import
 * falla y la batería está en ROJO por AUSENCIA DE IMPLEMENTACIÓN. GREEN es de
 * `backend-developer`.
 */
import {
  EnviarFacturaSenalUseCase,
  FacturaSenalNoEncontradaError,
  FacturaSenalNoEnviableError,
  E3YaEnviadoError,
  EmisionEnvioFallidoError,
  type EnviarFacturaSenalDeps,
  type EnviarFacturaSenalComando,
  type FacturaSenalEmitible,
  type ReservaSenalEmision,
  type RepositoriosSenalEmision,
  type UnidadDeTrabajoSenalEmisionPort,
  type ClockPort,
} from '../application/enviar-factura-senal.use-case';

const TENANT = '00000000-0000-0000-0000-000000000001';
const RESERVA_ID = 'res-conf-1';
const CLIENTE_ID = 'cli-1';
const FAC_SENAL_ID = 'fac-senal-1';
const USUARIO_ID = 'usr-gestor-1';

const AHORA = new Date('2026-07-15T10:00:00.000Z');
const relojFijo: ClockPort = { ahora: () => AHORA };

const URL_PDF_CONDICIONES = 'https://storage.local/condiciones/tenant-1.pdf';

// ---------------------------------------------------------------------------
// Dobles de datos: FACTURA(senal) en borrador con numero_factura ya asignado
// (US-022) y RESERVA con los sub-procesos de condiciones sin fijar.
// ---------------------------------------------------------------------------

const facturaSenal = (
  over: Partial<FacturaSenalEmitible> = {},
): FacturaSenalEmitible => ({
  idFactura: FAC_SENAL_ID,
  tenantId: TENANT,
  reservaId: RESERVA_ID,
  numeroFactura: 'F-2026-0007',
  tipo: 'senal',
  estado: 'borrador',
  total: '1640.00',
  baseImponible: '1355.37',
  ivaPorcentaje: '21.00',
  ivaImporte: '284.63',
  pdfUrl: 'https://storage.local/facturas/senal.pdf',
  fechaEmision: null,
  ...over,
});

const reservaEmision = (
  over: Partial<ReservaSenalEmision> = {},
): ReservaSenalEmision => ({
  idReserva: RESERVA_ID,
  tenantId: TENANT,
  clienteId: CLIENTE_ID,
  codigo: 'SLO-2026-0023',
  clienteEmail: 'marta.soler@example.com',
  condPartEnviadasFecha: null,
  condPartFirmadas: false,
  ...over,
});

// ---------------------------------------------------------------------------
// Repositorios + UoW + puertos de envío E3 y de condiciones fake. La
// consolidación (estado + cond_part + COMUNICACION + AUDIT_LOG) SOLO ocurre si
// E3 confirma. La idempotencia se comprueba por COMUNICACION E3 previa.
// ---------------------------------------------------------------------------

interface ReposFake extends RepositoriosSenalEmision {
  facturas: {
    buscarPorReservaYTipo: jest.Mock;
    ultimoNumeroDelAnio: jest.Mock;
    emitir: jest.Mock;
  };
  reservas: {
    fijarCondicionesEnviadas: jest.Mock;
  };
  comunicaciones: {
    buscarE3(reservaId: string): Promise<{ estado: string } | null>;
    crear: jest.Mock;
  } & { buscarE3: jest.Mock };
  auditoria: { registrar: jest.Mock };
}

const crearReposFake = (opciones: {
  senal?: FacturaSenalEmitible | null;
  ultimoNumero?: string | null;
  /** Estado de la COMUNICACION E3 previa, o null si no hay ninguna. */
  e3Previa?: string | null;
} = {}): ReposFake => ({
  facturas: {
    buscarPorReservaYTipo: jest.fn(async (_reservaId: string, tipo: string) => {
      if (tipo === 'senal') {
        return 'senal' in opciones ? opciones.senal : facturaSenal();
      }
      return null;
    }),
    ultimoNumeroDelAnio: jest.fn(async () => opciones.ultimoNumero ?? null),
    emitir: jest.fn(async () => undefined),
  },
  reservas: {
    fijarCondicionesEnviadas: jest.fn(async () => undefined),
  },
  comunicaciones: {
    buscarE3: jest.fn(async () =>
      'e3Previa' in opciones && opciones.e3Previa != null
        ? { estado: opciones.e3Previa }
        : null,
    ),
    crear: jest.fn(async (p: Record<string, unknown>) => ({ idComunicacion: 'com-e3-1', ...p })),
  },
  auditoria: { registrar: jest.fn(async () => undefined) },
});

const crearUowFake = (
  repos: ReposFake,
): UnidadDeTrabajoSenalEmisionPort & { ejecutar: jest.Mock } => ({
  ejecutar: jest.fn(
    async <T,>(_tenantId: string, trabajo: (r: RepositoriosSenalEmision) => Promise<T>) =>
      trabajo(repos),
  ),
});

const montar = (opciones: {
  senal?: FacturaSenalEmitible | null;
  reserva?: ReservaSenalEmision | null;
  ultimoNumero?: string | null;
  e3Previa?: string | null;
  e3Falla?: boolean;
  /** Comportamiento del puerto de condiciones: url | null (degrada) | throw. */
  condiciones?: 'url' | 'null' | 'throw';
} = {}) => {
  const reserva = 'reserva' in opciones ? opciones.reserva : reservaEmision();
  const repos = crearReposFake({
    ...('senal' in opciones ? { senal: opciones.senal } : {}),
    ...('e3Previa' in opciones ? { e3Previa: opciones.e3Previa } : {}),
    ultimoNumero: opciones.ultimoNumero,
  });
  const uow = crearUowFake(repos);
  const cargarReserva = jest.fn(async () => reserva);
  const enviarE3 = jest.fn(async (_params: Record<string, unknown>) => {
    if (opciones.e3Falla) throw new Error('PROVEEDOR_EMAIL_CAIDO');
    return { idComunicacion: 'com-e3-1', estado: 'enviado' as const, fechaEnvio: AHORA };
  });
  const modoCond = opciones.condiciones ?? 'url';
  const generarCondiciones = jest.fn(async (_params: { tenantId: string }) => {
    if (modoCond === 'throw') throw new Error('REACT_PDF_ESM_FLAKY');
    if (modoCond === 'null') return null;
    return URL_PDF_CONDICIONES;
  });
  const deps: EnviarFacturaSenalDeps = {
    unidadDeTrabajo: uow,
    cargarReserva,
    enviarE3,
    generarCondiciones,
    clock: relojFijo,
  };
  return {
    useCase: new EnviarFacturaSenalUseCase(deps),
    repos,
    uow,
    cargarReserva,
    enviarE3,
    generarCondiciones,
    deps,
  };
};

const comando = (
  over: Partial<EnviarFacturaSenalComando> = {},
): EnviarFacturaSenalComando => ({
  tenantId: TENANT,
  usuarioId: USUARIO_ID,
  reservaId: RESERVA_ID,
  ...over,
});

const emitirArgs = (repos: ReposFake): Record<string, unknown> | undefined =>
  repos.facturas.emitir.mock.calls.map((c) => c[0])[0];

// ===========================================================================
// 3.1 — Camino feliz: borrador → enviada, E3 confirmado con la factura de señal
//        adjunta, RESERVA.cond_part_enviadas_fecha fijada, cond_part_firmadas
//        false, COMUNICACION E3 `enviado`, AUDIT_LOG `actualizar`.
// ===========================================================================

describe('EnviarFacturaSenal — camino feliz (3.1)', () => {
  it('debe_emitir_la_senal_a_enviada_cuando_E3_confirma', async () => {
    const { useCase, repos } = montar();

    await useCase.ejecutar(comando());

    const senal = emitirArgs(repos);
    expect(senal).toBeDefined();
    expect(senal!.estado).toBe('enviada');
  });

  it('debe_fijar_fecha_emision_cuando_era_null_conservando_el_numero_factura_de_US022', async () => {
    const { useCase, repos } = montar();

    await useCase.ejecutar(comando());

    const senal = emitirArgs(repos);
    expect(senal!.fechaEmision).toEqual(AHORA);
    // NO re-numera: conserva el número de US-022.
    expect(senal!.numeroFactura).toBe('F-2026-0007');
  });

  it('debe_fijar_cond_part_enviadas_fecha_y_cond_part_firmadas_false_en_la_reserva', async () => {
    const { useCase, repos } = montar();

    await useCase.ejecutar(comando());

    expect(repos.reservas.fijarCondicionesEnviadas).toHaveBeenCalledWith(
      expect.objectContaining({
        reservaId: RESERVA_ID,
        condPartEnviadasFecha: AHORA,
        condPartFirmadas: false,
      }),
    );
  });

  it('debe_disparar_E3_con_el_pdf_de_la_senal_al_email_del_cliente', async () => {
    const { useCase, enviarE3 } = montar();

    await useCase.ejecutar(comando());

    expect(enviarE3).toHaveBeenCalledTimes(1);
    const args = enviarE3.mock.calls[0][0];
    expect(args.destinatario).toBe('marta.soler@example.com');
    const adjuntos = args.adjuntos as ReadonlyArray<{ clave: string; pdfUrl: string }>;
    expect(adjuntos.map((a) => a.pdfUrl)).toEqual(
      expect.arrayContaining(['https://storage.local/facturas/senal.pdf']),
    );
  });

  it('debe_adjuntar_las_condiciones_cuando_el_puerto_las_devuelve', async () => {
    const { useCase, enviarE3, generarCondiciones } = montar();

    await useCase.ejecutar(comando());

    expect(generarCondiciones).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: TENANT }),
    );
    const adjuntos = enviarE3.mock.calls[0][0].adjuntos as ReadonlyArray<{ pdfUrl: string }>;
    expect(adjuntos.map((a) => a.pdfUrl)).toEqual(
      expect.arrayContaining([URL_PDF_CONDICIONES]),
    );
  });

  it('debe_registrar_COMUNICACION_E3_enviado_con_fecha_envio', async () => {
    const { useCase, repos } = montar();

    await useCase.ejecutar(comando());

    expect(repos.comunicaciones.crear).toHaveBeenCalledTimes(1);
    const args = repos.comunicaciones.crear.mock.calls[0][0];
    expect(args.codigoEmail).toBe('E3');
    expect(args.estado).toBe('enviado');
    expect(args.fechaEnvio).toEqual(AHORA);
    expect(args.reservaId).toBe(RESERVA_ID);
    expect(args.clienteId).toBe(CLIENTE_ID);
    expect(args.tenantId).toBe(TENANT);
  });

  it('debe_registrar_AUDIT_LOG_actualizar_borrador_a_enviada_para_la_factura_de_senal', async () => {
    const { useCase, repos } = montar();

    await useCase.ejecutar(comando());

    const audit = repos.auditoria.registrar.mock.calls
      .map((c) => c[0])
      .find((a) => a.accion === 'actualizar' && a.entidadId === FAC_SENAL_ID);
    expect(audit).toBeDefined();
    expect(audit.entidad).toBe('FACTURA');
    expect(audit.datosAnteriores.estado).toBe('borrador');
    expect(audit.datosNuevos.estado).toBe('enviada');
  });

  it('debe_devolver_la_factura_emitida_con_condPartEnviadasFecha_y_condPartAdjuntada_true', async () => {
    const { useCase } = montar();

    const resultado = await useCase.ejecutar(comando());

    expect(resultado.senal.estado).toBe('enviada');
    expect(resultado.condPartEnviadasFecha).toEqual(AHORA);
    expect(resultado.condPartAdjuntada).toBe(true);
  });

  it('debe_orquestar_la_consolidacion_dentro_de_una_unica_unidad_de_trabajo', async () => {
    const { useCase, uow } = montar();

    await useCase.ejecutar(comando());

    expect(uow.ejecutar).toHaveBeenCalledTimes(1);
  });
});

// ===========================================================================
// 3.2 — Atomicidad/rollback: si E3 falla → EmisionEnvioFallidoError; la factura
//        NO pasa a enviada, no se fija cond_part_enviadas_fecha, no se registra
//        COMUNICACION E3 `enviado` (rollback total, orquestación §D-1).
// ===========================================================================

describe('EnviarFacturaSenal — atomicidad estado↔E3 (3.2)', () => {
  it('debe_lanzar_EmisionEnvioFallido_cuando_el_envio_de_E3_falla', async () => {
    const { useCase } = montar({ e3Falla: true });

    await expect(useCase.ejecutar(comando())).rejects.toBeInstanceOf(EmisionEnvioFallidoError);
  });

  it('no_debe_consolidar_nada_cuando_E3_falla', async () => {
    const { useCase, repos } = montar({ e3Falla: true });

    await expect(useCase.ejecutar(comando())).rejects.toBeInstanceOf(EmisionEnvioFallidoError);
    // La factura NO pasa a enviada.
    expect(repos.facturas.emitir).not.toHaveBeenCalled();
    // cond_part_enviadas_fecha NO se fija.
    expect(repos.reservas.fijarCondicionesEnviadas).not.toHaveBeenCalled();
    // La COMUNICACION E3 'enviado' NO se registra.
    const enviadas = repos.comunicaciones.crear.mock.calls.filter(
      (c) => c[0].estado === 'enviado',
    );
    expect(enviadas).toHaveLength(0);
  });

  it('debe_intentar_enviar_E3_ANTES_de_confirmar_los_cambios_de_estado', async () => {
    const { useCase, enviarE3 } = montar({ e3Falla: true });

    await expect(useCase.ejecutar(comando())).rejects.toBeInstanceOf(EmisionEnvioFallidoError);
    expect(enviarE3).toHaveBeenCalledTimes(1);
  });
});

// ===========================================================================
// 3.3 — Guarda de datos: PDF de la señal ausente (pdf_url = null) → NO envía E3,
//        se trata como fallo de emisión (EmisionEnvioFallidoError, 502).
// ===========================================================================

describe('EnviarFacturaSenal — PDF de la señal ausente (3.3)', () => {
  it('debe_lanzar_EmisionEnvioFallido_cuando_la_factura_de_senal_no_tiene_pdf_url', async () => {
    const { useCase } = montar({ senal: facturaSenal({ pdfUrl: null }) });

    await expect(useCase.ejecutar(comando())).rejects.toBeInstanceOf(EmisionEnvioFallidoError);
  });

  it('no_debe_enviar_E3_ni_consolidar_cuando_falta_el_pdf_de_la_senal', async () => {
    const { useCase, enviarE3, repos } = montar({ senal: facturaSenal({ pdfUrl: null }) });

    await expect(useCase.ejecutar(comando())).rejects.toBeInstanceOf(EmisionEnvioFallidoError);
    expect(enviarE3).not.toHaveBeenCalled();
    expect(repos.facturas.emitir).not.toHaveBeenCalled();
    expect(repos.reservas.fijarCondicionesEnviadas).not.toHaveBeenCalled();
  });
});

// ===========================================================================
// 3.4 — Guarda de estado: la factura en `rechazada` NO es enviable →
//        FacturaSenalNoEnviableError (409); no se muta nada ni se envía E3.
// ===========================================================================

describe('EnviarFacturaSenal — estado no enviable (3.4)', () => {
  it('debe_rechazar_con_FacturaSenalNoEnviable_cuando_la_factura_esta_rechazada', async () => {
    const { useCase } = montar({ senal: facturaSenal({ estado: 'rechazada' }) });

    await expect(useCase.ejecutar(comando())).rejects.toBeInstanceOf(
      FacturaSenalNoEnviableError,
    );
  });

  it('no_debe_enviar_E3_ni_mutar_nada_cuando_la_factura_esta_rechazada', async () => {
    const { useCase, enviarE3, repos } = montar({
      senal: facturaSenal({ estado: 'rechazada' }),
    });

    await expect(useCase.ejecutar(comando())).rejects.toBeInstanceOf(
      FacturaSenalNoEnviableError,
    );
    expect(enviarE3).not.toHaveBeenCalled();
    expect(repos.facturas.emitir).not.toHaveBeenCalled();
    expect(repos.reservas.fijarCondicionesEnviadas).not.toHaveBeenCalled();
  });
});

// ===========================================================================
// 3.5 — Idempotencia: COMUNICACION E3 `enviado` previa → E3YaEnviadoError (409),
//        sin re-envío ni duplicado ni regeneración; COMUNICACION E3 `fallido`
//        previa → SÍ permite el reintento (§D-idempotencia).
// ===========================================================================

describe('EnviarFacturaSenal — idempotencia de E3 (3.5)', () => {
  it('debe_rechazar_con_E3YaEnviado_cuando_ya_existe_COMUNICACION_E3_enviado', async () => {
    const { useCase } = montar({ e3Previa: 'enviado' });

    await expect(useCase.ejecutar(comando())).rejects.toBeInstanceOf(E3YaEnviadoError);
  });

  it('no_debe_re_enviar_ni_duplicar_ni_regenerar_cuando_E3_ya_se_envio', async () => {
    const { useCase, enviarE3, generarCondiciones, repos } = montar({ e3Previa: 'enviado' });

    await expect(useCase.ejecutar(comando())).rejects.toBeInstanceOf(E3YaEnviadoError);
    expect(enviarE3).not.toHaveBeenCalled();
    expect(generarCondiciones).not.toHaveBeenCalled();
    expect(repos.comunicaciones.crear).not.toHaveBeenCalled();
    expect(repos.facturas.emitir).not.toHaveBeenCalled();
  });

  it('debe_permitir_el_reintento_cuando_la_COMUNICACION_E3_previa_esta_en_fallido', async () => {
    const { useCase, enviarE3, repos } = montar({
      e3Previa: 'fallido',
      // La factura ya está enviada (fallo previo tras emitir); no se re-emite el número.
      senal: facturaSenal({ estado: 'enviada' }),
    });

    await useCase.ejecutar(comando());

    // El reenvío SÍ dispara E3 y registra la COMUNICACION 'enviado'.
    expect(enviarE3).toHaveBeenCalledTimes(1);
    const enviadas = repos.comunicaciones.crear.mock.calls.filter(
      (c) => c[0].estado === 'enviado',
    );
    expect(enviadas).toHaveLength(1);
  });

  it('debe_permitir_enviar_E3_cuando_la_factura_esta_enviada_pero_sin_COMUNICACION_E3', async () => {
    // §D-guarda-estado: enviada SIN E3 previa (aprobada por otra vía) → se permite enviar E3.
    const { useCase, enviarE3 } = montar({
      senal: facturaSenal({ estado: 'enviada' }),
      e3Previa: null,
    });

    await useCase.ejecutar(comando());

    expect(enviarE3).toHaveBeenCalledTimes(1);
  });
});

// ===========================================================================
// 3.6 — Adjunto de condiciones: si el puerto degrada a `null` o LANZA, E3 se
//        envía SOLO con la factura de señal; condPartAdjuntada = false y el
//        AUDIT_LOG lo traza (§D-adjunto-condiciones). Un throw NO tumba E3.
// ===========================================================================

describe('EnviarFacturaSenal — degradación del adjunto de condiciones (3.6)', () => {
  it('debe_enviar_E3_solo_con_la_senal_cuando_las_condiciones_degradan_a_null', async () => {
    const { useCase, enviarE3 } = montar({ condiciones: 'null' });

    await useCase.ejecutar(comando());

    expect(enviarE3).toHaveBeenCalledTimes(1);
    const adjuntos = enviarE3.mock.calls[0][0].adjuntos as ReadonlyArray<{ pdfUrl: string }>;
    expect(adjuntos.map((a) => a.pdfUrl)).toEqual([
      'https://storage.local/facturas/senal.pdf',
    ]);
  });

  it('no_debe_tumbar_E3_cuando_generarCondiciones_LANZA_una_excepcion', async () => {
    const { useCase, enviarE3, repos } = montar({ condiciones: 'throw' });

    // Un throw del render/subida (p. ej. la flakiness ESM de react-pdf) NO propaga.
    await useCase.ejecutar(comando());

    expect(enviarE3).toHaveBeenCalledTimes(1);
    // La consolidación sí ocurre (la factura se emite).
    expect(repos.facturas.emitir).toHaveBeenCalledTimes(1);
  });

  it('debe_devolver_condPartAdjuntada_false_cuando_las_condiciones_no_se_adjuntan', async () => {
    const { useCase } = montar({ condiciones: 'null' });

    const resultado = await useCase.ejecutar(comando());

    expect(resultado.condPartAdjuntada).toBe(false);
  });

  it('debe_trazar_condPartAdjuntada_false_en_AUDIT_LOG_cuando_se_omiten_las_condiciones', async () => {
    const { useCase, repos } = montar({ condiciones: 'throw' });

    await useCase.ejecutar(comando());

    const trazas = JSON.stringify(repos.auditoria.registrar.mock.calls);
    expect(trazas).toContain('condPartAdjuntada');
    expect(trazas).toContain('false');
  });
});

// ===========================================================================
// 3.7 — 404: no existe factura de señal / reserva cross-tenant (RLS). Ante la
//        guarda de existencia NO se muta nada ni se envía E3.
// ===========================================================================

describe('EnviarFacturaSenal — no encontrada / cross-tenant (3.7)', () => {
  it('debe_rechazar_con_FacturaSenalNoEncontrada_cuando_no_hay_factura_de_senal', async () => {
    const { useCase } = montar({ senal: null });

    await expect(useCase.ejecutar(comando())).rejects.toBeInstanceOf(
      FacturaSenalNoEncontradaError,
    );
  });

  it('debe_rechazar_con_FacturaSenalNoEncontrada_cuando_la_reserva_no_existe_en_el_tenant', async () => {
    const { useCase } = montar({ reserva: null });

    await expect(useCase.ejecutar(comando())).rejects.toBeInstanceOf(
      FacturaSenalNoEncontradaError,
    );
  });

  it('no_debe_enviar_E3_ni_mutar_nada_cuando_la_reserva_es_cross_tenant', async () => {
    const { useCase, enviarE3, repos } = montar({ reserva: null });

    await expect(useCase.ejecutar(comando())).rejects.toBeInstanceOf(
      FacturaSenalNoEncontradaError,
    );
    expect(enviarE3).not.toHaveBeenCalled();
    expect(repos.facturas.emitir).not.toHaveBeenCalled();
  });
});
