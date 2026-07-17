/**
 * TESTS del caso de uso `EnviarBorradorUseCase` (US-046 / UC-36) — fase TDD RED.
 * tasks.md Fase 3: §3.1 (confirmar envío borrador→enviado + fecha_envio reutilizando
 * el motor), §3.2 (edición opcional asunto/cuerpo; codigo/destinatario no editables),
 * §3.3 (guarda de estado / idempotencia de la acción manual), §3.4 (validación de
 * destinatario PREVIA que deja en `borrador`), §3.5 (fallo del proveedor → `fallido`
 * sin fecha + AUDIT_LOG, sin propagar), §3.9 (multi-tenancy).
 *
 * Trazabilidad: US-046, spec-delta `comunicaciones` Requirements:
 *   - "Confirmación de envío de un borrador con edición opcional de asunto y cuerpo".
 *   - "Solo un borrador es enviable — enviado y fallido son de solo lectura
 *     (idempotencia de la acción manual)".
 *   - "Validación del destinatario antes del envío deja el borrador en borrador".
 *   - "Fallo del proveedor al enviar un borrador deja la comunicación en fallido …".
 *   - "Toda acción manual de comunicaciones corre bajo el tenant del JWT …".
 * design.md D-1 (TRES use-cases; el envío del borrador DELEGA en `finalizarEnvio`,
 * previa edición de asunto/cuerpo y previa validación de destinatario), D-4 (validador
 * de dominio `esEmailValido` ANTES del envío), D-2 (errores tipados que el controller
 * mapea a 409/422/502).
 *
 * Ejercita la APLICACIÓN contra DOBLES DE LOS PUERTOS de US-045 (in-memory), SIN tocar
 * Prisma (hexagonal, hook `no-infra-in-domain`). El motor `DespacharEmailService` se
 * inyecta como colaborador y se espía su `finalizarEnvio` (ÚNICO camino de envío del
 * borrador, D-1). La red de seguridad real (RLS, transporte fake, índice UNIQUE) se
 * verifica en QA/integración con Postgres; aquí se fija la ORQUESTACIÓN.
 *
 * RED: aún NO existe `comunicaciones/application/enviar-borrador.use-case.ts` ni sus
 * puertos/tipos (`CargarComunicacionPort`, `EstadoNoBorradorError`,
 * `DestinatarioInvalidoError`, `ComunicacionNoEncontradaError`, `ProveedorEmailError`).
 * Los imports fallan y la batería está en ROJO por AUSENCIA DE IMPLEMENTACIÓN. GREEN es
 * de `backend-developer`.
 */
import {
  EnviarBorradorUseCase,
  ComunicacionNoEncontradaError,
  EstadoNoBorradorError,
  DestinatarioInvalidoError,
  ProveedorEmailError,
  type EnviarBorradorDeps,
  type EnviarBorradorComando,
  type CargarComunicacionPort,
  type ComunicacionContexto,
} from './enviar-borrador.use-case';
import type { DespacharEmailService } from './despachar-email.service';
import type { ComunicacionRepositoryPort } from '../domain/comunicacion.repository.port';
import type { AuditLogPort } from '../../shared/audit/audit-log.port';

const TENANT = '00000000-0000-0000-0000-000000000001';
const OTRO_TENANT = '00000000-0000-0000-0000-0000000000ff';
const GESTOR = '00000000-0000-0000-0000-000000000002';
const RESERVA_ID = 'res-1';
const CLIENTE_ID = 'cli-1';
const COM_ID = 'com-1';
const EMAIL = 'marta.soler@example.com';
const ASUNTO_ORIGINAL = 'ASUNTO-E1';
const CUERPO_ORIGINAL = '<p>Borrador original E1</p>';

// ---------------------------------------------------------------------------
// Doble de la COMUNICACION cargada (borrador E1 con destinatario válido).
// ---------------------------------------------------------------------------

