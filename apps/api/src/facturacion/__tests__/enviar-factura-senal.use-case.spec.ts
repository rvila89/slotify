/**
 * TESTS del caso de uso `EnviarFacturaSenalUseCase` (US-023 / épico #6) — fase TDD RED.
 *
 * ATENCIÓN — CAMBIO DE SEMÁNTICA (US-023, GAP 1 + GAP 2). Este spec fue escrito para 6.4b
 * (condiciones TOLERANTES: si degradaban a `null` o lanzaban, E3 se enviaba igual con
 * `condPartAdjuntada=false`). US-023 lo REVISA:
 *   - GAP 1 (D-persistencia-documento): el envío confirmado de E3 PERSISTE una fila
 *     `DOCUMENTO tipo='condiciones_particulares'` (url, mime, reserva, tenant) + AUDIT_LOG
 *     `crear`, DENTRO de la tx, e idempotente por reserva. El rollback de E3 no deja
 *     DOCUMENTO huérfano.
 *   - GAP 2 (D-condiciones-bloqueante, DECISIÓN CERRADA/aprobada en el gate SDD —
 *     ENDURECER): las condiciones son REQUISITO DURO. `GenerarPdfCondicionesPort → null`
 *     aborta con `CondicionesNoConfiguradasError` (409) y rollback total; un render que
 *     LANZA aborta con error recuperable (`EmisionEnvioFallidoError`, 502) y rollback. En
 *     el camino feliz E3 va SIEMPRE con ambos adjuntos y `condPartAdjuntada=true` (nunca
 *     puede ser `false` en un 200).
 *
 * Cobertura tasks.md Fase 3: 3.1 (persistir DOCUMENTO + AUDIT_LOG crear), 3.2
 * (idempotencia del DOCUMENTO + rollback sin huérfano), 3.3 (condiciones `null` → 409;
 * render que lanza → recuperable; rollback total), 3.4 (camino feliz endurecido, ambos
 * adjuntos), más las guardas heredadas (estado, idempotencia E3, 404 RLS, atomicidad E3).
 *
 * Trazabilidad: spec-delta `documentos` (ADDED "Persistencia idempotente del DOCUMENTO…",
 * MODIFIED "El fallo del adjunto de condicions particulars…"); design.md
 * §D-persistencia-documento, §D-condiciones-bloqueante, §Atomicidad.
 *
 * Espejo de estilo: dobles de puertos in-memory (hexagonal, hook `no-infra-in-domain`),
 * sin Prisma, sin react-pdf. RED: el símbolo `CondicionesNoConfiguradasError` aún no existe
 * en el use-case y la implementación viva sigue siendo tolerante (`.catch(() => null)`) y
 * NO persiste el DOCUMENTO → los nuevos asserts FALLAN. GREEN es de `backend-developer`.
 */
import {
  EnviarFacturaSenalUseCase,
  FacturaSenalNoEncontradaError,
  FacturaSenalNoEnviableError,
  E3YaEnviadoError,
  EmisionEnvioFallidoError,
  // GAP 2 — nuevo error de negocio "condiciones no configuradas" (mapea a 409). En RED este
  // símbolo aún NO está exportado por el use-case → el import falla y toda la batería
  // arranca en ROJO por AUSENCIA DE IMPLEMENTACIÓN.
  CondicionesNoConfiguradasError,
  type EnviarFacturaSenalDeps,
  type EnviarFacturaSenalComando,
  type FacturaSenalEmitible,
  type ReservaSenalEmision,
  type RepositoriosSenalEmision,
  type UnidadDeTrabajoSenalEmisionPort,
  type ClockPort,
} from '../application/enviar-factura-senal.use-case';

// ---------------------------------------------------------------------------
// GAP 1 — Puerto de dominio NUEVO para persistir el DOCUMENTO de condiciones.
// Se declara aquí (mínimo tipado) para poder montar el doble; la interfaz real
// y el adaptador Prisma los crea el backend-developer (documentos/domain +
// documentos/infrastructure). tx-bound: vive dentro de la unidad de trabajo del
// envío E3. Fuente: design.md §D-persistencia-documento.
// ---------------------------------------------------------------------------

/** Proyección mínima del DOCUMENTO persistido. */
interface DocumentoPersistido {
  idDocumento: string;
  tipo: 'condiciones_particulares';
  reservaId: string;
  tenantId: string;
  url: string;
  mimeType: string;
}

