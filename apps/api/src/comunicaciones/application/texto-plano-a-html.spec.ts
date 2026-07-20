/**
 * TESTS del helper puro `textoPlanoAHtml` — fase TDD RED
 * (change `consulta-fecha-borrador-fix`, design.md §D-2).
 *
 * Trazabilidad: spec-delta `comunicaciones` — Requirement "Confirmación de envío de un
 * borrador con edición opcional de asunto y cuerpo" (borde de envío: texto plano → HTML
 * preservando el formato). design.md §D-2 decisión 1: extraer la conversión
 * `\n\n → <p>…</p>` + `\n → <br>` + escape HTML a un módulo PURO y compartido de la
 * APLICACIÓN de `comunicaciones`, reutilizando el `htmlEscape` existente del catálogo, sin
 * dependencias de framework/infra (hook `no-infra-in-domain` no aplica a aplicación, pero se
 * mantiene puro y testeable en aislamiento, sin Postgres).
 *
 * Firma esperada (RED — aún no existe el módulo):
 *   export const textoPlanoAHtml = (texto: string): string => …
 *
 * RED: aún NO existe `comunicaciones/application/texto-plano-a-html.ts`. El import falla en
 * compilación y toda la batería está en ROJO por AUSENCIA DE IMPLEMENTACIÓN. GREEN es de
 * `backend-developer`.
 */
import { textoPlanoAHtml } from './texto-plano-a-html';

describe('textoPlanoAHtml — conversión de texto plano a HTML preservando el formato', () => {
  it('debe_separar_los_parrafos_por_doble_salto_de_linea_en_etiquetas_p', () => {
    const html = textoPlanoAHtml('Hola Marta,\n\nGracias por tu interés.');

    expect(html).toContain('<p>Hola Marta,</p>');
    expect(html).toContain('<p>Gracias por tu interés.</p>');
  });

  it('debe_convertir_un_salto_de_linea_simple_dentro_de_un_parrafo_en_br', () => {
    const html = textoPlanoAHtml('Línea uno\nLínea dos');

    // Un único párrafo con <br> entre las dos líneas.
    expect(html).toContain('<br>');
    expect(html).toContain('Línea uno');
    expect(html).toContain('Línea dos');
    // No abre un segundo <p> para un salto simple.
    expect(html.match(/<p>/g) ?? []).toHaveLength(1);
  });

  it('debe_escapar_los_caracteres_html_especiales_menor_mayor_y_amp', () => {
    const html = textoPlanoAHtml('a < b & c > d');

    expect(html).toContain('&lt;');
    expect(html).toContain('&gt;');
    expect(html).toContain('&amp;');
    // El marcado peligroso del usuario NO llega crudo al HTML.
    expect(html).not.toContain('a < b');
  });

  it('no_debe_dejar_pasar_marcado_html_inyectado_por_el_usuario', () => {
    const html = textoPlanoAHtml('<script>alert(1)</script>');

    expect(html).toContain('&lt;script&gt;');
    expect(html).not.toContain('<script>');
  });

  it('un_texto_sin_saltos_produce_un_unico_parrafo', () => {
    const html = textoPlanoAHtml('Una sola línea');

    expect(html).toBe('<p>Una sola línea</p>');
  });

  it('un_texto_vacio_produce_una_salida_coherente_sin_romper_el_html', () => {
    const html = textoPlanoAHtml('');

    // Coherente: vacío o un único <p></p>; en ningún caso HTML mal formado.
    expect(['', '<p></p>']).toContain(html);
  });

  it('debe_conservar_el_orden_de_los_parrafos', () => {
    const html = textoPlanoAHtml('Primero\n\nSegundo\n\nTercero');

    expect(html.indexOf('Primero')).toBeLessThan(html.indexOf('Segundo'));
    expect(html.indexOf('Segundo')).toBeLessThan(html.indexOf('Tercero'));
    expect(html.match(/<p>/g) ?? []).toHaveLength(3);
  });
});
