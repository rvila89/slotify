import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'node:path';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
    // El cliente HTTP generado reexporta sus tipos con `export * from './schema'`
    // y `openapi-typescript` emite `schema.d.ts`. Se añade `.d.ts` (al final, sin
    // prioridad sobre `.ts`/`.tsx`) para que Vite/Vitest resuelvan ese reexport
    // type-only en runtime sin tener que editar el cliente generado.
    extensions: ['.mjs', '.js', '.mts', '.ts', '.jsx', '.tsx', '.json', '.d.ts'],
  },
  server: {
    port: 5173,
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    css: true,
  },
});
