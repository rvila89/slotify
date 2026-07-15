/**
 * TESTS del factory de datos del seed del piloto Masia l'Encís
 * `construirConfiguracionDocumentoPiloto` (épico #6, rebanada 6.1a
 * `documentos-config-tenant-storage`; actualizado en 6.5
 * `documentos-rediseno-pdf-logo-storage`) — fase TDD RED. tasks.md Fase 2: 2.4.
 *
 * Trazabilidad: proposal.md 6.5 "Valores concretos cerrados" y design.md §C:
 *  - `branding.colorPrimario` pasa de `#1A1A1A` → **turquesa `#5edada`**.
 *  - `textos.plantillaConceptoFiscal` pasa de
 *    "Gestió de l'ús espai de {nombreComercial} per esdeveniment" →
 *    **"Gestió ús espai de {nombreComercial} per esdeveniment"** (alinear a la
 *    referencia real). Se MANTIENE el placeholder `{nombreComercial}`.
 *
 * REGLA DURA del épico (se mantiene VERDE): el `plantillaConceptoFiscal` expresa
 * "espai" y **nunca** contiene la palabra "lloguer". Para probar esto sin
 * Postgres, el seed delega la construcción de la fila en un factory PURO reusable
 * (`construirConfiguracionDocumentoPiloto(tenantId)`); el test lo ejerce
 * directamente. La verificación de que ESA fila queda en BD (idempotencia, UNIQUE,
 * RLS) y la subida real del logo (side-effect del seed) son de la fase 4 de QA
 * contra Postgres (NO aquí).
 *
 * RED 6.5: el factory todavía devuelve `colorPrimario = '#1A1A1A'` y el concepto
 * con "de l'ús"; estos asertos fallan hasta que `backend-developer` fije los
 * nuevos valores. GREEN = actualizar `configuracion-documento-piloto.ts`.
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

    // Assert — texto 6.5 alineado a la referencia real, con placeholder.
    expect(config.textos.plantillaConceptoFiscal).toBe(
      'Gestió ús espai de {nombreComercial} per esdeveniment',
    );
    expect(config.textos.plantillaConceptoFiscal).toContain('{nombreComercial}');
  });

  it('debe_fijar_el_color_primario_turquesa_del_rediseno_6_5', () => {
    // Arrange / Act
    const config = construirConfiguracionDocumentoPiloto(TENANT_PILOTO);

    // Assert — turquesa de la marca (antes '#1A1A1A' neutro).
    expect(config.branding.colorPrimario).toBe('#5edada');
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
