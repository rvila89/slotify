/**
 * TESTS del caso de uso `ActualizarDatosFiscalesClienteUseCase`
 * (US-014 #5, Parte B / UC-14) — fase TDD RED. tasks.md Fase 3:
 *   §3.1 (actualiza solo los campos fiscales del CLIENTE presentes en el comando; no toca la RESERVA),
 *   §3.2 (actualización parcial no borra campos fiscales ya presentes, D-2),
 *   §3.3 (RESERVA inexistente / de otro tenant bajo RLS → error de "no encontrada",
 *         tenant SIEMPRE del JWT, nunca del body).
 *
 * Trazabilidad: US-014 (#5); spec-delta `presupuestos`. Contrato CONGELADO `docs/api-spec.yml`
 * op `PATCH /reservas/{id}/datos-fiscales` (operationId `actualizarDatosFiscalesCliente`) con body
 * `ActualizarDatosFiscalesClienteRequest` (los 5 campos opcionales, `minProperties: 1`, `minLength: 1`):
 *   - 200 `ActualizarDatosFiscalesClienteResponse`: `{ dniNif, direccion, codigoPostal, poblacion,
 *     provincia }` (cada uno nullable) — estado resultante de los 5 campos fiscales del CLIENTE.
 *   - 404 RESERVA inexistente / de otro tenant (RLS).
 *
 * Decisiones del Gate (design.md): D-1 (endpoint dedicado contextualizado en la RESERVA, patrón
 * `iban-devolucion`), D-2 (PATCH parcial: solo se actualizan los campos PRESENTES; los ausentes NO se
 * tocan, no se sobrescriben a null), D-3 (alcance estricto CLIENTE: NO se muta la RESERVA
 * —estado/subEstado/ttl/campos de evento— ni FECHA_BLOQUEADA), D-4 (módulo `reservas`; hexagonal:
 * controller → use-case → puerto de escritura (domain) → adaptador Prisma (infra)).
 *
 * Ejercita la APLICACIÓN contra DOBLES DE LOS PUERTOS (in-memory), SIN tocar Prisma
 * (hexagonal, hook `no-infra-in-domain`). La persistencia real (UPDATE parcial de columnas
 * escalares del CLIENTE + AUDIT_LOG en una transacción bajo RLS) y que NO muta RESERVA/FECHA_BLOQUEADA
 * se verifican en el `…-integracion` / QA con Postgres real; aquí se fija la ORQUESTACIÓN:
 *   0. Cargar la RESERVA bajo RLS del tenant del JWT (`cargarReserva`). `null` → error de "no
 *      encontrada" (inexistente / otro tenant).
 *   1. Paso TRANSACCIONAL: UPDATE PARCIAL de los campos fiscales PRESENTES del CLIENTE + AUDIT_LOG
 *      (`accion='actualizar'`, `entidad='CLIENTE'`, datos_anteriores/datos_nuevos). Commit.
 *   2. Devuelve el estado resultante de los 5 campos fiscales.
 *
 * RED: aún NO existe `reservas/application/actualizar-datos-fiscales-cliente.use-case.ts` ni sus
 * puertos/tipos. Los imports fallan y la batería está en ROJO por AUSENCIA DE IMPLEMENTACIÓN.
 * GREEN es de `backend-developer`.
 */
import {
  ActualizarDatosFiscalesClienteUseCase,
  ReservaNoEncontradaError,
  type ActualizarDatosFiscalesClienteDeps,
  type ActualizarDatosFiscalesClienteComando,
  type ReservaDatosFiscales,
  type DatosFiscalesCliente,
  type RepositoriosDatosFiscales,
  type UnidadDeTrabajoDatosFiscalesPort,
} from '../application/actualizar-datos-fiscales-cliente.use-case';

