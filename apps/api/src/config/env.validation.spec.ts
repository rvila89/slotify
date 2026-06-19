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
});
