import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import boundaries from 'eslint-plugin-boundaries';

export default tseslint.config(
  { ignores: ['dist', 'src/api-client'] },
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      ecmaVersion: 2022,
      globals: globals.browser,
    },
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'react-refresh/only-export-components': [
        'warn',
        { allowConstantExport: true },
      ],
      // Convención oficial: arrow functions, no `function` declarativo
      // (componentes, hooks, helpers). Ver CLAUDE.md §Convenciones de código.
      'func-style': ['error', 'expression'],
      'prefer-arrow-callback': 'error',
      // Tamaño máximo de archivo (regla dura): fuerza partir páginas/componentes
      // monolíticos. Cuenta solo código (sin blancos ni comentarios). El cliente
      // generado (`src/api-client`) ya está en `ignores`.
      'max-lines': ['error', { max: 300, skipBlankLines: true, skipComments: true }],
      // Barrera de import basada en string literal (no depende del resolver):
      // una feature SOLO se consume por su barrel `@/features/<dominio>`, nunca
      // por sus archivos internos. Refuerza a `boundaries/*` más abajo.
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@/features/*/*'],
              message:
                'Importa una feature solo por su barrel: `@/features/<dominio>`, no por sus archivos internos.',
            },
          ],
        },
      ],
    },
  },

  // ── Pureza de segmento: `components/` solo contiene componentes ───────────
  // Regla dura (Bulletproof React): dentro de una feature, `components/` aloja
  // SOLO componentes React, que son `.tsx`. Los módulos no-componente —helpers,
  // constantes, tipos, schemas, clases de estilo— viven en `lib/` (o los tipos
  // en `model/`). Ejemplo canónico: `features/reservas/lib/*` (iban.ts,
  // ibanSchema.ts, errores.ts…). Esto impide que un `.ts` auxiliar extraído por
  // `react-refresh/only-export-components` (que obliga a que un archivo de
  // componente exporte solo componentes) acabe colgando de `components/` en vez
  // de moverse a `lib/`/`model/`. Ver docs/frontend-standards.md §Estructura.
  //
  // Alcance deliberado: SOLO `features/*/components/`. Los folders de página
  // (`features/*/pages/**`) sí co-localizan `schema.ts`/`constants.ts` (CLAUDE.md).
  {
    files: ['src/features/*/components/**/*.ts'],
    ignores: ['**/__tests__/**', '**/*.test.{ts,tsx}'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector: 'Program',
          message:
            'Módulo no-componente en components/. Los componentes son `.tsx`; mueve helpers/constantes/estilos a `features/<dominio>/lib/` y los tipos a `model/`. Ver docs/frontend-standards.md §Estructura.',
        },
      ],
    },
  },

  // ── Arquitectura de carpetas (regla dura) ────────────────────────────────
  // Estructura por dominio (Bulletproof React): cada feature es autónoma y solo
  // se consume por su barrel (`index.ts`). Ver docs/frontend-folder-structure.md.
  {
    files: ['src/**/*.{ts,tsx}'],
    ignores: ['**/__tests__/**', '**/*.test.{ts,tsx}'],
    plugins: { boundaries },
    settings: {
      // Necesario para que boundaries RESUELVA el alias `@/...` a archivos y no
      // ignore silenciosamente los imports aliased (si no, las reglas no aplican).
      'import/resolver': {
        typescript: { project: './tsconfig.json' },
      },
      'boundaries/dependency-nodes': ['import'],
      'boundaries/elements': [
        { type: 'app', mode: 'file', pattern: ['src/App.tsx', 'src/main.tsx'] },
        { type: 'route', mode: 'folder', pattern: 'src/pages' },
        { type: 'api-client', mode: 'folder', pattern: 'src/api-client' },
        { type: 'layout', mode: 'folder', pattern: 'src/components/layout' },
        { type: 'shared-ui', mode: 'folder', pattern: 'src/components/ui' },
        { type: 'shared', mode: 'folder', pattern: ['src/lib', 'src/hooks'] },
        { type: 'feature', mode: 'folder', pattern: 'src/features/*', capture: ['feature'] },
      ],
    },
    // Nota: en boundaries v6 `element-types`/`entry-point` están marcadas como
    // deprecadas a favor de `boundaries/dependencies` (solo emiten avisos por
    // consola; `pnpm lint` sigue en verde). Se mantienen porque resuelven
    // correctamente el matiz intra-feature (imports relativos OK) vs cross-feature
    // (solo por barrel); migrar a `dependencies` exige la sintaxis de captura aún
    // por confirmar. El guard de barrel está además reforzado por
    // `no-restricted-imports` (independiente del resolver) en el bloque anterior.
    rules: {
      // Una feature solo se importa por su entry-point (barrel index). Prohíbe
      // los imports profundos a internos de otra feature.
      'boundaries/entry-point': [
        'error',
        {
          default: 'disallow',
          rules: [
            { target: ['feature'], allow: 'index.{ts,tsx}' },
            {
              target: ['app', 'route', 'layout', 'shared-ui', 'shared', 'api-client'],
              allow: '**',
            },
          ],
        },
      ],
      // Qué capa puede importar a qué. `shared`/`shared-ui` NUNCA importan
      // features (dependencias hacia capas inferiores). El chrome (`layout`) y la
      // capa de rutas/app sí componen features.
      'boundaries/element-types': [
        'error',
        {
          default: 'disallow',
          rules: [
            { from: ['app'], allow: ['app', 'route', 'feature', 'layout', 'shared-ui', 'shared', 'api-client'] },
            { from: ['route'], allow: ['route', 'feature', 'layout', 'shared-ui', 'shared', 'api-client'] },
            { from: ['layout'], allow: ['layout', 'feature', 'shared-ui', 'shared', 'api-client'] },
            { from: ['feature'], allow: ['feature', 'shared-ui', 'shared', 'api-client'] },
            { from: ['shared-ui'], allow: ['shared-ui', 'shared', 'api-client'] },
            { from: ['shared'], allow: ['shared', 'api-client'] },
            { from: ['api-client'], allow: ['api-client'] },
          ],
        },
      ],
    },
  },
);
