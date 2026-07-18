/**
 * TESTS del catálogo de plantillas en código `CatalogoPlantillasEnCodigo`
 * (US-045) — fase TDD RED. tasks.md Fase 2: 2.7.
 *
 * Trazabilidad: US-045, spec-delta `comunicaciones` (Requirement: "Catálogo de
 * plantillas por código de email e idioma del tenant"; Scenarios: "La plantilla se
 * selecciona por código e idioma del tenant", "E2–E8 están diseñadas pero no se
 * disparan en este change"), design.md §3 (catálogo tipado en código, indexado por
 * `codigo_email` + idioma, i18n con default/fallback `es`; E1 ACTIVA con render real,
 * E2–E8 DECLARADAS como diseñadas/INACTIVAS).
 *
 * El catálogo es INFRAESTRUCTURA: implementa el puerto de dominio
 * `CatalogoPlantillasPort`. Aquí se verifica el contenido declarado (E1 activa,
 * E2–E8 inactivas), la selección por idioma y la ausencia de plantilla en idiomas
 * no provistos (que el motor resuelve con fallback `es`).
 *
 * RED: aún no existen
 * `comunicaciones/infrastructure/plantillas/catalogo-plantillas.ts` ni los puertos
 * de dominio; los imports fallan y la batería está en ROJO. GREEN = `backend-developer`.
 */
import { CatalogoPlantillasEnCodigo } from './catalogo-plantillas';
import type { CodigoEmail } from '../../domain/codigo-email';

// E3 pasa a ACTIVA en la rebanada 6.4b (documentos-enviar-factura-senal-e3) y E2 en el change
// `presupuesto-prereserva-cta-descarte-y-e2` (workstream C; su activación se verifica en
// `catalogo-plantillas-e2.spec.ts`); ya no son diferidas. El resto sigue diseñado/inactivo.
const E_DIFERIDOS: ReadonlyArray<CodigoEmail> = ['E4', 'E5', 'E6', 'E7', 'E8'];

describe('CatalogoPlantillasEnCodigo — E1 activa y E2–E8 diseñadas/inactivas (2.7)', () => {
  it('debe_seleccionar_la_plantilla_E1_en_es_y_marcarla_como_activa', () => {
    const catalogo = new CatalogoPlantillasEnCodigo();

    const plantilla = catalogo.seleccionar('E1', 'es');

    expect(plantilla).not.toBeNull();
    expect(plantilla?.codigoEmail).toBe('E1');
    expect(plantilla?.idioma).toBe('es');
    expect(plantilla?.activa).toBe(true);
  });

  it('debe_declarar_las_variables_requeridas_de_la_plantilla_E1', () => {
    const catalogo = new CatalogoPlantillasEnCodigo();

    const plantilla = catalogo.seleccionar('E1', 'es');

    // La plantilla declara su contrato de variables (nombre del cliente + casuística E1).
    expect(plantilla?.variablesRequeridas).toEqual(
      expect.arrayContaining(['nombre', 'tipoE1']),
    );
  });

  it('debe_renderizar_la_plantilla_E1_con_asunto_y_cuerpo_a_partir_de_las_variables', () => {
    const catalogo = new CatalogoPlantillasEnCodigo();

    const plantilla = catalogo.seleccionar('E1', 'es');
    const render = plantilla?.render({ nombre: 'Marta', email: 'marta.soler@example.com' });

    expect(render?.asunto.length).toBeGreaterThan(0);
    expect(render?.cuerpoHtml.length).toBeGreaterThan(0);
    expect(render?.cuerpoTexto.length).toBeGreaterThan(0);
  });

  it('debe_declarar_E2_a_E8_como_disenadas_pero_inactivas_sin_trigger', () => {
    const catalogo = new CatalogoPlantillasEnCodigo();

    for (const codigo of E_DIFERIDOS) {
      const plantilla = catalogo.seleccionar(codigo, 'es');
      // Declarada (existe la entrada) pero INACTIVA: sin trigger cableado en este change.
      expect(plantilla).not.toBeNull();
      expect(plantilla?.activa).toBe(false);
    }
  });

  it('no_debe_tener_plantilla_en_un_idioma_no_provisto_para_que_el_motor_aplique_fallback', () => {
    const catalogo = new CatalogoPlantillasEnCodigo();

    // El MVP entrega `es` y `ca`; cualquier otro idioma (ej. `fr`) no está provisto →
    // registro `es` como fallback, nunca una entrada específica de ese idioma.
    expect(catalogo.seleccionar('E1', 'fr')?.idioma).toBe('es');
  });
});

// ===========================================================================
// 3.8 — Activación de la plantilla E3 (documentos-enviar-factura-senal-e3, 6.4b).
//   E3 pasa a activa=true con render real (asunto + cuerpo canónicos, NO el
//   placeholder de `renderInactivo`); declara el contrato de adjuntos: la factura
//   de señal es REQUERIDA y las condicions particulars son OPCIONALES
//   (§D-ruta-email / §D-adjunto-condiciones).
// ===========================================================================

describe('CatalogoPlantillasEnCodigo — E3 activa con render real (3.8)', () => {
  it('debe_marcar_la_plantilla_E3_en_es_como_activa', () => {
    const catalogo = new CatalogoPlantillasEnCodigo();

    const plantilla = catalogo.seleccionar('E3', 'es');

    expect(plantilla).not.toBeNull();
    expect(plantilla?.codigoEmail).toBe('E3');
    expect(plantilla?.idioma).toBe('es');
    expect(plantilla?.activa).toBe(true);
  });

  it('debe_renderizar_E3_con_asunto_y_cuerpo_reales_no_el_placeholder_de_renderInactivo', () => {
    const catalogo = new CatalogoPlantillasEnCodigo();

    const plantilla = catalogo.seleccionar('E3', 'es');
    const render = plantilla?.render({
      nombre: 'Marta',
      email: 'marta.soler@example.com',
      codigoReserva: 'SLO-2026-0023',
    });

    expect(render?.asunto.length).toBeGreaterThan(0);
    expect(render?.cuerpoHtml.length).toBeGreaterThan(0);
    expect(render?.cuerpoTexto.length).toBeGreaterThan(0);
    // NO es el placeholder de una plantilla inactiva.
    expect(render?.asunto).not.toContain('pendiente de cableado');
    expect(render?.cuerpoTexto).not.toContain('diseñada pero inactiva');
  });

  it('debe_declarar_las_variables_requeridas_de_la_plantilla_E3', () => {
    const catalogo = new CatalogoPlantillasEnCodigo();

    const plantilla = catalogo.seleccionar('E3', 'es');

    expect(plantilla?.variablesRequeridas).toEqual(expect.arrayContaining(['email']));
  });

  it('debe_requerir_la_factura_de_senal_como_adjunto_y_dejar_las_condiciones_opcionales', () => {
    const catalogo = new CatalogoPlantillasEnCodigo();

    const plantilla = catalogo.seleccionar('E3', 'es');

    // La factura de señal es el adjunto imprescindible (§D-guarda-estado).
    expect(plantilla?.adjuntosRequeridos).toEqual(expect.arrayContaining(['senal']));
    // Las condiciones NO son un adjunto requerido (degradan sin tumbar el envío).
    expect(plantilla?.adjuntosRequeridos).not.toContain('condiciones');
  });
});
