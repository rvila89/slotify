/** Smoke test del módulo facturacion: la clase del módulo se define correctamente. */
import { FacturacionModule } from "./facturacion.module";

describe("FacturacionModule", () => {
  it("debe_definir_el_modulo", () => {
    expect(FacturacionModule).toBeDefined();
    expect(new FacturacionModule()).toBeInstanceOf(FacturacionModule);
  });
});
