/** Smoke test del módulo tareas: la clase del módulo se define correctamente. */
import { TareasModule } from "./tareas.module";

describe("TareasModule", () => {
  it("debe_definir_el_modulo", () => {
    expect(TareasModule).toBeDefined();
    expect(new TareasModule()).toBeInstanceOf(TareasModule);
  });
});
