/**
 * TESTS de la ACTIVACIÓN de la plantilla E2 en el catálogo `CatalogoPlantillasEnCodigo`
 * (workstream C del change `presupuesto-prereserva-cta-descarte-y-e2`) — fase TDD RED.
 *
 * E2 (presupuesto enviado) estaba DISEÑADA pero INACTIVA (en `CODIGOS_DIFERIDOS`, render
 * placeholder "(pendiente de cableado)", `activa: false`) pese a que su trigger post-commit
 * (`DispararE2Adapter`) SÍ estaba cableado desde US-014. Este workstream la ACTIVA con render
 * REAL (`renderE2`, modelado sobre `renderE3`), `variablesRequeridas: ['nombre','codigoReserva']`
 * y —D-1 CERRADA = REQUERIDO— `adjuntosRequeridos: ['presupuesto']` (igual que E3 con `'senal'`).
 *
 * Trazabilidad: design.md §"Workstream C" ("Registrar `PLANTILLA_E2_ES` con `activa: true`,
 * `variablesRequeridas: ['nombre', 'codigoReserva']`, `adjuntosRequeridos: ['presupuesto']`";
 * "Quitar `'E2'` de `CODIGOS_DIFERIDOS`") y §D-1 (adjunto E2 requerido); spec-delta
 * `comunicaciones` (Requirement MODIFIED: "plantilla E2 ACTIVA (`activa: true`, render real
 * `renderE2` con `variablesRequeridas: ['nombre', 'codigoReserva']`; el código `'E2'` deja de
 * estar entre los `CODIGOS_DIFERIDOS`)"). Modelado sobre la batería 3.8 de E3 en
 * `catalogo-plantillas.spec.ts`.
 *
 * RED: hoy el catálogo declara `'E2'` como inactiva (`plantillaInactivaEs`); estas aserciones
 * (activa=true, render real con nombre + codigoReserva, adjunto `presupuesto` requerido, E2 fuera
 * de los diferidos) FALLAN por comportamiento hasta que `backend-developer` cablee E2. GREEN es
 * de `backend-developer`.
 */
import { CatalogoPlantillasEnCodigo } from './catalogo-plantillas';

const NOMBRE = 'Marta';
const CODIGO_RESERVA = 'SLO-2026-0023';

describe('CatalogoPlantillasEnCodigo — E2 activa con render real (workstream C)', () => {
  it('debe_marcar_la_plantilla_E2_en_es_como_activa', () => {
    const catalogo = new CatalogoPlantillasEnCodigo();

    const plantilla = catalogo.seleccionar('E2', 'es');

    expect(plantilla).not.toBeNull();
    expect(plantilla?.codigoEmail).toBe('E2');
    expect(plantilla?.idioma).toBe('es');
    expect(plantilla?.activa).toBe(true);
  });

  it('debe_renderizar_E2_con_asunto_y_cuerpo_reales_no_el_placeholder_de_renderInactivo', () => {
    const catalogo = new CatalogoPlantillasEnCodigo();

    const plantilla = catalogo.seleccionar('E2', 'es');
    const render = plantilla?.render({
      nombre: NOMBRE,
      codigoReserva: CODIGO_RESERVA,
    });

    expect(render?.asunto.length).toBeGreaterThan(0);
    expect(render?.cuerpoHtml.length).toBeGreaterThan(0);
    expect(render?.cuerpoTexto.length).toBeGreaterThan(0);
    // NO es el placeholder de una plantilla inactiva/diferida.
    expect(render?.asunto).not.toContain('pendiente de cableado');
    expect(render?.cuerpoTexto).not.toContain('diseñada pero inactiva');
    expect(render?.cuerpoHtml).not.toContain('inactiva');
  });

  it('debe_incluir_el_nombre_y_el_codigoReserva_en_el_cuerpo_del_render', () => {
    const catalogo = new CatalogoPlantillasEnCodigo();

    const plantilla = catalogo.seleccionar('E2', 'es');
    const render = plantilla?.render({
      nombre: NOMBRE,
      codigoReserva: CODIGO_RESERVA,
    });

    // El render real interpola el nombre del cliente y la referencia de la reserva.
    expect(render?.cuerpoTexto).toContain(NOMBRE);
    expect(`${render?.asunto} ${render?.cuerpoTexto}`).toContain(CODIGO_RESERVA);
  });

  it('debe_declarar_las_variables_requeridas_nombre_y_codigoReserva', () => {
    const catalogo = new CatalogoPlantillasEnCodigo();

    const plantilla = catalogo.seleccionar('E2', 'es');

    expect(plantilla?.variablesRequeridas).toEqual(
      expect.arrayContaining(['nombre', 'codigoReserva']),
    );
  });

  it('debe_requerir_el_presupuesto_como_adjunto_D1', () => {
    const catalogo = new CatalogoPlantillasEnCodigo();

    const plantilla = catalogo.seleccionar('E2', 'es');

    // D-1 CERRADA = requerido: el PDF del presupuesto es el adjunto imprescindible.
    expect(plantilla?.adjuntosRequeridos).toEqual(
      expect.arrayContaining(['presupuesto']),
    );
  });

  it('no_debe_seguir_listando_E2_como_una_plantilla_diferida_inactiva', () => {
    const catalogo = new CatalogoPlantillasEnCodigo();

    // Contraste con las diferidas restantes (E4–E8), que siguen inactivas.
    const e2 = catalogo.seleccionar('E2', 'es');
    const e4 = catalogo.seleccionar('E4', 'es');

    expect(e2?.activa).toBe(true);
    expect(e4?.activa).toBe(false);
  });
});

