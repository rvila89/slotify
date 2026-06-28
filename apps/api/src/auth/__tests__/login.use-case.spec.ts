/**
 * TESTS DE DOMINIO del caso de uso `login` (US-001 / UC-01) — fase TDD RED.
 *
 * Trazabilidad: US-001, spec-delta `auth` (Requirement "Login con credenciales
 * válidas emite tokens y audita", "Aislamiento multi-tenant desde el token
 * firmado", "Credenciales inválidas devuelven error genérico (anti-enumeration)",
 * "Cuenta deshabilitada no autentica"). tasks.md Fase 3: 3.1, 3.2, 3.3.
 *
 * Ejercita el DOMINIO PURO contra DOBLES DE LOS PUERTOS (in-memory), sin tocar
 * Prisma, JWT real ni la BD (hexagonal, hook `no-infra-in-domain`). Cubre:
 *   - REQ 1 / 3.1: credenciales válidas + cuenta activa → emite access token,
 *     marca refresh y registra `login` en AUDIT_LOG (vía AuditLogPort).
 *   - REQ 2: el payload del access token transporta `{sub, tenantId, rol, email}`
 *     (aislamiento multi-tenant desde el token firmado).
 *   - REQ 3 / 3.2 (FA-01): email inexistente y contraseña incorrecta producen LA
 *     MISMA respuesta genérica (mismo tipo de error y mismo mensaje), sin token ni
 *     auditoría (anti-enumeration, OWASP A01).
 *   - REQ 4 / 3.3 (FA-02): `activo = false` → rechazo INDISTINGUIBLE de FA-01,
 *     sin token ni `login` en AUDIT_LOG.
 *
 * RED: aún no existe `auth/application/login.use-case.ts`; el import falla y toda
 * la batería está en ROJO por símbolos de producción ausentes. La fase GREEN
 * (dominio + adaptadores) es de `backend-developer`.
 */
import {
  LoginUseCase,
  CredencialesInvalidasError,
  type LoginComando,
  type LoginResultado,
  type LoginDeps,
  type UsuarioAutenticable,
  type UsuarioRepositoryPort,
  type PasswordHasherPort,
  type TokenEmitterPort,
  type AuditLogPort,
} from '../application/login.use-case';

// ---------------------------------------------------------------------------
// Datos canónicos (alineados con apps/api/prisma/seed.ts — Masia l'Encís)
// ---------------------------------------------------------------------------

const TENANT_ID = '00000000-0000-0000-0000-000000000001';
const USUARIO_ID = '00000000-0000-0000-0000-0000000000a1';
const EMAIL = 'info@masialencis.com';
const PASSWORD = 'Slotify2026!';
const HASH = '$argon2id$fake-hash-del-seed';
const ACCESS_TOKEN = 'access.jwt.firmado';
const REFRESH_TOKEN = 'refresh.jwt.firmado';

const usuarioActivo = (over: Partial<UsuarioAutenticable> = {}): UsuarioAutenticable => ({
  idUsuario: USUARIO_ID,
  tenantId: TENANT_ID,
  email: EMAIL,
  passwordHash: HASH,
  nombre: 'Roger',
  apellidos: 'Vilà',
  rol: 'gestor',
  activo: true,
  ...over,
});

// ---------------------------------------------------------------------------
// Dobles de puertos (in-memory). El dominio depende de estas INTERFACES.
// ---------------------------------------------------------------------------

type UsuariosFake = UsuarioRepositoryPort & { buscarPorEmail: jest.Mock };
type HasherFake = PasswordHasherPort & { verificar: jest.Mock };
type TokenFake = TokenEmitterPort & {
  emitirAccessToken: jest.Mock;
  emitirRefreshToken: jest.Mock;
  verificarRefreshToken: jest.Mock;
};
type AuditFake = AuditLogPort & { registrar: jest.Mock };

const crearUsuariosFake = (usuario: UsuarioAutenticable | null = usuarioActivo()): UsuariosFake => ({
  buscarPorEmail: jest.fn(async () => usuario),
});

const crearHasherFake = (coincide = true): HasherFake => ({
  verificar: jest.fn(async () => coincide),
});

