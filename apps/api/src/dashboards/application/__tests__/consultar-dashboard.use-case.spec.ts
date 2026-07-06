/**
 * TESTS del query de APLICACIÓN `ConsultarDashboardUseCase` (US-044 / UC-34,
 * `GET /dashboard`) — fase TDD RED. Ejercita la AGREGACIÓN de los 7 widgets del
 * Dashboard Operativo contra un DOBLE del puerto de lectura (in-memory), sin
 * Prisma (hexagonal, hook `no-infra-in-domain`; design.md §D-4/§D-5).
 *
 * El Dashboard es LECTURA PURA (design.md §D-1/§D-5): NO muta `RESERVA` ni ninguna
 * entidad y NO hay concurrencia crítica. El use-case:
 *   - pasa SIEMPRE el `tenant_id` del comando (del JWT) al puerto (§D-4);
 *   - calcula las ventanas temporales con el reloj inyectado (§D-3): hoy/mañana,
 *     `[hoy, hoy+30d]` inclusive, próximas 24 h, visitas futuras;
 *   - considera únicamente reservas con `activo = true` (§FA-04);
 *   - agrupa/cuenta cada widget devolviendo `{ items, total }`;
 *   - deriva el `color` de cada ítem de `proximos30Dias` REUTILIZANDO la misma
 *     función pura de `calendario` (`derivarColor`, US-039 / §D-2), sin duplicar
 *     el mapa;
 *   - excluye del pipeline los estados TERMINALES (`reserva_completada`,
 *     `reserva_cancelada`, sub-estados 2x/2y/2z).
 *
 * Trazabilidad: US-044, spec-delta `dashboard` (Requirements de los 7 widgets +
 * "Estado vacío independiente por widget" + "Aislamiento multi-tenant y solo
 * reservas activas"), design.md §D-1..§D-5. Contrato congelado `DashboardResponse`
 * { hoyManana, pipeline, subProcesosCriticos, pendientes, consultasEnCola,
 *   visitasProgramadas, proximos30Dias }, cada widget `{ items, total }`;
 * `proximos30Dias` añade `color` por ítem (`ColorCalendario`, US-039).
 *
 * RED: aún NO existe `dashboards/application/consultar-dashboard.use-case.ts`; el
 * import falla y la batería está en ROJO POR AUSENCIA DE IMPLEMENTACIÓN. GREEN es
 * de `backend-developer`.
 */
import {
  ConsultarDashboardUseCase,
  type DashboardQueryPort,
  type DashboardDataset,
  type DashboardReservaLectura,
  type DashboardItem,
  type DashboardItemProximos30Dias,
  type ConsultarDashboardComando,
  type ClockPort,
} from '../consultar-dashboard.use-case';

const TENANT = '00000000-0000-0000-0000-000000000001';
const OTRO_TENANT = '00000000-0000-0000-0000-0000000000ff';

// Reloj fijo: "hoy" = 2026-07-06 (coincide con currentDate del proyecto).
const HOY = new Date('2026-07-06T09:00:00.000Z');
const relojFijo: ClockPort = { ahora: () => HOY };

// Fechas de referencia relativas a HOY.
const HOY_FECHA = '2026-07-06';
const MANANA_FECHA = '2026-07-07';
const PASADO_MANANA = '2026-07-08';
const DIA_30 = '2026-08-05'; // hoy + 30 días (inclusive)
const DIA_31 = '2026-08-06'; // hoy + 31 días (fuera de rango)

// ---------------------------------------------------------------------------
// Doble de una RESERVA de lectura del dataset agregado. El adaptador Prisma real
// ya filtra por tenant + `activo = true`; aquí lo simulamos con flags para poder
// probar la agregación/filtrado del use-case con dobles del puerto.
// ---------------------------------------------------------------------------

const reserva = (
  over: Partial<DashboardReservaLectura> = {},
): DashboardReservaLectura => ({
  reservaId: '11111111-1111-1111-1111-111111111111',
  tenantId: TENANT,
  codigo: 'SLO-2026-0044',
  clienteNombre: 'Ana García',
  estado: 'reserva_confirmada',
  subEstado: null,
  fechaEvento: PASADO_MANANA,
  activo: true,
  preEventoStatus: 'cerrado',
  liquidacionStatus: 'cobrada',
  fianzaStatus: 'cobrada',
  visitaProgramadaFecha: null,
  posicionCola: null,
  fechaCreacion: new Date('2026-07-01T09:00:00.000Z'),
  ...over,
});

