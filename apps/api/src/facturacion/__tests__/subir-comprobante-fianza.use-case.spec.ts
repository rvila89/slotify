/**
 * TESTS del caso de uso `SubirComprobanteFianzaUseCase`
 * (fix-liquidacion-fianza-independientes / UC-22) — espejo de `registrar-firma-condiciones`.
 *
 * Trazabilidad: spec-delta `facturacion` ADDED "Subida pasiva del comprobante de la fianza
 * recibida"; design.md §D-2. La fianza deja de ser una FACTURA: subir el comprobante crea un
 * DOCUMENTO `tipo='comprobante_fianza'`, marca `fianza_status='cobrada'` +
 * `fianza_cobrada_fecha` + `fianza_comprobante_fecha`, y audita `accion='actualizar'`. Es
 * OPCIONAL, re-subible (histórico conservado, NO idempotente) y NO transiciona la máquina de
 * estados ni bloquea ningún avance.
 *
 * Guardas síncronas previas a la tx: existencia (404) → estado válido {reserva_confirmada,
 * evento_en_curso, post_evento} (422) → fichero presente / mime {jpeg,png,pdf} / ≤ 10 MB (422).
 *
 * Dobles de puertos in-memory (hexagonal, hook `no-infra-in-domain`), sin Prisma. Reloj
 * inyectado (determinismo).
 */
import {
  SubirComprobanteFianzaUseCase,
  ReservaNoEncontradaError,
  EstadoInvalidoError,
  ComprobanteRequeridoError,
  FormatoNoPermitidoError,
  TamanoExcedidoError,
  type SubirComprobanteFianzaDeps,
  type SubirComprobanteFianzaComando,
  type ComprobanteFianzaSubido,
  type ReservaComprobanteFianza,
  type RepositoriosComprobanteFianza,
  type UnidadDeTrabajoComprobanteFianzaPort,
  type ClockPort,
} from '../application/subir-comprobante-fianza.use-case';

const TENANT = '00000000-0000-0000-0000-000000000001';
const OTRO_TENANT = '00000000-0000-0000-0000-0000000000ff';
const GESTOR = '00000000-0000-0000-0000-000000000002';
const RESERVA_ID = 'res-confirmada';
const MB = 1024 * 1024;

const AHORA = new Date('2026-07-20T10:00:00.000Z');
const relojFijo: ClockPort = { ahora: () => AHORA };

// ---------------------------------------------------------------------------
// Dobles de datos: RESERVA en reserva_confirmada con la fianza pendiente.
// ---------------------------------------------------------------------------

const reservaValida = (
  over: Partial<ReservaComprobanteFianza> = {},
): ReservaComprobanteFianza => ({
  idReserva: RESERVA_ID,
  tenantId: TENANT,
  estado: 'reserva_confirmada',
  fianzaStatus: 'pendiente',
  ...over,
});

const comprobanteValido = (
  over: Partial<ComprobanteFianzaSubido> = {},
): ComprobanteFianzaSubido => ({
  nombreArchivo: 'comprobante-fianza.pdf',
  mimeType: 'application/pdf',
  tamanoBytes: 1 * MB,
  buffer: Buffer.from('%PDF-1.4 fake comprobante'),
  ...over,
});

// ---------------------------------------------------------------------------
// Repositorios + UoW fake.
// ---------------------------------------------------------------------------

interface ReposFake extends RepositoriosComprobanteFianza {
  documentos: { crear: jest.Mock };
  reservas: { marcarComprobante: jest.Mock };
  auditoria: { registrar: jest.Mock };
}

type PuntoDeFallo = 'crear' | 'marcarComprobante' | 'auditoria';

const crearReposFake = (opciones: { fallarEn?: PuntoDeFallo } = {}): ReposFake => ({
  documentos: {
    crear: jest.fn(async (d: Record<string, unknown>) => {
      if (opciones.fallarEn === 'crear') throw new Error('FALLO_CREAR');
      return {
        idDocumento: 'doc-comprobante-1',
        tipo: 'comprobante_fianza',
        reservaId: RESERVA_ID,
        tenantId: TENANT,
        url: 'https://docs/comprobante-1.pdf',
        mimeType: 'application/pdf',
        ...d,
      };
    }),
  },
  reservas: {
    marcarComprobante: jest.fn(async () => {
      if (opciones.fallarEn === 'marcarComprobante') throw new Error('FALLO_MARCARCOMPROBANTE');
      return undefined;
    }),
  },
  auditoria: {
    registrar: jest.fn(async () => {
      if (opciones.fallarEn === 'auditoria') throw new Error('FALLO_AUDITORIA');
      return undefined;
    }),
  },
});

