/**
 * TESTS de CONTRATO del nuevo método `listarPorReserva` del `ComunicacionRepositoryPort`
 * y de la proyección de listado `ComunicacionListItem` (US-046 / UC-36; design.md D-3)
 * — fase TDD RED. tasks.md Fase 3: §3.8 (listado por reserva: campos de la ficha;
 * scoped por tenant; no expone otro tenant), §3.9 (multi-tenancy).
 *
 * Trazabilidad: US-046, spec-delta `comunicaciones` Requirement "Listado de las
 * comunicaciones de una RESERVA para la ficha del gestor" (Scenarios: "El gestor lista
 * las comunicaciones de su reserva", "El listado no expone comunicaciones de otro
 * tenant"). design.md D-3 (Opción A): añadir `listarPorReserva({ tenantId, reservaId })`
 * al puerto con la proyección enriquecida `ComunicacionListItem` (+ `asunto`,
 * `codigoEmail`, `estado`, `destinatarioEmail`, `fechaCreacion`, `fechaEnvio`,
 * `esReenvio`, y `accionable` derivado de `estado === 'borrador'`).
 *
 * El puerto es una interfaz PURA: la implementación Prisma (scoping RLS real por
 * tenant + el aislamiento cross-tenant) se verifica contra la BD en el test de
 * INTEGRACIÓN (que debe ejecutar la sesión principal con Postgres). Aquí se fija el
 * CONTRATO de forma con un DOBLE en memoria: el método existe, devuelve la proyección
 * enriquecida y deriva `accionable` de `estado === 'borrador'`.
 *
 * RED: `ComunicacionListItem`, `ListarPorReservaParams` y el método `listarPorReserva`
 * aún NO existen en `comunicacion.repository.port.ts`. Los imports fallan y la batería
 * está en ROJO por AUSENCIA DE IMPLEMENTACIÓN. GREEN es de `backend-developer`.
 */
import type {
  ComunicacionRepositoryPort,
  ComunicacionListItem,
  ListarPorReservaParams,
} from './comunicacion.repository.port';

const TENANT = '00000000-0000-0000-0000-000000000001';
const OTRO_TENANT = '00000000-0000-0000-0000-0000000000ff';
const RESERVA_ID = 'res-1';
const CLIENTE_ID = 'cli-1';
const EMAIL = 'marta.soler@example.com';

// Fila de listado de referencia: una E1 en `borrador` (accionable) y una E2 `enviado`.
const filaBorrador: ComunicacionListItem = {
  idComunicacion: 'com-e1',
  clienteId: CLIENTE_ID,
  codigoEmail: 'E1',
  estado: 'borrador',
  asunto: 'Consulta recibida',
  cuerpo: '<p>Borrador de la consulta recibida</p>',
  destinatarioEmail: EMAIL,
  // historial-completo-comunicaciones (§D-subtipo): el E1 lleva su subtipo semántico.
  subtipo: 'consulta_exploratoria',
  fechaCreacion: new Date('2026-07-15T08:00:00.000Z'),
  fechaEnvio: null,
  esReenvio: false,
  accionable: true,
};

const filaEnviada: ComunicacionListItem = {
  idComunicacion: 'com-e2',
  clienteId: CLIENTE_ID,
  codigoEmail: 'E2',
  estado: 'enviado',
  asunto: 'Presupuesto enviado',
  cuerpo: '<p>Presupuesto enviado</p>',
  destinatarioEmail: EMAIL,
  // E2 no lleva subtipo (`null`): la taxonomía de subtipo solo aplica a E1.
  subtipo: null,
  fechaCreacion: new Date('2026-07-16T09:00:00.000Z'),
  fechaEnvio: new Date('2026-07-16T09:05:00.000Z'),
  esReenvio: false,
  accionable: false,
};

