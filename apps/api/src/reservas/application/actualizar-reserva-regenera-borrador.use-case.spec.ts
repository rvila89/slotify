/**
 * TESTS del `ActualizarReservaUseCase` — REGENERACIÓN del borrador E1 al editar la
 * consulta — fase TDD RED (change `consulta-fecha-borrador-fix`, design.md §D-3).
 *
 * Trazabilidad: spec-delta `consultas` — Requirement "Edición de los datos de una
 * consulta/reserva" (regenerar el borrador E1 pendiente tras el PATCH con los datos nuevos):
 *   - GIVEN reserva 2b con COMUNICACION E1 `borrador` con placeholders; WHEN PATCH actualiza
 *     `numInvitadosFinal`/`duracionHoras`; THEN se invoca
 *     `regenerarBorrador.actualizarContenidoBorrador({tenantId, idComunicacion, asunto, cuerpo})`
 *     con asunto "Pre-reserva confirmada" y cuerpo re-renderizado (tipo 'disponible' para 2b)
 *     con los valores nuevos; la comunicación sigue en `borrador`.
 *   - 2d → tipo 'cola'.
 *   - Sin borrador E1 (enviado/inexistente) → NO se regenera nada.
 *   - Regeneración best-effort post-commit: si `actualizarContenidoBorrador` lanza, el PATCH
 *     NO revierte (el use-case resuelve con éxito).
 *   - NO hay guarda 409 al editar con borrador pendiente.
 *
 * Diseño (design.md §D-3), MISMO patrón que el pre-relleno del alta
 * (`fix-borrador-e1-cuerpo-prerelleno`):
 *   - Puerto estrecho de lectura `CargarBorradorE1PendientePort`
 *     (`cargarBorradorE1Pendiente`) → `{ idComunicacion } | null`.
 *   - Puerto de UPDATE post-commit `RegenerarBorradorE1Port`
 *     (`actualizarContenidoBorrador`), satisfecho por el `DespacharEmailService`.
 *   - El render usa `renderMensajeTransicionFecha` (módulo puro ya existente): tipo según el
 *     sub-estado (`2b → 'disponible'`, `2d → 'cola'`), idioma según `reserva.idioma`.
 *
 * Con dobles de puertos (in-memory / jest.fn): SIN Postgres. El test de INTEGRACIÓN con BD
 * real lo ejecuta la sesión principal.
 *
 * RED: aún NO existen en `application/actualizar-reserva.use-case.ts` los puertos
 * `CargarBorradorE1PendientePort`/`RegenerarBorradorE1Port` ni los campos
 * `cargarBorradorE1Pendiente`/`regenerarBorrador` de `ActualizarReservaDeps`, ni la rama de
 * regeneración. Los imports/uso fallan en compilación y/o las aserciones fallan → ROJO.
 * GREEN es de `backend-developer`.
 */
import {
  ActualizarReservaUseCase,
  type ActualizarReservaComando,
  type ActualizarReservaDeps,
  type ReservaActualizable,
  type RepositoriosActualizarReserva,
  type UnidadDeTrabajoActualizarReservaPort,
  // NUEVO (RED): puertos de la regeneración del borrador E1.
  type CargarBorradorE1PendientePort,
  type RegenerarBorradorE1Port,
  type RegenerarBorradorE1Params,
} from './actualizar-reserva.use-case';

const TENANT = '00000000-0000-0000-0000-000000000001';
const GESTOR = '00000000-0000-0000-0000-0000000000a1';
const RESERVA_ID = '00000000-0000-0000-0000-0000000000b1';
const COM_ID = '00000000-0000-0000-0000-0000000000c1';

// ---------------------------------------------------------------------------
// Dobles de puertos
// ---------------------------------------------------------------------------

const reservaBase = (over: Partial<ReservaActualizable> = {}): ReservaActualizable => ({
  idReserva: RESERVA_ID,
  tenantId: TENANT,
  estado: 'consulta',
  subEstado: '2b',
  fechaEvento: new Date(2026, 6, 19),
  tipoEvento: 'boda',
  duracionHoras: null,
  numAdultosNinosMayores4: null,
  numNinosMenores4: null,
  numInvitadosFinal: null,
  horario: null,
  notas: null,
  // Idioma de la RESERVA (para el render del borrador). NUEVO campo en la proyección.
  idioma: 'es',
  ...over,
} as ReservaActualizable);

const crearReposFake = (): RepositoriosActualizarReserva & {
  actualizarCampos: jest.Mock;
  registrar: jest.Mock;
} => {
  const actualizarCampos = jest.fn(async () => ({ filasAfectadas: 1 }));
  const registrar = jest.fn(async () => undefined);
  return {
    reservas: { actualizarCampos },
    auditoria: { registrar },
    actualizarCampos,
    registrar,
  } as RepositoriosActualizarReserva & { actualizarCampos: jest.Mock; registrar: jest.Mock };
};

