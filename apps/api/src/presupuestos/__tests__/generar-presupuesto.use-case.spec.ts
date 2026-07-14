/**
 * TESTS del caso de uso `GenerarPresupuestoUseCase` (UC-14 / US-014) — fase TDD RED.
 * tasks.md Fase 3: 3.3 (tarifa congelada), 3.4 (FA-01 datos fiscales), 3.5 (FA-02
 * precio manual >50), 3.6 (FA-03 cancelar/preview sin persistir), 3.7 (motor sin
 * tarifa), 3.10 (atomicidad/rollback), y las guardas de origen/precondición (3.2).
 *
 * Trazabilidad: US-014; spec-delta `presupuestos` (Requirements de precondición de
 * origen y presupuesto previo, validación fiscal síncrona, delegación al motor de
 * tarifa, borrador sin efectos, precio manual, congelado/desglose fiscal) y
 * spec-delta `consultas` (atomicidad all-or-nothing). Contrato congelado:
 *   - `POST /reservas/{id}/presupuesto/preview` (previewPresupuesto): calcula, NO persiste.
 *   - `POST /reservas/{id}/presupuesto` (confirmarPresupuesto): confirma en tx única.
 * Códigos de dominio: DATOS_FISCALES_INCOMPLETOS (+ camposFaltantes[]),
 *   PRECIO_MANUAL_REQUERIDO, ORIGEN_INVALIDO, PRESUPUESTO_YA_EXISTE,
 *   TARIFA_NO_CONFIGURADA/TEMPORADA_NO_CONFIGURADA (propagados del motor US-016).
 *
 * Ejercita la APLICACIÓN contra DOBLES DE LOS PUERTOS (in-memory), sin tocar Prisma
 * (hexagonal, hook `no-infra-in-domain`). La ATOMICIDAD, la concurrencia y el E2
 * post-commit REALES viven en `…-integracion.spec.ts` y `…-concurrencia.spec.ts`;
 * aquí se fija la ORQUESTACIÓN: guardas previas al cálculo, delegación al motor,
 * preview sin efectos, y que un fallo parcial en la tx se PROPAGA (rollback).
 *
 * RED: aún NO existe `presupuestos/application/generar-presupuesto.use-case.ts`. La
 * batería está en ROJO por AUSENCIA DE IMPLEMENTACIÓN. GREEN es de `backend-developer`.
 */
import {
  GenerarPresupuestoUseCase,
  DatosFiscalesIncompletosError,
  PrecioManualRequeridoError,
  OrigenInvalidoError,
  PresupuestoYaExisteError,
  ReservaNoEncontradaError,
  type GenerarPresupuestoDeps,
  type PreviewPresupuestoComando,
  type ConfirmarPresupuestoComando,
  type RepositoriosActivarPrereserva,
  type UnidadDeTrabajoActivarPrereservaPort,
  type ReservaPresupuesto,
  type ClientePresupuesto,
  type ClockPort,
  type TenantSettingsPresupuesto,
} from '../application/generar-presupuesto.use-case';
import {
  CalculadoraTarifaService,
  TarifaNoConfiguradaError,
  TemporadaNoConfiguradaError,
  type CalculoTarifaResultado,
} from '../../tarifas/domain/calculadora-tarifa.service';

const TENANT = '00000000-0000-0000-0000-000000000001';
const OTRO_TENANT = '00000000-0000-0000-0000-0000000000ff';
const GESTOR = '00000000-0000-0000-0000-000000000002';
const RESERVA_ID = 'res-2b';
const CLIENTE_ID = 'cli-1';
const DIA_MS = 24 * 60 * 60 * 1000;

const AHORA = new Date('2026-06-30T10:00:00.000Z');
const FECHA_EVENTO = new Date('2027-09-12T00:00:00.000Z');
const relojFijo: ClockPort = { ahora: () => AHORA };

// ---------------------------------------------------------------------------
// Dobles de datos: RESERVA con datos completos y CLIENTE con datos fiscales.
// ---------------------------------------------------------------------------

const clienteFiscalCompleto = (
  over: Partial<ClientePresupuesto> = {},
): ClientePresupuesto => ({
  idCliente: CLIENTE_ID,
  tenantId: TENANT,
  nombre: 'Marta',
  apellidos: 'Soler',
  email: 'marta@example.com',
  telefono: '600111222',
  dniNif: '12345678Z',
  direccion: 'C/ Mayor 1',
  codigoPostal: '08001',
  poblacion: 'Barcelona',
  provincia: 'Barcelona',
  ...over,
});

