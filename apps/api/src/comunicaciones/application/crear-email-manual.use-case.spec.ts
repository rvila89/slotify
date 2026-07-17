/**
 * TESTS del caso de uso `CrearEmailManualUseCase` (US-046 / UC-36) — fase TDD RED.
 * tasks.md Fase 3: §3.7 (email manual: crea `COMUNICACION` `manual`/`enviado`/
 * `fecha_envio` no nulo, `reserva_id`/`cliente_id`/`tenant_id` correctos; varios
 * `manual` por reserva sin colisión —fuera del índice parcial, D-5—; cliente sin email
 * válido bloquea), §3.4 (validación de destinatario), §3.9 (multi-tenancy).
 *
 * Trazabilidad: US-046, spec-delta `comunicaciones` Requirements:
 *   - "Creación y envío de un email manual desde la ficha de la RESERVA" (Scenarios:
 *     "Crear un email manual lo envía y crea la fila enviada", "Varios emails manuales
 *     sobre la misma reserva no colisionan por idempotencia", "Email manual con cliente
 *     sin email válido bloquea el envío").
 *   - "Toda acción manual de comunicaciones corre bajo el tenant del JWT …".
 * design.md D-5 (Opción C, MIGRACIÓN): el email `manual` se crea con `reserva_id` NO
 * nulo y **`es_reenvio = false`** (semántica honesta: NO es un reenvío), quedando fuera
 * del índice UNIQUE parcial por el predicado `codigo_email <> 'manual'`. D-1 (use-case
 * dedicado que orquesta los puertos de US-045). D-4 (validador `esEmailValido` ANTES
 * del envío). D-2 (422 email inválido; 502 fallo proveedor).
 *
 * Ejercita la APLICACIÓN contra DOBLES DE LOS PUERTOS de US-045 (in-memory), SIN tocar
 * Prisma (hexagonal, hook `no-infra-in-domain`). La INVARIANTE REAL del índice parcial
 * (varios `manual` con `reserva_id` no nulo y `es_reenvio=false` sin colisión P2002) se
 * verifica en el test de INTEGRACIÓN con Postgres real (que debe ejecutar la sesión
 * principal); aquí se fija que el use-case crea la fila con esas propiedades.
 *
 * RED: aún NO existe `comunicaciones/application/crear-email-manual.use-case.ts` ni sus
 * tipos/errores. Los imports fallan y la batería está en ROJO por AUSENCIA DE
 * IMPLEMENTACIÓN. GREEN es de `backend-developer`.
 */
import {
  CrearEmailManualUseCase,
  ReservaNoEncontradaError,
  DestinatarioInvalidoError,
  ProveedorEmailError,
  type CrearEmailManualDeps,
  type CrearEmailManualComando,
  type CargarReservaContextoPort,
  type ReservaContexto,
} from './crear-email-manual.use-case';
import type {
  ComunicacionRepositoryPort,
  RegistrarComunicacionParams,
} from '../domain/comunicacion.repository.port';
import type { EnviarEmailPort } from '../domain/enviar-email.port';
import type { AuditLogPort } from '../../shared/audit/audit-log.port';

const TENANT = '00000000-0000-0000-0000-000000000001';
const OTRO_TENANT = '00000000-0000-0000-0000-0000000000ff';
const GESTOR = '00000000-0000-0000-0000-000000000002';
const RESERVA_ID = 'res-1';
const CLIENTE_ID = 'cli-1';
const EMAIL = 'marta.soler@example.com';
const ASUNTO = 'Consulta puntual sobre tu evento';
const CUERPO = '<p>Hola Marta, te escribo para …</p>';

const reservaContexto = (over: Partial<ReservaContexto> = {}): ReservaContexto => ({
  idReserva: RESERVA_ID,
  tenantId: TENANT,
  clienteId: CLIENTE_ID,
  clienteEmail: EMAIL,
  ...over,
});

