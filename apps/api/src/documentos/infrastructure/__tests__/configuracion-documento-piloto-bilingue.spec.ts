/**
 * TESTS del seed piloto BILINGÜE `construirConfiguracionDocumentoPiloto` — change
 * `pdf-presupuesto-horario-idioma`, fase TDD RED (tasks.md 3.7).
 *
 * Trazabilidad: spec-delta `documentos` — Requirement "Textos libres del tenant
 * bilingües (es/ca)…" y "Seed piloto del documento de 'Condicions particulars'"
 * (14 secciones bilingües ca+es en orden); design.md D3 (VO bilingüe `{ca,es}`).
 *
 * CONTRATO NUEVO QUE ESTE TEST ESPERA (a implementar por backend-developer en GREEN):
 *  - `textos.plantillaConceptoFiscal`, `textos.validesaTexto`, `textos.pieLegal` pasan a
 *    `{ ca: string; es: string }`.
 *  - `condiciones.titulo` pasa a `{ ca, es }` y cada sección tiene `titulo`/`cuerpo`
 *    bilingües `{ ca, es }`, 14 secciones en el orden especificado.
 *  - El `ca` conserva el contenido catalán actual (equivale al backfill del `_ca`); el
 *    `es` es la traducción del seed (no vacío).
 *
 * RED: hoy el factory devuelve `textos` monolingües (strings) y `condiciones` con
 * `titulo`/`secciones` de strings → los accesos `.ca`/`.es` son `undefined` y las
 * aserciones FALLAN por AUSENCIA DE IMPLEMENTACIÓN (además de TS por el cambio de VO).
 * GREEN es de backend-developer.
 */
import { construirConfiguracionDocumentoPiloto } from '../seed/configuracion-documento-piloto';

const TENANT_PILOTO = '00000000-0000-0000-0000-000000000001';

/** Orden EXACTO de los 14 títulos catalanes de las condicions de Masia. */
const TITULOS_CA_ESPERADOS: ReadonlyArray<string> = [
  'Reserva i pagament',
  'Fiança',
  'Política de cancel·lació',
  'Responsabilitat i dades personals',
  'Visites',
  'Neteja',
  'Gestió de residus',
  'Horaris',
  "Excés d'horari",
  'Normes de convivència i ús responsable',
  'Capacitat',
  'Piscina',
  'Música i respecte veïnal',
  'Parking',
];

describe('construirConfiguracionDocumentoPiloto — textos libres bilingües {ca,es}', () => {
  it('debe_exponer_plantillaConceptoFiscal_como_objeto_ca_es', () => {
    const config = construirConfiguracionDocumentoPiloto(TENANT_PILOTO);

    // El `ca` conserva el texto catalán actual (backfill) con el placeholder.
    expect(config.textos.plantillaConceptoFiscal.ca).toBe(
      'Gestió ús espai de {nombreComercial} per esdeveniment',
    );
    // El `es` es la traducción del seed: no vacía y con el placeholder conservado.
    expect(config.textos.plantillaConceptoFiscal.es.trim().length).toBeGreaterThan(0);
    expect(config.textos.plantillaConceptoFiscal.es).toContain('{nombreComercial}');
    // Regla dura del épico: ningún idioma contiene "lloguer".
    expect(config.textos.plantillaConceptoFiscal.ca.toLowerCase()).not.toContain('lloguer');
    expect(config.textos.plantillaConceptoFiscal.es.toLowerCase()).not.toContain('lloguer');
  });

  it('debe_exponer_validesaTexto_y_pieLegal_como_objetos_ca_es_no_vacios', () => {
    const config = construirConfiguracionDocumentoPiloto(TENANT_PILOTO);

    expect(config.textos.validesaTexto.ca).toBe('10 DIES');
    expect(config.textos.validesaTexto.es.trim().length).toBeGreaterThan(0);
    expect(config.textos.pieLegal.ca.trim().length).toBeGreaterThan(0);
    expect(config.textos.pieLegal.es.trim().length).toBeGreaterThan(0);
  });
});

describe('construirConfiguracionDocumentoPiloto — condiciones bilingües {ca,es}', () => {
  it('debe_titular_el_bloque_de_condiciones_de_forma_bilingue', () => {
    const config = construirConfiguracionDocumentoPiloto(TENANT_PILOTO);

    expect(config.condiciones.titulo.ca).toBe('Condicions Particulars');
    expect(config.condiciones.titulo.es).toBe('Condiciones Particulares');
  });

  it('debe_tener_exactamente_14_secciones', () => {
    const config = construirConfiguracionDocumentoPiloto(TENANT_PILOTO);

    expect(config.condiciones.secciones).toHaveLength(14);
  });

  it('debe_conservar_los_14_titulos_catalanes_en_el_orden_exacto', () => {
    const config = construirConfiguracionDocumentoPiloto(TENANT_PILOTO);

    const titulosCa = config.condiciones.secciones.map((s) => s.titulo.ca);
    expect(titulosCa).toEqual(TITULOS_CA_ESPERADOS);
  });

  it('debe_tener_titulo_y_cuerpo_bilingues_no_vacios_en_cada_seccion', () => {
    const config = construirConfiguracionDocumentoPiloto(TENANT_PILOTO);

    for (const seccion of config.condiciones.secciones) {
      expect(seccion.titulo.ca.trim().length).toBeGreaterThan(0);
      expect(seccion.titulo.es.trim().length).toBeGreaterThan(0);
      expect(seccion.cuerpo.ca.trim().length).toBeGreaterThan(0);
      expect(seccion.cuerpo.es.trim().length).toBeGreaterThan(0);
    }
  });

  it('debe_ser_determinista_para_el_mismo_tenant', () => {
    const a = construirConfiguracionDocumentoPiloto(TENANT_PILOTO);
    const b = construirConfiguracionDocumentoPiloto(TENANT_PILOTO);

    expect(a).toEqual(b);
  });
});