const datasetVacio = (): DashboardDataset => ({ reservas: [] });

const construir = (
  agregar: jest.Mock,
  clock: ClockPort = relojFijo,
): ConsultarDashboardUseCase =>
  new ConsultarDashboardUseCase({ dashboard: { agregar }, clock });

const comando = (
  over: Partial<ConsultarDashboardComando> = {},
): ConsultarDashboardComando => ({ tenantId: TENANT, ...over });

// ===========================================================================
// 1. Los 7 widgets con su `total` correcto para un tenant.
// ===========================================================================

describe('ConsultarDashboardUseCase — los 7 widgets del contrato', () => {
  it('debe_devolver_los_7_widgets_del_contrato_cada_uno_con_items_y_total', async () => {
    const agregar = jest.fn().mockResolvedValue(datasetVacio());
    const useCase = construir(agregar);

    const r = await useCase.ejecutar(comando());

    // Los 7 widgets del contrato DashboardResponse (design.md §D-1).
    for (const clave of [
      'hoyManana',
      'pipeline',
      'subProcesosCriticos',
      'pendientes',
      'consultasEnCola',
      'visitasProgramadas',
      'proximos30Dias',
    ] as const) {
      expect(r).toHaveProperty(clave);
      expect(Array.isArray(r[clave].items)).toBe(true);
      expect(typeof r[clave].total).toBe('number');
    }
  });

  it('debe_calcular_el_total_de_cada_widget_como_el_numero_de_sus_items', async () => {
    const dataset: DashboardDataset = {
      reservas: [
        // Dos eventos de hoy/mañana confirmados (hoyManana).
        reserva({ reservaId: 'r-hoy', fechaEvento: HOY_FECHA, estado: 'reserva_confirmada' }),
        reserva({ reservaId: 'r-man', fechaEvento: MANANA_FECHA, estado: 'evento_en_curso' }),
      ],
    };
    const agregar = jest.fn().mockResolvedValue(dataset);
    const useCase = construir(agregar);

    const r = await useCase.ejecutar(comando());

    expect(r.hoyManana.total).toBe(r.hoyManana.items.length);
    expect(r.hoyManana.total).toBe(2);
  });
});

// ===========================================================================
// 2. Solo reservas con `activo = true`.
// ===========================================================================

describe('ConsultarDashboardUseCase — solo reservas activas', () => {
  it('no_debe_incluir_reservas_con_activo_false_en_ningun_widget', async () => {
    const dataset: DashboardDataset = {
      reservas: [
        reserva({ reservaId: 'r-activa', fechaEvento: HOY_FECHA, estado: 'reserva_confirmada', activo: true }),
        reserva({ reservaId: 'r-inactiva', fechaEvento: HOY_FECHA, estado: 'reserva_confirmada', activo: false }),
      ],
    };
    const agregar = jest.fn().mockResolvedValue(dataset);
    const useCase = construir(agregar);

    const r = await useCase.ejecutar(comando());

    const idsHoyManana = r.hoyManana.items.map((i: DashboardItem) => i.reservaId);
    expect(idsHoyManana).toContain('r-activa');
    expect(idsHoyManana).not.toContain('r-inactiva');
    // Tampoco aparece la inactiva en el resto de widgets.
    const idsProx = r.proximos30Dias.items.map((i: DashboardItemProximos30Dias) => i.reservaId);
    expect(idsProx).not.toContain('r-inactiva');
  });
});

// ===========================================================================
// 3. Aislamiento multi-tenant: el tenant del JWT viaja SIEMPRE al puerto.
// ===========================================================================

