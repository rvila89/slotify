/**
 * TESTS del MOTOR de email `DespacharEmailService` DESPACHANDO E2 con ADJUNTO REQUERIDO
 * (workstream C / D-1 del change `presupuesto-prereserva-cta-descarte-y-e2`) — fase TDD RED.
 *
 * D-1 (CERRADA = REQUERIDO): la plantilla E2 lleva `adjuntosRequeridos: ['presupuesto']`. Si
 * falta el PDF del presupuesto (`pdfUrl` null/ausente), el envío se BLOQUEA
 * (`motivo: 'adjunto_no_disponible'`, NO se crea una COMUNICACION `enviada`); con el adjunto
 * presente, el motor envía (`enviado`) usando el FAKE de email y el contenido enviado es el
 * render REAL (no placeholder).
 *
 * Trazabilidad: design.md §"Workstream C" / §D-1 ("Si falta el PDF del presupuesto, el envío se
 * BLOQUEA"); spec-delta `comunicaciones` (Requirement MODIFIED, Scenarios: "Con PDF disponible,
 * E2 se envía con el presupuesto adjunto y se traza"; "Sin PDF disponible, E2 NO se envía sin el
 * presupuesto (D-1 requerido)"; "En test/CI E2 no envía correos reales"). Se ejercita el motor
 * REAL contra el CATÁLOGO REAL (`CatalogoPlantillasEnCodigo`, para verificar el render real de E2)
 * y dobles in-memory del resto de puertos + el `FakeEmailAdapter` (cero red).
 *
 * DEPENDENCIA con workstream C-catálogo: este test EXIGE que E2 esté ACTIVA con `renderE2` real y
 * `adjuntosRequeridos: ['presupuesto']`. Mientras E2 siga inactiva/diferida en el catálogo, el
 * motor selecciona la plantilla inactiva y estas aserciones (envío real con contenido no
 * placeholder; bloqueo por adjunto faltante) FALLAN. Doble RED legítimo: catálogo + motor.
 *
 * RED: hasta que `backend-developer` active E2 en `catalogo-plantillas.ts`, la batería está en
 * ROJO por comportamiento. GREEN es de `backend-developer`.
 */
import {
  DespacharEmailService,
  type DespacharEmailComando,
  type DespacharEmailDeps,
  type ClockPort,
} from './despachar-email.service';
import type {
  ComunicacionRepositoryPort,
  ComunicacionRegistrada,
  RegistrarComunicacionParams,
} from '../domain/comunicacion.repository.port';
import type { TenantSettingsPort } from '../domain/tenant-settings.port';
import type { AuditLogPort } from '../../shared/audit/audit-log.port';
import type { AdjuntoRef } from '../domain/enviar-email.port';
import { FakeEmailAdapter } from '../infrastructure/fake-email.adapter';
import { CatalogoPlantillasEnCodigo } from '../infrastructure/plantillas/catalogo-plantillas';

const TENANT = '00000000-0000-0000-0000-000000000001';
const RESERVA_ID = 'res-e2';
const CLIENTE_ID = 'cli-e2';
const EMAIL = 'marta.soler@example.com';
const NOMBRE = 'Marta';
const CODIGO_RESERVA = 'SLO-2026-0023';
const PDF_URL = 'https://storage.example.com/presupuestos/pre-e2.pdf';

// ---------------------------------------------------------------------------
// Dobles de puertos (in-memory) + catálogo REAL + email FAKE (cero red).
// ---------------------------------------------------------------------------

type ComunicacionesFake = ComunicacionRepositoryPort & {
  buscarPorReservaYCodigo: jest.Mock;
  crear: jest.Mock;
  actualizarEstado: jest.Mock;
};
type TenantSettingsFake = TenantSettingsPort & { obtenerIdioma: jest.Mock };
type AuditFake = AuditLogPort & { registrar: jest.Mock };

const relojFijo = (iso = '2026-07-18T10:00:00.000Z'): ClockPort => ({
  ahora: () => new Date(iso),
});

/** Repositorio fake stateful: recuerda el último registro para `actualizarEstado`. */
const crearComunicacionesFake = (): ComunicacionesFake => {
  let creado: ComunicacionRegistrada | null = null;
  return {
    buscarPorReservaYCodigo: jest.fn(async () => null),
    crear: jest.fn(
      async (p: RegistrarComunicacionParams): Promise<ComunicacionRegistrada> => {
        creado = {
          idComunicacion: 'com-e2',
          tenantId: p.tenantId,
          reservaId: p.reservaId,
          clienteId: p.clienteId,
          codigoEmail: p.codigoEmail,
          estado: p.estado,
          destinatarioEmail: p.destinatarioEmail,
          fechaEnvio: p.fechaEnvio,
          fechaCreacion: new Date('2026-07-18T09:00:00.000Z'),
          esReenvio: p.esReenvio ?? false,
        };
        return creado;
      },
    ),
    actualizarEstado: jest.fn(
      async (p: {
        idComunicacion: string;
        estado: ComunicacionRegistrada['estado'];
        fechaEnvio: Date | null;
      }): Promise<ComunicacionRegistrada> => {
        creado = {
          ...(creado as ComunicacionRegistrada),
          estado: p.estado,
          fechaEnvio: p.fechaEnvio,
        };
        return creado;
      },
    ),
    actualizarContenidoBorrador: jest.fn(
      async (): Promise<ComunicacionRegistrada> => creado as ComunicacionRegistrada,
    ),
    listarPorReserva: jest.fn(async () => []),
  };
};

