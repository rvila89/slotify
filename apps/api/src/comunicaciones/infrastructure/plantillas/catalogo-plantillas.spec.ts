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

const E_DIFERIDOS: ReadonlyArray<CodigoEmail> = ['E2', 'E3', 'E4', 'E5', 'E6', 'E7', 'E8'];

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

    // La plantilla declara su contrato de variables (al menos el destinatario).
    expect(plantilla?.variablesRequeridas).toEqual(expect.arrayContaining(['email']));
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

    // El MVP entrega `es`; `ca` no está provisto → null (el motor cae a `es` + AUDIT_LOG).
    expect(catalogo.seleccionar('E1', 'ca')).toBeNull();
  });
});
