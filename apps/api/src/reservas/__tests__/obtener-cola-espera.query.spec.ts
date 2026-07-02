/**
 * TESTS DE APLICACIÓN del query `ObtenerColaEsperaUseCase` (US-017 / UC-11, actor
 * Gestor, vista de SOLO LECTURA) — fase TDD RED. tasks.md Fase 3: 3.2 (proyección del
 * read model: bloqueante 2b/2c/2v + cola ordenada), 3.4 (los 5 FA), 3.5 (aislamiento
 * multi-tenant).
 *
 * Trazabilidad: US-017, spec-delta `consultas` (Requirements: visualización cola
 * bloqueante+FIFO; ordenación FIFO estricta ASC por posicion_cola; bloqueante 2c/2v
 * con visitaProgramadaFecha; FA-01 sin cola; FA-04 fecha disponible; FA-05 cola de 1;
 * aislamiento multi-tenant RLS); design.md §D-2 (read model ColaEsperaLectura →
 * ColaEsperaResponse), §D-3 (FA-04: 200 con estaBloqueada:false / bloqueante:null /
 * cola:[]; 404 solo para reserva inexistente/otro tenant), §D-6 (clon de
 * ObtenerReservaUseCase: recibe {tenantId, reservaId}, invoca el puerto; null → no
 * encontrada), §D-7 (sin concurrencia ni máquina de estados: lectura pura).
 * Contrato: `docs/api-spec.yml` `GET /reservas/{id}/cola`, schemas `ColaEsperaResponse`
 * / `ColaBloqueante` / `ColaItem`.
 *
 * APLICACIÓN AISLADA (skill `tdd-core`, hexagonal): se ejercita el caso de uso contra
 * un DOBLE del puerto de lectura (`ColaEsperaQueryPort`, in-memory), SIN Prisma ni BD.
 * El puerto encapsula la proyección real (filtro s2d + consulta_bloqueante_id, ORDER BY
 * posicion_cola ASC, derivación temporal sobre instantes, RLS por tenant); aquí se
 * verifica el CONTRATO del caso de uso: delega con {tenantId, reservaId}, devuelve el
 * read model tal cual, y trata `null` como no encontrada (→ 404). El filtrado/orden/RLS
 * REALES se verifican en integración (`obtener-cola-espera-integracion.spec.ts`).
 *
 * NO hay tests de concurrencia ni de transición de estado (design.md §D-7).
 *
 * RED: aún NO existe `application/obtener-cola-espera.query.ts` ni sus puertos/tipos.
 * Los imports fallan y la batería está en ROJO por AUSENCIA DE IMPLEMENTACIÓN. GREEN
 * es de `backend-developer`.
 */
import {
  ObtenerColaEsperaUseCase,
  ColaEsperaNoEncontradaError,
  type ColaEsperaLectura,
  type ColaEsperaQueryPort,
} from '../application/obtener-cola-espera.query';

const TENANT = '00000000-0000-0000-0000-000000000001';
const OTRO_TENANT = '00000000-0000-0000-0000-0000000000ff';
const R1 = '11111111-1111-1111-1111-111111111111'; // bloqueante
const R2 = '22222222-2222-2222-2222-222222222222'; // cola pos 1
const R3 = '33333333-3333-3333-3333-333333333333'; // cola pos 2

/** Read model típico: bloqueante 2b + dos en cola (pos 1 y 2), FIFO ya ordenada. */
const lecturaHappy = (): ColaEsperaLectura => ({
  estaBloqueada: true,
  bloqueante: {
    idReserva: R1,
    codigo: 'SLO-2026-0007',
    clienteNombre: 'Ana García',
    subEstado: '2b',
    ttlExpiracion: new Date('2026-09-13T10:00:00.000Z'),
    ttlRestante: '22 h',
    visitaProgramadaFecha: null,
  },
  cola: [
    {
      idReserva: R2,
      codigo: 'SLO-2026-0008',
      clienteNombre: 'Luis Pérez',
      posicionCola: 1,
      fechaCreacion: new Date('2026-09-12T10:00:00.000Z'),
      tiempoEnCola: '2 h',
    },
    {
      idReserva: R3,
      codigo: 'SLO-2026-0009',
      clienteNombre: 'Marta Ruiz',
      posicionCola: 2,
      fechaCreacion: new Date('2026-09-12T11:30:00.000Z'),
      tiempoEnCola: '30 min',
    },
  ],
});

const construir = (
  buscarCola: ColaEsperaQueryPort['buscarCola'],
): ObtenerColaEsperaUseCase =>
  new ObtenerColaEsperaUseCase({ colaEspera: { buscarCola } });

// ===========================================================================
// Happy path del spec — bloqueante 2b + R2 pos1 (≈2 h) + R3 pos2 (≈30 min), TTL ≈22 h.
//   spec-delta: "Fecha con bloqueante en 2.b y dos consultas en cola".
// ===========================================================================

