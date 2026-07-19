/**
 * TESTS del caso de uso `AltaConsultaUseCase` (US-003 / UC-03) — fase TDD RED.
 * tasks.md Fase 3: 3.2, 3.3, 3.4, 3.5, 3.6, 3.7.
 *
 * Trazabilidad: US-003, spec-delta `consultas` (Requirements: "Alta de consulta
 * exploratoria sin fecha crea una RESERVA en 2.a", "La consulta exploratoria no
 * calcula tarifa", "Respuesta inicial automática E1 según el campo comentarios",
 * "Creación idempotente de CLIENTE por tenant y email", "Auditoría del alta en
 * AUDIT_LOG", "Validación de campos y rechazo sin efectos colaterales"),
 * design.md §1 (puerto de email + lógica E1 en la aplicación), §2 (sin tarifa /
 * sin FECHA_BLOQUEADA en 2.a), §4 (RLS + transacción única + find-or-create).
 *
 * Ejercita el caso de uso de APLICACIÓN contra DOBLES DE LOS PUERTOS (in-memory),
 * sin tocar Prisma ni la BD (hexagonal, hook `no-infra-in-domain`). La ATOMICIDAD
 * real (todo dentro de un `$transaction` con `fijarTenant`, all-or-nothing en
 * PostgreSQL) se verifica en QA contra la BD real (tasks.md 6.4/7.2); aquí se
 * verifica la ORQUESTACIÓN: que toda la escritura ocurre DENTRO de la unidad de
 * trabajo transaccional y que el efecto post-commit (envío E1) solo corre tras un
 * commit exitoso.
 *
 * Cubre:
 *   - 3.2: crea RESERVA + CLIENTE + COMUNICACION + AUDIT_LOG en una única unidad
 *     de trabajo; NO crea FECHA_BLOQUEADA y NO calcula tarifa (sin fecha en 2.a).
 *   - 3.3: E1 — sin `comentarios` → COMUNICACION estado='enviado' + puerto de
 *     email invocado; con `comentarios` → estado='borrador' + puerto NO invocado.
 *   - 3.4: idempotencia de CLIENTE por (tenant_id, email) — find-or-create.
 *   - 3.5: AUDIT_LOG accion='crear', entidad='RESERVA', datos_nuevos presentes.
 *   - 3.6: validación (obligatorios / email / canal_entrada) → no crea NADA.
 *   - 3.7: fallo a mitad de la transacción → rollback total (no post-commit).
 *
 * RED: aún no existen `reservas/application/alta-consulta.use-case.ts` ni
 * `comunicaciones/domain/enviar-email.port.ts`; los imports fallan y la batería
 * está en ROJO. GREEN es responsabilidad de `backend-developer`.
 */
import {
  AltaConsultaUseCase,
  AltaConsultaValidacionError,
  type AltaConsultaComando,
  type AltaConsultaResultado,
  type AltaConsultaDeps,
  type RepositoriosAltaConsulta,
  type UnidadDeTrabajoPort,
  type ClienteRepositoryPort,
  type ClienteParaAlta,
  type ReservaRepositoryPort,
  type ReservaParaAlta,
  type ComunicacionRepositoryPort,
  type ComunicacionParaAlta,
  type ClockPort,
  type FinalizarEnvioEmailPort,
  type FinalizarEnvioEmailResultado,
} from '../application/alta-consulta.use-case';
import type { AuditLogPort } from '../../shared/audit/audit-log.port';

// ---------------------------------------------------------------------------
// Datos canónicos (alineados con apps/api/prisma/seed.ts — Masia l'Encís)
// ---------------------------------------------------------------------------

const TENANT = '00000000-0000-0000-0000-000000000001';
const GESTOR = '00000000-0000-0000-0000-0000000000a1';
const EMAIL = 'marta.soler@example.com';

// ---------------------------------------------------------------------------
// Dobles de puertos (in-memory). El caso de uso depende de estas INTERFACES.
// ---------------------------------------------------------------------------

