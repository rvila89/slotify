/**
 * Configuración Jest para @slotify/api.
 *
 * - `ts-jest` para ejecutar TypeScript sin precompilar.
 * - Carga `.env` antes de los tests (DATABASE_URL) vía `setupFiles`.
 * - `testTimeout` holgado: los tests de concurrencia abren transacciones reales.
 *
 * ESM de react-pdf (épico #6 6.1b): `@react-pdf/renderer` es un paquete ESM puro que no
 * ofrece build CommonJS. Se carga en runtime con `import()` NATIVO (ver
 * `documento-presupuesto.render.ts`), lo que exige `--experimental-vm-modules` en Node
 * bajo Jest (lo inyecta el script `test` vía cross-env). El backend (y sus `.tsx` de
 * plantilla) siguen compilando a CommonJS con ts-jest; los componentes reciben las
 * primitivas de react-pdf inyectadas (no lo importan estáticamente), de modo que todo el
 * árbol es CommonJS y solo react-pdf cruza la frontera ESM.
 */
/** @type {import('jest').Config} */
module.exports = {
  testEnvironment: 'node',
  rootDir: '.',
  roots: ['<rootDir>/src'],
  testMatch: ['**/__tests__/**/*.spec.ts', '**/*.spec.ts'],
  setupFiles: ['<rootDir>/jest.setup.ts'],
  testTimeout: 30000,
  moduleFileExtensions: ['ts', 'tsx', 'js', 'json', 'node'],
  transform: {
    '^.+\\.tsx?$': ['ts-jest', { tsconfig: 'tsconfig.json' }],
  },
};
