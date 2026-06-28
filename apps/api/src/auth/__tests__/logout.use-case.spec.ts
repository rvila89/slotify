/**
 * TESTS DE DOMINIO del caso de uso `logout` — fase TDD RED (US-002 · Cerrar Sesión).
 *
 * Trazabilidad: US-002, UC-02; spec-delta `auth` (Requirement MODIFICADO "Logout
 * limpia la sesión de refresh"). tasks.md Fase 3: 3.1, 3.2, 3.3, 3.5 (parte de
 * convención del registro de auditoría). Decisiones del Gate SDD: §1 best-effort
 * (stateless), §2 idempotencia / cookie opcional, §3 `entidad`/`entidad_id`.
 *
 * US-001 dejó un `logout` que recibía la identidad YA resuelta del ACCESS token
 * (`{ tenantId, idUsuario }`) y SIEMPRE auditaba. US-002 ENDURECE el caso de uso:
 *
 *   1. Identifica al usuario VERIFICANDO el REFRESH token de la cookie (no el access
 *      token), de modo que el logout funcione aunque el access ya haya expirado.
 *   2. Audita `logout` en AUDIT_LOG SOLO si hay usuario identificable.
 *   3. Es IDEMPOTENTE: con refresh ausente / expirado / inválido NO lanza error y
 *      NO audita (doble logout silencioso).
 *
 * Dominio puro contra DOBLES de los puertos (`TokenEmitterPort`, `AuditLogPort`),
 * sin tocar Prisma. RED esperado: el `LogoutUseCase` actual recibe
 * `{ tenantId, idUsuario }` y no depende de `TokenEmitterPort` ni implementa la
 * idempotencia; la nueva firma `{ refreshToken }` + verificación del refresh aún no
 * existe → ROJO por comportamiento/colaborador de producción ausente.
 */
import { LogoutUseCase, type LogoutComando, type LogoutDeps } from '../application/logout.use-case';
import type {
  AccessTokenPayload,
  AuditLogPort,
  TokenEmitterPort,
} from '../application/login.use-case';

const TENANT_ID = '00000000-0000-0000-0000-000000000001';
const OTRO_TENANT_ID = '00000000-0000-0000-0000-000000000002';
const USUARIO_ID = '00000000-0000-0000-0000-0000000000a1';
const EMAIL = 'info@masialencis.com';
const REFRESH_VALIDO = 'refresh.jwt.valido';

const payloadDe = (over?: Partial<AccessTokenPayload>): AccessTokenPayload => ({
  sub: USUARIO_ID,
  tenantId: TENANT_ID,
  rol: 'gestor',
  email: EMAIL,
  ...over,
});

type AuditFake = AuditLogPort & { registrar: jest.Mock };
type EmitterFake = Pick<TokenEmitterPort, 'verificarRefreshToken'> & {
  verificarRefreshToken: jest.Mock;
};

const crearAuditFake = (): AuditFake => ({ registrar: jest.fn(async () => undefined) });

/**
 * Doble del emisor de tokens: por defecto un refresh VÁLIDO devuelve el payload del
 * usuario; los tests sobreescriben `verificarRefreshToken` para simular un refresh
 * expirado/inválido (rechaza) o ausente.
 */
const crearEmitterFake = (payload: AccessTokenPayload | null = payloadDe()): EmitterFake => ({
  verificarRefreshToken: jest.fn(async (token: string) => {
    if (payload === null) {
      const e = new Error('refresh inválido o expirado');
      e.name = 'JsonWebTokenError';
      throw e;
    }
    return { ...payload, _tokenRecibido: token } as unknown as AccessTokenPayload;
  }),
});

const montar = (over?: { emitter?: EmitterFake; auditoria?: AuditFake }) => {
  const auditoria = over?.auditoria ?? crearAuditFake();
  const tokenEmitter = over?.emitter ?? crearEmitterFake();
  const deps = { auditoria, tokenEmitter } as unknown as LogoutDeps;
  return { useCase: new LogoutUseCase(deps), auditoria, tokenEmitter };
};

