/**
 * TESTS DEL MOTOR DE CÁLCULO DE TARIFA (US-016 / UC-16) — fase TDD RED.
 *
 * Trazabilidad: US-016, spec-delta `calculo-tarifa`, design.md (D-1..D-5).
 *
 * El motor es una operación de DOMINIO PURO: stateless, determinista y de
 * LECTURA PURA (no muta entidades). Por eso estos tests NO tocan Prisma ni la
 * BD: ejercitan el dominio contra DOBLES DE LOS PUERTOS (in-memory), de modo
 * que el dominio quede aislado de infraestructura (hexagonal, hook
 * `no-infra-in-domain`).
 *
 * RED: en este punto NO existe la implementación
 * (`tarifas/domain/calculadora-tarifa.service.ts`); el import falla y toda la
 * batería está en ROJO. La fase GREEN es responsabilidad de `backend-developer`.
 *
 * Esquema de salida canónico bajo prueba (D-1):
 *   { temporada, tarifa_a_consultar, precio_tarifa_eur, extras_total_eur,
 *     total_eur, tarifa_id } — en camelCase de dominio:
 *   { temporada, tarifaAConsultar, precioTarifaEur, extrasTotalEur, totalEur, tarifaId }
 *
 * Orden de evaluación verificado (D-5):
 *   validar inputs → determinar temporada → corte >50 (sin tarifa ni extras)
 *   → buscar TARIFA vigente → sumar extras → componer output.
 */
import {
  CalculadoraTarifaService,
  TemporadaNoConfiguradaError,
  TarifaNoConfiguradaError,
  ExtraNoEncontradoError,
  ValidacionTarifaError,
  type Temporada,
  type CalcularTarifaInput,
  type CalculoTarifaResultado,
  type TarifaRepositoryPort,
  type TemporadaCalendarioPort,
  type ExtraRepositoryPort,
  type ClockPort,
} from '../domain/calculadora-tarifa.service';

// ---------------------------------------------------------------------------
// Datos canónicos (alineados con apps/api/prisma/seed.ts — Masia l'Encís)
// ---------------------------------------------------------------------------

const TENANT = '00000000-0000-0000-0000-000000000001';
const OTRO_TENANT = '00000000-0000-0000-0000-0000000000ff';

// Mapeo mes -> temporada del tenant (Alta 5-9, Media 3,4,10,11, Baja 12,1,2).
const MAPA_TEMPORADAS: Record<number, Temporada> = {
  1: 'baja', 2: 'baja', 3: 'media', 4: 'media', 5: 'alta', 6: 'alta',
  7: 'alta', 8: 'alta', 9: 'alta', 10: 'media', 11: 'media', 12: 'baja',
};

const TRAMOS = [
  { min: 1, max: 20 },
  { min: 21, max: 25 },
  { min: 26, max: 30 },
  { min: 31, max: 40 },
  { min: 41, max: 50 },
];
const DURACIONES = [4, 8, 12];

// PRECIOS[temporada][idxTramo] = [4h, 8h, 12h] (EUR, IVA 21% incluido).
const PRECIOS: Record<Temporada, number[][]> = {
  alta: [
    [360, 698, 1015],
    [405, 785, 1142],
    [465, 902, 1311],
    [555, 1076, 1565],
    [615, 1193, 1734],
  ],
  media: [
    [336, 651, 947],
    [378, 733, 1065],
    [434, 841, 1223],
    [518, 1004, 1460],
    [574, 1113, 1618],
  ],
  baja: [
    [312, 605, 879],
    [351, 680, 989],
    [403, 781, 1136],
    [481, 933, 1356],
    [533, 1034, 1503],
  ],
};

const EXTRA_BARBACOA = 'extra-barbacoa';
const EXTRA_PAELLERO = 'extra-paellero';

// ---------------------------------------------------------------------------
// Dobles de puertos (in-memory). El dominio depende de estas INTERFACES (D-2);
// aquí van implementaciones fake con spies para verificar llamadas y orden.
// ---------------------------------------------------------------------------

