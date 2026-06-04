# Guía de Desarrollo — Slotify

Esta guía explica, paso a paso, cómo poner en marcha el entorno de desarrollo y ejecutar los tests de Slotify. La arquitectura de referencia está en [architecture.md](./architecture.md): un **monolito modular** en un único monorepo con dos aplicaciones (`apps/web` y `apps/api`) y una única base de datos PostgreSQL.

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
# Arrancar PostgreSQL
docker compose up -d

# Verificar que está corriendo
docker compose ps
```

PostgreSQL quedará disponible en:
- **Host**: `localhost`
- **Puerto**: `5432`
- **Base de datos**: `slotify`
- **Usuario / Contraseña**: `slotify` / `slotify` (solo desarrollo)

### 4. Backend (`apps/api`)

```bash
cd apps/api

# Generar el cliente Prisma
pnpm prisma generate

# Aplicar migraciones
pnpm prisma migrate deploy        # o `pnpm prisma migrate dev` en desarrollo

# Sembrar datos iniciales (tenant + gestor único + tarifario base)
pnpm prisma db seed

# Arrancar el servidor de desarrollo (hot reload)
pnpm start:dev
```

La API quedará disponible en `http://localhost:3000/api`.
La documentación OpenAPI/Swagger en `http://localhost:3000/api/docs`.

> **Aprovisionamiento del gestor:** en el MVP hay un único gestor por tenant, creado por el *seed* (no hay UI de alta de usuarios). Ver [architecture.md §2.8](./architecture.md).

### 5. Frontend (`apps/web`)

```bash
cd apps/web

# (Opcional) regenerar el cliente HTTP type-safe desde el contrato OpenAPI
pnpm generate:api

# Arrancar el servidor de desarrollo
pnpm dev
```

La SPA quedará disponible en `http://localhost:5173`.

### 6. Cron de barrido (TTLs y cola) en local

El barrido de TTLs y la promoción de cola corren como tarea programada del backend (NestJS Scheduler). En local se ejecutan automáticamente con el backend en marcha. También puede invocarse manualmente el endpoint protegido:

```bash
curl -X POST http://localhost:3000/api/cron/barrido -H "X-Cron-Token: <token-de-servicio>"
```

## 🧪 Testing

El orden TDD lo impone la arquitectura: **primero los tests de concurrencia del núcleo crítico** (bloqueo atómico, promoción de cola), antes que UI o CRUD.

### Backend (`apps/api`)

```bash
cd apps/api

pnpm test                 # tests unitarios (Jest)
pnpm test:watch           # modo watch
pnpm test:cov             # cobertura
pnpm test:e2e             # tests de integración/e2e (Supertest, base de datos de test)
```

> Los tests de concurrencia del bloqueo de fecha usan transacciones simultáneas para verificar que la restricción `UNIQUE(tenant_id, fecha)` produce exactamente un éxito y un conflicto, sin ventana de carrera.

### Frontend (`apps/web`)

```bash
cd apps/web

pnpm test                 # tests unitarios/de componentes (Vitest + Testing Library)
pnpm test:e2e             # tests end-to-end (Playwright)
```

## 🔁 Flujo de trabajo

- Crea una rama `feature/<nombre>` antes de cualquier cambio (ver [openspec-tasks-mandatory-steps.md](./openspec-tasks-mandatory-steps.md)).
- Mantén las ramas pequeñas y enfocadas.
- Ejecuta lint, type-check y tests antes de cada commit:
  ```bash
  pnpm lint && pnpm typecheck && pnpm test
  ```
- Actualiza la documentación afectada antes de hacer push (ver [documentation-standards.md](./documentation-standards.md)).