type ClientesFake = ClienteRepositoryPort & {
  buscarPorEmail: jest.Mock;
  crear: jest.Mock;
};
type ReservasFake = ReservaRepositoryPort & { crear: jest.Mock };
type ComunicacionesFake = ComunicacionRepositoryPort & { crear: jest.Mock };
type AuditFake = AuditLogPort & { registrar: jest.Mock };
type FinalizarFake = FinalizarEnvioEmailPort & { finalizarEnvio: jest.Mock };
type UowFake = UnidadDeTrabajoPort & { ejecutar: jest.Mock };

interface ReposFake extends RepositoriosAltaConsulta {
  clientes: ClientesFake;
  reservas: ReservasFake;
  comunicaciones: ComunicacionesFake;
  auditoria: AuditFake;
}

const clienteExistente = (over: Partial<ClienteParaAlta> = {}): ClienteParaAlta => ({
  idCliente: 'cli-existente',
  tenantId: TENANT,
  nombre: 'Marta',
  apellidos: 'Soler',
  email: EMAIL,
  telefono: '600111222',
  ...over,
});

/** Repos fake: por defecto el CLIENTE NO existe (find-or-create crea uno nuevo). */
const crearReposFake = (clientePrevio: ClienteParaAlta | null = null): ReposFake => {
  const clientes: ClientesFake = {
    buscarPorEmail: jest.fn(async () => clientePrevio),
    crear: jest.fn(
      async (p: {
        tenantId: string;
        nombre: string;
        apellidos: string;
        email: string;
        telefono: string;
      }): Promise<ClienteParaAlta> => ({
        idCliente: 'cli-nuevo',
        tenantId: p.tenantId,
        nombre: p.nombre,
        apellidos: p.apellidos,
        email: p.email,
        telefono: p.telefono,
      }),
    ),
  };
  const reservas: ReservasFake = {
    crear: jest.fn(
      async (p: {
        tenantId: string;
        clienteId: string;
        estado: 'consulta';
        subEstado: '2a';
        ttlExpiracion: null;
        canalEntrada: AltaConsultaComando['canalEntrada'];
      }): Promise<ReservaParaAlta> => ({
        idReserva: 'res-1',
        tenantId: p.tenantId,
        clienteId: p.clienteId,
        codigo: '26-0001',
        estado: p.estado,
        subEstado: p.subEstado,
        ttlExpiracion: p.ttlExpiracion,
        canalEntrada: p.canalEntrada,
      }),
    ),
  };
  const comunicaciones: ComunicacionesFake = {
    crear: jest.fn(
      async (p: {
        tenantId: string;
        reservaId: string;
        clienteId: string;
        codigoEmail: 'E1';
        estado: 'enviado' | 'borrador';
        destinatarioEmail: string;
        fechaEnvio: Date | null;
      }): Promise<ComunicacionParaAlta> => ({
        idComunicacion: 'com-1',
        tenantId: p.tenantId,
        reservaId: p.reservaId,
        clienteId: p.clienteId,
        codigoEmail: p.codigoEmail,
        estado: p.estado,
        destinatarioEmail: p.destinatarioEmail,
        fechaEnvio: p.fechaEnvio,
      }),
    ),
  };
  const auditoria: AuditFake = { registrar: jest.fn(async () => undefined) };
  return { clientes, reservas, comunicaciones, auditoria };
};

/**
 * Unidad de trabajo fake: invoca el `trabajo` con los repos in-memory y propaga
 * cualquier rechazo (modela el rollback de la transacción real). El `fijarTenant`
 * + `$transaction` es responsabilidad del ADAPTADOR (verificado en integración).
 */
const crearUowFake = (repos: ReposFake): UowFake => ({
  ejecutar: jest.fn(
    async <T,>(_tenantId: string, trabajo: (r: RepositoriosAltaConsulta) => Promise<T>) =>
      trabajo(repos),
  ),
});