describe('ObtenerColaEsperaUseCase — happy path (bloqueante 2b + cola de 2)', () => {
  it('debe_delegar_en_el_puerto_con_el_tenant_y_el_id_de_la_bloqueante', async () => {
    const buscarCola = jest.fn().mockResolvedValue(lecturaHappy());
    const useCase = construir(buscarCola);

    await useCase.ejecutar({ tenantId: TENANT, reservaId: R1 });

    expect(buscarCola).toHaveBeenCalledWith({ tenantId: TENANT, reservaId: R1 });
  });

  it('debe_proyectar_la_seccion_bloqueante_con_cliente_subEstado_ttl_y_codigo', async () => {
    const useCase = construir(jest.fn().mockResolvedValue(lecturaHappy()));

    const resultado = await useCase.ejecutar({ tenantId: TENANT, reservaId: R1 });

    expect(resultado.estaBloqueada).toBe(true);
    expect(resultado.bloqueante?.idReserva).toBe(R1);
    expect(resultado.bloqueante?.codigo).toBe('SLO-2026-0007');
    expect(resultado.bloqueante?.clienteNombre).toBe('Ana García');
    expect(resultado.bloqueante?.subEstado).toBe('2b');
    expect(resultado.bloqueante?.ttlRestante).toBe('22 h');
  });

  it('debe_devolver_la_cola_en_orden_FIFO_ascendente_por_posicion_con_tiempo_en_cola', async () => {
    const useCase = construir(jest.fn().mockResolvedValue(lecturaHappy()));

    const resultado = await useCase.ejecutar({ tenantId: TENANT, reservaId: R1 });

    expect(resultado.cola.map((c) => c.posicionCola)).toEqual([1, 2]);
    expect(resultado.cola[0].idReserva).toBe(R2);
    expect(resultado.cola[0].tiempoEnCola).toBe('2 h');
    expect(resultado.cola[1].idReserva).toBe(R3);
    expect(resultado.cola[1].tiempoEnCola).toBe('30 min');
  });

  it('debe_exponer_el_idReserva_de_cada_elemento_para_enlazar_a_su_ficha', async () => {
    // spec-delta: "Cada elemento de la cola enlaza a su ficha (GET /reservas/{id})".
    const useCase = construir(jest.fn().mockResolvedValue(lecturaHappy()));

    const resultado = await useCase.ejecutar({ tenantId: TENANT, reservaId: R1 });

    expect(resultado.bloqueante?.idReserva).toBe(R1);
    expect(resultado.cola.map((c) => c.idReserva)).toEqual([R2, R3]);
  });
});

// ===========================================================================
// FA-01 — bloqueante con cola VACÍA: sección bloqueante presente, cola:[].
//   spec-delta: "FA-01 — bloqueante sin cola" → "Sin consultas en espera para esta fecha".
// ===========================================================================

describe('ObtenerColaEsperaUseCase — FA-01 bloqueante sin cola', () => {
  it('debe_devolver_la_bloqueante_y_una_cola_vacia', async () => {
    const lectura: ColaEsperaLectura = {
      ...lecturaHappy(),
      cola: [],
    };
    const useCase = construir(jest.fn().mockResolvedValue(lectura));

    const resultado = await useCase.ejecutar({ tenantId: TENANT, reservaId: R1 });

    expect(resultado.estaBloqueada).toBe(true);
    expect(resultado.bloqueante?.idReserva).toBe(R1);
    expect(resultado.cola).toEqual([]);
  });
});

// ===========================================================================
// FA-02 — bloqueante en sub_estado 2.c (pendiente de invitados) con TTL vigente.
//   spec-delta: "FA-02 — bloqueante en 2.c con una consulta en cola".
// ===========================================================================

describe('ObtenerColaEsperaUseCase — FA-02 bloqueante en 2c', () => {
  it('debe_proyectar_subEstado_2c_con_su_ttl_y_la_cola_con_el_mismo_formato', async () => {
    const lectura: ColaEsperaLectura = {
      ...lecturaHappy(),
      bloqueante: {
        ...lecturaHappy().bloqueante!,
        subEstado: '2c',
        ttlRestante: '22 h',
        visitaProgramadaFecha: null,
      },
      cola: [lecturaHappy().cola[0]],
    };
    const useCase = construir(jest.fn().mockResolvedValue(lectura));

    const resultado = await useCase.ejecutar({ tenantId: TENANT, reservaId: R1 });

    expect(resultado.bloqueante?.subEstado).toBe('2c');
    expect(resultado.bloqueante?.ttlRestante).toBe('22 h');
    expect(resultado.bloqueante?.visitaProgramadaFecha).toBeNull();
    expect(resultado.cola).toHaveLength(1);
    expect(resultado.cola[0].posicionCola).toBe(1);
  });
});

