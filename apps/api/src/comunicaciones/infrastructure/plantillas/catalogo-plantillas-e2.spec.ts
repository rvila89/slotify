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

// ===========================================================================
// MARCA DE EDICIÓN E2 (`esEdicion`) — change `presupuesto-edicion-reenvio-email-real`,
//   tasks.md 3.1 — fase TDD RED.
//
// La plantilla E2 recibe una variable OPCIONAL `esEdicion` (booleana, derivada en
// servidor, default `false`; NO entra por el contrato). Cuando es `true` (envío
// disparado por una EDICIÓN del presupuesto), renderiza la variante "presupuesto
// actualizado": cambia el ASUNTO y ANTEPONE un párrafo tras el saludo «Hola {nombre},».
// Con `esEdicion` ausente/false conserva el texto E2 ESTÁNDAR (primer envío / reenvío
// sin cambios). `variablesRequeridas` sigue `['nombre','codigoReserva']` (`esEdicion`
// NO es requerida).
//
// Trazabilidad: design.md D2 (propagación server-side; reenvío sin marca); spec-delta
// `presupuestos` §ADDED "Marca de edición en el email E2 (asunto y párrafo, ES/CA)"
// (Scenarios ES/CA y "Sin marca de edición se conserva el E2 estándar").
//
// RED: hoy `renderE2`/`renderE2Ca` IGNORAN `variables.esEdicion` → el asunto es siempre
// «Tu presupuesto…»/«El teu pressupost…» y no hay párrafo de "actualizado". Estas
// aserciones FALLAN por comportamiento hasta que `backend-developer` amplíe el render.
// GREEN es de `backend-developer`.
// ===========================================================================

const CODIGO_EDICION = '26-0001';

// Copys EXACTOS de la marca de edición (proposal.md / spec-delta ADDED).
const ASUNTO_EDICION_ES = `Hemos actualizado tu presupuesto para el evento (reserva ${CODIGO_EDICION})`;
const ASUNTO_EDICION_CA = `Hem actualitzat el teu pressupost per a l'esdeveniment (reserva ${CODIGO_EDICION})`;
const PARRAFO_EDICION_ES =
  'Hemos actualizado el presupuesto que te enviamos con los cambios solicitados. Te adjuntamos la versión revisada.';
const PARRAFO_EDICION_CA =
  "Hem actualitzat el pressupost que et vam enviar amb els canvis sol·licitats. T'adjuntem la versió revisada.";

describe('CatalogoPlantillasEnCodigo — E2 marca de edición esEdicion=true (ES)', () => {
  it('debe_renderizar_el_asunto_de_presupuesto_actualizado_en_ES', () => {
    const catalogo = new CatalogoPlantillasEnCodigo();

    const render = catalogo
      .seleccionar('E2', 'es')
      ?.render({ nombre: 'Marta', codigoReserva: CODIGO_EDICION, esEdicion: true });

    expect(render?.asunto).toBe(ASUNTO_EDICION_ES);
    // NO conserva el asunto estándar del primer envío.
    expect(render?.asunto).not.toBe(
      `Tu presupuesto para el evento (reserva ${CODIGO_EDICION})`,
    );
  });

  it('debe_anteponer_el_parrafo_de_actualizado_tras_el_saludo_en_ES', () => {
    const catalogo = new CatalogoPlantillasEnCodigo();

    const render = catalogo
      .seleccionar('E2', 'es')
      ?.render({ nombre: 'Marta', codigoReserva: CODIGO_EDICION, esEdicion: true });

    expect(render?.cuerpoTexto).toContain(PARRAFO_EDICION_ES);
    expect(render?.cuerpoHtml).toContain('Hemos actualizado el presupuesto que te enviamos');
    // El párrafo va JUSTO tras el saludo «Hola Marta,» (antes del resto de marca).
    const idxSaludo = render!.cuerpoTexto.indexOf('Hola Marta,');
    const idxParrafo = render!.cuerpoTexto.indexOf(PARRAFO_EDICION_ES);
    expect(idxSaludo).toBeGreaterThanOrEqual(0);
    expect(idxParrafo).toBeGreaterThan(idxSaludo);
  });

  it('debe_conservar_el_resto_del_texto_de_marca_del_tenant_en_la_edicion_ES', () => {
    const catalogo = new CatalogoPlantillasEnCodigo();

    const render = catalogo
      .seleccionar('E2', 'es')
      ?.render({ nombre: 'Marta', codigoReserva: CODIGO_EDICION, esEdicion: true });
    const cuerpo = `${render?.cuerpoTexto} ${render?.cuerpoHtml}`;

    expect(cuerpo).toContain('40%');
    expect(cuerpo).toContain('Canoliart, SL');
    expect(cuerpo).toContain('Ari');
  });
});

