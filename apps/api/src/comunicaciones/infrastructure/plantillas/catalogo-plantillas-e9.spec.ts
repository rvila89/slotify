/**
 * TESTS de la plantilla E9 "modificación de reserva" i18n (change `reserva-viva-edicion-
 * recalculo-ficha`, tasks.md 3.5) — fase TDD RED.
 *
 * Trazabilidad: spec-delta `comunicaciones` (Requirement "Email de modificación de
 * reserva en el idioma de la reserva"; Scenarios ES/CA + fallback a `es` con traza);
 * design.md §D-6 (código de email dedicado E9, `renderE9`/`renderE9Ca`, variables
 * `{nombre}`, `{codigoReserva}`, qué cambió (personas/duración), `{liquidacionRestante}`;
 * adjunto = PDF del presupuesto de modificación, patrón E2).
 *
 * Se ejercita por la API PÚBLICA del catálogo (`CatalogoPlantillasEnCodigo.seleccionar`),
 * igual que las baterías de E2/E3: `seleccionar('E9','es')`/`('E9','ca')` devuelven la
 * plantilla ACTIVA con su render real; un idioma desconocido devuelve `null` para que el
 * motor aplique el fallback auditado a `es`.
 *
 * RED: hoy `'E9'` no existe en el enum `CodigoEmail` (solo E1–E8 + manual) ni en el
 * catálogo (`seleccionar('E9', …)` devuelve `null`). Estas aserciones FALLAN (por tipos
 * y/o por comportamiento) hasta que `backend-developer` añada el código E9 y registre
 * `renderE9`/`renderE9Ca`. GREEN es de `backend-developer`.
 */
import { CatalogoPlantillasEnCodigo } from './catalogo-plantillas';

const NOMBRE = 'Ana';
const CODIGO_RESERVA = 'R-001';
const LIQUIDACION_RESTANTE = '500.00';

// ===========================================================================
// 3.5 — E9 en ESPAÑOL: activa, render real, incluye el restante a liquidar.
// ===========================================================================

describe('CatalogoPlantillasEnCodigo — E9 modificación en español (3.5)', () => {
  it('debe_registrar_la_plantilla_E9_en_es_como_activa', () => {
    const catalogo = new CatalogoPlantillasEnCodigo();

    // @ts-expect-error 'E9' aún no está en el tipo CodigoEmail (RED): lo añade backend.
    const plantilla = catalogo.seleccionar('E9', 'es');

    expect(plantilla).not.toBeNull();
    expect(plantilla?.codigoEmail).toBe('E9');
    expect(plantilla?.idioma).toBe('es');
    expect(plantilla?.activa).toBe(true);
  });

  it('debe_renderizar_E9_en_es_indicando_la_liquidacion_restante', () => {
    const catalogo = new CatalogoPlantillasEnCodigo();

    // @ts-expect-error 'E9' aún no está en el tipo CodigoEmail (RED).
    const render = catalogo.seleccionar('E9', 'es')?.render({
      nombre: NOMBRE,
      codigoReserva: CODIGO_RESERVA,
      cambio: 'personas',
      liquidacionRestante: LIQUIDACION_RESTANTE,
    });

    const cuerpo = `${render?.asunto} ${render?.cuerpoTexto} ${render?.cuerpoHtml}`;
    // Texto de "Liquidación restante" (es) presente en el render real.
    expect(cuerpo).toContain('Liquidación restante');
    // NO es el placeholder de plantilla inactiva.
    expect(render?.asunto).not.toContain('pendiente de cableado');
    expect(cuerpo).not.toContain('diseñada pero inactiva');
  });

  it('debe_incluir_el_nombre_y_el_codigoReserva_en_el_render_es', () => {
    const catalogo = new CatalogoPlantillasEnCodigo();

    // @ts-expect-error 'E9' aún no está en el tipo CodigoEmail (RED).
    const render = catalogo.seleccionar('E9', 'es')?.render({
      nombre: NOMBRE,
      codigoReserva: CODIGO_RESERVA,
      cambio: 'personas',
      liquidacionRestante: LIQUIDACION_RESTANTE,
    });

    expect(render?.cuerpoTexto).toContain(NOMBRE);
    expect(`${render?.asunto} ${render?.cuerpoTexto}`).toContain(CODIGO_RESERVA);
  });

  it('debe_formatear_la_liquidacionRestante_como_importe_en_el_render', () => {
    const catalogo = new CatalogoPlantillasEnCodigo();

    // @ts-expect-error 'E9' aún no está en el tipo CodigoEmail (RED).
    const render = catalogo.seleccionar('E9', 'es')?.render({
      nombre: NOMBRE,
      codigoReserva: CODIGO_RESERVA,
      cambio: 'duracion',
      liquidacionRestante: LIQUIDACION_RESTANTE,
    });

    const cuerpo = `${render?.cuerpoTexto} ${render?.cuerpoHtml}`;
    // El importe (500) aparece formateado en el cuerpo del email.
    expect(cuerpo).toContain('500');
  });
});