const crearUowFake = (
  repos: ReposFake,
): UnidadDeTrabajoComprobanteFianzaPort & { ejecutar: jest.Mock } => ({
  ejecutar: jest.fn(
    async <T,>(_tenantId: string, trabajo: (r: RepositoriosComprobanteFianza) => Promise<T>) =>
      trabajo(repos),
  ),
});

const montar = (opciones: {
  reserva?: ReservaComprobanteFianza | null;
  fallarEn?: PuntoDeFallo;
  almacenarUrl?: string;
} = {}) => {
  const reserva = 'reserva' in opciones ? opciones.reserva : reservaValida();
  const repos = crearReposFake({ fallarEn: opciones.fallarEn });
  const uow = crearUowFake(repos);
  const cargarReserva = jest.fn(async () => reserva);
  const almacenarComprobante = jest.fn(
    async () => opciones.almacenarUrl ?? 'https://docs/comprobante-1.pdf',
  );
  const deps: SubirComprobanteFianzaDeps = {
    unidadDeTrabajo: uow,
    cargarReserva,
    almacenarComprobante,
    clock: relojFijo,
  };
  return {
    useCase: new SubirComprobanteFianzaUseCase(deps),
    repos,
    uow,
    cargarReserva,
    almacenarComprobante,
    deps,
  };
};

const comando = (
  over: Partial<SubirComprobanteFianzaComando> = {},
): SubirComprobanteFianzaComando => ({
  tenantId: TENANT,
  usuarioId: GESTOR,
  reservaId: RESERVA_ID,
  comprobante: comprobanteValido(),
  ...over,
});

// ===========================================================================
// Camino feliz: crea DOCUMENTO comprobante_fianza, marca la fianza como cobrada
// (con fechas), audita `actualizar`. NO transiciona.
// ===========================================================================

describe('SubirComprobanteFianza — camino feliz (comprobante recibido)', () => {
  it('debe_crear_un_DOCUMENTO_comprobante_fianza_con_url_y_mime_del_fichero', async () => {
    const { useCase, repos, almacenarComprobante } = montar({
      almacenarUrl: 'https://docs/comprobante-99.png',
    });

    await useCase.ejecutar(
      comando({ comprobante: comprobanteValido({ mimeType: 'image/png', nombreArchivo: 'compr.png' }) }),
    );

    expect(almacenarComprobante).toHaveBeenCalledTimes(1);
    expect(repos.documentos.crear).toHaveBeenCalledTimes(1);
    const args = repos.documentos.crear.mock.calls[0][0];
    expect(args.tipo).toBe('comprobante_fianza');
    expect(args.reservaId).toBe(RESERVA_ID);
    expect(args.tenantId).toBe(TENANT);
    expect(args.url).toBe('https://docs/comprobante-99.png');
    expect(args.mimeType).toBe('image/png');
    expect(args.nombreArchivo).toBe('compr.png');
  });

  it('debe_marcar_fianza_status_cobrada_con_fianza_cobrada_fecha_y_fianza_comprobante_fecha', async () => {
    const { useCase, repos } = montar();

    await useCase.ejecutar(comando());

    expect(repos.reservas.marcarComprobante).toHaveBeenCalledTimes(1);
    const args = repos.reservas.marcarComprobante.mock.calls[0][0];
    expect(args.idReserva).toBe(RESERVA_ID);
    expect(args.fianzaStatus).toBe('cobrada');
    expect(args.fianzaCobradaFecha).toEqual(AHORA);
    expect(args.fianzaComprobanteFecha).toEqual(AHORA);
  });

  it('debe_registrar_AUDIT_LOG_accion_actualizar_entidad_RESERVA_nunca_transicion', async () => {
    const { useCase, repos } = montar();

    await useCase.ejecutar(comando());

    expect(repos.auditoria.registrar).toHaveBeenCalledTimes(1);
    const args = repos.auditoria.registrar.mock.calls[0][0];
    expect(args.accion).toBe('actualizar');
    expect(args.accion).not.toBe('transicion');
    expect(args.entidad).toBe('RESERVA');
    expect(args.entidadId).toBe(RESERVA_ID);
    expect(args.datosAnteriores.fianzaStatus).toBe('pendiente');
    expect(args.datosNuevos.fianzaStatus).toBe('cobrada');
  });

  it('no_debe_transicionar_estado_ni_tocar_otros_sub_procesos', async () => {
    const { useCase, repos } = montar();

    await useCase.ejecutar(comando());

    const args = repos.reservas.marcarComprobante.mock.calls[0][0];
    expect(args).not.toHaveProperty('estado');
    expect(args).not.toHaveProperty('liquidacionStatus');
    expect(args).not.toHaveProperty('preEventoStatus');
  });

  it('debe_devolver_el_resultado_con_el_documento_y_las_fechas', async () => {
    const { useCase } = montar();

    const resultado = await useCase.ejecutar(comando());

    expect(resultado.fianzaStatus).toBe('cobrada');
    expect(resultado.fianzaCobradaFecha).toEqual(AHORA);
    expect(resultado.fianzaComprobanteFecha).toEqual(AHORA);
    expect(resultado.documento.idDocumento).toBe('doc-comprobante-1');
  });

  it('debe_orquestar_todo_dentro_de_una_unica_unidad_de_trabajo', async () => {
    const { useCase, uow } = montar();

    await useCase.ejecutar(comando());

    expect(uow.ejecutar).toHaveBeenCalledTimes(1);
  });
});

