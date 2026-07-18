/**
 * TESTS del FIX `fix-borrador-e1-cuerpo-prerelleno` — fase TDD RED.
 *
 * Bug: cuando el alta incluye `comentarios`, el E1 queda en `borrador` con el
 * `cuerpo` VACÍO (el render solo corría en la rama de auto-envío). Este fix hace que,
 * con comentarios, el borrador nazca YA REDACTADO: el sistema renderiza la plantilla
 * E1 con PARIDAD EXACTA al auto-envío (mismo idioma `RESERVA.idioma` y misma
 * casuística `tipoE1`, incluidas fechas alternativas) y PERSISTE `asunto` + `cuerpo`
 * en la fila `borrador` (sin enviar), para que el gestor edite y envíe por US-046.
 *
 * Diseño (design.md):
 *   - D-1: el UPDATE post-commit usa un puerto estrecho `ActualizarBorradorEmailPort`
 *     (`actualizarContenidoBorrador`) satisfecho por el `DespacharEmailService` ya
 *     inyectado (reutilizado como `deps.actualizarBorrador`).
 *   - D-2: un único helper de render alimenta ambas ramas → paridad por construcción.
 *   - D-3: el UPDATE es POST-COMMIT best-effort: si falla, el alta resuelve igual (201).
 *
 * RED: aún NO existen en `application/alta-consulta.use-case.ts` el puerto
 * `ActualizarBorradorEmailPort` ni el campo `actualizarBorrador` de `AltaConsultaDeps`,
 * ni la rama que rellena el borrador con comentarios. Los imports/uso fallan en
 * compilación y/o las aserciones fallan → batería en ROJO. GREEN es la implementación.
 */
import {
  AltaConsultaUseCase,
  type AltaConsultaComando,
  type AltaConsultaDeps,
  type RepositoriosAltaConsulta,
  type UnidadDeTrabajoPort,
  type ClockPort,
  type FinalizarEnvioEmailPort,
  type FechasAlternativas,
  type FechasAlternativasPort,
  type EstadoFechaAlta,
  type FechaBloqueadaAltaRepositoryPort,
  // NUEVO (RED): puerto del UPDATE post-commit del borrador con comentarios.
  type ActualizarBorradorEmailPort,
  type ActualizarBorradorEmailParams,
} from '../application/alta-consulta.use-case';
import type {
  CatalogoPlantillasPort,
  Plantilla,
} from '../../comunicaciones/domain/catalogo-plantillas.port';
import type { AuditLogPort } from '../../shared/audit/audit-log.port';

const TENANT = '00000000-0000-0000-0000-000000000001';
const GESTOR = '00000000-0000-0000-0000-0000000000a1';
const EMAIL = 'marta.soler@example.com';
const FECHA = new Date('2027-09-12T00:00:00.000Z');

// ---------------------------------------------------------------------------
// Dobles de puertos (in-memory)
// ---------------------------------------------------------------------------

type FechaBloqueadaFake = FechaBloqueadaAltaRepositoryPort & {
  leerEstadoFecha: jest.Mock;
  bloquear: jest.Mock;
  siguientePosicionCola: jest.Mock;
};

interface ReposFake extends RepositoriosAltaConsulta {
  clientes: { buscarPorEmail: jest.Mock; crear: jest.Mock };
  reservas: { crear: jest.Mock };
  comunicaciones: { crear: jest.Mock };
  auditoria: AuditLogPort & { registrar: jest.Mock };
  fechaBloqueada?: FechaBloqueadaFake;
}

/**
 * Repos fake. Si `estadoFecha` es null → alta SIN fecha (2.a, no hay repo de bloqueo).
 * Si viene un `EstadoFechaAlta` → alta CON fecha (se incluye el repo `fechaBloqueada`).
 */
