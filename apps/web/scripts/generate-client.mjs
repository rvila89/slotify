// Codegen del cliente HTTP del frontend desde el contrato OpenAPI.
// Fuente de verdad: docs/api-spec.yml (estático => reproducible, no requiere backend up).
// Genera:
//   src/api-client/schema.d.ts  -> tipos (openapi-typescript)
//   src/api-client/client.ts    -> cliente runtime tipado (openapi-fetch)
//   src/api-client/index.ts      -> barrel
// NO editar a mano nada bajo src/api-client/** (hook protect-generated-client). Regenera.
import { execFileSync } from 'node:child_process';
import { writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const webRoot = resolve(__dirname, '..');
const specPath = resolve(webRoot, '../../docs/api-spec.yml');
const outDir = resolve(webRoot, 'src/api-client');
const schemaPath = resolve(outDir, 'schema.d.ts');

mkdirSync(outDir, { recursive: true });

console.log(`🚀 openapi-typescript: ${specPath} -> schema.d.ts`);
execFileSync(
  'pnpm',
  ['exec', 'openapi-typescript', specPath, '-o', schemaPath],
  { stdio: 'inherit', cwd: webRoot },
);

const banner = `/**
 * GENERADO automáticamente por scripts/generate-client.mjs (pnpm generate-client).
 * NO EDITAR A MANO. Si está desfasado, evoluciona docs/api-spec.yml y regenera.
 */`;

const clientTs = `${banner}
import createClient from 'openapi-fetch';
import type { paths } from './schema';

/**
 * Cliente HTTP type-safe del frontend.
 * baseUrl: VITE_API_URL (p.ej. http://localhost:3000) + prefijo /api.
 * El JWT (access en memoria) y el tenant_id viajan en el header Authorization,
 * nunca en el path; el refresh va en cookie httpOnly (credentials: 'include').
 */
export const apiClient = createClient<paths>({
  baseUrl: \`\${import.meta.env.VITE_API_URL ?? ''}/api\`,
  credentials: 'include',
});

export default apiClient;
`;

const indexTs = `${banner}
export * from './schema';
export { apiClient, default } from './client';
`;

writeFileSync(resolve(outDir, 'client.ts'), clientTs);
writeFileSync(resolve(outDir, 'index.ts'), indexTs);
console.log('✨ client.ts + index.ts generados');