// ===========================================================================
// 3.1 — E2 en CATALÁN (`PLANTILLA_E2_CA`) + texto de marca definitivo ES/CA.
//        Change `presupuesto-confirmar-ux-e2-idioma`, workstream E — fase TDD RED.
//
// Trazabilidad: spec-delta `comunicaciones` (MODIFIED "Catálogo de plantillas por
// código de email e idioma": "E1 y E2 soportan los idiomas 'es' y 'ca'"; "La
// plantilla E2 en `ca` (`PLANTILLA_E2_CA`, `idioma: 'ca'`, `activa: true`,
// `variablesRequeridas: ['nombre','codigoReserva']`, `adjuntosRequeridos:
// ['presupuesto']`) SE REGISTRA en el registro de idioma `ca` junto a E1") y
// §Textos del E2 (asunto/cuerpo literales ES y CA).
//
// RED: hoy `seleccionar('E2','ca')` cae al registro `es` (misma plantilla ES) — no
// existe `PLANTILLA_E2_CA` en `registroCa` — y `renderE2` (ES) usa el cuerpo GENÉRICO
// viejo («Adjuntamos el presupuesto para tu evento»), no el texto de marca. Estas
// aserciones fallan por comportamiento hasta que `backend-developer` registre la
// variante `ca` y reescriba el render ES/CA con el texto de marca. GREEN es de
// `backend-developer`.
// ===========================================================================

const NOMBRE_MARCA = 'Flori';
const CODIGO_MARCA = 'R-0001';