/**
 * Doble del motor de email (`DespacharEmailService.finalizarEnvio`): por defecto el
 * proveedor acepta → `enviado` + `fecha_envio`. Configurable para simular `fallido`.
 */
const crearFinalizarFake = (
  resultado: FinalizarEnvioEmailResultado = {
    estado: 'enviado',
    fechaEnvio: new Date('2026-06-28T10:00:00.000Z'),
  },
): FinalizarFake => ({ finalizarEnvio: jest.fn(async () => resultado) });

const relojFijo = (iso = '2026-06-28T10:00:00.000Z'): ClockPort => ({
  ahora: () => new Date(iso),
});

const montar = (opts?: {
  repos?: ReposFake;
  uow?: UowFake;
  finalizarEnvio?: FinalizarFake;
  clock?: ClockPort;
}) => {
  const repos = opts?.repos ?? crearReposFake();
  const uow = opts?.uow ?? crearUowFake(repos);
  const finalizarEnvio = opts?.finalizarEnvio ?? crearFinalizarFake();
  const clock = opts?.clock ?? relojFijo();
  const deps: AltaConsultaDeps = { unidadDeTrabajo: uow, finalizarEnvio, clock };
  return { useCase: new AltaConsultaUseCase(deps), repos, uow, finalizarEnvio, clock };
};

const comandoBase = (
  over: Partial<AltaConsultaComando> = {},
  clienteOver: Partial<AltaConsultaComando['cliente']> = {},
): AltaConsultaComando => ({
  tenantId: TENANT,
  usuarioId: GESTOR,
  canalEntrada: 'web',
  cliente: {
    nombre: 'Marta',
    apellidos: 'Soler',
    email: EMAIL,
    telefono: '600111222',
    ...clienteOver,
  },
  ...over,
});

// ===========================================================================
// 3.2 — Crea RESERVA + CLIENTE + COMUNICACION + AUDIT_LOG en una transacción;
//        NO crea FECHA_BLOQUEADA y NO calcula tarifa (2.a sin fecha).
// ===========================================================================

describe('AltaConsultaUseCase — crea el agregado en una única transacción (3.2)', () => {
  it('debe_crear_cliente_reserva_comunicacion_y_auditoria_exactamente_una_vez', async () => {
    const { useCase, repos } = montar();

    await useCase.ejecutar(comandoBase());

    expect(repos.clientes.crear).toHaveBeenCalledTimes(1);
    expect(repos.reservas.crear).toHaveBeenCalledTimes(1);
    expect(repos.comunicaciones.crear).toHaveBeenCalledTimes(1);
    expect(repos.auditoria.registrar).toHaveBeenCalledTimes(1);
  });

  it('debe_ejecutar_toda_la_escritura_dentro_de_la_unidad_de_trabajo_transaccional', async () => {
    const { useCase, uow } = montar();

    await useCase.ejecutar(comandoBase());

    // La unidad de trabajo se abre UNA vez con el tenant del JWT (RLS): todas las
    // escrituras (incl. AUDIT_LOG) viven dentro de esa transacción única.
    expect(uow.ejecutar).toHaveBeenCalledTimes(1);
    expect(uow.ejecutar.mock.calls[0][0]).toBe(TENANT);
  });

  it('debe_crear_la_reserva_en_consulta_2a_con_ttl_expiracion_null', async () => {
    const { useCase, repos } = montar();

    await useCase.ejecutar(comandoBase());

    const args = repos.reservas.crear.mock.calls[0][0];
    expect(args.estado).toBe('consulta');
    expect(args.subEstado).toBe('2a');
    expect(args.ttlExpiracion).toBeNull();
    expect(args.canalEntrada).toBe('web');
  });

  it('no_debe_crear_FECHA_BLOQUEADA_ni_depender_de_un_puerto_de_bloqueo_en_2a', async () => {
    // En 2.a (sin fecha) la consulta es una FASE de la RESERVA, no una entidad
    // con bloqueo: el caso de uso NO recibe ningún repositorio de FECHA_BLOQUEADA.
    const { useCase, repos } = montar();

    await useCase.ejecutar(comandoBase());

    expect(Object.keys(repos).sort()).toEqual(
      ['auditoria', 'clientes', 'comunicaciones', 'reservas'].sort(),
    );
    expect(Object.keys(repos)).not.toContain('fechaBloqueada');
  });

  it('no_debe_calcular_ni_asignar_tarifa_cuando_no_hay_fecha_pero_si_almacena_invitados_y_horas', async () => {
    // spec-delta "La consulta exploratoria no calcula tarifa": guarda los
    // opcionales (invitados/horas/tipo) pero NO asigna ningún importe.
    const { useCase, repos } = montar();

    await useCase.ejecutar(
      comandoBase({
        tipoEvento: 'boda',
        duracionHoras: 8,
        numAdultosNinosMayores4: 80,
        numNinosMenores4: 5,
      }),
    );

    const args = repos.reservas.crear.mock.calls[0][0];
    expect(args.tipoEvento).toBe('boda');
    expect(args.duracionHoras).toBe(8);
    expect(args.numAdultosNinosMayores4).toBe(80);
    // Ningún importe de tarifa se calcula ni se persiste sin fecha (UC-16).
    expect(args).not.toHaveProperty('importeTotal');
    expect(args).not.toHaveProperty('importeSenal');
    expect(args).not.toHaveProperty('importeLiquidacion');
  });

  it('debe_devolver_la_reserva_el_cliente_y_la_comunicacion_creados', async () => {
    const { useCase } = montar();

    const out: AltaConsultaResultado = await useCase.ejecutar(comandoBase());

    expect(out.reserva.idReserva).toBe('res-1');
    expect(out.cliente.idCliente).toBe('cli-nuevo');
    expect(out.comunicacion.codigoEmail).toBe('E1');
  });
});

