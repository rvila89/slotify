/**
 * TESTS del caso de uso `RegistrarIbanDevolucionUseCase` (US-035 / UC-26 FA-01, UC-27) —
 * fase TDD RED. tasks.md Fase 3: §3.2 (happy path), §3.3 (FA-01 IBAN inválido), §3.4 (FA-02
 * corrección + reenvío), §3.5 (FA-03 fallo de E8 no revierte), §3.6 (FA-04 sin fianza / fuera
 * de post_evento).
 *
 * Trazabilidad: US-035; spec-delta `comunicaciones`. Contrato CONGELADO `docs/api-spec.yml`
 * op `PATCH /reservas/{id}/iban-devolucion` con body `{ iban }`:
 *   - 200 `RegistrarIbanDevolucionResponse`: `{ iban, avisoEmail }` (avisoEmail nullable;
 *     presente `{ codigo: 'e8_fallido', mensaje, comunicacionId }` en FA-03).
 *   - 409 `code: estado_no_post_evento | sin_fianza` (FA-04).
 *   - 422 IBAN inválido (FA-01, checksum mod-97).
 *
 * Decisiones del Gate: D-1 (efecto persistido en `CLIENTE.iban_devolucion`; auditoría
 * `entidad='CLIENTE'`), D-2 (guardar-luego-enviar: E8 post-commit, su fallo no revierte),
 * D-3A (cada registro/corrección crea una NUEVA fila COMUNICACION E8, sin bloqueo por
 * idempotencia), D-5A (endpoint arriba).
 *
 * Ejercita la APLICACIÓN contra DOBLES DE LOS PUERTOS (in-memory), SIN tocar Prisma
 * (hexagonal, hook `no-infra-in-domain`). La ATOMICIDAD real (`UPDATE CLIENTE` + AUDIT_LOG en
 * una transacción bajo RLS) y el transporte fake real de email viven en el `…-integracion`
 * / QA con Postgres real; aquí se fija la ORQUESTACIÓN (design.md §D-1/§D-2/§D-3):
 *   1. Guarda de PRECONDICIÓN previa a la tx (FA-04): estado='post_evento' Y fianzaEur>0; si
 *      no, error de conflicto SIN efectos (sin validar IBAN, sin tx, sin E8).
 *   2. Validación IBAN mod-97 (FA-01) ANTES de la tx: inválido → error de validación SIN
 *      persistir ni disparar E8.
 *   3. Paso TRANSACCIONAL: UPDATE `CLIENTE.iban_devolucion` (normalizado) + AUDIT_LOG
 *      (`accion='actualizar'`, `entidad='CLIENTE'`, datos_anteriores/datos_nuevos). Commit.
 *   4. Paso POST-COMMIT (best-effort): dispara E8 al CLIENTE. Un fallo del proveedor deja
 *      `resultado='fallido'` SIN revertir el IBAN (FA-03) y produce el `avisoEmail`.
 *
 * RED: aún NO existe `reservas/application/registrar-iban-devolucion.use-case.ts` ni sus
 * puertos/tipos. Los imports fallan y la batería está en ROJO por AUSENCIA DE IMPLEMENTACIÓN.
 * GREEN es de `backend-developer`.
 */
import {
  RegistrarIbanDevolucionUseCase,
  ReservaNoEncontradaError,
  IbanInvalidoError,
  EstadoNoPostEventoError,
  SinFianzaError,
  type RegistrarIbanDevolucionDeps,
  type RegistrarIbanDevolucionComando,
  type ReservaIbanDevolucion,
  type RepositoriosIbanDevolucion,
  type UnidadDeTrabajoIbanDevolucionPort,
  type DispararE8Port,
  type ResultadoDispararE8,
} from '../application/registrar-iban-devolucion.use-case';

