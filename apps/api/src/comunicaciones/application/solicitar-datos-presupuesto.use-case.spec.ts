/**
 * TESTS del caso de uso `SolicitarDatosPresupuestoUseCase` (change
 * `solicitud-datos-presupuesto-borrador`).
 * tasks.md Fase 3: §3.1 (texto por idioma es/ca reutilizando la plantilla del E1
 * disponible), §3.2 (crea COMUNICACION `borrador`/`fecha_envio=null`/`E1`/`solicitud_datos`),
 * §3.3 (idempotencia: `enviado` previo → 409 `ComunicacionDuplicadaError`; `borrador`
 * pendiente → REUTILIZA, no duplica), §3.4 (guardas: datos fiscales completos → 422;
 * reserva inexistente → 404; tenant del JWT / RLS y AUDIT_LOG).
 *
 * Trazabilidad: spec-delta `comunicaciones`, Requirement "Solicitud de datos de
 * presupuesto — borrador E1 (subtipo solicitud_datos) reutilizando la plantilla del E1
 * disponible" y Requirement MODIFIED "Idempotencia de un email por reserva y código"
 * (la terna `('E1','solicitud_datos')` es independiente de `('E1','fecha_disponible')`).
 * proposal.md §Decisiones de producto 1 y 2.
 *
 * Ejercita la APLICACIÓN contra DOBLES DE LOS PUERTOS (in-memory), SIN tocar Prisma
 * (hexagonal, hook `no-infra-in-domain`). El borrador se crea DIRECTAMENTE vía
 * `ComunicacionRepositoryPort.crear({ estado:'borrador', … })` con el asunto/cuerpo de
 * `renderMensajeTransicionFecha({ tipo:'disponible', … })` (NO vía `DespacharEmailService`,
 * cuyo render reejecutaría la plantilla del catálogo E1 e ignoraría este texto — patrón
 * `transicion-fecha.use-case`). La invariante REAL del índice UNIQUE parcial sobre la terna
 * `(reserva_id, 'E1', 'solicitud_datos') WHERE estado='enviado'` se verifica en el test de
 * INTEGRACIÓN con Postgres real (sesión principal); aquí se fija la ORQUESTACIÓN.
 */
import {
  SolicitarDatosPresupuestoUseCase,
  ReservaNoEncontradaError,
  DatosFiscalesCompletosError,
  type SolicitarDatosPresupuestoDeps,
  type SolicitarDatosPresupuestoComando,
  type CargarReservaPresupuestoContextoPort,
  type ReservaPresupuestoContexto,
} from './solicitar-datos-presupuesto.use-case';
import {
  ComunicacionDuplicadaError,
  type ComunicacionRepositoryPort,
  type ComunicacionRegistrada,
  type RegistrarComunicacionParams,
} from '../domain/comunicacion.repository.port';
import type { AuditLogPort } from '../../shared/audit/audit-log.port';
import { renderMensajeTransicionFecha } from '../../reservas/application/plantilla-transicion-fecha';

const TENANT = '00000000-0000-0000-0000-000000000001';
const OTRO_TENANT = '00000000-0000-0000-0000-0000000000ff';
const GESTOR = '00000000-0000-0000-0000-000000000002';
const RESERVA_ID = 'res-solicitud-1';
const CLIENTE_ID = 'cli-solicitud-1';
const COM_ID = 'com-solicitud-1';
const EMAIL = 'marta.soler@example.com';
const FECHA_EVENTO = new Date('2026-09-12T00:00:00.000Z');

// ---------------------------------------------------------------------------
// Doble de la RESERVA + CLIENTE cargados para la solicitud de datos.
//   El use-case necesita más contexto que el email manual: el `idioma` de la reserva
//   (es/ca), la `fechaEvento`, `numInvitadosFinal`, `duracionHoras` (para el render de la
//   plantilla del E1 disponible) y los datos fiscales del CLIENTE (para la guarda 422).
// ---------------------------------------------------------------------------

