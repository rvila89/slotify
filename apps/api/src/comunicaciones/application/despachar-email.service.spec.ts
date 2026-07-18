/**
 * TESTS del motor de email `DespacharEmailService` (US-045 / UC-35) — fase TDD RED.
 * tasks.md Fase 2: 2.1, 2.2, 2.3, 2.4, 2.5 (y adjuntos del spec-delta).
 *
 * Trazabilidad: US-045, spec-delta `comunicaciones` (Requirements: "Motor de email
 * reutilizable que envía y traza la comunicación", "Catálogo de plantillas por
 * código de email e idioma del tenant", "Registro en COMUNICACION con estado y
 * fecha de envío coherentes", "Idempotencia de un email por reserva y código",
 * "Fallo del proveedor sin reintento automático", "Bloqueo de envío ante variable
 * de plantilla nula", "Interfaz de adjuntos por referencia documental"),
 * design.md §2 (síncrono post-commit / fila COMUNICACION como estado), §3
 * (plantillas + i18n con fallback `es`), §4 (idempotencia (reserva_id, codigo_email)),
 * §5 (modelo COMUNICACION), §6 (regresión / motor en `application`).
 *
 * Ejercita el motor de APLICACIÓN contra DOBLES DE LOS PUERTOS (in-memory): catálogo
 * de plantillas, repositorio de COMUNICACION, lectura de TENANT_SETTINGS, auditoría
 * y el puerto de envío (a veces el adaptador FAKE real, a veces un doble que falla).
 * No toca Prisma ni la BD (hexagonal, hook `no-infra-in-domain`). La red de seguridad
 * REAL del índice UNIQUE parcial se verifica en QA contra la BD (tasks.md 4.4); aquí
 * se verifica la ORQUESTACIÓN y el manejo de la colisión.
 *
 * RED: aún no existen los símbolos de producción del motor
 * (`comunicaciones/application/despachar-email.service.ts`) ni los puertos
 * (`catalogo-plantillas.port`, `comunicacion.repository.port`, `tenant-settings.port`,
 * `codigo-email`); los imports fallan y la batería está en ROJO. GREEN es
 * responsabilidad de `backend-developer`.
 */
import {
  DespacharEmailService,
  type DespacharEmailComando,
  type DespacharEmailDeps,
  type ClockPort,
} from './despachar-email.service';
import type {
  CatalogoPlantillasPort,
  Plantilla,
} from '../domain/catalogo-plantillas.port';
import type {
  ComunicacionRepositoryPort,
  ComunicacionRegistrada,
  RegistrarComunicacionParams,
} from '../domain/comunicacion.repository.port';
import { ComunicacionDuplicadaError } from '../domain/comunicacion.repository.port';
import type { TenantSettingsPort } from '../domain/tenant-settings.port';
import type { EnviarEmailPort } from '../domain/enviar-email.port';
import type { AuditLogPort } from '../../shared/audit/audit-log.port';
import { FakeEmailAdapter } from '../infrastructure/fake-email.adapter';

// ---------------------------------------------------------------------------
// Datos canónicos (alineados con apps/api/prisma/seed.ts — Masia l'Encís)
// ---------------------------------------------------------------------------

const TENANT = '00000000-0000-0000-0000-000000000001';
const RESERVA_ID = 'res-1';
const CLIENTE_ID = 'cli-1';
const EMAIL = 'marta.soler@example.com';

// ---------------------------------------------------------------------------
// Dobles de puertos (in-memory). El motor depende de estas INTERFACES.
// ---------------------------------------------------------------------------

type CatalogoFake = CatalogoPlantillasPort & { seleccionar: jest.Mock };
type ComunicacionesFake = ComunicacionRepositoryPort & {
  buscarPorReservaYCodigo: jest.Mock;
  crear: jest.Mock;
  actualizarEstado: jest.Mock;
};
type TenantSettingsFake = TenantSettingsPort & { obtenerIdioma: jest.Mock };
type AuditFake = AuditLogPort & { registrar: jest.Mock };
type EmailFake = EnviarEmailPort & { enviar: jest.Mock };

const relojFijo = (iso = '2026-06-28T10:00:00.000Z'): ClockPort => ({
  ahora: () => new Date(iso),
});