interface Dobles {
  cargar: CargarReservaContextoPort & { cargar: jest.Mock };
  comunicaciones: ComunicacionRepositoryPort & {
    crear: jest.Mock;
    actualizarEstado: jest.Mock;
  };
  enviarEmail: EnviarEmailPort & { enviar: jest.Mock };
  auditoria: AuditLogPort & { registrar: jest.Mock };
}

const construirDobles = (
  opts: {
    reserva?: ReservaContexto | null;
    fallaProveedor?: boolean;
  } = {},
): { deps: CrearEmailManualDeps } & Dobles => {
  const reserva =
    opts.reserva === undefined ? reservaContexto() : opts.reserva;

  const cargar = {
    cargar: jest.fn(async () => reserva),
  } as CargarReservaContextoPort & { cargar: jest.Mock };

  let contador = 0;
  const comunicaciones = {
    buscarPorReservaYCodigo: jest.fn(async () => null),
    crear: jest.fn(async (p: RegistrarComunicacionParams) => {
      contador += 1;
      return {
        idComunicacion: `com-manual-${contador}`,
        tenantId: p.tenantId,
        reservaId: p.reservaId,
        clienteId: p.clienteId,
        codigoEmail: p.codigoEmail,
        estado: p.estado,
        destinatarioEmail: p.destinatarioEmail,
        fechaEnvio: p.fechaEnvio,
      };
    }),
    actualizarEstado: jest.fn(async (p) => ({
      idComunicacion: p.idComunicacion,
      tenantId: p.tenantId,
      reservaId: RESERVA_ID,
      clienteId: CLIENTE_ID,
      codigoEmail: 'manual' as const,
      estado: p.estado,
      destinatarioEmail: EMAIL,
      fechaEnvio: p.fechaEnvio,
    })),
  } as unknown as ComunicacionRepositoryPort & {
    crear: jest.Mock;
    actualizarEstado: jest.Mock;
  };

  const enviarEmail = {
    enviar: jest.fn(async () => {
      if (opts.fallaProveedor === true) {
        throw new Error('proveedor caído');
      }
    }),
  } as EnviarEmailPort & { enviar: jest.Mock };

  const auditoria = {
    registrar: jest.fn(async () => undefined),
  } as AuditLogPort & { registrar: jest.Mock };

  const deps: CrearEmailManualDeps = {
    cargarReserva: cargar,
    comunicaciones,
    enviarEmail,
    auditoria,
    clock: { ahora: () => new Date('2026-07-17T10:00:00.000Z') },
  };
  return { deps, cargar, comunicaciones, enviarEmail, auditoria };
};

const comando = (
  over: Partial<CrearEmailManualComando> = {},
): CrearEmailManualComando => ({
  tenantId: TENANT,
  usuarioId: GESTOR,
  reservaId: RESERVA_ID,
  asunto: ASUNTO,
  cuerpo: CUERPO,
  ...over,
});

// ===========================================================================
// 3.7 — Crear un email manual lo envía y crea la fila `enviado`.
// ===========================================================================

