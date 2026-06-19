/** Smoke test del módulo reservas: la clase del módulo se define correctamente. */
import { ReservasModule } from "./reservas.module";

describe("ReservasModule", () => {
  it("debe_definir_el_modulo", () => {
    expect(ReservasModule).toBeDefined();
    expect(new ReservasModule()).toBeInstanceOf(ReservasModule);
  });
});