/** Plantilla E1 activa con `render` espiable y variables/adjuntos configurables. */
const crearPlantillaFake = (over: Partial<Plantilla> = {}): Plantilla & { render: jest.Mock } => {
  const render = jest.fn((_variables: Record<string, unknown>) => ({
    asunto: 'ASUNTO-E1',
    cuerpoHtml: '<p>Hola Marta</p>',
    cuerpoTexto: 'Hola Marta',
  }));
  return {
    codigoEmail: 'E1',
    idioma: 'es',
    activa: true,
    variablesRequeridas: ['nombre', 'email'],
    adjuntosRequeridos: [],
    render,
    ...over,
  } as Plantilla & { render: jest.Mock };
};

const crearCatalogoFake = (plantilla: Plantilla | null): CatalogoFake => ({
  seleccionar: jest.fn(() => plantilla),
});

/** Repositorio fake stateful: recuerda el último registro para `actualizarEstado`. */
const crearComunicacionesFake = (
  existentePrevio: ComunicacionRegistrada | null = null,
): ComunicacionesFake => {
  let creado: ComunicacionRegistrada | null = null;
  return {
    buscarPorReservaYCodigo: jest.fn(async () => existentePrevio),
    crear: jest.fn(async (p: RegistrarComunicacionParams): Promise<ComunicacionRegistrada> => {
      creado = {
        idComunicacion: 'com-1',
        tenantId: p.tenantId,
        reservaId: p.reservaId,
        clienteId: p.clienteId,
        codigoEmail: p.codigoEmail,
        estado: p.estado,
        destinatarioEmail: p.destinatarioEmail,
        fechaEnvio: p.fechaEnvio,
        fechaCreacion: new Date('2026-06-28T09:00:00.000Z'),
        esReenvio: p.esReenvio ?? false,
      };
      return creado;
    }),
    actualizarEstado: jest.fn(
      async (p: {
        idComunicacion: string;
        estado: ComunicacionRegistrada['estado'];
        fechaEnvio: Date | null;
      }): Promise<ComunicacionRegistrada> => {
        creado = { ...(creado as ComunicacionRegistrada), estado: p.estado, fechaEnvio: p.fechaEnvio };
        return creado;
      },
    ),
    // fix-borrador-e1-cuerpo-prerelleno: UPDATE de contenido del borrador (ajeno al motor).
    actualizarContenidoBorrador: jest.fn(
      async (p: { asunto: string; cuerpo: string }): Promise<ComunicacionRegistrada> => {
        creado = { ...(creado as ComunicacionRegistrada) };
        return creado;
      },
    ),
    // US-046 D-3: método de listado ajeno al motor (no se ejercita en estas suites).
    listarPorReserva: jest.fn(async () => []),
  };
};

const crearTenantSettingsFake = (idioma: string | null = 'es'): TenantSettingsFake => ({
  obtenerIdioma: jest.fn(async () => idioma),
});

const crearAuditFake = (): AuditFake => ({ registrar: jest.fn(async () => undefined) });

const crearEmailFake = (): EmailFake => ({ enviar: jest.fn(async () => undefined) });

const comandoBase = (over: Partial<DespacharEmailComando> = {}): DespacharEmailComando => ({
  tenantId: TENANT,
  codigoEmail: 'E1',
  reserva: { idReserva: RESERVA_ID, codigo: '26-0001' },
  cliente: {
    idCliente: CLIENTE_ID,
    nombre: 'Marta',
    apellidos: 'Soler',
    email: EMAIL,
    telefono: '600111222',
  },
  ...over,
});

interface Montaje {
  catalogo?: CatalogoFake;
  comunicaciones?: ComunicacionesFake;
  tenantSettings?: TenantSettingsFake;
  auditoria?: AuditFake;
  enviarEmail?: EnviarEmailPort;
  clock?: ClockPort;
}

const montar = (opts: Montaje = {}) => {
  const catalogo = opts.catalogo ?? crearCatalogoFake(crearPlantillaFake());
  const comunicaciones = opts.comunicaciones ?? crearComunicacionesFake();
  const tenantSettings = opts.tenantSettings ?? crearTenantSettingsFake('es');
  const auditoria = opts.auditoria ?? crearAuditFake();
  const enviarEmail = opts.enviarEmail ?? crearEmailFake();
  const clock = opts.clock ?? relojFijo();
  const deps: DespacharEmailDeps = {
    catalogo,
    comunicaciones,
    tenantSettings,
    auditoria,
    enviarEmail,
    clock,
  };
  return {
    motor: new DespacharEmailService(deps),
    catalogo,
    comunicaciones,
    tenantSettings,
    auditoria,
    enviarEmail,
    clock,
  };
};