// ===========================================================================
// mejoras-detalle-consulta 3.1 — Persistencia de `comentarios` en RESERVA.
//   El alta persiste `comando.comentarios` en `repos.reservas.crear({...})`
//   (columna nueva RESERVA.comentarios) SIN cambiar la decisión de E1.
//   RED esperado: hoy el objeto pasado a `crear` NO incluye `comentarios`.
// ===========================================================================

describe('AltaConsultaUseCase — persistencia de comentarios en RESERVA (mejoras-detalle-consulta 3.1)', () => {
  it('debe_persistir_comentarios_en_la_reserva_cuando_el_alta_los_trae', async () => {
    const { useCase, repos } = montar();

    await useCase.ejecutar(comandoBase({ comentarios: 'Llamar el lunes, lead caliente' }));

    const args = repos.reservas.crear.mock.calls[0][0];
    expect(args.comentarios).toBe('Llamar el lunes, lead caliente');
  });

  it('no_debe_pasar_comentarios_a_la_reserva_cuando_el_alta_no_los_trae', async () => {
    // Sin comentarios: la columna nace NULL. El caso de uso NO envía la propiedad
    // (o la envía undefined), igual que hace hoy con `notas`/`tipoEvento`.
    const { useCase, repos } = montar();

    await useCase.ejecutar(comandoBase());

    const args = repos.reservas.crear.mock.calls[0][0];
    expect(args.comentarios).toBeUndefined();
  });

  it('debe_tratar_comentarios_en_blanco_como_ausentes_y_no_persistirlos', async () => {
    // Cadena de solo espacios = ausente (misma semántica que la decisión de E1):
    // no se persiste (columna NULL), coherente con `tieneComentarios`.
    const { useCase, repos } = montar();

    await useCase.ejecutar(comandoBase({ comentarios: '   ' }));

    const args = repos.reservas.crear.mock.calls[0][0];
    expect(args.comentarios).toBeUndefined();
  });

  it('debe_persistir_comentarios_recortados_trim_cuando_traen_espacios_alrededor', async () => {
    // El texto útil se guarda sin espacios de borde (trim), preservando el contenido.
    const { useCase, repos } = montar();

    await useCase.ejecutar(comandoBase({ comentarios: '  Alergias: frutos secos  ' }));

    const args = repos.reservas.crear.mock.calls[0][0];
    expect(args.comentarios).toBe('Alergias: frutos secos');
  });

  it('no_debe_cambiar_la_decision_de_E1_por_persistir_comentarios_con_comentarios_es_borrador', async () => {
    // REGRESIÓN: persistir NO altera el flujo de E1. Con comentarios → borrador,
    // el motor de envío NO se invoca.
    const { useCase, finalizarEnvio } = montar();

    const out = await useCase.ejecutar(comandoBase({ comentarios: 'texto' }));

    expect(finalizarEnvio.finalizarEnvio).not.toHaveBeenCalled();
    expect(out.comunicacion.estado).toBe('borrador');
  });

  it('no_debe_cambiar_la_decision_de_E1_por_persistir_comentarios_sin_comentarios_auto_envia', async () => {
    // REGRESIÓN: sin comentarios → auto-envío intacto.
    const { useCase, finalizarEnvio } = montar();

    const out = await useCase.ejecutar(comandoBase());

    expect(finalizarEnvio.finalizarEnvio).toHaveBeenCalledTimes(1);
    expect(out.comunicacion.estado).toBe('enviado');
  });
});

