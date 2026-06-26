/** Smoke test del módulo ficha-evento: la clase del módulo se define correctamente. */
import { FichaEventoModule } from "./ficha-evento.module";

describe("FichaEventoModule", () => {
  it("debe_definir_el_modulo", () => {
    expect(FichaEventoModule).toBeDefined();
    expect(new FichaEventoModule()).toBeInstanceOf(FichaEventoModule);
  });
});
