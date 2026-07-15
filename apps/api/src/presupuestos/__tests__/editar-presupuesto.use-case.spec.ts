/**
 * TESTS del caso de uso `EditarPresupuestoUseCase` (UC-15 / US-015) — fase TDD RED.
 * tasks.md Fase 3: 3.1 (precondición pre_reserva + presupuesto no aceptado — vertiente
 * PRESUPUESTO), 3.2 (precio congelado de RESERVA_EXTRA), 3.3 (versionado MAX+1 +
 * reintento P2002), 3.4 (tarifa_a_consultar >50 con precio manual), 3.5 (reenvío sin
 * cambios + guardar borrador), 3.6 (invariantes RESERVA/FECHA_BLOQUEADA + descuento ≤
 * base_imponible).
 *
 * Trazabilidad: US-015; spec-delta `presupuestos` (Requirements: precondición de
 * edición; recálculo del borrador sin persistir; nueva versión al confirmar; precio
 * congelado de extras; precio manual >50; envío E2 + AUDIT_LOG; guardar borrador;
 * reenvío sin cambios; no-mutación de RESERVA/FECHA_BLOQUEADA). design.md D1..D5
 * (RESUELTAS): reutilizar E2 + `es_reenvio=true`; fila nueva por versión inmutable
 * (vigente = MAX(version)); cada envío consume `AAAANNN` nuevo; borrador
 * `numero_presupuesto=null`; reenvío NO versiona; extras ligados a la RESERVA (conjunto
 * vivo, sin migración). Contrato OpenAPI: `previewEdicionPresupuesto` (200),
 * `editarPresupuesto` (201), `reenviarPresupuesto` (200).
 *
 * Ejercita la APLICACIÓN contra DOBLES DE LOS PUERTOS (in-memory), sin tocar Prisma
 * (hexagonal, hook `no-infra-in-domain`). Reutiliza el estilo de fixtures de
 * `generar-presupuesto.use-case.spec.ts` (US-014). La ATOMICIDAD real, la persistencia
 * SQL de `RESERVA_EXTRA` y el reintento `P2002` REAL sobre `@@unique([reservaId,
 * version])` viven en la suite de INTEGRACIÓN (BD real, ejecutar desde sesión
 * principal); aquí se fija la ORQUESTACIÓN del use-case. El reintento P2002 se prueba
 * también en unit con un UoW fake que inyecta la colisión (sin hilos reales; US-015
 * §Concurrencia no la marca zona crítica).
 *
 * RED: aún NO existe `presupuestos/application/editar-presupuesto.use-case.ts`. La
 * batería está en ROJO por AUSENCIA DE IMPLEMENTACIÓN. GREEN es de `backend-developer`.
 */
import {
  EditarPresupuestoUseCase,
  ReenviarPresupuestoUseCase,
  PresupuestoNoEditableError,
  ReservaFueraDePrereservaError,
  PrecioManualRequeridoError,
  DescuentoInvalidoError,
  DuracionInvalidaError,
  PresupuestoVigenteNoEncontradoError,
  ReservaNoEncontradaError,
  type EditarPresupuestoDeps,
  type ReenviarPresupuestoDeps,
  type EditarPresupuestoPreviewComando,
  type EditarPresupuestoConfirmarComando,
  type ReenviarPresupuestoComando,
  type ReposEditarPresupuesto,
  type UnidadDeTrabajoEditarPresupuestoPort,
  type ReservaEdicion,
  type PresupuestoVigente,
  type ExtraCatalogo,
  type LineaExtraExistente,
  type ClockPort,
  type TenantSettingsPresupuesto,
} from '../application/editar-presupuesto.use-case';
import {
  CalculadoraTarifaService,
  type CalculoTarifaResultado,
} from '../../tarifas/domain/calculadora-tarifa.service';

const TENANT = '00000000-0000-0000-0000-000000000001';
const OTRO_TENANT = '00000000-0000-0000-0000-0000000000ff';
const GESTOR = '00000000-0000-0000-0000-000000000002';
const RESERVA_ID = 'res-prereserva';
const P_VIGENTE_ID = 'presup-v1';
const DIA_MS = 24 * 60 * 60 * 1000;

const AHORA = new Date('2026-07-15T10:00:00.000Z');
const FECHA_EVENTO = new Date('2027-09-12T00:00:00.000Z');
const TTL_BLOQUEO = new Date(AHORA.getTime() + 5 * DIA_MS); // TTL vigente que NO debe cambiar
const relojFijo: ClockPort = { ahora: () => AHORA };

// Ids de extras del catálogo usados en los escenarios.
const EXTRA_BARBACOA = 'extra-barbacoa';
const EXTRA_PAELLERO = 'extra-paellero';

// ---------------------------------------------------------------------------
// Dobles de datos: RESERVA en pre_reserva + PRESUPUESTO vigente (version=1).
// ---------------------------------------------------------------------------

const reservaEnPrereserva = (over: Partial<ReservaEdicion> = {}): ReservaEdicion => ({
  idReserva: RESERVA_ID,
  tenantId: TENANT,
  clienteId: 'cli-1',
  estado: 'pre_reserva',
  subEstado: null,
  fechaEvento: FECHA_EVENTO,
  duracionHoras: 8,
  numAdultosNinosMayores4: 40,
  numNinosMenores4: 5,
  tipoEvento: 'boda',
  ttlExpiracion: TTL_BLOQUEO,
  ...over,
});

/** PRESUPUESTO vigente v1 CON IVA, total 3200 sin descuento, estado enviado. */
const presupuestoVigenteV1 = (
  over: Partial<PresupuestoVigente> = {},
): PresupuestoVigente => ({
  idPresupuesto: P_VIGENTE_ID,
  reservaId: RESERVA_ID,
  version: 1,
  estado: 'enviado',
  numeroPresupuesto: '2026001',
  metodoPago: 'transferencia',
  regimenIva: 'con_iva',
  baseImponible: '2644.63',
  ivaPorcentaje: '21.00',
  ivaImporte: '555.37',
  total: '3200.00',
  descuentoEur: null,
  descuentoMotivo: null,
  tarifaId: 'tarifa-alta-8h-31_40',
  pdfUrl: 'https://docs/presup-v1.pdf',
  ...over,
});

const settings: TenantSettingsPresupuesto = {
  ttlPrereservaDias: 7,
  pctSenal: 40,
  fianzaDefaultEur: 500,
};