const TENANT = '00000000-0000-0000-0000-000000000001';
const OTRO_TENANT = '00000000-0000-0000-0000-0000000000ff';
const GESTOR = '00000000-0000-0000-0000-000000000002';
const RESERVA_ID = 'res-post-evento';
const CLIENTE_ID = 'cli-1';

const IBAN_VALIDO = 'ES9121000418450200051332';
const IBAN_VALIDO_CON_ESPACIOS = 'ES91 2100 0418 4502 0005 1332';
const IBAN_PREVIO = 'ES6621000418401234567891';
const IBAN_INVALIDO = 'ES12345INVALIDO';

// ---------------------------------------------------------------------------
// Doble de datos: RESERVA en post_evento con fianza cobrada + CLIENTE con email.
// ---------------------------------------------------------------------------

const reservaPostEvento = (
  over: Partial<ReservaIbanDevolucion> = {},
): ReservaIbanDevolucion => ({
  idReserva: RESERVA_ID,
  tenantId: TENANT,
  clienteId: CLIENTE_ID,
  estado: 'post_evento',
  fianzaEur: '1000.00',
  clienteEmail: 'ada@us035.test',
  ibanDevolucionActual: null,
  ...over,
});

// ---------------------------------------------------------------------------
// Repos tx-bound + UoW fake. El use-case orquesta la tx de escritura del IBAN.
// ---------------------------------------------------------------------------

interface ReposFake extends RepositoriosIbanDevolucion {
  clientes: { actualizarIbanDevolucion: jest.Mock };
  auditoria: { registrar: jest.Mock };
}

const crearReposFake = (): ReposFake => ({
  clientes: {
    // El adaptador real hace `UPDATE cliente SET iban_devolucion=? WHERE id=? AND tenant=?`
    // bajo RLS y devuelve las filas afectadas (1 == se aplicó).
    actualizarIbanDevolucion: jest.fn(async () => ({ filasAfectadas: 1 })),
  },
  auditoria: { registrar: jest.fn(async () => undefined) },
});

const crearUoWFake = (
  repos: ReposFake,
): UnidadDeTrabajoIbanDevolucionPort & { ejecutar: jest.Mock } => ({
  ejecutar: jest.fn(
    async (
      _tenantId: string,
      trabajo: (r: RepositoriosIbanDevolucion) => Promise<unknown>,
    ) => trabajo(repos),
  ),
});

const crearDispararE8Fake = (
  resultado: ResultadoDispararE8,
): DispararE8Port & { disparar: jest.Mock } => ({
  disparar: jest.fn(async () => resultado),
});

interface Escenario {
  deps: RegistrarIbanDevolucionDeps;
  repos: ReposFake;
  uow: ReturnType<typeof crearUoWFake>;
  e8: ReturnType<typeof crearDispararE8Fake>;
}

const construir = (
  opciones: {
    reserva?: ReservaIbanDevolucion | null;
    resultadoE8?: ResultadoDispararE8;
  } = {},
): Escenario => {
  const repos = crearReposFake();
  const uow = crearUoWFake(repos);
  const e8 = crearDispararE8Fake(
    opciones.resultadoE8 ?? { resultado: 'enviado', comunicacionId: 'com-e8-1' },
  );
  const reserva =
    opciones.reserva === undefined ? reservaPostEvento() : opciones.reserva;
  const deps: RegistrarIbanDevolucionDeps = {
    unidadDeTrabajo: uow,
    cargarReserva: jest.fn(async () => reserva),
    dispararE8: e8,
  };
  return { deps, repos, uow, e8 };
};

const comando = (
  over: Partial<RegistrarIbanDevolucionComando> = {},
): RegistrarIbanDevolucionComando => ({
  tenantId: TENANT,
  usuarioId: GESTOR,
  reservaId: RESERVA_ID,
  iban: IBAN_VALIDO,
  ...over,
});