const TENANT = '00000000-0000-0000-0000-000000000001';
const OTRO_TENANT = '00000000-0000-0000-0000-0000000000ff';
const GESTOR = '00000000-0000-0000-0000-000000000002';
const RESERVA_ID = 'res-presupuesto';
const CLIENTE_ID = 'cli-1';

// Valores fiscales previos del CLIENTE (para verificar que el PATCH parcial no los pisa).
const FISCALES_PREVIOS: DatosFiscalesCliente = {
  dniNif: '12345678Z',
  direccion: 'Calle Vieja 1',
  codigoPostal: '08001',
  poblacion: 'Barcelona',
  provincia: 'Barcelona',
};

// ---------------------------------------------------------------------------
// Doble de datos: RESERVA resoluble bajo RLS con su CLIENTE y sus fiscales previos.
// ---------------------------------------------------------------------------

const reservaConCliente = (
  over: Partial<ReservaDatosFiscales> = {},
): ReservaDatosFiscales => ({
  idReserva: RESERVA_ID,
  tenantId: TENANT,
  clienteId: CLIENTE_ID,
  datosFiscalesActuales: { ...FISCALES_PREVIOS },
  ...over,
});

// ---------------------------------------------------------------------------
// Repos tx-bound + UoW fake. El use-case orquesta la tx de escritura parcial.
// ---------------------------------------------------------------------------

interface ReposFake extends RepositoriosDatosFiscales {
  clientes: { actualizarDatosFiscales: jest.Mock };
  auditoria: { registrar: jest.Mock };
}

const crearReposFake = (): ReposFake => ({
  clientes: {
    // El adaptador real hace un UPDATE PARCIAL (solo columnas presentes) bajo RLS.
    actualizarDatosFiscales: jest.fn(async () => ({ filasAfectadas: 1 })),
  },
  auditoria: { registrar: jest.fn(async () => undefined) },
});

const crearUoWFake = (
  repos: ReposFake,
): UnidadDeTrabajoDatosFiscalesPort & { ejecutar: jest.Mock } => ({
  ejecutar: jest.fn(
    async (
      _tenantId: string,
      trabajo: (r: RepositoriosDatosFiscales) => Promise<unknown>,
    ) => trabajo(repos),
  ),
});

interface Escenario {
  deps: ActualizarDatosFiscalesClienteDeps;
  repos: ReposFake;
  uow: ReturnType<typeof crearUoWFake>;
  cargarReserva: jest.Mock;
}

const construir = (
  opciones: { reserva?: ReservaDatosFiscales | null } = {},
): Escenario => {
  const repos = crearReposFake();
  const uow = crearUoWFake(repos);
  const reserva =
    opciones.reserva === undefined ? reservaConCliente() : opciones.reserva;
  const cargarReserva = jest.fn(async () => reserva);
  const deps: ActualizarDatosFiscalesClienteDeps = {
    unidadDeTrabajo: uow,
    cargarReserva,
  };
  return { deps, repos, uow, cargarReserva };
};

const comando = (
  over: Partial<ActualizarDatosFiscalesClienteComando> = {},
): ActualizarDatosFiscalesClienteComando => ({
  tenantId: TENANT,
  usuarioId: GESTOR,
  reservaId: RESERVA_ID,
  datos: {
    dniNif: '99999999R',
    direccion: 'Avenida Nueva 42',
    codigoPostal: '28080',
    poblacion: 'Madrid',
    provincia: 'Madrid',
  },
  ...over,
});

// ===========================================================================
// 3.1 — Actualiza SOLO los campos fiscales del CLIENTE presentes en el comando; NO
//        toca la RESERVA. Audita entidad=CLIENTE. Devuelve los 5 campos resultantes.
// ===========================================================================