const reservaContexto = (
  over: Partial<ReservaPresupuestoContexto> = {},
): ReservaPresupuestoContexto => ({
  idReserva: RESERVA_ID,
  tenantId: TENANT,
  clienteId: CLIENTE_ID,
  codigo: '29-0007',
  idioma: 'es',
  fechaEvento: FECHA_EVENTO,
  numInvitadosFinal: 80,
  duracionHoras: 6,
  cliente: {
    idCliente: CLIENTE_ID,
    nombre: 'Marta',
    apellidos: 'Soler',
    email: EMAIL,
    telefono: '600100200',
    // Datos fiscales INCOMPLETOS por defecto (falta al menos uno) → procede solicitar.
    dniNif: null,
    direccion: null,
    codigoPostal: null,
    poblacion: null,
    provincia: null,
  },
  ...over,
});

// Datos fiscales COMPLETOS: los cinco campos presentes → NO procede solicitar (422).
const clienteFiscalCompleto = (): ReservaPresupuestoContexto['cliente'] => ({
  idCliente: CLIENTE_ID,
  nombre: 'Marta',
  apellidos: 'Soler',
  email: EMAIL,
  telefono: '600100200',
  dniNif: '12345678Z',
  direccion: 'Calle Mayor 1',
  codigoPostal: '08001',
  poblacion: 'Barcelona',
  provincia: 'Barcelona',
});

// ---------------------------------------------------------------------------
// Dobles de puertos / colaboradores.
// ---------------------------------------------------------------------------

interface Dobles {
  cargar: CargarReservaPresupuestoContextoPort & { cargar: jest.Mock };
  comunicaciones: ComunicacionRepositoryPort & {
    buscarPorReservaYCodigo: jest.Mock;
    crear: jest.Mock;
  };
  auditoria: AuditLogPort & { registrar: jest.Mock };
}

/**
 * Fila `borrador` de la terna `('E1','solicitud_datos')` ya existente para la reserva.
 * El use-case debe REUTILIZARLA (no crear otra) cuando la solicitud se repite y aún no
 * se ha enviado.
 */
const borradorPrevio = (): ComunicacionRegistrada => ({
  idComunicacion: 'com-borrador-previo',
  tenantId: TENANT,
  reservaId: RESERVA_ID,
  clienteId: CLIENTE_ID,
  codigoEmail: 'E1',
  estado: 'borrador',
  destinatarioEmail: EMAIL,
  fechaEnvio: null,
  fechaCreacion: new Date('2026-07-20T09:00:00.000Z'),
  esReenvio: false,
});

/** Fila `enviado` de la misma terna: una segunda solicitud debe dar 409. */
const enviadoPrevio = (): ComunicacionRegistrada => ({
  ...borradorPrevio(),
  idComunicacion: 'com-enviado-previo',
  estado: 'enviado',
  fechaEnvio: new Date('2026-07-21T09:00:00.000Z'),
});