describe('CrearEmailManualUseCase — crear y enviar manual (3.7)', () => {
  it('debe_enviar_el_email_al_cliente_de_la_reserva', async () => {
    const { deps, enviarEmail } = construirDobles();
    const uc = new CrearEmailManualUseCase(deps);

    await uc.ejecutar(comando());

    expect(enviarEmail.enviar).toHaveBeenCalledTimes(1);
    expect(enviarEmail.enviar).toHaveBeenCalledWith(
      expect.objectContaining({
        destinatario: EMAIL,
        asunto: ASUNTO,
        cuerpo: CUERPO,
        codigoEmail: 'manual',
      }),
    );
  });

  it('debe_crear_la_comunicacion_manual_enviada_con_fecha_y_vinculos_correctos', async () => {
    const { deps, comunicaciones } = construirDobles();
    const uc = new CrearEmailManualUseCase(deps);

    const resultado = await uc.ejecutar(comando());

    // La fila se crea `manual` + `enviado` + `fecha_envio` no nulo, con los vínculos
    // del JWT y de la RESERVA (nunca del body).
    const args = comunicaciones.crear.mock.calls[0][0] as RegistrarComunicacionParams;
    expect(args.codigoEmail).toBe('manual');
    expect(args.tenantId).toBe(TENANT);
    expect(args.reservaId).toBe(RESERVA_ID);
    expect(args.clienteId).toBe(CLIENTE_ID);
    expect(args.destinatarioEmail).toBe(EMAIL);
    expect(args.asunto).toBe(ASUNTO);

    expect(resultado.estado).toBe('enviado');
    expect(resultado.fechaEnvio).toBeInstanceOf(Date);
    expect(resultado.codigoEmail).toBe('manual');
  });

  it('debe_crear_el_manual_con_es_reenvio_false_semantica_honesta_D5', async () => {
    const { deps, comunicaciones } = construirDobles();
    const uc = new CrearEmailManualUseCase(deps);

    await uc.ejecutar(comando());

    // D-5 Opción C (MIGRACIÓN): el `manual` NO es un reenvío; queda fuera del índice
    // parcial por el predicado `codigo_email <> 'manual'`, NO por `es_reenvio=true`.
    const args = comunicaciones.crear.mock.calls[0][0] as RegistrarComunicacionParams;
    expect(args.esReenvio ?? false).toBe(false);
  });

  it('debe_registrar_la_operacion_en_audit_log_bajo_el_tenant_del_jwt', async () => {
    const { deps, auditoria } = construirDobles();
    const uc = new CrearEmailManualUseCase(deps);

    await uc.ejecutar(comando());

    expect(auditoria.registrar).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: TENANT, entidad: 'COMUNICACION' }),
    );
  });
});

// ===========================================================================
// 3.7 — Varios emails manuales sobre la misma reserva NO colisionan por idempotencia.
//        (La invariante REAL del índice se prueba en el test de INTEGRACIÓN con
//        Postgres; aquí se verifica que el use-case NO consulta idempotencia ni
//        reutiliza filas: cada manual crea una NUEVA COMUNICACION.)
// ===========================================================================

describe('CrearEmailManualUseCase — varios manuales sin colisión (3.7)', () => {
  it('debe_crear_una_nueva_comunicacion_en_cada_manual_sin_consultar_idempotencia', async () => {
    const { deps, comunicaciones } = construirDobles();
    const uc = new CrearEmailManualUseCase(deps);

    const primero = await uc.ejecutar(comando({ asunto: 'Primero' }));
    const segundo = await uc.ejecutar(comando({ asunto: 'Segundo' }));

    // Dos filas nuevas y distintas; el use-case NO bloquea por (reserva, código).
    expect(comunicaciones.crear).toHaveBeenCalledTimes(2);
    expect(comunicaciones.buscarPorReservaYCodigo).not.toHaveBeenCalled();
    expect(primero.idComunicacion).not.toBe(segundo.idComunicacion);
  });
});

// ===========================================================================
// 3.4 / 3.7 — Cliente sin email válido bloquea: no crea fila `enviado` ni envía.
// ===========================================================================