const comunicacionBorrador = (
  over: Partial<ComunicacionContexto> = {},
): ComunicacionContexto => ({
  idComunicacion: COM_ID,
  tenantId: TENANT,
  reservaId: RESERVA_ID,
  clienteId: CLIENTE_ID,
  codigoEmail: 'E1',
  estado: 'borrador',
  asunto: ASUNTO_ORIGINAL,
  cuerpo: CUERPO_ORIGINAL,
  destinatarioEmail: EMAIL,
  fechaEnvio: null,
  ...over,
});

// ---------------------------------------------------------------------------
// Dobles de puertos / colaboradores.
// ---------------------------------------------------------------------------

interface Dobles {
  cargar: CargarComunicacionPort & { cargar: jest.Mock };
  comunicaciones: ComunicacionRepositoryPort & { actualizarEstado: jest.Mock };
  motor: DespacharEmailService & { finalizarEnvio: jest.Mock };
  auditoria: AuditLogPort & { registrar: jest.Mock };
}

const construirDobles = (
  opts: {
    comunicacion?: ComunicacionContexto | null;
    resultadoFinalizar?: { estado: 'enviado' | 'fallido'; fechaEnvio: Date | null };
  } = {},
): { deps: EnviarBorradorDeps } & Dobles => {
  const comunicacion =
    opts.comunicacion === undefined ? comunicacionBorrador() : opts.comunicacion;
  const resultado =
    opts.resultadoFinalizar ?? {
      estado: 'enviado' as const,
      fechaEnvio: new Date('2026-07-17T10:00:00.000Z'),
    };

  const cargar = {
    cargar: jest.fn(async () => comunicacion),
  } as CargarComunicacionPort & { cargar: jest.Mock };

  const comunicaciones = {
    buscarPorReservaYCodigo: jest.fn(async () => null),
    crear: jest.fn(async () => {
      throw new Error('crear no debe usarse en el envío de un borrador');
    }),
    actualizarEstado: jest.fn(async (p) => ({
      idComunicacion: p.idComunicacion,
      tenantId: p.tenantId,
      reservaId: RESERVA_ID,
      clienteId: CLIENTE_ID,
      codigoEmail: 'E1' as const,
      estado: p.estado,
      destinatarioEmail: EMAIL,
      fechaEnvio: p.fechaEnvio,
    })),
  } as unknown as ComunicacionRepositoryPort & { actualizarEstado: jest.Mock };

  const motor = {
    finalizarEnvio: jest.fn(async () => ({
      estado: resultado.estado,
      fechaEnvio: resultado.fechaEnvio,
      comunicacion: {
        idComunicacion: COM_ID,
        tenantId: TENANT,
        reservaId: RESERVA_ID,
        clienteId: CLIENTE_ID,
        codigoEmail: 'E1' as const,
        estado: resultado.estado,
        destinatarioEmail: EMAIL,
        fechaEnvio: resultado.fechaEnvio,
      },
    })),
  } as unknown as DespacharEmailService & { finalizarEnvio: jest.Mock };

  const auditoria = {
    registrar: jest.fn(async () => undefined),
  } as AuditLogPort & { registrar: jest.Mock };

  const deps: EnviarBorradorDeps = {
    cargarComunicacion: cargar,
    comunicaciones,
    motor,
    auditoria,
  };
  return { deps, cargar, comunicaciones, motor, auditoria };
};

const comando = (
  over: Partial<EnviarBorradorComando> = {},
): EnviarBorradorComando => ({
  tenantId: TENANT,
  usuarioId: GESTOR,
  reservaId: RESERVA_ID,
  idComunicacion: COM_ID,
  ...over,
});

// ===========================================================================
// 3.1 — Confirmar el envío sin editar deja la comunicación enviada.
// ===========================================================================

