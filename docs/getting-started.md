# Guía de Arranque — Slotify

> Onboarding reproducible para nuevos colaboradores y agentes. Descripción de arquitectura en [architecture.md](./architecture.md); comandos avanzados y flujo de trabajo en [development_guide.md](./development_guide.md).

---

## Prerrequisitos

| Herramienta | Versión mínima | Notas |
|---|---|---|
| Node.js | 20 LTS | Verificar con `node -v` |
| pnpm | 9 | Verificar con `pnpm -v`; instalar con `npm i -g pnpm` |
| Docker + Docker Compose | Cualquier versión reciente | Para PostgreSQL 15 en local |
| Git | Cualquier versión reciente | |

---

## Setup inicial (paso a paso)

### 1. Clonar e instalar dependencias

```bash
git clone <url-del-repo>
cd slotify
pnpm install
```

Esto instala las dependencias de todos los workspaces (`apps/api`, `apps/web`) en un único paso gracias a pnpm workspaces + Turborepo.

### 2. Copiar variables de entorno

```bash
cp .env.example .env
```

El fichero `.env.example` en la raíz del repositorio contiene todas las variables con valores de desarrollo. Edita `.env` solo si necesitas cambiar puertos o credenciales locales. **Nunca commitees `.env`.**

Variables principales:

| Variable | Valor por defecto | Descripción |
|---|---|---|
| `DATABASE_URL` | `postgresql://user:password@localhost:5432/slotify_dev` | Cadena de conexión PostgreSQL |
| `JWT_ACCESS_SECRET` | `changeme-access-secret` | Secreto JWT de acceso (≥ 32 chars en producción) |
| `JWT_REFRESH_SECRET` | `changeme-refresh-secret` | Secreto JWT de refresco |
| `JWT_ACCESS_EXPIRES_IN` | `15m` | TTL del access token |
| `JWT_REFRESH_EXPIRES_IN` | `7d` | TTL del refresh token |
| `API_PORT` | `3000` | Puerto de la API |
| `WEB_URL` | `http://localhost:5173` | Origen de la SPA (CORS) |
| `NODE_ENV` | `development` | |
| `RESEND_API_KEY` | `re_xxxx` | API key de Resend (email transaccional) |
| `EMAIL_FROM` | `hola@slotify.app` | Remitente de emails |
| `STORAGE_BUCKET_URL` | `https://xxxxx.supabase.co/...` | Storage de ficheros |
| `STORAGE_SERVICE_KEY` | `changeme` | Clave del storage |

### 3. Arrancar PostgreSQL (Docker)

```bash
docker compose up -d postgres
```

PostgreSQL 15 quedará disponible en `localhost:5432`. Base de datos: `slotify_dev` (según `DATABASE_URL`).

### 4. Aplicar migraciones

```bash
pnpm db:migrate
```

Aplica la migración inicial desde la raíz del monorepo. Incluye RLS (`ENABLE ROW LEVEL SECURITY` + `CREATE POLICY`) e índice full-text GIN sobre `reserva`.

### 5. Sembrar datos iniciales

```bash
pnpm db:seed
```

Crea el tenant piloto **Masia l'Encís** con:
- `TenantSettings`: señal 40%, fianza 500€, TTLs de consulta 3 días / pre-reserva 7 días / visita 7 días.
- Gestor: `gestor@masiallencis.com` (contraseña hasheada con argon2; ver seed para el valor de desarrollo).
- 12 filas de `TemporadaCalendario` (meses 1–12 mapeados a temporada alta/media/baja).
- 45 tarifas (3 temporadas × 3 duraciones × 5 tramos de invitados), vigentes desde `2026-01-01`.
- 2 extras de catálogo.

### 6. Arrancar en desarrollo

```bash
pnpm dev
```

Turborepo lanza en paralelo:
- **API** (`apps/api`): `http://localhost:3000/api` — Swagger en `http://localhost:3000/api/docs`
- **Web** (`apps/web`): `http://localhost:5173` — ruta inicial `/login`