const crearUowFake = (
  repos: RepositoriosActualizarReserva,
): UnidadDeTrabajoActualizarReservaPort & { ejecutar: jest.Mock } => ({
  ejecutar: jest.fn(
    async (_tenantId: string, trabajo: (r: RepositoriosActualizarReserva) => Promise<unknown>) =>
      trabajo(repos),
  ),
});

const crearCargarBorradorFake = (resultado: { idComunicacion: string } | null) => {
  const cargarBorradorE1Pendiente = jest.fn(async () => resultado);
  const port: CargarBorradorE1PendientePort = { cargarBorradorE1Pendiente };
  return { port, cargarBorradorE1Pendiente };
};

const crearRegenerarFake = () => {
  const actualizarContenidoBorrador = jest.fn(
    async (_p: RegenerarBorradorE1Params): Promise<unknown> => undefined,
  );
  const port: RegenerarBorradorE1Port = { actualizarContenidoBorrador };
  return { port, actualizarContenidoBorrador };
};

interface MontarOpts {
  reserva?: ReservaActualizable;
  borrador?: { idComunicacion: string } | null;
  regenerar?: ReturnType<typeof crearRegenerarFake>;
}

const montar = (opts: MontarOpts = {}) => {
  const reserva = opts.reserva ?? reservaBase();
  const repos = crearReposFake();
  const uow = crearUowFake(repos);
  const cargarBorrador = crearCargarBorradorFake(
    opts.borrador === undefined ? { idComunicacion: COM_ID } : opts.borrador,
  );
  const regenerar = opts.regenerar ?? crearRegenerarFake();
  const deps: ActualizarReservaDeps = {
    unidadDeTrabajo: uow,
    cargarReserva: jest.fn(async () => reserva),
    cargarBorradorE1Pendiente: cargarBorrador.port,
    regenerarBorrador: regenerar.port,
  };
  return {
    useCase: new ActualizarReservaUseCase(deps),
    repos,
    uow,
    cargarBorrador,
    regenerar,
  };
};

const comando = (campos: ActualizarReservaComando['campos']): ActualizarReservaComando => ({
  tenantId: TENANT,
  usuarioId: GESTOR,
  reservaId: RESERVA_ID,
  campos,
});

// ===========================================================================
// 2b → tipo 'disponible' con asunto "Pre-reserva confirmada" y datos nuevos.
// ===========================================================================

describe('ActualizarReservaUseCase — regenera el borrador E1 en 2b (disponible)', () => {
  it('debe_regenerar_asunto_Pre_reserva_confirmada_y_cuerpo_con_los_valores_nuevos', async () => {
    const { useCase, regenerar } = montar({
      reserva: reservaBase({ subEstado: '2b', idioma: 'es' }),
    });

    await useCase.ejecutar(comando({ numInvitadosFinal: 40, duracionHoras: 8 }));

    expect(regenerar.actualizarContenidoBorrador).toHaveBeenCalledTimes(1);
    const params = regenerar.actualizarContenidoBorrador.mock.calls[0][0];
    expect(params).toEqual(
      expect.objectContaining({ tenantId: TENANT, idComunicacion: COM_ID }),
    );
    expect(params.asunto).toBe('Pre-reserva confirmada');
    // Cuerpo re-renderizado con los valores NUEVOS (tipo 'disponible' para 2b).
    expect(params.cuerpo).toContain('40 personas');
    expect(params.cuerpo).toContain('8 horas');
    // Ya no queda el placeholder de datos faltantes.
    expect(params.cuerpo).not.toContain('___');
  });

  it('debe_usar_numAdultosNinosMayores4_como_personas_cuando_no_hay_numInvitadosFinal', async () => {
    // REGRESIÓN (hallado en E2E): el editor de consulta escribe `numAdultosNinosMayores4`
    // (campo "Invitados adultos y niños > 4"), NO `numInvitadosFinal`. El borrador DEBE
    // reflejar esas personas (aforo canónico = numInvitadosFinal ?? adultos + niños),
    // no quedarse con el placeholder `___` pese a haberse introducido las personas.
    const { useCase, regenerar } = montar({
      reserva: reservaBase({ subEstado: '2b', idioma: 'es' }),
    });

    await useCase.ejecutar(comando({ numAdultosNinosMayores4: 40, duracionHoras: 8 }));

    const params = regenerar.actualizarContenidoBorrador.mock.calls[0][0];
    expect(params.cuerpo).toContain('40 personas');
    expect(params.cuerpo).not.toContain('___');
  });

  it('debe_sumar_numAdultosNinosMayores4_y_numNinosMenores4_como_aforo', async () => {
    const { useCase, regenerar } = montar({
      reserva: reservaBase({ subEstado: '2b', idioma: 'es' }),
    });

    await useCase.ejecutar(
      comando({ numAdultosNinosMayores4: 40, numNinosMenores4: 5, duracionHoras: 8 }),
    );

    const params = regenerar.actualizarContenidoBorrador.mock.calls[0][0];
    expect(params.cuerpo).toContain('45 personas');
  });

  it('debe_renderizar_en_el_idioma_de_la_reserva_ca', async () => {
    const { useCase, regenerar } = montar({
      reserva: reservaBase({ subEstado: '2b', idioma: 'ca' }),
    });

    await useCase.ejecutar(comando({ numInvitadosFinal: 40, duracionHoras: 8 }));

    const params = regenerar.actualizarContenidoBorrador.mock.calls[0][0];
    expect(params.cuerpo).toContain('40 persones');
    expect(params.cuerpo).toContain('8 hores');
  });

  it('no_debe_cambiar_el_estado_de_la_comunicacion_ni_enviar_nada', async () => {
    // La regeneración usa `actualizarContenidoBorrador` (mantiene la fila en borrador):
    // el use-case NO invoca ningún envío. Basta con comprobar que solo se llama al UPDATE
    // de contenido y con que el resultado del PATCH es exitoso.
    const { useCase, regenerar } = montar();

    const out = await useCase.ejecutar(comando({ numInvitadosFinal: 10 }));

    expect(regenerar.actualizarContenidoBorrador).toHaveBeenCalledTimes(1);
    expect(out.reserva.idReserva).toBe(RESERVA_ID);
  });
});

