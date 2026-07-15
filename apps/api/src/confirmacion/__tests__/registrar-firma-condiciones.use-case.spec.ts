/**
 * TESTS del caso de uso `RegistrarFirmaCondicionesUseCase` (UC-19 segundo flujo /
 * US-024) — fase TDD RED. tasks.md Fase 3: 3.1 (guardas de precondición: E3 enviado +
 * estado válido), 3.2 (validación de fichero: ausente / mime / > 10 MB sin efectos),
 * 3.3 (creación del DOCUMENTO firmado, marcado de RESERVA, AUDIT_LOG `actualizar`, el
 * DOCUMENTO original no firmado permanece, atomicidad/rollback), 3.4 (re-firma no
 * idempotente que conserva histórico), 3.5 (no transición: estado y sub-procesos no
 * cambian; AUDIT_LOG nunca es `transicion`).
 *
 * Trazabilidad: US-024; spec-delta `confirmacion` (Requirements "Precondiciones y
 * validación del fichero", "Registro de la firma con creación del DOCUMENTO firmado y
 * actualización de la reserva", "La firma no transiciona el estado … válida en tres
 * estados", "Re-registro de la firma permitido conservando el histórico"); design.md
 * §D-no-transicion, §D-documento-repo, §D-re-firma, §D-almacenamiento. Contrato
 * congelado: `POST /reservas/{id}/condiciones-firmadas` (multipart, campo
 * `condicionesFirmadas`), operationId `registrarCondicionesFirmadas`.
 *
 * Códigos de dominio (Gate 1 vinculante):
 *   - `cond_part_enviadas_fecha` nulo → 409 `CONDICIONES_NO_ENVIADAS`.
 *   - estado terminal / fuera de {reserva_confirmada, evento_en_curso, post_evento}
 *     → 422 `ESTADO_INVALIDO`.
 *   - fichero ausente → 422 `CONDICIONES_REQUERIDAS`; mime no permitido → 422
 *     `FORMATO_NO_PERMITIDO`; > 10 MB → 422 `TAMANO_EXCEDIDO`.
 *
 * NAMING DEL WIRE: el flag es `condPartFirmadas` (bool) y la fecha de firma en el DTO/
 * wire es `condPartFechaFirma` (el nombre de columna Prisma es `cond_part_firmadas_fecha`,
 * NO se usa en el wire). El use-case trabaja con la proyección de dominio; la
 * serialización al wire la fija el read-DTO (fuera de este test unitario).
 *
 * Ejercita la APLICACIÓN contra DOBLES DE LOS PUERTOS (in-memory), sin tocar Prisma
 * (hexagonal, hook `no-infra-in-domain`). La ATOMICIDAD y el estado de BD REALES viven
 * en la sesión con Postgres (tests de integración, no aquí); este spec fija la
 * ORQUESTACIÓN: guardas síncronas previas a la tx (E3 enviado, estado válido, fichero),
 * creación del DOCUMENTO firmado, marcado de la RESERVA, auditoría `actualizar`,
 * re-firma no idempotente y que un fallo parcial en la tx se PROPAGA (rollback).
 *
 * RED: aún NO existe `confirmacion/application/registrar-firma-condiciones.use-case.ts`.
 * La batería está en ROJO por AUSENCIA DE IMPLEMENTACIÓN. GREEN es de `backend-developer`.
 */
import {
  RegistrarFirmaCondicionesUseCase,
  CondicionesNoEnviadasError,
  EstadoInvalidoError,
  CondicionesRequeridasError,
  FormatoNoPermitidoError,
  TamanoExcedidoError,
  ReservaNoEncontradaError,
  type RegistrarFirmaCondicionesDeps,
  type RegistrarFirmaCondicionesComando,
  type CondicionesFirmadasSubidas,
  type ReservaFirmaCondiciones,
  type RepositoriosFirmaCondiciones,
  type UnidadDeTrabajoFirmaCondicionesPort,
  type ClockPort,
} from '../application/registrar-firma-condiciones.use-case';
import type { EstadoReserva } from '../../reservas/domain/maquina-estados';

