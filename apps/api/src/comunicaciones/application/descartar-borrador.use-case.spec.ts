/**
 * TESTS del caso de uso `DescartarBorradorUseCase` (US-046 / UC-36) — fase TDD RED.
 * tasks.md Fase 3: §3.6 (descarte: borrador→`fallido` sin envío + AUDIT_LOG causa
 * "descartado por gestor"; no descartable si no está en `borrador`), §3.9 (multi-tenancy).
 *
 * Trazabilidad: US-046, spec-delta `comunicaciones` Requirements:
 *   - "Descarte de un borrador por el gestor lo lleva a fallido sin envío y con causa
 *     auditada" (Scenarios: "Descartar un borrador lo pasa a fallido y lo audita como
 *     descartado", "No se puede descartar una comunicación que no está en borrador").
 *   - "Toda acción manual de comunicaciones corre bajo el tenant del JWT …".
 * design.md D-5 (Descarte, Opción A): `actualizarEstado({ estado:'fallido',
 * fechaEnvio:null })` SIN llamar al puerto de envío, + `AuditLogPort` con la causa
 * `"descartado por gestor"` (distinguible de un fallo del proveedor por dicha causa).
 * D-2: conflicto de estado → 409.
 *
 * Ejercita la APLICACIÓN contra DOBLES DE LOS PUERTOS de US-045 (in-memory), SIN tocar
 * Prisma (hexagonal, hook `no-infra-in-domain`). NO se inyecta el `EnviarEmailPort` en
 * el camino del descarte (no se envía nada).
 *
 * RED: aún NO existe `comunicaciones/application/descartar-borrador.use-case.ts` ni sus
 * tipos/errores. Los imports fallan y la batería está en ROJO por AUSENCIA DE
 * IMPLEMENTACIÓN. GREEN es de `backend-developer`.
 */
import {
  DescartarBorradorUseCase,
  ComunicacionNoEncontradaError,
  EstadoNoBorradorError,
  type DescartarBorradorDeps,
  type DescartarBorradorComando,
  type CargarComunicacionPort,
  type ComunicacionContexto,
} from './descartar-borrador.use-case';
import type { ComunicacionRepositoryPort } from '../domain/comunicacion.repository.port';
import type { EnviarEmailPort } from '../domain/enviar-email.port';
import type { AuditLogPort } from '../../shared/audit/audit-log.port';

const TENANT = '00000000-0000-0000-0000-000000000001';
const OTRO_TENANT = '00000000-0000-0000-0000-0000000000ff';
const GESTOR = '00000000-0000-0000-0000-000000000002';
const RESERVA_ID = 'res-1';
const CLIENTE_ID = 'cli-1';
const COM_ID = 'com-1';
const EMAIL = 'marta.soler@example.com';

const comunicacionBorrador = (
  over: Partial<ComunicacionContexto> = {},
): ComunicacionContexto => ({
  idComunicacion: COM_ID,
  tenantId: TENANT,
  reservaId: RESERVA_ID,
  clienteId: CLIENTE_ID,
  codigoEmail: 'E1',
  estado: 'borrador',
  asunto: 'ASUNTO-E1',
  cuerpo: '<p>Borrador</p>',
  destinatarioEmail: EMAIL,
  fechaEnvio: null,
  ...over,
});

interface Dobles {
  cargar: CargarComunicacionPort & { cargar: jest.Mock };
  comunicaciones: ComunicacionRepositoryPort & { actualizarEstado: jest.Mock };
  enviarEmail: EnviarEmailPort & { enviar: jest.Mock };
  auditoria: AuditLogPort & { registrar: jest.Mock };
}