const crearReposFake = (estadoFecha: EstadoFechaAlta | null): ReposFake => {
  const clientes = {
    buscarPorEmail: jest.fn(async () => null),
    crear: jest.fn(async (p: { tenantId: string; email: string }) => ({
      idCliente: 'cli-nuevo',
      tenantId: p.tenantId,
      nombre: 'Marta',
      apellidos: 'Soler',
      email: p.email,
      telefono: '600111222',
    })),
  };
  const reservas = {
    crear: jest.fn(async (p: Record<string, unknown>) => ({
      idReserva: 'res-1',
      tenantId: p.tenantId,
      clienteId: p.clienteId,
      codigo: '27-0001',
      estado: 'consulta',
      subEstado: p.subEstado,
      ttlExpiracion: (p.ttlExpiracion as Date | null) ?? null,
      canalEntrada: p.canalEntrada,
    })),
  };
  const comunicaciones = {
    crear: jest.fn(async (p: Record<string, unknown>) => ({
      idComunicacion: 'com-1',
      tenantId: p.tenantId,
      reservaId: p.reservaId,
      clienteId: p.clienteId,
      codigoEmail: 'E1',
      estado: p.estado,
      destinatarioEmail: p.destinatarioEmail,
      fechaEnvio: (p.fechaEnvio as Date | null) ?? null,
    })),
  };
  const auditoria = { registrar: jest.fn(async () => undefined) };
  if (estadoFecha === null) {
    return { clientes, reservas, comunicaciones, auditoria };
  }
  const fechaBloqueada: FechaBloqueadaFake = {
    leerEstadoFecha: jest.fn(async () => estadoFecha),
    bloquear: jest.fn(async () => undefined),
    siguientePosicionCola: jest.fn(async () => 1),
  };
  return { clientes, reservas, comunicaciones, auditoria, fechaBloqueada };
};

const crearUowFake = (repos: ReposFake): UnidadDeTrabajoPort & { ejecutar: jest.Mock } => ({
  ejecutar: jest.fn(
    async <T,>(_tenantId: string, trabajo: (r: RepositoriosAltaConsulta) => Promise<T>) =>
      trabajo(repos),
  ),
});

const crearFinalizarFake = (): FinalizarEnvioEmailPort & { finalizarEnvio: jest.Mock } => ({
  finalizarEnvio: jest.fn(async () => ({
    estado: 'enviado' as const,
    fechaEnvio: new Date('2026-06-28T10:00:00.000Z'),
  })),
});

/** Doble del catálogo: `render` devuelve un cuerpo determinista por `tipoE1` + `nombre`. */
const crearCatalogoFake = () => {
  const render = jest.fn((v: Record<string, unknown>) => ({
    asunto: 'ASUNTO_REAL',
    cuerpoHtml: `<p>CUERPO_${String(v.tipoE1)}_${String(v.nombre)}</p>`,
    cuerpoTexto: `CUERPO ${String(v.tipoE1)}`,
  }));
  const plantilla: Plantilla = {
    codigoEmail: 'E1',
    idioma: 'es',
    activa: true,
    variablesRequeridas: ['nombre', 'tipoE1'],
    adjuntosRequeridos: [],
    render,
  };
  const seleccionar = jest.fn(() => plantilla);
  const catalogo: CatalogoPlantillasPort = { seleccionar };
  return { catalogo, seleccionar, render };
};

const crearFechasAlternativasFake = (
  alt: FechasAlternativas = { anterior: null, posterior: null },
) => {
  const leerAlternativas = jest.fn(async () => alt);
  const port: FechasAlternativasPort = { leerAlternativas };
  return { port, leerAlternativas };
};

/** Doble del puerto del UPDATE del borrador (NUEVO). */
const crearActualizarBorradorFake = () => {
  const actualizarContenidoBorrador = jest.fn(
    async (_p: ActualizarBorradorEmailParams): Promise<unknown> => undefined,
  );
  const port: ActualizarBorradorEmailPort = { actualizarContenidoBorrador };
  return { port, actualizarContenidoBorrador };
};

const relojFijo: ClockPort = { ahora: () => new Date('2026-06-28T10:00:00.000Z') };

interface MontarOpts {
  estadoFecha?: EstadoFechaAlta | null;
  catalogo?: ReturnType<typeof crearCatalogoFake>;
  fechasAlternativas?: ReturnType<typeof crearFechasAlternativasFake>;
  actualizarBorrador?: ReturnType<typeof crearActualizarBorradorFake>;
}