interface TarifaRow {
  idTarifa: string;
  tenantId: string;
  temporada: Temporada;
  duracionHoras: number;
  invitadosMin: number;
  invitadosMax: number;
  precioTotalEur: number;
  vigenteDesde: Date;
  vigenteHasta: Date | null;
}

interface ExtraRow {
  idExtra: string;
  tenantId: string;
  precioEur: number;
  activo: boolean;
}

const idTarifa = (t: Temporada, dur: number, min: number, max: number): string =>
  `tarifa-${t}-${dur}h-${min}_${max}`;

/** Construye las 45 tarifas del seed para el tenant dado (vigentes en 2026). */
const construirTarifasSeed = (tenantId: string): TarifaRow[] => {
  const rows: TarifaRow[] = [];
  (['alta', 'media', 'baja'] as Temporada[]).forEach((temporada) => {
    TRAMOS.forEach((tramo, i) => {
      DURACIONES.forEach((dur, j) => {
        rows.push({
          idTarifa: idTarifa(temporada, dur, tramo.min, tramo.max),
          tenantId,
          temporada,
          duracionHoras: dur,
          invitadosMin: tramo.min,
          invitadosMax: tramo.max,
          precioTotalEur: PRECIOS[temporada][i][j],
          vigenteDesde: new Date('2026-01-01'),
          vigenteHasta: null,
        });
      });
    });
  });
  return rows;
};

type TemporadaPortFake = TemporadaCalendarioPort & {
  resolverTemporada: jest.Mock;
};
type TarifaPortFake = TarifaRepositoryPort & {
  buscarVigente: jest.Mock;
  filas: TarifaRow[];
};
type ExtraPortFake = ExtraRepositoryPort & {
  buscarPorId: jest.Mock;
  filas: ExtraRow[];
};

const crearTemporadaPortFake = (
  mapa: Record<number, Temporada> = MAPA_TEMPORADAS,
  tenantId = TENANT,
): TemporadaPortFake => {
  const resolverTemporada = jest.fn(
    async ({ tenantId: t, mes }: { tenantId: string; mes: number }) => {
      if (t !== tenantId) return null;
      return mapa[mes] ?? null;
    },
  );
  return { resolverTemporada };
};

const crearTarifaPortFake = (filas: TarifaRow[]): TarifaPortFake => {
  const buscarVigente = jest.fn(
    async (params: {
      tenantId: string;
      temporada: Temporada;
      duracionHoras: number;
      numInvitados: number;
      fechaEvento: Date;
    }) => {
      const { tenantId, temporada, duracionHoras, numInvitados, fechaEvento } = params;
      const m = filas.find(
        (r) =>
          r.tenantId === tenantId &&
          r.temporada === temporada &&
          r.duracionHoras === duracionHoras &&
          numInvitados >= r.invitadosMin &&
          numInvitados <= r.invitadosMax &&
          r.vigenteDesde.getTime() <= fechaEvento.getTime() &&
          (r.vigenteHasta === null || r.vigenteHasta.getTime() >= fechaEvento.getTime()),
      );
      return m ? { idTarifa: m.idTarifa, precioTotalEur: m.precioTotalEur } : null;
    },
  );
  return { buscarVigente, filas };
};

const crearExtraPortFake = (filas: ExtraRow[]): ExtraPortFake => {
  // Simula RLS: un extra de OTRO tenant no es visible (devuelve null).
  const buscarPorId = jest.fn(
    async ({ tenantId, extraId }: { tenantId: string; extraId: string }) => {
      const e = filas.find((r) => r.idExtra === extraId && r.tenantId === tenantId);
      return e ? { idExtra: e.idExtra, precioEur: e.precioEur, activo: e.activo } : null;
    },
  );
  return { buscarPorId, filas };
};

/** Reloj fijo para determinismo: por defecto "ahora" = 2026-01-01 (todas las
 *  fechas de evento de 2026 quedan en el futuro respecto a este instante). */
const relojFijo = (iso = '2026-01-01T00:00:00.000Z'): ClockPort => {
  return { ahora: () => new Date(iso) };
};

