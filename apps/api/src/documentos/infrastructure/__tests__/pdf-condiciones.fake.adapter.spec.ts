/**
 * TESTS del ADAPTADOR FAKE de PDF de "Condicions particulars"
 * `PdfCondicionesFakeAdapter` (épico #6, rebanada 6.4a
 * `documentos-condiciones-particulares-pdf`) — fase TDD RED. tasks.md Fase 2: 2.6.
 *
 * Trazabilidad: design.md §"Puerto + adapters de generación" ("Adapter fake
 * (`pdf-condiciones.fake.adapter.ts`) para tests: URL sintética"). Es el espejo del
 * `PdfPresupuestoFakeAdapter` de 6.1b: devuelve una URL sintética DETERMINISTA por
 * tenant, sin tocar red ni disco.
 *
 * RED: aún NO existe `documentos/infrastructure/pdf-condiciones.fake.adapter.ts`. El
 * import falla (TS2307) → batería en ROJO por AUSENCIA DE IMPLEMENTACIÓN. GREEN es
 * de `backend-developer`.
 */
import { PdfCondicionesFakeAdapter } from '../pdf-condiciones.fake.adapter';

const TENANT = '00000000-0000-0000-0000-000000000001';
const OTRO_TENANT = '00000000-0000-0000-0000-0000000000ff';

describe('PdfCondicionesFakeAdapter — URL sintética determinista (2.6)', () => {
  it('debe_devolver_una_url_sintetica_que_aisla_por_tenant', async () => {
    // Arrange
    const adaptador = new PdfCondicionesFakeAdapter();

    // Act
    const url = await adaptador.generar({ tenantId: TENANT });

    // Assert — URL sintética con clave `condiciones/{tenantId}.pdf`.
    expect(url).toBe(`https://storage.local/condiciones/${TENANT}.pdf`);
  });

  it('debe_ser_determinista_para_el_mismo_tenant', async () => {
    const adaptador = new PdfCondicionesFakeAdapter();

    const a = await adaptador.generar({ tenantId: TENANT });
    const b = await adaptador.generar({ tenantId: TENANT });

    expect(a).toBe(b);
  });

  it('debe_generar_urls_distintas_para_tenants_distintos', async () => {
    const adaptador = new PdfCondicionesFakeAdapter();

    const a = await adaptador.generar({ tenantId: TENANT });
    const b = await adaptador.generar({ tenantId: OTRO_TENANT });

    expect(a).not.toBe(b);
  });
});