describe('EnviarBorradorUseCase — confirmar envío sin editar (3.1)', () => {
  it('debe_enviar_reutilizando_finalizarEnvio_y_promover_a_enviado_con_fecha', async () => {
    const { deps, motor } = construirDobles();
    const uc = new EnviarBorradorUseCase(deps);

    const resultado = await uc.ejecutar(comando());

    // El envío del borrador DELEGA en el ÚNICO camino del motor (D-1).
    expect(motor.finalizarEnvio).toHaveBeenCalledTimes(1);
    expect(motor.finalizarEnvio).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: TENANT,
        reservaId: RESERVA_ID,
        idComunicacion: COM_ID,
        destinatario: EMAIL,
        codigoEmail: 'E1',
      }),
    );
    expect(resultado.estado).toBe('enviado');
    expect(resultado.fechaEnvio).toBeInstanceOf(Date);
  });

  it('debe_enviar_el_asunto_y_cuerpo_originales_cuando_no_se_edita', async () => {
    const { deps, motor } = construirDobles();
    const uc = new EnviarBorradorUseCase(deps);

    await uc.ejecutar(comando());

    expect(motor.finalizarEnvio).toHaveBeenCalledWith(
      expect.objectContaining({
        asunto: ASUNTO_ORIGINAL,
        cuerpo: CUERPO_ORIGINAL,
      }),
    );
  });

  it('debe_registrar_la_operacion_en_audit_log_bajo_el_tenant_del_jwt', async () => {
    const { deps, auditoria } = construirDobles();
    const uc = new EnviarBorradorUseCase(deps);

    await uc.ejecutar(comando());

    expect(auditoria.registrar).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: TENANT,
        entidad: 'COMUNICACION',
      }),
    );
  });
});

// ===========================================================================
// 3.2 — Edición opcional: se persiste/envía lo EFECTIVAMENTE enviado, no el original.
//        `codigo_email` y `destinatario_email` NO son editables.
// ===========================================================================

describe('EnviarBorradorUseCase — edición opcional de asunto/cuerpo (3.2)', () => {
  it('debe_enviar_el_cuerpo_editado_cuando_el_gestor_lo_modifica', async () => {
    const { deps, motor } = construirDobles();
    const uc = new EnviarBorradorUseCase(deps);
    const CUERPO_EDITADO = '<p>Texto personalizado por el gestor</p>';

    await uc.ejecutar(comando({ cuerpo: CUERPO_EDITADO }));

    // Se envía el contenido efectivamente enviado (editado), no el original.
    expect(motor.finalizarEnvio).toHaveBeenCalledWith(
      expect.objectContaining({ cuerpo: CUERPO_EDITADO }),
    );
  });

  it('debe_enviar_el_asunto_editado_cuando_el_gestor_lo_modifica', async () => {
    const { deps, motor } = construirDobles();
    const uc = new EnviarBorradorUseCase(deps);
    const ASUNTO_EDITADO = 'Asunto ajustado por el gestor';

    await uc.ejecutar(comando({ asunto: ASUNTO_EDITADO }));

    expect(motor.finalizarEnvio).toHaveBeenCalledWith(
      expect.objectContaining({ asunto: ASUNTO_EDITADO }),
    );
  });

  it('debe_mantener_el_codigo_y_el_destinatario_originales_aunque_venga_ruido_en_el_comando', async () => {
    const { deps, motor } = construirDobles();
    const uc = new EnviarBorradorUseCase(deps);

    // El comando sólo permite editar asunto/cuerpo; el codigo/destinatario NO son
    // parte del comando, así que el envío usa SIEMPRE los de la fila cargada.
    await uc.ejecutar(comando({ asunto: 'x', cuerpo: 'y' }));

    const params = motor.finalizarEnvio.mock.calls[0][0];
    expect(params.codigoEmail).toBe('E1');
    expect(params.destinatario).toBe(EMAIL);
  });
});

// ===========================================================================
// 3.3 — Solo un borrador es enviable: `enviado` terminal, `fallido` solo lectura.
//        Idempotencia de la acción manual: no re-envía, no revierte, no duplica.
// ===========================================================================

