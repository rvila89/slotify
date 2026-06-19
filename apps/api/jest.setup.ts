// Carga variables de entorno (DATABASE_URL) para los tests de integración.
// Apunta al Postgres del docker-compose (servicio `postgres:15`).
import { config } from 'dotenv';
config({ path: `${__dirname}/.env`, quiet: true });