// ===========================================================================
// 3.2 — Happy path: valida mod-97, persiste CLIENTE.iban_devolucion, audita
//        entidad=CLIENTE con datos_anteriores/datos_nuevos, dispara E8 al CLIENTE.email.
// ===========================================================================

describe('RegistrarIbanDevolucion — happy path (3.2)', () => {
  it('debe_persistir_el_iban_en_cliente_auditar_como_cliente_y_disparar_e8', async () => {
    const { deps, repos, e8 } = construir({
      resultadoE8: { resultado: 'enviado', comunicacionId: 'com-e8-1' },
    });
    const uc = new RegistrarIbanDevolucionUseCase(deps);

    const resultado = await uc.ejecutar(comando());

    // El IBAN normalizado se devuelve y no hay aviso (E8 enviado).
    expect(resultado.iban).toBe(IBAN_VALIDO);
    expect(resultado.avisoEmail).toBeNull();

    // Se persiste en CLIENTE exactamente una vez, con el IBAN normalizado.
    expect(repos.clientes.actualizarIbanDevolucion).toHaveBeenCalledTimes(1);
    expect(repos.clientes.actualizarIbanDevolucion).toHaveBeenCalledWith(
      expect.objectContaining({
        clienteId: CLIENTE_ID,
        tenantId: TENANT,
        ibanDevolucion: IBAN_VALIDO,
      }),
    );

    // AUDIT_LOG: accion='actualizar', entidad='CLIENTE', datos_anteriores/datos_nuevos, origen Usuario.
    expect(repos.auditoria.registrar).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: TENANT,
        usuarioId: GESTOR,
        accion: 'actualizar',
        entidad: 'CLIENTE',
        entidadId: CLIENTE_ID,
        datosAnteriores: { iban_devolucion: null },
        datosNuevos: { iban_devolucion: IBAN_VALIDO },
      }),
    );

    // E8 disparado post-commit hacia el CLIENTE (nunca al gestor).
    expect(e8.disparar).toHaveBeenCalledTimes(1);
    expect(e8.disparar).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: TENANT,
        reservaId: RESERVA_ID,
        clienteId: CLIENTE_ID,
      }),
    );
  });

  it('debe_normalizar_el_iban_con_espacios_antes_de_persistir_y_auditar', async () => {
    const { deps, repos } = construir();
    const uc = new RegistrarIbanDevolucionUseCase(deps);

    const resultado = await uc.ejecutar(comando({ iban: IBAN_VALIDO_CON_ESPACIOS }));

    // Se guarda/devuelve el valor normalizado (mayúsculas, sin espacios), no el crudo.
    expect(resultado.iban).toBe(IBAN_VALIDO);
    expect(repos.clientes.actualizarIbanDevolucion).toHaveBeenCalledWith(
      expect.objectContaining({ ibanDevolucion: IBAN_VALIDO }),
    );
  });

  it('debe_disparar_e8_estrictamente_despues_de_persistir_el_iban_guardar_luego_enviar', async () => {
    const { deps, repos, e8 } = construir();
    const orden: string[] = [];
    repos.clientes.actualizarIbanDevolucion.mockImplementationOnce(async () => {
      orden.push('persistir');
      return { filasAfectadas: 1 };
    });
    e8.disparar.mockImplementationOnce(async () => {
      orden.push('e8');
      return { resultado: 'enviado', comunicacionId: 'com-e8-1' };
    });
    const uc = new RegistrarIbanDevolucionUseCase(deps);

    await uc.ejecutar(comando());

    // D-2: el envío de E8 es POSTERIOR a la persistencia del IBAN.
    expect(orden).toEqual(['persistir', 'e8']);
  });
});

// ===========================================================================
// 3.3 — FA-01: IBAN inválido bloquea la escritura ANTES de persistir; no envía E8; 422.
// ===========================================================================