describe('EnviarBorradorUseCase — guarda de estado / idempotencia (3.3)', () => {
  it('debe_rechazar_como_conflicto_cuando_la_comunicacion_ya_esta_enviada', async () => {
    const { deps } = construirDobles({
      comunicacion: comunicacionBorrador({
        estado: 'enviado',
        fechaEnvio: new Date('2026-07-16T09:00:00.000Z'),
      }),
    });
    const uc = new EnviarBorradorUseCase(deps);

    await expect(uc.ejecutar(comando())).rejects.toBeInstanceOf(
      EstadoNoBorradorError,
    );
  });

  it('no_debe_reenviar_ni_actualizar_estado_cuando_ya_esta_enviada', async () => {
    const { deps, motor, comunicaciones } = construirDobles({
      comunicacion: comunicacionBorrador({
        estado: 'enviado',
        fechaEnvio: new Date('2026-07-16T09:00:00.000Z'),
      }),
    });
    const uc = new EnviarBorradorUseCase(deps);

    await uc.ejecutar(comando()).catch(() => undefined);

    // No se re-envía, no se revierte a borrador y no se duplica ninguna fila.
    expect(motor.finalizarEnvio).not.toHaveBeenCalled();
    expect(comunicaciones.actualizarEstado).not.toHaveBeenCalled();
  });

  it('debe_rechazar_como_conflicto_cuando_la_comunicacion_esta_en_fallido', async () => {
    const { deps, motor } = construirDobles({
      comunicacion: comunicacionBorrador({ estado: 'fallido', fechaEnvio: null }),
    });
    const uc = new EnviarBorradorUseCase(deps);

    await expect(uc.ejecutar(comando())).rejects.toBeInstanceOf(
      EstadoNoBorradorError,
    );
    expect(motor.finalizarEnvio).not.toHaveBeenCalled();
  });

  it('debe_exponer_un_error_de_conflicto_mapeable_a_409', async () => {
    const { deps } = construirDobles({
      comunicacion: comunicacionBorrador({ estado: 'enviado' }),
    });
    const uc = new EnviarBorradorUseCase(deps);

    await expect(uc.ejecutar(comando())).rejects.toMatchObject({
      codigo: 'estado_no_borrador',
    });
  });
});

// ===========================================================================
// 3.4 — Validación de destinatario PREVIA al envío: nulo/inválido bloquea y DEJA
//        la fila EN `borrador` (no `fallido`), sin llamar al proveedor (D-4).
// ===========================================================================

describe('EnviarBorradorUseCase — validación de destinatario previa (3.4)', () => {
  it('debe_bloquear_el_envio_cuando_el_destinatario_es_nulo', async () => {
    const { deps, motor, comunicaciones } = construirDobles({
      comunicacion: comunicacionBorrador({
        destinatarioEmail: null as unknown as string,
      }),
    });
    const uc = new EnviarBorradorUseCase(deps);

    await expect(uc.ejecutar(comando())).rejects.toBeInstanceOf(
      DestinatarioInvalidoError,
    );
    // NO se intenta enviar y la fila NO cambia de estado (queda en `borrador`).
    expect(motor.finalizarEnvio).not.toHaveBeenCalled();
    expect(comunicaciones.actualizarEstado).not.toHaveBeenCalled();
  });

  it('debe_bloquear_el_envio_cuando_el_destinatario_tiene_formato_invalido', async () => {
    const { deps, motor } = construirDobles({
      comunicacion: comunicacionBorrador({ destinatarioEmail: 'no-es-un-email' }),
    });
    const uc = new EnviarBorradorUseCase(deps);

    await expect(uc.ejecutar(comando())).rejects.toBeInstanceOf(
      DestinatarioInvalidoError,
    );
    expect(motor.finalizarEnvio).not.toHaveBeenCalled();
  });

  it('no_debe_marcar_la_fila_como_fallida_cuando_el_destinatario_es_invalido', async () => {
    const { deps, comunicaciones } = construirDobles({
      comunicacion: comunicacionBorrador({ destinatarioEmail: '' }),
    });
    const uc = new EnviarBorradorUseCase(deps);

    await uc.ejecutar(comando()).catch(() => undefined);

    // El envío ni se intentó: la fila permanece en `borrador` (no pasa a `fallido`).
    const marcadaFallida = comunicaciones.actualizarEstado.mock.calls.some(
      (c: [{ estado: string }]) => c[0].estado === 'fallido',
    );
    expect(marcadaFallida).toBe(false);
  });

  it('debe_exponer_un_error_de_validacion_mapeable_a_422', async () => {
    const { deps } = construirDobles({
      comunicacion: comunicacionBorrador({ destinatarioEmail: null as unknown as string }),
    });
    const uc = new EnviarBorradorUseCase(deps);

    await expect(uc.ejecutar(comando())).rejects.toMatchObject({
      codigo: 'destinatario_invalido',
    });
  });
});