// ===========================================================================
// 3.5 — E9 en CATALÁN: activa, render real con el texto catalán equivalente.
// ===========================================================================

describe('CatalogoPlantillasEnCodigo — E9 modificación en catalán (3.5)', () => {
  it('debe_registrar_la_plantilla_E9_en_ca_como_activa', () => {
    const catalogo = new CatalogoPlantillasEnCodigo();

    // @ts-expect-error 'E9' aún no está en el tipo CodigoEmail (RED).
    const plantilla = catalogo.seleccionar('E9', 'ca');

    expect(plantilla).not.toBeNull();
    expect(plantilla?.codigoEmail).toBe('E9');
    expect(plantilla?.idioma).toBe('ca');
    expect(plantilla?.activa).toBe(true);
  });

  it('debe_renderizar_E9_en_ca_con_el_texto_catalan_de_la_liquidacio_restant', () => {
    const catalogo = new CatalogoPlantillasEnCodigo();

    // @ts-expect-error 'E9' aún no está en el tipo CodigoEmail (RED).
    const render = catalogo.seleccionar('E9', 'ca')?.render({
      nombre: NOMBRE,
      codigoReserva: CODIGO_RESERVA,
      cambio: 'personas',
      liquidacionRestante: LIQUIDACION_RESTANTE,
    });

    const cuerpo = `${render?.asunto} ${render?.cuerpoTexto} ${render?.cuerpoHtml}`;
    // Texto catalán equivalente a "Liquidación restante".
    expect(cuerpo).toContain('Liquidació restant');
    expect(render?.cuerpoTexto).toContain(NOMBRE);
  });
});

// ===========================================================================
// 3.5 — Fallback: idioma desconocido → null (el motor aplica el fallback auditado a es),
//        mismo comportamiento que E1/E2/E3.
// ===========================================================================

describe('CatalogoPlantillasEnCodigo — E9 fallback de idioma (3.5)', () => {
  it('debe_devolver_null_para_un_idioma_no_soportado_de_E9', () => {
    const catalogo = new CatalogoPlantillasEnCodigo();

    // @ts-expect-error 'E9' aún no está en el tipo CodigoEmail (RED).
    const plantilla = catalogo.seleccionar('E9', 'fr');

    // null → el motor de US-045 aplica el fallback a `es` + AUDIT_LOG.
    expect(plantilla).toBeNull();
  });

  it('debe_resolver_E9_en_es_como_variante_de_fallback_activa', () => {
    const catalogo = new CatalogoPlantillasEnCodigo();

    // La variante `es` es el destino del fallback: debe existir y estar activa.
    // @ts-expect-error 'E9' aún no está en el tipo CodigoEmail (RED).
    const fallback = catalogo.seleccionar('E9', 'es');

    expect(fallback).not.toBeNull();
    expect(fallback?.activa).toBe(true);
  });
});