const crearTenantSettingsFake = (idioma: string | null = 'es'): TenantSettingsFake => ({
  obtenerIdioma: jest.fn(async () => idioma),
});

const crearAuditFake = (): AuditFake => ({ registrar: jest.fn(async () => undefined) });

const comandoE2 = (
  over: Partial<DespacharEmailComando> = {},
): DespacharEmailComando => ({
  tenantId: TENANT,
  codigoEmail: 'E2',
  reserva: { idReserva: RESERVA_ID, codigo: CODIGO_RESERVA },
  cliente: {
    idCliente: CLIENTE_ID,
    nombre: NOMBRE,
    apellidos: 'Soler',
    email: EMAIL,
    telefono: '600111222',
  },
  ...over,
});

const adjuntoPresupuesto = (pdfUrl: string | null): AdjuntoRef => ({
  clave: 'presupuesto',
  nombre: 'presupuesto.pdf',
  pdfUrl,
});

const montar = () => {
  const catalogo = new CatalogoPlantillasEnCodigo();
  const comunicaciones = crearComunicacionesFake();
  const tenantSettings = crearTenantSettingsFake('es');
  const auditoria = crearAuditFake();
  const enviarEmail = new FakeEmailAdapter();
  const clock = relojFijo();
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
    comunicaciones,
    auditoria,
    enviarEmail,
  };
};

// ===========================================================================
// 1. CON el adjunto presente → se envía (estado `enviado`) usando el fake de email; el
//    contenido enviado es el render REAL (no placeholder) y lleva el adjunto `presupuesto`.
//   spec-delta: "Con PDF disponible, E2 se envía con el presupuesto adjunto y se traza".
// ===========================================================================

describe('DespacharEmailService — E2 con adjunto presente se envía (D-1)', () => {
  it('debe_enviar_E2_y_marcar_la_comunicacion_como_enviada', async () => {
    const { motor, comunicaciones, enviarEmail } = montar();

    const resultado = await motor.despachar(
      comandoE2({ adjuntos: [adjuntoPresupuesto(PDF_URL)] }),
    );

    expect(resultado.motivo).toBe('enviado');
    expect(resultado.comunicacion?.estado).toBe('enviado');
    expect(resultado.comunicacion?.codigoEmail).toBe('E2');
    // Se creó la fila (outbox) y se promovió a enviado con fecha.
    expect(comunicaciones.crear).toHaveBeenCalledTimes(1);
    expect(resultado.comunicacion?.fechaEnvio).not.toBeNull();
    // Un único envío por el fake (cero red).
    expect(enviarEmail.enviados).toHaveLength(1);
  });

  it('debe_enviar_el_render_real_de_E2_no_el_placeholder_de_renderInactivo', async () => {
    const { motor, enviarEmail } = montar();

    await motor.despachar(comandoE2({ adjuntos: [adjuntoPresupuesto(PDF_URL)] }));

    const enviado = enviarEmail.enviados[0];
    expect(enviado.codigoEmail).toBe('E2');
    expect(enviado.destinatario).toBe(EMAIL);
    // Contenido REAL, no el placeholder de una plantilla inactiva.
    expect(enviado.asunto).not.toContain('pendiente de cableado');
    expect(enviado.cuerpo).not.toContain('inactiva');
    // El adjunto del presupuesto viaja en el comando de envío.
    expect(enviado.adjuntos).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ clave: 'presupuesto', pdfUrl: PDF_URL }),
      ]),
    );
  });
});

// ===========================================================================
// 2. SIN el adjunto (pdfUrl null/ausente) → el envío se BLOQUEA: `motivo:
//    'adjunto_no_disponible'`, NO se crea COMUNICACION enviada, NO se llama al proveedor.
//   spec-delta: "Sin PDF disponible, E2 NO se envía sin el presupuesto (D-1 requerido)".
// ===========================================================================

describe('DespacharEmailService — E2 sin adjunto se bloquea (D-1 requerido)', () => {
  it('debe_bloquear_el_envio_cuando_el_adjunto_presupuesto_falta_por_completo', async () => {
    const { motor, comunicaciones, enviarEmail } = montar();

    const resultado = await motor.despachar(comandoE2({ adjuntos: [] }));

    expect(resultado.motivo).toBe('adjunto_no_disponible');
    expect(resultado.comunicacion).toBeNull();
    // NO se crea la fila enviada y NO se toca el proveedor (cero red).
    expect(comunicaciones.crear).not.toHaveBeenCalled();
    expect(enviarEmail.enviados).toHaveLength(0);
  });

  it('debe_bloquear_el_envio_cuando_el_pdfUrl_del_presupuesto_es_null', async () => {
    const { motor, comunicaciones, enviarEmail } = montar();

    const resultado = await motor.despachar(
      comandoE2({ adjuntos: [adjuntoPresupuesto(null)] }),
    );

    expect(resultado.motivo).toBe('adjunto_no_disponible');
    expect(resultado.comunicacion).toBeNull();
    expect(comunicaciones.crear).not.toHaveBeenCalled();
    expect(enviarEmail.enviados).toHaveLength(0);
  });

  it('debe_ser_observable_el_intento_bloqueado_en_AUDIT_LOG', async () => {
    const { motor, auditoria } = montar();

    await motor.despachar(comandoE2({ adjuntos: [adjuntoPresupuesto(null)] }));

    // El bloqueo por adjunto no disponible se traza (intento observable, no silencioso).
    const auditoriaSerializada = JSON.stringify(auditoria.registrar.mock.calls);
    expect(auditoriaSerializada).toContain('adjunto_no_disponible');
    expect(auditoriaSerializada).toContain('E2');
  });
});