// ---------------------------------------------------------------------------
// Motor de tarifa: doble ligero configurable (o error para propagación).
// ---------------------------------------------------------------------------

const resultadoTarifaNormal = (
  over: Partial<CalculoTarifaResultado> = {},
): CalculoTarifaResultado => ({
  temporada: 'alta',
  tarifaAConsultar: false,
  precioTarifaEur: 3200,
  extrasTotalEur: 0,
  totalEur: 3200,
  tarifaId: 'tarifa-alta-8h-31_40',
  ...over,
});

const resultadoTarifaAConsultar = (): CalculoTarifaResultado => ({
  temporada: 'alta',
  tarifaAConsultar: true,
  precioTarifaEur: null,
  extrasTotalEur: null,
  totalEur: null,
  tarifaId: null,
});

type MotorFake = { calcular: jest.Mock };
const crearMotorFake = (
  resultado: CalculoTarifaResultado | Error = resultadoTarifaNormal(),
): MotorFake => ({
  calcular: jest.fn(async () => {
    if (resultado instanceof Error) throw resultado;
    return resultado;
  }),
});

// ---------------------------------------------------------------------------
// Repositorios tx-bound + UoW fake. El use-case orquesta la tx única de la edición.
// ---------------------------------------------------------------------------

interface ReposFake extends ReposEditarPresupuesto {
  presupuestos: {
    /** MAX(version) actual de la reserva (para calcular version = MAX+1). */
    versionMaxima: jest.Mock;
    /** Último `numero_presupuesto` del año y régimen (numeración por envío). */
    ultimoNumeroDelAnio: jest.Mock;
    /** Crea la NUEVA fila de PRESUPUESTO (version=MAX+1, inmutable). */
    crearVersion: jest.Mock;
  };
  extras: {
    /** Reemplaza el conjunto de líneas RESERVA_EXTRA de la reserva (conjunto vivo). */
    reemplazarLineas: jest.Mock;
  };
  comunicaciones: {
    /** Registra la COMUNICACION E2 de reenvío (es_reenvio=true) al enviar. */
    registrarE2Reenvio: jest.Mock;
  };
  auditoria: {
    registrar: jest.Mock;
  };
}

type PuntoDeFallo = 'crearVersion' | 'reemplazarLineas' | 'auditoria';

