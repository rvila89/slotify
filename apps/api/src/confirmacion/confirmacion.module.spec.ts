/** Smoke test del módulo confirmacion: la clase del módulo se define correctamente. */
import { ConfirmacionModule } from './confirmacion.module';

describe('ConfirmacionModule', () => {
  it('debe_definir_el_modulo', () => {
    expect(ConfirmacionModule).toBeDefined();
    expect(new ConfirmacionModule()).toBeInstanceOf(ConfirmacionModule);
  });
});
