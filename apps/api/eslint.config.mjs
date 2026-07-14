import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: ['dist', 'node_modules', 'prisma/migrations', '.dependency-cruiser.cjs'],
  },
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    files: ['src/**/*.ts', 'src/**/*.tsx'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: {
        ...globals.node,
        ...globals.jest,
      },
    },
    rules: {
      // Convención oficial: arrow functions, no `function` declarativo
      // (helpers, factories, componentes). Ver CLAUDE.md §Convenciones de código.
      'func-style': ['error', 'expression'],
      'prefer-arrow-callback': 'error',
      // Esqueleto: que pase limpio sin reglas excesivas (objetivo exit 0).
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unused-vars': [
        'warn',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/no-empty-object-type': 'off',
    },
  },

  // ── Pureza de segmento: `componentes/`/`components/` solo contienen componentes ──
  // Regla dura (misma filosofía que el ESLint de apps/web): una carpeta de
  // componentes aloja SOLO componentes React, que son `.tsx`. Los módulos
  // no-componente —helpers, constantes, tipos, estilos, "kits" de primitivas—
  // viven FUERA de esa carpeta (p. ej. en la raíz de la capa `presentation/`).
  // Evita que un `.ts` auxiliar acabe colgando de `componentes/`. Ver
  // docs/backend-standards.md y la lección del épico #6 (6.1b: estilos.ts /
  // kit-react-pdf.ts se movieron fuera de `componentes/`).
  {
    files: ['src/**/componentes/**/*.ts', 'src/**/components/**/*.ts'],
    ignores: ['**/__tests__/**', '**/*.spec.ts'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector: 'Program',
          message:
            'Módulo no-componente en componentes/. Los componentes son `.tsx`; mueve helpers/constantes/tipos/estilos/kits fuera de la carpeta de componentes (p. ej. a la raíz de la capa).',
        },
      ],
    },
  },
);
