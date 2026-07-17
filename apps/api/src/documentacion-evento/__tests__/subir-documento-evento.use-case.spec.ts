/**
 * TESTS del caso de uso `SubirDocumentoEventoUseCase` (UC-24 / US-033) — fase TDD RED.
 * tasks.md Fase 3: 3.2 (subida crea DOCUMENTO + audita + checklist; no-idempotencia;
 * atomicidad all-or-nothing; tenant_id heredado) y 3.3 (validación autoritativa:
 * formato, vacío/corrupto, ausente, > 10 MB, tipo no permitido → sin efectos).
 *
 * Trazabilidad: US-033 §Happy Path, §Reglas de negocio, §Reglas de Validación,
 * §Sustitución de un documento ya subido, §Formato de archivo no admitido, §Archivo
 * vacío o corrupto; spec-delta `documentacion-evento` (Requirements de guarda de estado,
 * validación autoritativa, creación+auditoría, re-subida no idempotente); design.md
 * §D-almacenamiento, §D-documento-repo, §D-no-idempotencia, §D-validacion-servidor,
 * §D-no-transicion. Contrato CONGELADO:
 *   - `POST /reservas/{id}/documentos-evento` (multipart: `archivo` + `tipo`) → 201.
 * Códigos de dominio EXACTOS del contrato (422):
 *   ESTADO_NO_PERMITE_DOCUMENTACION, TIPO_DOCUMENTO_NO_PERMITIDO, ARCHIVO_REQUERIDO,
 *   FORMATO_NO_PERMITIDO, ARCHIVO_INVALIDO (tamano_bytes=0), TAMANO_EXCEDIDO.
 * Mensajes literales exigidos por la US/spec-delta:
 *   - estado: "La documentación del evento solo puede capturarse mientras el evento está en curso"
 *   - formato: "Formato no admitido. Por favor, usa JPEG, PNG o PDF."
 *   - vacío/corrupto: "El archivo no pudo procesarse. Por favor, inténtalo de nuevo con un archivo válido."
 *
 * Ejercita la APLICACIÓN contra DOBLES DE LOS PUERTOS (in-memory), sin tocar Prisma
 * (hexagonal, hook `no-infra-in-domain`). La ATOMICIDAD y la persistencia REALES viven
 * en `…-integracion.spec.ts`; aquí se fija la ORQUESTACIÓN: guarda de estado + validación
 * autoritativa ANTES de subir/crear/auditar, subida al almacén con clave que incluye
 * tenantId, creación NO idempotente (sin buscar-antes-de-crear), AUDIT_LOG `crear`, y que
 * un fallo parcial se PROPAGA (rollback all-or-nothing).
 *
 * RED: aún NO existe `documentacion-evento/application/subir-documento-evento.use-case.ts`.
 * El import falla y la batería está en ROJO por AUSENCIA DE IMPLEMENTACIÓN. GREEN es de
 * `backend-developer`.
 */
import {
  SubirDocumentoEventoUseCase,
  EstadoNoPermiteDocumentacionError,
  TipoDocumentoNoPermitidoError,
  ArchivoRequeridoError,
  FormatoNoPermitidoError,
  ArchivoInvalidoError,
  TamanoExcedidoError,
  ReservaNoEncontradaError,
  type SubirDocumentoEventoDeps,
  type SubirDocumentoEventoComando,
  type ArchivoDocumentoEventoSubido,
  type ReservaDocumentacionEvento,
  type RepositoriosDocumentacionEvento,
  type UnidadDeTrabajoDocumentacionEventoPort,
  type DocumentoEventoPersistido,
} from '../application/subir-documento-evento.use-case';

const TENANT = '00000000-0000-0000-0000-000000000001';
const OTRO_TENANT = '00000000-0000-0000-0000-0000000000ff';
const GESTOR = '00000000-0000-0000-0000-000000000002';
const RESERVA_ID = 'res-evento';
const MB = 1024 * 1024;

// ---------------------------------------------------------------------------
// Dobles de datos: RESERVA en evento_en_curso bajo el tenant del JWT.
// ---------------------------------------------------------------------------

const reservaEnCurso = (
  over: Partial<ReservaDocumentacionEvento> = {},
): ReservaDocumentacionEvento => ({
  idReserva: RESERVA_ID,
  tenantId: TENANT,
  estado: 'evento_en_curso',
  ...over,
});