// ===========================================================================
// 2.1 — Selección de plantilla por código + idioma del tenant (fallback `es`)
//        y sustitución de variables desde RESERVA/CLIENTE.
// ===========================================================================

describe('DespacharEmailService — selección de plantilla y variables (2.1)', () => {
  it('debe_seleccionar_la_plantilla_por_codigo_email_y_el_idioma_del_tenant', async () => {
    const { motor, catalogo, tenantSettings } = montar();

    await motor.despachar(comandoBase());

    expect(tenantSettings.obtenerIdioma).toHaveBeenCalledWith(TENANT);
    expect(catalogo.seleccionar).toHaveBeenCalledWith('E1', 'es');
  });

  it('debe_sustituir_las_variables_de_la_plantilla_con_datos_de_reserva_y_cliente', async () => {
    const plantilla = crearPlantillaFake();
    const { motor } = montar({ catalogo: crearCatalogoFake(plantilla) });

    await motor.despachar(comandoBase());

    // Las variables provienen de RESERVA (código) y CLIENTE (nombre/email).
    const variablesRenderizadas = JSON.stringify(plantilla.render.mock.calls[0][0]);
    expect(variablesRenderizadas).toContain('Marta');
    expect(variablesRenderizadas).toContain('26-0001');
    expect(variablesRenderizadas).toContain(EMAIL);
  });

  it('debe_enviar_con_el_asunto_y_cuerpo_renderizados_por_la_plantilla', async () => {
    const { motor, enviarEmail } = montar();

    await motor.despachar(comandoBase());

    expect(enviarEmail.enviar).toHaveBeenCalledTimes(1);
    expect(enviarEmail.enviar).toHaveBeenCalledWith(
      expect.objectContaining({ destinatario: EMAIL, asunto: 'ASUNTO-E1', codigoEmail: 'E1' }),
    );
  });

  it('debe_caer_a_es_y_auditarlo_cuando_no_hay_plantilla_en_el_idioma_del_tenant', async () => {
    // Tenant en `ca` sin plantilla `ca`: el catálogo devuelve null para `ca` y la
    // plantilla `es` en el segundo intento (fallback). Se anota en AUDIT_LOG.
    const plantillaEs = crearPlantillaFake({ idioma: 'es' });
    const catalogo: CatalogoFake = {
      seleccionar: jest.fn((_codigo: string, idioma: string) =>
        idioma === 'es' ? plantillaEs : null,
      ),
    };
    const { motor, auditoria } = montar({
      catalogo,
      tenantSettings: crearTenantSettingsFake('ca'),
    });

    await motor.despachar(comandoBase());

    expect(catalogo.seleccionar).toHaveBeenCalledWith('E1', 'ca');
    expect(catalogo.seleccionar).toHaveBeenCalledWith('E1', 'es');
    const auditoriaSerializada = JSON.stringify(auditoria.registrar.mock.calls);
    expect(auditoriaSerializada).toContain('ca');
    expect(auditoriaSerializada).toContain('es');
  });

  it('debe_usar_es_por_defecto_cuando_el_tenant_no_tiene_idioma_configurado', async () => {
    const { motor, catalogo } = montar({ tenantSettings: crearTenantSettingsFake(null) });

    await motor.despachar(comandoBase());

    expect(catalogo.seleccionar).toHaveBeenCalledWith('E1', 'es');
  });
});

// ===========================================================================
// 2.2 — Registro en COMUNICACION: estado y fecha_envio coherentes.
// ===========================================================================

