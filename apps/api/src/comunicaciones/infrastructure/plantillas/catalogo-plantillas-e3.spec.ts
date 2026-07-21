/**
 * TESTS de la plantilla E3 bilíngüe (ES + CA) en `CatalogoPlantillasEnCodigo`
 * — change `factura-senal-pdf-idioma-email-ux`, fase TDD RED.
 *
 * Trazabilidad: spec-delta `comunicaciones` (MODIFIED "Plantilla E3 bilíngüe":
 * "renderE3 ES nuevo texto aprobado; renderE3Ca CA nuevo texto aprobado;
 * PLANTILLA_E3_CA registrada en registroCa; variablesRequeridas: ['nombre',
 * 'codigoReserva']; sin mención a condiciones particulars").
 *
 * RED:
 * - `catalogo.seleccionar('E3','ca')` devuelve `null` hoy (registroCa no incluye E3).
 * - `renderE3` ES tiene asunto «Confirmación de tu reserva y factura de señal»
 *   y cuerpo que menciona «condicions particulars» — ambos ya no válidos.
 * GREEN es de `backend-developer`.
 */
import { CatalogoPlantillasEnCodigo } from './catalogo-plantillas';

const NOMBRE = 'Sergio';
const CODIGO_RESERVA = 'SLO-2026-0029';

// ===========================================================================
// E3 en ESPAÑOL — texto aprobado (factura-senal-pdf-idioma-email-ux)
// ===========================================================================

describe('CatalogoPlantillasEnCodigo — E3 en español con texto aprobado', () => {
  it('debe_renderizar_el_asunto_ES_con_el_codigoReserva', () => {
    const catalogo = new CatalogoPlantillasEnCodigo();

    const render = catalogo
      .seleccionar('E3', 'es')
      ?.render({ nombre: NOMBRE, codigoReserva: CODIGO_RESERVA });

    expect(render?.asunto).toBe(`Factura de señal — reserva ${CODIGO_RESERVA}`);
  });

  it('debe_incluir_el_texto_aprobado_muchas_gracias_por_confiar_en_el_cuerpo_ES', () => {
    const catalogo = new CatalogoPlantillasEnCodigo();

    const render = catalogo
      .seleccionar('E3', 'es')
      ?.render({ nombre: NOMBRE, codigoReserva: CODIGO_RESERVA });
    const cuerpo = `${render?.cuerpoTexto} ${render?.cuerpoHtml}`;

    expect(cuerpo).toContain("Muchas gracias por confiar en la Masia l'Encís");
  });

  it('debe_incluir_el_40_porciento_y_el_60_porciento_en_el_cuerpo_ES', () => {
    const catalogo = new CatalogoPlantillasEnCodigo();

    const render = catalogo
      .seleccionar('E3', 'es')
      ?.render({ nombre: NOMBRE, codigoReserva: CODIGO_RESERVA });
    const cuerpo = `${render?.cuerpoTexto} ${render?.cuerpoHtml}`;

    expect(cuerpo).toContain('40%');
    expect(cuerpo).toContain('60%');
  });

  it('debe_incluir_la_firma_Ari_en_el_cuerpo_ES', () => {
    const catalogo = new CatalogoPlantillasEnCodigo();

    const render = catalogo
      .seleccionar('E3', 'es')
      ?.render({ nombre: NOMBRE, codigoReserva: CODIGO_RESERVA });
    const cuerpo = `${render?.cuerpoTexto} ${render?.cuerpoHtml}`;

    expect(cuerpo).toContain('Ari');
    expect(cuerpo).toContain("Masia l'Encís");
  });

  it('NO_debe_mencionar_condiciones_particulares_en_el_cuerpo_ES', () => {
    const catalogo = new CatalogoPlantillasEnCodigo();

    const render = catalogo
      .seleccionar('E3', 'es')
      ?.render({ nombre: NOMBRE, codigoReserva: CODIGO_RESERVA });
    const cuerpo = `${render?.cuerpoTexto} ${render?.cuerpoHtml}`;

    // Las condiciones particulars ya se enviaron en E2; no se repiten en E3.
    expect(cuerpo).not.toMatch(/condici[oó]ns? particulars?/i);
    expect(cuerpo).not.toMatch(/condiciones particulares/i);
  });

  it('debe_interpolar_el_nombre_del_cliente_en_el_cuerpo_ES', () => {
    const catalogo = new CatalogoPlantillasEnCodigo();

    const render = catalogo
      .seleccionar('E3', 'es')
      ?.render({ nombre: NOMBRE, codigoReserva: CODIGO_RESERVA });

    expect(render?.cuerpoTexto).toContain(`Hola ${NOMBRE}`);
  });

  it('debe_declarar_variablesRequeridas_nombre_y_codigoReserva_en_ES', () => {
    const catalogo = new CatalogoPlantillasEnCodigo();

    const plantilla = catalogo.seleccionar('E3', 'es');

    expect(plantilla?.variablesRequeridas).toEqual(
      expect.arrayContaining(['nombre', 'codigoReserva']),
    );
    // `email` ya no es requerido (solo nombre + codigoReserva).
    expect(plantilla?.variablesRequeridas).not.toContain('email');
  });

  it('debe_escapar_html_en_el_nombre_para_prevenir_injection', () => {
    const catalogo = new CatalogoPlantillasEnCodigo();

    const render = catalogo
      .seleccionar('E3', 'es')
      ?.render({ nombre: '<script>alert(1)</script>', codigoReserva: CODIGO_RESERVA });

    expect(render?.cuerpoHtml).not.toContain('<script>');
    expect(render?.cuerpoHtml).toContain('&lt;script&gt;');
  });
});