/** Doble en memoria del puerto ampliado con `listarPorReserva` (RLS por tenant). */
const crearRepoFake = (
  filasPorTenantReserva: Record<string, ComunicacionListItem[]>,
): ComunicacionRepositoryPort => ({
  buscarPorReservaYCodigo: async () => null,
  crear: async () => {
    throw new Error('no usado en este test de contrato');
  },
  actualizarEstado: async () => {
    throw new Error('no usado en este test de contrato');
  },
  actualizarContenidoBorrador: async () => {
    throw new Error('no usado en este test de contrato');
  },
  listarPorReserva: async (
    params: ListarPorReservaParams,
  ): Promise<ComunicacionListItem[]> => {
    const clave = `${params.tenantId}::${params.reservaId}`;
    return filasPorTenantReserva[clave] ?? [];
  },
});

// ===========================================================================
// 3.8 — El gestor lista las comunicaciones de su reserva con los campos de la ficha.
// ===========================================================================

describe('ComunicacionRepositoryPort.listarPorReserva — proyección de la ficha (3.8)', () => {
  it('debe_devolver_las_filas_de_la_reserva_con_los_campos_de_la_ficha', async () => {
    const repo = crearRepoFake({
      [`${TENANT}::${RESERVA_ID}`]: [filaBorrador, filaEnviada],
    });

    const filas = await repo.listarPorReserva({
      tenantId: TENANT,
      reservaId: RESERVA_ID,
    });

    expect(filas).toHaveLength(2);
    // Cada fila expone los campos que la ficha necesita (spec-delta).
    const [b] = filas;
    expect(b).toEqual(
      expect.objectContaining({
        idComunicacion: expect.any(String),
        clienteId: expect.any(String),
        codigoEmail: expect.any(String),
        estado: expect.any(String),
        asunto: expect.any(String),
        // El cuerpo real lo precarga el diálogo de revisión del frontend (US-046).
        cuerpo: expect.any(String),
        destinatarioEmail: expect.any(String),
        fechaCreacion: expect.any(Date),
        esReenvio: expect.any(Boolean),
      }),
    );
  });

  it('debe_marcar_accionable_solo_las_filas_en_borrador', async () => {
    const repo = crearRepoFake({
      [`${TENANT}::${RESERVA_ID}`]: [filaBorrador, filaEnviada],
    });

    const filas = await repo.listarPorReserva({
      tenantId: TENANT,
      reservaId: RESERVA_ID,
    });

    const borrador = filas.find((f) => f.estado === 'borrador');
    const enviada = filas.find((f) => f.estado === 'enviado');
    // `accionable` deriva de `estado === 'borrador'` (enviar/descartar).
    expect(borrador?.accionable).toBe(true);
    // Las `enviado`/`fallido` son de solo lectura.
    expect(enviada?.accionable).toBe(false);
  });

  it('debe_conservar_fecha_envio_nula_en_los_borradores_y_no_nula_en_los_enviados', async () => {
    const repo = crearRepoFake({
      [`${TENANT}::${RESERVA_ID}`]: [filaBorrador, filaEnviada],
    });

    const filas = await repo.listarPorReserva({
      tenantId: TENANT,
      reservaId: RESERVA_ID,
    });

    expect(filas.find((f) => f.estado === 'borrador')?.fechaEnvio).toBeNull();
    expect(filas.find((f) => f.estado === 'enviado')?.fechaEnvio).toBeInstanceOf(Date);
  });
});

// ===========================================================================
// 3.8 / 3.9 — El listado NO expone comunicaciones de otro tenant (aislamiento RLS).
// ===========================================================================

describe('ComunicacionRepositoryPort.listarPorReserva — aislamiento por tenant (3.9)', () => {
  it('no_debe_devolver_filas_cuando_la_reserva_es_de_otro_tenant', async () => {
    // Las filas existen bajo OTRO_TENANT; con el tenant del gestor no hay resultado.
    const repo = crearRepoFake({
      [`${OTRO_TENANT}::${RESERVA_ID}`]: [filaBorrador, filaEnviada],
    });

    const filas = await repo.listarPorReserva({
      tenantId: TENANT,
      reservaId: RESERVA_ID,
    });

    expect(filas).toHaveLength(0);
  });
});