// ===========================================================================
// Aceptación por estado válido {reserva_confirmada, evento_en_curso, post_evento}.
// ===========================================================================

describe('SubirComprobanteFianza — estados válidos', () => {
  it.each(['reserva_confirmada', 'evento_en_curso', 'post_evento'])(
    'debe_aceptar_la_subida_en_el_estado_valido_%s',
    async (estado) => {
      const { useCase, repos } = montar({ reserva: reservaValida({ estado }) });

      await expect(useCase.ejecutar(comando())).resolves.toBeDefined();

      expect(repos.documentos.crear).toHaveBeenCalledTimes(1);
      expect(repos.reservas.marcarComprobante).toHaveBeenCalledTimes(1);
    },
  );
});

// ===========================================================================
// Re-subible (no idempotente): con la fianza ya cobrada, otra subida crea OTRA
// fila DOCUMENTO y actualiza las fechas, conservando el histórico.
// ===========================================================================

describe('SubirComprobanteFianza — re-subible conservando el histórico', () => {
  it('debe_crear_otra_fila_DOCUMENTO_cuando_ya_estaba_cobrada', async () => {
    const { useCase, repos } = montar({
      reserva: reservaValida({ fianzaStatus: 'cobrada' }),
    });

    await expect(useCase.ejecutar(comando())).resolves.toBeDefined();

    // No idempotente: siempre crea una nueva fila (no busca ni borra la anterior).
    expect(repos.documentos.crear).toHaveBeenCalledTimes(1);
    expect((repos.documentos as Record<string, unknown>).buscarPorReservaYTipo).toBeUndefined();
  });

  it('debe_auditar_datos_anteriores_fianza_status_cobrada_en_la_re_subida', async () => {
    const { useCase, repos } = montar({
      reserva: reservaValida({ fianzaStatus: 'cobrada' }),
    });

    await useCase.ejecutar(comando());

    const args = repos.auditoria.registrar.mock.calls[0][0];
    expect(args.datosAnteriores.fianzaStatus).toBe('cobrada');
    expect(args.datosNuevos.fianzaStatus).toBe('cobrada');
  });
});

// ===========================================================================
// Validación del fichero (síncrona, ANTES de la tx): ausente / mime / > 10 MB.
// Todos sin efectos.
// ===========================================================================