describe('ConsultarDashboardUseCase — aislamiento multi-tenant (CRÍTICO)', () => {
  it('debe_pasar_SIEMPRE_el_tenant_del_comando_al_puerto_de_lectura', async () => {
    const agregar = jest.fn().mockResolvedValue(datasetVacio());
    const useCase = construir(agregar);

    await useCase.ejecutar(comando({ tenantId: TENANT }));

    expect(agregar).toHaveBeenCalledTimes(1);
    expect(agregar).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: TENANT }),
    );
  });

  it('debe_consultar_con_el_tenant_del_jwt_y_nunca_mezclar_otro_tenant', async () => {
    const agregar = jest.fn().mockResolvedValue(datasetVacio());
    const useCase = construir(agregar);

    await useCase.ejecutar(comando({ tenantId: OTRO_TENANT }));

    const params = agregar.mock.calls[0][0];
    expect(params.tenantId).toBe(OTRO_TENANT);
    expect(params.tenantId).not.toBe(TENANT);
  });

  it('no_debe_exponer_datos_de_otro_tenant_aunque_llegasen_en_el_dataset', async () => {
    // Barrera de defensa en profundidad: si el puerto devolviese por error una fila
    // de otro tenant, el use-case no debe filtrarla a la respuesta del tenant del JWT.
    const dataset: DashboardDataset = {
      reservas: [
        reserva({ reservaId: 'r-mio', fechaEvento: HOY_FECHA, tenantId: TENANT }),
        reserva({ reservaId: 'r-ajeno', fechaEvento: HOY_FECHA, tenantId: OTRO_TENANT }),
      ],
    };
    const agregar = jest.fn().mockResolvedValue(dataset);
    const useCase = construir(agregar);

    const r = await useCase.ejecutar(comando({ tenantId: TENANT }));

    const ids = r.hoyManana.items.map((i: DashboardItem) => i.reservaId);
    expect(ids).toContain('r-mio');
    expect(ids).not.toContain('r-ajeno');
  });
});

// ===========================================================================
// 4. Widget "Hoy y mañana": solo fecha_evento = hoy o mañana en
//    reserva_confirmada / evento_en_curso, ordenadas por fecha_evento asc.
// ===========================================================================

describe('ConsultarDashboardUseCase — widget hoyManana', () => {
  it('debe_incluir_solo_reservas_con_fecha_evento_hoy_o_manana', async () => {
    const dataset: DashboardDataset = {
      reservas: [
        reserva({ reservaId: 'r-hoy', fechaEvento: HOY_FECHA, estado: 'reserva_confirmada' }),
        reserva({ reservaId: 'r-man', fechaEvento: MANANA_FECHA, estado: 'reserva_confirmada' }),
        reserva({ reservaId: 'r-pasado', fechaEvento: PASADO_MANANA, estado: 'reserva_confirmada' }),
      ],
    };
    const useCase = construir(jest.fn().mockResolvedValue(dataset));

    const r = await useCase.ejecutar(comando());

    const ids = r.hoyManana.items.map((i: DashboardItem) => i.reservaId);
    expect(ids).toEqual(expect.arrayContaining(['r-hoy', 'r-man']));
    expect(ids).not.toContain('r-pasado');
    expect(r.hoyManana.total).toBe(2);
  });

  it('debe_excluir_reservas_de_hoy_manana_que_no_esten_confirmadas_ni_en_curso', async () => {
    const dataset: DashboardDataset = {
      reservas: [
        reserva({ reservaId: 'r-conf', fechaEvento: HOY_FECHA, estado: 'reserva_confirmada' }),
        reserva({ reservaId: 'r-prerreserva', fechaEvento: HOY_FECHA, estado: 'pre_reserva' }),
      ],
    };
    const useCase = construir(jest.fn().mockResolvedValue(dataset));

    const r = await useCase.ejecutar(comando());

    const ids = r.hoyManana.items.map((i: DashboardItem) => i.reservaId);
    expect(ids).toContain('r-conf');
    expect(ids).not.toContain('r-prerreserva');
  });

  it('debe_ordenar_hoyManana_por_fecha_evento_ascendente', async () => {
    const dataset: DashboardDataset = {
      reservas: [
        reserva({ reservaId: 'r-man', fechaEvento: MANANA_FECHA, estado: 'reserva_confirmada' }),
        reserva({ reservaId: 'r-hoy', fechaEvento: HOY_FECHA, estado: 'evento_en_curso' }),
      ],
    };
    const useCase = construir(jest.fn().mockResolvedValue(dataset));

    const r = await useCase.ejecutar(comando());

    expect(r.hoyManana.items.map((i: DashboardItem) => i.reservaId)).toEqual(['r-hoy', 'r-man']);
  });
});

// ===========================================================================
// 5. Widget "Próximos 30 días": rango [hoy, hoy+30] inclusive y `color`
//    derivado del estado con la MISMA función que el Calendario (US-039).
// ===========================================================================