describe('DespacharEmailService — registro en COMUNICACION (2.2)', () => {
  it('debe_registrar_enviado_con_fecha_envio_no_nula_cuando_el_proveedor_acepta', async () => {
    const { motor } = montar();

    const resultado = await motor.despachar(comandoBase());

    expect(resultado.comunicacion?.estado).toBe('enviado');
    expect(resultado.comunicacion?.fechaEnvio).toBeInstanceOf(Date);
  });

  it('debe_registrar_los_vinculos_tenant_reserva_y_cliente_correctos', async () => {
    const { motor, comunicaciones } = montar();

    await motor.despachar(comandoBase());

    const args = comunicaciones.crear.mock.calls[0][0];
    expect(args.tenantId).toBe(TENANT);
    expect(args.reservaId).toBe(RESERVA_ID);
    expect(args.clienteId).toBe(CLIENTE_ID);
    expect(args.codigoEmail).toBe('E1');
    expect(args.destinatarioEmail).toBe(EMAIL);
  });

  it('debe_registrar_borrador_sin_fecha_envio_cuando_no_es_autoenvio', async () => {
    const { motor, enviarEmail } = montar();

    const resultado = await motor.despachar(comandoBase({ autoenviar: false }));

    expect(resultado.comunicacion?.estado).toBe('borrador');
    expect(resultado.comunicacion?.fechaEnvio).toBeNull();
    // Borrador pendiente de revisión: el puerto de email NO se invoca.
    expect(enviarEmail.enviar).not.toHaveBeenCalled();
  });

  it('debe_dejar_fecha_envio_nula_cuando_el_estado_es_fallido', async () => {
    const enviarEmail: EmailFake = {
      enviar: jest.fn(async () => {
        throw new Error('proveedor caído');
      }),
    };
    const { motor } = montar({ enviarEmail });

    const resultado = await motor.despachar(comandoBase());

    expect(resultado.comunicacion?.estado).toBe('fallido');
    expect(resultado.comunicacion?.fechaEnvio).toBeNull();
  });
});

// ===========================================================================
// 2.x — E1 auto-envío vía adaptador FAKE (sin red) + AUDIT_LOG.
// ===========================================================================

describe('DespacharEmailService — E1 auto-envío vía adaptador FAKE', () => {
  it('debe_enviar_E1_por_el_fake_dejar_la_comunicacion_enviada_con_fecha_y_auditar', async () => {
    const fake = new FakeEmailAdapter();
    const { motor, comunicaciones, auditoria } = montar({ enviarEmail: fake });

    const resultado = await motor.despachar(comandoBase());

    // Registrado en memoria del FAKE (cero red), un único envío del código E1.
    expect(fake.enviados).toHaveLength(1);
    expect(fake.enviados[0]).toMatchObject({ destinatario: EMAIL, codigoEmail: 'E1' });
    // COMUNICACION enviada con fecha_envio + AUDIT_LOG.
    expect(comunicaciones.crear).toHaveBeenCalledTimes(1);
    expect(resultado.comunicacion?.estado).toBe('enviado');
    expect(resultado.comunicacion?.fechaEnvio).toBeInstanceOf(Date);
    expect(auditoria.registrar).toHaveBeenCalled();
  });

  it('debe_dejar_E1_en_borrador_sin_enviar_por_el_fake_cuando_hay_comentarios', async () => {
    // E1 con comentarios: el alta delega `autoenviar:false`; no se toca la red.
    const fake = new FakeEmailAdapter();
    const { motor } = montar({ enviarEmail: fake });

    const resultado = await motor.despachar(comandoBase({ autoenviar: false }));

    expect(fake.enviados).toHaveLength(0);
    expect(resultado.comunicacion?.estado).toBe('borrador');
    expect(resultado.comunicacion?.fechaEnvio).toBeNull();
  });
});

// ===========================================================================
// 2.3 — Idempotencia (reserva_id, codigo_email): no duplica + carrera.
// ===========================================================================