const crearTokenFake = (): TokenFake => ({
  emitirAccessToken: jest.fn(async () => ACCESS_TOKEN),
  emitirRefreshToken: jest.fn(async () => REFRESH_TOKEN),
  verificarRefreshToken: jest.fn(async () => ({
    sub: USUARIO_ID,
    tenantId: TENANT_ID,
    rol: 'gestor',
    email: EMAIL,
  })),
});

const crearAuditFake = (): AuditFake => ({
  registrar: jest.fn(async () => undefined),
});

const montar = (opts?: {
  usuarios?: UsuariosFake;
  passwordHasher?: HasherFake;
  tokenEmitter?: TokenFake;
  auditoria?: AuditFake;
}) => {
  const usuarios = opts?.usuarios ?? crearUsuariosFake();
  const passwordHasher = opts?.passwordHasher ?? crearHasherFake();
  const tokenEmitter = opts?.tokenEmitter ?? crearTokenFake();
  const auditoria = opts?.auditoria ?? crearAuditFake();
  const deps: LoginDeps = { usuarios, passwordHasher, tokenEmitter, auditoria };
  return { useCase: new LoginUseCase(deps), usuarios, passwordHasher, tokenEmitter, auditoria };
};

const comando = (over: Partial<LoginComando> = {}): LoginComando => ({
  email: EMAIL,
  password: PASSWORD,
  ...over,
});

// ===========================================================================
// 3.1 — Happy path: credenciales válidas + cuenta activa
// ===========================================================================

describe('LoginUseCase — credenciales válidas y cuenta activa (REQ 1)', () => {
  it('debe_emitir_access_token_cuando_las_credenciales_son_validas', async () => {
    const { useCase } = montar();

    const out: LoginResultado = await useCase.ejecutar(comando());

    expect(out.accessToken).toBe(ACCESS_TOKEN);
  });

  it('debe_verificar_la_password_contra_el_hash_argon2_del_usuario', async () => {
    const { useCase, passwordHasher } = montar();

    await useCase.ejecutar(comando());

    // La contraseña en claro NUNCA se persiste ni se compara sin hashear: el
    // dominio delega la verificación al PasswordHasherPort (argon2).
    expect(passwordHasher.verificar).toHaveBeenCalledWith(PASSWORD, HASH);
  });

  it('debe_marcar_emitir_el_refresh_token_para_la_cookie_httpOnly', async () => {
    const { useCase, tokenEmitter } = montar();

    const out = await useCase.ejecutar(comando());

    expect(out.refreshToken).toBe(REFRESH_TOKEN);
    expect(tokenEmitter.emitirRefreshToken).toHaveBeenCalledTimes(1);
  });

  it('debe_devolver_los_datos_publicos_del_usuario_sin_passwordHash', async () => {
    const { useCase } = montar();

    const out = await useCase.ejecutar(comando());

    expect(out.usuario).toEqual(
      expect.objectContaining({
        idUsuario: USUARIO_ID,
        email: EMAIL,
        nombre: 'Roger',
        rol: 'gestor',
      }),
    );
    // La contraseña/hash nunca viaja en la respuesta (REQ 1, OWASP).
    expect(JSON.stringify(out.usuario)).not.toContain(HASH);
    expect(JSON.stringify(out)).not.toContain(PASSWORD);
  });

  it('debe_registrar_login_en_AUDIT_LOG_via_el_puerto_de_auditoria', async () => {
    const { useCase, auditoria } = montar();

    await useCase.ejecutar(comando());

    expect(auditoria.registrar).toHaveBeenCalledTimes(1);
    expect(auditoria.registrar).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: TENANT_ID, accion: 'login' }),
    );
  });
});

// ===========================================================================
// REQ 2 — Aislamiento multi-tenant desde el token firmado
// ===========================================================================