// Archivo válido por defecto: JPEG de 1 MB.
const archivoValido = (
  over: Partial<ArchivoDocumentoEventoSubido> = {},
): ArchivoDocumentoEventoSubido => ({
  nombreArchivo: 'dni-anverso.jpg',
  mimeType: 'image/jpeg',
  tamanoBytes: 1 * MB,
  buffer: Buffer.from('fake-jpeg-bytes'),
  ...over,
});

// ---------------------------------------------------------------------------
// Repositorios + UoW fake. El use-case orquesta la tx única de la subida.
// ---------------------------------------------------------------------------

interface ReposFake extends RepositoriosDocumentacionEvento {
  documentos: { crear: jest.Mock; listarPorReservaYTipos: jest.Mock };
  auditoria: { registrar: jest.Mock };
}

type PuntoDeFallo = 'crear' | 'auditoria';

const crearReposFake = (
  opciones: { existentes?: DocumentoEventoPersistido[]; fallarEn?: PuntoDeFallo } = {},
): ReposFake => {
  let seq = 0;
  return {
    documentos: {
      crear: jest.fn(async (d: Record<string, unknown>): Promise<DocumentoEventoPersistido> => {
        if (opciones.fallarEn === 'crear') throw new Error('FALLO_CREAR');
        seq += 1;
        return {
          idDocumento: `doc-${seq}`,
          tipo: d.tipo as DocumentoEventoPersistido['tipo'],
          reservaId: d.reservaId as string,
          tenantId: d.tenantId as string,
          url: d.url as string,
          mimeType: d.mimeType as string,
          nombreArchivo: d.nombreArchivo as string,
          tamanoBytes: d.tamanoBytes as number,
          fechaCreacion: new Date('2026-06-20T12:00:00.000Z'),
        };
      }),
      // Lista para construir el checklist devuelto en la respuesta de la subida.
      listarPorReservaYTipos: jest.fn(async () => opciones.existentes ?? []),
    },
    auditoria: {
      registrar: jest.fn(async () => {
        if (opciones.fallarEn === 'auditoria') throw new Error('FALLO_AUDITORIA');
        return undefined;
      }),
    },
  };
};

const crearUowFake = (
  repos: ReposFake,
): UnidadDeTrabajoDocumentacionEventoPort & { ejecutar: jest.Mock } => ({
  ejecutar: jest.fn(
    async <T,>(
      _tenantId: string,
      trabajo: (r: RepositoriosDocumentacionEvento) => Promise<T>,
    ) => trabajo(repos),
  ),
});

const montar = (
  opciones: {
    reserva?: ReservaDocumentacionEvento | null;
    existentes?: DocumentoEventoPersistido[];
    fallarEn?: PuntoDeFallo;
    almacenarUrl?: string;
    almacenarFalla?: boolean;
  } = {},
) => {
  const reserva = 'reserva' in opciones ? opciones.reserva : reservaEnCurso();
  const repos = crearReposFake({ existentes: opciones.existentes, fallarEn: opciones.fallarEn });
  const uow = crearUowFake(repos);
  const cargarReserva = jest.fn(async () => reserva);
  const almacenarDocumento = jest.fn(async (_params: {
    tenantId: string;
    reservaId: string;
    tipo: string;
    archivo: ArchivoDocumentoEventoSubido;
  }) => {
    if (opciones.almacenarFalla) throw new Error('FALLO_ALMACEN');
    return opciones.almacenarUrl ?? 'https://docs/documentos-evento/dni-anverso-1.jpg';
  });
  const deps: SubirDocumentoEventoDeps = {
    unidadDeTrabajo: uow,
    cargarReserva,
    almacenarDocumento,
  };
  return {
    useCase: new SubirDocumentoEventoUseCase(deps),
    repos,
    uow,
    cargarReserva,
    almacenarDocumento,
    deps,
  };
};

const comando = (
  over: Partial<SubirDocumentoEventoComando> = {},
): SubirDocumentoEventoComando => ({
  tenantId: TENANT,
  usuarioId: GESTOR,
  reservaId: RESERVA_ID,
  tipo: 'dni_anverso',
  archivo: archivoValido(),
  ...over,
});

// ===========================================================================
// 3.2 — Happy path: crea DOCUMENTO (tipo/reservaId/tenantId/url/mimeType/tamano>0),
//        sube al almacén con clave que incluye tenantId, audita `crear`/`DOCUMENTO`,
//        y devuelve documento + checklist actualizado.
// ===========================================================================