const montar = (opts: MontarOpts = {}) => {
  const estadoFecha = opts.estadoFecha ?? null;
  const repos = crearReposFake(estadoFecha);
  const uow = crearUowFake(repos);
  const finalizarEnvio = crearFinalizarFake();
  const catalogo = opts.catalogo ?? crearCatalogoFake();
  const fechasAlternativas = opts.fechasAlternativas ?? crearFechasAlternativasFake();
  const actualizarBorrador = opts.actualizarBorrador ?? crearActualizarBorradorFake();
  const deps: AltaConsultaDeps = {
    unidadDeTrabajo: uow,
    finalizarEnvio,
    clock: relojFijo,
    catalogo: catalogo.catalogo,
    fechasAlternativas: fechasAlternativas.port,
    actualizarBorrador: actualizarBorrador.port,
  };
  return {
    useCase: new AltaConsultaUseCase(deps),
    repos,
    uow,
    finalizarEnvio,
    catalogo,
    fechasAlternativas,
    actualizarBorrador,
  };
};

const comando = (over: Partial<AltaConsultaComando> = {}): AltaConsultaComando => ({
  tenantId: TENANT,
  usuarioId: GESTOR,
  canalEntrada: 'web',
  cliente: { nombre: 'Marta', apellidos: 'Soler', email: EMAIL, telefono: '600111222' },
  ...over,
});

const COMENTARIOS = 'Llamar el lunes, lead caliente';

// Estados de fecha para forzar cada casuística `tipoE1`.
const FECHA_LIBRE: EstadoFechaAlta = { tipo: 'libre' };
const BLOQUEADA_POR_2B: EstadoFechaAlta = {
  tipo: 'bloqueada',
  subEstadoBloqueante: '2b',
  estadoBloqueante: 'consulta',
  reservaBloqueanteId: 'res-bloqueante',
};
const BLOQUEADA_POR_PRERESERVA: EstadoFechaAlta = {
  tipo: 'bloqueada',
  subEstadoBloqueante: null,
  estadoBloqueante: 'pre_reserva',
  reservaBloqueanteId: 'res-prereserva',
};

// ===========================================================================
// Con comentarios (sin fecha) → borrador YA REDACTADO, sin envío.
// ===========================================================================

describe('FIX borrador E1 — con comentarios el borrador nace redactado (sin fecha)', () => {
  it('debe_rellenar_el_borrador_con_asunto_y_cuerpo_renderizados_y_NO_enviar', async () => {
    const { useCase, finalizarEnvio, actualizarBorrador } = montar();

    const out = await useCase.ejecutar(comando({ comentarios: COMENTARIOS }));

    // No se envía: el motor NO se invoca y la fila permanece en borrador.
    expect(finalizarEnvio.finalizarEnvio).not.toHaveBeenCalled();
    expect(out.comunicacion.estado).toBe('borrador');
    expect(out.comunicacion.fechaEnvio).toBeNull();

    // Se persiste el contenido renderizado en la fila borrador (por su id).
    expect(actualizarBorrador.actualizarContenidoBorrador).toHaveBeenCalledTimes(1);
    expect(actualizarBorrador.actualizarContenidoBorrador).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: TENANT,
        idComunicacion: 'com-1',
        asunto: 'ASUNTO_REAL',
        cuerpo: '<p>CUERPO_sin_fecha_Marta</p>',
      }),
    );
  });

  it('debe_renderizar_en_el_idioma_seleccionado_del_comando', async () => {
    const { useCase, catalogo } = montar();

    await useCase.ejecutar(comando({ comentarios: COMENTARIOS, idioma: 'ca' }));

    expect(catalogo.seleccionar).toHaveBeenCalledWith('E1', 'ca');
  });

  it('debe_pasar_la_casuistica_tipoE1_sin_fecha_al_render_cuando_no_hay_fecha', async () => {
    const { useCase, catalogo } = montar();

    await useCase.ejecutar(comando({ comentarios: COMENTARIOS }));

    expect(catalogo.render).toHaveBeenCalledWith(
      expect.objectContaining({ tipoE1: 'sin_fecha', nombre: 'Marta' }),
    );
  });

  it('debe_ser_best_effort_no_tumbar_el_alta_si_el_UPDATE_del_borrador_falla', async () => {
    const actualizarBorrador = crearActualizarBorradorFake();
    actualizarBorrador.actualizarContenidoBorrador.mockRejectedValueOnce(
      new Error('fallo al persistir el cuerpo del borrador'),
    );
    const { useCase } = montar({ actualizarBorrador });

    // El alta ya commiteó: un fallo post-commit del UPDATE NO debe propagarse.
    const out = await useCase.ejecutar(comando({ comentarios: COMENTARIOS }));

    expect(out.reserva.idReserva).toBe('res-1');
    expect(out.comunicacion.estado).toBe('borrador');
  });

  it('no_debe_llamar_al_UPDATE_del_borrador_cuando_no_hay_comentarios_auto_envio', async () => {
    const { useCase, finalizarEnvio, actualizarBorrador } = montar();

    await useCase.ejecutar(comando()); // sin comentarios → auto-envío

    expect(finalizarEnvio.finalizarEnvio).toHaveBeenCalledTimes(1);
    expect(actualizarBorrador.actualizarContenidoBorrador).not.toHaveBeenCalled();
  });
});