describe('DespacharEmailService — idempotencia por (reserva, código) (2.3)', () => {
  it('no_debe_duplicar_ni_reenviar_cuando_ya_existe_una_comunicacion_del_mismo_codigo', async () => {
    const existente: ComunicacionRegistrada = {
      idComunicacion: 'com-existente',
      tenantId: TENANT,
      reservaId: RESERVA_ID,
      clienteId: CLIENTE_ID,
      codigoEmail: 'E1',
      estado: 'enviado',
      destinatarioEmail: EMAIL,
      fechaEnvio: new Date('2026-06-28T09:00:00.000Z'),
      fechaCreacion: new Date('2026-06-28T09:00:00.000Z'),
      esReenvio: false,
    };
    const comunicaciones = crearComunicacionesFake(existente);
    const { motor, enviarEmail } = montar({ comunicaciones });

    const resultado = await motor.despachar(comandoBase());

    expect(comunicaciones.buscarPorReservaYCodigo).toHaveBeenCalledWith(
      expect.objectContaining({ reservaId: RESERVA_ID, codigoEmail: 'E1' }),
    );
    expect(comunicaciones.crear).not.toHaveBeenCalled();
    expect(enviarEmail.enviar).not.toHaveBeenCalled();
    expect(resultado.motivo).toBe('idempotente');
    expect(resultado.comunicacion?.idComunicacion).toBe('com-existente');
  });

  it('debe_permitir_un_envio_y_frenar_el_segundo_cuando_dos_triggers_corren_en_carrera', async () => {
    // El índice UNIQUE parcial es la red de seguridad ante la carrera: la segunda
    // inserción viola el UNIQUE; el motor la trata como "ya existe" sin error de
    // usuario y SIN reenviar. (concurrency-locking: Promise.allSettled, 1 OK.)
    const reservadas = new Set<string>();
    let primerCreado: ComunicacionRegistrada | null = null;
    const comunicaciones: ComunicacionesFake = {
      buscarPorReservaYCodigo: jest.fn(async () => primerCreado),
      crear: jest.fn(async (p: RegistrarComunicacionParams): Promise<ComunicacionRegistrada> => {
        const clave = `${p.reservaId}::${p.codigoEmail}`;
        if (reservadas.has(clave)) {
          throw new ComunicacionDuplicadaError(p.reservaId, p.codigoEmail);
        }
        reservadas.add(clave);
        primerCreado = {
          idComunicacion: 'com-1',
          tenantId: p.tenantId,
          reservaId: p.reservaId,
          clienteId: p.clienteId,
          codigoEmail: p.codigoEmail,
          estado: p.estado,
          destinatarioEmail: p.destinatarioEmail,
          fechaEnvio: p.fechaEnvio,
          fechaCreacion: new Date('2026-06-28T09:00:00.000Z'),
          esReenvio: p.esReenvio ?? false,
        };
        return primerCreado;
      }),
      actualizarEstado: jest.fn(async () => primerCreado as ComunicacionRegistrada),
      actualizarContenidoBorrador: jest.fn(async () => primerCreado as ComunicacionRegistrada),
      listarPorReserva: jest.fn(async () => []),
    };
    const fake = new FakeEmailAdapter();
    const { motor } = montar({ comunicaciones, enviarEmail: fake });

    const resultados = await Promise.allSettled([
      motor.despachar(comandoBase()),
      motor.despachar(comandoBase()),
    ]);

    // Ningún error de usuario: ambos disparos se resuelven (uno envía, otro "ya existe").
    expect(resultados.filter((r) => r.status === 'fulfilled')).toHaveLength(2);
    expect(comunicaciones.crear).toHaveBeenCalledTimes(2); // dos intentos
    expect(fake.enviados).toHaveLength(1); // un único envío real
  });
});

// ===========================================================================
// 2.4 — Fallo del proveedor: estado='fallido' + AUDIT_LOG, sin reintento.
// ===========================================================================

describe('DespacharEmailService — fallo del proveedor (2.4)', () => {
  it('debe_marcar_fallido_sin_fecha_envio_y_auditar_cuando_el_proveedor_rechaza', async () => {
    const enviarEmail: EmailFake = {
      enviar: jest.fn(async () => {
        throw new Error('credenciales inválidas');
      }),
    };
    const { motor, auditoria } = montar({ enviarEmail });

    const resultado = await motor.despachar(comandoBase());

    expect(resultado.comunicacion?.estado).toBe('fallido');
    expect(resultado.comunicacion?.fechaEnvio).toBeNull();
    expect(auditoria.registrar).toHaveBeenCalled();
  });

  it('no_debe_reintentar_automaticamente_el_envio_tras_un_fallo_del_proveedor', async () => {
    const enviarEmail: EmailFake = {
      enviar: jest.fn(async () => {
        throw new Error('timeout');
      }),
    };
    const { motor } = montar({ enviarEmail });

    await motor.despachar(comandoBase());

    // MVP: sin reintento automático. El puerto se invoca EXACTAMENTE una vez.
    expect(enviarEmail.enviar).toHaveBeenCalledTimes(1);
  });

  it('no_debe_propagar_el_error_del_proveedor_como_excepcion_al_llamador', async () => {
    const enviarEmail: EmailFake = {
      enviar: jest.fn(async () => {
        throw new Error('bounce permanente');
      }),
    };
    const { motor } = montar({ enviarEmail });

    // El fallo se traduce en estado 'fallido' + auditoría, no en una excepción.
    await expect(motor.despachar(comandoBase())).resolves.toBeDefined();
  });
});

