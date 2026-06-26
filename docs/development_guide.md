# Guía de Desarrollo — Slotify

> Para el setup inicial (prerrequisitos, pasos de arranque paso a paso, tabla de scripts y gate de calidad) consulta [getting-started.md](./getting-started.md). Esta guía documenta el flujo de trabajo diario, la estructura de módulos y las convenciones de testing.

La arquitectura de referencia está en [architecture.md](./architecture.md): un **monolito modular** en un único monorepo con dos aplicaciones (`apps/web` y `apps/api`) y una única base de datos PostgreSQL.

## 🧱 Estructura del monorepo

```
slotify/
├── apps/
│   ├── web/                 # Frontend SPA (Vite + React + TypeScript)
│   └── api/                 # Backend (NestJS + Prisma)
├── packages/                # (opcional) código compartido (tipos, cliente OpenAPI generado)
├── docs/                    # Documentación técnica (este directorio)
├── package.json             # Workspaces del monorepo
└── pnpm-workspace.yaml       # Definición de workspaces (pnpm)
```

> El frontend se publica como **estáticos en un CDN**; el backend corre como **proceso vivo** contra PostgreSQL. Ambos salen del mismo monorepo pero despliegan a destinos distintos.

## 🚀 Puesta en marcha

### Requisitos previos

Asegúrate de tener instalado:
- **Node.js** (v20 LTS o superior)
- **pnpm** (v9 o superior) — gestor de paquetes del monorepo
- **Docker** y **Docker Compose** (para PostgreSQL en local)
- **Git**

### 1. Clonar el repositorio

```bash
git clone <url-del-repo-slotify>
cd slotify
pnpm install        # instala dependencias de todos los workspaces
```

### 2. Configuración de variables de entorno

**Backend** (`apps/api/.env`):
```env
# Base de datos
DATABASE_URL="postgresql://slotify:slotify@localhost:5432/slotify?schema=public"

# Aplicación
PORT=3000
NODE_ENV=development

# CORS: origen permitido de la SPA
CORS_ORIGIN=http://localhost:5173

# Autenticación JWT
JWT_ACCESS_SECRET=<secreto-de-desarrollo>
JWT_ACCESS_TTL=15m
JWT_REFRESH_SECRET=<secreto-refresh-de-desarrollo>
JWT_REFRESH_TTL=7d

# Endpoint de barrido del cron (token de servicio)
CRON_TOKEN=<token-de-servicio>

# Email transaccional (Resend/Postmark)
EMAIL_API_KEY=<api-key>
EMAIL_FROM="reservas@tu-espacio.com"

# Storage de ficheros (Supabase Storage / Railway)
STORAGE_BUCKET=slotify-docs
STORAGE_URL=<url-storage>
STORAGE_KEY=<key-storage>
```

**Frontend** (`apps/web/.env`):
```env
VITE_API_URL=http://localhost:3000/api
```

> Nunca se commitean ficheros `.env` ni secretos. En producción se usan variables de entorno cifradas del hosting (ver [architecture.md §5](./architecture.md)).

### 3. Base de datos (PostgreSQL con Docker)

```bash
# Arrancar solo el servicio de PostgreSQL
docker compose up -d postgres

# Verificar que está corriendo
docker compose ps
```

PostgreSQL 15 quedará disponible en `localhost:5432`. Base de datos: `slotify_dev` (según `DATABASE_URL` en `.env`).

### 4. Migraciones y seed (desde la raíz)

```bash
# Aplicar migraciones
pnpm db:migrate

# Sembrar datos iniciales (tenant Masia l'Encís, 12 temporadas, 45 tarifas, 2 extras, gestor)
pnpm db:seed
```

La API quedará disponible en `http://localhost:3000/api`.
La documentación OpenAPI/Swagger en `http://localhost:3000/api/docs`.

> **Aprovisionamiento del gestor:** en el MVP hay un único gestor por tenant, creado por el *seed* (no hay UI de alta de usuarios). Ver [architecture.md §2.8](./architecture.md).

### 5. Arrancar frontend y backend

```bash
# Desde la raíz — arranca ambas apps en paralelo
pnpm dev

# (Opcional) regenerar el cliente HTTP type-safe desde el contrato OpenAPI
pnpm generate-client
```

La SPA quedará disponible en `http://localhost:5173`.

### 6. Cron de barrido (TTLs y cola) en local

El barrido de TTLs y la promoción de cola corren como tarea programada del backend (NestJS Scheduler). En local se ejecutan automáticamente con el backend en marcha. También puede invocarse manualmente el endpoint protegido:

```bash
curl -X POST http://localhost:3000/api/cron/barrido -H "X-Cron-Token: <token-de-servicio>"
```

## 🧪 Testing

El orden TDD lo impone la arquitectura: **primero los tests de concurrencia del núcleo crítico** (bloqueo atómico, promoción de cola), antes que UI o CRUD.

### Desde la raíz (recomendado)

```bash
pnpm test                 # Jest (API) + Vitest (Web) + dependency-cruiser (arch)
pnpm test:e2e             # Supertest con BD (API) + Playwright (Web)
```

### Por workspace (para desarrollo focado)

```bash
# Backend
pnpm --filter @slotify/api test          # tests unitarios (Jest)
pnpm --filter @slotify/api test:e2e      # Supertest con BD real

# Frontend
pnpm --filter @slotify/web test          # Vitest + Testing Library
pnpm --filter @slotify/web test:e2e      # Playwright
```

> Los tests de concurrencia del bloqueo de fecha verifican que la restricción `UNIQUE(tenant_id, fecha)` produce exactamente un éxito y un `P2002`, sin ventana de carrera. Ver [getting-started.md §Gate de calidad](./getting-started.md).

## 🔁 Flujo de trabajo

- Crea una rama `feature/<nombre>` antes de cualquier cambio (ver [openspec-tasks-mandatory-steps.md](./openspec-tasks-mandatory-steps.md)).
- Mantén las ramas pequeñas y enfocadas.
- Ejecuta lint, type-check y tests antes de cada commit:
  ```bash
  pnpm lint && pnpm typecheck && pnpm test
  ```
- Actualiza la documentación afectada antes de hacer push (ver [documentation-standards.md](./documentation-standards.md)).
