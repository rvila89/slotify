/**
 * TESTS del factory de datos del seed del piloto Masia l'Encís
 * `construirConfiguracionDocumentoPiloto` (épico #6, rebanada 6.1a
 * `documentos-config-tenant-storage`) — fase TDD RED. tasks.md Fase 2: 2.3.
 *
 * Trazabilidad: spec-delta `documentos` (Requirement "Seed idempotente de la
 * configuración de documento del tenant piloto"; Scenarios "El seed crea la
 * configuración del piloto con los datos reales" y "El concepto fiscal usa 'espai'
 * y nunca 'lloguer'"), design.md §Matiz razón social fiscal ≠ nombre comercial.
 *
 * REGLA DURA del épico: el `plantillaConceptoFiscal` debe expresar
 * "Gestió de l'ús espai de {nombreComercial} per esdeveniment" y **nunca** contener
 * la palabra "lloguer". Para probar esto sin Postgres, el seed delega la
 * construcción de la fila en un factory PURO reusable
 * (`construirConfiguracionDocumentoPiloto(tenantId)`); el test lo ejerce
 * directamente. La verificación de que ESA fila queda en BD (idempotencia, UNIQUE,
 * RLS) es de la fase 4 de QA contra Postgres (test de integración esbozado, NO
 * ejecutado aquí).
 *
 * RED: aún no existe
 *   - `documentos/infrastructure/seed/configuracion-documento-piloto.ts`
 * El import falla (TS2307) y la batería está en ROJO. GREEN = `backend-developer`.
 */
import { construirConfiguracionDocumentoPiloto } from '../seed/configuracion-documento-piloto';

const TENANT_PILOTO = '00000000-0000-0000-0000-000000000001';

describe('construirConfiguracionDocumentoPiloto — datos reales del piloto (2.3)', () => {
  it('debe_usar_espai_en_el_concepto_fiscal_y_NUNCA_la_palabra_lloguer', () => {
    // Arrange / Act
    const config = construirConfiguracionDocumentoPiloto(TENANT_PILOTO);

    // Assert — regla dura del épico "concepto nunca lloguer".
    expect(config.textos.plantillaConceptoFiscal).toContain('espai');
    expect(config.textos.plantillaConceptoFiscal.toLowerCase()).not.toContain('lloguer');
  });

  it('debe_expresar_el_concepto_fiscal_completo_con_el_placeholder_nombreComercial', () => {
    // Arrange / Act
    const config = construirConfiguracionDocumentoPiloto(TENANT_PILOTO);

    // Assert — usa el placeholder, nunca la razón social ni "lloguer".
    expect(config.textos.plantillaConceptoFiscal).toBe(
      "Gestió de l'ús espai de {nombreComercial} per esdeveniment",
    );
    expect(config.textos.plantillaConceptoFiscal).toContain('{nombreComercial}');
  });

  it('debe_sembrar_la_identidad_fiscal_real_con_razon_social_distinta_del_nombre_comercial', () => {
    // Arrange / Act
    const config = construirConfiguracionDocumentoPiloto(TENANT_PILOTO);

    // Assert — datos reales del dossier; razón social ≠ nombre comercial.
    expect(config.tenantId).toBe(TENANT_PILOTO);
    expect(config.identidadFiscal.razonSocialFiscal).toBe('Canoliart, SL');
    expect(config.identidadFiscal.nombreComercial).toBe("Masia l'Encís");
    expect(config.identidadFiscal.razonSocialFiscal).not.toBe(
      config.identidadFiscal.nombreComercial,
    );
    expect(config.identidadFiscal.nif).toBe('B10874287');
  });

  it('debe_sembrar_la_banca_real_del_piloto', () => {
    // Arrange / Act
    const config = construirConfiguracionDocumentoPiloto(TENANT_PILOTO);

    // Assert
    expect(config.banca.iban).toBe('ES30 0182 1683 4002 0172 9599');
    expect(config.banca.beneficiarioTransferencia).toBe('Canoliart, SL');
    expect(config.banca.conceptoTransferencia).toBe("Masia l'Encís");
  });

  it('debe_ser_determinista_para_el_mismo_tenant_apoyo_a_la_idempotencia_del_seed', () => {
    // Arrange / Act — mismo tenant ⇒ misma fila (el seed hace deleteMany + create).
    const a = construirConfiguracionDocumentoPiloto(TENANT_PILOTO);
    const b = construirConfiguracionDocumentoPiloto(TENANT_PILOTO);

    // Assert
    expect(a).toEqual(b);
  });
});
