/** Smoke test del módulo auth: la clase del módulo se define correctamente. */
import { AuthModule } from './auth.module';

describe('AuthModule', () => {
  it('debe_definir_el_modulo', () => {
    expect(AuthModule).toBeDefined();
  });
});
