/**
 * TESTS del caso de uso `GenerarPresupuestoUseCase` para la 6.2 (método de pago →
 * régimen, cálculo por régimen, doble numeración) — fase TDD RED.
 * tasks.md Fase 3: 3.4. Rebanada `documentos-presupuesto-sin-iva-doble-numeracion`.
 *
 * Trazabilidad: spec-delta `presupuestos` (Requirements "Método de pago del presupuesto
 * determina el régimen fiscal", "Total, IVA y reparto dependientes del régimen",
 * "Numeración por tenant, año y régimen (doble secuencia)"; escenarios "Transferencia
 * genera régimen CON IVA", "Efectivo genera régimen SIN IVA", "El método de pago es
 * obligatorio", "Colisión concurrente de numeración se reintenta discriminando el P2002");
 * design.md D1/D2/D4 y §"Impacto en el cálculo fiscal por régimen".
 *
 * FIRMAS QUE FIJA ESTE TEST para la implementación (`presupuestos/application/
 * generar-presupuesto.use-case.ts`, extendido):
 *   - `ComandoBasePresupuesto` gana `metodoPago: MetodoPago` (OBLIGATORIO en preview y
 *     confirmar). El régimen NUNCA viaja en el comando: se DERIVA.
 *   - El use-case deriva `regimenIva = regimenDesdeMetodoPago(comando.metodoPago)`,
 *     calcula `calcularDesgloseFiscal`/`calcularReparto` pasándoles ese régimen, y
 *     persiste AMBOS en `crear(...)`: `CrearPresupuestoParams` gana
 *     `metodoPago: MetodoPago` y `regimenIva: RegimenIva`.
 *   - `PresupuestoRepositoryPort.ultimoNumeroDelAnio(tenantId, anio, regimen)` gana el
 *     3er parámetro `regimen: RegimenIva` (doble secuencia; discrimina el `MAX`).
 *   - El reintento `P2002` se ancla a la NUEVA unicidad
 *     `presupuesto_tenant_id_regimen_iva_numero_presupuesto_key`; el `P2002` de la fecha
 *     D4 (`UNIQUE(tenant_id, fecha)`) NO se reintenta y propaga.
 *   - Falta de `metodoPago` → error de dominio `MetodoPagoRequeridoError`
 *     (`codigo: 'METODO_PAGO_REQUERIDO'`) sin efectos (mapea a 422/400).
 *
 * Ejercita la APLICACIÓN contra DOBLES DE LOS PUERTOS (in-memory), sin tocar Prisma
 * (hexagonal, hook `no-infra-in-domain`). La numeración concurrente REAL vive en la suite
 * de integración/concurrencia (sesión principal, con Postgres) — aquí se fija la
 * ORQUESTACIÓN por régimen con mocks.
 *
 * RED: `metodoPago`/`regimenIva` aún NO existen en el comando ni en `crear(...)`,
 * `ultimoNumeroDelAnio` aún NO recibe régimen, y `MetodoPagoRequeridoError` aún NO existe.
 * La batería está en ROJO por AUSENCIA DE IMPLEMENTACIÓN. GREEN es de `backend-developer`.
 */
import {
  GenerarPresupuestoUseCase,
  MetodoPagoRequeridoError,
  type GenerarPresupuestoDeps,
  type ConfirmarPresupuestoComando,
  type PreviewPresupuestoComando,
  type RepositoriosActivarPrereserva,
  type UnidadDeTrabajoActivarPrereservaPort,
  type ReservaPresupuesto,
  type ClientePresupuesto,
  type ClockPort,
  type TenantSettingsPresupuesto,
} from '../application/generar-presupuesto.use-case';
import type { MetodoPago, RegimenIva } from '../domain/regimen-desde-metodo-pago';
import {
  CalculadoraTarifaService,
  type CalculoTarifaResultado,
} from '../../tarifas/domain/calculadora-tarifa.service';

const TENANT = '00000000-0000-0000-0000-000000000001';
const GESTOR = '00000000-0000-0000-0000-000000000002';
const RESERVA_ID = 'res-2b';
const CLIENTE_ID = 'cli-1';
const DIA_MS = 24 * 60 * 60 * 1000;

const AHORA = new Date('2026-06-30T10:00:00.000Z');
const FECHA_EVENTO = new Date('2027-09-12T00:00:00.000Z');
const relojFijo: ClockPort = { ahora: () => AHORA };

// ---------------------------------------------------------------------------
// Dobles de datos.
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