/** Puerto de repositorio de DOCUMENTO (tx-bound), idempotente por reserva+tipo. */
interface DocumentoRepositoryPort {
  buscarPorReservaYTipo(params: {
    reservaId: string;
    tenantId: string;
    tipo: 'condiciones_particulares';
  }): Promise<DocumentoPersistido | null>;
  crear(params: {
    reservaId: string;
    tenantId: string;
    tipo: 'condiciones_particulares';
    url: string;
    mimeType: string;
    nombreArchivo?: string;
    tamanoBytes?: number;
  }): Promise<DocumentoPersistido>;
}

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
  // GAP 1 — repositorio tx-bound del DOCUMENTO de condiciones (idempotente).
  documentos: DocumentoRepositoryPort & {
    buscarPorReservaYTipo: jest.Mock;
    crear: jest.Mock;
  };
}

const crearReposFake = (opciones: {
  senal?: FacturaSenalEmitible | null;
  ultimoNumero?: string | null;
  /** Estado de la COMUNICACION E3 previa, o null si no hay ninguna. */
  e3Previa?: string | null;
  /** DOCUMENTO de condiciones YA existente (GAP 1: idempotencia), o null si no hay. */
  documentoPrevio?: DocumentoPersistido | null;
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
  documentos: {
    buscarPorReservaYTipo: jest.fn(async () =>
      'documentoPrevio' in opciones ? (opciones.documentoPrevio ?? null) : null,
    ),
    crear: jest.fn(
      async (p: {
        reservaId: string;
        tenantId: string;
        tipo: 'condiciones_particulares';
        url: string;
        mimeType: string;
      }): Promise<DocumentoPersistido> => ({ idDocumento: 'doc-cond-1', ...p }),
    ),
  } as ReposFake['documentos'],
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
  /** DOCUMENTO de condiciones YA existente (GAP 1: idempotencia). */
  documentoPrevio?: DocumentoPersistido | null;
} = {}) => {
  const reserva = 'reserva' in opciones ? opciones.reserva : reservaEmision();
  const repos = crearReposFake({
    ...('senal' in opciones ? { senal: opciones.senal } : {}),
    ...('e3Previa' in opciones ? { e3Previa: opciones.e3Previa } : {}),
    ...('documentoPrevio' in opciones ? { documentoPrevio: opciones.documentoPrevio } : {}),
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

/** AUDIT_LOG con accion='crear' sobre la entidad DOCUMENTO (GAP 1). */
const auditDocumentoCrear = (
  repos: ReposFake,
): Record<string, any> | undefined =>
  repos.auditoria.registrar.mock.calls
    .map((c) => c[0])
    .find((a) => a.accion === 'crear' && a.entidad === 'DOCUMENTO');

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
// GAP 2 — 3.3: CONDICIONES BLOQUEANTES (ENDURECIDO, decisión cerrada del gate
//        SDD, revierte 6.4b). `GenerarPdfCondicionesPort → null` → aborta con
//        CondicionesNoConfiguradasError (409) y ROLLBACK TOTAL (factura sigue en
//        `borrador`, NO se envía E3, NO se persiste DOCUMENTO,
//        cond_part_enviadas_fecha permanece NULL). Un render que LANZA → error
//        recuperable (EmisionEnvioFallidoError, 502) + rollback total.
//        Fuente: design.md §D-condiciones-bloqueante; spec-delta documentos
//        (MODIFIED). NOTA: sustituye a los tests tolerantes de 6.4b (antigua
//        sección "degradación del adjunto de condiciones"), que asertaban
//        condPartAdjuntada=false con 200 — semántica ya NO válida.
// ===========================================================================

describe('EnviarFacturaSenal — condiciones bloqueantes: null (GAP 2, 3.3)', () => {
  it('debe_abortar_con_CondicionesNoConfiguradas_cuando_el_puerto_devuelve_null', async () => {
    const { useCase } = montar({ condiciones: 'null' });

    await expect(useCase.ejecutar(comando())).rejects.toBeInstanceOf(
      CondicionesNoConfiguradasError,
    );
  });

  it('no_debe_enviar_E3_ni_consolidar_ni_persistir_DOCUMENTO_cuando_no_hay_condiciones', async () => {
    const { useCase, enviarE3, repos } = montar({ condiciones: 'null' });

    await expect(useCase.ejecutar(comando())).rejects.toBeInstanceOf(
      CondicionesNoConfiguradasError,
    );
    // NO se envía E3.
    expect(enviarE3).not.toHaveBeenCalled();
    // La factura permanece en `borrador` (no se emite).
    expect(repos.facturas.emitir).not.toHaveBeenCalled();
    // cond_part_enviadas_fecha permanece NULL (no se fija).
    expect(repos.reservas.fijarCondicionesEnviadas).not.toHaveBeenCalled();
    // NO se persiste el DOCUMENTO de condiciones.
    expect(repos.documentos.crear).not.toHaveBeenCalled();
  });
});

// ===========================================================================
// GAP 2 — 3.3bis: la GENERACIÓN de condiciones que LANZA (fallo de render/subida,
//        p. ej. flakiness ESM de react-pdf) → error RECUPERABLE (reintentable,
//        EmisionEnvioFallidoError → 502) con ROLLBACK TOTAL, sin consolidar la
//        emisión. Fuente: design.md §D-condiciones-bloqueante, spec-delta
//        documentos (Scenario "Un fallo de render de condiciones aborta la
//        emisión de forma recuperable").
// ===========================================================================

describe('EnviarFacturaSenal — condiciones bloqueantes: render que lanza (GAP 2, 3.3bis)', () => {
  it('debe_abortar_con_error_recuperable_cuando_la_generacion_de_condiciones_lanza', async () => {
    const { useCase } = montar({ condiciones: 'throw' });

    await expect(useCase.ejecutar(comando())).rejects.toBeInstanceOf(
      EmisionEnvioFallidoError,
    );
  });

  it('no_debe_consolidar_la_emision_cuando_la_generacion_de_condiciones_lanza', async () => {
    const { useCase, enviarE3, repos } = montar({ condiciones: 'throw' });

    await expect(useCase.ejecutar(comando())).rejects.toBeInstanceOf(
      EmisionEnvioFallidoError,
    );
    expect(enviarE3).not.toHaveBeenCalled();
    expect(repos.facturas.emitir).not.toHaveBeenCalled();
    expect(repos.reservas.fijarCondicionesEnviadas).not.toHaveBeenCalled();
    expect(repos.documentos.crear).not.toHaveBeenCalled();
  });
});

// ===========================================================================
// GAP 2 — 3.4: CAMINO FELIZ ENDURECIDO. Con condiciones OK, E3 se envía con AMBOS
//        adjuntos, condPartAdjuntada = true (nunca false en un 200), y el
//        DOCUMENTO de condiciones queda persistido. Fuente: design.md
//        §D-condiciones-bloqueante, spec-delta documentos (Scenario "Con
//        condiciones configuradas, E3 se envía con ambos adjuntos").
// ===========================================================================

describe('EnviarFacturaSenal — camino feliz endurecido con condiciones (GAP 2, 3.4)', () => {
  it('debe_enviar_E3_con_AMBOS_adjuntos_senal_y_condiciones', async () => {
    const { useCase, enviarE3 } = montar();

    await useCase.ejecutar(comando());

    expect(enviarE3).toHaveBeenCalledTimes(1);
    const adjuntos = enviarE3.mock.calls[0][0].adjuntos as ReadonlyArray<{ pdfUrl: string }>;
    expect(adjuntos.map((a) => a.pdfUrl)).toEqual(
      expect.arrayContaining([
        'https://storage.local/facturas/senal.pdf',
        URL_PDF_CONDICIONES,
      ]),
    );
    expect(adjuntos).toHaveLength(2);
  });

  it('debe_devolver_condPartAdjuntada_true_en_el_camino_feliz', async () => {
    const { useCase } = montar();

    const resultado = await useCase.ejecutar(comando());

    expect(resultado.condPartAdjuntada).toBe(true);
  });

  it('debe_persistir_el_DOCUMENTO_de_condiciones_en_el_camino_feliz', async () => {
    const { useCase, repos } = montar();

    await useCase.ejecutar(comando());

    expect(repos.documentos.crear).toHaveBeenCalledTimes(1);
  });
});

// ===========================================================================
// GAP 1 — 3.1: el PRIMER envío confirmado de E3 PERSISTE una fila DOCUMENTO
//        tipo='condiciones_particulares' (url del PDF, mime application/pdf,
//        reserva, tenant) DENTRO de la tx, y registra AUDIT_LOG accion='crear'
//        para ese DOCUMENTO. Fuente: spec-delta documentos (ADDED); design.md
//        §D-persistencia-documento.
// ===========================================================================

describe('EnviarFacturaSenal — persistencia del DOCUMENTO de condiciones (GAP 1, 3.1)', () => {
  it('debe_persistir_DOCUMENTO_condiciones_con_url_mime_reserva_y_tenant', async () => {
    const { useCase, repos } = montar();

    await useCase.ejecutar(comando());

    expect(repos.documentos.crear).toHaveBeenCalledTimes(1);
    const args = repos.documentos.crear.mock.calls[0][0];
    expect(args.tipo).toBe('condiciones_particulares');
    expect(args.url).toBe(URL_PDF_CONDICIONES);
    expect(args.mimeType).toBe('application/pdf');
    expect(args.reservaId).toBe(RESERVA_ID);
    expect(args.tenantId).toBe(TENANT);
  });

  it('debe_buscar_por_reserva_y_tipo_ANTES_de_crear_el_DOCUMENTO_para_idempotencia', async () => {
    const { useCase, repos } = montar();

    await useCase.ejecutar(comando());

    expect(repos.documentos.buscarPorReservaYTipo).toHaveBeenCalledWith(
      expect.objectContaining({
        reservaId: RESERVA_ID,
        tenantId: TENANT,
        tipo: 'condiciones_particulares',
      }),
    );
  });

  it('debe_registrar_AUDIT_LOG_crear_para_el_DOCUMENTO_persistido', async () => {
    const { useCase, repos } = montar();

    await useCase.ejecutar(comando());

    const audit = auditDocumentoCrear(repos);
    expect(audit).toBeDefined();
    expect(audit!.entidad).toBe('DOCUMENTO');
    expect(audit!.accion).toBe('crear');
  });

  it('debe_persistir_el_DOCUMENTO_dentro_de_la_unica_unidad_de_trabajo', async () => {
    const { useCase, uow } = montar();

    await useCase.ejecutar(comando());

    // La creación del DOCUMENTO se integra en la misma tx del envío E3.
    expect(uow.ejecutar).toHaveBeenCalledTimes(1);
  });
});

// ===========================================================================
// GAP 1 — 3.2: IDEMPOTENCIA + rollback. Si ya existe el DOCUMENTO de condiciones
//        para la reserva, se REUTILIZA (no crea 2ª fila, no 2º AUDIT_LOG
//        'crear'). Si E3 falla dentro de la tx → rollback → no queda DOCUMENTO
//        huérfano persistido. Fuente: spec-delta documentos (Scenarios "…se
//        reutiliza sin duplicar" y "El rollback… no deja DOCUMENTO huérfano");
//        design.md §D-persistencia-documento, §Atomicidad.
// ===========================================================================

const documentoExistente: DocumentoPersistido = {
  idDocumento: 'doc-cond-existente',
  tipo: 'condiciones_particulares',
  reservaId: RESERVA_ID,
  tenantId: TENANT,
  url: URL_PDF_CONDICIONES,
  mimeType: 'application/pdf',
};

describe('EnviarFacturaSenal — idempotencia del DOCUMENTO de condiciones (GAP 1, 3.2)', () => {
  it('no_debe_crear_una_segunda_fila_DOCUMENTO_cuando_ya_existe_uno_para_la_reserva', async () => {
    const { useCase, repos } = montar({ documentoPrevio: documentoExistente });

    await useCase.ejecutar(comando());

    // Se reutiliza el existente: no se crea otra fila.
    expect(repos.documentos.crear).not.toHaveBeenCalled();
  });

  it('no_debe_registrar_un_segundo_AUDIT_LOG_crear_cuando_el_DOCUMENTO_ya_existe', async () => {
    const { useCase, repos } = montar({ documentoPrevio: documentoExistente });

    await useCase.ejecutar(comando());

    expect(auditDocumentoCrear(repos)).toBeUndefined();
  });

  it('no_debe_dejar_DOCUMENTO_huerfano_cuando_el_envio_de_E3_falla', async () => {
    // El DOCUMENTO se crea DENTRO de la tx SOLO tras confirmar E3; si E3 falla
    // antes, no debe haberse creado (y en producción la tx revierte). No debe
    // quedar ninguna fila DOCUMENTO persistida.
    const { useCase, repos } = montar({ e3Falla: true });

    await expect(useCase.ejecutar(comando())).rejects.toBeInstanceOf(EmisionEnvioFallidoError);
    expect(repos.documentos.crear).not.toHaveBeenCalled();
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