const reservaActiva = (over: Partial<ReservaPresupuesto> = {}): ReservaPresupuesto => ({
  idReserva: RESERVA_ID,
  tenantId: TENANT,
  clienteId: CLIENTE_ID,
  estado: 'consulta',
  subEstado: '2b',
  fechaEvento: FECHA_EVENTO,
  duracionHoras: 8,
  numAdultosNinosMayores4: 40,
  numNinosMenores4: 5,
  tipoEvento: 'boda',
  ttlExpiracion: new Date(AHORA.getTime() + 3 * DIA_MS),
  ...over,
});

const settings: TenantSettingsPresupuesto = {
  ttlPrereservaDias: 7,
  pctSenal: 40,
  fianzaDefaultEur: 500,
};

// ---------------------------------------------------------------------------
// Motor de tarifa: doble ligero con salida canónica configurable (o el motor
// REAL con puertos in-memory cuando queremos ejercitar TARIFA_NO_CONFIGURADA).
// ---------------------------------------------------------------------------

const resultadoTarifaNormal = (
  over: Partial<CalculoTarifaResultado> = {},
): CalculoTarifaResultado => ({
  temporada: 'alta',
  tarifaAConsultar: false,
  precioTarifaEur: 1076,
  extrasTotalEur: 0,
  totalEur: 1076,
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
// Repositorios + UoW fake. El use-case orquesta la tx única de confirmación.
// ---------------------------------------------------------------------------

interface ReposFake extends RepositoriosActivarPrereserva {
  presupuestos: {
    buscarEnviadoOAceptado: jest.Mock;
    ultimoNumeroDelAnio: jest.Mock;
    crear: jest.Mock;
  };
  reservas: {
    transicionarAPrereserva: jest.Mock;
  };
  fechaBloqueada: {
    bloquearInsertOUpdate: jest.Mock;
  };
  cola: {
    vaciar: jest.Mock;
  };
  auditoria: {
    registrar: jest.Mock;
  };
}

type PuntoDeFallo =
  | 'crearPresupuesto'
  | 'transicion'
  | 'bloqueo'
  | 'vaciarCola'
  | 'auditoria';

const crearReposFake = (opciones: {
  presupuestoPrevio?: boolean;
  fallarEn?: PuntoDeFallo;
} = {}): ReposFake => ({
  presupuestos: {
    buscarEnviadoOAceptado: jest.fn(async () =>
      opciones.presupuestoPrevio ? { idPresupuesto: 'p-prev', estado: 'enviado' } : null,
    ),
    ultimoNumeroDelAnio: jest.fn(async () => null),
    crear: jest.fn(async (p: Record<string, unknown>) => {
      if (opciones.fallarEn === 'crearPresupuesto') throw new Error('FALLO_CREARPRESUPUESTO');
      return { idPresupuesto: 'p-1', version: 1, estado: 'enviado', ...p };
    }),
  },
  reservas: {
    transicionarAPrereserva: jest.fn(async () => {
      if (opciones.fallarEn === 'transicion') throw new Error('FALLO_TRANSICION');
      return undefined;
    }),
  },
  fechaBloqueada: {
    bloquearInsertOUpdate: jest.fn(async () => {
      if (opciones.fallarEn === 'bloqueo') throw new Error('FALLO_BLOQUEO');
      return undefined;
    }),
  },
  cola: {
    vaciar: jest.fn(async () => {
      if (opciones.fallarEn === 'vaciarCola') throw new Error('FALLO_VACIARCOLA');
      return { descartadas: [] };
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
): UnidadDeTrabajoActivarPrereservaPort & { ejecutar: jest.Mock } => ({
  ejecutar: jest.fn(
    async <T,>(
      _tenantId: string,
      trabajo: (r: RepositoriosActivarPrereserva) => Promise<T>,
    ) => trabajo(repos),
  ),
});

const montar = (opciones: {
  reserva?: ReservaPresupuesto | null;
  cliente?: ClientePresupuesto;
  motor?: MotorFake;
  presupuestoPrevio?: boolean;
  fallarEn?: PuntoDeFallo;
} = {}) => {
  const reserva = 'reserva' in opciones ? opciones.reserva : reservaActiva();
  const cliente = opciones.cliente ?? clienteFiscalCompleto();
  const motor = opciones.motor ?? crearMotorFake();
  const repos = crearReposFake({
    presupuestoPrevio: opciones.presupuestoPrevio,
    fallarEn: opciones.fallarEn,
  });
  const uow = crearUowFake(repos);
  const cargarReserva = jest.fn(async () => reserva);
  const cargarCliente = jest.fn(async () => cliente);
  const deps: GenerarPresupuestoDeps = {
    motorTarifa: motor as unknown as CalculadoraTarifaService,
    unidadDeTrabajo: uow,
    tenantSettings: { obtener: jest.fn(async () => settings) },
    cargarReserva,
    cargarCliente,
    generarPdf: jest.fn(async () => 'https://docs/p-1.pdf'),
    clock: relojFijo,
  };
  return {
    useCase: new GenerarPresupuestoUseCase(deps),
    repos,
    uow,
    motor,
    cargarReserva,
    cargarCliente,
    deps,
  };
};

const comandoPreview = (
  over: Partial<PreviewPresupuestoComando> = {},
): PreviewPresupuestoComando => ({
  tenantId: TENANT,
  usuarioId: GESTOR,
  reservaId: RESERVA_ID,
  extras: [],
  ...over,
});

const comandoConfirmar = (
  over: Partial<ConfirmarPresupuestoComando> = {},
): ConfirmarPresupuestoComando => ({
  tenantId: TENANT,
  usuarioId: GESTOR,
  reservaId: RESERVA_ID,
  extras: [],
  ...over,
});

// ===========================================================================
// 3.6 — Preview: calcula el borrador delegando en el motor, NO persiste NADA
//        (sin PRESUPUESTO, sin transición, sin bloqueo, sin cola, sin email).
// ===========================================================================

describe('GenerarPresupuestoUseCase.preview — borrador sin efectos (3.6)', () => {
  it('debe_devolver_el_desglose_delegando_en_el_motor_sin_persistir_nada', async () => {
    const { useCase, repos, motor } = montar();

    const out = await useCase.preview(comandoPreview());

    // Delega el cálculo al motor de tarifa (no reimplementa el tarifario).
    expect(motor.calcular).toHaveBeenCalledTimes(1);
    // Desglose fiscal derivado del total (1076, IVA incluido) + reparto 40/60/fianza.
    expect(out.tarifaAConsultar).toBe(false);
    expect(out.desglose?.ivaPorcentaje).toBe('21.00');
    expect(out.desglose?.total).toBe('1076.00');
    // Reparto 40/60 del total 1076 (delegado a `calcularReparto`, coherente con la
    // suite pura `desglose-fiscal.spec.ts`: señal+liquidación = total). 40% de 1076 =
    // 430.40; 60% = 645.60. (Corrige el 400/600 original, que era el ejemplo de 1000.)
    expect(out.reparto?.senalEur).toBe('430.40');
    expect(out.reparto?.liquidacionEur).toBe('645.60');
    // NADA se persiste: ningún repositorio de escritura fue tocado.
    expect(repos.presupuestos.crear).not.toHaveBeenCalled();
    expect(repos.reservas.transicionarAPrereserva).not.toHaveBeenCalled();
    expect(repos.fechaBloqueada.bloquearInsertOUpdate).not.toHaveBeenCalled();
    expect(repos.cola.vaciar).not.toHaveBeenCalled();
    expect(repos.auditoria.registrar).not.toHaveBeenCalled();
  });

  it('debe_pasar_solo_num_adultos_ninos_mayores4_al_motor_ignorando_los_menores_de_4', async () => {
    const { useCase, motor } = montar({
      reserva: reservaActiva({ numAdultosNinosMayores4: 30, numNinosMenores4: 10 }),
    });

    await useCase.preview(comandoPreview());

    const inputMotor = motor.calcular.mock.calls[0][0];
    expect(inputMotor.numAdultosNinosMayores4).toBe(30);
    // Los menores de 4 NO se pasan (informativos, gratuitos).
    expect(JSON.stringify(inputMotor)).not.toContain('numNinosMenores4');
  });
});

// ===========================================================================
// 3.4 — FA-01 datos fiscales incompletos: enumera camposFaltantes, NO llama al
//        motor y NO persiste (RESERVA y FECHA_BLOQUEADA intactas).
// ===========================================================================

describe('GenerarPresupuestoUseCase — FA-01 datos fiscales incompletos (3.4)', () => {
  it('debe_lanzar_DATOS_FISCALES_INCOMPLETOS_enumerando_dni_faltante_sin_llamar_al_motor', async () => {
    const { useCase, motor, repos } = montar({
      cliente: clienteFiscalCompleto({ dniNif: null }),
    });

    const promesa = useCase.confirmar(comandoConfirmar());
    await expect(promesa).rejects.toBeInstanceOf(DatosFiscalesIncompletosError);
    await expect(promesa).rejects.toMatchObject({
      codigo: 'DATOS_FISCALES_INCOMPLETOS',
      camposFaltantes: expect.arrayContaining(['dniNif']),
    });

    // No se ejecuta el motor ni se persiste nada.
    expect(motor.calcular).not.toHaveBeenCalled();
    expect(repos.presupuestos.crear).not.toHaveBeenCalled();
    expect(repos.reservas.transicionarAPrereserva).not.toHaveBeenCalled();
    expect(repos.fechaBloqueada.bloquearInsertOUpdate).not.toHaveBeenCalled();
  });

  it('debe_enumerar_TODOS_los_campos_fiscales_faltantes', async () => {
    const { useCase } = montar({
      cliente: clienteFiscalCompleto({
        dniNif: null,
        direccion: '',
        codigoPostal: null,
        poblacion: null,
        provincia: null,
      }),
    });

    await expect(useCase.confirmar(comandoConfirmar())).rejects.toMatchObject({
      camposFaltantes: expect.arrayContaining([
        'dniNif',
        'direccion',
        'codigoPostal',
        'poblacion',
        'provincia',
      ]),
    });
  });

  it('debe_incluir_los_datos_de_la_RESERVA_incompletos_en_camposFaltantes', async () => {
    const { useCase } = montar({
      reserva: reservaActiva({ duracionHoras: null, tipoEvento: null }),
    });

    await expect(useCase.confirmar(comandoConfirmar())).rejects.toMatchObject({
      codigo: 'DATOS_FISCALES_INCOMPLETOS',
      camposFaltantes: expect.arrayContaining(['duracionHoras', 'tipoEvento']),
    });
  });
});

// ===========================================================================
// 3.3 — Tarifa congelada: confirmar crea PRESUPUESTO con tarifa_congelada=true,
//        iva_porcentaje=21, version=1, estado='enviado', desglose base/IVA/total.
// ===========================================================================

describe('GenerarPresupuestoUseCase.confirmar — PRESUPUESTO congelado con IVA 21% (3.3)', () => {
  it('debe_crear_el_presupuesto_congelado_version_1_enviado_con_desglose_derivado_del_motor', async () => {
    const { useCase, repos } = montar();

    await useCase.confirmar(comandoConfirmar());

    expect(repos.presupuestos.crear).toHaveBeenCalledTimes(1);
    const args = repos.presupuestos.crear.mock.calls[0][0];
    expect(args.version).toBe(1);
    expect(args.estado).toBe('enviado');
    expect(args.tarifaCongelada).toBe(true);
    expect(args.ivaPorcentaje).toBe('21.00');
    expect(args.total).toBe('1076.00');
    expect(args.baseImponible).toBe('889.26');
    expect(args.ivaImporte).toBe('186.74');
    // Trazabilidad de la TARIFA congelada usada.
    expect(args.tarifaId).toBe('tarifa-alta-8h-31_40');
  });

  it('debe_orquestar_todo_dentro_de_una_unica_unidad_de_trabajo', async () => {
    const { useCase, uow } = montar();

    await useCase.confirmar(comandoConfirmar());

    expect(uow.ejecutar).toHaveBeenCalledTimes(1);
  });

  it('debe_transicionar_a_pre_reserva_con_ttl_derivado_de_ttl_prereserva_dias', async () => {
    const { useCase, repos } = montar();

    await useCase.confirmar(comandoConfirmar());

    const args = repos.reservas.transicionarAPrereserva.mock.calls[0][0];
    // TTL = now() + 7 días (setting), NO hardcodeado.
    expect((args.ttlExpiracion as Date).getTime()).toBe(AHORA.getTime() + 7 * DIA_MS);
  });
});

// ===========================================================================
// 3.5 — FA-02 >50 invitados: tarifa_a_consultar habilita precio manual; el total
//        del PRESUPUESTO es el precio manual; sin precio manual no confirma (422).
// ===========================================================================

describe('GenerarPresupuestoUseCase — FA-02 precio manual >50 invitados (3.5)', () => {
  it('preview_debe_devolver_tarifaAConsultar_true_con_desglose_null_sin_precio_manual', async () => {
    const { useCase } = montar({
      reserva: reservaActiva({ numAdultosNinosMayores4: 60 }),
      motor: crearMotorFake(resultadoTarifaAConsultar()),
    });

    const out = await useCase.preview(comandoPreview());

    expect(out.tarifaAConsultar).toBe(true);
    // Sin precio manual, el desglose y el reparto quedan a null (a completar).
    expect(out.desglose).toBeNull();
    expect(out.reparto).toBeNull();
  });

  it('confirmar_debe_usar_el_precio_manual_como_total_del_presupuesto', async () => {
    const { useCase, repos } = montar({
      reserva: reservaActiva({ numAdultosNinosMayores4: 60 }),
      motor: crearMotorFake(resultadoTarifaAConsultar()),
    });

    await useCase.confirmar(comandoConfirmar({ precioManualEur: '3000.00' }));

    const args = repos.presupuestos.crear.mock.calls[0][0];
    expect(args.total).toBe('3000.00');
    expect(args.ivaPorcentaje).toBe('21.00');
    // En el caso a-consultar, tarifaId es null (no hay fila de tarifario usada).
    expect(args.tarifaId).toBeNull();
  });

  it('confirmar_sin_precio_manual_debe_lanzar_PRECIO_MANUAL_REQUERIDO_sin_persistir', async () => {
    const { useCase, repos } = montar({
      reserva: reservaActiva({ numAdultosNinosMayores4: 60 }),
      motor: crearMotorFake(resultadoTarifaAConsultar()),
    });

    const promesa = useCase.confirmar(comandoConfirmar());
    await expect(promesa).rejects.toBeInstanceOf(PrecioManualRequeridoError);
    await expect(promesa).rejects.toMatchObject({ codigo: 'PRECIO_MANUAL_REQUERIDO' });

    expect(repos.presupuestos.crear).not.toHaveBeenCalled();
    expect(repos.reservas.transicionarAPrereserva).not.toHaveBeenCalled();
  });
});

// ===========================================================================
// 3.7 — Motor sin tarifa vigente: propaga TARIFA_NO_CONFIGURADA/
//        TEMPORADA_NO_CONFIGURADA, sin PRESUPUESTO, RESERVA intacta.
// ===========================================================================

describe('GenerarPresupuestoUseCase — motor sin tarifa vigente (3.7)', () => {
  it('debe_propagar_TARIFA_NO_CONFIGURADA_sin_crear_presupuesto_ni_mutar', async () => {
    const { useCase, repos } = montar({
      motor: crearMotorFake(new TarifaNoConfiguradaError('alta', 8, 40)),
    });

    await expect(useCase.confirmar(comandoConfirmar())).rejects.toBeInstanceOf(
      TarifaNoConfiguradaError,
    );
    expect(repos.presupuestos.crear).not.toHaveBeenCalled();
    expect(repos.reservas.transicionarAPrereserva).not.toHaveBeenCalled();
    expect(repos.fechaBloqueada.bloquearInsertOUpdate).not.toHaveBeenCalled();
  });

  it('debe_propagar_TEMPORADA_NO_CONFIGURADA_sin_efectos', async () => {
    const { useCase, repos } = montar({
      motor: crearMotorFake(new TemporadaNoConfiguradaError(9)),
    });

    await expect(useCase.confirmar(comandoConfirmar())).rejects.toBeInstanceOf(
      TemporadaNoConfiguradaError,
    );
    expect(repos.presupuestos.crear).not.toHaveBeenCalled();
  });
});

// ===========================================================================
// 3.2 — Guarda de origen y precondición de PRESUPUESTO previo (ambas ANTES del
//        motor y de la tx): 2.d/terminal/pre_reserva → ORIGEN_INVALIDO;
//        presupuesto enviado/aceptado previo → PRESUPUESTO_YA_EXISTE (UC-15).
// ===========================================================================

describe('GenerarPresupuestoUseCase — guarda de origen y presupuesto previo (3.2)', () => {
  const origenesInvalidos: ReadonlyArray<Partial<ReservaPresupuesto>> = [
    { subEstado: '2d' },
    { subEstado: '2x' },
    { subEstado: '2y' },
    { subEstado: '2z' },
    { estado: 'pre_reserva', subEstado: null },
    { estado: 'reserva_confirmada', subEstado: null },
  ];

  it.each(origenesInvalidos)(
    'confirmar_debe_lanzar_ORIGEN_INVALIDO_para_%o_sin_motor_ni_persistencia',
    async (over) => {
      const { useCase, motor, repos } = montar({ reserva: reservaActiva(over) });

      const promesa = useCase.confirmar(comandoConfirmar());
      await expect(promesa).rejects.toBeInstanceOf(OrigenInvalidoError);
      await expect(promesa).rejects.toMatchObject({ codigo: 'ORIGEN_INVALIDO' });

      expect(motor.calcular).not.toHaveBeenCalled();
      expect(repos.presupuestos.crear).not.toHaveBeenCalled();
    },
  );

  it('preview_debe_lanzar_ORIGEN_INVALIDO_desde_2d_sin_ejecutar_el_motor', async () => {
    const { useCase, motor } = montar({ reserva: reservaActiva({ subEstado: '2d' }) });

    await expect(useCase.preview(comandoPreview())).rejects.toBeInstanceOf(
      OrigenInvalidoError,
    );
    expect(motor.calcular).not.toHaveBeenCalled();
  });

  it('confirmar_debe_lanzar_PRESUPUESTO_YA_EXISTE_cuando_hay_uno_enviado_remitiendo_a_UC15', async () => {
    const { useCase, repos } = montar({ presupuestoPrevio: true });

    const promesa = useCase.confirmar(comandoConfirmar());
    await expect(promesa).rejects.toBeInstanceOf(PresupuestoYaExisteError);
    await expect(promesa).rejects.toMatchObject({ codigo: 'PRESUPUESTO_YA_EXISTE' });
    // No crea un segundo PRESUPUESTO.
    expect(repos.presupuestos.crear).not.toHaveBeenCalled();
  });
});

// ===========================================================================
// 404 — RESERVA inexistente para el tenant (RLS: cross-tenant invisible).
// ===========================================================================

describe('GenerarPresupuestoUseCase — RESERVA inexistente / cross-tenant → 404', () => {
  it('debe_lanzar_ReservaNoEncontrada_cuando_no_existe_para_el_tenant', async () => {
    const { useCase, repos } = montar({ reserva: null });

    await expect(
      useCase.confirmar(comandoConfirmar({ tenantId: OTRO_TENANT })),
    ).rejects.toBeInstanceOf(ReservaNoEncontradaError);
    expect(repos.presupuestos.crear).not.toHaveBeenCalled();
  });
});

// ===========================================================================
// N1 — Reintento de numeración vs. colisión de fecha D4 (fix code-review 6.1b):
//   el bucle de reintento ante `P2002` debe DISCRIMINAR por `meta.target`:
//     · P2002 de numeración (UNIQUE(tenant_id, numero_presupuesto)) → REINTENTA.
//     · P2002 de fecha (UNIQUE(tenant_id, fecha) de FECHA_BLOQUEADA, carrera D4) →
//       PROPAGA de inmediato (sin reintentar) para su mapeo 409 "fecha no disponible".
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
 * UoW fake que, en cada invocación de `ejecutar`, decide si el `trabajo` colisiona
 * lanzando el error de la cola `erroresPorIntento` (uno por intento) o lo ejecuta a
 * fondo. Cuenta las invocaciones para verificar cuántos reintentos hubo.
 */
const crearUowConColisiones = (
  repos: ReposFake,
  erroresPorIntento: ReadonlyArray<Error | null>,
): UnidadDeTrabajoActivarPrereservaPort & { ejecutar: jest.Mock } => {
  let intento = 0;
  return {
    ejecutar: jest.fn(
      async <T,>(
        _tenantId: string,
        trabajo: (r: RepositoriosActivarPrereserva) => Promise<T>,
      ) => {
        const errorDeEsteIntento = erroresPorIntento[intento] ?? null;
        intento += 1;
        if (errorDeEsteIntento !== null) {
          // Simula la tx que colisiona: se ejecuta el trabajo (recalcula el número
          // desde el último del año) pero la BD rechaza el commit con el P2002.
          await trabajo(repos);
          throw errorDeEsteIntento;
        }
        return trabajo(repos);
      },
    ),
  };
};

const montarConUow = (
  uow: UnidadDeTrabajoActivarPrereservaPort & { ejecutar: jest.Mock },
  repos: ReposFake,
) => {
  const deps: GenerarPresupuestoDeps = {
    motorTarifa: crearMotorFake() as unknown as CalculadoraTarifaService,
    unidadDeTrabajo: uow,
    tenantSettings: { obtener: jest.fn(async () => settings) },
    cargarReserva: jest.fn(async () => reservaActiva()),
    cargarCliente: jest.fn(async () => clienteFiscalCompleto()),
    generarPdf: jest.fn(async () => 'https://docs/p-1.pdf'),
    clock: relojFijo,
  };
  return { useCase: new GenerarPresupuestoUseCase(deps), uow, repos };
};

describe('GenerarPresupuestoUseCase.confirmar — reintento de numeración vs. D4 (N1)', () => {
  it('debe_reintentar_ante_P2002_de_numeracion_y_persistir_el_numero_incrementado', async () => {
    // El repo devuelve un último número distinto por intento: 1er intento calcula
    // 2026001, colisiona; 2º intento calcula 2026002 y tiene éxito.
    const repos = crearReposFake();
    const numerosDelAnio = ['2026000', '2026001'];
    let llamada = 0;
    repos.presupuestos.ultimoNumeroDelAnio = jest.fn(async () => {
      const valor = numerosDelAnio[llamada] ?? numerosDelAnio[numerosDelAnio.length - 1];
      llamada += 1;
      return valor;
    });
    const uow = crearUowConColisiones(repos, [
      crearP2002(['tenant_id', 'numero_presupuesto']),
      null,
    ]);
    const { useCase } = montarConUow(uow, repos);

    const resultado = await useCase.confirmar(comandoConfirmar());

    // Reintentó: dos aperturas de la tx.
    expect(uow.ejecutar).toHaveBeenCalledTimes(2);
    // Persistió el número recalculado del SEGUNDO intento (2026002), no el que colisionó.
    const numerosCreados = repos.presupuestos.crear.mock.calls.map(
      (c) => (c[0] as { numeroPresupuesto: string }).numeroPresupuesto,
    );
    expect(numerosCreados[numerosCreados.length - 1]).toBe('2026002');
    // NO propaga: la confirmación tiene éxito.
    expect(resultado.presupuesto).toBeDefined();
  });

  it('debe_propagar_de_inmediato_el_P2002_de_fecha_D4_sin_reintentar', async () => {
    const repos = crearReposFake();
    // Este es el P2002 que lanza el adaptador del bloqueo (activar-prereserva-uow:184).
    const uow = crearUowConColisiones(repos, [crearP2002(['tenant_id', 'fecha'])]);
    const { useCase } = montarConUow(uow, repos);

    const promesa = useCase.confirmar(comandoConfirmar());

    // Propaga el P2002 tal cual (el controller lo mapea a 409 "fecha no disponible").
    await expect(promesa).rejects.toMatchObject({
      code: 'P2002',
      meta: { target: ['tenant_id', 'fecha'] },
    });
    // NO reintentó: una única apertura de la tx (no interfiere con el bloqueo atómico).
    expect(uow.ejecutar).toHaveBeenCalledTimes(1);
  });
});

// ===========================================================================
// 3.10 — Atomicidad: si CUALQUIER operación de la tx falla, el error se PROPAGA
//         para que la UoW haga rollback total (no se atrapa; all-or-nothing).
// ===========================================================================

describe('GenerarPresupuestoUseCase.confirmar — atomicidad / rollback (3.10)', () => {
  it.each([
    'crearPresupuesto',
    'transicion',
    'bloqueo',
    'vaciarCola',
    'auditoria',
  ] as const)(
    'debe_propagar_el_error_cuando_falla_%s_para_que_la_tx_revierta',
    async (op) => {
      const { useCase } = montar({ fallarEn: op });

      await expect(useCase.confirmar(comandoConfirmar())).rejects.toThrow(
        `FALLO_${op.toUpperCase()}`,
      );
    },
  );
});