// ===========================================================================
// Paridad: el cuerpo persistido (con comentarios) == cuerpo enviado (sin ellos).
// ===========================================================================

describe('FIX borrador E1 — paridad de cuerpo con el auto-envío', () => {
  it('debe_persistir_el_mismo_cuerpo_que_enviaria_el_auto_envio_para_el_mismo_alta', async () => {
    // Sin comentarios → el cuerpo llega a finalizarEnvio.
    const sinComentarios = montar();
    await sinComentarios.useCase.ejecutar(comando({ idioma: 'ca' }));
    const cuerpoEnviado =
      sinComentarios.finalizarEnvio.finalizarEnvio.mock.calls[0][0].cuerpo;
    const asuntoEnviado =
      sinComentarios.finalizarEnvio.finalizarEnvio.mock.calls[0][0].asunto;

    // Con comentarios (mismo alta) → el cuerpo se persiste en el borrador.
    const conComentarios = montar();
    await conComentarios.useCase.ejecutar(comando({ idioma: 'ca', comentarios: COMENTARIOS }));
    const persistido =
      conComentarios.actualizarBorrador.actualizarContenidoBorrador.mock.calls[0][0];

    expect(persistido.cuerpo).toBe(cuerpoEnviado);
    expect(persistido.asunto).toBe(asuntoEnviado);
  });
});

// ===========================================================================
// Casuística de fechas (con fecha): la variante `tipoE1` del borrador == la del alta.
// ===========================================================================

describe('FIX borrador E1 — casuística de fecha en el borrador con comentarios', () => {
  const comandoConFecha = (over: Partial<AltaConsultaComando> = {}): AltaConsultaComando =>
    comando({ fechaEvento: FECHA, comentarios: COMENTARIOS, ...over });

  it('fecha_libre_2b_debe_renderizar_tipoE1_fecha_disponible', async () => {
    const { useCase, catalogo, actualizarBorrador } = montar({ estadoFecha: FECHA_LIBRE });

    await useCase.ejecutar(comandoConFecha());

    expect(catalogo.render).toHaveBeenCalledWith(
      expect.objectContaining({ tipoE1: 'fecha_disponible', fechaEvento: FECHA }),
    );
    expect(actualizarBorrador.actualizarContenidoBorrador).toHaveBeenCalledTimes(1);
  });

  it('fecha_bloqueada_por_2b_2d_debe_renderizar_tipoE1_fecha_cola', async () => {
    const { useCase, catalogo } = montar({ estadoFecha: BLOQUEADA_POR_2B });

    await useCase.ejecutar(comandoConFecha());

    expect(catalogo.render).toHaveBeenCalledWith(
      expect.objectContaining({ tipoE1: 'fecha_cola' }),
    );
  });

  it('fecha_confirmada_2a_debe_renderizar_tipoE1_fecha_confirmada_con_fechas_alternativas', async () => {
    const fechaAlt1 = new Date('2027-09-11T00:00:00.000Z');
    const fechaAlt2 = new Date('2027-09-13T00:00:00.000Z');
    const fechasAlternativas = crearFechasAlternativasFake({
      anterior: fechaAlt1,
      posterior: fechaAlt2,
    });
    const { useCase, catalogo, fechasAlternativas: fa } = montar({
      estadoFecha: BLOQUEADA_POR_PRERESERVA,
      fechasAlternativas,
    });

    await useCase.ejecutar(comandoConFecha());

    expect(fa.leerAlternativas).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: TENANT, fecha: FECHA }),
    );
    expect(catalogo.render).toHaveBeenCalledWith(
      expect.objectContaining({
        tipoE1: 'fecha_confirmada',
        fechaAlternativa1: fechaAlt1,
        fechaAlternativa2: fechaAlt2,
      }),
    );
  });
});