// ===========================================================================
// 3.3 — Respuesta inicial automática E1 según `comentarios`.
// ===========================================================================

describe('AltaConsultaUseCase — E1 según comentarios (3.3)', () => {
  it('debe_crear_E1_en_borrador_dentro_de_la_tx_y_promoverla_a_enviado_via_el_motor_cuando_no_hay_comentarios', async () => {
    const { useCase, repos, finalizarEnvio } = montar();

    const out = await useCase.ejecutar(comandoBase()); // sin `comentarios`

    // Invariante: la fila NACE en `borrador` (estado NO final, sin fecha) DENTRO de
    // la transacción, preservando la atomicidad con la reserva (US-003).
    const args = repos.comunicaciones.crear.mock.calls[0][0];
    expect(args.codigoEmail).toBe('E1');
    expect(args.estado).toBe('borrador');
    expect(args.destinatarioEmail).toBe(EMAIL);
    expect(args.fechaEnvio).toBeNull();
    // Auto-envío: se DELEGA en el motor (decisión 6), que envía y promueve la fila.
    expect(finalizarEnvio.finalizarEnvio).toHaveBeenCalledTimes(1);
    expect(finalizarEnvio.finalizarEnvio).toHaveBeenCalledWith(
      expect.objectContaining({
        destinatario: EMAIL,
        codigoEmail: 'E1',
        reservaId: 'res-1',
        idComunicacion: 'com-1',
      }),
    );
    // Estado OBSERVABLE final tras el éxito del envío: enviado + fecha_envio.
    expect(out.comunicacion.estado).toBe('enviado');
    expect(out.comunicacion.fechaEnvio).toBeInstanceOf(Date);
  });

  it('debe_dejar_la_comunicacion_E1_en_borrador_y_NO_delegar_el_envio_cuando_hay_comentarios', async () => {
    const { useCase, repos, finalizarEnvio } = montar();

    const out = await useCase.ejecutar(comandoBase({ comentarios: 'Llamar el lunes, lead caliente' }));

    const args = repos.comunicaciones.crear.mock.calls[0][0];
    expect(args.codigoEmail).toBe('E1');
    expect(args.estado).toBe('borrador');
    // Borrador pendiente de revisión: el motor NO se invoca y la fila se queda así.
    expect(finalizarEnvio.finalizarEnvio).not.toHaveBeenCalled();
    expect(out.comunicacion.estado).toBe('borrador');
    expect(out.comunicacion.fechaEnvio).toBeNull();
  });

  it('debe_tratar_comentarios_vacios_o_en_blanco_como_ausentes_y_auto_enviar', async () => {
    // El contrato define la PRESENCIA de comentarios; cadena vacía/espacios = ausente.
    const { useCase, finalizarEnvio } = montar();

    const out = await useCase.ejecutar(comandoBase({ comentarios: '   ' }));

    expect(finalizarEnvio.finalizarEnvio).toHaveBeenCalledTimes(1);
    expect(out.comunicacion.estado).toBe('enviado');
  });

  it('no_debe_enviar_el_email_dentro_de_la_transaccion_sino_despues_del_commit', async () => {
    // El envío E1 es un efecto POST-COMMIT: solo corre tras resolver la unidad de
    // trabajo (no debe quedar acoplado al rollback de la transacción).
    const { useCase, uow, finalizarEnvio } = montar();

    await useCase.ejecutar(comandoBase());

    expect(uow.ejecutar).toHaveBeenCalledTimes(1);
    expect(finalizarEnvio.finalizarEnvio).toHaveBeenCalledTimes(1);
    const ordenUow = uow.ejecutar.mock.invocationCallOrder[0];
    const ordenEmail = finalizarEnvio.finalizarEnvio.mock.invocationCallOrder[0];
    expect(ordenEmail).toBeGreaterThan(ordenUow);
  });
});