const TENANT = '00000000-0000-0000-0000-000000000001';
const OTRO_TENANT = '00000000-0000-0000-0000-0000000000ff';
const GESTOR = '00000000-0000-0000-0000-000000000002';
const RESERVA_ID = 'res-confirmada';
const MB = 1024 * 1024;

const AHORA = new Date('2026-07-15T10:00:00.000Z');
const ENVIADAS_FECHA = new Date('2026-07-10T09:00:00.000Z');
const relojFijo: ClockPort = { ahora: () => AHORA };

// ---------------------------------------------------------------------------
// Dobles de datos: RESERVA en reserva_confirmada con E3 ya enviado (US-023) y
// sin firma aún (cond_part_firmadas = false).
// ---------------------------------------------------------------------------

const reservaValida = (
  over: Partial<ReservaFirmaCondiciones> = {},
): ReservaFirmaCondiciones => ({
  idReserva: RESERVA_ID,
  tenantId: TENANT,
  estado: 'reserva_confirmada',
  condPartEnviadasFecha: ENVIADAS_FECHA,
  condPartFirmadas: false,
  ...over,
});

// Copia firmada válida por defecto: PDF de 1 MB.
const condicionesValidas = (
  over: Partial<CondicionesFirmadasSubidas> = {},
): CondicionesFirmadasSubidas => ({
  nombreArchivo: 'condiciones-firmadas.pdf',
  mimeType: 'application/pdf',
  tamanoBytes: 1 * MB,
  buffer: Buffer.from('%PDF-1.4 fake firmado'),
  ...over,
});

// ---------------------------------------------------------------------------
// Repositorios + UoW fake. El use-case orquesta la tx única de registro de firma.
// ---------------------------------------------------------------------------

interface ReposFake extends RepositoriosFirmaCondiciones {
  documentos: { crear: jest.Mock };
  reservas: { marcarFirmada: jest.Mock };
  auditoria: { registrar: jest.Mock };
}

type PuntoDeFallo = 'crear' | 'marcarFirmada' | 'auditoria';

