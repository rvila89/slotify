/** Smoke test del módulo clientes: la clase del módulo se define correctamente. */
import { ClientesModule } from "./clientes.module";

describe("ClientesModule", () => {
  it("debe_definir_el_modulo", () => {
    expect(ClientesModule).toBeDefined();
    expect(new ClientesModule()).toBeInstanceOf(ClientesModule);
  });
});