describe('SubirDocumentoEventoUseCase — happy path (3.2)', () => {
  it('debe_subir_al_almacen_y_crear_un_DOCUMENTO_con_los_datos_del_fichero', async () => {
    const { useCase, repos, almacenarDocumento } = montar({
      almacenarUrl: 'https://docs/documentos-evento/xyz.jpg',
    });

    const resultado = await useCase.ejecutar(
      comando({ archivo: archivoValido({ mimeType: 'image/jpeg', tamanoBytes: 2 * MB }) }),
    );

    expect(almacenarDocumento).toHaveBeenCalledTimes(1);
    expect(repos.documentos.crear).toHaveBeenCalledTimes(1);
    const args = repos.documentos.crear.mock.calls[0][0];
    expect(args.tipo).toBe('dni_anverso');
    expect(args.reservaId).toBe(RESERVA_ID);
    expect(args.tenantId).toBe(TENANT);
    expect(args.url).toBe('https://docs/documentos-evento/xyz.jpg');
    expect(args.mimeType).toBe('image/jpeg');
    expect(args.tamanoBytes).toBe(2 * MB);
    expect(args.tamanoBytes).toBeGreaterThan(0);
    // La respuesta incluye el DOCUMENTO creado.
    expect(resultado.documento.tipo).toBe('dni_anverso');
    expect(resultado.documento.idDocumento).toBeTruthy();
  });

  it('debe_heredar_el_tenant_id_de_la_RESERVA_nunca_del_input', async () => {
    // La reserva es del TENANT; aunque el comando trajera otro tenant en el input
    // del documento, el tenant_id del DOCUMENTO deriva del JWT/reserva.
    const { useCase, repos } = montar({ reserva: reservaEnCurso({ tenantId: TENANT }) });

    await useCase.ejecutar(comando({ tenantId: TENANT }));

    expect(repos.documentos.crear.mock.calls[0][0].tenantId).toBe(TENANT);
  });

  it('debe_subir_al_almacen_con_una_clave_que_incluye_el_tenantId', async () => {
    const { useCase, almacenarDocumento } = montar();

    await useCase.ejecutar(comando());

    // El puerto de almacenamiento recibe el tenantId (para construir la clave
    // `documentos-evento/{tenantId}/{reservaId}/{tipo}/...`, aislamiento por tenant).
    const args = almacenarDocumento.mock.calls[0][0];
    expect(args.tenantId).toBe(TENANT);
    expect(args.reservaId).toBe(RESERVA_ID);
    expect(args.tipo).toBe('dni_anverso');
  });

  it('debe_registrar_AUDIT_LOG_accion_crear_entidad_DOCUMENTO_con_datos_nuevos', async () => {
    const { useCase, repos } = montar();

    await useCase.ejecutar(comando());

    expect(repos.auditoria.registrar).toHaveBeenCalledTimes(1);
    const args = repos.auditoria.registrar.mock.calls[0][0];
    expect(args.accion).toBe('crear');
    expect(args.entidad).toBe('DOCUMENTO');
    expect(args.datosNuevos.tipo).toBe('dni_anverso');
    expect(args.datosNuevos.reservaId).toBe(RESERVA_ID);
    expect(args.datosNuevos.url).toBeTruthy();
    expect(args.datosNuevos.mimeType).toBe('image/jpeg');
    expect(args.datosNuevos.tamanoBytes).toBeGreaterThan(0);
  });

  it('debe_devolver_el_checklist_actualizado_reflejando_el_documento_recien_subido', async () => {
    const { useCase } = montar();

    const resultado = await useCase.ejecutar(comando({ tipo: 'dni_anverso' }));

    // El checklist tiene los tres ítems; el subido queda completado.
    expect(resultado.checklist.items).toHaveLength(3);
    const anverso = resultado.checklist.items.find((i) => i.tipo === 'dni_anverso');
    expect(anverso?.completado).toBe(true);
    // Los otros dos siguen pendientes (no se subieron).
    const reverso = resultado.checklist.items.find((i) => i.tipo === 'dni_reverso');
    const clausula = resultado.checklist.items.find(
      (i) => i.tipo === 'clausula_responsabilidad',
    );
    expect(reverso?.completado).toBe(false);
    expect(clausula?.completado).toBe(false);
  });

  it('debe_orquestar_la_creacion_y_la_auditoria_dentro_de_una_unica_unidad_de_trabajo', async () => {
    const { useCase, uow } = montar();

    await useCase.ejecutar(comando());

    expect(uow.ejecutar).toHaveBeenCalledTimes(1);
  });

  it.each(['dni_anverso', 'dni_reverso', 'clausula_responsabilidad'] as const)(
    'debe_aceptar_el_tipo_obligatorio_%s',
    async (tipo) => {
      const { useCase, repos } = montar();

      await useCase.ejecutar(comando({ tipo }));

      expect(repos.documentos.crear.mock.calls[0][0].tipo).toBe(tipo);
    },
  );

  it.each(['image/jpeg', 'image/png', 'application/pdf'])(
    'debe_aceptar_el_formato_permitido_%s',
    async (mimeType) => {
      const { useCase, repos } = montar();

      await useCase.ejecutar(comando({ archivo: archivoValido({ mimeType }) }));

      expect(repos.documentos.crear).toHaveBeenCalledTimes(1);
    },
  );

  it('debe_aceptar_un_fichero_de_exactamente_10_MB', async () => {
    const { useCase, repos } = montar();

    await useCase.ejecutar(comando({ archivo: archivoValido({ tamanoBytes: 10 * MB }) }));

    expect(repos.documentos.crear).toHaveBeenCalledTimes(1);
  });
});

