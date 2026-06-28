/** Tests de la validación de entorno (zod): edge cases de la US-000. */
import { validarEntorno } from './env.validation';

const base = {
  DATABASE_URL: 'postgresql://u:p@localhost:5432/db',
  JWT_ACCESS_SECRET: 'x'.repeat(32),
};

describe('validarEntorno', () => {
  it('debe_aceptar_un_entorno_valido', () => {
    const env = validarEntorno(base);
    expect(env.DATABASE_URL).toBe(base.DATABASE_URL);
    expect(env.API_PORT).toBe(3000);
  });

  it('debe_fallar_si_falta_DATABASE_URL', () => {
    const { DATABASE_URL: _omit, ...sinDb } = base;
    expect(() => validarEntorno(sinDb)).toThrow(/DATABASE_URL/);
  });

  it('debe_fallar_si_JWT_ACCESS_SECRET_esta_vacio', () => {
    expect(() => validarEntorno({ ...base, JWT_ACCESS_SECRET: '' })).toThrow(
      /JWT_ACCESS_SECRET/,
    );
  });

  it('debe_fallar_si_JWT_ACCESS_SECRET_tiene_menos_de_32_chars', () => {
    expect(() =>
      validarEntorno({ ...base, JWT_ACCESS_SECRET: 'corto' }),
    ).toThrow(/al menos 32 caracteres/);
  });

  // M2 (US-045): el transporte de email debe ser `resend` en producción y nunca
  // arrancar con `fake` silenciosamente; `fake` queda permitido fuera de producción.
  it('debe_fallar_si_en_produccion_el_transporte_de_email_es_fake', () => {
    expect(() =>
      validarEntorno({ ...base, NODE_ENV: 'production', EMAIL_TRANSPORT: 'fake' }),
    ).toThrow(/EMAIL_TRANSPORT/);
  });

  it('debe_fallar_si_en_produccion_no_se_indica_transporte_y_cae_al_default_fake', () => {
    expect(() =>
      validarEntorno({ ...base, NODE_ENV: 'production' }),
    ).toThrow(/EMAIL_TRANSPORT/);
  });

  it('debe_aceptar_produccion_con_resend_y_sus_secretos', () => {
    const env = validarEntorno({
      ...base,
      NODE_ENV: 'production',
      EMAIL_TRANSPORT: 'resend',
      RESEND_API_KEY: 're_clave_de_prueba',
      EMAIL_FROM: 'no-reply@masia.example',
    });
    expect(env.EMAIL_TRANSPORT).toBe('resend');
  });

  it('debe_permitir_fake_fuera_de_produccion_test_y_development', () => {
    expect(validarEntorno({ ...base, NODE_ENV: 'test' }).EMAIL_TRANSPORT).toBe('fake');
    expect(validarEntorno({ ...base, NODE_ENV: 'development' }).EMAIL_TRANSPORT).toBe('fake');
  });

  // Bj3 (US-045): el DEFAULT de EMAIL_SANDBOX es SEGURO. Si no se setea, el sistema
  // NO envía correos reales (sandbox = true). El envío real es opt-in EXPLÍCITO con
  // EMAIL_SANDBOX=false.
  it('debe_activar_sandbox_por_defecto_cuando_EMAIL_SANDBOX_no_esta_seteada', () => {
    expect(validarEntorno(base).EMAIL_SANDBOX).toBe(true);
  });

  it('debe_mantener_sandbox_activo_con_EMAIL_SANDBOX_true', () => {
    expect(validarEntorno({ ...base, EMAIL_SANDBOX: 'true' }).EMAIL_SANDBOX).toBe(
      true,
    );
  });

  it('debe_desactivar_sandbox_solo_con_EMAIL_SANDBOX_false_explicito', () => {
    expect(validarEntorno({ ...base, EMAIL_SANDBOX: 'false' }).EMAIL_SANDBOX).toBe(
      false,
    );
  });
});
