/**
 * TESTS RED (US-042 / UC-32) del query `ListarHistoricoUseCase` — histórico de reservas
 * CERRADAS del tenant (`GET /historico` → `ReservaHistoricoListResponse`).
 *
 * Ejercita la APLICACIÓN contra un DOBLE del puerto de lectura (in-memory), SIN Prisma
 * (hexagonal) y SIN tests de concurrencia (lectura pura sobre estados terminales e
 * inmutables: no hay bloqueo atómico ni mutación — design.md §D-6). El use-case:
 *   - delega en el puerto la consulta del CONJUNTO CERRADO del tenant (aislamiento por
 *     `tenant_id`, filtro base de estado cerrado, orden por `fechaEvento` DESC, filtros
 *     estructurados de query y full-text los aplica el adaptador → aquí se verifica vía
 *     los args pasados al puerto y el read-model devuelto),
 *   - normaliza `estadoFinal`: AUSENTE ⇒ solo `reserva_completada`; opt-in explícito de
 *     `reserva_cancelada`; NUNCA devuelve estados activos ni terminales de consulta,
 *   - PROYECTA cada RESERVA cerrada a la fila LIGERA del contrato `ReservaHistorico`
 *     (`idReserva`, `codigo`, `clienteId`, `clienteNombre`, `clienteApellidos`, `estado`,
 *     `fechaEvento`, `tipoEvento`, `importeTotal`) — SIN los derivados del pipeline
 *     (`progressLogistica`/`progressLiquidacion`) ni los transitorios de consulta/cola,
 *   - envuelve la lista en `{ data, metadata }` (`ReservaHistoricoListResponse`),
 *   - NO invoca ningún método de escritura (no-mutación).
 *
 * Escritos ANTES que la implementación: deben quedar en ROJO porque
 * `../application/listar-historico.use-case` todavía NO existe. El GREEN es de
 * `backend-developer`.
 */
import {
  ListarHistoricoUseCase,
  type ListarHistoricoComando,
  type HistoricoQueryPort,
  type HistoricoReservaLectura,
  type HistoricoPaginaLectura,
} from '../application/listar-historico.use-case';

const TENANT = '00000000-0000-0000-0000-000000000001';
const OTRO_TENANT = '00000000-0000-0000-0000-000000000002';

/** Fabrica una fila de read-model de RESERVA CERRADA con overrides. */
const filaCerrada = (
  over: Partial<HistoricoReservaLectura> = {},
): HistoricoReservaLectura => ({
  idReserva: '11111111-1111-1111-1111-111111111111',
  codigo: 'SLO-2026-0001',
  clienteId: 'cli-1',
  clienteNombre: 'Ana',
  clienteApellidos: 'García López',
  estado: 'reserva_completada',
  fechaEvento: new Date('2026-05-20T00:00:00.000Z'),
  tipoEvento: 'boda',
  importeTotal: '12000.00',
  ...over,
});

/** Envuelve un array de filas en la página de lectura del puerto (metadata derivada). */
const pagina = (
  filas: HistoricoReservaLectura[],
  over: Partial<HistoricoPaginaLectura> = {},
): HistoricoPaginaLectura => ({
  items: filas,
  total: filas.length,
  page: 1,
  limit: 20,
  ...over,
});

/**
 * Doble del puerto: `listarCerradas` mockeado. El puerto de lectura del histórico solo
 * expone `listarCerradas` (no-mutación).
 */
const construir = (
  listarCerradas: jest.Mock,
): {
  useCase: ListarHistoricoUseCase;
  puerto: HistoricoQueryPort & jest.Mocked<HistoricoQueryPort>;
} => {
  const puerto = { listarCerradas } as unknown as HistoricoQueryPort &
    jest.Mocked<HistoricoQueryPort>;
  return { useCase: new ListarHistoricoUseCase({ historico: puerto }), puerto };
};

const comando = (
  over: Partial<ListarHistoricoComando> = {},
): ListarHistoricoComando => ({
  tenantId: TENANT,
  page: 1,
  limit: 20,
  ...over,
});