// ===========================================================================
// 3.3bis — Fallo del proveedor en el alta (E1 fallido): la COMUNICACION queda
//           `fallido` sin fecha, el alta NO se tumba (responde 201) — B1.
// ===========================================================================

describe('AltaConsultaUseCase — fallo del proveedor en el alta (E1 fallido)', () => {
  it('debe_dejar_E1_en_fallido_sin_fecha_y_NO_tumbar_el_alta_cuando_el_proveedor_falla', async () => {
    // El motor (finalizarEnvio) centraliza el camino de fallo: marca `fallido` +
    // AUDIT_LOG (verificado en el spec del motor) y NO propaga excepción. El alta ya
    // está commiteada → el caso de uso resuelve igualmente (HTTP 201 en el controller).
    const finalizarEnvio = crearFinalizarFake({ estado: 'fallido', fechaEnvio: null });
    const { useCase, repos } = montar({ finalizarEnvio });

    const out = await useCase.ejecutar(comandoBase()); // sin comentarios

    // La fila se creó (dentro de la tx) en `borrador`; el motor la promovió a fallido.
    expect(repos.comunicaciones.crear.mock.calls[0][0].estado).toBe('borrador');
    expect(finalizarEnvio.finalizarEnvio).toHaveBeenCalledTimes(1);
    expect(out.comunicacion.estado).toBe('fallido');
    expect(out.comunicacion.fechaEnvio).toBeNull();
    // La reserva se devuelve igualmente (el fallo de email no aborta el alta).
    expect(out.reserva.idReserva).toBe('res-1');
  });

  it('no_debe_rechazar_el_alta_por_un_fallo_de_email_resuelve_siempre', async () => {
    const finalizarEnvio = crearFinalizarFake({ estado: 'fallido', fechaEnvio: null });
    const { useCase } = montar({ finalizarEnvio });

    await expect(useCase.ejecutar(comandoBase())).resolves.toBeDefined();
  });
});

// ===========================================================================
// 3.4 — Idempotencia de CLIENTE por (tenant_id, email): find-or-create.
// ===========================================================================