describe('LoginUseCase — tenantId y rol viajan en el payload firmado (REQ 2)', () => {
  it('debe_emitir_el_access_token_con_payload_sub_tenantId_rol_email', async () => {
    const { useCase, tokenEmitter } = montar();

    await useCase.ejecutar(comando());

    expect(tokenEmitter.emitirAccessToken).toHaveBeenCalledWith(
      expect.objectContaining({
        sub: USUARIO_ID,
        tenantId: TENANT_ID,
        rol: 'gestor',
        email: EMAIL,
      }),
    );
  });
});

// ===========================================================================
// 3.2 (FA-01) — Credenciales inválidas: respuesta genérica anti-enumeration
// ===========================================================================

describe('LoginUseCase — FA-01 anti-enumeration (REQ 3)', () => {
  it('debe_rechazar_con_CredencialesInvalidasError_cuando_el_email_no_existe', async () => {
    const { useCase } = montar({ usuarios: crearUsuariosFake(null) });

    await expect(useCase.ejecutar(comando())).rejects.toBeInstanceOf(CredencialesInvalidasError);
  });

  it('debe_rechazar_con_CredencialesInvalidasError_cuando_la_password_no_coincide', async () => {
    const { useCase } = montar({ passwordHasher: crearHasherFake(false) });

    await expect(useCase.ejecutar(comando())).rejects.toBeInstanceOf(CredencialesInvalidasError);
  });

  it('debe_devolver_la_MISMA_respuesta_para_email_inexistente_y_password_incorrecta', async () => {
    const porEmailInexistente = montar({ usuarios: crearUsuariosFake(null) });
    const porPasswordMala = montar({ passwordHasher: crearHasherFake(false) });

    const errA = await porEmailInexistente.useCase.ejecutar(comando()).catch((e: unknown) => e as Error);
    const errB = await porPasswordMala.useCase.ejecutar(comando()).catch((e: unknown) => e as Error);

    // Indistinguibles: mismo tipo y mismo mensaje → no se revela qué email existe.
    expect(errA.constructor).toBe(errB.constructor);
    expect((errA as Error).message).toBe((errB as Error).message);
  });

  it('no_debe_emitir_token_ni_auditar_cuando_las_credenciales_son_invalidas', async () => {
    const { useCase, tokenEmitter, auditoria } = montar({ usuarios: crearUsuariosFake(null) });

    await useCase.ejecutar(comando()).catch(() => undefined);

    expect(tokenEmitter.emitirAccessToken).not.toHaveBeenCalled();
    expect(tokenEmitter.emitirRefreshToken).not.toHaveBeenCalled();
    expect(auditoria.registrar).not.toHaveBeenCalled();
  });
});

// ===========================================================================
// 3.3 (FA-02) — Cuenta deshabilitada: 401 genérico indistinguible de FA-01
// ===========================================================================

describe('LoginUseCase — FA-02 cuenta deshabilitada (REQ 4)', () => {
  it('debe_rechazar_con_el_MISMO_error_generico_que_FA-01_cuando_activo_es_false', async () => {
    const inactivo = montar({ usuarios: crearUsuariosFake(usuarioActivo({ activo: false })) });
    const fa01 = montar({ usuarios: crearUsuariosFake(null) });

    const errInactivo = await inactivo.useCase.ejecutar(comando()).catch((e: unknown) => e as Error);
    const errFa01 = await fa01.useCase.ejecutar(comando()).catch((e: unknown) => e as Error);

    // Anti-enumeration: la cuenta deshabilitada es INDISTINGUIBLE de credenciales
    // inválidas (mismo tipo de error y mismo mensaje genérico).
    expect(errInactivo).toBeInstanceOf(CredencialesInvalidasError);
    expect(errInactivo.constructor).toBe(errFa01.constructor);
    expect((errInactivo as Error).message).toBe((errFa01 as Error).message);
  });

  it('no_debe_emitir_token_ni_registrar_login_cuando_la_cuenta_esta_deshabilitada', async () => {
    const { useCase, tokenEmitter, auditoria } = montar({
      usuarios: crearUsuariosFake(usuarioActivo({ activo: false })),
    });

    await useCase.ejecutar(comando()).catch(() => undefined);

    expect(tokenEmitter.emitirAccessToken).not.toHaveBeenCalled();
    expect(auditoria.registrar).not.toHaveBeenCalled();
  });
});