const construirDobles = (
  opts: {
    reserva?: ReservaPresupuestoContexto | null;
    /** Fila existente de la terna `('E1','solicitud_datos')` (borrador o enviado). */
    existente?: ComunicacionRegistrada | null;
  } = {},
): { deps: SolicitarDatosPresupuestoDeps } & Dobles => {
  const reserva =
    opts.reserva === undefined ? reservaContexto() : opts.reserva;
  const existente = opts.existente ?? null;

  const cargar = {
    cargar: jest.fn(async () => reserva),
  } as CargarReservaPresupuestoContextoPort & { cargar: jest.Mock };

  const creada: ComunicacionRegistrada = {
    idComunicacion: COM_ID,
    tenantId: TENANT,
    reservaId: RESERVA_ID,
    clienteId: CLIENTE_ID,
    codigoEmail: 'E1',
    estado: 'borrador',
    destinatarioEmail: EMAIL,
    fechaEnvio: null,
    fechaCreacion: new Date('2026-07-24T10:00:00.000Z'),
    esReenvio: false,
  };

  const comunicaciones = {
    // El use-case consulta la existencia de la terna (borrador o enviado) para decidir
    // entre crear / reutilizar / 409. Devuelve la fila existente inyectada o null.
    buscarPorReservaYCodigo: jest.fn(async () => existente),
    // Camino ÚNICO de creación del borrador (patrón `transicion-fecha`): el use-case
    // persiste directamente el asunto/cuerpo renderizados, sin pasar por el motor.
    crear: jest.fn(async () => creada),
    actualizarEstado: jest.fn(async () => creada),
    actualizarContenidoBorrador: jest.fn(async () => creada),
    listarPorReserva: jest.fn(async () => []),
  } as unknown as ComunicacionRepositoryPort & {
    buscarPorReservaYCodigo: jest.Mock;
    crear: jest.Mock;
  };

  const auditoria = {
    registrar: jest.fn(async () => undefined),
  } as AuditLogPort & { registrar: jest.Mock };

  const deps: SolicitarDatosPresupuestoDeps = {
    cargarReserva: cargar,
    comunicaciones,
    auditoria,
  };
  return { deps, cargar, comunicaciones, auditoria };
};

const comando = (
  over: Partial<SolicitarDatosPresupuestoComando> = {},
): SolicitarDatosPresupuestoComando => ({
  tenantId: TENANT,
  usuarioId: GESTOR,
  reservaId: RESERVA_ID,
  ...over,
});

/** Extrae los parámetros con los que se invocó `comunicaciones.crear` (primer argumento). */
const paramsCrear = (
  comunicaciones: { crear: jest.Mock },
): RegistrarComunicacionParams =>
  comunicaciones.crear.mock.calls[0][0] as RegistrarComunicacionParams;

// ===========================================================================
// 3.1 / 3.2 — Solicitud en CASTELLANO crea un borrador E1 `solicitud_datos`.
// ===========================================================================

describe('SolicitarDatosPresupuestoUseCase — borrador en castellano (3.1/3.2)', () => {
  it('debe_crear_un_borrador_E1_solicitud_datos_sin_fecha_de_envio', async () => {
    const { deps, comunicaciones } = construirDobles();
    const uc = new SolicitarDatosPresupuestoUseCase(deps);

    await uc.ejecutar(comando());

    // Crea el borrador DIRECTAMENTE con el subtipo NUEVO `solicitud_datos` bajo
    // `codigo_email='E1'`, en `estado='borrador'` y sin `fecha_envio`.
    expect(comunicaciones.crear).toHaveBeenCalledTimes(1);
    const creado = paramsCrear(comunicaciones);
    expect(creado.codigoEmail).toBe('E1');
    expect(creado.subtipo).toBe('solicitud_datos');
    expect(creado.estado).toBe('borrador');
    expect(creado.fechaEnvio).toBeNull();
  });

  it('debe_crear_al_email_del_cliente_de_la_reserva_bajo_el_tenant_del_jwt', async () => {
    const { deps, comunicaciones } = construirDobles();
    const uc = new SolicitarDatosPresupuestoUseCase(deps);

    await uc.ejecutar(comando());

    const creado = paramsCrear(comunicaciones);
    expect(creado.tenantId).toBe(TENANT);
    expect(creado.reservaId).toBe(RESERVA_ID);
    expect(creado.clienteId).toBe(CLIENTE_ID);
    expect(creado.destinatarioEmail).toBe(EMAIL);
  });

  it('debe_persistir_verbatim_el_cuerpo_y_asunto_de_la_plantilla_del_E1_disponible_en_castellano', async () => {
    const { deps, comunicaciones } = construirDobles();
    const uc = new SolicitarDatosPresupuestoUseCase(deps);

    await uc.ejecutar(comando());

    // El texto persistido es EXACTAMENTE el de `renderMensajeTransicionFecha({
    // tipo:'disponible' })` en castellano (no se reescribe copy) — NO el de la plantilla
    // del catálogo E1 (respuesta inicial). Éste es el bug que un motor fake enmascaró.
    const esperado = renderMensajeTransicionFecha({
      tipo: 'disponible',
      idioma: 'es',
      nombre: 'Marta',
      fechaEvento: FECHA_EVENTO,
      personas: 80,
      horas: 6,
    });
    const creado = paramsCrear(comunicaciones);
    expect(creado.asunto).toBe(esperado.asunto);
    expect(creado.asunto).toBe('Pre-reserva confirmada');
    expect(creado.cuerpo).toBe(esperado.cuerpo);
    expect(creado.cuerpo).toContain(
      'Para poder prepararte el presupuesto, necesitaría los siguientes datos:',
    );
    expect(creado.cuerpo).toContain('Nombre y apellidos / DNI / Dirección y población');
    // NO debe ser la plantilla del catálogo E1 (respuesta inicial automática).
    expect(creado.cuerpo).not.toContain('Hemos recibido tu consulta');
  });

  it('debe_devolver_la_comunicacion_creada_con_estado_borrador_y_fecha_envio_nula', async () => {
    const { deps } = construirDobles();
    const uc = new SolicitarDatosPresupuestoUseCase(deps);

    const resultado = await uc.ejecutar(comando());

    expect(resultado.estado).toBe('borrador');
    expect(resultado.fechaEnvio).toBeNull();
    expect(resultado.codigoEmail).toBe('E1');
    expect(resultado.reutilizado).toBe(false);
    expect(resultado.idComunicacion).toBe(COM_ID);
  });

  it('debe_registrar_la_operacion_en_audit_log_bajo_el_tenant_del_jwt', async () => {
    const { deps, auditoria } = construirDobles();
    const uc = new SolicitarDatosPresupuestoUseCase(deps);

    await uc.ejecutar(comando());

    expect(auditoria.registrar).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: TENANT, entidad: 'COMUNICACION' }),
    );
  });
});