/** Construye el servicio con sus puertos. Devuelve también los fakes para spiar. */
const montarMotor = (opts?: {
  temporadaPort?: TemporadaPortFake;
  tarifaPort?: TarifaPortFake;
  extraPort?: ExtraPortFake;
  clock?: ClockPort;
}) => {
  const temporadaPort = opts?.temporadaPort ?? crearTemporadaPortFake();
  const tarifaPort = opts?.tarifaPort ?? crearTarifaPortFake(construirTarifasSeed(TENANT));
  const extraPort =
    opts?.extraPort ??
    crearExtraPortFake([
      { idExtra: EXTRA_BARBACOA, tenantId: TENANT, precioEur: 30, activo: true },
      { idExtra: EXTRA_PAELLERO, tenantId: TENANT, precioEur: 30, activo: true },
    ]);
  const clock = opts?.clock ?? relojFijo();

  const motor = new CalculadoraTarifaService({
    temporadaCalendario: temporadaPort,
    tarifaRepository: tarifaPort,
    extraRepository: extraPort,
    clock,
  });
  return { motor, temporadaPort, tarifaPort, extraPort };
};

const inputBase = (over: Partial<CalcularTarifaInput> = {}): CalcularTarifaInput => ({
  fechaEvento: new Date('2026-09-15'),
  duracionHoras: 8,
  numAdultosNinosMayores4: 40,
  extras: [],
  ...over,
});

// ===========================================================================
// 1. Determinación de temporada por el mes de fecha_evento
//    (spec-delta: scenarios 1-4)
// ===========================================================================

describe('Determinación de temporada por el mes de fecha_evento', () => {
  it('debe_resolver_temporada_media_para_marzo', async () => {
    // Arrange
    const { motor } = montarMotor();

    // Act
    const out = await motor.calcular(inputBase({ fechaEvento: new Date('2026-03-01') }), TENANT);

    // Assert
    expect(out.temporada).toBe('media');
  });

  it('debe_resolver_temporada_alta_para_septiembre', async () => {
    const { motor } = montarMotor();
    const out = await motor.calcular(inputBase({ fechaEvento: new Date('2026-09-30') }), TENANT);
    expect(out.temporada).toBe('alta');
  });

  it('debe_resolver_temporada_baja_para_diciembre', async () => {
    const { motor } = montarMotor();
    const out = await motor.calcular(
      inputBase({ fechaEvento: new Date('2026-12-15'), numAdultosNinosMayores4: 40 }),
      TENANT,
    );
    expect(out.temporada).toBe('baja');
  });

  it('debe_lanzar_TEMPORADA_NO_CONFIGURADA_cuando_el_mes_no_esta_mapeado', async () => {
    // Arrange: calendario al que le falta el mes 9 (septiembre sin fila).
    const mapaIncompleto = { ...MAPA_TEMPORADAS };
    delete mapaIncompleto[9];
    const temporadaPort = crearTemporadaPortFake(mapaIncompleto);
    const { motor, tarifaPort } = montarMotor({ temporadaPort });

    // Act + Assert: error de dominio, sin precio y sin buscar tarifa.
    await expect(
      motor.calcular(inputBase({ fechaEvento: new Date('2026-09-15') }), TENANT),
    ).rejects.toBeInstanceOf(TemporadaNoConfiguradaError);
    expect(tarifaPort.buscarVigente).not.toHaveBeenCalled();
  });

  it('debe_exponer_el_mes_en_el_detalle_de_TEMPORADA_NO_CONFIGURADA', async () => {
    const mapaIncompleto = { ...MAPA_TEMPORADAS };
    delete mapaIncompleto[9];
    const { motor } = montarMotor({ temporadaPort: crearTemporadaPortFake(mapaIncompleto) });

    await expect(
      motor.calcular(inputBase({ fechaEvento: new Date('2026-09-15') }), TENANT),
    ).rejects.toMatchObject({ codigo: 'TEMPORADA_NO_CONFIGURADA', mes: 9 });
  });
});

