// Carga variables de entorno (DATABASE_URL) para los tests de integración.
//
// Los tests usan una BD DEDICADA (`.env.test` → slotify_test) para NO tocar
// los datos del dev server (que usa `.env` → slotify_dev). Esto evita que los
// teardowns de los tests (deleteMany sobre FECHA_BLOQUEADA del tenant piloto)
// borren datos reales del entorno de desarrollo.
//
// Si `.env.test` no existe (p. ej. CI con DATABASE_URL ya inyectada), cae a `.env`.
import { existsSync } from 'fs';
import { config } from 'dotenv';

const envTest = `${__dirname}/.env.test`;
const envDefault = `${__dirname}/.env`;

config({ path: existsSync(envTest) ? envTest : envDefault, quiet: true });