describe('CatalogoPlantillasEnCodigo — E2 en catalán (workstream E)', () => {
  it('debe_registrar_la_plantilla_E2_en_ca_como_activa_con_su_contrato', () => {
    const catalogo = new CatalogoPlantillasEnCodigo();

    const plantilla = catalogo.seleccionar('E2', 'ca');

    expect(plantilla).not.toBeNull();
    expect(plantilla?.codigoEmail).toBe('E2');
    expect(plantilla?.idioma).toBe('ca');
    expect(plantilla?.activa).toBe(true);
    expect(plantilla?.variablesRequeridas).toEqual(
      expect.arrayContaining(['nombre', 'codigoReserva']),
    );
    expect(plantilla?.adjuntosRequeridos).toEqual(
      expect.arrayContaining(['presupuesto']),
    );
  });

  it('debe_renderizar_el_asunto_CA_con_la_referencia_de_reserva', () => {
    const catalogo = new CatalogoPlantillasEnCodigo();

    const render = catalogo
      .seleccionar('E2', 'ca')
      ?.render({ nombre: NOMBRE_MARCA, codigoReserva: CODIGO_MARCA });

    expect(render?.asunto).toBe(
      `El teu pressupost per a l'esdeveniment (reserva ${CODIGO_MARCA})`,
    );
  });

  it('debe_renderizar_el_cuerpo_CA_con_el_texto_de_marca_definitivo', () => {
    const catalogo = new CatalogoPlantillasEnCodigo();

    const render = catalogo
      .seleccionar('E2', 'ca')
      ?.render({ nombre: NOMBRE_MARCA, codigoReserva: CODIGO_MARCA });
    const cuerpo = `${render?.cuerpoTexto} ${render?.cuerpoHtml}`;

    expect(render?.cuerpoTexto).toContain(NOMBRE_MARCA);
    expect(cuerpo).toContain("Moltes gràcies per confiar en la Masia l'Encís");
    expect(cuerpo).toContain('40%');
    expect(cuerpo).toContain('Canoliart, SL');
    expect(cuerpo).toContain('condicions particulars');
    expect(cuerpo).toContain('Ari');
  });

  it('debe_htmlEscape_el_nombre_en_el_cuerpo_html_del_render_CA', () => {
    const catalogo = new CatalogoPlantillasEnCodigo();

    const render = catalogo
      .seleccionar('E2', 'ca')
      ?.render({ nombre: '<b>Flori</b>', codigoReserva: CODIGO_MARCA });

    expect(render?.cuerpoHtml).toContain('&lt;b&gt;Flori&lt;/b&gt;');
    expect(render?.cuerpoHtml).not.toContain('<b>Flori</b>');
  });

  it('debe_omitir_el_parentesis_de_referencia_en_el_asunto_CA_sin_codigoReserva', () => {
    const catalogo = new CatalogoPlantillasEnCodigo();

    const render = catalogo
      .seleccionar('E2', 'ca')
      ?.render({ nombre: NOMBRE_MARCA, codigoReserva: '' });

    expect(render?.asunto).toBe("El teu pressupost per a l'esdeveniment");
    expect(render?.asunto).not.toContain('(');
  });
});

describe('CatalogoPlantillasEnCodigo — E2 en español con texto de marca (workstream E)', () => {
  it('debe_renderizar_el_asunto_ES_con_la_referencia_de_reserva', () => {
    const catalogo = new CatalogoPlantillasEnCodigo();

    const render = catalogo
      .seleccionar('E2', 'es')
      ?.render({ nombre: NOMBRE_MARCA, codigoReserva: CODIGO_MARCA });

    expect(render?.asunto).toBe(
      `Tu presupuesto para el evento (reserva ${CODIGO_MARCA})`,
    );
  });

  it('debe_renderizar_el_cuerpo_ES_con_el_texto_de_marca_no_el_generico_viejo', () => {
    const catalogo = new CatalogoPlantillasEnCodigo();

    const render = catalogo
      .seleccionar('E2', 'es')
      ?.render({ nombre: NOMBRE_MARCA, codigoReserva: CODIGO_MARCA });
    const cuerpo = `${render?.cuerpoTexto} ${render?.cuerpoHtml}`;

    expect(render?.cuerpoTexto).toContain(NOMBRE_MARCA);
    expect(cuerpo).toContain("Muchas gracias por confiar en la Masia l'Encís");
    expect(cuerpo).toContain('40%');
    expect(cuerpo).toContain('Canoliart, SL');
    expect(cuerpo).toContain('condiciones particulares');
    expect(cuerpo).toContain('Ari');
    // NO el cuerpo genérico anterior.
    expect(cuerpo).not.toContain('Adjuntamos el presupuesto para tu evento');
  });

  it('debe_omitir_el_parentesis_de_referencia_en_el_asunto_ES_sin_codigoReserva', () => {
    const catalogo = new CatalogoPlantillasEnCodigo();

    const render = catalogo
      .seleccionar('E2', 'es')
      ?.render({ nombre: NOMBRE_MARCA, codigoReserva: '' });

    expect(render?.asunto).toBe('Tu presupuesto para el evento');
    expect(render?.asunto).not.toContain('(');
  });
});