// ===========================================================================
// 3.1 — Solicitud en CATALÁN usa el texto catalán de la plantilla.
// ===========================================================================

describe('SolicitarDatosPresupuestoUseCase — borrador en catalán (3.1)', () => {
  it('debe_persistir_el_cuerpo_catalan_cuando_idioma_es_ca', async () => {
    const { deps, comunicaciones } = construirDobles({
      reserva: reservaContexto({ idioma: 'ca' }),
    });
    const uc = new SolicitarDatosPresupuestoUseCase(deps);

    await uc.ejecutar(comando());

    const creado = paramsCrear(comunicaciones);
    expect(creado.cuerpo).toContain(
      'Per poder-te preparar el pressupost, necessitaria les següents dades:',
    );
    expect(creado.cuerpo).toContain('Nom i cognoms / DNI / Adreça i població');
  });
});

// ===========================================================================
// 3.3 — Idempotencia: una sola vez.
// ===========================================================================

describe('SolicitarDatosPresupuestoUseCase — idempotencia una sola vez (3.3)', () => {
  it('debe_rechazar_con_409_cuando_ya_existe_una_solicitud_enviada', async () => {
    const { deps, comunicaciones } = construirDobles({
      existente: enviadoPrevio(),
    });
    const uc = new SolicitarDatosPresupuestoUseCase(deps);

    await expect(uc.ejecutar(comando())).rejects.toBeInstanceOf(
      ComunicacionDuplicadaError,
    );
    // No crea otra fila.
    expect(comunicaciones.crear).not.toHaveBeenCalled();
  });

  it('debe_reutilizar_el_borrador_pendiente_sin_crear_uno_nuevo', async () => {
    const previo = borradorPrevio();
    const { deps, comunicaciones } = construirDobles({ existente: previo });
    const uc = new SolicitarDatosPresupuestoUseCase(deps);

    const resultado = await uc.ejecutar(comando());

    // Reutiliza: NO crea otra fila; devuelve el existente marcado `reutilizado`.
    expect(comunicaciones.crear).not.toHaveBeenCalled();
    expect(resultado.idComunicacion).toBe(previo.idComunicacion);
    expect(resultado.reutilizado).toBe(true);
    expect(resultado.estado).toBe('borrador');
  });
});