// ===========================================================================
// 2. Búsqueda de TARIFA vigente por temporada × duración × tramo
//    (spec-delta: scenarios 5-9)
// ===========================================================================

describe('Búsqueda de TARIFA vigente', () => {
  it('debe_resolver_happy_path_alta_8h_40_invitados_a_1076', async () => {
    // Arrange
    const { motor } = montarMotor();

    // Act
    const out = await motor.calcular(
      inputBase({
        fechaEvento: new Date('2026-09-15'),
        duracionHoras: 8,
        numAdultosNinosMayores4: 40,
        extras: [],
      }),
      TENANT,
    );

    // Assert: esquema canónico completo (caso normal).
    expect(out.tarifaAConsultar).toBe(false);
    expect(out.temporada).toBe('alta');
    expect(out.precioTarifaEur).toBe(1076);
    expect(out.extrasTotalEur).toBe(0);
    expect(out.totalEur).toBe(1076);
    expect(out.tarifaId).toBe(idTarifa('alta', 8, 31, 40));
  });

  it('debe_distinguir_la_duracion_4_de_8_y_12_en_el_tramo_21_25', async () => {
    const { motor } = montarMotor();

    const out4 = await motor.calcular(
      inputBase({ duracionHoras: 4, numAdultosNinosMayores4: 22 }),
      TENANT,
    );
    const out8 = await motor.calcular(
      inputBase({ duracionHoras: 8, numAdultosNinosMayores4: 22 }),
      TENANT,
    );
    const out12 = await motor.calcular(
      inputBase({ duracionHoras: 12, numAdultosNinosMayores4: 22 }),
      TENANT,
    );

    // 4h=405, 8h=785, 12h=1142 (temporada alta, tramo 21-25).
    expect(out4.precioTarifaEur).toBe(405);
    expect(out8.precioTarifaEur).toBe(785);
    expect(out12.precioTarifaEur).toBe(1142);
  });

  it('debe_ignorar_los_ninos_menores_de_4_para_el_tramo_de_invitados', async () => {
    // Arrange: solo se pasan 30 adultos+mayores4; los 10 menores de 4 NO se pasan.
    const { motor } = montarMotor();

    // Act: 30 invitados cae en el tramo 26-30.
    const out = await motor.calcular(
      inputBase({ numAdultosNinosMayores4: 30 }),
      TENANT,
    );

    // Assert: usa el tramo 26-30 (precio alta/8h/26-30 = 902), no el 31-40.
    expect(out.tarifaId).toBe(idTarifa('alta', 8, 26, 30));
    expect(out.precioTarifaEur).toBe(902);
  });

  it('debe_elegir_la_version_vigente_en_la_fecha_cuando_la_tarifa_esta_versionada', async () => {
    // Arrange: dos versiones para alta/8h/31-40.
    const v1: TarifaRow = {
      idTarifa: 'tarifa-v1-2025',
      tenantId: TENANT,
      temporada: 'alta',
      duracionHoras: 8,
      invitadosMin: 31,
      invitadosMax: 40,
      precioTotalEur: 1000,
      vigenteDesde: new Date('2025-01-01'),
      vigenteHasta: new Date('2025-12-31'),
    };
    const v2: TarifaRow = {
      idTarifa: 'tarifa-v2-2026',
      tenantId: TENANT,
      temporada: 'alta',
      duracionHoras: 8,
      invitadosMin: 31,
      invitadosMax: 40,
      precioTotalEur: 1076,
      vigenteDesde: new Date('2026-01-01'),
      vigenteHasta: null,
    };
    const { motor } = montarMotor({ tarifaPort: crearTarifaPortFake([v1, v2]) });

    // Act: evento en 2026.
    const out = await motor.calcular(
      inputBase({ fechaEvento: new Date('2026-06-15') }),
      TENANT,
    );

    // Assert: gana la versión vigente en 2026.
    expect(out.precioTarifaEur).toBe(1076);
    expect(out.tarifaId).toBe('tarifa-v2-2026');
  });

  it('debe_lanzar_TARIFA_NO_CONFIGURADA_con_detalle_cuando_falta_la_fila', async () => {
    // Arrange: tarifario incompleto — falta alta/12h/41-50.
    const filas = construirTarifasSeed(TENANT).filter(
      (r) => !(r.temporada === 'alta' && r.duracionHoras === 12 && r.invitadosMin === 41),
    );
    const { motor } = montarMotor({ tarifaPort: crearTarifaPortFake(filas) });

    // Act + Assert: num_invitados=45 (<=50) y sin fila -> error con diagnóstico.
    const promesa = motor.calcular(
      inputBase({
        fechaEvento: new Date('2026-09-15'),
        duracionHoras: 12,
        numAdultosNinosMayores4: 45,
      }),
      TENANT,
    );
    await expect(promesa).rejects.toBeInstanceOf(TarifaNoConfiguradaError);
    await expect(promesa).rejects.toMatchObject({
      codigo: 'TARIFA_NO_CONFIGURADA',
      temporada: 'alta',
      duracionHoras: 12,
      numInvitados: 45,
    });
  });
});

