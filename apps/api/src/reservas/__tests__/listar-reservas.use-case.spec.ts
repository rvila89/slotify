/**
 * TESTS RED (US-049 / UC-37 / UC-38) del query `ListarReservasUseCase` — pipeline de
 * reservas ACTIVAS (`GET /reservas` → `ReservaListResponse`).
 *
 * Ejercita la APLICACIÓN contra un DOBLE del puerto de lectura (in-memory), SIN Prisma
 * (hexagonal) y SIN tests de concurrencia (lectura pura: no hay bloqueo atómico ni
 * mutación). El use-case:
 *   - delega en el puerto la consulta de ACTIVAS del tenant (exclusión de terminales/
 *     cerrados, aislamiento por `tenant_id`, orden por `fechaCreacion` DESC y filtros de
 *     query los aplica el adaptador → aquí se verifican vía los args pasados al puerto y
 *     el read-model devuelto),
 *   - PROYECTA cada RESERVA a la forma del contrato `Reserva`, derivando `nombreEvento`,
 *     `progressLogistica` y `progressLiquidacion` (mapa declarativo estado→progreso),
 *   - envuelve la lista en `{ data, metadata }` (`ReservaListResponse`),
 *   - NO invoca ningún método de escritura (no-mutación).
 *
 * Estos tests están escritos ANTES que la implementación: deben quedar en ROJO porque
 * `../application/listar-reservas.use-case` todavía no existe.
 */
import type { SubEstadoConsulta } from '../domain/maquina-estados';
import {
  ListarReservasUseCase,
  type ListarReservasComando,
  type PipelineQueryPort,
  type PipelineReservaLectura,
  type PipelinePaginaLectura,
} from '../application/listar-reservas.use-case';

const TENANT = '00000000-0000-0000-0000-000000000001';
const OTRO_TENANT = '00000000-0000-0000-0000-000000000002';

/** Fabrica una fila de read-model de RESERVA activa con overrides. */
const filaActiva = (
  over: Partial<PipelineReservaLectura> = {},
): PipelineReservaLectura => ({
  idReserva: '11111111-1111-1111-1111-111111111111',
  codigo: 'SLO-2026-0001',
  clienteId: 'cli-1',
  estado: 'pre_reserva',
  subEstado: null,
  canalEntrada: 'web',
  fechaEvento: new Date('2027-10-20T00:00:00.000Z'),
  duracionHoras: null,
  tipoEvento: null,
  numAdultosNinosMayores4: null,
  numNinosMenores4: null,
  numInvitadosFinal: null,
  importeTotal: null,
  importeSenal: null,
  importeLiquidacion: null,
  ttlExpiracion: null,
  visitaProgramadaFecha: null,
  visitaProgramadaHora: null,
  visitaRealizada: null,
  fianzaEur: null,
  fianzaCobradaFecha: null,
  fianzaDevueltaFecha: null,
  fianzaDevueltaEur: null,
  condPartFirmadas: null,
  condPartFechaEnvio: null,
  condPartFechaFirma: null,
  preEventoStatus: 'pendiente',
  liquidacionStatus: 'pendiente',
  fianzaStatus: 'pendiente',
  posicionCola: null,
  consultaBloqueanteId: null,
  notas: null,
  fechaCreacion: new Date('2026-06-01T08:00:00.000Z'),
  cliente: {
    idCliente: 'cli-1',
    nombre: 'Ana',
    apellidos: 'García López',
    email: null,
    telefono: null,
    dniNif: null,
    direccion: null,
    codigoPostal: null,
    poblacion: null,
    provincia: null,
    ibanDevolucion: null,
  },
  ...over,
});

/** Envuelve un array de filas en la página de lectura del puerto (metadata derivada). */
const pagina = (
  filas: PipelineReservaLectura[],
  over: Partial<PipelinePaginaLectura> = {},
): PipelinePaginaLectura => ({
  items: filas,
  total: filas.length,
  page: 1,
  limit: 20,
  ...over,
});