// ===========================================================================
// FA-03 — bloqueante en sub_estado 2.v (visita programada): incluye
//   visitaProgramadaFecha + TTL vigente.
//   spec-delta: "FA-03 — bloqueante en 2.v con visita programada".
// ===========================================================================

describe('ObtenerColaEsperaUseCase — FA-03 bloqueante en 2v con visita', () => {
  it('debe_incluir_visitaProgramadaFecha_y_ttl_vigente_cuando_esta_en_2v', async () => {
    const visita = new Date('2026-09-10T00:00:00.000Z');
    const lectura: ColaEsperaLectura = {
      ...lecturaHappy(),
      bloqueante: {
        ...lecturaHappy().bloqueante!,
        subEstado: '2v',
        ttlRestante: '22 h',
        visitaProgramadaFecha: visita,
      },
    };
    const useCase = construir(jest.fn().mockResolvedValue(lectura));

    const resultado = await useCase.ejecutar({ tenantId: TENANT, reservaId: R1 });

    expect(resultado.bloqueante?.subEstado).toBe('2v');
    expect(resultado.bloqueante?.visitaProgramadaFecha).toEqual(visita);
    expect(resultado.bloqueante?.ttlRestante).toBe('22 h');
    // La cola se proyecta con el mismo formato en cualquier sub_estado.
    expect(resultado.cola.map((c) => c.posicionCola)).toEqual([1, 2]);
  });
});

// ===========================================================================
// FA-04 — la reserva NO bloquea ninguna fecha activa: 200 con estaBloqueada:false,
//   bloqueante:null, cola:[] (decisión de contrato D-3). NO es 404.
//   spec-delta: "FA-04 — la reserva no bloquea ninguna fecha activa".
// ===========================================================================

describe('ObtenerColaEsperaUseCase — FA-04 reserva sin FECHA_BLOQUEADA (fecha disponible)', () => {
  it('debe_devolver_estaBloqueada_false_bloqueante_null_y_cola_vacia_sin_lanzar_404', async () => {
    const disponible: ColaEsperaLectura = {
      estaBloqueada: false,
      bloqueante: null,
      cola: [],
    };
    const useCase = construir(jest.fn().mockResolvedValue(disponible));

    const resultado = await useCase.ejecutar({ tenantId: TENANT, reservaId: R1 });

    expect(resultado.estaBloqueada).toBe(false);
    expect(resultado.bloqueante).toBeNull();
    expect(resultado.cola).toEqual([]);
  });

  it('debe_lanzar_ColaEsperaNoEncontrada_cuando_el_puerto_devuelve_null_reserva_inexistente_u_otro_tenant', async () => {
    // 404 se reserva EXCLUSIVAMENTE para reserva inexistente / de otro tenant (RLS).
    const useCase = construir(jest.fn().mockResolvedValue(null));

    await expect(
      useCase.ejecutar({ tenantId: TENANT, reservaId: R1 }),
    ).rejects.toBeInstanceOf(ColaEsperaNoEncontradaError);
  });
});

// ===========================================================================
// FA-05 — cola con un ÚNICO elemento (posicion 1).
//   spec-delta: "FA-05 — cola de un único elemento".
// ===========================================================================

describe('ObtenerColaEsperaUseCase — FA-05 cola de un único elemento', () => {
  it('debe_proyectar_la_bloqueante_y_exactamente_un_elemento_en_posicion_1', async () => {
    const lectura: ColaEsperaLectura = {
      ...lecturaHappy(),
      cola: [lecturaHappy().cola[0]],
    };
    const useCase = construir(jest.fn().mockResolvedValue(lectura));

    const resultado = await useCase.ejecutar({ tenantId: TENANT, reservaId: R1 });

    expect(resultado.bloqueante?.idReserva).toBe(R1);
    expect(resultado.cola).toHaveLength(1);
    expect(resultado.cola[0].posicionCola).toBe(1);
    expect(resultado.cola[0].idReserva).toBe(R2);
  });
});

// ===========================================================================
// Aislamiento multi-tenant (RLS, D-7): el caso de uso propaga SIEMPRE el tenant del
// comando al puerto; la resolución de la invisibilidad cross-tenant vive en el
// adaptador (→ null → 404), verificada en integración.
//   spec-delta: "La cola de otro tenant no es alcanzable".
// ===========================================================================

describe('ObtenerColaEsperaUseCase — aislamiento multi-tenant (RLS)', () => {
  it('debe_pasar_al_puerto_el_tenant_recibido_en_el_comando', async () => {
    const buscarCola = jest.fn().mockResolvedValue(null);
    const useCase = construir(buscarCola);

    await expect(
      useCase.ejecutar({ tenantId: OTRO_TENANT, reservaId: R1 }),
    ).rejects.toBeInstanceOf(ColaEsperaNoEncontradaError);
    expect(buscarCola).toHaveBeenCalledWith({ tenantId: OTRO_TENANT, reservaId: R1 });
  });
});
