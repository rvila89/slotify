/** Smoke test del módulo comunicaciones: la clase del módulo se define correctamente. */
import { ComunicacionesModule } from "./comunicaciones.module";

describe("ComunicacionesModule", () => {
  it("debe_definir_el_modulo", () => {
    expect(ComunicacionesModule).toBeDefined();
    expect(new ComunicacionesModule()).toBeInstanceOf(ComunicacionesModule);
  });
});