// ===========================================================================
// 2.5 — Variable de plantilla nula: no envía, no crea `enviado`, audita.
// ===========================================================================

describe('DespacharEmailService — variable de plantilla nula (2.5)', () => {
  it('no_debe_enviar_ni_crear_enviado_cuando_falta_una_variable_requerida', async () => {
    const { motor, comunicaciones, enviarEmail } = montar();

    const resultado = await motor.despachar(
      comandoBase({
        cliente: {
          idCliente: CLIENTE_ID,
          nombre: 'Marta',
          apellidos: 'Soler',
          email: null,
          telefono: '600111222',
        },
      }),
    );

    expect(enviarEmail.enviar).not.toHaveBeenCalled();
    // No se crea una COMUNICACION 'enviado' con datos malformados.
    const creadasEnviadas = comunicaciones.crear.mock.calls.filter(
      (c: [RegistrarComunicacionParams]) => c[0].estado === 'enviado',
    );
    expect(creadasEnviadas).toHaveLength(0);
    expect(resultado.motivo).toBe('variable_nula');
  });

  it('debe_auditar_el_campo_faltante_para_que_el_gestor_complete_los_datos', async () => {
    const { motor, auditoria } = montar();

    await motor.despachar(
      comandoBase({
        cliente: {
          idCliente: CLIENTE_ID,
          nombre: 'Marta',
          apellidos: 'Soler',
          email: null,
          telefono: '600111222',
        },
      }),
    );

    expect(auditoria.registrar).toHaveBeenCalled();
    // El registro identifica la variable que falta (`email`).
    expect(JSON.stringify(auditoria.registrar.mock.calls)).toContain('email');
  });
});

// ===========================================================================
// Adjuntos por referencia documental (spec-delta "Interfaz de adjuntos").
// ===========================================================================

describe('DespacharEmailService — adjuntos por referencia', () => {
  it('debe_incorporar_el_adjunto_al_envio_cuando_la_plantilla_lo_declara_y_el_pdf_url_existe', async () => {
    const plantilla = crearPlantillaFake({ adjuntosRequeridos: ['presupuesto'] });
    const { motor, enviarEmail } = montar({ catalogo: crearCatalogoFake(plantilla) });

    await motor.despachar(
      comandoBase({
        adjuntos: [{ clave: 'presupuesto', nombre: 'presupuesto.pdf', pdfUrl: 'https://docs/p.pdf' }],
      }),
    );

    expect(enviarEmail.enviar).toHaveBeenCalledWith(
      expect.objectContaining({
        adjuntos: expect.arrayContaining([
          expect.objectContaining({ pdfUrl: 'https://docs/p.pdf' }),
        ]),
      }),
    );
  });

  it('no_debe_enviar_y_debe_auditar_cuando_un_adjunto_requerido_no_tiene_pdf_url', async () => {
    const plantilla = crearPlantillaFake({ adjuntosRequeridos: ['presupuesto'] });
    const { motor, enviarEmail, auditoria } = montar({ catalogo: crearCatalogoFake(plantilla) });

    const resultado = await motor.despachar(
      comandoBase({
        adjuntos: [{ clave: 'presupuesto', nombre: 'presupuesto.pdf', pdfUrl: null }],
      }),
    );

    expect(enviarEmail.enviar).not.toHaveBeenCalled();
    expect(auditoria.registrar).toHaveBeenCalled();
    expect(resultado.motivo).toBe('adjunto_no_disponible');
  });
});