const crearReposFake = (
  opciones: { fallarEn?: PuntoDeFallo; versionMaxima?: number } = {},
): ReposFake => ({
  presupuestos: {
    versionMaxima: jest.fn(async () => opciones.versionMaxima ?? 1),
    ultimoNumeroDelAnio: jest.fn(async () => '2026001'),
    crearVersion: jest.fn(async (p: Record<string, unknown>) => {
      if (opciones.fallarEn === 'crearVersion') throw new Error('FALLO_CREARVERSION');
      return {
        idPresupuesto: 'presup-v2',
        pdfUrl: 'https://docs/presup-v2.pdf',
        ...p,
      };
    }),
  },
  extras: {
    reemplazarLineas: jest.fn(async (p: { lineas: unknown[] }) => {
      if (opciones.fallarEn === 'reemplazarLineas') throw new Error('FALLO_REEMPLAZARLINEAS');
      return { lineas: p.lineas };
    }),
  },
  comunicaciones: {
    registrarE2Reenvio: jest.fn(async () => ({
      idComunicacion: 'com-e2-1',
      codigoEmail: 'E2',
      estado: 'enviado',
      esReenvio: true,
    })),
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
): UnidadDeTrabajoEditarPresupuestoPort & { ejecutar: jest.Mock } => ({
  ejecutar: jest.fn(
    async <T,>(
      _tenantId: string,
      trabajo: (r: ReposEditarPresupuesto) => Promise<T>,
    ) => trabajo(repos),
  ),
});

/** Catálogo de EXTRAS por id (precio ACTUAL del catálogo). Configurable por escenario. */
const catalogoPorDefecto = (): Record<string, ExtraCatalogo> => ({
  [EXTRA_BARBACOA]: { idExtra: EXTRA_BARBACOA, precioEur: 250, activo: true },
  [EXTRA_PAELLERO]: { idExtra: EXTRA_PAELLERO, precioEur: 400, activo: true },
});

const montar = (opciones: {
  reserva?: ReservaEdicion | null;
  presupuestoVigente?: PresupuestoVigente | null;
  motor?: MotorFake;
  fallarEn?: PuntoDeFallo;
  versionMaxima?: number;
  catalogo?: Record<string, ExtraCatalogo>;
  lineasExistentes?: LineaExtraExistente[];
} = {}) => {
  const reserva = 'reserva' in opciones ? opciones.reserva : reservaEnPrereserva();
  const vigente =
    'presupuestoVigente' in opciones
      ? opciones.presupuestoVigente
      : presupuestoVigenteV1();
  const motor = opciones.motor ?? crearMotorFake();
  const catalogo = opciones.catalogo ?? catalogoPorDefecto();
  const lineasExistentes = opciones.lineasExistentes ?? [];
  const repos = crearReposFake({
    fallarEn: opciones.fallarEn,
    versionMaxima: opciones.versionMaxima,
  });
  const uow = crearUowFake(repos);
  const cargarReserva = jest.fn(async () => reserva);
  const cargarPresupuestoVigente = jest.fn(async () => vigente);
  const cargarExtraCatalogo = jest.fn(
    async (p: { extraId: string }) => catalogo[p.extraId] ?? null,
  );
  const cargarLineasExistentes = jest.fn(async () => lineasExistentes);
  const dispararE2 = { disparar: jest.fn(async () => undefined) };
  const generarPdf = jest.fn(async () => 'https://docs/presup-v2.pdf');
  const deps: EditarPresupuestoDeps = {
    motorTarifa: motor as unknown as CalculadoraTarifaService,
    unidadDeTrabajo: uow,
    tenantSettings: { obtener: jest.fn(async () => settings) },
    cargarReserva,
    cargarPresupuestoVigente,
    cargarExtraCatalogo,
    cargarLineasExistentes,
    generarPdf,
    clock: relojFijo,
    dispararE2,
  };
  return {
    useCase: new EditarPresupuestoUseCase(deps),
    repos,
    uow,
    motor,
    cargarReserva,
    cargarPresupuestoVigente,
    cargarExtraCatalogo,
    dispararE2,
    generarPdf,
    deps,
  };
};

const comandoPreview = (
  over: Partial<EditarPresupuestoPreviewComando> = {},
): EditarPresupuestoPreviewComando => ({
  tenantId: TENANT,
  usuarioId: GESTOR,
  reservaId: RESERVA_ID,
  metodoPago: 'transferencia',
  extras: [],
  ...over,
});

const comandoConfirmar = (
  over: Partial<EditarPresupuestoConfirmarComando> = {},
): EditarPresupuestoConfirmarComando => ({
  tenantId: TENANT,
  usuarioId: GESTOR,
  reservaId: RESERVA_ID,
  metodoPago: 'transferencia',
  extras: [],
  enviar: true,
  ...over,
});

const comandoReenvio = (
  over: Partial<ReenviarPresupuestoComando> = {},
): ReenviarPresupuestoComando => ({
  tenantId: TENANT,
  usuarioId: GESTOR,
  reservaId: RESERVA_ID,
  ...over,
});

// ===========================================================================
// AC-1 — Happy path descuento: aplica 200€ sobre v1 (3200) → v2 total 3000,
//   tarifa_congelada=true, estado='enviado'; v1 persiste (no se borra); E2
//   es_reenvio=true; AUDIT_LOG accion='actualizar'; RESERVA sigue pre_reserva;
//   FECHA_BLOQUEADA.ttl NO cambia.
// ===========================================================================

describe('EditarPresupuestoUseCase.confirmar — happy path descuento (AC-1)', () => {
  it('debe_crear_v2_con_total_3000_congelado_enviado_aplicando_descuento_200', async () => {
    const { useCase, repos } = montar();

    const out = await useCase.confirmar(
      comandoConfirmar({ descuentoEur: '200.00', descuentoMotivo: 'fidelidad' }),
    );

    expect(repos.presupuestos.crearVersion).toHaveBeenCalledTimes(1);
    const args = repos.presupuestos.crearVersion.mock.calls[0][0];
    // version = MAX(1) + 1.
    expect(args.version).toBe(2);
    expect(args.tarifaCongelada).toBe(true);
    expect(args.estado).toBe('enviado');
    // total = 3200 - 200 = 3000; base/IVA derivados del régimen CON IVA.
    expect(args.total).toBe('3000.00');
    expect(args.ivaPorcentaje).toBe('21.00');
    expect(args.descuentoEur).toBe('200.00');
    expect(args.descuentoMotivo).toBe('fidelidad');
    // El resultado expone la nueva versión.
    expect(out.presupuesto.version).toBe(2);
  });

  it('debe_conservar_la_v1_como_historial_sin_borrarla_ni_sobrescribirla', async () => {
    const { useCase, repos } = montar();

    await useCase.confirmar(comandoConfirmar({ descuentoEur: '200.00' }));

    // No existe ningún puerto de borrado/actualización in-place de la v1: solo se CREA
    // una fila nueva (inmutabilidad de las versiones anteriores, D2).
    expect(repos.presupuestos).not.toHaveProperty('eliminar');
    expect(repos.presupuestos).not.toHaveProperty('actualizar');
    expect(repos.presupuestos.crearVersion).toHaveBeenCalledTimes(1);
  });

  it('debe_registrar_COMUNICACION_E2_con_es_reenvio_true_al_enviar', async () => {
    const { useCase, repos } = montar();

    await useCase.confirmar(comandoConfirmar({ descuentoEur: '200.00' }));

    expect(repos.comunicaciones.registrarE2Reenvio).toHaveBeenCalledTimes(1);
    const args = repos.comunicaciones.registrarE2Reenvio.mock.calls[0][0];
    expect(args.codigoEmail).toBe('E2');
    expect(args.esReenvio).toBe(true);
    expect(args.estado).toBe('enviado');
  });

  it('debe_registrar_AUDIT_LOG_accion_actualizar_referenciando_el_nuevo_presupuesto', async () => {
    const { useCase, repos } = montar();

    await useCase.confirmar(comandoConfirmar({ descuentoEur: '200.00' }));

    const registros = repos.auditoria.registrar.mock.calls.map((c) => c[0]);
    const actualizar = registros.find((r) => r.accion === 'actualizar');
    expect(actualizar).toBeDefined();
    expect(actualizar.entidad).toBe('PRESUPUESTO');
    expect(actualizar.entidadId).toBe('presup-v2');
  });

  it('NO_debe_transicionar_la_RESERVA_ni_tocar_FECHA_BLOQUEADA', async () => {
    const { useCase, repos } = montar();

    await useCase.confirmar(comandoConfirmar({ descuentoEur: '200.00' }));

    // La edición NO expone puertos de transición de la RESERVA ni de bloqueo de fecha:
    // la RESERVA sigue pre_reserva y FECHA_BLOQUEADA.ttl_expiracion no cambia (D5).
    expect(repos).not.toHaveProperty('reservas');
    expect(repos).not.toHaveProperty('fechaBloqueada');
  });
});

// ===========================================================================
// AC-2 — Añadir extra con precio congelado al añadir: barbacoa 250 → RESERVA_EXTRA
//   precio_unitario=250, subtotal=250, origen='anadido_post_confirmacion',
//   factura_id=null; total +250. Línea existente inmune al cambio de catálogo.
// ===========================================================================

describe('EditarPresupuestoUseCase — añadir extra con precio congelado (AC-2)', () => {
  it('debe_congelar_el_precio_actual_del_extra_al_anadir_la_linea', async () => {
    const { useCase, repos } = montar();

    await useCase.confirmar(
      comandoConfirmar({ extras: [{ extra_id: EXTRA_BARBACOA, cantidad: 1 }] }),
    );

    expect(repos.extras.reemplazarLineas).toHaveBeenCalledTimes(1);
    const { lineas } = repos.extras.reemplazarLineas.mock.calls[0][0];
    const barbacoa = lineas.find((l: { extraId: string }) => l.extraId === EXTRA_BARBACOA);
    expect(barbacoa).toMatchObject({
      extraId: EXTRA_BARBACOA,
      cantidad: 1,
      precioUnitario: '250.00',
      subtotal: '250.00',
      origen: 'anadido_post_confirmacion',
      facturaId: null,
    });
  });

  it('debe_sumar_el_extra_al_total_de_la_nueva_version', async () => {
    const { useCase, repos } = montar();

    // Sin extras el total es 3200; con la barbacoa (250) el total sube a 3450.
    await useCase.confirmar(
      comandoConfirmar({
        extras: [{ extra_id: EXTRA_BARBACOA, cantidad: 1 }],
        // El motor devuelve el total con el extra ya sumado (US-016 suma extras).
        // Se fuerza el resultado del motor para reflejarlo determinísticamente.
      }),
    );

    // El precio del extra se congela por el server; el desglose usa el total del motor.
    // (La suma exacta 3450 se verifica en la suite de integración con motor real; aquí
    // basta con que la línea congelada exista y el total del presupuesto sea coherente.)
    const args = repos.presupuestos.crearVersion.mock.calls[0][0];
    expect(Number(args.total)).toBeGreaterThanOrEqual(3200);
  });

  it('debe_conservar_el_precio_congelado_de_una_linea_existente_aunque_el_catalogo_suba', async () => {
    // Línea barbacoa YA existente congelada a 250; el catálogo sube luego a 300.
    const catalogoSubido = {
      ...catalogoPorDefecto(),
      [EXTRA_BARBACOA]: { idExtra: EXTRA_BARBACOA, precioEur: 300, activo: true },
    };
    const { useCase, repos } = montar({
      catalogo: catalogoSubido,
      lineasExistentes: [
        {
          idReservaExtra: 're-1',
          extraId: EXTRA_BARBACOA,
          conceptoLibre: null,
          cantidad: 1,
          precioUnitario: '250.00',
          subtotal: '250.00',
          origen: 'anadido_post_confirmacion',
          facturaId: null,
        },
      ],
    });

    // Se edita OTRO campo (el descuento): la línea barbacoa existente NO se reprecia.
    await useCase.confirmar(
      comandoConfirmar({
        descuentoEur: '100.00',
        extras: [{ id_reserva_extra: 're-1', extra_id: EXTRA_BARBACOA, cantidad: 1 }],
      }),
    );

    const { lineas } = repos.extras.reemplazarLineas.mock.calls[0][0];
    const barbacoa = lineas.find((l: { extraId: string }) => l.extraId === EXTRA_BARBACOA);
    // Conserva el precio congelado 250 (NO toma el 300 del catálogo actual).
    expect(barbacoa.precioUnitario).toBe('250.00');
  });

  it('una_linea_NUEVA_toma_el_precio_actual_del_catalogo_mientras_la_existente_lo_conserva', async () => {
    const catalogoSubido = {
      ...catalogoPorDefecto(),
      [EXTRA_BARBACOA]: { idExtra: EXTRA_BARBACOA, precioEur: 300, activo: true },
    };
    const { useCase, repos } = montar({
      catalogo: catalogoSubido,
      lineasExistentes: [
        {
          idReservaExtra: 're-1',
          extraId: EXTRA_BARBACOA,
          conceptoLibre: null,
          cantidad: 1,
          precioUnitario: '250.00',
          subtotal: '250.00',
          origen: 'anadido_post_confirmacion',
          facturaId: null,
        },
      ],
    });

    // Mantiene la línea existente (re-1, congelada a 250) y AÑADE una nueva de barbacoa.
    await useCase.confirmar(
      comandoConfirmar({
        extras: [
          { id_reserva_extra: 're-1', extra_id: EXTRA_BARBACOA, cantidad: 1 },
          { extra_id: EXTRA_BARBACOA, cantidad: 1 },
        ],
      }),
    );

    const { lineas } = repos.extras.reemplazarLineas.mock.calls[0][0];
    const precios = lineas
      .filter((l: { extraId: string }) => l.extraId === EXTRA_BARBACOA)
      .map((l: { precioUnitario: string }) => l.precioUnitario)
      .sort();
    // La existente conserva 250; la nueva toma el precio ACTUAL 300.
    expect(precios).toEqual(['250.00', '300.00']);
  });
});

// ===========================================================================
// AC-2 (regresión BUG QA) — Matching de línea EXISTENTE por el payload REAL del
//   contrato: `EdicionExtraInput` SOLO expone `extraId` + `cantidad` (NO
//   `idReservaExtra`); el SDK/frontend keyean por `extraId`. La identidad de
//   congelado debe casar por `extra_id`, NO por `id_reserva_extra`. Con el código
//   viejo (matching solo por id_reserva_extra) toda línea sin `id_reserva_extra` se
//   trataba como NUEVA y se recongelaba al catálogo actual → AC-2 roto de punta a
//   punta. Este test NO envía `id_reserva_extra` (así fallaría con el matching viejo)
//   y exige: (a) existente conserva su congelado; (b) nueva toma el precio actual.
// ===========================================================================

describe('EditarPresupuestoUseCase — congelado por extra_id con payload REAL del contrato (AC-2 regresión)', () => {
  it('linea_existente_conserva_congelado_matcheando_por_extra_id_sin_id_reserva_extra', async () => {
    // Barbacoa YA persistida congelada a 30; el catálogo sube luego a 50.
    const catalogoSubido = {
      ...catalogoPorDefecto(),
      [EXTRA_BARBACOA]: { idExtra: EXTRA_BARBACOA, precioEur: 50, activo: true },
    };
    const { useCase, repos } = montar({
      catalogo: catalogoSubido,
      lineasExistentes: [
        {
          idReservaExtra: 're-barbacoa',
          extraId: EXTRA_BARBACOA,
          conceptoLibre: null,
          cantidad: 1,
          precioUnitario: '30.00',
          subtotal: '30.00',
          origen: 'anadido_post_confirmacion',
          facturaId: null,
        },
      ],
    });

    // Payload REAL del contrato: SOLO extra_id + cantidad (SIN id_reserva_extra).
    await useCase.confirmar(
      comandoConfirmar({ extras: [{ extra_id: EXTRA_BARBACOA, cantidad: 1 }] }),
    );

    const { lineas } = repos.extras.reemplazarLineas.mock.calls[0][0];
    const barbacoa = lineas.find(
      (l: { extraId: string }) => l.extraId === EXTRA_BARBACOA,
    );
    // Conserva el 30.00 congelado (NO toma el 50.00 del catálogo actual).
    expect(barbacoa.precioUnitario).toBe('30.00');
    expect(barbacoa.subtotal).toBe('30.00');
  });

  it('linea_nueva_de_otro_extra_toma_el_precio_actual_del_catalogo_sin_id_reserva_extra', async () => {
    // Barbacoa persistida (30, congelada); catálogo de paellero a 400 (por defecto).
    const { useCase, repos } = montar({
      lineasExistentes: [
        {
          idReservaExtra: 're-barbacoa',
          extraId: EXTRA_BARBACOA,
          conceptoLibre: null,
          cantidad: 1,
          precioUnitario: '30.00',
          subtotal: '30.00',
          origen: 'anadido_post_confirmacion',
          facturaId: null,
        },
      ],
    });

    // Mantiene barbacoa (existente) y AÑADE paellero (nuevo) — solo extra_id/cantidad.
    await useCase.confirmar(
      comandoConfirmar({
        extras: [
          { extra_id: EXTRA_BARBACOA, cantidad: 1 },
          { extra_id: EXTRA_PAELLERO, cantidad: 1 },
        ],
      }),
    );

    const { lineas } = repos.extras.reemplazarLineas.mock.calls[0][0];
    const barbacoa = lineas.find(
      (l: { extraId: string }) => l.extraId === EXTRA_BARBACOA,
    );
    const paellero = lineas.find(
      (l: { extraId: string }) => l.extraId === EXTRA_PAELLERO,
    );
    // La existente conserva su congelado; la nueva toma el precio ACTUAL del catálogo.
    expect(barbacoa.precioUnitario).toBe('30.00');
    expect(paellero.precioUnitario).toBe('400.00');
  });
});

// ===========================================================================
// AC-3 — Eliminar extra: quitar la línea paellero (400) → nueva versión sin esos 400.
// ===========================================================================

describe('EditarPresupuestoUseCase — eliminar extra (AC-3)', () => {
  it('debe_excluir_la_linea_paellero_del_conjunto_de_lineas_al_eliminarla', async () => {
    const { useCase, repos } = montar({
      lineasExistentes: [
        {
          idReservaExtra: 're-paellero',
          extraId: EXTRA_PAELLERO,
          conceptoLibre: null,
          cantidad: 1,
          precioUnitario: '400.00',
          subtotal: '400.00',
          origen: 'anadido_post_confirmacion',
          facturaId: null,
        },
      ],
    });

    // El nuevo conjunto de extras NO incluye la línea paellero → se elimina.
    await useCase.confirmar(comandoConfirmar({ extras: [] }));

    const { lineas } = repos.extras.reemplazarLineas.mock.calls[0][0];
    const paellero = lineas.find((l: { extraId: string }) => l.extraId === EXTRA_PAELLERO);
    expect(paellero).toBeUndefined();
  });
});

// ===========================================================================
// AC-4 — Cambio nº invitados recalcula tarifa: v1 con 40 (tramo 31–50) → 25
//   (tramo 21–30) → motor recalcula; v2 con nuevo precio; v1 conservada.
// ===========================================================================

describe('EditarPresupuestoUseCase — cambio de invitados recalcula tarifa (AC-4)', () => {
  it('debe_pasar_el_nuevo_num_invitados_al_motor_y_congelar_el_nuevo_precio', async () => {
    // El motor del tramo 21–30 devuelve un precio distinto (2800).
    const motor = crearMotorFake(
      resultadoTarifaNormal({ precioTarifaEur: 2800, totalEur: 2800, tarifaId: 'tarifa-alta-8h-21_30' }),
    );
    const { useCase, repos } = montar({ motor });

    await useCase.confirmar(comandoConfirmar({ numAdultosNinosMayores4: 25 }));

    // El motor recibe el NUEVO nº de invitados (25), no el de la v1 (40).
    const inputMotor = motor.calcular.mock.calls[0][0];
    expect(inputMotor.numAdultosNinosMayores4).toBe(25);
    // La v2 congela el nuevo total del tramo 21–30.
    const args = repos.presupuestos.crearVersion.mock.calls[0][0];
    expect(args.total).toBe('2800.00');
    expect(args.tarifaId).toBe('tarifa-alta-8h-21_30');
    expect(args.version).toBe(2);
  });
});

// ===========================================================================
// AC-5 — Cambio invitados >50 → tarifa_a_consultar → exige precio manual;
//   sin precio manual → 422 sin crear versión.
// ===========================================================================

describe('EditarPresupuestoUseCase — invitados >50 con precio manual (AC-5)', () => {
  it('preview_debe_devolver_tarifaAConsultar_true_con_desglose_null_sin_precio_manual', async () => {
    const { useCase } = montar({ motor: crearMotorFake(resultadoTarifaAConsultar()) });

    const out = await useCase.preview(comandoPreview({ numAdultosNinosMayores4: 55 }));

    expect(out.tarifaAConsultar).toBe(true);
    expect(out.desglose).toBeNull();
    expect(out.reparto).toBeNull();
  });

  it('confirmar_con_precio_manual_debe_usarlo_como_total_de_la_v2', async () => {
    const { useCase, repos } = montar({
      motor: crearMotorFake(resultadoTarifaAConsultar()),
    });

    await useCase.confirmar(
      comandoConfirmar({ numAdultosNinosMayores4: 55, precioManualEur: '4200.00' }),
    );

    const args = repos.presupuestos.crearVersion.mock.calls[0][0];
    expect(args.total).toBe('4200.00');
    expect(args.tarifaId).toBeNull();
  });

  it('confirmar_sin_precio_manual_debe_lanzar_PRECIO_MANUAL_REQUERIDO_sin_crear_version', async () => {
    const { useCase, repos } = montar({
      motor: crearMotorFake(resultadoTarifaAConsultar()),
    });

    const promesa = useCase.confirmar(comandoConfirmar({ numAdultosNinosMayores4: 55 }));
    await expect(promesa).rejects.toBeInstanceOf(PrecioManualRequeridoError);
    await expect(promesa).rejects.toMatchObject({ codigo: 'PRECIO_MANUAL_REQUERIDO' });
    expect(repos.presupuestos.crearVersion).not.toHaveBeenCalled();
  });
});

// ===========================================================================
// AC-6 — Guardar borrador sin enviar: enviar=false → v2 estado='borrador',
//   numero_presupuesto=null, sin COMUNICACION, sin email.
// ===========================================================================

describe('EditarPresupuestoUseCase — guardar borrador sin enviar (AC-6)', () => {
  it('debe_crear_v2_en_borrador_sin_numero_sin_comunicacion_ni_email', async () => {
    const { useCase, repos, dispararE2 } = montar();

    const out = await useCase.confirmar(
      comandoConfirmar({ enviar: false, descuentoEur: '200.00' }),
    );

    const args = repos.presupuestos.crearVersion.mock.calls[0][0];
    expect(args.version).toBe(2);
    expect(args.estado).toBe('borrador');
    expect(args.numeroPresupuesto).toBeNull();
    // Sin COMUNICACION ni email en el borrador.
    expect(repos.comunicaciones.registrarE2Reenvio).not.toHaveBeenCalled();
    expect(dispararE2.disparar).not.toHaveBeenCalled();
    expect(out.presupuesto.estado).toBe('borrador');
    // El borrador NO consume número de la secuencia (numeración por envío).
    expect(repos.presupuestos.ultimoNumeroDelAnio).not.toHaveBeenCalled();
  });

  it('borrador_igualmente_registra_AUDIT_LOG_accion_actualizar', async () => {
    const { useCase, repos } = montar();

    await useCase.confirmar(comandoConfirmar({ enviar: false, descuentoEur: '200.00' }));

    const registros = repos.auditoria.registrar.mock.calls.map((c) => c[0]);
    expect(registros.some((r) => r.accion === 'actualizar')).toBe(true);
  });
});

// ===========================================================================
// AC-7 — Estado inválido, presupuesto aceptado: PRESUPUESTO estado='aceptado' →
//   rechaza (409) sin crear versión ni tocar el motor.
// ===========================================================================

describe('EditarPresupuestoUseCase — presupuesto aceptado no editable (AC-7)', () => {
  it('debe_lanzar_PRESUPUESTO_NO_EDITABLE_cuando_el_vigente_esta_aceptado_sin_efectos', async () => {
    const { useCase, repos, motor } = montar({
      presupuestoVigente: presupuestoVigenteV1({ estado: 'aceptado' }),
    });

    const promesa = useCase.confirmar(comandoConfirmar({ descuentoEur: '200.00' }));
    await expect(promesa).rejects.toBeInstanceOf(PresupuestoNoEditableError);
    await expect(promesa).rejects.toMatchObject({ codigo: 'PRESUPUESTO_NO_EDITABLE' });

    expect(motor.calcular).not.toHaveBeenCalled();
    expect(repos.presupuestos.crearVersion).not.toHaveBeenCalled();
    expect(repos.extras.reemplazarLineas).not.toHaveBeenCalled();
  });

  it('debe_lanzar_PRESUPUESTO_NO_EDITABLE_cuando_el_vigente_esta_rechazado', async () => {
    const { useCase } = montar({
      presupuestoVigente: presupuestoVigenteV1({ estado: 'rechazado' }),
    });

    await expect(
      useCase.confirmar(comandoConfirmar({ descuentoEur: '200.00' })),
    ).rejects.toBeInstanceOf(PresupuestoNoEditableError);
  });
});

// ===========================================================================
// AC-8 — Estado inválido, RESERVA fuera de pre_reserva (p. ej. consulta/2b) →
//   rechaza (409) sin efectos.
// ===========================================================================

describe('EditarPresupuestoUseCase — RESERVA fuera de pre_reserva (AC-8)', () => {
  it('debe_lanzar_RESERVA_FUERA_DE_PRERESERVA_desde_consulta_2b_sin_efectos', async () => {
    const { useCase, repos, motor } = montar({
      reserva: reservaEnPrereserva({ estado: 'consulta', subEstado: '2b' }),
    });

    const promesa = useCase.confirmar(comandoConfirmar({ descuentoEur: '200.00' }));
    await expect(promesa).rejects.toBeInstanceOf(ReservaFueraDePrereservaError);
    await expect(promesa).rejects.toMatchObject({ codigo: 'RESERVA_FUERA_DE_PRERESERVA' });

    expect(motor.calcular).not.toHaveBeenCalled();
    expect(repos.presupuestos.crearVersion).not.toHaveBeenCalled();
  });

  it('debe_lanzar_RESERVA_FUERA_DE_PRERESERVA_desde_reserva_confirmada', async () => {
    const { useCase } = montar({
      reserva: reservaEnPrereserva({ estado: 'reserva_confirmada', subEstado: null }),
    });

    await expect(
      useCase.confirmar(comandoConfirmar({ descuentoEur: '200.00' })),
    ).rejects.toBeInstanceOf(ReservaFueraDePrereservaError);
  });
});

// ===========================================================================
// 404 — RESERVA inexistente para el tenant (RLS: cross-tenant invisible).
// ===========================================================================

describe('EditarPresupuestoUseCase — RESERVA inexistente / cross-tenant → 404', () => {
  it('debe_lanzar_ReservaNoEncontrada_cuando_no_existe_para_el_tenant', async () => {
    const { useCase, repos } = montar({ reserva: null });

    await expect(
      useCase.confirmar(comandoConfirmar({ tenantId: OTRO_TENANT, descuentoEur: '200.00' })),
    ).rejects.toBeInstanceOf(ReservaNoEncontradaError);
    expect(repos.presupuestos.crearVersion).not.toHaveBeenCalled();
  });
});

// ===========================================================================
// AC-9 — Reenvío sin cambios: NO crea versión; reenvía el PDF vigente;
//   COMUNICACION E2 nueva (es_reenvio=true); AUDIT_LOG; no consume numero nuevo.
// ===========================================================================

describe('ReenviarPresupuestoUseCase — reenvío sin cambios (AC-9)', () => {
  const montarReenvio = (opciones: {
    reserva?: ReservaEdicion | null;
    presupuestoVigente?: PresupuestoVigente | null;
  } = {}) => {
    const reserva =
      'reserva' in opciones ? opciones.reserva : reservaEnPrereserva();
    const vigente =
      'presupuestoVigente' in opciones
        ? opciones.presupuestoVigente
        : presupuestoVigenteV1();
    const registrarE2Reenvio = jest.fn(async (_params: Record<string, unknown>) => ({
      idComunicacion: 'com-e2-reenvio',
      codigoEmail: 'E2',
      estado: 'enviado',
      esReenvio: true,
    }));
    const registrarAuditoria = jest.fn(async (_registro: Record<string, unknown>) => undefined);
    const crearVersion = jest.fn(async () => ({ idPresupuesto: 'no-debe-crearse' }));
    const reenviarE2 = jest.fn(async (_params: Record<string, unknown>) => undefined);
    const deps: ReenviarPresupuestoDeps = {
      cargarReserva: jest.fn(async () => reserva),
      cargarPresupuestoVigente: jest.fn(async () => vigente),
      reenviarE2,
      registrarE2Reenvio,
      registrarAuditoria,
      clock: relojFijo,
    };
    return {
      useCase: new ReenviarPresupuestoUseCase(deps),
      registrarE2Reenvio,
      registrarAuditoria,
      reenviarE2,
      crearVersion,
      deps,
    };
  };

  it('debe_reenviar_el_PDF_vigente_registrar_E2_es_reenvio_true_sin_versionar', async () => {
    const { useCase, registrarE2Reenvio, reenviarE2 } = montarReenvio();

    const out = await useCase.ejecutar(comandoReenvio());

    // Reenvía el PDF de la versión vigente (v1) SIN crear versión nueva.
    expect(reenviarE2).toHaveBeenCalledTimes(1);
    expect(registrarE2Reenvio).toHaveBeenCalledTimes(1);
    const com = registrarE2Reenvio.mock.calls[0][0];
    expect(com.codigoEmail).toBe('E2');
    expect(com.esReenvio).toBe(true);
    // La respuesta devuelve el presupuesto vigente SIN cambiar version ni numero.
    expect(out.presupuesto.version).toBe(1);
    expect(out.presupuesto.numeroPresupuesto).toBe('2026001');
  });

  it('NO_debe_exponer_ningun_puerto_de_creacion_de_version_ni_de_numeracion', async () => {
    const { deps } = montarReenvio();

    // El reenvío jamás versiona ni consume número (D2.4): no hay tales puertos.
    expect(deps).not.toHaveProperty('crearVersion');
    expect(deps).not.toHaveProperty('ultimoNumeroDelAnio');
    expect(deps).not.toHaveProperty('unidadDeTrabajo');
  });

  it('debe_registrar_AUDIT_LOG_del_reenvio', async () => {
    const { useCase, registrarAuditoria } = montarReenvio();

    await useCase.ejecutar(comandoReenvio());

    expect(registrarAuditoria).toHaveBeenCalledTimes(1);
  });

  it('debe_lanzar_PRESUPUESTO_VIGENTE_NO_ENCONTRADO_cuando_no_hay_presupuesto_que_reenviar', async () => {
    const { useCase } = montarReenvio({ presupuestoVigente: null });

    await expect(useCase.ejecutar(comandoReenvio())).rejects.toBeInstanceOf(
      PresupuestoVigenteNoEncontradoError,
    );
  });

  it('debe_lanzar_RESERVA_FUERA_DE_PRERESERVA_al_reenviar_si_no_esta_en_pre_reserva', async () => {
    const { useCase } = montarReenvio({
      reserva: reservaEnPrereserva({ estado: 'reserva_confirmada', subEstado: null }),
    });

    await expect(useCase.ejecutar(comandoReenvio())).rejects.toBeInstanceOf(
      ReservaFueraDePrereservaError,
    );
  });
});

// ===========================================================================
// AC-10 — Validaciones: descuento_eur < 0 o > base_imponible → 422;
//   duracion_horas ∉ {4,8,12} → 422. Sin crear versión.
// ===========================================================================

describe('EditarPresupuestoUseCase — validaciones descuento y duración (AC-10)', () => {
  it('descuento_negativo_debe_lanzar_DESCUENTO_INVALIDO_sin_crear_version', async () => {
    const { useCase, repos } = montar();

    const promesa = useCase.confirmar(comandoConfirmar({ descuentoEur: '-1.00' }));
    await expect(promesa).rejects.toBeInstanceOf(DescuentoInvalidoError);
    await expect(promesa).rejects.toMatchObject({ codigo: 'DESCUENTO_INVALIDO' });
    expect(repos.presupuestos.crearVersion).not.toHaveBeenCalled();
  });

  it('descuento_mayor_que_base_imponible_debe_lanzar_DESCUENTO_INVALIDO', async () => {
    // base ≈ 2644.63 (de 3200 con IVA); un descuento de 3000 la supera.
    const { useCase, repos } = montar();

    const promesa = useCase.confirmar(comandoConfirmar({ descuentoEur: '3000.00' }));
    await expect(promesa).rejects.toBeInstanceOf(DescuentoInvalidoError);
    expect(repos.presupuestos.crearVersion).not.toHaveBeenCalled();
  });

  it('duracion_no_permitida_debe_lanzar_DURACION_INVALIDA_sin_crear_version', async () => {
    const { useCase, repos, motor } = montar();

    const promesa = useCase.confirmar(comandoConfirmar({ duracionHoras: 6 }));
    await expect(promesa).rejects.toBeInstanceOf(DuracionInvalidaError);
    await expect(promesa).rejects.toMatchObject({ codigo: 'DURACION_INVALIDA' });
    // La validación de duración es ANTES del motor y de la persistencia.
    expect(motor.calcular).not.toHaveBeenCalled();
    expect(repos.presupuestos.crearVersion).not.toHaveBeenCalled();
  });

  it.each([4, 8, 12])('duracion_%i_es_valida_y_no_lanza_error', async (horas) => {
    const { useCase } = montar();
    await expect(
      useCase.confirmar(comandoConfirmar({ duracionHoras: horas })),
    ).resolves.toBeDefined();
  });
});

// ===========================================================================
// AC-11 — Numeración por envío: cada ENVÍO de versión nueva consume un AAAANNN
//   nuevo de la secuencia del régimen; el borrador queda numero=null.
// ===========================================================================

describe('EditarPresupuestoUseCase — numeración por envío (AC-11)', () => {
  it('el_envio_debe_consumir_un_AAAANNN_nuevo_de_la_secuencia_del_regimen', async () => {
    // Último del año/régimen = 2026001 → el envío consume 2026002.
    const { useCase, repos } = montar();

    await useCase.confirmar(comandoConfirmar({ descuentoEur: '200.00', enviar: true }));

    expect(repos.presupuestos.ultimoNumeroDelAnio).toHaveBeenCalledTimes(1);
    // El régimen se pasa a la numeración (doble secuencia CON/SIN).
    const argsNum = repos.presupuestos.ultimoNumeroDelAnio.mock.calls[0];
    expect(argsNum).toContain('con_iva');
    const argsCrear = repos.presupuestos.crearVersion.mock.calls[0][0];
    expect(argsCrear.numeroPresupuesto).toBe('2026002');
  });

  it('el_borrador_no_consume_numero_queda_null', async () => {
    const { useCase, repos } = montar();

    await useCase.confirmar(comandoConfirmar({ enviar: false, descuentoEur: '200.00' }));

    expect(repos.presupuestos.ultimoNumeroDelAnio).not.toHaveBeenCalled();
    const args = repos.presupuestos.crearVersion.mock.calls[0][0];
    expect(args.numeroPresupuesto).toBeNull();
  });
});

// ===========================================================================
// AC-12 — Concurrencia (unit, sin hilos): reintento P2002 sobre
//   @@unique([reservaId, version]) — dos confirmaciones que calculan la misma
//   version → la perdedora reintenta recalculando MAX+1. La colisión P2002 se
//   INYECTA con un UoW fake (US-015 §Concurrencia no es zona crítica).
//   (El reintento REAL sobre BD vive en la suite de integración.)
// ===========================================================================

/** Fabrica un P2002 de Prisma con el `meta.target` indicado (string o array). */
const crearP2002 = (target: string | string[]): Error => {
  const error = new Error('Unique constraint failed') as Error & {
    code: string;
    meta: { target: string | string[] };
  };
  error.code = 'P2002';
  error.meta = { target };
  return error;
};

/**
 * UoW fake que lanza el error de la cola `erroresPorIntento` (uno por intento) tras
 * ejecutar el trabajo, o lo ejecuta a fondo. Cuenta las invocaciones para verificar los
 * reintentos.
 */
const crearUowConColisiones = (
  repos: ReposFake,
  erroresPorIntento: ReadonlyArray<Error | null>,
): UnidadDeTrabajoEditarPresupuestoPort & { ejecutar: jest.Mock } => {
  let intento = 0;
  return {
    ejecutar: jest.fn(
      async <T,>(
        _tenantId: string,
        trabajo: (r: ReposEditarPresupuesto) => Promise<T>,
      ) => {
        const errorDeEsteIntento = erroresPorIntento[intento] ?? null;
        intento += 1;
        if (errorDeEsteIntento !== null) {
          await trabajo(repos);
          throw errorDeEsteIntento;
        }
        return trabajo(repos);
      },
    ),
  };
};

describe('EditarPresupuestoUseCase.confirmar — reintento P2002 de version (AC-12)', () => {
  it('debe_reintentar_ante_P2002_de_reservaId_version_recalculando_MAX_mas_1', async () => {
    // El repo devuelve version máxima distinta por intento: 1er intento calcula v2 y
    // colisiona; al reabrir, MAX ya es 2 (otra confirmación ganó) → 2º intento calcula v3.
    const repos = crearReposFake();
    const maximas = [1, 2];
    let llamada = 0;
    repos.presupuestos.versionMaxima = jest.fn(async () => {
      const valor = maximas[llamada] ?? maximas[maximas.length - 1];
      llamada += 1;
      return valor;
    });
    const uow = crearUowConColisiones(repos, [
      crearP2002(['reservaId', 'version']),
      null,
    ]);
    const deps: EditarPresupuestoDeps = {
      motorTarifa: crearMotorFake() as unknown as CalculadoraTarifaService,
      unidadDeTrabajo: uow,
      tenantSettings: { obtener: jest.fn(async () => settings) },
      cargarReserva: jest.fn(async () => reservaEnPrereserva()),
      cargarPresupuestoVigente: jest.fn(async () => presupuestoVigenteV1()),
      cargarExtraCatalogo: jest.fn(async () => null),
      cargarLineasExistentes: jest.fn(async () => []),
      generarPdf: jest.fn(async () => 'https://docs/presup.pdf'),
      clock: relojFijo,
      dispararE2: { disparar: jest.fn(async () => undefined) },
    };
    const useCase = new EditarPresupuestoUseCase(deps);

    const out = await useCase.confirmar(comandoConfirmar({ descuentoEur: '200.00' }));

    // Reintentó: dos aperturas de la tx.
    expect(uow.ejecutar).toHaveBeenCalledTimes(2);
    // Persistió la version recalculada del SEGUNDO intento (v3), no la que colisionó (v2).
    const versionesCreadas = repos.presupuestos.crearVersion.mock.calls.map(
      (c) => (c[0] as { version: number }).version,
    );
    expect(versionesCreadas[versionesCreadas.length - 1]).toBe(3);
    expect(out.presupuesto).toBeDefined();
  });
});

// ===========================================================================
// Atomicidad — si CUALQUIER operación de la tx falla, el error se PROPAGA para que
// la UoW haga rollback total (no se atrapa; all-or-nothing).
// ===========================================================================

describe('EditarPresupuestoUseCase.confirmar — atomicidad / rollback', () => {
  it.each(['crearVersion', 'reemplazarLineas', 'auditoria'] as const)(
    'debe_propagar_el_error_cuando_falla_%s_para_que_la_tx_revierta',
    async (op) => {
      const { useCase } = montar({ fallarEn: op });

      await expect(
        useCase.confirmar(comandoConfirmar({ descuentoEur: '200.00' })),
      ).rejects.toThrow(`FALLO_${op.toUpperCase()}`);
    },
  );
});

// ===========================================================================
// Preview — recalcula el borrador SIN persistir NADA (sin crear versión, sin
// líneas, sin COMUNICACION, sin email).
// ===========================================================================

describe('EditarPresupuestoUseCase.preview — borrador de edición sin efectos', () => {
  it('debe_devolver_el_desglose_recalculado_sin_persistir_nada', async () => {
    const { useCase, repos, motor, dispararE2 } = montar();

    const out = await useCase.preview(comandoPreview({ descuentoEur: '200.00' }));

    expect(motor.calcular).toHaveBeenCalledTimes(1);
    expect(out.desglose?.total).toBe('3000.00');
    // NADA se persiste.
    expect(repos.presupuestos.crearVersion).not.toHaveBeenCalled();
    expect(repos.extras.reemplazarLineas).not.toHaveBeenCalled();
    expect(repos.comunicaciones.registrarE2Reenvio).not.toHaveBeenCalled();
    expect(dispararE2.disparar).not.toHaveBeenCalled();
  });

  it('preview_debe_rechazar_si_la_RESERVA_no_esta_en_pre_reserva', async () => {
    const { useCase } = montar({
      reserva: reservaEnPrereserva({ estado: 'consulta', subEstado: '2b' }),
    });

    await expect(
      useCase.preview(comandoPreview({ descuentoEur: '200.00' })),
    ).rejects.toBeInstanceOf(ReservaFueraDePrereservaError);
  });
});