const crearReposFake = (
  opciones: { fallarEn?: PuntoDeFallo } = {},
): ReposFake => ({
  documentos: {
    crear: jest.fn(async (d: Record<string, unknown>) => {
      if (opciones.fallarEn === 'crear') throw new Error('FALLO_CREAR');
      return {
        idDocumento: 'doc-firmado-1',
        tipo: 'condiciones_particulares',
        reservaId: RESERVA_ID,
        tenantId: TENANT,
        url: 'https://docs/firmada-1.pdf',
        mimeType: 'application/pdf',
        ...d,
      };
    }),
  },
  reservas: {
    marcarFirmada: jest.fn(async () => {
      if (opciones.fallarEn === 'marcarFirmada') throw new Error('FALLO_MARCARFIRMADA');
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
): UnidadDeTrabajoFirmaCondicionesPort & { ejecutar: jest.Mock } => ({
  ejecutar: jest.fn(
    async <T,>(
      _tenantId: string,
      trabajo: (r: RepositoriosFirmaCondiciones) => Promise<T>,
    ) => trabajo(repos),
  ),
});

const montar = (opciones: {
  reserva?: ReservaFirmaCondiciones | null;
  fallarEn?: PuntoDeFallo;
  almacenarUrl?: string;
} = {}) => {
  const reserva = 'reserva' in opciones ? opciones.reserva : reservaValida();
  const repos = crearReposFake({ fallarEn: opciones.fallarEn });
  const uow = crearUowFake(repos);
  const cargarReserva: jest.Mock = jest.fn(async () => reserva);
  const almacenarCondiciones: jest.Mock = jest.fn(
    async () => opciones.almacenarUrl ?? 'https://docs/firmada-1.pdf',
  );
  const deps: RegistrarFirmaCondicionesDeps = {
    unidadDeTrabajo: uow,
    cargarReserva,
    almacenarCondiciones,
    clock: relojFijo,
  };
  return {
    useCase: new RegistrarFirmaCondicionesUseCase(deps),
    repos,
    uow,
    cargarReserva,
    almacenarCondiciones,
    deps,
  };
};

const comando = (
  over: Partial<RegistrarFirmaCondicionesComando> = {},
): RegistrarFirmaCondicionesComando => ({
  tenantId: TENANT,
  usuarioId: GESTOR,
  reservaId: RESERVA_ID,
  condiciones: condicionesValidas(),
  ...over,
});

// ===========================================================================
// 3.1 (a) — Guarda de precondición E3: cond_part_enviadas_fecha nulo → 409
//            CONDICIONES_NO_ENVIADAS, SIN efectos (sin almacenar, sin DOCUMENTO,
//            sin mutación de RESERVA, sin auditoría).
// ===========================================================================

describe('RegistrarFirmaCondicionesUseCase — condiciones no enviadas → 409 (3.1)', () => {
  it('debe_lanzar_CONDICIONES_NO_ENVIADAS_cuando_cond_part_enviadas_fecha_es_null_sin_efectos', async () => {
    const { useCase, repos, uow, almacenarCondiciones } = montar({
      reserva: reservaValida({ condPartEnviadasFecha: null }),
    });

    const promesa = useCase.ejecutar(comando());
    await expect(promesa).rejects.toBeInstanceOf(CondicionesNoEnviadasError);
    await expect(promesa).rejects.toMatchObject({ codigo: 'CONDICIONES_NO_ENVIADAS' });

    expect(uow.ejecutar).not.toHaveBeenCalled();
    expect(almacenarCondiciones).not.toHaveBeenCalled();
    expect(repos.documentos.crear).not.toHaveBeenCalled();
    expect(repos.reservas.marcarFirmada).not.toHaveBeenCalled();
    expect(repos.auditoria.registrar).not.toHaveBeenCalled();
  });

  it('debe_exponer_el_mensaje_condiciones_no_enviadas_al_cliente', async () => {
    const { useCase } = montar({
      reserva: reservaValida({ condPartEnviadasFecha: null }),
    });

    await expect(useCase.ejecutar(comando())).rejects.toMatchObject({
      codigo: 'CONDICIONES_NO_ENVIADAS',
      message: expect.stringContaining('no han sido enviadas'),
    });
  });
});

// ===========================================================================
// 3.1 (b) — Guarda de estado: estado terminal o fuera de {reserva_confirmada,
//            evento_en_curso, post_evento} → 422 ESTADO_INVALIDO, SIN efectos.
// ===========================================================================

describe('RegistrarFirmaCondicionesUseCase — guarda de estado ESTADO_INVALIDO → 422 (3.1)', () => {
  const estadosInvalidos: ReadonlyArray<EstadoReserva> = [
    'consulta',
    'pre_reserva',
    'reserva_completada',
    'reserva_cancelada',
  ];

  it.each(estadosInvalidos)(
    'debe_lanzar_ESTADO_INVALIDO_para_el_estado_%s_sin_efectos',
    async (estado) => {
      const { useCase, repos, uow, almacenarCondiciones } = montar({
        reserva: reservaValida({ estado }),
      });

      const promesa = useCase.ejecutar(comando());
      await expect(promesa).rejects.toBeInstanceOf(EstadoInvalidoError);
      await expect(promesa).rejects.toMatchObject({ codigo: 'ESTADO_INVALIDO' });

      expect(uow.ejecutar).not.toHaveBeenCalled();
      expect(almacenarCondiciones).not.toHaveBeenCalled();
      expect(repos.documentos.crear).not.toHaveBeenCalled();
      expect(repos.reservas.marcarFirmada).not.toHaveBeenCalled();
      expect(repos.auditoria.registrar).not.toHaveBeenCalled();
    },
  );

  it('debe_exponer_el_mensaje_de_estado_terminal_para_reserva_completada', async () => {
    const { useCase } = montar({
      reserva: reservaValida({ estado: 'reserva_completada' }),
    });

    await expect(useCase.ejecutar(comando())).rejects.toMatchObject({
      codigo: 'ESTADO_INVALIDO',
      message: expect.stringContaining('terminal'),
    });
  });

  it.each(['reserva_confirmada', 'evento_en_curso', 'post_evento'] as const)(
    'debe_aceptar_el_estado_valido_%s_y_registrar_la_firma',
    async (estado) => {
      const { useCase, repos } = montar({ reserva: reservaValida({ estado }) });

      await expect(useCase.ejecutar(comando())).resolves.toBeDefined();

      expect(repos.documentos.crear).toHaveBeenCalledTimes(1);
      expect(repos.reservas.marcarFirmada).toHaveBeenCalledTimes(1);
    },
  );
});

// ===========================================================================
// 3.2 — Validación del fichero (síncrona, ANTES de la tx): ausente → 422
//        CONDICIONES_REQUERIDAS; mime no permitido → 422 FORMATO_NO_PERMITIDO;
//        > 10 MB → 422 TAMANO_EXCEDIDO. Todos SIN efectos (sin almacenar, sin
//        DOCUMENTO, sin mutar RESERVA, sin auditoría).
// ===========================================================================

describe('RegistrarFirmaCondicionesUseCase — validación del fichero → 422 (3.2)', () => {
  it('debe_lanzar_CONDICIONES_REQUERIDAS_cuando_no_se_adjunta_fichero_sin_efectos', async () => {
    const { useCase, repos, uow, almacenarCondiciones } = montar();

    const promesa = useCase.ejecutar(comando({ condiciones: null }));
    await expect(promesa).rejects.toBeInstanceOf(CondicionesRequeridasError);
    await expect(promesa).rejects.toMatchObject({ codigo: 'CONDICIONES_REQUERIDAS' });

    expect(uow.ejecutar).not.toHaveBeenCalled();
    expect(almacenarCondiciones).not.toHaveBeenCalled();
    expect(repos.documentos.crear).not.toHaveBeenCalled();
    expect(repos.reservas.marcarFirmada).not.toHaveBeenCalled();
    expect(repos.auditoria.registrar).not.toHaveBeenCalled();
  });

  it.each(['application/msword', 'text/plain', 'application/octet-stream'])(
    'debe_lanzar_FORMATO_NO_PERMITIDO_para_mime_%s_sin_efectos',
    async (mimeType) => {
      const { useCase, repos, uow, almacenarCondiciones } = montar();

      const promesa = useCase.ejecutar(
        comando({ condiciones: condicionesValidas({ mimeType, nombreArchivo: 'doc.docx' }) }),
      );
      await expect(promesa).rejects.toBeInstanceOf(FormatoNoPermitidoError);
      await expect(promesa).rejects.toMatchObject({ codigo: 'FORMATO_NO_PERMITIDO' });

      expect(uow.ejecutar).not.toHaveBeenCalled();
      expect(almacenarCondiciones).not.toHaveBeenCalled();
      expect(repos.documentos.crear).not.toHaveBeenCalled();
    },
  );

  it.each(['image/jpeg', 'image/png', 'application/pdf'])(
    'debe_aceptar_el_formato_permitido_%s',
    async (mimeType) => {
      const { useCase, repos } = montar();

      await useCase.ejecutar(comando({ condiciones: condicionesValidas({ mimeType }) }));

      expect(repos.documentos.crear).toHaveBeenCalledTimes(1);
      expect(repos.documentos.crear.mock.calls[0][0].mimeType).toBe(mimeType);
    },
  );

  it('debe_lanzar_TAMANO_EXCEDIDO_cuando_el_fichero_supera_10_MB_sin_efectos', async () => {
    const { useCase, repos, uow, almacenarCondiciones } = montar();

    const promesa = useCase.ejecutar(
      comando({ condiciones: condicionesValidas({ tamanoBytes: 10 * MB + 1 }) }),
    );
    await expect(promesa).rejects.toBeInstanceOf(TamanoExcedidoError);
    await expect(promesa).rejects.toMatchObject({ codigo: 'TAMANO_EXCEDIDO' });

    expect(uow.ejecutar).not.toHaveBeenCalled();
    expect(almacenarCondiciones).not.toHaveBeenCalled();
    expect(repos.documentos.crear).not.toHaveBeenCalled();
  });

  it('debe_aceptar_un_fichero_de_exactamente_10_MB_como_valido', async () => {
    const { useCase, repos } = montar();

    await useCase.ejecutar(
      comando({ condiciones: condicionesValidas({ tamanoBytes: 10 * MB }) }),
    );

    expect(repos.documentos.crear).toHaveBeenCalledTimes(1);
  });
});

// ===========================================================================
// 3.3 (a) — Creación del DOCUMENTO firmado: tipo='condiciones_particulares',
//            reserva_id, tenant_id, url del fichero almacenado y mime_type del
//            fichero subido; se almacena físicamente ANTES del commit.
// ===========================================================================

describe('RegistrarFirmaCondicionesUseCase — creación del DOCUMENTO firmado (3.3)', () => {
  it('debe_crear_un_DOCUMENTO_condiciones_particulares_con_url_y_mime_del_fichero', async () => {
    const { useCase, repos, almacenarCondiciones } = montar({
      almacenarUrl: 'https://docs/firmada-99.png',
    });

    await useCase.ejecutar(
      comando({ condiciones: condicionesValidas({ mimeType: 'image/png', nombreArchivo: 'firma.png' }) }),
    );

    expect(almacenarCondiciones).toHaveBeenCalledTimes(1);
    expect(repos.documentos.crear).toHaveBeenCalledTimes(1);
    const args = repos.documentos.crear.mock.calls[0][0];
    expect(args.tipo).toBe('condiciones_particulares');
    expect(args.reservaId).toBe(RESERVA_ID);
    expect(args.tenantId).toBe(TENANT);
    expect(args.url).toBe('https://docs/firmada-99.png');
    expect(args.mimeType).toBe('image/png');
    expect(args.nombreArchivo).toBe('firma.png');
  });

  it('debe_almacenar_el_fichero_por_reserva_pasando_tenant_y_reserva_al_almacen', async () => {
    const { useCase, almacenarCondiciones } = montar();

    await useCase.ejecutar(comando());

    expect(almacenarCondiciones).toHaveBeenCalledTimes(1);
    const args = almacenarCondiciones.mock.calls[0][0];
    expect(args.tenantId).toBe(TENANT);
    expect(args.reservaId).toBe(RESERVA_ID);
  });
});

// ===========================================================================
// 3.3 (b) — Marcado de la RESERVA: cond_part_firmadas = true y
//            cond_part_firmadas_fecha = clock.ahora().
// ===========================================================================

describe('RegistrarFirmaCondicionesUseCase — marcado de la RESERVA (3.3)', () => {
  it('debe_marcar_cond_part_firmadas_true_y_fijar_la_fecha_de_firma_con_el_reloj', async () => {
    const { useCase, repos } = montar();

    await useCase.ejecutar(comando());

    expect(repos.reservas.marcarFirmada).toHaveBeenCalledTimes(1);
    const args = repos.reservas.marcarFirmada.mock.calls[0][0];
    expect(args.idReserva).toBe(RESERVA_ID);
    expect(args.condPartFirmadas).toBe(true);
    expect(args.condPartFirmadasFecha).toEqual(AHORA);
  });
});

// ===========================================================================
// 3.3 (c) — AUDIT_LOG: accion='actualizar' (NUNCA 'transicion'), entidad='RESERVA',
//            datos_anteriores.cond_part_firmadas=false, datos_nuevos.cond_part_firmadas
//            =true + datos_nuevos.cond_part_firmadas_fecha.
// ===========================================================================

describe('RegistrarFirmaCondicionesUseCase — auditoría actualizar (3.3)', () => {
  it('debe_registrar_AUDIT_LOG_accion_actualizar_entidad_RESERVA_con_datos_anteriores_y_nuevos', async () => {
    const { useCase, repos } = montar();

    await useCase.ejecutar(comando());

    expect(repos.auditoria.registrar).toHaveBeenCalledTimes(1);
    const args = repos.auditoria.registrar.mock.calls[0][0];
    expect(args.accion).toBe('actualizar');
    expect(args.entidad).toBe('RESERVA');
    expect(args.entidadId).toBe(RESERVA_ID);
    expect(args.datosAnteriores.condPartFirmadas).toBe(false);
    expect(args.datosNuevos.condPartFirmadas).toBe(true);
    expect(args.datosNuevos.condPartFirmadasFecha).toEqual(AHORA);
  });

  it('no_debe_usar_nunca_accion_transicion', async () => {
    const { useCase, repos } = montar();

    await useCase.ejecutar(comando());

    const args = repos.auditoria.registrar.mock.calls[0][0];
    expect(args.accion).not.toBe('transicion');
  });
});

// ===========================================================================
// 3.3 (d) — El DOCUMENTO original NO firmado (US-023) permanece: el use-case NO
//            busca ni borra ni sobrescribe el documento existente; SIEMPRE crea una
//            fila NUEVA (no idempotente). Se comprueba que NO se invoca ninguna
//            búsqueda/borrado sobre el repositorio (solo `crear`).
// ===========================================================================

describe('RegistrarFirmaCondicionesUseCase — el DOCUMENTO original no firmado permanece (3.3)', () => {
  it('debe_crear_una_fila_DOCUMENTO_nueva_sin_buscar_ni_borrar_el_original', async () => {
    const { useCase, repos } = montar();

    await useCase.ejecutar(comando());

    // Solo se invoca `crear` (no idempotente): no se toca el documento original.
    expect(repos.documentos.crear).toHaveBeenCalledTimes(1);
    expect((repos.documentos as Record<string, unknown>).buscarPorReservaYTipo).toBeUndefined();
    expect((repos.documentos as Record<string, unknown>).eliminar).toBeUndefined();
  });
});

// ===========================================================================
// 3.3 (e) — Atomicidad (vertiente de orquestación): si CUALQUIER escritura de la tx
//            falla, el error se PROPAGA para que la UoW haga rollback (all-or-nothing).
//            La atomicidad REAL (estado de BD) se verifica en integración (Postgres).
// ===========================================================================

describe('RegistrarFirmaCondicionesUseCase — propagación de fallo para rollback (3.3)', () => {
  it.each(['crear', 'marcarFirmada', 'auditoria'] as const)(
    'debe_propagar_el_error_cuando_falla_%s_para_que_la_tx_revierta',
    async (op) => {
      const { useCase } = montar({ fallarEn: op });

      await expect(useCase.ejecutar(comando())).rejects.toThrow(
        `FALLO_${op.toUpperCase()}`,
      );
    },
  );

  it('debe_orquestar_todo_el_registro_dentro_de_una_unica_unidad_de_trabajo', async () => {
    const { useCase, uow } = montar();

    await useCase.ejecutar(comando());

    expect(uow.ejecutar).toHaveBeenCalledTimes(1);
  });
});

// ===========================================================================
// 3.4 — Re-firma NO idempotente (D-re-firma): con cond_part_firmadas ya true, un
//        segundo registro crea OTRA fila DOCUMENTO, actualiza la fecha, MANTIENE el
//        flag true y conserva el histórico. AUDIT_LOG datos_anteriores=true.
// ===========================================================================

describe('RegistrarFirmaCondicionesUseCase — re-firma no idempotente conservando histórico (3.4)', () => {
  it('debe_crear_otra_version_DOCUMENTO_cuando_ya_estaba_firmada', async () => {
    const { useCase, repos } = montar({
      reserva: reservaValida({ condPartFirmadas: true }),
    });

    await expect(useCase.ejecutar(comando())).resolves.toBeDefined();

    // No se rechaza; se crea una nueva fila DOCUMENTO (versión adicional).
    expect(repos.documentos.crear).toHaveBeenCalledTimes(1);
    expect(repos.documentos.crear.mock.calls[0][0].tipo).toBe('condiciones_particulares');
  });

  it('debe_mantener_cond_part_firmadas_true_y_actualizar_la_fecha_en_la_re_firma', async () => {
    const { useCase, repos } = montar({
      reserva: reservaValida({ condPartFirmadas: true }),
    });

    await useCase.ejecutar(comando());

    const args = repos.reservas.marcarFirmada.mock.calls[0][0];
    expect(args.condPartFirmadas).toBe(true);
    expect(args.condPartFirmadasFecha).toEqual(AHORA);
  });

  it('debe_auditar_datos_anteriores_cond_part_firmadas_true_en_la_re_firma', async () => {
    const { useCase, repos } = montar({
      reserva: reservaValida({ condPartFirmadas: true }),
    });

    await useCase.ejecutar(comando());

    const args = repos.auditoria.registrar.mock.calls[0][0];
    expect(args.accion).toBe('actualizar');
    expect(args.datosAnteriores.condPartFirmadas).toBe(true);
    expect(args.datosNuevos.condPartFirmadas).toBe(true);
  });
});

// ===========================================================================
// 3.5 — No transición: el use-case NO expone/usa ningún cambio de estado ni de
//        sub-procesos. El repositorio de RESERVA solo recibe el marcado de firma
//        (cond_part_*), nunca `estado`, `preEventoStatus`, `liquidacionStatus` ni
//        `fianzaStatus`; y el AUDIT_LOG usa `actualizar`, nunca `transicion`.
// ===========================================================================

describe('RegistrarFirmaCondicionesUseCase — no transición de estado ni sub-procesos (3.5)', () => {
  it.each(['reserva_confirmada', 'evento_en_curso', 'post_evento'] as const)(
    'no_debe_cambiar_estado_ni_sub_procesos_al_registrar_la_firma_en_%s',
    async (estado) => {
      const { useCase, repos } = montar({ reserva: reservaValida({ estado }) });

      await useCase.ejecutar(comando());

      const args = repos.reservas.marcarFirmada.mock.calls[0][0];
      // El comando de marcado NO transporta cambios de estado ni de sub-procesos.
      expect(args).not.toHaveProperty('estado');
      expect(args).not.toHaveProperty('preEventoStatus');
      expect(args).not.toHaveProperty('liquidacionStatus');
      expect(args).not.toHaveProperty('fianzaStatus');
      // AUDIT_LOG nunca es transicion.
      const audit = repos.auditoria.registrar.mock.calls[0][0];
      expect(audit.accion).toBe('actualizar');
      expect(audit.entidad).toBe('RESERVA');
    },
  );
});

// ===========================================================================
// 404 — RESERVA inexistente para el tenant (RLS: cross-tenant invisible) → sin
//        efectos.
// ===========================================================================

describe('RegistrarFirmaCondicionesUseCase — RESERVA inexistente / cross-tenant → 404', () => {
  it('debe_lanzar_ReservaNoEncontrada_cuando_no_existe_para_el_tenant_sin_efectos', async () => {
    const { useCase, repos, almacenarCondiciones } = montar({ reserva: null });

    await expect(
      useCase.ejecutar(comando({ tenantId: OTRO_TENANT })),
    ).rejects.toBeInstanceOf(ReservaNoEncontradaError);

    expect(almacenarCondiciones).not.toHaveBeenCalled();
    expect(repos.documentos.crear).not.toHaveBeenCalled();
    expect(repos.reservas.marcarFirmada).not.toHaveBeenCalled();
  });
});
