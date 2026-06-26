/** Smoke test del módulo calendario: la clase del módulo se define correctamente. */
import { CalendarioModule } from "./calendario.module";

describe("CalendarioModule", () => {
  it("debe_definir_el_modulo", () => {
    expect(CalendarioModule).toBeDefined();
    expect(new CalendarioModule()).toBeInstanceOf(CalendarioModule);
  });
});
