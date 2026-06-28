import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright E2E — Slotify monorepo.
 *
 * Coordina dos procesos de dev (API NestJS puerto 3000 + SPA Vite puerto 5173).
 * Con reuseExistingServer: true los reutiliza si ya están en marcha; en CI los
 * levanta automáticamente con los comandos de webServer.
 *
 * ARRANQUE MANUAL (desarrollo local):
 *   Terminal 1: pnpm --filter @slotify/api run dev
 *   Terminal 2: pnpm --filter @slotify/web run dev
 *   Terminal 3: npx playwright test
 */
export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  expect: { timeout: 7_000 },
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 0,
  workers: 1,
  reporter: [['list']],

  use: {
    baseURL: 'http://localhost:5173',
    trace: 'on-first-retry',
    video: 'on-first-retry',
  },

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],

  webServer: [
    {
      /**
       * API NestJS (ts-node-dev en modo dev).
       * El endpoint /api/health devuelve { status: 'ok' } cuando está lista.
       */
      command: 'pnpm --filter @slotify/api run dev',
      url: 'http://localhost:3000/api/health',
      reuseExistingServer: true,
      timeout: 90_000,
    },
    {
      /**
       * SPA Vite. Recoge VITE_API_URL=http://localhost:3000 de apps/web/.env.local
       * para que el cliente HTTP apunte al API (CORS cruzado 5173→3000).
       */
      command: 'pnpm --filter @slotify/web run dev',
      url: 'http://localhost:5173',
      reuseExistingServer: true,
      timeout: 30_000,
    },
  ],
});
