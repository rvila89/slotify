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
  const deps: EnviarFacturaSenalDeps = {
    unidadDeTrabajo: uow,
    cargarReserva,
    enviarE3,
    clock: relojFijo,
  };
  return {
    useCase: new EnviarFacturaSenalUseCase(deps),
    repos,
    uow,
    cargarReserva,
    enviarE3,
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
//        adjunta, COMUNICACION E3 `enviado`, AUDIT_LOG `actualizar`.
//        Mejora B: E3 ya NO toca las condiciones (van en E2).
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

  it('debe_devolver_la_factura_emitida_con_estado_enviada', async () => {
    const { useCase } = montar();

    const resultado = await useCase.ejecutar(comando());

    expect(resultado.senal.estado).toBe('enviada');
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

  it('no_debe_re_enviar_ni_duplicar_cuando_E3_ya_se_envio', async () => {
    const { useCase, enviarE3, repos } = montar({ e3Previa: 'enviado' });

    await expect(useCase.ejecutar(comando())).rejects.toBeInstanceOf(E3YaEnviadoError);
    expect(enviarE3).not.toHaveBeenCalled();
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
// MEJORA B (change `condiciones-idioma-e2-firma-banner`) — las CONDICIONES se
// envían ahora en E2 (confirmar presupuesto), NO en E3. `EnviarFacturaSenalUseCase`
// deja de tener nada que ver con condiciones:
//   · El array de adjuntos de E3 contiene SOLO `{ clave: 'senal', ... }`
//     (sin `{ clave: 'condiciones' }`).
//   · `repos.reservas.fijarCondicionesEnviadas` NUNCA se llama (deja de existir en
//     el repositorio tx-bound de reservas del E3).
//   · El use-case ya no depende de `generarCondiciones`.
// RED: la implementación viva (6.4b/GAP2) SÍ adjunta condiciones y SÍ llama a
// `fijarCondicionesEnviadas`; estos asserts FALLAN. GREEN es de `backend-developer`.
// ===========================================================================

/**
 * Monta el use-case SIN el puerto `generarCondiciones` (post-Mejora B, ya no es
 * dependencia). El `enviarE3` y el `cargarReserva` se mantienen; los repos se reusan.
 * Se inyecta vía cast porque en RED la firma `EnviarFacturaSenalDeps` aún incluye
 * `generarCondiciones`; la firma reducida la aplica el backend-developer.
 */
const montarSinCondiciones = () => {
  const repos = crearReposFake();
  const uow = crearUowFake(repos);
  const cargarReserva = jest.fn(async () => reservaEmision());
  const enviarE3 = jest.fn(async (_params: Record<string, unknown>) => ({
    idComunicacion: 'com-e3-1',
    estado: 'enviado' as const,
    fechaEnvio: AHORA,
  }));
  const deps = {
    unidadDeTrabajo: uow,
    cargarReserva,
    enviarE3,
    clock: relojFijo,
  } as unknown as EnviarFacturaSenalDeps;
  return { useCase: new EnviarFacturaSenalUseCase(deps), repos, uow, enviarE3 };
};

describe('EnviarFacturaSenal — sin condiciones en E3 (Mejora B)', () => {
  it('debe_enviar_E3_con_UN_solo_adjunto_de_clave_senal_sin_condiciones', async () => {
    const { useCase, enviarE3 } = montarSinCondiciones();

    await useCase.ejecutar(comando());

    expect(enviarE3).toHaveBeenCalledTimes(1);
    const adjuntos = enviarE3.mock.calls[0][0].adjuntos as ReadonlyArray<{ clave: string }>;
    // SOLO la señal: ni una entrada de condiciones.
    expect(adjuntos).toHaveLength(1);
    expect(adjuntos[0].clave).toBe('senal');
    expect(adjuntos.some((a) => a.clave === 'condiciones')).toBe(false);
  });

  it('NUNCA_debe_llamar_a_fijarCondicionesEnviadas_al_enviar_E3', async () => {
    const { useCase, repos } = montarSinCondiciones();

    await useCase.ejecutar(comando());

    expect(repos.reservas.fijarCondicionesEnviadas).not.toHaveBeenCalled();
  });
});

// ===========================================================================
// IDIOMA + NOMBRE ADJUNTO — factura-senal-pdf-idioma-email-ux (TDD RED).
//
// `ReservaSenalEmision` debe incluir `idioma`, `clienteNombre`, `clienteApellidos`.
// El use-case debe:
//   1. Propagar `idioma` en `EnviarE3EmisionParams` para que el adapter seleccione
//      la plantilla correcta del catálogo.
//   2. Nombrar el adjunto de la señal como
//      `{numeroFactura} {clienteNombre} {clienteApellidos}.pdf`.
//
// RED: `ReservaSenalEmision` no tiene estos campos; `EnviarE3EmisionParams` tampoco;
// el adjunto usa `'factura-senal.pdf'` hardcodeado → los asserts FALLAN. GREEN es de
// `backend-developer`.
// ===========================================================================

const reservaEmisionConIdioma = (
  over: Partial<ReservaSenalEmision> = {},
): ReservaSenalEmision => ({
  ...reservaEmision(),
  // Los campos nuevos no existen aún en ReservaSenalEmision → error de tipo (RED)
  ...(({ idioma: 'es', clienteNombre: 'Sergio', clienteApellidos: 'Carrasco' }) as unknown as Partial<ReservaSenalEmision>),
  ...over,
});

describe('EnviarFacturaSenal — idioma propagado a E3 (factura-senal-pdf-idioma-email-ux)', () => {
  it('debe_propagar_idioma_es_en_los_params_de_envio_E3', async () => {
    const { useCase, enviarE3 } = montar({
      reserva: reservaEmisionConIdioma({ ...(({ idioma: 'es' }) as unknown as Partial<ReservaSenalEmision>) }),
    });

    await useCase.ejecutar(comando());

    const args = enviarE3.mock.calls[0][0];
    // `idioma` debe viajar en los params para que el adapter del catálogo lo use.
    expect((args as Record<string, unknown>).idioma).toBe('es');
  });

  it('debe_propagar_idioma_ca_en_los_params_de_envio_E3', async () => {
    const { useCase, enviarE3 } = montar({
      reserva: reservaEmisionConIdioma({ ...(({ idioma: 'ca' }) as unknown as Partial<ReservaSenalEmision>) }),
    });

    await useCase.ejecutar(comando());

    const args = enviarE3.mock.calls[0][0];
    expect((args as Record<string, unknown>).idioma).toBe('ca');
  });
});

describe('EnviarFacturaSenal — nombre del adjunto con nombre cliente (factura-senal-pdf-idioma-email-ux)', () => {
  it('debe_nombrar_el_adjunto_senal_con_el_numero_factura_y_el_nombre_del_cliente', async () => {
    const { useCase, enviarE3 } = montar({ reserva: reservaEmisionConIdioma() });

    await useCase.ejecutar(comando());

    const adjuntos = enviarE3.mock.calls[0][0].adjuntos as ReadonlyArray<{
      clave: string;
      nombre: string;
      pdfUrl: string;
    }>;
    const adjuntoSenal = adjuntos.find((a) => a.clave === 'senal');
    // Formato: `{numeroFactura} {clienteNombre} {clienteApellidos}.pdf`
    // La factura piloto tiene numeroFactura='F-2026-0007', clienteNombre='Sergio', clienteApellidos='Carrasco'.
    expect(adjuntoSenal?.nombre).toBe('F-2026-0007 Sergio Carrasco.pdf');
  });

  it('debe_usar_Factura_como_fallback_cuando_el_numero_de_factura_es_null', async () => {
    const { useCase, enviarE3 } = montar({
      senal: facturaSenal({ numeroFactura: null }),
      reserva: reservaEmisionConIdioma(),
    });

    await useCase.ejecutar(comando());

    const adjuntos = enviarE3.mock.calls[0][0].adjuntos as ReadonlyArray<{
      clave: string;
      nombre: string;
    }>;
    const adjuntoSenal = adjuntos.find((a) => a.clave === 'senal');
    expect(adjuntoSenal?.nombre).toBe('Factura Sergio Carrasco.pdf');
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