// ===========================================================================
// Guarda de ESTADO: solo evento_en_curso admite la ESCRITURA. Cualquier otro
//        estado → ESTADO_NO_PERMITE_DOCUMENTACION con el mensaje literal, SIN
//        subir, SIN crear, SIN auditar.
// ===========================================================================

describe('SubirDocumentoEventoUseCase — guarda de estado ESTADO_NO_PERMITE_DOCUMENTACION', () => {
  const estadosNoPermitidos: ReadonlyArray<ReservaDocumentacionEvento['estado']> = [
    'consulta',
    'pre_reserva',
    'reserva_confirmada',
    'post_evento',
    'reserva_completada',
    'reserva_cancelada',
  ];

  it.each(estadosNoPermitidos)(
    'debe_lanzar_ESTADO_NO_PERMITE_DOCUMENTACION_en_%s_sin_efectos',
    async (estado) => {
      const { useCase, repos, uow, almacenarDocumento } = montar({
        reserva: reservaEnCurso({ estado }),
      });

      const promesa = useCase.ejecutar(comando());
      await expect(promesa).rejects.toBeInstanceOf(EstadoNoPermiteDocumentacionError);
      await expect(promesa).rejects.toMatchObject({
        codigo: 'ESTADO_NO_PERMITE_DOCUMENTACION',
      });

      expect(uow.ejecutar).not.toHaveBeenCalled();
      expect(almacenarDocumento).not.toHaveBeenCalled();
      expect(repos.documentos.crear).not.toHaveBeenCalled();
      expect(repos.auditoria.registrar).not.toHaveBeenCalled();
    },
  );

  it('debe_exponer_el_mensaje_literal_de_la_US_para_el_estado_no_permitido', async () => {
    const { useCase } = montar({ reserva: reservaEnCurso({ estado: 'reserva_confirmada' }) });

    await expect(useCase.ejecutar(comando())).rejects.toMatchObject({
      codigo: 'ESTADO_NO_PERMITE_DOCUMENTACION',
      message:
        'La documentación del evento solo puede capturarse mientras el evento está en curso',
    });
  });
});

// ===========================================================================
// 3.3 — Validación autoritativa del fichero y del tipo (síncrona, ANTES de la
//        tx): ausente, formato no permitido, vacío/corrupto (tamano=0), > 10 MB,
//        tipo no permitido → rechazo SIN efectos.
// ===========================================================================