// ===========================================================================
// E3 en CATALÁN — nuevo PLANTILLA_E3_CA (factura-senal-pdf-idioma-email-ux)
// ===========================================================================

describe('CatalogoPlantillasEnCodigo — E3 en catalán nuevo (factura-senal-pdf-idioma-email-ux)', () => {
  it('debe_registrar_la_plantilla_E3_en_ca_como_activa', () => {
    const catalogo = new CatalogoPlantillasEnCodigo();

    const plantilla = catalogo.seleccionar('E3', 'ca');

    expect(plantilla).not.toBeNull();
    expect(plantilla?.codigoEmail).toBe('E3');
    expect(plantilla?.idioma).toBe('ca');
    expect(plantilla?.activa).toBe(true);
  });

  it('debe_renderizar_el_asunto_CA_con_el_codigoReserva', () => {
    const catalogo = new CatalogoPlantillasEnCodigo();

    const render = catalogo
      .seleccionar('E3', 'ca')
      ?.render({ nombre: NOMBRE, codigoReserva: CODIGO_RESERVA });

    expect(render?.asunto).toBe(`Factura de senyal — reserva ${CODIGO_RESERVA}`);
  });

  it('debe_incluir_el_texto_aprobado_moltes_gracies_per_confiar_en_el_cuerpo_CA', () => {
    const catalogo = new CatalogoPlantillasEnCodigo();

    const render = catalogo
      .seleccionar('E3', 'ca')
      ?.render({ nombre: NOMBRE, codigoReserva: CODIGO_RESERVA });
    const cuerpo = `${render?.cuerpoTexto} ${render?.cuerpoHtml}`;

    expect(cuerpo).toContain("Moltes gràcies per confiar en la Masia l'Encís");
  });

  it('debe_incluir_el_40_porcent_i_el_60_porcent_en_el_cuerpo_CA', () => {
    const catalogo = new CatalogoPlantillasEnCodigo();

    const render = catalogo
      .seleccionar('E3', 'ca')
      ?.render({ nombre: NOMBRE, codigoReserva: CODIGO_RESERVA });
    const cuerpo = `${render?.cuerpoTexto} ${render?.cuerpoHtml}`;

    expect(cuerpo).toContain('40%');
    expect(cuerpo).toContain('60%');
  });

  it('debe_incluir_la_firma_Ari_en_el_cuerpo_CA', () => {
    const catalogo = new CatalogoPlantillasEnCodigo();

    const render = catalogo
      .seleccionar('E3', 'ca')
      ?.render({ nombre: NOMBRE, codigoReserva: CODIGO_RESERVA });
    const cuerpo = `${render?.cuerpoTexto} ${render?.cuerpoHtml}`;

    expect(cuerpo).toContain('Ari');
    expect(cuerpo).toContain("Masia l'Encís");
  });

  it('NO_debe_mencionar_condicions_particulars_en_el_cuerpo_CA', () => {
    const catalogo = new CatalogoPlantillasEnCodigo();

    const render = catalogo
      .seleccionar('E3', 'ca')
      ?.render({ nombre: NOMBRE, codigoReserva: CODIGO_RESERVA });
    const cuerpo = `${render?.cuerpoTexto} ${render?.cuerpoHtml}`;

    expect(cuerpo).not.toMatch(/condici[oó]ns? particulars?/i);
  });

  it('debe_interpolar_el_nombre_del_cliente_en_el_cuerpo_CA', () => {
    const catalogo = new CatalogoPlantillasEnCodigo();

    const render = catalogo
      .seleccionar('E3', 'ca')
      ?.render({ nombre: NOMBRE, codigoReserva: CODIGO_RESERVA });

    expect(render?.cuerpoTexto).toContain(`Hola ${NOMBRE}`);
  });

  it('debe_requerir_la_factura_de_senal_como_adjunto_en_CA', () => {
    const catalogo = new CatalogoPlantillasEnCodigo();

    const plantilla = catalogo.seleccionar('E3', 'ca');

    expect(plantilla?.adjuntosRequeridos).toEqual(expect.arrayContaining(['senal']));
  });

  it('debe_declarar_variablesRequeridas_nombre_y_codigoReserva_en_CA', () => {
    const catalogo = new CatalogoPlantillasEnCodigo();

    const plantilla = catalogo.seleccionar('E3', 'ca');

    expect(plantilla?.variablesRequeridas).toEqual(
      expect.arrayContaining(['nombre', 'codigoReserva']),
    );
  });

  it('debe_escapar_html_en_el_nombre_para_prevenir_injection_en_CA', () => {
    const catalogo = new CatalogoPlantillasEnCodigo();

    const render = catalogo
      .seleccionar('E3', 'ca')
      ?.render({ nombre: '<b>Hola</b>', codigoReserva: CODIGO_RESERVA });

    expect(render?.cuerpoHtml).not.toContain('<b>Hola</b>');
    expect(render?.cuerpoHtml).toContain('&lt;b&gt;Hola&lt;/b&gt;');
  });
});
