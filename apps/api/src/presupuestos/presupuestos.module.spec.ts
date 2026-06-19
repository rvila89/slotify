/** Smoke test del módulo presupuestos: la clase del módulo se define correctamente. */
import { PresupuestosModule } from "./presupuestos.module";

describe("PresupuestosModule", () => {
  it("debe_definir_el_modulo", () => {
    expect(PresupuestosModule).toBeDefined();
    expect(new PresupuestosModule()).toBeInstanceOf(PresupuestosModule);
  });
});