// ===========================================================================
// 2d → tipo 'cola'.
// ===========================================================================

describe('ActualizarReservaUseCase — regenera el borrador E1 en 2d (cola)', () => {
  it('debe_re_renderizar_con_la_plantilla_de_cola_para_una_reserva_en_2d', async () => {
    const { useCase, regenerar } = montar({
      reserva: reservaBase({ subEstado: '2d', idioma: 'es' }),
    });

    await useCase.ejecutar(comando({ numInvitadosFinal: 20 }));

    const params = regenerar.actualizarContenidoBorrador.mock.calls[0][0];
    // Frase clave de la plantilla "cola" (no la de "disponible").
    expect(params.cuerpo).toContain('bloqueada por otra consulta');
    // El asunto de cola NO es "Pre-reserva confirmada".
    expect(params.asunto).not.toBe('Pre-reserva confirmada');
  });
});

// ===========================================================================
// Sin borrador E1 pendiente → NO se regenera nada.
// ===========================================================================

describe('ActualizarReservaUseCase — sin borrador E1 pendiente no toca comunicaciones', () => {
  it('no_regenera_cuando_no_existe_borrador_E1_enviado_o_inexistente', async () => {
    const { useCase, regenerar, cargarBorrador } = montar({ borrador: null });

    await useCase.ejecutar(comando({ numInvitadosFinal: 15 }));

    expect(cargarBorrador.cargarBorradorE1Pendiente).toHaveBeenCalledTimes(1);
    expect(regenerar.actualizarContenidoBorrador).not.toHaveBeenCalled();
  });
});

// ===========================================================================
// Best-effort: si la regeneración lanza, el PATCH NO revierte (resuelve con éxito).
// ===========================================================================

describe('ActualizarReservaUseCase — regeneración best-effort post-commit', () => {
  it('el_PATCH_resuelve_con_exito_aunque_la_regeneracion_del_borrador_falle', async () => {
    const regenerar = crearRegenerarFake();
    regenerar.actualizarContenidoBorrador.mockRejectedValueOnce(
      new Error('fallo al regenerar el borrador'),
    );
    const { useCase, repos } = montar({ regenerar });

    const out = await useCase.ejecutar(comando({ numInvitadosFinal: 25, duracionHoras: 8 }));

    // El UPDATE de la reserva SÍ ocurrió y el use-case NO propaga el fallo post-commit.
    expect(repos.actualizarCampos).toHaveBeenCalledTimes(1);
    expect(out.reserva.numInvitadosFinal).toBe(25);
    expect(out.reserva.duracionHoras).toBe(8);
  });
});

// ===========================================================================
// NO hay guarda 409 al editar con borrador pendiente.
// ===========================================================================

describe('ActualizarReservaUseCase — editar con borrador pendiente NO da 409', () => {
  it('permite_editar_y_persistir_los_campos_con_borrador_E1_pendiente', async () => {
    const { useCase, repos } = montar({ borrador: { idComunicacion: COM_ID } });

    const out = await useCase.ejecutar(comando({ numInvitadosFinal: 30 }));

    expect(repos.actualizarCampos).toHaveBeenCalledTimes(1);
    expect(out.reserva.numInvitadosFinal).toBe(30);
  });
});