// ===========================================================================
// 3.5 — Fallo del proveedor: la fila queda `fallido` sin fecha (lo hace el motor)
//        y el use-case expone un error mapeable a 502 (D-2), sin propagar la
//        excepción cruda del proveedor.
// ===========================================================================

describe('EnviarBorradorUseCase — fallo del proveedor al enviar borrador (3.5)', () => {
  it('debe_exponer_un_error_de_proveedor_cuando_finalizarEnvio_devuelve_fallido', async () => {
    const { deps, motor } = construirDobles({
      resultadoFinalizar: { estado: 'fallido', fechaEnvio: null },
    });
    const uc = new EnviarBorradorUseCase(deps);

    // El motor deja la fila en `fallido` + AUDIT_LOG (camino centralizado); el
    // use-case traduce ese resultado a un error de proveedor para el 502.
    await expect(uc.ejecutar(comando())).rejects.toBeInstanceOf(ProveedorEmailError);
    // Se intentó el envío exactamente una vez (sin reintento automático).
    expect(motor.finalizarEnvio).toHaveBeenCalledTimes(1);
  });

  it('debe_exponer_un_error_de_proveedor_mapeable_a_502', async () => {
    const { deps } = construirDobles({
      resultadoFinalizar: { estado: 'fallido', fechaEnvio: null },
    });
    const uc = new EnviarBorradorUseCase(deps);

    await expect(uc.ejecutar(comando())).rejects.toMatchObject({
      codigo: 'proveedor_email',
    });
  });
});

// ===========================================================================
// Comunicación inexistente / de otro tenant (RLS): cargar devuelve null → 404/rechazo.
// ===========================================================================

describe('EnviarBorradorUseCase — no encontrada o de otro tenant (3.9)', () => {
  it('debe_lanzar_ComunicacionNoEncontrada_cuando_no_existe_para_el_tenant', async () => {
    const { deps, motor } = construirDobles({ comunicacion: null });
    const uc = new EnviarBorradorUseCase(deps);

    await expect(uc.ejecutar(comando())).rejects.toBeInstanceOf(
      ComunicacionNoEncontradaError,
    );
    expect(motor.finalizarEnvio).not.toHaveBeenCalled();
  });

  it('debe_cargar_la_comunicacion_scoped_por_el_tenant_del_jwt_no_por_el_body', async () => {
    const { deps, cargar } = construirDobles();
    const uc = new EnviarBorradorUseCase(deps);

    // El comando trae el tenant del JWT; el use-case NUNCA usa un tenant del body.
    await uc.ejecutar(comando({ tenantId: TENANT }));

    expect(cargar.cargar).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: TENANT,
        reservaId: RESERVA_ID,
        idComunicacion: COM_ID,
      }),
    );
  });

  it('debe_rechazar_una_comunicacion_de_otro_tenant_sin_enviar', async () => {
    // El adaptador (RLS) no devuelve la fila para OTRO_TENANT: cargar → null.
    const { deps, motor } = construirDobles({ comunicacion: null });
    const uc = new EnviarBorradorUseCase(deps);

    await expect(
      uc.ejecutar(comando({ tenantId: OTRO_TENANT })),
    ).rejects.toBeInstanceOf(ComunicacionNoEncontradaError);
    expect(motor.finalizarEnvio).not.toHaveBeenCalled();
  });
});