// ===========================================================================
// 3.4 — Guarda de datos fiscales completos → 422.
// ===========================================================================

describe('SolicitarDatosPresupuestoUseCase — datos fiscales completos (422)', () => {
  it('debe_rechazar_cuando_los_datos_fiscales_del_cliente_estan_completos', async () => {
    const { deps, comunicaciones } = construirDobles({
      reserva: reservaContexto({ cliente: clienteFiscalCompleto() }),
    });
    const uc = new SolicitarDatosPresupuestoUseCase(deps);

    await expect(uc.ejecutar(comando())).rejects.toBeInstanceOf(
      DatosFiscalesCompletosError,
    );
    // No crea ninguna COMUNICACION.
    expect(comunicaciones.crear).not.toHaveBeenCalled();
  });

  it('debe_exponer_un_error_de_validacion_mapeable_a_422', async () => {
    const { deps } = construirDobles({
      reserva: reservaContexto({ cliente: clienteFiscalCompleto() }),
    });
    const uc = new SolicitarDatosPresupuestoUseCase(deps);

    await expect(uc.ejecutar(comando())).rejects.toMatchObject({
      codigo: 'datos_fiscales_completos',
    });
  });
});

// ===========================================================================
// 3.4 — Reserva inexistente / de otro tenant (RLS) → 404, sin efectos.
// ===========================================================================

describe('SolicitarDatosPresupuestoUseCase — reserva inexistente o de otro tenant (404)', () => {
  it('debe_lanzar_ReservaNoEncontrada_cuando_no_existe_para_el_tenant', async () => {
    const { deps, comunicaciones } = construirDobles({ reserva: null });
    const uc = new SolicitarDatosPresupuestoUseCase(deps);

    await expect(uc.ejecutar(comando())).rejects.toBeInstanceOf(
      ReservaNoEncontradaError,
    );
    expect(comunicaciones.crear).not.toHaveBeenCalled();
  });

  it('debe_cargar_la_reserva_scoped_por_el_tenant_del_jwt', async () => {
    const { deps, cargar } = construirDobles();
    const uc = new SolicitarDatosPresupuestoUseCase(deps);

    await uc.ejecutar(comando());

    expect(cargar.cargar).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: TENANT, reservaId: RESERVA_ID }),
    );
  });

  it('debe_rechazar_la_solicitud_para_una_reserva_de_otro_tenant', async () => {
    const { deps, comunicaciones } = construirDobles({ reserva: null });
    const uc = new SolicitarDatosPresupuestoUseCase(deps);

    await expect(
      uc.ejecutar(comando({ tenantId: OTRO_TENANT })),
    ).rejects.toBeInstanceOf(ReservaNoEncontradaError);
    expect(comunicaciones.crear).not.toHaveBeenCalled();
  });
});

// ===========================================================================
// 3.2 (opcional) — Placeholders `___` cuando faltan personas/horas.
//   Comportamiento heredado de la plantilla del E1 disponible: `null` → `___`. El
//   use-case debe propagar `numInvitadosFinal`/`duracionHoras` nulos tal cual.
// ===========================================================================

describe('SolicitarDatosPresupuestoUseCase — placeholders cuando faltan personas/horas', () => {
  it('debe_interpolar_placeholder_cuando_num_invitados_y_horas_son_nulos', async () => {
    const { deps, comunicaciones } = construirDobles({
      reserva: reservaContexto({ numInvitadosFinal: null, duracionHoras: null }),
    });
    const uc = new SolicitarDatosPresupuestoUseCase(deps);

    await uc.ejecutar(comando());

    // La plantilla interpola `___` en "para ___ personas y ___ horas".
    const creado = paramsCrear(comunicaciones);
    expect(creado.cuerpo).toContain('___');
  });
});