describe('ListarHistoricoUseCase — histórico de reservas cerradas (US-042)', () => {
  // 1 — lista vacía
  it('debe_devolver_data_vacia_y_metadata_cero_cuando_el_tenant_no_tiene_historico', async () => {
    // Arrange
    const listarCerradas = jest.fn().mockResolvedValue(pagina([], { total: 0 }));
    const { useCase } = construir(listarCerradas);

    // Act
    const resultado = await useCase.ejecutar(comando());

    // Assert
    expect(resultado.data).toEqual([]);
    expect(resultado.metadata.total).toBe(0);
    expect(resultado.metadata.page).toBe(1);
    expect(resultado.metadata.limit).toBe(20);
    expect(resultado.metadata.totalPages).toBe(0);
  });

  // 2 — filtro por defecto: solo reserva_completada (estadoFinal ausente)
  it('debe_pedir_al_puerto_solo_reserva_completada_cuando_no_se_pasa_estadoFinal', async () => {
    // Arrange
    const listarCerradas = jest
      .fn()
      .mockResolvedValue(pagina([filaCerrada({ estado: 'reserva_completada' })], { total: 1 }));
    const { useCase } = construir(listarCerradas);

    // Act
    const resultado = await useCase.ejecutar(comando());

    // Assert: sin estadoFinal en el comando, el puerto recibe el filtro base
    // 'reserva_completada' (opt-in de canceladas NO activado).
    expect(listarCerradas).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: TENANT, estadoFinal: 'reserva_completada' }),
    );
    expect(resultado.data.every((r) => r.estado === 'reserva_completada')).toBe(true);
  });

  // 3 — opt-in explícito de canceladas
  it('debe_propagar_estadoFinal_reserva_cancelada_al_puerto_cuando_se_solicita_opt_in', async () => {
    // Arrange
    const listarCerradas = jest
      .fn()
      .mockResolvedValue(pagina([filaCerrada({ estado: 'reserva_cancelada' })], { total: 1 }));
    const { useCase } = construir(listarCerradas);

    // Act
    const resultado = await useCase.ejecutar(comando({ estadoFinal: 'reserva_cancelada' }));

    // Assert
    expect(listarCerradas).toHaveBeenCalledWith(
      expect.objectContaining({ estadoFinal: 'reserva_cancelada' }),
    );
    expect(resultado.data.every((r) => r.estado === 'reserva_cancelada')).toBe(true);
  });

  // 4 — NUNCA devuelve estados activos ni terminales de consulta
  it('debe_devolver_solo_estados_cerrados_y_nunca_activos_ni_terminales_de_consulta', async () => {
    // Arrange: el adaptador (puerto) solo devuelve cerradas.
    const listarCerradas = jest.fn().mockResolvedValue(
      pagina(
        [
          filaCerrada({ idReserva: 'r-comp', estado: 'reserva_completada' }),
          filaCerrada({ idReserva: 'r-canc', estado: 'reserva_cancelada' }),
        ],
        { total: 2 },
      ),
    );
    const { useCase } = construir(listarCerradas);

    // Act
    const resultado = await useCase.ejecutar(comando({ estadoFinal: 'reserva_cancelada' }));

    // Assert: ningún estado activo ni terminal de consulta se cuela.
    const estados = resultado.data.map((r) => r.estado);
    for (const activo of [
      'consulta',
      'pre_reserva',
      'reserva_confirmada',
      'evento_en_curso',
      'post_evento',
    ]) {
      expect(estados).not.toContain(activo);
    }
    expect(estados.every((e) => e === 'reserva_completada' || e === 'reserva_cancelada')).toBe(
      true,
    );
  });

  // 5 — aislamiento multi-tenant: el tenant del comando (JWT) viaja SIEMPRE al puerto
  it('debe_propagar_el_tenantId_del_comando_al_puerto_y_no_usar_otro_tenant', async () => {
    // Arrange
    const listarCerradas = jest
      .fn()
      .mockResolvedValue(pagina([filaCerrada({ idReserva: 'r-t1' })], { total: 1 }));
    const { useCase } = construir(listarCerradas);

    // Act
    const resultado = await useCase.ejecutar(comando({ tenantId: TENANT }));

    // Assert
    expect(listarCerradas).toHaveBeenCalledWith(expect.objectContaining({ tenantId: TENANT }));
    expect(listarCerradas).not.toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: OTRO_TENANT }),
    );
    expect(resultado.data).toHaveLength(1);
  });

  // 6 — filtros estructurados combinables con AND: viajan TODOS al puerto
  it('debe_propagar_todos_los_filtros_estructurados_y_full_text_al_puerto_en_combinacion_AND', async () => {
    // Arrange
    const listarCerradas = jest.fn().mockResolvedValue(pagina([filaCerrada()], { total: 1 }));
    const { useCase } = construir(listarCerradas);
    const fechaDesde = new Date('2026-01-01T00:00:00.000Z');
    const fechaHasta = new Date('2026-03-31T00:00:00.000Z');

    // Act
    await useCase.ejecutar(
      comando({
        q: 'García',
        estadoFinal: 'reserva_completada',
        fechaDesde,
        fechaHasta,
        tipoEvento: 'boda',
        importeMin: '1000.00',
        importeMax: '20000.00',
      }),
    );

    // Assert: el puerto recibe TODOS los filtros (se combinan con AND en el adaptador).
    expect(listarCerradas).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: TENANT,
        q: 'García',
        estadoFinal: 'reserva_completada',
        fechaDesde,
        fechaHasta,
        tipoEvento: 'boda',
        importeMin: '1000.00',
        importeMax: '20000.00',
        page: 1,
        limit: 20,
      }),
    );
  });

  // 7 — orden por fechaEvento DESC: el use-case preserva el orden del adaptador
  it('debe_preservar_el_orden_por_fechaEvento_descendente_recibido_del_puerto', async () => {
    // Arrange: el adaptador ya devuelve DESC; el use-case NO reordena.
    const filas: HistoricoReservaLectura[] = [
      filaCerrada({ idReserva: 'r-nueva', fechaEvento: new Date('2026-06-01T00:00:00.000Z') }),
      filaCerrada({ idReserva: 'r-media', fechaEvento: new Date('2026-03-01T00:00:00.000Z') }),
      filaCerrada({ idReserva: 'r-vieja', fechaEvento: new Date('2026-01-01T00:00:00.000Z') }),
    ];
    const listarCerradas = jest.fn().mockResolvedValue(pagina(filas, { total: 3 }));
    const { useCase } = construir(listarCerradas);

    // Act
    const resultado = await useCase.ejecutar(comando());

    // Assert
    expect(resultado.data.map((r) => r.idReserva)).toEqual(['r-nueva', 'r-media', 'r-vieja']);
  });

  // 8 — proyección a la fila LIGERA del contrato `ReservaHistorico`
  describe('proyeccion a la fila ligera ReservaHistorico (contrato)', () => {
    it('debe_exponer_solo_los_campos_del_schema_ReservaHistorico', async () => {
      // Arrange
      const listarCerradas = jest.fn().mockResolvedValue(
        pagina(
          [
            filaCerrada({
              idReserva: 'reserva-abc',
              codigo: 'SLO-2026-0009',
              clienteId: 'cli-9',
              clienteNombre: 'Ana',
              clienteApellidos: 'García López',
              estado: 'reserva_completada',
              fechaEvento: new Date('2026-05-20T00:00:00.000Z'),
              tipoEvento: 'boda',
              importeTotal: '12000.00',
            }),
          ],
          { total: 1 },
        ),
      );
      const { useCase } = construir(listarCerradas);

      // Act
      const resultado = await useCase.ejecutar(comando());

      // Assert: forma exacta de la fila del contrato.
      const item = resultado.data[0];
      expect(item.idReserva).toBe('reserva-abc');
      expect(item.codigo).toBe('SLO-2026-0009');
      expect(item.clienteId).toBe('cli-9');
      expect(item.clienteNombre).toBe('Ana');
      expect(item.clienteApellidos).toBe('García López');
      expect(item.estado).toBe('reserva_completada');
      // `fechaEvento` (columna DATE) se emite como `date` YYYY-MM-DD, no ISO date-time.
      expect(item.fechaEvento).toBe('2026-05-20');
      expect(item.tipoEvento).toBe('boda');
      expect(item.importeTotal).toBe('12000.00');
    });

    it('debe_NO_exponer_los_derivados_del_pipeline_ni_transitorios_de_consulta', async () => {
      // Arrange
      const listarCerradas = jest.fn().mockResolvedValue(pagina([filaCerrada()], { total: 1 }));
      const { useCase } = construir(listarCerradas);

      // Act
      const resultado = await useCase.ejecutar(comando());

      // Assert: la fila del histórico es LIGERA (design.md §D-1): sin campos del pipeline.
      const item = resultado.data[0] as unknown as Record<string, unknown>;
      expect(item).not.toHaveProperty('progressLogistica');
      expect(item).not.toHaveProperty('progressLiquidacion');
      expect(item).not.toHaveProperty('ttlExpiracion');
      expect(item).not.toHaveProperty('posicionCola');
      expect(item).not.toHaveProperty('consultaBloqueanteId');
      // Identificador del contrato = `idReserva`, nunca un `id` renombrado.
      expect(item).not.toHaveProperty('id');
    });

    it('debe_conservar_null_en_los_campos_nullable_del_contrato', async () => {
      // Arrange: fila con nullable a null (fechaEvento/tipoEvento/importeTotal/cliente*).
      const listarCerradas = jest.fn().mockResolvedValue(
        pagina(
          [
            filaCerrada({
              fechaEvento: null,
              tipoEvento: null,
              importeTotal: null,
              clienteNombre: null,
              clienteApellidos: null,
            }),
          ],
          { total: 1 },
        ),
      );
      const { useCase } = construir(listarCerradas);

      // Act
      const resultado = await useCase.ejecutar(comando());

      // Assert
      const item = resultado.data[0];
      expect(item.fechaEvento).toBeNull();
      expect(item.tipoEvento).toBeNull();
      expect(item.importeTotal).toBeNull();
      expect(item.clienteNombre).toBeNull();
      expect(item.clienteApellidos).toBeNull();
    });
  });

  // 9 — paginación: metadata { total, page, limit, totalPages } coherente
  describe('paginacion y metadata', () => {
    it('debe_reflejar_page_limit_y_total_del_puerto_y_calcular_totalPages', async () => {
      // Arrange: 45 cerradas en total, página 2 de 20.
      const listarCerradas = jest.fn().mockResolvedValue(
        pagina([filaCerrada()], { total: 45, page: 2, limit: 20 }),
      );
      const { useCase } = construir(listarCerradas);

      // Act
      const resultado = await useCase.ejecutar(comando({ page: 2, limit: 20 }));

      // Assert
      expect(resultado.metadata.total).toBe(45);
      expect(resultado.metadata.page).toBe(2);
      expect(resultado.metadata.limit).toBe(20);
      expect(resultado.metadata.totalPages).toBe(3); // ceil(45 / 20)
    });

    it('debe_propagar_page_y_limit_del_comando_al_puerto', async () => {
      // Arrange
      const listarCerradas = jest.fn().mockResolvedValue(pagina([], { total: 0, page: 3, limit: 10 }));
      const { useCase } = construir(listarCerradas);

      // Act
      await useCase.ejecutar(comando({ page: 3, limit: 10 }));

      // Assert
      expect(listarCerradas).toHaveBeenCalledWith(
        expect.objectContaining({ page: 3, limit: 10 }),
      );
    });
  });

  // 10 — no-mutación: lectura pura
  it('debe_ser_lectura_pura_y_no_invocar_ningun_metodo_de_escritura', async () => {
    // Arrange: puerto con SOLO el método de lectura + espías de posibles escrituras.
    const listarCerradas = jest.fn().mockResolvedValue(pagina([filaCerrada()], { total: 1 }));
    const guardar = jest.fn();
    const actualizar = jest.fn();
    const eliminar = jest.fn();
    const puerto = {
      listarCerradas,
      guardar,
      actualizar,
      eliminar,
    } as unknown as HistoricoQueryPort;
    const useCase = new ListarHistoricoUseCase({ historico: puerto });

    // Act
    await useCase.ejecutar(comando());

    // Assert
    expect(listarCerradas).toHaveBeenCalledTimes(1);
    expect(guardar).not.toHaveBeenCalled();
    expect(actualizar).not.toHaveBeenCalled();
    expect(eliminar).not.toHaveBeenCalled();
  });
});