// ===========================================================================
// 3. Más de 50 invitados -> tarifa a consultar (sin error)
//    (spec-delta: scenario 10)
// ===========================================================================

describe('Más de 50 invitados devuelve tarifa a consultar', () => {
  it('debe_devolver_tarifa_a_consultar_con_importes_null_y_sin_error_para_55_invitados', async () => {
    // Arrange
    const { motor, tarifaPort, extraPort } = montarMotor();

    // Act: 55 invitados (> 50, tramo +51 sin fila).
    const out = await motor.calcular(
      inputBase({
        fechaEvento: new Date('2026-09-15'),
        numAdultosNinosMayores4: 55,
        extras: [{ extraId: EXTRA_BARBACOA, cantidad: 1 }],
      }),
      TENANT,
    );

    // Assert: temporada presente, los 4 campos a null, sin lanzar error,
    // y SIN evaluar tarifa ni extras (D-5: corte antes de pasos 4-5).
    expect(out.tarifaAConsultar).toBe(true);
    expect(out.temporada).toBe('alta');
    expect(out.precioTarifaEur).toBeNull();
    expect(out.extrasTotalEur).toBeNull();
    expect(out.totalEur).toBeNull();
    expect(out.tarifaId).toBeNull();
    expect(tarifaPort.buscarVigente).not.toHaveBeenCalled();
    expect(extraPort.buscarPorId).not.toHaveBeenCalled();
  });
});

// ===========================================================================
// 4. Suma de extras del catálogo del tenant
//    (spec-delta: scenarios 11-13)
// ===========================================================================

describe('Suma de extras del catálogo del tenant', () => {
  it('debe_sumar_barbacoa_y_paellero_para_total_1136', async () => {
    // Arrange
    const { motor } = montarMotor();

    // Act
    const out = await motor.calcular(
      inputBase({
        fechaEvento: new Date('2026-09-15'),
        numAdultosNinosMayores4: 40,
        extras: [
          { extraId: EXTRA_BARBACOA, cantidad: 1 },
          { extraId: EXTRA_PAELLERO, cantidad: 1 },
        ],
      }),
      TENANT,
    );

    // Assert: 1076 + (30 + 30) = 1136.
    expect(out.precioTarifaEur).toBe(1076);
    expect(out.extrasTotalEur).toBe(60);
    expect(out.totalEur).toBe(1136);
  });

  it('debe_lanzar_EXTRA_NO_ENCONTRADO_con_motivo_inactivo_cuando_el_extra_esta_inactivo', async () => {
    // Arrange: barbacoa inactiva.
    const extraPort = crearExtraPortFake([
      { idExtra: EXTRA_BARBACOA, tenantId: TENANT, precioEur: 30, activo: false },
    ]);
    const { motor } = montarMotor({ extraPort });

    // Act + Assert
    const promesa = motor.calcular(
      inputBase({ extras: [{ extraId: EXTRA_BARBACOA, cantidad: 1 }] }),
      TENANT,
    );
    await expect(promesa).rejects.toBeInstanceOf(ExtraNoEncontradoError);
    await expect(promesa).rejects.toMatchObject({
      codigo: 'EXTRA_NO_ENCONTRADO',
      extraId: EXTRA_BARBACOA,
      motivo: 'inactivo',
    });
  });

  it('debe_lanzar_EXTRA_NO_ENCONTRADO_para_un_extra_de_otro_tenant_por_RLS', async () => {
    // Arrange: el extra existe pero pertenece a OTRO tenant (no visible por RLS).
    const extraPort = crearExtraPortFake([
      { idExtra: 'extra-de-otro', tenantId: OTRO_TENANT, precioEur: 30, activo: true },
    ]);
    const { motor } = montarMotor({ extraPort });

    // Act + Assert: el tenant actual no lo ve -> EXTRA_NO_ENCONTRADO.
    const promesa = motor.calcular(
      inputBase({ extras: [{ extraId: 'extra-de-otro', cantidad: 1 }] }),
      TENANT,
    );
    await expect(promesa).rejects.toBeInstanceOf(ExtraNoEncontradoError);
    await expect(promesa).rejects.toMatchObject({ codigo: 'EXTRA_NO_ENCONTRADO' });
  });
});