describe('ActualizarDatosFiscalesCliente — actualiza solo campos fiscales del CLIENTE (3.1)', () => {
  it('debe_actualizar_los_campos_fiscales_del_cliente_presentes_y_auditar_como_cliente', async () => {
    const { deps, repos } = construir();
    const uc = new ActualizarDatosFiscalesClienteUseCase(deps);

    const resultado = await uc.ejecutar(comando());

    // Persiste en el CLIENTE exactamente una vez, con los campos enviados y el contexto RLS.
    expect(repos.clientes.actualizarDatosFiscales).toHaveBeenCalledTimes(1);
    expect(repos.clientes.actualizarDatosFiscales).toHaveBeenCalledWith(
      expect.objectContaining({
        clienteId: CLIENTE_ID,
        tenantId: TENANT,
        datos: {
          dniNif: '99999999R',
          direccion: 'Avenida Nueva 42',
          codigoPostal: '28080',
          poblacion: 'Madrid',
          provincia: 'Madrid',
        },
      }),
    );

    // AUDIT_LOG: accion='actualizar', entidad='CLIENTE', origen Usuario (usuarioId poblado).
    expect(repos.auditoria.registrar).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: TENANT,
        usuarioId: GESTOR,
        accion: 'actualizar',
        entidad: 'CLIENTE',
        entidadId: CLIENTE_ID,
      }),
    );

    // Devuelve el estado resultante de los 5 campos fiscales del CLIENTE.
    expect(resultado).toEqual({
      dniNif: '99999999R',
      direccion: 'Avenida Nueva 42',
      codigoPostal: '28080',
      poblacion: 'Madrid',
      provincia: 'Madrid',
    });
  });

  it('no_debe_incluir_campos_de_la_reserva_en_la_actualizacion_del_cliente', async () => {
    // D-3: alcance estricto CLIENTE. Ni el use-case ni el puerto de escritura reciben
    // campos de la RESERVA (fechaEvento/duracionHoras/estado/subEstado/ttl). El único
    // puerto de escritura disponible es el del CLIENTE; no hay ninguna vía para mutar la RESERVA.
    const { deps, repos } = construir();
    const uc = new ActualizarDatosFiscalesClienteUseCase(deps);

    await uc.ejecutar(comando());

    const params = repos.clientes.actualizarDatosFiscales.mock.calls[0][0];
    // Solo las claves fiscales permitidas viajan al puerto de escritura del CLIENTE.
    expect(Object.keys(params.datos).sort()).toEqual(
      ['codigoPostal', 'direccion', 'dniNif', 'poblacion', 'provincia'].sort(),
    );
  });

  it('debe_abrir_la_unidad_de_trabajo_bajo_el_tenant_del_jwt', async () => {
    const { deps, uow } = construir();
    const uc = new ActualizarDatosFiscalesClienteUseCase(deps);

    await uc.ejecutar(comando());

    expect(uow.ejecutar).toHaveBeenCalledTimes(1);
    expect(uow.ejecutar).toHaveBeenCalledWith(TENANT, expect.any(Function));
  });
});

// ===========================================================================
// 3.2 — Actualización PARCIAL (D-2): enviar solo `direccion` + `codigoPostal` NO borra
//        los demás campos fiscales; el resto conserva su valor previo.
// ===========================================================================