describe('SubirDocumentoEventoUseCase — validación autoritativa del fichero (3.3)', () => {
  it('debe_lanzar_ARCHIVO_REQUERIDO_cuando_no_se_adjunta_fichero_sin_efectos', async () => {
    const { useCase, repos, uow, almacenarDocumento } = montar();

    const promesa = useCase.ejecutar(comando({ archivo: null }));
    await expect(promesa).rejects.toBeInstanceOf(ArchivoRequeridoError);
    await expect(promesa).rejects.toMatchObject({ codigo: 'ARCHIVO_REQUERIDO' });

    expect(uow.ejecutar).not.toHaveBeenCalled();
    expect(almacenarDocumento).not.toHaveBeenCalled();
    expect(repos.documentos.crear).not.toHaveBeenCalled();
    expect(repos.auditoria.registrar).not.toHaveBeenCalled();
  });

  it.each(['application/msword', 'image/heic', 'text/plain', 'application/octet-stream'])(
    'debe_lanzar_FORMATO_NO_PERMITIDO_para_mime_%s_sin_efectos',
    async (mimeType) => {
      const { useCase, repos, uow, almacenarDocumento } = montar();

      const promesa = useCase.ejecutar(
        comando({ archivo: archivoValido({ mimeType, nombreArchivo: 'doc.docx' }) }),
      );
      await expect(promesa).rejects.toBeInstanceOf(FormatoNoPermitidoError);
      await expect(promesa).rejects.toMatchObject({ codigo: 'FORMATO_NO_PERMITIDO' });

      expect(uow.ejecutar).not.toHaveBeenCalled();
      expect(almacenarDocumento).not.toHaveBeenCalled();
      expect(repos.documentos.crear).not.toHaveBeenCalled();
    },
  );

  it('debe_exponer_el_mensaje_literal_de_formato_no_admitido', async () => {
    const { useCase } = montar();

    await expect(
      useCase.ejecutar(comando({ archivo: archivoValido({ mimeType: 'image/heic' }) })),
    ).rejects.toMatchObject({
      codigo: 'FORMATO_NO_PERMITIDO',
      message: 'Formato no admitido. Por favor, usa JPEG, PNG o PDF.',
    });
  });

  it('debe_lanzar_ARCHIVO_INVALIDO_cuando_el_fichero_esta_vacio_tamano_0_sin_efectos', async () => {
    const { useCase, repos, uow, almacenarDocumento } = montar();

    const promesa = useCase.ejecutar(
      comando({ archivo: archivoValido({ tamanoBytes: 0, buffer: Buffer.alloc(0) }) }),
    );
    await expect(promesa).rejects.toBeInstanceOf(ArchivoInvalidoError);
    await expect(promesa).rejects.toMatchObject({ codigo: 'ARCHIVO_INVALIDO' });

    expect(uow.ejecutar).not.toHaveBeenCalled();
    expect(almacenarDocumento).not.toHaveBeenCalled();
    expect(repos.documentos.crear).not.toHaveBeenCalled();
  });

  it('debe_exponer_el_mensaje_literal_de_archivo_vacio_o_corrupto', async () => {
    const { useCase } = montar();

    await expect(
      useCase.ejecutar(comando({ archivo: archivoValido({ tamanoBytes: 0 }) })),
    ).rejects.toMatchObject({
      codigo: 'ARCHIVO_INVALIDO',
      message:
        'El archivo no pudo procesarse. Por favor, inténtalo de nuevo con un archivo válido.',
    });
  });

  it('debe_lanzar_TAMANO_EXCEDIDO_cuando_el_fichero_supera_10_MB_sin_efectos', async () => {
    const { useCase, repos, uow, almacenarDocumento } = montar();

    const promesa = useCase.ejecutar(
      comando({ archivo: archivoValido({ tamanoBytes: 10 * MB + 1 }) }),
    );
    await expect(promesa).rejects.toBeInstanceOf(TamanoExcedidoError);
    await expect(promesa).rejects.toMatchObject({ codigo: 'TAMANO_EXCEDIDO' });

    expect(uow.ejecutar).not.toHaveBeenCalled();
    expect(almacenarDocumento).not.toHaveBeenCalled();
    expect(repos.documentos.crear).not.toHaveBeenCalled();
  });

  it.each(['justificante_pago', 'condiciones_particulares', 'factura', 'otro', 'presupuesto'])(
    'debe_lanzar_TIPO_DOCUMENTO_NO_PERMITIDO_para_tipo_%s_sin_efectos',
    async (tipo) => {
      const { useCase, repos, uow, almacenarDocumento } = montar();

      const promesa = useCase.ejecutar(
        comando({ tipo: tipo as SubirDocumentoEventoComando['tipo'] }),
      );
      await expect(promesa).rejects.toBeInstanceOf(TipoDocumentoNoPermitidoError);
      await expect(promesa).rejects.toMatchObject({ codigo: 'TIPO_DOCUMENTO_NO_PERMITIDO' });

      expect(uow.ejecutar).not.toHaveBeenCalled();
      expect(almacenarDocumento).not.toHaveBeenCalled();
      expect(repos.documentos.crear).not.toHaveBeenCalled();
    },
  );
});

// ===========================================================================
// No idempotencia (3.2): dos subidas del mismo tipo → dos `crear`, sin
//        buscar-antes-de-crear (a diferencia de US-023). El histórico se conserva.
// ===========================================================================

