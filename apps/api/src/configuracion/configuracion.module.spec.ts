/** Smoke test del módulo configuracion: la clase del módulo se define correctamente. */
import { ConfiguracionModule } from "./configuracion.module";

describe("ConfiguracionModule", () => {
  it("debe_definir_el_modulo", () => {
    expect(ConfiguracionModule).toBeDefined();
    expect(new ConfiguracionModule()).toBeInstanceOf(ConfiguracionModule);
  });
});