describe('SubirComprobanteFianza — validación del fichero → 422', () => {
  it('debe_lanzar_ComprobanteRequerido_cuando_no_se_adjunta_fichero_sin_efectos', async () => {
    const { useCase, repos, uow, almacenarComprobante } = montar();

    const promesa = useCase.ejecutar(comando({ comprobante: null }));
    await expect(promesa).rejects.toBeInstanceOf(ComprobanteRequeridoError);

    expect(uow.ejecutar).not.toHaveBeenCalled();
    expect(almacenarComprobante).not.toHaveBeenCalled();
    expect(repos.documentos.crear).not.toHaveBeenCalled();
    expect(repos.reservas.marcarComprobante).not.toHaveBeenCalled();
  });

  it.each(['application/msword', 'text/plain', 'application/octet-stream'])(
    'debe_lanzar_FormatoNoPermitido_para_mime_%s_sin_efectos',
    async (mimeType) => {
      const { useCase, repos, uow, almacenarComprobante } = montar();

      const promesa = useCase.ejecutar(
        comando({ comprobante: comprobanteValido({ mimeType, nombreArchivo: 'doc.docx' }) }),
      );
      await expect(promesa).rejects.toBeInstanceOf(FormatoNoPermitidoError);

      expect(uow.ejecutar).not.toHaveBeenCalled();
      expect(almacenarComprobante).not.toHaveBeenCalled();
      expect(repos.documentos.crear).not.toHaveBeenCalled();
    },
  );

  it.each(['image/jpeg', 'image/png', 'application/pdf'])(
    'debe_aceptar_el_formato_permitido_%s',
    async (mimeType) => {
      const { useCase, repos } = montar();

      await useCase.ejecutar(comando({ comprobante: comprobanteValido({ mimeType }) }));

      expect(repos.documentos.crear).toHaveBeenCalledTimes(1);
      expect(repos.documentos.crear.mock.calls[0][0].mimeType).toBe(mimeType);
    },
  );

  it('debe_lanzar_TamanoExcedido_cuando_el_fichero_supera_10_MB_sin_efectos', async () => {
    const { useCase, repos, uow, almacenarComprobante } = montar();

    const promesa = useCase.ejecutar(
      comando({ comprobante: comprobanteValido({ tamanoBytes: 10 * MB + 1 }) }),
    );
    await expect(promesa).rejects.toBeInstanceOf(TamanoExcedidoError);

    expect(uow.ejecutar).not.toHaveBeenCalled();
    expect(almacenarComprobante).not.toHaveBeenCalled();
    expect(repos.documentos.crear).not.toHaveBeenCalled();
  });

  it('debe_aceptar_un_fichero_de_exactamente_10_MB_como_valido', async () => {
    const { useCase, repos } = montar();

    await useCase.ejecutar(
      comando({ comprobante: comprobanteValido({ tamanoBytes: 10 * MB }) }),
    );

    expect(repos.documentos.crear).toHaveBeenCalledTimes(1);
  });
});

// ===========================================================================
// Guarda de estado: estado fuera de {reserva_confirmada, evento_en_curso,
// post_evento} → EstadoInvalidoError (422), sin efectos.
// ===========================================================================

describe('SubirComprobanteFianza — estado inválido → 422', () => {
  it.each(['consulta', 'pre_reserva', 'reserva_completada', 'reserva_cancelada'])(
    'debe_lanzar_EstadoInvalido_para_el_estado_%s_sin_efectos',
    async (estado) => {
      const { useCase, repos, uow, almacenarComprobante } = montar({
        reserva: reservaValida({ estado }),
      });

      await expect(useCase.ejecutar(comando())).rejects.toBeInstanceOf(EstadoInvalidoError);

      expect(uow.ejecutar).not.toHaveBeenCalled();
      expect(almacenarComprobante).not.toHaveBeenCalled();
      expect(repos.documentos.crear).not.toHaveBeenCalled();
    },
  );
});

// ===========================================================================
// Propagación de fallo para rollback: cualquier escritura de la tx que falle se
// propaga (all-or-nothing).
// ===========================================================================

describe('SubirComprobanteFianza — propagación de fallo para rollback', () => {
  it.each(['crear', 'marcarComprobante', 'auditoria'] as const)(
    'debe_propagar_el_error_cuando_falla_%s_para_que_la_tx_revierta',
    async (op) => {
      const { useCase } = montar({ fallarEn: op });

      await expect(useCase.ejecutar(comando())).rejects.toThrow(
        `FALLO_${op.toUpperCase()}`,
      );
    },
  );
});

// ===========================================================================
// 404 / RLS: RESERVA inexistente para el tenant, sin efectos.
// ===========================================================================

describe('SubirComprobanteFianza — RESERVA inexistente / cross-tenant → 404', () => {
  it('debe_lanzar_ReservaNoEncontrada_cuando_no_existe_para_el_tenant_sin_efectos', async () => {
    const { useCase, repos, almacenarComprobante } = montar({ reserva: null });

    await expect(
      useCase.ejecutar(comando({ tenantId: OTRO_TENANT })),
    ).rejects.toBeInstanceOf(ReservaNoEncontradaError);

    expect(almacenarComprobante).not.toHaveBeenCalled();
    expect(repos.documentos.crear).not.toHaveBeenCalled();
    expect(repos.reservas.marcarComprobante).not.toHaveBeenCalled();
  });
});