---

## Scripts del monorepo

Todos se ejecutan desde la raíz del repositorio y son delegados por Turborepo a los workspaces correspondientes.

| Script | Qué hace |
|---|---|
| `pnpm dev` | Arranca API y Web en modo watch (paralelo) |
| `pnpm build` | Build de producción de API y Web |
| `pnpm test` | Tests unitarios: Jest (API) + Vitest (Web) + test de arquitectura hexagonal (dependency-cruiser) |
| `pnpm test:e2e` | Tests e2e: Supertest con BD (API) + Playwright (Web) |
| `pnpm lint` | ESLint en todos los workspaces |
| `pnpm typecheck` | `tsc --noEmit` en todos los workspaces |
| `pnpm db:migrate` | `prisma migrate dev` en `apps/api` |
| `pnpm db:seed` | `prisma db seed` en `apps/api` |
| `pnpm generate-client` | Genera el cliente HTTP type-safe desde `docs/api-spec.yml` → `apps/web/src/api-client/` |

---

## Gate de calidad

Antes de cada commit deben pasar los cuatro gates:

```bash
pnpm lint && pnpm typecheck && pnpm test
```

El script `pnpm test` integra tres suites:
1. **Jest** (API): tests unitarios de módulos NestJS (smoke tests por módulo, guard 401, ConfigModule zod).
2. **Vitest** (Web): smoke test del frontend.
3. **dependency-cruiser** (`pnpm arch` dentro de `apps/api`): bloquea imports de `infrastructure/`, `prisma/` o decoradores de `@nestjs/*` en cualquier fichero bajo `domain/`. Falla con exit 1 ante cualquier violación.

### Test de concurrencia del bloqueo atómico

El test de concurrencia verifica la garantía central de no-doble-reserva:

```bash
# Solo el test de concurrencia (requiere BD activa)
pnpm --filter @slotify/api test:e2e -- --testPathPattern=fecha-bloqueada-concurrencia
```

Dos transacciones simultáneas sobre la misma `(tenant_id, fecha)` deben resultar en exactamente 1 éxito y 1 error `P2002` (violación de `UNIQUE(tenant_id, fecha)`). Ver [backend-standards.md](./backend-standards.md) para la implementación de `bloquearFecha()`.

---

## Generar/regenerar el cliente API

El cliente HTTP del frontend se genera desde el contrato OpenAPI; **nunca se edita a mano**:

```bash
pnpm generate-client
```

Genera `apps/web/src/api-client/schema.d.ts`, `client.ts` e `index.ts` a partir de `docs/api-spec.yml`. El dueño del contrato es el agente `contract-engineer` (ver [CLAUDE.md](../CLAUDE.md)).

---

## Estructura del monorepo

```
slotify/
├── apps/
│   ├── api/                 # Backend (NestJS + Prisma + PostgreSQL)
│   │   ├── prisma/          # schema.prisma, migraciones, seed.ts
│   │   └── src/             # Módulos hexagonales (domain/ + infrastructure/ + application/)
│   └── web/                 # Frontend SPA (Vite + React + Tailwind + shadcn/ui)
│       └── src/api-client/  # Cliente HTTP generado (no editar)
├── docs/                    # Documentación técnica (este directorio)
├── openspec/                # Changes OpenSpec (propuestas de contrato + tasks)
├── scripts/                 # Hooks de Claude Code
├── .env.example             # Variables de entorno (copiar a .env)
├── docker-compose.yml       # PostgreSQL 15 local
├── package.json             # Scripts raíz del monorepo
├── pnpm-workspace.yaml      # Definición de workspaces
└── turbo.json               # Pipelines de Turborepo
```

---

*Fichero creado en US-000 (setup scaffolding). Cualquier cambio en scripts o setup debe reflejarse aquí antes del PR.*