describe('LogoutUseCase — happy path: identifica por refresh y audita (US-002 §Happy Path)', () => {
  it('debe_identificar_al_usuario_verificando_el_refresh_token_de_la_cookie', async () => {
    const { useCase, tokenEmitter } = montar();

    await useCase.ejecutar({ refreshToken: REFRESH_VALIDO } as unknown as LogoutComando);

    expect(tokenEmitter.verificarRefreshToken).toHaveBeenCalledTimes(1);
    expect(tokenEmitter.verificarRefreshToken).toHaveBeenCalledWith(REFRESH_VALIDO);
  });

  it('debe_registrar_logout_en_AUDIT_LOG_con_usuario_y_tenant_del_refresh_y_la_convencion_USUARIO', async () => {
    const { useCase, auditoria } = montar();

    await useCase.ejecutar({ refreshToken: REFRESH_VALIDO } as unknown as LogoutComando);

    expect(auditoria.registrar).toHaveBeenCalledTimes(1);
    expect(auditoria.registrar).toHaveBeenCalledWith(
      expect.objectContaining({
        accion: 'logout',
        tenantId: TENANT_ID,
        usuarioId: USUARIO_ID,
        // §3: entidad = 'USUARIO'/'Usuario' (convención del registro `login`),
        // entidad_id = usuario_id. Se acepta cualquier casing para no acoplar el
        // RED a un detalle de serialización (ver "gap" en el resumen del agente).
        entidad: expect.stringMatching(/^usuario$/i),
        entidadId: USUARIO_ID,
      }),
    );
  });
});

describe('LogoutUseCase — idempotencia: best-effort sin error ni auditoría (US-002 §Edge sesión inválida)', () => {
  it('debe_completar_sin_error_y_sin_auditar_cuando_el_refresh_token_esta_ausente', async () => {
    const { useCase, auditoria } = montar();

    await expect(useCase.ejecutar({} as unknown as LogoutComando)).resolves.not.toThrow();

    expect(auditoria.registrar).not.toHaveBeenCalled();
  });

  it('debe_completar_sin_error_y_sin_auditar_cuando_el_refresh_token_es_invalido_o_expirado', async () => {
    // Emisor que SIEMPRE rechaza la verificación (refresh caducado/alterado).
    const emitter = crearEmitterFake(null);
    const { useCase, auditoria } = montar({ emitter });

    await expect(
      useCase.ejecutar({ refreshToken: 'refresh.caducado' } as unknown as LogoutComando),
    ).resolves.not.toThrow();

    expect(auditoria.registrar).not.toHaveBeenCalled();
  });
});

describe('LogoutUseCase — access token expirado pero refresh válido (US-002 §Edge access expirado)', () => {
  it('debe_completar_el_logout_identificando_por_el_refresh_sin_depender_del_access_token', async () => {
    // El caso de uso NO recibe ningún access token: solo el refresh de la cookie.
    const { useCase, auditoria, tokenEmitter } = montar();

    await expect(
      useCase.ejecutar({ refreshToken: REFRESH_VALIDO } as unknown as LogoutComando),
    ).resolves.not.toThrow();

    expect(tokenEmitter.verificarRefreshToken).toHaveBeenCalledWith(REFRESH_VALIDO);
    expect(auditoria.registrar).toHaveBeenCalledTimes(1);
  });
});

describe('LogoutUseCase — multi-tenancy: audita bajo el tenant del refresh (US-002 §3 / RLS)', () => {
  it('debe_registrar_el_logout_con_el_tenant_id_que_viaja_en_el_refresh_token', async () => {
    const emitter = crearEmitterFake(payloadDe({ tenantId: OTRO_TENANT_ID }));
    const { useCase, auditoria } = montar({ emitter });

    await useCase.ejecutar({ refreshToken: REFRESH_VALIDO } as unknown as LogoutComando);

    expect(auditoria.registrar).toHaveBeenCalledWith(
      expect.objectContaining({ accion: 'logout', tenantId: OTRO_TENANT_ID }),
    );
  });
});