describe('RegistrarIbanDevolucion — FA-01 IBAN inválido (3.3)', () => {
  it('debe_lanzar_iban_invalido_sin_persistir_ni_disparar_e8', async () => {
    const { deps, repos, e8 } = construir();
    const uc = new RegistrarIbanDevolucionUseCase(deps);

    await expect(uc.ejecutar(comando({ iban: IBAN_INVALIDO }))).rejects.toBeInstanceOf(
      IbanInvalidoError,
    );

    // La validación precede a TODA escritura (FA-01): sin UPDATE, sin AUDIT_LOG, sin E8.
    expect(repos.clientes.actualizarIbanDevolucion).not.toHaveBeenCalled();
    expect(repos.auditoria.registrar).not.toHaveBeenCalled();
    expect(e8.disparar).not.toHaveBeenCalled();
  });

  it('debe_exponer_un_error_mapeable_a_422', async () => {
    const { deps } = construir();
    const uc = new RegistrarIbanDevolucionUseCase(deps);

    // El error de dominio debe permitir al controller responder 422 (validación).
    await expect(uc.ejecutar(comando({ iban: IBAN_INVALIDO }))).rejects.toMatchObject({
      codigo: 'iban_invalido',
    });
  });

  it('no_debe_ni_abrir_la_transaccion_cuando_el_iban_es_invalido', async () => {
    const { deps, uow } = construir();
    const uc = new RegistrarIbanDevolucionUseCase(deps);

    await expect(uc.ejecutar(comando({ iban: IBAN_INVALIDO }))).rejects.toBeInstanceOf(
      IbanInvalidoError,
    );

    // La guarda de validación es previa a la unidad de trabajo (no se abre tx).
    expect(uow.ejecutar).not.toHaveBeenCalled();
  });
});

// ===========================================================================
// 3.4 — FA-02: corrección sobreescribe el IBAN, audita el valor previo, y REENVÍA E8
//        creando una NUEVA COMUNICACION (D-3A, sin bloqueo por idempotencia).
// ===========================================================================

describe('RegistrarIbanDevolucion — FA-02 corrección + reenvío (3.4)', () => {
  it('debe_sobreescribir_el_iban_y_auditar_el_valor_previo', async () => {
    const { deps, repos } = construir({
      reserva: reservaPostEvento({ ibanDevolucionActual: IBAN_PREVIO }),
    });
    const uc = new RegistrarIbanDevolucionUseCase(deps);

    const resultado = await uc.ejecutar(comando({ iban: IBAN_VALIDO }));

    expect(resultado.iban).toBe(IBAN_VALIDO);
    // La sobreescritura persiste el nuevo IBAN.
    expect(repos.clientes.actualizarIbanDevolucion).toHaveBeenCalledWith(
      expect.objectContaining({ ibanDevolucion: IBAN_VALIDO }),
    );
    // El AUDIT_LOG captura el valor PREVIO (no null) y el nuevo.
    expect(repos.auditoria.registrar).toHaveBeenCalledWith(
      expect.objectContaining({
        accion: 'actualizar',
        entidad: 'CLIENTE',
        entidadId: CLIENTE_ID,
        datosAnteriores: { iban_devolucion: IBAN_PREVIO },
        datosNuevos: { iban_devolucion: IBAN_VALIDO },
      }),
    );
  });

  it('debe_reenviar_e8_en_cada_correccion_sin_bloqueo_por_idempotencia', async () => {
    // D-3A: la corrección es una acción intencionada del gestor; SIEMPRE dispara E8 (nueva
    // COMUNICACION). El use-case invoca el puerto sin condicionar por idempotencia; que el
    // adaptador cree una fila NUEVA (excepción auditada al UNIQUE parcial) se verifica en
    // integración.
    const { deps, e8 } = construir({
      reserva: reservaPostEvento({ ibanDevolucionActual: IBAN_PREVIO }),
      resultadoE8: { resultado: 'enviado', comunicacionId: 'com-e8-2' },
    });
    const uc = new RegistrarIbanDevolucionUseCase(deps);

    const resultado = await uc.ejecutar(comando({ iban: IBAN_VALIDO }));

    expect(e8.disparar).toHaveBeenCalledTimes(1);
    expect(e8.disparar).toHaveBeenCalledWith(
      expect.objectContaining({ reservaId: RESERVA_ID, clienteId: CLIENTE_ID }),
    );
    // El reenvío exitoso no genera aviso de fallo.
    expect(resultado.avisoEmail).toBeNull();
  });
});