describe('CrearEmailManualUseCase — cliente sin email válido bloquea (3.4/3.7)', () => {
  it('debe_bloquear_cuando_el_email_del_cliente_es_nulo', async () => {
    const { deps, comunicaciones, enviarEmail } = construirDobles({
      reserva: reservaContexto({ clienteEmail: null }),
    });
    const uc = new CrearEmailManualUseCase(deps);

    await expect(uc.ejecutar(comando())).rejects.toBeInstanceOf(
      DestinatarioInvalidoError,
    );
    // Ni se crea `COMUNICACION` enviado ni se llama al proveedor.
    expect(comunicaciones.crear).not.toHaveBeenCalled();
    expect(enviarEmail.enviar).not.toHaveBeenCalled();
  });

  it('debe_bloquear_cuando_el_email_del_cliente_tiene_formato_invalido', async () => {
    const { deps, comunicaciones, enviarEmail } = construirDobles({
      reserva: reservaContexto({ clienteEmail: 'no-es-email' }),
    });
    const uc = new CrearEmailManualUseCase(deps);

    await expect(uc.ejecutar(comando())).rejects.toBeInstanceOf(
      DestinatarioInvalidoError,
    );
    expect(comunicaciones.crear).not.toHaveBeenCalled();
    expect(enviarEmail.enviar).not.toHaveBeenCalled();
  });

  it('debe_exponer_un_error_de_validacion_mapeable_a_422', async () => {
    const { deps } = construirDobles({
      reserva: reservaContexto({ clienteEmail: null }),
    });
    const uc = new CrearEmailManualUseCase(deps);

    await expect(uc.ejecutar(comando())).rejects.toMatchObject({
      codigo: 'destinatario_invalido',
    });
  });
});

// ===========================================================================
// 3.5-manual — Fallo del proveedor al enviar el manual → error mapeable a 502.
//        La fila queda persistida en `fallido` (el use-case la deja coherente antes
//        de exponer el error), sin propagar la excepción cruda del proveedor.
// ===========================================================================

describe('CrearEmailManualUseCase — fallo del proveedor (502)', () => {
  it('debe_exponer_un_error_de_proveedor_cuando_el_envio_falla', async () => {
    const { deps } = construirDobles({ fallaProveedor: true });
    const uc = new CrearEmailManualUseCase(deps);

    await expect(uc.ejecutar(comando())).rejects.toBeInstanceOf(ProveedorEmailError);
  });

  it('debe_exponer_un_error_de_proveedor_mapeable_a_502', async () => {
    const { deps } = construirDobles({ fallaProveedor: true });
    const uc = new CrearEmailManualUseCase(deps);

    await expect(uc.ejecutar(comando())).rejects.toMatchObject({
      codigo: 'proveedor_email',
    });
  });
});

// ===========================================================================
// 3.9 — RESERVA inexistente / de otro tenant (RLS) → rechazo sin efectos.
// ===========================================================================

describe('CrearEmailManualUseCase — reserva inexistente o de otro tenant (3.9)', () => {
  it('debe_lanzar_ReservaNoEncontrada_cuando_no_existe_para_el_tenant', async () => {
    const { deps, comunicaciones, enviarEmail } = construirDobles({ reserva: null });
    const uc = new CrearEmailManualUseCase(deps);

    await expect(uc.ejecutar(comando())).rejects.toBeInstanceOf(
      ReservaNoEncontradaError,
    );
    expect(comunicaciones.crear).not.toHaveBeenCalled();
    expect(enviarEmail.enviar).not.toHaveBeenCalled();
  });

  it('debe_tomar_el_tenant_del_jwt_y_el_cliente_de_la_reserva_no_del_body', async () => {
    const { deps, cargar, comunicaciones } = construirDobles();
    const uc = new CrearEmailManualUseCase(deps);

    await uc.ejecutar(comando({ tenantId: TENANT }));

    // Carga scoped por el tenant del JWT.
    expect(cargar.cargar).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: TENANT, reservaId: RESERVA_ID }),
    );
    // Los vínculos persistidos son los de la RESERVA (cliente) y el JWT (tenant).
    const args = comunicaciones.crear.mock.calls[0][0] as RegistrarComunicacionParams;
    expect(args.tenantId).toBe(TENANT);
    expect(args.clienteId).toBe(CLIENTE_ID);
  });

  it('debe_rechazar_la_creacion_para_una_reserva_de_otro_tenant', async () => {
    const { deps, comunicaciones } = construirDobles({ reserva: null });
    const uc = new CrearEmailManualUseCase(deps);

    await expect(
      uc.ejecutar(comando({ tenantId: OTRO_TENANT })),
    ).rejects.toBeInstanceOf(ReservaNoEncontradaError);
    expect(comunicaciones.crear).not.toHaveBeenCalled();
  });
});
