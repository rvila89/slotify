/**
 * Fase RED — US-000A · App Shell
 * Task 2.7: el sistema de diseno (DESIGN.md §1–§5) esta cableado en apps/web y el
 * shell consume tokens NOMBRADOS (sin hex inline).
 *
 * Este test inspecciona ficheros en disco (no importa componentes), por lo que
 * falla con aserciones de comportamiento claras: los tokens/fuentes todavia no
 * estan declarados y `AppShell` aun no existe.
 *
 * Contrato de produccion (fase GREEN):
 *  - `src/index.css` (`:root`): custom properties para brand, canvas, accent
 *    activo, border, text y los estados de reserva (confirmada/bloqueada/cola/
 *    disponible); ademas declara/carga las familias Epilogue y Manrope.
 *  - `tailwind.config.ts`: mapea esas custom properties en `theme.extend.colors`
 *    y `fontFamily` (referenciando `var(--...)`), con Epilogue + Manrope.
 *  - `src/app/AppShell.tsx`: existe y NO contiene literales hex de color.
 */
import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// Vitest ejecuta con cwd = apps/web (raiz del paquete @slotify/web).
const resolverDesdeWeb = (rel: string) => resolve(process.cwd(), rel);

const leer = (rel: string) => readFileSync(resolverDesdeWeb(rel), 'utf8');

describe('Design tokens cableados en apps/web (DESIGN.md §1–§5)', () => {
  it('index_css_declara_los_tokens_semanticos_como_custom_properties_en_root', () => {
    const css = leer('src/index.css');

    expect(css).toMatch(/:root/);
    // Semanticos del shell (DESIGN.md §1 / spec scenario).
    expect(css).toMatch(/--[a-z0-9-]*brand/i);
    expect(css).toMatch(/--[a-z0-9-]*canvas/i);
    expect(css).toMatch(/--[a-z0-9-]*(accent|active)/i);
    expect(css).toMatch(/--[a-z0-9-]*border/i);
    expect(css).toMatch(/--[a-z0-9-]*text/i);
  });

  it('index_css_declara_los_tokens_de_estado_de_reserva', () => {
    const css = leer('src/index.css');

    // Colores semanticos de estado, transversales (DESIGN.md §1 estados).
    expect(css).toMatch(/--[a-z0-9-]*confirmada/i);
    expect(css).toMatch(/--[a-z0-9-]*bloqueada/i);
    expect(css).toMatch(/--[a-z0-9-]*cola/i);
    expect(css).toMatch(/--[a-z0-9-]*disponible/i);
  });

  it('las_fuentes_epilogue_y_manrope_estan_cargadas', () => {
    const css = leer('src/index.css');

    expect(css).toMatch(/epilogue/i);
    expect(css).toMatch(/manrope/i);
  });

  it('tailwind_config_mapea_colores_y_fontFamily_referenciando_las_custom_properties', () => {
    const tw = leer('tailwind.config.ts');

    expect(tw).toMatch(/colors/);
    expect(tw).toMatch(/fontFamily/);
    expect(tw).toMatch(/var\(--/);
    expect(tw).toMatch(/epilogue/i);
    expect(tw).toMatch(/manrope/i);
  });

  it('el_app_shell_existe_y_no_usa_literales_hex_de_color', () => {
    const appShellPath = resolverDesdeWeb('src/app/AppShell.tsx');
    expect(existsSync(appShellPath)).toBe(true);

    const source = readFileSync(appShellPath, 'utf8');
    const hexInline = source.match(/#[0-9a-fA-F]{3,8}\b/g) ?? [];
    expect(hexInline).toEqual([]);
  });
});