/**
 * Doble del puerto: `listarActivas` mockeado. Rastrea que el use-case NO llama a ningún
 * método distinto (no-mutación): el puerto de lectura solo expone `listarActivas`.
 */
const construir = (
  listarActivas: jest.Mock,
): { useCase: ListarReservasUseCase; puerto: PipelineQueryPort & jest.Mocked<PipelineQueryPort> } => {
  const puerto = { listarActivas } as unknown as PipelineQueryPort &
    jest.Mocked<PipelineQueryPort>;
  return { useCase: new ListarReservasUseCase({ pipeline: puerto }), puerto };
};

const comando = (over: Partial<ListarReservasComando> = {}): ListarReservasComando => ({
  tenantId: TENANT,
  page: 1,
  limit: 20,
  ...over,
});

describe('ListarReservasUseCase — pipeline de reservas activas (US-049)', () => {
  // 3.1 — lista vacía
  it('debe_devolver_data_vacia_y_total_cero_cuando_no_hay_reservas_activas', async () => {
    // Arrange
    const listarActivas = jest.fn().mockResolvedValue(pagina([], { total: 0 }));
    const { useCase } = construir(listarActivas);

    // Act
    const resultado = await useCase.ejecutar(comando());

    // Assert
    expect(resultado.data).toEqual([]);
    expect(resultado.metadata.total).toBe(0);
    expect(resultado.metadata.page).toBe(1);
    expect(resultado.metadata.limit).toBe(20);
  });

  // 3.2 — incluye todos los estados activos, ordenados por fechaCreacion DESC
  it('debe_incluir_todos_los_estados_activos_ordenados_por_fechaCreacion_desc', async () => {
    // Arrange: el adaptador ya devuelve en orden DESC; el use-case preserva el orden
    const filas: PipelineReservaLectura[] = [
      filaActiva({ idReserva: 'r-2a', estado: 'consulta', subEstado: '2a', fechaCreacion: new Date('2026-06-09T00:00:00Z') }),
      filaActiva({ idReserva: 'r-2b', estado: 'consulta', subEstado: '2b', fechaCreacion: new Date('2026-06-08T00:00:00Z') }),
      filaActiva({ idReserva: 'r-2c', estado: 'consulta', subEstado: '2c', fechaCreacion: new Date('2026-06-07T00:00:00Z') }),
      filaActiva({ idReserva: 'r-2d', estado: 'consulta', subEstado: '2d', fechaCreacion: new Date('2026-06-06T00:00:00Z') }),
      filaActiva({ idReserva: 'r-2v', estado: 'consulta', subEstado: '2v', fechaCreacion: new Date('2026-06-05T00:00:00Z') }),
      filaActiva({ idReserva: 'r-pre', estado: 'pre_reserva', subEstado: null, fechaCreacion: new Date('2026-06-04T00:00:00Z') }),
      filaActiva({ idReserva: 'r-conf', estado: 'reserva_confirmada', subEstado: null, fechaCreacion: new Date('2026-06-03T00:00:00Z') }),
      filaActiva({ idReserva: 'r-curso', estado: 'evento_en_curso', subEstado: null, fechaCreacion: new Date('2026-06-02T00:00:00Z') }),
      filaActiva({ idReserva: 'r-post', estado: 'post_evento', subEstado: null, fechaCreacion: new Date('2026-06-01T00:00:00Z') }),
    ];
    const listarActivas = jest.fn().mockResolvedValue(pagina(filas, { total: 9 }));
    const { useCase } = construir(listarActivas);

    // Act
    const resultado = await useCase.ejecutar(comando());

    // Assert: los 9 estados activos aparecen, en el mismo orden DESC recibido.
    // [US-050 §5b] El identificador del contrato `Reserva` es `idReserva` (required),
    // NO `id`: la proyección debe exponer `idReserva`, no un `id` renombrado.
    expect(resultado.data).toHaveLength(9);
    expect(resultado.data.map((r) => r.idReserva)).toEqual([
      'r-2a', 'r-2b', 'r-2c', 'r-2d', 'r-2v', 'r-pre', 'r-conf', 'r-curso', 'r-post',
    ]);
    const fechas = resultado.data.map((r) => new Date(r.fechaCreacion).getTime());
    expect(fechas).toEqual([...fechas].sort((a, b) => b - a));
  });

  // 3.3 — el use-case delega en el puerto la exclusión de terminales/cerrados
  it('debe_pedir_al_puerto_solo_reservas_activas_excluyendo_terminales_y_cerradas', async () => {
    // Arrange: el puerto (adaptador) NO devuelve 2x/2y/2z/completada/cancelada.
    const activas = [
      filaActiva({ idReserva: 'r-pre', estado: 'pre_reserva' }),
      filaActiva({ idReserva: 'r-conf', estado: 'reserva_confirmada' }),
    ];
    const listarActivas = jest.fn().mockResolvedValue(pagina(activas, { total: 2 }));
    const { useCase } = construir(listarActivas);

    // Act
    const resultado = await useCase.ejecutar(comando());

    // Assert: el resultado no contiene ningún estado terminal/cerrado y el use-case
    // no reintroduce ninguna; el filtro es del puerto (lectura pura de activas).
    const estados = resultado.data.map((r) => r.estado);
    expect(estados).not.toContain('reserva_completada');
    expect(estados).not.toContain('reserva_cancelada');
    const subEstados = resultado.data.map((r) => r.subEstado);
    expect(subEstados).not.toContain('2x');
    expect(subEstados).not.toContain('2y');
    expect(subEstados).not.toContain('2z');
    expect(listarActivas).toHaveBeenCalledTimes(1);
  });

  // 3.4 — aislamiento multi-tenant: el tenant del JWT viaja SIEMPRE al puerto
  it('debe_propagar_el_tenantId_del_comando_al_puerto_y_no_devolver_otro_tenant', async () => {
    // Arrange
    const listarActivas = jest
      .fn()
      .mockResolvedValue(pagina([filaActiva({ idReserva: 'r-t1' })], { total: 1 }));
    const { useCase } = construir(listarActivas);

    // Act
    const resultado = await useCase.ejecutar(comando({ tenantId: TENANT }));

    // Assert: el puerto se invoca con el tenant del comando (no OTRO_TENANT)
    expect(listarActivas).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: TENANT }),
    );
    expect(listarActivas).not.toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: OTRO_TENANT }),
    );
    expect(resultado.data).toHaveLength(1);
  });

  // 3.5 — derivación de progressLogistica desde preEventoStatus
  describe('derivacion de progressLogistica desde preEventoStatus (3.5)', () => {
    it.each([
      ['pendiente', 0],
      ['en_curso', 50],
      ['cerrado', 100],
    ])('debe_derivar_progressLogistica_%s_a_%i', async (preEventoStatus, esperado) => {
      // Arrange
      const listarActivas = jest.fn().mockResolvedValue(
        pagina([filaActiva({ estado: 'reserva_confirmada', preEventoStatus })], { total: 1 }),
      );
      const { useCase } = construir(listarActivas);

      // Act
      const resultado = await useCase.ejecutar(comando());

      // Assert
      expect(resultado.data[0].progressLogistica).toBe(esperado);
    });

    it.each<SubEstadoConsulta>(['2a', '2b', '2c', '2d', '2v'])(
      'debe_derivar_progressLogistica_0_para_consulta_%s',
      async (subEstado) => {
        // Arrange: aunque preEventoStatus fuese distinto, consulta arranca en 0
        const listarActivas = jest.fn().mockResolvedValue(
          pagina(
            [filaActiva({ estado: 'consulta', subEstado, preEventoStatus: 'en_curso' })],
            { total: 1 },
          ),
        );
        const { useCase } = construir(listarActivas);

        // Act
        const resultado = await useCase.ejecutar(comando());

        // Assert
        expect(resultado.data[0].progressLogistica).toBe(0);
      },
    );

    it('debe_derivar_progressLogistica_0_para_pre_reserva', async () => {
      // Arrange
      const listarActivas = jest.fn().mockResolvedValue(
        pagina([filaActiva({ estado: 'pre_reserva', preEventoStatus: 'en_curso' })], { total: 1 }),
      );
      const { useCase } = construir(listarActivas);

      // Act
      const resultado = await useCase.ejecutar(comando());

      // Assert
      expect(resultado.data[0].progressLogistica).toBe(0);
    });
  });

  // 3.6 — derivación de progressLiquidacion desde liquidacionStatus
  describe('derivacion de progressLiquidacion desde liquidacionStatus (3.6)', () => {
    it.each([
      ['pendiente', 0],
      ['facturada', 50],
      ['cobrada', 100],
    ])('debe_derivar_progressLiquidacion_%s_a_%i', async (liquidacionStatus, esperado) => {
      // Arrange
      const listarActivas = jest.fn().mockResolvedValue(
        pagina([filaActiva({ estado: 'post_evento', liquidacionStatus })], { total: 1 }),
      );
      const { useCase } = construir(listarActivas);

      // Act
      const resultado = await useCase.ejecutar(comando());

      // Assert
      expect(resultado.data[0].progressLiquidacion).toBe(esperado);
    });

    it('debe_derivar_progressLiquidacion_0_para_consulta_sin_liquidacion', async () => {
      // Arrange
      const listarActivas = jest.fn().mockResolvedValue(
        pagina(
          [filaActiva({ estado: 'consulta', subEstado: '2a', liquidacionStatus: 'cobrada' })],
          { total: 1 },
        ),
      );
      const { useCase } = construir(listarActivas);

      // Act
      const resultado = await useCase.ejecutar(comando());

      // Assert
      expect(resultado.data[0].progressLiquidacion).toBe(0);
    });

    it('debe_derivar_progressLiquidacion_0_para_pre_reserva', async () => {
      // Arrange
      const listarActivas = jest.fn().mockResolvedValue(
        pagina([filaActiva({ estado: 'pre_reserva', liquidacionStatus: 'facturada' })], { total: 1 }),
      );
      const { useCase } = construir(listarActivas);

      // Act
      const resultado = await useCase.ejecutar(comando());

      // Assert
      expect(resultado.data[0].progressLiquidacion).toBe(0);
    });
  });

  // 3.7 — nombreEvento = {cliente.nombre} {cliente.apellidos}, fallback a codigo
  describe('derivacion de nombreEvento (3.7)', () => {
    it('debe_componer_nombreEvento_con_nombre_y_apellidos_del_cliente', async () => {
      // Arrange
      const listarActivas = jest.fn().mockResolvedValue(
        pagina(
          [
            filaActiva({
              cliente: {
                idCliente: 'cli-1',
                nombre: 'Ana',
                apellidos: 'García López',
                email: null,
                telefono: null,
                dniNif: null,
                direccion: null,
                codigoPostal: null,
                poblacion: null,
                provincia: null,
                ibanDevolucion: null,
              },
            }),
          ],
          { total: 1 },
        ),
      );
      const { useCase } = construir(listarActivas);

      // Act
      const resultado = await useCase.ejecutar(comando());

      // Assert
      expect(resultado.data[0].nombreEvento).toBe('Ana García López');
    });

    it('debe_usar_el_codigo_como_fallback_cuando_no_hay_cliente_resoluble', async () => {
      // Arrange: sin cliente (null) → fallback al codigo de la reserva
      const listarActivas = jest.fn().mockResolvedValue(
        pagina(
          [filaActiva({ codigo: 'SLO-2026-0001', cliente: null })],
          { total: 1 },
        ),
      );
      const { useCase } = construir(listarActivas);

      // Act
      const resultado = await useCase.ejecutar(comando());

      // Assert
      expect(resultado.data[0].nombreEvento).toBe('SLO-2026-0001');
    });
  });

  // 3.8 — filtro por estado, sobre el conjunto de activas
  it('debe_propagar_el_filtro_estado_al_puerto_y_devolver_solo_ese_estado', async () => {
    // Arrange: el adaptador devuelve solo pre_reserva cuando se pasa ?estado=pre_reserva
    const listarActivas = jest.fn().mockResolvedValue(
      pagina(
        [
          filaActiva({ idReserva: 'r-pre-1', estado: 'pre_reserva' }),
          filaActiva({ idReserva: 'r-pre-2', estado: 'pre_reserva' }),
        ],
        { total: 2 },
      ),
    );
    const { useCase } = construir(listarActivas);

    // Act
    const resultado = await useCase.ejecutar(comando({ estado: 'pre_reserva' }));

    // Assert: el filtro viaja al puerto y todos los resultados son de ese estado
    expect(listarActivas).toHaveBeenCalledWith(
      expect.objectContaining({ estado: 'pre_reserva' }),
    );
    expect(resultado.data.every((r) => r.estado === 'pre_reserva')).toBe(true);
    expect(resultado.data).toHaveLength(2);
  });

  // 3.8bis — hallazgo ALTA: la exclusión de terminales/cerrados se aplica SIEMPRE, aun
  // con filtro por un estado/subEstado terminal → el puerto devuelve lista vacía.
  it.each<[string, Partial<ListarReservasComando>]>([
    ['estado_reserva_completada', { estado: 'reserva_completada' }],
    ['estado_reserva_cancelada', { estado: 'reserva_cancelada' }],
    ['subEstado_2x', { subEstado: '2x' }],
    ['subEstado_2y', { subEstado: '2y' }],
    ['subEstado_2z', { subEstado: '2z' }],
  ])(
    'debe_devolver_vacio_cuando_se_filtra_por_%s_terminal_pese_a_existir_reservas',
    async (_nombre, filtroTerminal) => {
      // Arrange: el adaptador aplica SIEMPRE la exclusión, así que un filtro por un valor
      // terminal produce un where incompatible → 0 filas (aunque en BD existan en ese estado).
      const listarActivas = jest.fn().mockResolvedValue(pagina([], { total: 0 }));
      const { useCase } = construir(listarActivas);

      // Act
      const resultado = await useCase.ejecutar(comando(filtroTerminal));

      // Assert: el filtro viaja al puerto y el resultado es lista vacía (contrato del hallazgo)
      expect(listarActivas).toHaveBeenCalledWith(
        expect.objectContaining({ ...filtroTerminal, tenantId: TENANT }),
      );
      expect(resultado.data).toEqual([]);
      expect(resultado.metadata.total).toBe(0);
    },
  );

  // 5b.1 — CONFORMIDAD DE CONTRATO (US-050 ampliación de scope): la proyección debe
  // exponer el identificador del contrato `Reserva` como `idReserva` (required) y
  // TRANSPORTAR los cinco campos de datos del schema que hoy se OMITEN: `fechaEvento`,
  // `numInvitadosFinal`, `numAdultosNinosMayores4`, `numNinosMenores4` y `notas`. Estos
  // campos YA llegan del adaptador en el read-model `PipelineReservaLectura`; la pérdida
  // está en la proyección (`ReservaPipelineItem` + `proyectar()`), que los recorta.
  describe('conformidad de contrato: idReserva + campos de datos del schema Reserva (5b.1)', () => {
    it('debe_exponer_idReserva_y_no_un_campo_id_en_la_proyeccion', async () => {
      // Arrange
      const listarActivas = jest.fn().mockResolvedValue(
        pagina([filaActiva({ idReserva: 'reserva-abc' })], { total: 1 }),
      );
      const { useCase } = construir(listarActivas);

      // Act
      const resultado = await useCase.ejecutar(comando());

      // Assert: el contrato exige `idReserva` (required); NO debe existir `id`.
      const item = resultado.data[0] as unknown as Record<string, unknown>;
      expect(item.idReserva).toBe('reserva-abc');
      expect(item).not.toHaveProperty('id');
    });

    it('debe_transportar_fechaEvento_aforo_desglosado_y_notas_desde_el_read_model', async () => {
      // Arrange: una reserva ACTIVA con los cinco campos de datos poblados.
      const fechaEvento = new Date('2027-10-20T00:00:00.000Z');
      const listarActivas = jest.fn().mockResolvedValue(
        pagina(
          [
            filaActiva({
              idReserva: 'reserva-datos',
              fechaEvento,
              numInvitadosFinal: 80,
              numAdultosNinosMayores4: 72,
              numNinosMenores4: 8,
              notas: 'Alergia a frutos secos; montaje a las 17:00',
            }),
          ],
          { total: 1 },
        ),
      );
      const { useCase } = construir(listarActivas);

      // Act
      const resultado = await useCase.ejecutar(comando());

      // Assert: la proyección conserva los cinco campos del contrato `Reserva`.
      const item = resultado.data[0];
      expect(item.numInvitadosFinal).toBe(80);
      expect(item.numAdultosNinosMayores4).toBe(72);
      expect(item.numNinosMenores4).toBe(8);
      expect(item.notas).toBe('Alergia a frutos secos; montaje a las 17:00');
      // `fechaEvento` se emite como `date` (YYYY-MM-DD) del contrato; nunca se pierde.
      expect(item.fechaEvento).toBeDefined();
      expect(String(item.fechaEvento)).toContain('2027-10-20');
    });

    it('debe_conservar_null_en_los_campos_de_datos_opcionales_cuando_no_estan_poblados', async () => {
      // Arrange: reserva sin fecha/aforo/notas (todos null en el read-model).
      const listarActivas = jest.fn().mockResolvedValue(
        pagina(
          [
            filaActiva({
              idReserva: 'reserva-nulls',
              fechaEvento: null,
              numInvitadosFinal: null,
              numAdultosNinosMayores4: null,
              numNinosMenores4: null,
              notas: null,
            }),
          ],
          { total: 1 },
        ),
      );
      const { useCase } = construir(listarActivas);

      // Act
      const resultado = await useCase.ejecutar(comando());

      // Assert: los campos existen en la proyección (nullable del contrato), con valor null.
      const item = resultado.data[0];
      expect(item.fechaEvento).toBeNull();
      expect(item.numInvitadosFinal).toBeNull();
      expect(item.numAdultosNinosMayores4).toBeNull();
      expect(item.numNinosMenores4).toBeNull();
      expect(item.notas).toBeNull();
    });
  });

  // 3.9 — no-mutación: el use-case no invoca escritura
  it('debe_ser_lectura_pura_y_no_invocar_ningun_metodo_de_escritura', async () => {
    // Arrange: puerto con SOLO el método de lectura + espías de posibles escrituras
    const listarActivas = jest.fn().mockResolvedValue(pagina([filaActiva()], { total: 1 }));
    const guardar = jest.fn();
    const actualizar = jest.fn();
    const eliminar = jest.fn();
    const puerto = { listarActivas, guardar, actualizar, eliminar } as unknown as PipelineQueryPort;
    const useCase = new ListarReservasUseCase({ pipeline: puerto });

    // Act
    await useCase.ejecutar(comando());

    // Assert: solo se leyó; ningún método de escritura fue invocado
    expect(listarActivas).toHaveBeenCalledTimes(1);
    expect(guardar).not.toHaveBeenCalled();
    expect(actualizar).not.toHaveBeenCalled();
    expect(eliminar).not.toHaveBeenCalled();
  });
});