// ===========================================================================
// finalizarEnvio — camino POST-COMMIT centralizado (decisión 6 del Gate 1).
// El alta crea la fila E1 en `borrador` dentro de su tx y DELEGA aquí el envío:
// éxito → enviado+fecha; fallo → fallido sin fecha + AUDIT_LOG, sin propagar.
// ===========================================================================

describe('DespacharEmailService — finalizarEnvio (envío post-commit de fila ya creada)', () => {
  const filaBorrador: ComunicacionRegistrada = {
    idComunicacion: 'com-1',
    tenantId: TENANT,
    reservaId: RESERVA_ID,
    clienteId: CLIENTE_ID,
    codigoEmail: 'E1',
    estado: 'borrador',
    destinatarioEmail: EMAIL,
    fechaEnvio: null,
    fechaCreacion: new Date('2026-06-28T09:00:00.000Z'),
    esReenvio: false,
  };

  const paramsBase = () => ({
    tenantId: TENANT,
    reservaId: RESERVA_ID,
    idComunicacion: 'com-1',
    destinatario: EMAIL,
    asunto: 'ASUNTO-E1',
    cuerpo: '<p>Hola</p>',
    codigoEmail: 'E1' as const,
  });

  const crearRepoConFila = (): ComunicacionesFake => ({
    buscarPorReservaYCodigo: jest.fn(async () => filaBorrador),
    crear: jest.fn(async () => filaBorrador),
    actualizarEstado: jest.fn(
      async (p: {
        tenantId: string;
        idComunicacion: string;
        estado: ComunicacionRegistrada['estado'];
        fechaEnvio: Date | null;
      }): Promise<ComunicacionRegistrada> => ({
        ...filaBorrador,
        estado: p.estado,
        fechaEnvio: p.fechaEnvio,
      }),
    ),
    actualizarContenidoBorrador: jest.fn(async () => filaBorrador),
    listarPorReserva: jest.fn(async () => []),
  });

  it('debe_enviar_y_promover_la_fila_a_enviado_con_fecha_fijando_el_tenant_y_auditar', async () => {
    const comunicaciones = crearRepoConFila();
    const { motor, enviarEmail, auditoria } = montar({ comunicaciones });

    const res = await motor.finalizarEnvio(paramsBase());

    expect(enviarEmail.enviar).toHaveBeenCalledWith(
      expect.objectContaining({ destinatario: EMAIL, codigoEmail: 'E1', tenantId: TENANT }),
    );
    // RLS + estado coherente: actualizarEstado recibe el tenant y promueve a enviado.
    expect(comunicaciones.actualizarEstado).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: TENANT, idComunicacion: 'com-1', estado: 'enviado' }),
    );
    expect(res.estado).toBe('enviado');
    expect(res.fechaEnvio).toBeInstanceOf(Date);
    expect(res.comunicacion.estado).toBe('enviado');
    expect(auditoria.registrar).toHaveBeenCalled();
  });

  it('debe_marcar_fallido_sin_fecha_y_auditar_sin_propagar_cuando_el_proveedor_falla', async () => {
    const comunicaciones = crearRepoConFila();
    const enviarEmail: EmailFake = {
      enviar: jest.fn(async () => {
        throw new Error('proveedor caído');
      }),
    };
    const { motor, auditoria } = montar({ comunicaciones, enviarEmail });

    const res = await motor.finalizarEnvio(paramsBase());

    expect(comunicaciones.actualizarEstado).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: TENANT,
        idComunicacion: 'com-1',
        estado: 'fallido',
        fechaEnvio: null,
      }),
    );
    expect(res.estado).toBe('fallido');
    expect(res.fechaEnvio).toBeNull();
    // AUDIT_LOG del fallo (camino centralizado del motor).
    expect(auditoria.registrar).toHaveBeenCalled();
    expect(JSON.stringify(auditoria.registrar.mock.calls)).toContain('fallido');
  });

  it('no_debe_propagar_la_excepcion_del_proveedor_al_llamador', async () => {
    const comunicaciones = crearRepoConFila();
    const enviarEmail: EmailFake = {
      enviar: jest.fn(async () => {
        throw new Error('bounce permanente');
      }),
    };
    const { motor } = montar({ comunicaciones, enviarEmail });

    await expect(motor.finalizarEnvio(paramsBase())).resolves.toBeDefined();
  });
});
