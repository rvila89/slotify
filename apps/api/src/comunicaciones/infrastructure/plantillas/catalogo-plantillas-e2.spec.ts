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
