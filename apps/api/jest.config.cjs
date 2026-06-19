/**
 * Configuración Jest para @slotify/api.
 *
 * - `ts-jest` para ejecutar TypeScript sin precompilar.
 * - Carga `.env` antes de los tests (DATABASE_URL) vía `setupFiles`, de modo
 *   que los tests de integración (que hablan con el Postgres del docker-compose)
 *   tengan la conexión disponible.
 * - `testTimeout` holgado: los tests de concurrencia abren transacciones reales.
 */
/** @type {import('jest').Config} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  rootDir: '.',
  roots: ['<rootDir>/src'],
  testMatch: ['**/__tests__/**/*.spec.ts', '**/*.spec.ts'],
  setupFiles: ['<rootDir>/jest.setup.ts'],
  testTimeout: 30000,
  transform: {
    '^.+\\.ts$': ['ts-jest', { tsconfig: 'tsconfig.json' }],
  },
};