describe('SubirDocumentoEventoUseCase — re-subida NO idempotente (3.2)', () => {
  it('debe_crear_una_segunda_fila_al_subir_de_nuevo_el_mismo_tipo_sin_buscar_antes', async () => {
    const yaExiste: DocumentoEventoPersistido = {
      idDocumento: 'doc-previo',
      tipo: 'dni_anverso',
      reservaId: RESERVA_ID,
      tenantId: TENANT,
      url: 'https://docs/documentos-evento/anverso-viejo.jpg',
      mimeType: 'image/jpeg',
      nombreArchivo: 'anverso-viejo.jpg',
      tamanoBytes: 1 * MB,
      fechaCreacion: new Date('2026-06-20T10:00:00.000Z'),
    };
    const { useCase, repos } = montar({ existentes: [yaExiste] });

    await useCase.ejecutar(comando({ tipo: 'dni_anverso' }));

    // Crea una NUEVA fila incluso existiendo una previa del mismo tipo.
    expect(repos.documentos.crear).toHaveBeenCalledTimes(1);
    // NO se usa `buscarPorReservaYTipo` (no idempotente): el puerto no lo expone aquí.
    expect(
      (repos.documentos as Record<string, unknown>).buscarPorReservaYTipo,
    ).toBeUndefined();
  });

  it('debe_mantener_el_item_completado_true_tras_la_re_subida_del_mismo_tipo', async () => {
    const yaExiste: DocumentoEventoPersistido = {
      idDocumento: 'doc-previo',
      tipo: 'dni_anverso',
      reservaId: RESERVA_ID,
      tenantId: TENANT,
      url: 'https://docs/documentos-evento/anverso-viejo.jpg',
      mimeType: 'image/jpeg',
      nombreArchivo: 'anverso-viejo.jpg',
      tamanoBytes: 1 * MB,
      fechaCreacion: new Date('2026-06-20T10:00:00.000Z'),
    };
    const { useCase } = montar({ existentes: [yaExiste] });

    const resultado = await useCase.ejecutar(comando({ tipo: 'dni_anverso' }));

    const anverso = resultado.checklist.items.find((i) => i.tipo === 'dni_anverso');
    expect(anverso?.completado).toBe(true);
  });
});

// ===========================================================================
// 404 — RESERVA inexistente / cross-tenant (RLS): rechazo SIN efectos.
// ===========================================================================

describe('SubirDocumentoEventoUseCase — RESERVA inexistente / cross-tenant → 404', () => {
  it('debe_lanzar_ReservaNoEncontrada_cuando_no_existe_para_el_tenant_sin_efectos', async () => {
    const { useCase, repos, almacenarDocumento } = montar({ reserva: null });

    await expect(
      useCase.ejecutar(comando({ tenantId: OTRO_TENANT })),
    ).rejects.toBeInstanceOf(ReservaNoEncontradaError);

    expect(almacenarDocumento).not.toHaveBeenCalled();
    expect(repos.documentos.crear).not.toHaveBeenCalled();
    expect(repos.auditoria.registrar).not.toHaveBeenCalled();
  });
});

// ===========================================================================
// Atomicidad (vertiente de orquestación): si CUALQUIER escritura de la tx falla,
//        el error se PROPAGA para que la UoW haga rollback (all-or-nothing). La
//        atomicidad REAL (estado de BD) se verifica en …-integracion.spec.ts.
// ===========================================================================

describe('SubirDocumentoEventoUseCase — propagación de fallo para rollback', () => {
  it.each(['crear', 'auditoria'] as const)(
    'debe_propagar_el_error_cuando_falla_%s_para_que_la_tx_revierta',
    async (op) => {
      const { useCase } = montar({ fallarEn: op });

      await expect(useCase.ejecutar(comando())).rejects.toThrow(
        `FALLO_${op.toUpperCase()}`,
      );
    },
  );

  it('debe_propagar_el_error_cuando_falla_la_subida_al_almacen', async () => {
    const { useCase, repos } = montar({ almacenarFalla: true });

    await expect(useCase.ejecutar(comando())).rejects.toThrow('FALLO_ALMACEN');
    // Si la subida falla, no se crea DOCUMENTO ni se audita.
    expect(repos.documentos.crear).not.toHaveBeenCalled();
    expect(repos.auditoria.registrar).not.toHaveBeenCalled();
  });
});
