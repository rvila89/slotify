import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: ['dist', 'node_modules', 'prisma/migrations', '.dependency-cruiser.cjs'],
  },
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    files: ['src/**/*.ts'],
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
);
