/**
 * TESTS del motor `DespacharEmailService` — IDEMPOTENCIA CLAVADA SOBRE LA TERNA
 * `(reserva, codigo, subtipo)` + `estado = 'enviado'` (change
 * `historial-completo-comunicaciones`) — fase TDD RED.
 *
 * Trazabilidad: spec-delta `comunicaciones`, Requirement "Idempotencia de un email por
 * reserva y código" (Scenarios "Un segundo auto-envío de la misma terna no crea otra
 * fila enviada" y "Dos subtipos distintos pueden ambos estar enviados sin colisión");
 * design.md §D-autosend.
 *
 * Comportamiento objetivo: el chequeo previo de idempotencia del motor
 * (`buscarPorReservaYCodigo`) debe clavar sobre la TERNA `(reserva, codigo, subtipo)` y
 * filtrar `estado = 'enviado'`. Solo un auto-envío previo CONSUMADO de la MISMA terna
 * cortocircuita un nuevo auto-envío. Subtipos DISTINTOS del mismo código coexisten sin
 * bloquearse; un borrador previo tampoco cortocircuita.
 *
 * Ejercita el motor contra DOBLES de los puertos (in-memory, hexagonal, sin Prisma).
 *
 * RED contra el código ACTUAL:
 *  - Hoy `DespacharEmailComando` NO lleva `subtipo` y el chequeo llama a
 *    `buscarPorReservaYCodigo({ tenantId, reservaId, codigoEmail })` SIN `subtipo` ni
 *    filtro de estado. Por eso:
 *    (a) la aserción `toHaveBeenCalledWith(objectContaining({ subtipo }))` falla (el
 *        motor no propaga el subtipo);
 *    (b) con un doble subtipo-aware, un `enviado` de OTRO subtipo cortocircuita hoy el
 *        motor (el doble actual ignora el subtipo) → la 2ª terna NO se despacharía,
 *        rompiendo la coexistencia esperada.
 *  El fichero COMPILA hoy porque el `subtipo` viaja en el comando vía una intersección
 *  local de tipos (el motor lo ignora en tiempo de ejecución hasta el GREEN).
 *
 * GREEN es de `backend-developer` (ampliar comando/puerto con `subtipo` + filtro
 * `estado = 'enviado'` en el adaptador y en el chequeo del motor).
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
  BuscarComunicacionParams,
} from '../domain/comunicacion.repository.port';
import type { TenantSettingsPort } from '../domain/tenant-settings.port';
import type { EnviarEmailPort } from '../domain/enviar-email.port';
import type { AuditLogPort } from '../../shared/audit/audit-log.port';

const TENANT = '00000000-0000-0000-0000-000000000001';
const RESERVA_ID = 'res-hist-1';
const CLIENTE_ID = 'cli-hist-1';
const EMAIL = 'cliente.historial@example.com';

/**
 * El `subtipo` es el campo NUEVO que el change añade al comando del motor. Hasta que
 * `backend-developer` lo incorpore a `DespacharEmailComando`, lo modelamos como una
 * intersección local para que el fichero compile (el motor actual lo ignora → RED).
 */
type Subtipo = 'consulta_exploratoria' | 'fecha_disponible' | 'cambio_fecha';
type ComandoConSubtipo = DespacharEmailComando & { subtipo?: Subtipo };
type BuscarParamsConSubtipo = BuscarComunicacionParams & {
  subtipo?: Subtipo;
  estado?: ComunicacionRegistrada['estado'];
};

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

const crearPlantillaFake = (): Plantilla & { render: jest.Mock } =>
  ({
    codigoEmail: 'E1',
    idioma: 'es',
    activa: true,
    variablesRequeridas: ['nombre', 'email'],
    adjuntosRequeridos: [],
    render: jest.fn(() => ({
      asunto: 'ASUNTO-E1',
      cuerpoHtml: '<p>Hola</p>',
      cuerpoTexto: 'Hola',
    })),
  }) as Plantilla & { render: jest.Mock };

const crearCatalogoFake = (): CatalogoFake => ({
  seleccionar: jest.fn(() => crearPlantillaFake()),
});

/**
 * Repositorio fake SUBTIPO-AWARE: `buscarPorReservaYCodigo` solo devuelve una fila
 * `enviado` cuando la TERNA `(reserva, codigo, subtipo)` coincide y el estado buscado es
 * `enviado`. Modela la semántica GREEN esperada del puerto; con el motor actual (que NO
 * envía `subtipo`) el matching por terna nunca se satisface con precisión → RED.
 */
const crearComunicacionesFake = (
  enviadasPrevias: Array<{ subtipo: Subtipo; fila: ComunicacionRegistrada }> = [],
): ComunicacionesFake => {
  return {
    buscarPorReservaYCodigo: jest.fn(
      async (p: BuscarParamsConSubtipo): Promise<ComunicacionRegistrada | null> => {
        const match = enviadasPrevias.find(
          (e) => e.subtipo === p.subtipo && e.fila.estado === 'enviado',
        );
        return match ? match.fila : null;
      },
    ),
    crear: jest.fn(
      async (p: RegistrarComunicacionParams): Promise<ComunicacionRegistrada> => ({
        idComunicacion: `com-${p.codigoEmail}-${Math.random().toString(36).slice(2, 6)}`,
        tenantId: p.tenantId,
        reservaId: p.reservaId,
        clienteId: p.clienteId,
        codigoEmail: p.codigoEmail,
        estado: p.estado,
        destinatarioEmail: p.destinatarioEmail,
        fechaEnvio: p.fechaEnvio,
        fechaCreacion: new Date('2026-06-28T09:00:00.000Z'),
        esReenvio: p.esReenvio ?? false,
      }),
    ),
    actualizarEstado: jest.fn(
      async (p: {
        idComunicacion: string;
        estado: ComunicacionRegistrada['estado'];
        fechaEnvio: Date | null;
      }): Promise<ComunicacionRegistrada> => ({
        idComunicacion: p.idComunicacion,
        tenantId: TENANT,
        reservaId: RESERVA_ID,
        clienteId: CLIENTE_ID,
        codigoEmail: 'E1',
        estado: p.estado,
        destinatarioEmail: EMAIL,
        fechaEnvio: p.fechaEnvio,
        fechaCreacion: new Date('2026-06-28T09:00:00.000Z'),
        esReenvio: false,
      }),
    ),
    actualizarContenidoBorrador: jest.fn(async () => {
      throw new Error('no usado');
    }),
    listarPorReserva: jest.fn(async () => []),
  };
};