describe('ConsultarDashboardUseCase — widget proximos30Dias', () => {
  it('debe_incluir_las_fechas_del_rango_hoy_hasta_hoy_mas_30_inclusive_y_excluir_el_dia_31', async () => {
    const dataset: DashboardDataset = {
      reservas: [
        reserva({ reservaId: 'r-hoy', fechaEvento: HOY_FECHA, estado: 'reserva_confirmada' }),
        reserva({ reservaId: 'r-dia30', fechaEvento: DIA_30, estado: 'pre_reserva' }),
        reserva({ reservaId: 'r-dia31', fechaEvento: DIA_31, estado: 'reserva_confirmada' }),
      ],
    };
    const useCase = construir(jest.fn().mockResolvedValue(dataset));

    const r = await useCase.ejecutar(comando());

    const ids = r.proximos30Dias.items.map((i: DashboardItemProximos30Dias) => i.reservaId);
    expect(ids).toEqual(expect.arrayContaining(['r-hoy', 'r-dia30']));
    expect(ids).not.toContain('r-dia31');
  });

  it('debe_derivar_color_verde_para_reserva_confirmada_igual_que_el_Calendario', async () => {
    const dataset: DashboardDataset = {
      reservas: [reserva({ reservaId: 'r-conf', fechaEvento: HOY_FECHA, estado: 'reserva_confirmada', subEstado: null })],
    };
    const useCase = construir(jest.fn().mockResolvedValue(dataset));

    const r = await useCase.ejecutar(comando());

    expect(r.proximos30Dias.items[0].color).toBe('verde');
  });

  it('debe_derivar_color_ambar_para_pre_reserva_y_gris_para_consulta_activa_2b', async () => {
    const dataset: DashboardDataset = {
      reservas: [
        reserva({ reservaId: 'r-pre', fechaEvento: MANANA_FECHA, estado: 'pre_reserva', subEstado: null }),
        reserva({ reservaId: 'r-2b', fechaEvento: PASADO_MANANA, estado: 'consulta', subEstado: '2b' }),
      ],
    };
    const useCase = construir(jest.fn().mockResolvedValue(dataset));

    const r = await useCase.ejecutar(comando());

    const porId = new Map(r.proximos30Dias.items.map((i: DashboardItemProximos30Dias) => [i.reservaId, i.color]));
    expect(porId.get('r-pre')).toBe('ambar');
    expect(porId.get('r-2b')).toBe('gris');
  });

  it('debe_asignar_el_campo_color_a_todos_los_items_de_proximos30Dias', async () => {
    const dataset: DashboardDataset = {
      reservas: [
        reserva({ reservaId: 'r-a', fechaEvento: HOY_FECHA, estado: 'reserva_confirmada' }),
        reserva({ reservaId: 'r-b', fechaEvento: MANANA_FECHA, estado: 'pre_reserva' }),
      ],
    };
    const useCase = construir(jest.fn().mockResolvedValue(dataset));

    const r = await useCase.ejecutar(comando());

    for (const item of r.proximos30Dias.items) {
      expect(item.color).toBeDefined();
      expect(['gris', 'ambar', 'verde', 'azul', 'rojo']).toContain(item.color);
    }
  });
});

// ===========================================================================
// 6. Widget "Pipeline": agrupa reservas activas y EXCLUYE terminales
//    (reserva_completada, reserva_cancelada, sub-estados 2x/2y/2z).
// ===========================================================================