// ===========================================================================
// 3.5 — FA-03: fallo de E8 NO revierte el IBAN guardado; COMUNICACION.estado='fallido';
//        se devuelve el avisoEmail (transporte fake forzado a fallar).
// ===========================================================================

describe('RegistrarIbanDevolucion — FA-03 fallo de E8 no revierte el IBAN (3.5)', () => {
  it('debe_mantener_el_iban_guardado_y_devolver_aviso_cuando_e8_falla', async () => {
    const { deps, repos } = construir({
      resultadoE8: { resultado: 'fallido', comunicacionId: 'com-e8-fallida' },
    });
    const uc = new RegistrarIbanDevolucionUseCase(deps);

    const resultado = await uc.ejecutar(comando());

    // El IBAN quedó guardado igualmente (guardar-luego-enviar, D-2): no se revierte.
    expect(resultado.iban).toBe(IBAN_VALIDO);
    expect(repos.clientes.actualizarIbanDevolucion).toHaveBeenCalledTimes(1);

    // El avisoEmail señala el fallo de E8 (FA-03) para la UI (alerta + botón de reenvío),
    // con el discriminador `e8_fallido` y el id de la COMUNICACION fallida para el reintento.
    expect(resultado.avisoEmail).not.toBeNull();
    expect(resultado.avisoEmail).toEqual(
      expect.objectContaining({
        codigo: 'e8_fallido',
        comunicacionId: 'com-e8-fallida',
      }),
    );
    expect(typeof resultado.avisoEmail?.mensaje).toBe('string');
  });

  it('no_debe_propagar_la_excepcion_ni_revertir_el_iban_si_el_puerto_de_e8_lanza', async () => {
    const { deps, repos, e8 } = construir();
    // El transporte fake, forzado a fallar, hace que el puerto lance tras el commit.
    e8.disparar.mockRejectedValueOnce(new Error('PROVEEDOR_EMAIL_CAIDO'));
    const uc = new RegistrarIbanDevolucionUseCase(deps);

    const resultado = await uc.ejecutar(comando());

    // La escritura ya commiteó: el fallo del envío no debe tumbar la respuesta ni revertir.
    expect(repos.clientes.actualizarIbanDevolucion).toHaveBeenCalledTimes(1);
    expect(resultado.iban).toBe(IBAN_VALIDO);
    // Se degrada a aviso de FA-03 (E8 fallido) sin comunicacionId (el motor no la resolvió).
    expect(resultado.avisoEmail).toEqual(
      expect.objectContaining({ codigo: 'e8_fallido' }),
    );
  });
});

// ===========================================================================
// 3.6 — FA-04: sin fianza (fianza_eur=0 o NULL) o fuera de post_evento ⇒ backend rechaza,
//        no persiste, no valida IBAN, no envía E8 (409 con code semántico).
// ===========================================================================