describe('AltaConsultaUseCase — find-or-create de CLIENTE (3.4)', () => {
  it('debe_crear_un_cliente_nuevo_cuando_no_existe_uno_con_ese_email_en_el_tenant', async () => {
    const repos = crearReposFake(null); // no hay cliente previo
    const { useCase } = montar({ repos });

    await useCase.ejecutar(comandoBase());

    expect(repos.clientes.buscarPorEmail).toHaveBeenCalledWith({ tenantId: TENANT, email: EMAIL });
    expect(repos.clientes.crear).toHaveBeenCalledTimes(1);
  });

  it('debe_reutilizar_el_cliente_existente_y_no_duplicarlo_cuando_el_email_ya_existe', async () => {
    const previo = clienteExistente();
    const repos = crearReposFake(previo);
    const { useCase } = montar({ repos });

    const out = await useCase.ejecutar(comandoBase());

    // No se crea otro CLIENTE: se reutiliza el existente y la RESERVA lo referencia.
    expect(repos.clientes.crear).not.toHaveBeenCalled();
    expect(repos.reservas.crear.mock.calls[0][0].clienteId).toBe(previo.idCliente);
    expect(out.cliente.idCliente).toBe(previo.idCliente);
  });

  it('debe_resolver_el_cliente_dentro_de_la_misma_unidad_de_trabajo_del_alta', async () => {
    // La resolución (buscar/crear) ocurre bajo el contexto RLS del tenant, dentro
    // de la transacción del alta (no en una conexión aparte).
    const repos = crearReposFake(null);
    const { useCase, uow } = montar({ repos });

    await useCase.ejecutar(comandoBase());

    const ordenUow = uow.ejecutar.mock.invocationCallOrder[0];
    const ordenBuscar = repos.clientes.buscarPorEmail.mock.invocationCallOrder[0];
    expect(ordenBuscar).toBeGreaterThan(ordenUow);
  });
});

// ===========================================================================
// 3.5 — AUDIT_LOG: accion='crear', entidad='RESERVA', datos_nuevos presentes.
// ===========================================================================

describe('AltaConsultaUseCase — auditoría del alta (3.5)', () => {
  it('debe_registrar_un_audit_log_crear_RESERVA_con_el_usuario_y_datos_nuevos', async () => {
    const { useCase, repos } = montar();

    await useCase.ejecutar(comandoBase());

    expect(repos.auditoria.registrar).toHaveBeenCalledTimes(1);
    const registro = repos.auditoria.registrar.mock.calls[0][0];
    expect(registro.tenantId).toBe(TENANT);
    expect(registro.accion).toBe('crear');
    expect(registro.entidad).toBe('RESERVA'); // UPPER_SNAKE, igual que el módulo reservas
    expect(registro.usuarioId).toBe(GESTOR);
    expect(registro.datosNuevos).toBeDefined();
    expect(registro.datosNuevos).toMatchObject({ idReserva: 'res-1' });
  });

  it('debe_referenciar_la_reserva_creada_en_la_entidad_id_de_la_auditoria', async () => {
    const { useCase, repos } = montar();

    await useCase.ejecutar(comandoBase());

    expect(repos.auditoria.registrar.mock.calls[0][0].entidadId).toBe('res-1');
  });
});

// ===========================================================================
// 3.6 — Validación: rechazo SIN efectos colaterales (no crea NADA).
// ===========================================================================