describe('ConsultarDashboardUseCase — widget pipeline (excluye terminales)', () => {
  it('debe_incluir_en_el_pipeline_los_estados_no_terminales_activos', async () => {
    const dataset: DashboardDataset = {
      reservas: [
        reserva({ reservaId: 'r-2a', estado: 'consulta', subEstado: '2a', fechaEvento: PASADO_MANANA }),
        reserva({ reservaId: 'r-2b', estado: 'consulta', subEstado: '2b', fechaEvento: PASADO_MANANA }),
        reserva({ reservaId: 'r-2c', estado: 'consulta', subEstado: '2c', fechaEvento: PASADO_MANANA }),
        reserva({ reservaId: 'r-2d', estado: 'consulta', subEstado: '2d', fechaEvento: PASADO_MANANA }),
        reserva({ reservaId: 'r-2v', estado: 'consulta', subEstado: '2v', fechaEvento: PASADO_MANANA }),
        reserva({ reservaId: 'r-pre', estado: 'pre_reserva', subEstado: null, fechaEvento: PASADO_MANANA }),
        reserva({ reservaId: 'r-conf', estado: 'reserva_confirmada', subEstado: null, fechaEvento: PASADO_MANANA }),
      ],
    };
    const useCase = construir(jest.fn().mockResolvedValue(dataset));

    const r = await useCase.ejecutar(comando());

    const ids = r.pipeline.items.map((i: DashboardItem) => i.reservaId);
    expect(ids).toEqual(
      expect.arrayContaining(['r-2a', 'r-2b', 'r-2c', 'r-2d', 'r-2v', 'r-pre', 'r-conf']),
    );
    expect(r.pipeline.total).toBe(7);
  });

  it('debe_excluir_del_pipeline_los_estados_terminales_completada_y_cancelada', async () => {
    const dataset: DashboardDataset = {
      reservas: [
        reserva({ reservaId: 'r-conf', estado: 'reserva_confirmada', subEstado: null, fechaEvento: PASADO_MANANA }),
        reserva({ reservaId: 'r-completada', estado: 'reserva_completada', subEstado: null, fechaEvento: PASADO_MANANA }),
        reserva({ reservaId: 'r-cancelada', estado: 'reserva_cancelada', subEstado: null, fechaEvento: PASADO_MANANA }),
      ],
    };
    const useCase = construir(jest.fn().mockResolvedValue(dataset));

    const r = await useCase.ejecutar(comando());

    const ids = r.pipeline.items.map((i: DashboardItem) => i.reservaId);
    expect(ids).toContain('r-conf');
    expect(ids).not.toContain('r-completada');
    expect(ids).not.toContain('r-cancelada');
  });

  it('debe_excluir_del_pipeline_los_sub_estados_terminales_2x_2y_2z', async () => {
    const dataset: DashboardDataset = {
      reservas: [
        reserva({ reservaId: 'r-2a', estado: 'consulta', subEstado: '2a', fechaEvento: PASADO_MANANA }),
        reserva({ reservaId: 'r-2x', estado: 'consulta', subEstado: '2x', fechaEvento: PASADO_MANANA }),
        reserva({ reservaId: 'r-2y', estado: 'consulta', subEstado: '2y', fechaEvento: PASADO_MANANA }),
        reserva({ reservaId: 'r-2z', estado: 'consulta', subEstado: '2z', fechaEvento: PASADO_MANANA }),
      ],
    };
    const useCase = construir(jest.fn().mockResolvedValue(dataset));

    const r = await useCase.ejecutar(comando());

    const ids = r.pipeline.items.map((i: DashboardItem) => i.reservaId);
    expect(ids).toContain('r-2a');
    expect(ids).not.toContain('r-2x');
    expect(ids).not.toContain('r-2y');
    expect(ids).not.toContain('r-2z');
  });
});

// ===========================================================================
// 7. Estado vacío: sin reservas, todos los widgets total=0 e items=[].
// ===========================================================================

describe('ConsultarDashboardUseCase — estado vacío independiente por widget', () => {
  it('debe_devolver_total_0_e_items_vacio_en_los_7_widgets_cuando_no_hay_reservas', async () => {
    const agregar = jest.fn().mockResolvedValue(datasetVacio());
    const useCase = construir(agregar);

    const r = await useCase.ejecutar(comando());

    for (const clave of [
      'hoyManana',
      'pipeline',
      'subProcesosCriticos',
      'pendientes',
      'consultasEnCola',
      'visitasProgramadas',
      'proximos30Dias',
    ] as const) {
      expect(r[clave].items).toEqual([]);
      expect(r[clave].total).toBe(0);
    }
  });
});

// ===========================================================================
// No-mutación (lectura pura, design.md §D-5): el use-case solo invoca lectura.
// ===========================================================================

describe('ConsultarDashboardUseCase — no-mutación (lectura pura)', () => {
  it('debe_invocar_solo_el_metodo_de_lectura_del_puerto_sin_escribir', async () => {
    const agregar = jest.fn().mockResolvedValue(datasetVacio());
    const escribirEspia = jest.fn();
    const puerto = { agregar } as unknown as DashboardQueryPort & Record<string, unknown>;
    (puerto as Record<string, unknown>).guardar = escribirEspia;
    (puerto as Record<string, unknown>).actualizar = escribirEspia;

    const useCase = new ConsultarDashboardUseCase({ dashboard: puerto, clock: relojFijo });
    await useCase.ejecutar(comando());

    expect(agregar).toHaveBeenCalledTimes(1);
    expect(escribirEspia).not.toHaveBeenCalled();
  });
});