describe('RegistrarIbanDevolucion — FA-04 sin fianza / fuera de post_evento (3.6)', () => {
  it('debe_rechazar_con_sin_fianza_cuando_fianza_eur_es_cero', async () => {
    const { deps, repos, e8 } = construir({
      reserva: reservaPostEvento({ fianzaEur: '0.00' }),
    });
    const uc = new RegistrarIbanDevolucionUseCase(deps);

    await expect(uc.ejecutar(comando())).rejects.toBeInstanceOf(SinFianzaError);

    // Rechazo previo a TODO efecto: sin UPDATE, sin AUDIT_LOG, sin E8.
    expect(repos.clientes.actualizarIbanDevolucion).not.toHaveBeenCalled();
    expect(repos.auditoria.registrar).not.toHaveBeenCalled();
    expect(e8.disparar).not.toHaveBeenCalled();
  });

  it('debe_rechazar_con_sin_fianza_cuando_fianza_eur_es_null', async () => {
    const { deps, e8 } = construir({
      reserva: reservaPostEvento({ fianzaEur: null }),
    });
    const uc = new RegistrarIbanDevolucionUseCase(deps);

    await expect(uc.ejecutar(comando())).rejects.toBeInstanceOf(SinFianzaError);
    expect(e8.disparar).not.toHaveBeenCalled();
  });

  it('debe_exponer_code_sin_fianza_en_el_error', async () => {
    const { deps } = construir({ reserva: reservaPostEvento({ fianzaEur: '0.00' }) });
    const uc = new RegistrarIbanDevolucionUseCase(deps);

    await expect(uc.ejecutar(comando())).rejects.toMatchObject({ codigo: 'sin_fianza' });
  });

  const estadosNoPostEvento = [
    'consulta',
    'pre_reserva',
    'reserva_confirmada',
    'evento_en_curso',
    'reserva_completada',
    'reserva_cancelada',
  ] as const;

  it.each(estadosNoPostEvento)(
    'debe_rechazar_con_estado_no_post_evento_desde_%s_sin_efectos',
    async (estado) => {
      const { deps, repos, e8 } = construir({
        reserva: reservaPostEvento({ estado }),
      });
      const uc = new RegistrarIbanDevolucionUseCase(deps);

      await expect(uc.ejecutar(comando())).rejects.toBeInstanceOf(EstadoNoPostEventoError);

      expect(repos.clientes.actualizarIbanDevolucion).not.toHaveBeenCalled();
      expect(repos.auditoria.registrar).not.toHaveBeenCalled();
      expect(e8.disparar).not.toHaveBeenCalled();
    },
  );

  it('debe_exponer_code_estado_no_post_evento_en_el_error', async () => {
    const { deps } = construir({
      reserva: reservaPostEvento({ estado: 'reserva_confirmada' }),
    });
    const uc = new RegistrarIbanDevolucionUseCase(deps);

    await expect(uc.ejecutar(comando())).rejects.toMatchObject({
      codigo: 'estado_no_post_evento',
    });
  });

  it('debe_priorizar_el_conflicto_de_precondicion_sobre_la_validacion_de_iban', async () => {
    // FA-04 corta antes que FA-01: sin fianza + IBAN inválido ⇒ 409 (no 422), sin validar IBAN.
    const { deps } = construir({ reserva: reservaPostEvento({ fianzaEur: null }) });
    const uc = new RegistrarIbanDevolucionUseCase(deps);

    await expect(
      uc.ejecutar(comando({ iban: IBAN_INVALIDO })),
    ).rejects.toBeInstanceOf(SinFianzaError);
  });
});

// ===========================================================================
// RESERVA inexistente / de otro tenant (RLS): cargarReserva devuelve null → 404.
// ===========================================================================

describe('RegistrarIbanDevolucion — reserva inexistente o de otro tenant (404)', () => {
  it('debe_lanzar_ReservaNoEncontrada_cuando_no_existe_para_el_tenant', async () => {
    const { deps, repos, e8 } = construir({ reserva: null });
    const uc = new RegistrarIbanDevolucionUseCase(deps);

    await expect(
      uc.ejecutar(comando({ tenantId: OTRO_TENANT })),
    ).rejects.toBeInstanceOf(ReservaNoEncontradaError);

    expect(repos.clientes.actualizarIbanDevolucion).not.toHaveBeenCalled();
    expect(e8.disparar).not.toHaveBeenCalled();
  });
});