// Motor de tarifa: total con IVA incluido 1210 → base derivada 1000.
const resultadoTarifaNormal = (
  over: Partial<CalculoTarifaResultado> = {},
): CalculoTarifaResultado => ({
  temporada: 'alta',
  tarifaAConsultar: false,
  precioTarifaEur: 1210,
  extrasTotalEur: 0,
  totalEur: 1210,
  tarifaId: 'tarifa-alta-8h-31_40',
  ...over,
});

type MotorFake = { calcular: jest.Mock };
const crearMotorFake = (
  resultado: CalculoTarifaResultado = resultadoTarifaNormal(),
): MotorFake => ({ calcular: jest.fn(async () => resultado) });

// ---------------------------------------------------------------------------
// Repositorios + UoW fake.
// ---------------------------------------------------------------------------

interface ReposFake extends RepositoriosActivarPrereserva {
  presupuestos: {
    buscarEnviadoOAceptado: jest.Mock;
    ultimoNumeroDelAnio: jest.Mock;
    crear: jest.Mock;
  };
  reservas: { transicionarAPrereserva: jest.Mock };
  fechaBloqueada: { bloquearInsertOUpdate: jest.Mock };
  cola: { vaciar: jest.Mock };
  auditoria: { registrar: jest.Mock };
}