// ===========================================================================
// 5. Esquema de salida canónico unificado (D-1)
//    (spec-delta: scenarios 14-15)
// ===========================================================================

describe('Esquema de salida canónico unificado', () => {
  const CLAVES = [
    'temporada',
    'tarifaAConsultar',
    'precioTarifaEur',
    'extrasTotalEur',
    'totalEur',
    'tarifaId',
  ];

  it('debe_exponer_todos_los_campos_con_valor_en_el_caso_normal', async () => {
    const { motor } = montarMotor();
    const out = await motor.calcular(
      inputBase({ extras: [{ extraId: EXTRA_BARBACOA, cantidad: 1 }] }),
      TENANT,
    );

    expect(Object.keys(out).sort()).toEqual([...CLAVES].sort());
    expect(out.tarifaAConsultar).toBe(false);
    expect(out.temporada).not.toBeNull();
    expect(out.precioTarifaEur).not.toBeNull();
    expect(out.extrasTotalEur).not.toBeNull();
    expect(out.totalEur).not.toBeNull();
    expect(out.tarifaId).not.toBeNull();
  });

  it('debe_mantener_el_mismo_esquema_con_nulos_en_el_caso_a_consultar', async () => {
    const { motor } = montarMotor();
    const out = await motor.calcular(inputBase({ numAdultosNinosMayores4: 55 }), TENANT);

    // Mismo conjunto de claves; temporada presente; los otros 4 a null.
    expect(Object.keys(out).sort()).toEqual([...CLAVES].sort());
    expect(out.temporada).not.toBeNull();
    expect(out.tarifaAConsultar).toBe(true);
    expect(out.precioTarifaEur).toBeNull();
    expect(out.extrasTotalEur).toBeNull();
    expect(out.totalEur).toBeNull();
    expect(out.tarifaId).toBeNull();
  });
});

// ===========================================================================
// 6. Validación de inputs (orden D-5: paso 1, antes de cualquier lookup)
//    (spec-delta: scenarios 16-19)
// ===========================================================================