describe('AltaConsultaUseCase — validación sin efectos colaterales (3.6)', () => {
  const esperarRechazoSinEfectos = async (comando: AltaConsultaComando) => {
    const { useCase, uow, finalizarEnvio } = montar();

    await expect(useCase.ejecutar(comando)).rejects.toBeInstanceOf(AltaConsultaValidacionError);

    // Validación PREVIA a abrir la transacción: nada se escribe, nada se envía.
    expect(uow.ejecutar).not.toHaveBeenCalled();
    expect(finalizarEnvio.finalizarEnvio).not.toHaveBeenCalled();
  };

  it('debe_rechazar_cuando_el_nombre_esta_vacio', async () => {
    await esperarRechazoSinEfectos(comandoBase({}, { nombre: '' }));
  });

  it('debe_rechazar_cuando_los_apellidos_estan_vacios', async () => {
    await esperarRechazoSinEfectos(comandoBase({}, { apellidos: '   ' }));
  });

  it('debe_rechazar_cuando_el_telefono_esta_vacio', async () => {
    await esperarRechazoSinEfectos(comandoBase({}, { telefono: '' }));
  });

  it('debe_rechazar_cuando_el_nombre_supera_los_100_caracteres', async () => {
    await esperarRechazoSinEfectos(comandoBase({}, { nombre: 'x'.repeat(101) }));
  });

  it('debe_rechazar_cuando_el_email_no_tiene_arroba', async () => {
    await esperarRechazoSinEfectos(comandoBase({}, { email: 'correo-sin-arroba' }));
  });

  it('debe_rechazar_cuando_el_email_no_tiene_dominio_con_punto', async () => {
    await esperarRechazoSinEfectos(comandoBase({}, { email: 'usuario@dominio' }));
  });

  it('debe_rechazar_cuando_el_canal_entrada_esta_fuera_del_enum', async () => {
    await esperarRechazoSinEfectos(
      comandoBase({ canalEntrada: 'fax' as AltaConsultaComando['canalEntrada'] }),
    );
  });

  it('debe_exponer_el_campo_afectado_en_el_error_de_validacion', async () => {
    const { useCase } = montar();

    const error = await useCase
      .ejecutar(comandoBase({}, { email: 'correo-sin-arroba' }))
      .catch((e: unknown) => e as AltaConsultaValidacionError);

    expect(error).toBeInstanceOf(AltaConsultaValidacionError);
    expect(error.errores.map((x: { campo: string; mensaje: string }) => x.campo)).toContain(
      'email',
    );
  });

  it('debe_seguir_sin_crear_nada_al_reintentar_con_los_mismos_datos_invalidos_idempotencia', async () => {
    const { useCase, uow } = montar();

    await useCase.ejecutar(comandoBase({}, { email: 'malo' })).catch(() => undefined);
    await useCase.ejecutar(comandoBase({}, { email: 'malo' })).catch(() => undefined);

    expect(uow.ejecutar).not.toHaveBeenCalled();
  });
});

// ===========================================================================
// 3.7 — Atomicidad transaccional: fallo a mitad → rollback total.
// ===========================================================================

describe('AltaConsultaUseCase — atomicidad transaccional (3.7)', () => {
  it('debe_propagar_el_error_si_falla_la_creacion_de_la_reserva_a_mitad_de_la_transaccion', async () => {
    const repos = crearReposFake(null);
    repos.reservas.crear.mockRejectedValueOnce(new Error('fallo DB a mitad del alta'));
    const { useCase } = montar({ repos });

    await expect(useCase.ejecutar(comandoBase())).rejects.toThrow('fallo DB a mitad del alta');
  });

  it('no_debe_disparar_el_envio_E1_si_la_transaccion_falla_rollback_total', async () => {
    // Si algo falla DENTRO de la unidad de trabajo, el commit no ocurre y el
    // efecto post-commit (delegación al motor) NO debe ejecutarse: no hay envío "huérfano".
    const repos = crearReposFake(null);
    repos.comunicaciones.crear.mockRejectedValueOnce(new Error('fallo al persistir E1'));
    const { useCase, finalizarEnvio } = montar({ repos });

    await useCase.ejecutar(comandoBase()).catch(() => undefined);

    expect(finalizarEnvio.finalizarEnvio).not.toHaveBeenCalled();
  });

  it('no_debe_continuar_con_la_comunicacion_ni_la_auditoria_si_falla_la_creacion_del_cliente', async () => {
    // El fallo en el primer paso aborta la transacción: los pasos siguientes no
    // se ejecutan (la unidad de trabajo propaga el rechazo y revierte todo).
    const repos = crearReposFake(null);
    repos.clientes.crear.mockRejectedValueOnce(new Error('fallo al crear CLIENTE'));
    const { useCase } = montar({ repos });

    await useCase.ejecutar(comandoBase()).catch(() => undefined);

    expect(repos.reservas.crear).not.toHaveBeenCalled();
    expect(repos.comunicaciones.crear).not.toHaveBeenCalled();
    expect(repos.auditoria.registrar).not.toHaveBeenCalled();
  });
});