const crearTenantSettingsFake = (): TenantSettingsFake => ({
  obtenerIdioma: jest.fn(async () => 'es'),
});
const crearAuditFake = (): AuditFake => ({ registrar: jest.fn(async () => undefined) });
const crearEmailFake = (): EmailFake => ({ enviar: jest.fn(async () => undefined) });

const enviadaPrevia = (subtipo: Subtipo): ComunicacionRegistrada => ({
  idComunicacion: `com-prev-${subtipo}`,
  tenantId: TENANT,
  reservaId: RESERVA_ID,
  clienteId: CLIENTE_ID,
  codigoEmail: 'E1',
  estado: 'enviado',
  destinatarioEmail: EMAIL,
  fechaEnvio: new Date('2026-06-27T09:00:00.000Z'),
  fechaCreacion: new Date('2026-06-27T08:00:00.000Z'),
  esReenvio: false,
});

const comando = (subtipo: Subtipo): ComandoConSubtipo => ({
  tenantId: TENANT,
  codigoEmail: 'E1',
  reserva: { idReserva: RESERVA_ID, codigo: '29-0001' },
  cliente: {
    idCliente: CLIENTE_ID,
    nombre: 'Cliente',
    apellidos: 'Historial',
    email: EMAIL,
    telefono: '600100200',
  },
  subtipo,
});

interface Montaje {
  comunicaciones?: ComunicacionesFake;
}

const montar = (opts: Montaje = {}) => {
  const comunicaciones = opts.comunicaciones ?? crearComunicacionesFake();
  const deps: DespacharEmailDeps = {
    catalogo: crearCatalogoFake(),
    comunicaciones,
    tenantSettings: crearTenantSettingsFake(),
    auditoria: crearAuditFake(),
    enviarEmail: crearEmailFake(),
    clock: relojFijo(),
  };
  return { motor: new DespacharEmailService(deps), comunicaciones };
};

// ===========================================================================
// Terna: el chequeo de idempotencia debe recibir `subtipo` y filtrar `enviado`.
// ===========================================================================

describe('DespacharEmailService — idempotencia por terna (reserva, codigo, subtipo) + enviado', () => {
  it('debe_consultar_la_idempotencia_incluyendo_el_subtipo_y_el_estado_enviado', async () => {
    const { motor, comunicaciones } = montar();

    await motor.despachar(comando('fecha_disponible'));

    // El chequeo previo DEBE clavar sobre la terna + estado `enviado`. Hoy el motor
    // llama SIN `subtipo` ni `estado` → esta aserción está en ROJO.
    expect(comunicaciones.buscarPorReservaYCodigo).toHaveBeenCalledWith(
      expect.objectContaining({
        reservaId: RESERVA_ID,
        codigoEmail: 'E1',
        subtipo: 'fecha_disponible',
        estado: 'enviado',
      }),
    );
  });

  it('no_debe_reenviar_un_segundo_autoenvio_de_la_MISMA_terna_ya_enviada', async () => {
    // Ya existe un E1 `fecha_disponible` en `enviado`.
    const comunicaciones = crearComunicacionesFake([
      { subtipo: 'fecha_disponible', fila: enviadaPrevia('fecha_disponible') },
    ]);
    const { motor } = montar({ comunicaciones });

    const resultado = await motor.despachar(comando('fecha_disponible'));

    // Idempotente: no crea otra fila enviada ni reenvía.
    expect(resultado.motivo).toBe('idempotente');
    expect(comunicaciones.crear).not.toHaveBeenCalled();
  });

  it('debe_permitir_enviar_un_subtipo_DISTINTO_aunque_otro_subtipo_ya_este_enviado', async () => {
    // Ya hay un E1 `consulta_exploratoria` enviado; ahora llega un E1 `cambio_fecha`.
    const comunicaciones = crearComunicacionesFake([
      { subtipo: 'consulta_exploratoria', fila: enviadaPrevia('consulta_exploratoria') },
    ]);
    const { motor } = montar({ comunicaciones });

    const resultado = await motor.despachar(comando('cambio_fecha'));

    // Subtipos DISTINTOS coexisten: el `enviado` de otro subtipo NO cortocircuita.
    // Hoy el motor consulta sin subtipo → el doble subtipo-aware no casa por terna con
    // precisión y el resultado esperado (envío del nuevo subtipo) NO se cumple → RED.
    expect(resultado.motivo).not.toBe('idempotente');
    expect(comunicaciones.crear).toHaveBeenCalledTimes(1);
    expect(resultado.comunicacion?.estado).toBe('enviado');
  });
});
