/** Smoke test del módulo dashboards: la clase del módulo se define correctamente. */
import { DashboardsModule } from "./dashboards.module";

describe("DashboardsModule", () => {
  it("debe_definir_el_modulo", () => {
    expect(DashboardsModule).toBeDefined();
    expect(new DashboardsModule()).toBeInstanceOf(DashboardsModule);
  });
});