describe('ActualizarDatosFiscalesCliente — PATCH parcial no borra campos previos (3.2)', () => {
  it('debe_actualizar_solo_los_campos_enviados_sin_tocar_los_ausentes', async () => {
    const { deps, repos } = construir();
    const uc = new ActualizarDatosFiscalesClienteUseCase(deps);

    await uc.ejecutar(
      comando({ datos: { direccion: 'Avenida Nueva 42', codigoPostal: '28080' } }),
    );

    const params = repos.clientes.actualizarDatosFiscales.mock.calls[0][0];
    // SOLO se envían al puerto los campos presentes: los ausentes NO viajan (no se ponen a null).
    expect(params.datos).toEqual({
      direccion: 'Avenida Nueva 42',
      codigoPostal: '28080',
    });
    expect(params.datos).not.toHaveProperty('dniNif');
    expect(params.datos).not.toHaveProperty('poblacion');
    expect(params.datos).not.toHaveProperty('provincia');
  });

  it('debe_devolver_los_ausentes_con_su_valor_previo_y_los_presentes_actualizados', async () => {
    const { deps } = construir();
    const uc = new ActualizarDatosFiscalesClienteUseCase(deps);

    const resultado = await uc.ejecutar(
      comando({ datos: { direccion: 'Avenida Nueva 42', codigoPostal: '28080' } }),
    );

    // Los campos enviados salen actualizados; los ausentes conservan el valor PREVIO del CLIENTE.
    expect(resultado).toEqual({
      dniNif: FISCALES_PREVIOS.dniNif,
      direccion: 'Avenida Nueva 42',
      codigoPostal: '28080',
      poblacion: FISCALES_PREVIOS.poblacion,
      provincia: FISCALES_PREVIOS.provincia,
    });
  });

  it('debe_auditar_solo_los_campos_cambiados_con_su_valor_anterior', async () => {
    const { deps, repos } = construir();
    const uc = new ActualizarDatosFiscalesClienteUseCase(deps);

    await uc.ejecutar(
      comando({ datos: { direccion: 'Avenida Nueva 42', codigoPostal: '28080' } }),
    );

    // El AUDIT_LOG refleja el cambio de los campos enviados (snake_case, valor previo → nuevo).
    const registro = repos.auditoria.registrar.mock.calls[0][0];
    expect(registro.accion).toBe('actualizar');
    expect(registro.entidad).toBe('CLIENTE');
    expect(registro.datosAnteriores).toEqual(
      expect.objectContaining({
        direccion: FISCALES_PREVIOS.direccion,
        codigo_postal: FISCALES_PREVIOS.codigoPostal,
      }),
    );
    expect(registro.datosNuevos).toEqual(
      expect.objectContaining({
        direccion: 'Avenida Nueva 42',
        codigo_postal: '28080',
      }),
    );
  });
});

// ===========================================================================
// 3.3 — RESERVA inexistente / de otro tenant (RLS): cargarReserva devuelve null → error de
//        "no encontrada". El tenant SIEMPRE del JWT, nunca del body; sin efectos.
// ===========================================================================

describe('ActualizarDatosFiscalesCliente — reserva inexistente o de otro tenant (3.3)', () => {
  it('debe_lanzar_ReservaNoEncontrada_cuando_no_existe_para_el_tenant', async () => {
    const { deps, repos } = construir({ reserva: null });
    const uc = new ActualizarDatosFiscalesClienteUseCase(deps);

    await expect(uc.ejecutar(comando())).rejects.toBeInstanceOf(
      ReservaNoEncontradaError,
    );

    // Sin efectos: no se abre la tx, no se actualiza el CLIENTE, no se audita.
    expect(repos.clientes.actualizarDatosFiscales).not.toHaveBeenCalled();
    expect(repos.auditoria.registrar).not.toHaveBeenCalled();
  });

  it('debe_resolver_la_reserva_con_el_tenant_del_jwt_nunca_del_body', async () => {
    const { deps, cargarReserva } = construir({ reserva: null });
    const uc = new ActualizarDatosFiscalesClienteUseCase(deps);

    // El comando llega con el tenant del JWT (OTRO_TENANT); la carga debe usar ESE tenant.
    await expect(
      uc.ejecutar(comando({ tenantId: OTRO_TENANT })),
    ).rejects.toBeInstanceOf(ReservaNoEncontradaError);

    expect(cargarReserva).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: OTRO_TENANT, reservaId: RESERVA_ID }),
    );
  });

  it('debe_exponer_code_RESERVA_NO_ENCONTRADA_en_el_error', async () => {
    const { deps } = construir({ reserva: null });
    const uc = new ActualizarDatosFiscalesClienteUseCase(deps);

    await expect(uc.ejecutar(comando())).rejects.toMatchObject({
      codigo: 'RESERVA_NO_ENCONTRADA',
    });
  });
});