describe('CatalogoPlantillasEnCodigo — E2 marca de edición esEdicion=true (CA)', () => {
  it('debe_renderizar_el_asunto_de_pressupost_actualitzat_en_CA', () => {
    const catalogo = new CatalogoPlantillasEnCodigo();

    const render = catalogo
      .seleccionar('E2', 'ca')
      ?.render({ nombre: 'Marta', codigoReserva: CODIGO_EDICION, esEdicion: true });

    expect(render?.asunto).toBe(ASUNTO_EDICION_CA);
    expect(render?.asunto).not.toBe(
      `El teu pressupost per a l'esdeveniment (reserva ${CODIGO_EDICION})`,
    );
  });

  it('debe_anteponer_el_parrafo_de_actualitzat_tras_el_saludo_en_CA', () => {
    const catalogo = new CatalogoPlantillasEnCodigo();

    const render = catalogo
      .seleccionar('E2', 'ca')
      ?.render({ nombre: 'Marta', codigoReserva: CODIGO_EDICION, esEdicion: true });

    expect(render?.cuerpoTexto).toContain(PARRAFO_EDICION_CA);
    expect(render?.cuerpoHtml).toContain('Hem actualitzat el pressupost que et vam enviar');
    const idxSaludo = render!.cuerpoTexto.indexOf('Hola Marta,');
    const idxParrafo = render!.cuerpoTexto.indexOf(PARRAFO_EDICION_CA);
    expect(idxSaludo).toBeGreaterThanOrEqual(0);
    expect(idxParrafo).toBeGreaterThan(idxSaludo);
  });
});

describe('CatalogoPlantillasEnCodigo — E2 SIN marca de edición conserva el texto estándar', () => {
  it('con_esEdicion_false_el_asunto_ES_es_el_estandar_sin_el_parrafo_de_actualizado', () => {
    const catalogo = new CatalogoPlantillasEnCodigo();

    const render = catalogo
      .seleccionar('E2', 'es')
      ?.render({ nombre: 'Marta', codigoReserva: CODIGO_EDICION, esEdicion: false });

    expect(render?.asunto).toBe(`Tu presupuesto para el evento (reserva ${CODIGO_EDICION})`);
    expect(render?.cuerpoTexto).not.toContain(PARRAFO_EDICION_ES);
  });

  it('con_esEdicion_ausente_el_asunto_ES_es_el_estandar_sin_el_parrafo_de_actualizado', () => {
    const catalogo = new CatalogoPlantillasEnCodigo();

    const render = catalogo
      .seleccionar('E2', 'es')
      ?.render({ nombre: 'Marta', codigoReserva: CODIGO_EDICION });

    expect(render?.asunto).toBe(`Tu presupuesto para el evento (reserva ${CODIGO_EDICION})`);
    expect(render?.cuerpoTexto).not.toContain(PARRAFO_EDICION_ES);
  });

  it('con_esEdicion_ausente_el_asunto_CA_es_el_estandar_sin_el_parrafo_de_actualitzat', () => {
    const catalogo = new CatalogoPlantillasEnCodigo();

    const render = catalogo
      .seleccionar('E2', 'ca')
      ?.render({ nombre: 'Marta', codigoReserva: CODIGO_EDICION });

    expect(render?.asunto).toBe(
      `El teu pressupost per a l'esdeveniment (reserva ${CODIGO_EDICION})`,
    );
    expect(render?.cuerpoTexto).not.toContain(PARRAFO_EDICION_CA);
  });

  it('la_marca_de_edicion_no_cambia_las_variablesRequeridas_de_E2', () => {
    const catalogo = new CatalogoPlantillasEnCodigo();

    // `esEdicion` es OPCIONAL: no se añade a `variablesRequeridas`.
    expect(catalogo.seleccionar('E2', 'es')?.variablesRequeridas).toEqual(
      ['nombre', 'codigoReserva'],
    );
    expect(catalogo.seleccionar('E2', 'ca')?.variablesRequeridas).toEqual(
      ['nombre', 'codigoReserva'],
    );
  });
});