const crearReposFake = (): ReposFake => ({
  presupuestos: {
    buscarEnviadoOAceptado: jest.fn(async () => null),
    ultimoNumeroDelAnio: jest.fn(async () => null),
    crear: jest.fn(async (p: Record<string, unknown>) => ({
      idPresupuesto: 'p-1',
      version: 1,
      estado: 'enviado',
      ...p,
    })),
  },
  reservas: { transicionarAPrereserva: jest.fn(async () => undefined) },
  fechaBloqueada: { bloquearInsertOUpdate: jest.fn(async () => undefined) },
  cola: { vaciar: jest.fn(async () => ({ descartadas: [] })) },
  auditoria: { registrar: jest.fn(async () => undefined) },
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

const montar = (opciones: { motor?: MotorFake; repos?: ReposFake } = {}) => {
  const motor = opciones.motor ?? crearMotorFake();
  const repos = opciones.repos ?? crearReposFake();
  const uow = crearUowFake(repos);
  const deps: GenerarPresupuestoDeps = {
    motorTarifa: motor as unknown as CalculadoraTarifaService,
    unidadDeTrabajo: uow,
    tenantSettings: { obtener: jest.fn(async () => settings) },
    cargarReserva: jest.fn(async () => reservaActiva()),
    cargarCliente: jest.fn(async () => clienteFiscalCompleto()),
    generarPdf: jest.fn(async () => 'https://docs/p-1.pdf'),
    clock: relojFijo,
  };
  return { useCase: new GenerarPresupuestoUseCase(deps), repos, uow, motor };
};

const comandoConfirmar = (
  metodoPago: MetodoPago,
  over: Partial<ConfirmarPresupuestoComando> = {},
): ConfirmarPresupuestoComando => ({
  tenantId: TENANT,
  usuarioId: GESTOR,
  reservaId: RESERVA_ID,
  extras: [],
  metodoPago,
  ...over,
});

const comandoPreview = (
  metodoPago: MetodoPago,
  over: Partial<PreviewPresupuestoComando> = {},
): PreviewPresupuestoComando => ({
  tenantId: TENANT,
  usuarioId: GESTOR,
  reservaId: RESERVA_ID,
  extras: [],
  metodoPago,
  ...over,
});

// ===========================================================================
// 6.2 D4 — El preview EXPONE el régimen derivado del método de pago para que la
//   UI pinte el badge "Régimen fiscal" (contrato: PresupuestoPreviewResponse.
//   regimenIva required). efectivo ⇒ sin_iva; transferencia ⇒ con_iva.
// ===========================================================================

describe('GenerarPresupuestoUseCase.preview — expone regimenIva derivado (6.2 D4)', () => {
  it('preview_con_metodo_efectivo_debe_exponer_regimenIva_sin_iva', async () => {
    const { useCase } = montar();

    const out = await useCase.preview(comandoPreview('efectivo'));

    expect(out.regimenIva).toBe('sin_iva');
  });

  it('preview_con_metodo_transferencia_debe_exponer_regimenIva_con_iva', async () => {
    const { useCase } = montar();

    const out = await useCase.preview(comandoPreview('transferencia'));

    expect(out.regimenIva).toBe('con_iva');
  });
});

// ===========================================================================
// 3.4 — Transferencia ⇒ CON IVA: persiste regimenIva='con_iva' + metodoPago, y
//        el total es base+IVA21 (1210). Numeración pedida para el régimen CON.
// ===========================================================================

describe('GenerarPresupuestoUseCase.confirmar — transferencia genera CON IVA (3.4)', () => {
  it('debe_derivar_y_persistir_regimen_con_iva_y_metodo_transferencia_con_total_1210', async () => {
    const { useCase, repos } = montar();

    await useCase.confirmar(comandoConfirmar('transferencia'));

    const args = repos.presupuestos.crear.mock.calls[0][0];
    // Persiste AMBOS: método elegido + régimen derivado (auditoría / origen).
    expect(args.metodoPago as MetodoPago).toBe('transferencia');
    expect(args.regimenIva as RegimenIva).toBe('con_iva');
    // CON IVA: total = base + IVA21 (1210), base 1000, IVA 210.
    expect(args.total).toBe('1210.00');
    expect(args.baseImponible).toBe('1000.00');
    expect(args.ivaImporte).toBe('210.00');
    expect(args.ivaPorcentaje).toBe('21.00');
  });

  it('debe_consultar_ultimoNumeroDelAnio_para_el_regimen_con_iva', async () => {
    const { useCase, repos } = montar();

    await useCase.confirmar(comandoConfirmar('transferencia'));

    // La consulta MAX discrimina por régimen (3er parámetro).
    const args = repos.presupuestos.ultimoNumeroDelAnio.mock.calls[0];
    expect(args[0]).toBe(TENANT);
    expect(args[1]).toBe(2026);
    expect(args[2] as RegimenIva).toBe('con_iva');
  });
});

// ===========================================================================
// 3.4 — Efectivo ⇒ SIN IVA: persiste regimenIva='sin_iva' + metodoPago, y el
//        total es la base sin IVA (1000, importe MENOR). Numeración régimen SIN.
// ===========================================================================

describe('GenerarPresupuestoUseCase.confirmar — efectivo genera SIN IVA (3.4)', () => {
  it('debe_derivar_y_persistir_regimen_sin_iva_y_metodo_efectivo_con_total_1000', async () => {
    const { useCase, repos } = montar();

    await useCase.confirmar(comandoConfirmar('efectivo'));

    const args = repos.presupuestos.crear.mock.calls[0][0];
    expect(args.metodoPago as MetodoPago).toBe('efectivo');
    expect(args.regimenIva as RegimenIva).toBe('sin_iva');
    // SIN IVA: total = base (1000, importe MENOR), IVA 0.
    expect(args.total).toBe('1000.00');
    expect(args.baseImponible).toBe('1000.00');
    expect(args.ivaImporte).toBe('0.00');
    expect(args.ivaPorcentaje).toBe('0.00');
  });

  it('debe_repartir_40_60_sobre_el_total_sin_iva_1000', async () => {
    const { useCase } = montar();

    const out = await useCase.confirmar(comandoConfirmar('efectivo'));

    // 40% de 1000 = 400; 60% = 600; fiança fija 500.
    expect(out.reparto.senalEur).toBe('400.00');
    expect(out.reparto.liquidacionEur).toBe('600.00');
    expect(out.reparto.fianzaEur).toBe('500.00');
  });

  it('debe_consultar_ultimoNumeroDelAnio_para_el_regimen_sin_iva', async () => {
    const { useCase, repos } = montar();

    await useCase.confirmar(comandoConfirmar('efectivo'));

    const args = repos.presupuestos.ultimoNumeroDelAnio.mock.calls[0];
    expect(args[2] as RegimenIva).toBe('sin_iva');
  });

  it('el_total_sin_iva_debe_ser_MENOR_que_el_con_iva_para_la_misma_reserva', async () => {
    const conIva = montar();
    const sinIva = montar();

    await conIva.useCase.confirmar(comandoConfirmar('transferencia'));
    await sinIva.useCase.confirmar(comandoConfirmar('efectivo'));

    const totalConIva = Number(conIva.repos.presupuestos.crear.mock.calls[0][0].total);
    const totalSinIva = Number(sinIva.repos.presupuestos.crear.mock.calls[0][0].total);
    expect(totalSinIva).toBeLessThan(totalConIva);
    expect(totalSinIva).toBe(1000);
    expect(totalConIva).toBe(1210);
  });
});

// ===========================================================================
// 3.4 — metodoPago OBLIGATORIO: sin método → METODO_PAGO_REQUERIDO, sin motor
//        ni persistencia (RESERVA/FECHA_BLOQUEADA intactas).
// ===========================================================================

describe('GenerarPresupuestoUseCase — metodoPago obligatorio (3.4)', () => {
  it('confirmar_sin_metodoPago_debe_lanzar_METODO_PAGO_REQUERIDO_sin_efectos', async () => {
    const { useCase, repos, motor } = montar();
    // Comando SIN metodoPago (forzamos el hueco que la validación debe detectar).
    const comandoSinMetodo = {
      tenantId: TENANT,
      usuarioId: GESTOR,
      reservaId: RESERVA_ID,
      extras: [],
    } as unknown as ConfirmarPresupuestoComando;

    const promesa = useCase.confirmar(comandoSinMetodo);
    await expect(promesa).rejects.toBeInstanceOf(MetodoPagoRequeridoError);
    await expect(promesa).rejects.toMatchObject({ codigo: 'METODO_PAGO_REQUERIDO' });

    // Sin efectos: ni motor ni persistencia.
    expect(motor.calcular).not.toHaveBeenCalled();
    expect(repos.presupuestos.crear).not.toHaveBeenCalled();
    expect(repos.reservas.transicionarAPrereserva).not.toHaveBeenCalled();
    expect(repos.fechaBloqueada.bloquearInsertOUpdate).not.toHaveBeenCalled();
  });

  it('confirmar_con_metodoPago_invalido_debe_lanzar_METODO_PAGO_REQUERIDO_sin_efectos', async () => {
    const { useCase, repos } = montar();
    const comandoInvalido = comandoConfirmar('paypal' as unknown as MetodoPago);

    await expect(useCase.confirmar(comandoInvalido)).rejects.toBeInstanceOf(
      MetodoPagoRequeridoError,
    );
    expect(repos.presupuestos.crear).not.toHaveBeenCalled();
  });
});

// ===========================================================================
// 3.4 — Reintento P2002 discriminado por la NUEVA unicidad por régimen:
//   · P2002 de numeración (tenant_id, regimen_iva, numero_presupuesto) → REINTENTA.
//   · P2002 de fecha D4 (tenant_id, fecha) → PROPAGA sin reintentar (409).
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

describe('GenerarPresupuestoUseCase.confirmar — reintento P2002 por la unicidad de régimen (3.4)', () => {
  it('debe_reintentar_ante_P2002_de_la_nueva_unicidad_por_regimen', async () => {
    const repos = crearReposFake();
    const numerosDelAnio = ['2026000', '2026001'];
    let llamada = 0;
    repos.presupuestos.ultimoNumeroDelAnio = jest.fn(async () => {
      const valor = numerosDelAnio[llamada] ?? numerosDelAnio[numerosDelAnio.length - 1];
      llamada += 1;
      return valor;
    });
    // El índice de la nueva constraint por régimen (Opción A, D2).
    const uow = crearUowConColisiones(repos, [
      crearP2002('presupuesto_tenant_id_regimen_iva_numero_presupuesto_key'),
      null,
    ]);
    const { useCase } = montarConUow(uow, repos);

    const resultado = await useCase.confirmar(comandoConfirmar('transferencia'));

    expect(uow.ejecutar).toHaveBeenCalledTimes(2);
    const numerosCreados = repos.presupuestos.crear.mock.calls.map(
      (c) => (c[0] as { numeroPresupuesto: string }).numeroPresupuesto,
    );
    expect(numerosCreados[numerosCreados.length - 1]).toBe('2026002');
    expect(resultado.presupuesto).toBeDefined();
  });

  it('debe_reintentar_ante_P2002_por_el_array_de_columnas_de_la_constraint_de_regimen', async () => {
    const repos = crearReposFake();
    const uow = crearUowConColisiones(repos, [
      crearP2002(['tenant_id', 'regimen_iva', 'numero_presupuesto']),
      null,
    ]);
    const { useCase } = montarConUow(uow, repos);

    const resultado = await useCase.confirmar(comandoConfirmar('efectivo'));

    expect(uow.ejecutar).toHaveBeenCalledTimes(2);
    expect(resultado.presupuesto).toBeDefined();
  });

  it('debe_propagar_de_inmediato_el_P2002_de_fecha_D4_sin_reintentar', async () => {
    const repos = crearReposFake();
    const uow = crearUowConColisiones(repos, [crearP2002(['tenant_id', 'fecha'])]);
    const { useCase } = montarConUow(uow, repos);

    const promesa = useCase.confirmar(comandoConfirmar('transferencia'));

    await expect(promesa).rejects.toMatchObject({
      code: 'P2002',
      meta: { target: ['tenant_id', 'fecha'] },
    });
    // NO reintentó (no interfiere con el bloqueo atómico D4 → 409 "fecha no disponible").
    expect(uow.ejecutar).toHaveBeenCalledTimes(1);
  });
});