describe('Validación de inputs del motor', () => {
  it('debe_rechazar_duracion_fuera_de_4_8_12_sin_buscar_tarifa', async () => {
    // Arrange
    const { motor, temporadaPort, tarifaPort } = montarMotor();

    // Act + Assert: duracion=6 -> error de validación y SIN lookups.
    await expect(
      motor.calcular(inputBase({ duracionHoras: 6 }), TENANT),
    ).rejects.toBeInstanceOf(ValidacionTarifaError);
    expect(temporadaPort.resolverTemporada).not.toHaveBeenCalled();
    expect(tarifaPort.buscarVigente).not.toHaveBeenCalled();
  });

  it('debe_rechazar_numero_de_invitados_negativo', async () => {
    const { motor } = montarMotor();
    await expect(
      motor.calcular(inputBase({ numAdultosNinosMayores4: -1 }), TENANT),
    ).rejects.toBeInstanceOf(ValidacionTarifaError);
  });

  it('debe_rechazar_cantidad_de_extra_menor_que_1', async () => {
    // Arrange
    const { motor, temporadaPort, tarifaPort, extraPort } = montarMotor();

    // Act + Assert: cantidad=0 -> error de validación en el paso 1 (sin lookups).
    await expect(
      motor.calcular(
        inputBase({ extras: [{ extraId: EXTRA_BARBACOA, cantidad: 0 }] }),
        TENANT,
      ),
    ).rejects.toBeInstanceOf(ValidacionTarifaError);
    expect(temporadaPort.resolverTemporada).not.toHaveBeenCalled();
    expect(tarifaPort.buscarVigente).not.toHaveBeenCalled();
    expect(extraPort.buscarPorId).not.toHaveBeenCalled();
  });

  it('debe_rechazar_fecha_de_evento_nula', async () => {
    const { motor } = montarMotor();
    await expect(
      motor.calcular(
        inputBase({ fechaEvento: null as unknown as Date }),
        TENANT,
      ),
    ).rejects.toBeInstanceOf(ValidacionTarifaError);
  });

  it('debe_rechazar_fecha_de_evento_pasada', async () => {
    // Arrange: reloj fijo en 2026-06-26; evento ya pasado.
    const { motor } = montarMotor({ clock: relojFijo('2026-06-26T00:00:00.000Z') });

    // Act + Assert
    await expect(
      motor.calcular(inputBase({ fechaEvento: new Date('2020-01-01') }), TENANT),
    ).rejects.toBeInstanceOf(ValidacionTarifaError);
  });
});

// ===========================================================================
// 7. Motor stateless, determinista y de lectura pura
//    (spec-delta: scenario 20)
// ===========================================================================

describe('Motor stateless, determinista y de lectura pura', () => {
  it('debe_producir_el_mismo_output_en_dos_invocaciones_con_los_mismos_inputs', async () => {
    // Arrange
    const { motor } = montarMotor();
    const input = inputBase({
      extras: [
        { extraId: EXTRA_BARBACOA, cantidad: 1 },
        { extraId: EXTRA_PAELLERO, cantidad: 2 },
      ],
    });

    // Act
    const a: CalculoTarifaResultado = await motor.calcular(input, TENANT);
    const b: CalculoTarifaResultado = await motor.calcular(input, TENANT);

    // Assert: determinismo exacto.
    expect(a).toEqual(b);
  });

  it('no_debe_mutar_ninguna_entidad_leida_los_puertos_son_solo_lectura', async () => {
    // Arrange: snapshot de los almacenes antes del cálculo.
    const tarifaPort = crearTarifaPortFake(construirTarifasSeed(TENANT));
    const extraPort = crearExtraPortFake([
      { idExtra: EXTRA_BARBACOA, tenantId: TENANT, precioEur: 30, activo: true },
      { idExtra: EXTRA_PAELLERO, tenantId: TENANT, precioEur: 30, activo: true },
    ]);
    const { motor } = montarMotor({ tarifaPort, extraPort });
    const tarifasAntes = JSON.stringify(tarifaPort.filas);
    const extrasAntes = JSON.stringify(extraPort.filas);

    // Act
    await motor.calcular(
      inputBase({
        extras: [
          { extraId: EXTRA_BARBACOA, cantidad: 1 },
          { extraId: EXTRA_PAELLERO, cantidad: 1 },
        ],
      }),
      TENANT,
    );

    // Assert: ninguna fila modificada (lectura pura) y los puertos solo
    // exponen métodos de lectura (no hay método de escritura disponible).
    expect(JSON.stringify(tarifaPort.filas)).toBe(tarifasAntes);
    expect(JSON.stringify(extraPort.filas)).toBe(extrasAntes);
    expect(Object.keys(tarifaPort)).not.toContain('guardar');
    expect(Object.keys(extraPort)).not.toContain('guardar');
  });
});