const construirDobles = (
  opts: { comunicacion?: ComunicacionContexto | null } = {},
): { deps: DescartarBorradorDeps } & Dobles => {
  const comunicacion =
    opts.comunicacion === undefined ? comunicacionBorrador() : opts.comunicacion;

  const cargar = {
    cargar: jest.fn(async () => comunicacion),
  } as CargarComunicacionPort & { cargar: jest.Mock };

  const comunicaciones = {
    buscarPorReservaYCodigo: jest.fn(async () => null),
    crear: jest.fn(async () => {
      throw new Error('crear no debe usarse en el descarte');
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

  const enviarEmail = {
    enviar: jest.fn(async () => undefined),
  } as EnviarEmailPort & { enviar: jest.Mock };

  const auditoria = {
    registrar: jest.fn(async () => undefined),
  } as AuditLogPort & { registrar: jest.Mock };

  const deps: DescartarBorradorDeps = {
    cargarComunicacion: cargar,
    comunicaciones,
    auditoria,
  };
  return { deps, cargar, comunicaciones, enviarEmail, auditoria };
};

const comando = (
  over: Partial<DescartarBorradorComando> = {},
): DescartarBorradorComando => ({
  tenantId: TENANT,
  usuarioId: GESTOR,
  reservaId: RESERVA_ID,
  idComunicacion: COM_ID,
  ...over,
});

// ===========================================================================
// 3.6 — Descartar un borrador lo pasa a `fallido` sin envío y lo audita.
// ===========================================================================

describe('DescartarBorradorUseCase — descarte de un borrador (3.6)', () => {
  it('debe_pasar_el_borrador_a_fallido_sin_fecha_envio', async () => {
    const { deps, comunicaciones } = construirDobles();
    const uc = new DescartarBorradorUseCase(deps);

    const resultado = await uc.ejecutar(comando());

    expect(comunicaciones.actualizarEstado).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: TENANT,
        idComunicacion: COM_ID,
        estado: 'fallido',
        fechaEnvio: null,
      }),
    );
    expect(resultado.estado).toBe('fallido');
    expect(resultado.fechaEnvio).toBeNull();
  });

  it('no_debe_enviar_ningun_email_al_descartar', async () => {
    const { deps, enviarEmail } = construirDobles();
    const uc = new DescartarBorradorUseCase(deps);

    await uc.ejecutar(comando());

    // El descarte NO toca el proveedor de email (design.md D-5 Opción A).
    expect(enviarEmail.enviar).not.toHaveBeenCalled();
  });

  it('debe_auditar_el_descarte_con_la_causa_descartado_por_gestor', async () => {
    const { deps, auditoria } = construirDobles();
    const uc = new DescartarBorradorUseCase(deps);

    await uc.ejecutar(comando());

    expect(auditoria.registrar).toHaveBeenCalledTimes(1);
    const registro = auditoria.registrar.mock.calls[0][0];
    expect(registro.tenantId).toBe(TENANT);
    expect(registro.entidad).toBe('COMUNICACION');
    // La causa distingue el descarte de un fallo del proveedor (D-5).
    expect(JSON.stringify(registro)).toContain('descartado por gestor');
  });
});

// ===========================================================================
// 3.6 — Solo se puede descartar una fila en `borrador` (conflicto de estado).
// ===========================================================================

describe('DescartarBorradorUseCase — solo descartable en borrador (3.6)', () => {
  it('debe_rechazar_el_descarte_cuando_la_comunicacion_esta_enviada', async () => {
    const { deps, comunicaciones } = construirDobles({
      comunicacion: comunicacionBorrador({
        estado: 'enviado',
        fechaEnvio: new Date('2026-07-16T09:00:00.000Z'),
      }),
    });
    const uc = new DescartarBorradorUseCase(deps);

    await expect(uc.ejecutar(comando())).rejects.toBeInstanceOf(
      EstadoNoBorradorError,
    );
    // Sin efectos: no se actualiza el estado.
    expect(comunicaciones.actualizarEstado).not.toHaveBeenCalled();
  });

  it('debe_rechazar_el_descarte_cuando_la_comunicacion_ya_esta_en_fallido', async () => {
    const { deps, comunicaciones } = construirDobles({
      comunicacion: comunicacionBorrador({ estado: 'fallido', fechaEnvio: null }),
    });
    const uc = new DescartarBorradorUseCase(deps);

    await expect(uc.ejecutar(comando())).rejects.toBeInstanceOf(
      EstadoNoBorradorError,
    );
    expect(comunicaciones.actualizarEstado).not.toHaveBeenCalled();
  });

  it('debe_exponer_un_error_de_conflicto_mapeable_a_409', async () => {
    const { deps } = construirDobles({
      comunicacion: comunicacionBorrador({ estado: 'enviado' }),
    });
    const uc = new DescartarBorradorUseCase(deps);

    await expect(uc.ejecutar(comando())).rejects.toMatchObject({
      codigo: 'estado_no_borrador',
    });
  });
});

// ===========================================================================
// 3.9 — Comunicación inexistente / de otro tenant (RLS) → rechazo sin efectos.
// ===========================================================================

describe('DescartarBorradorUseCase — no encontrada o de otro tenant (3.9)', () => {
  it('debe_lanzar_ComunicacionNoEncontrada_cuando_no_existe_para_el_tenant', async () => {
    const { deps, comunicaciones } = construirDobles({ comunicacion: null });
    const uc = new DescartarBorradorUseCase(deps);

    await expect(uc.ejecutar(comando())).rejects.toBeInstanceOf(
      ComunicacionNoEncontradaError,
    );
    expect(comunicaciones.actualizarEstado).not.toHaveBeenCalled();
  });

  it('debe_cargar_la_comunicacion_scoped_por_el_tenant_del_jwt', async () => {
    const { deps, cargar } = construirDobles();
    const uc = new DescartarBorradorUseCase(deps);

    await uc.ejecutar(comando({ tenantId: TENANT }));

    expect(cargar.cargar).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: TENANT,
        reservaId: RESERVA_ID,
        idComunicacion: COM_ID,
      }),
    );
  });

  it('debe_rechazar_el_descarte_de_una_comunicacion_de_otro_tenant', async () => {
    const { deps, comunicaciones } = construirDobles({ comunicacion: null });
    const uc = new DescartarBorradorUseCase(deps);

    await expect(
      uc.ejecutar(comando({ tenantId: OTRO_TENANT })),
    ).rejects.toBeInstanceOf(ComunicacionNoEncontradaError);
    expect(comunicaciones.actualizarEstado).not.toHaveBeenCalled();
  });
});
