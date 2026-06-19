---
id: US-000
estado: backlog
branch: null
pr: null
---

# 🧾 Historia de Usuario: Setup y Scaffolding del Monorepo

## 🆔 Metadatos
- ID: US-000
- Área funcional: **Infraestructura / Fundación técnica** (prerequisito transversal a las 12 áreas funcionales)
- Módulo: Transversal — habilita M1–M10 y la capa de Auth/Infraestructura descrita en `architecture.md §2`
- Prioridad: **Crítica** — ninguna otra historia puede iniciarse sin este scaffolding
- Alcance MVP: ✅ Implementado
- Estado: Borrador
- Owner: Tech Lead / Senior Arquitecto

> **Nota de tipo:** US-000 es una **historia de infraestructura técnica** (Technical Foundation Story). No está anclada en ninguno de los 36 UC funcionales (que modelan comportamiento de usuario), sino en `architecture.md §2` y `er-diagram.md` como la base estructural que los habilita. Su valor es habilitar la construcción de todas las demás historias: sin este scaffolding, ningún test puede ejecutarse, ninguna migración puede aplicarse y ninguna US puede desarrollarse. Se incluye en el contador de cobertura como US-000 (fuera de la numeración UC-01/UC-36).

---

## 🎯 Historia

**Como** equipo de desarrollo (Gestor del producto + Senior Arquitecto)  
**Quiero** tener un monorepo funcional con el scaffolding completo del backend NestJS (arquitectura hexagonal), el frontend Vite+React, el esquema de base de datos PostgreSQL con todas las entidades del dominio y el seed de datos del tenant piloto  
**Para** poder desarrollar, testear y desplegar cualquiera de las 46 historias de usuario del MVP sin fricción técnica, garantizando type-safety end-to-end, el contrato OpenAPI como fuente de verdad y el bloqueo atómico de fecha como garantía de no-doble-reserva desde el primer commit

---

## 🧠 Contexto de Negocio

- Caso(s) de uso: ninguno (historia de infraestructura — habilita UC-01 a UC-36)
- Entidades implicadas: **todas** las del `er-diagram.md`: `TENANT`, `TENANT_SETTINGS`, `USUARIO`, `CLIENTE`, `RESERVA`, `FECHA_BLOQUEADA`, `TARIFA`, `TEMPORADA_CALENDARIO`, `EXTRA`, `RESERVA_EXTRA`, `PRESUPUESTO`, `FACTURA`, `PAGO`, `FICHA_OPERATIVA`, `DOCUMENTO`, `COMUNICACION`, `AUDIT_LOG`
- Dolor(es) que resuelve:
  - **D1** — La existencia de un monorepo con single source of truth técnico (schema Prisma, tipos OpenAPI, seed) elimina la desincronización entre capas
  - **D4** — El constraint `UNIQUE(tenant_id, fecha)` en `FECHA_BLOQUEADA` se provisiona desde la primera migración; la garantía de no-doble-reserva está activa desde el día 0
- Automatización relacionada: ninguna (prerequisito estructural)
- Email relacionado: ninguno
- Reglas de negocio relevantes para el setup:
  - `UNIQUE(tenant_id, fecha)` sobre `FECHA_BLOQUEADA` — constraint de BD, no lógica aplicativa (`architecture.md §2.4`, `er-diagram.md §3.6`)
  - Row-Level Security (RLS) activo en PostgreSQL; `tenant_id` presente en toda tabla de negocio (`architecture.md §1 principio 2`)
  - La regla de dependencia hexagonal es inviolable: `domain/` no importa de `infrastructure/` ni de frameworks (`architecture.md §2.6`)
  - Todas las PKs son UUID; ninguna tabla usa INT autoincremental (`er-diagram.md decisión 6`)
  - El access token JWT se guarda en memoria de la SPA, **nunca** en `localStorage`; el refresh token en cookie `httpOnly` (`architecture.md §2.8`)
  - El gestor del tenant piloto se crea vía seed/script, sin UI de registro (`architecture.md §2.8`)
  - `pnpm test` debe pasar (0 errores) como puerta para cualquier commit
- Supuestos:
  - Entorno local: Node.js ≥ 20 LTS, pnpm ≥ 9, PostgreSQL ≥ 15 (local o contenedor Docker)
  - El tenant piloto es **Masia l'Encís** con los datos de configuración descritos en `SlotifyGeneralSpecs.md §3.4`
  - Las variables de entorno sensibles (DATABASE_URL, JWT_SECRET, RESEND_API_KEY) se gestionan con `.env` local y `.env.example` versionado; los secretos nunca se comitean
- Dependencias: ninguna (US-000 es el punto de partida absoluto del proyecto)
- Notas de alcance:
  - El despliegue en Railway/Render queda fuera de US-000 (CI/CD de producción es post-scaffolding)
  - La generación del cliente HTTP del frontend a partir del OpenAPI se deja como tarea de US-000 solo en su forma inicial (script `generate-client`); el cliente generado se usa desde US-001 en adelante
  - Las políticas RLS detalladas (enable + policy per tabla) se definen en la migración inicial pero su verificación funcional se valida en las US de cada módulo (donde hay datos multi-tenant reales)

---

## 🏗️ Especificación Técnica de Arquitectura (complemento del Arquitecto Senior)

> Esta sección extiende la plantilla estándar con el detalle técnico necesario para que un desarrollador pueda ejecutar US-000 sin ambigüedad. Es normativa, no sugerencia.

### Estructura de directorios objetivo

```
slotify/                            ← raíz del monorepo
├── package.json                    ← pnpm workspace root
├── pnpm-workspace.yaml
├── .env.example                    ← variables requeridas, sin valores
├── .gitignore
├── turbo.json                      ← (opcional) Turborepo para tareas en paralelo
│
├── apps/
│   ├── web/                        ← SPA Vite + React
│   │   ├── package.json
│   │   ├── vite.config.ts
│   │   ├── tsconfig.json
│   │   ├── tailwind.config.ts
│   │   ├── index.html
│   │   └── src/
│   │       ├── main.tsx
│   │       ├── App.tsx
│   │       ├── api-client/         ← cliente HTTP generado desde OpenAPI
│   │       ├── components/
│   │       ├── pages/
│   │       └── lib/
│   │
│   └── api/                        ← Backend NestJS
│       ├── package.json
│       ├── tsconfig.json
│       ├── tsconfig.build.json
│       ├── nest-cli.json
│       ├── jest.config.ts
│       ├── prisma/
│       │   ├── schema.prisma       ← esquema completo todas las entidades
│       │   ├── migrations/         ← migraciones versionadas
│       │   └── seed.ts             ← datos piloto Masia l'Encís
│       └── src/
│           ├── main.ts             ← bootstrap (Swagger, CORS, pipes globales)
│           ├── app.module.ts
│           │
│           ├── shared/             ← utilidades transversales (no dominio)
│           │   ├── filters/        ← HttpExceptionFilter global
│           │   ├── guards/         ← JwtAuthGuard, RolesGuard
│           │   ├── decorators/     ← @CurrentUser, @TenantId
│           │   └── pipes/          ← ValidationPipe global
│           │
│           ├── auth/               ← módulo de autenticación
│           │   ├── domain/
│           │   ├── application/
│           │   ├── infrastructure/
│           │   └── interface/
│           │
│           ├── reservas/           ← M1 — núcleo crítico
│           │   ├── domain/
│           │   │   ├── reserva.entity.ts
│           │   │   ├── reserva-estado.enum.ts
│           │   │   ├── maquina-estados.ts  ← tabla de transiciones declarativa
│           │   │   ├── reserva.repository.port.ts
│           │   │   └── events/
│           │   ├── application/
│           │   ├── infrastructure/
│           │   │   └── prisma-reserva.repository.ts
│           │   └── interface/
│           │       └── reservas.controller.ts
│           │
│           ├── calendario/         ← M2
│           ├── clientes/           ← M3
│           ├── presupuestos/       ← M4
│           ├── facturacion/        ← M5
│           ├── comunicaciones/     ← M6
│           ├── ficha-evento/       ← M7
│           ├── tareas/             ← M8
│           ├── dashboards/         ← M10
│           └── configuracion/     ← M11
│
└── docs/                           ← documentación del proyecto (ya existente)
```

### Esquema Prisma — entidades mínimas para US-000

El fichero `apps/api/prisma/schema.prisma` debe definir **todos** los modelos del `er-diagram.md`, incluyendo:

```prisma
// Constraint crítico anti-doble-reserva (er-diagram §3.6 + architecture §2.4)
model FechaBloqueada {
  idBloqueo     String    @id @default(uuid())
  tenantId      String
  fecha         DateTime  @db.Date
  reservaId     String
  tipoBloqueo   TipoBloqueo
  ttlExpiracion DateTime?

  tenant   Tenant   @relation(fields: [tenantId], references: [idTenant])
  reserva  Reserva  @relation(fields: [reservaId], references: [idReserva])

  @@unique([tenantId, fecha])   // ← GARANTÍA ATÓMICA ANTI-DOBLE-RESERVA
  @@map("fecha_bloqueada")
}
```

Enums críticos (vocabulario cerrado de `er-diagram.md`):
```prisma
enum EstadoReserva {
  consulta
  pre_reserva
  reserva_confirmada
  evento_en_curso
  post_evento
  reserva_completada
  reserva_cancelada
}

enum SubEstadoConsulta {
  s2a  // exploratoria
  s2b  // con fecha
  s2c  // pendiente invitados
  s2d  // en cola
  s2v  // visita programada
  s2x  // expirada (terminal)
  s2y  // descartada por cola (terminal)
  s2z  // descartada por cliente (terminal)
}

enum TipoBloqueo {
  blando
  firme
}
```

### Seed de datos del tenant piloto — Masia l'Encís

El seed debe provisionar exactamente:

| Entidad | Datos |
|---------|-------|
| `TENANT` | id conocido para tests, nombre "Masia l'Encís" |
| `TENANT_SETTINGS` | `pct_senal=40`, `fianza_default_eur=500`, `ttl_consulta_dias=3`, `ttl_prereserva_dias=7`, `max_dias_programar_visita=7` |
| `USUARIO` | email `gestor@masiallencis.com`, password hasheado (argon2), `rol=gestor` |
| `TEMPORADA_CALENDARIO` | Alta: meses 5–9; Media: 3,4,10,11; Baja: 12,1,2 (12 filas, una por mes) |
| `TARIFA` | 45 entradas (3 temporadas × 3 duraciones × 5 tramos invitados) con precios representativos; `vigente_desde=2026-01-01` |
| `EXTRA` | "Barbacoa" €30, "Paellero" €30, ambos activos |

### Variables de entorno requeridas (`.env.example`)

```
# Base de datos
DATABASE_URL="postgresql://user:password@localhost:5432/slotify_dev"

# JWT (usa secretos largos y aleatorios en producción)
JWT_ACCESS_SECRET="changeme-access-secret"
JWT_ACCESS_EXPIRES_IN="15m"
JWT_REFRESH_SECRET="changeme-refresh-secret"
JWT_REFRESH_EXPIRES_IN="7d"

# Email transaccional
RESEND_API_KEY="re_xxxx"
EMAIL_FROM="hola@slotify.app"

# Storage
STORAGE_BUCKET_URL="https://xxxxx.supabase.co/storage/v1"
STORAGE_SERVICE_KEY="changeme"

# App
API_PORT=3000
WEB_URL="http://localhost:5173"
NODE_ENV="development"
```

### Scripts de raíz (`package.json` del monorepo)

| Script | Comando | Propósito |
|--------|---------|-----------|
| `pnpm dev` | `turbo dev` o scripts paralelos | Levanta API + Web en modo desarrollo |
| `pnpm build` | `turbo build` | Construye ambas apps |
| `pnpm test` | `turbo test` | Ejecuta Jest (api) + Vitest (web) |
| `pnpm test:e2e` | `turbo test:e2e` | Tests de integración/concurrencia |
| `pnpm lint` | `turbo lint` | ESLint + Prettier |
| `pnpm typecheck` | `turbo typecheck` | `tsc --noEmit` en ambas apps |
| `pnpm db:migrate` | `prisma migrate dev` | Aplica migraciones en desarrollo |
| `pnpm db:seed` | `prisma db seed` | Ejecuta seed del tenant piloto |
| `pnpm generate-client` | `openapi-typescript-codegen ...` | Genera cliente HTTP del frontend desde OpenAPI |

---

## ✅ Criterios de Aceptación (BDD)

### 🎯 Happy Path — Estructura y compilación

- **Dado** que el repositorio ha sido clonado por primera vez  
  **Cuando** se ejecuta `pnpm install` desde la raíz del monorepo  
  **Entonces** todas las dependencias se instalan sin errores y el workspace reconoce `apps/web` y `apps/api` como paquetes

- **Dado** que las dependencias están instaladas  
  **Cuando** se ejecuta `pnpm typecheck`  
  **Entonces** `tsc --noEmit` pasa en ambas apps con 0 errores de tipado

- **Dado** que el entorno tiene un PostgreSQL accesible con `DATABASE_URL` configurado  
  **Cuando** se ejecuta `pnpm db:migrate`  
  **Entonces** todas las migraciones se aplican sin error, incluyendo la creación de `UNIQUE(tenant_id, fecha)` en `fecha_bloqueada` y las políticas RLS en todas las tablas de negocio

- **Dado** que las migraciones han sido aplicadas  
  **Cuando** se ejecuta `pnpm db:seed`  
  **Entonces** la base de datos contiene el tenant "Masia l'Encís" con su gestor, `TENANT_SETTINGS`, 45 entradas de `TARIFA`, 12 entradas de `TEMPORADA_CALENDARIO` y 2 `EXTRA` activos

### 🎯 Happy Path — Backend NestJS arranca

- **Dado** que las variables de entorno están configuradas  
  **Cuando** se ejecuta `pnpm dev` en `apps/api`  
  **Entonces** NestJS arranca en el puerto `API_PORT` sin errores de bootstrap, el endpoint `GET /api/docs` devuelve la UI de Swagger con todos los módulos documentados, y `GET /api/health` devuelve `{ status: "ok" }`

- **Dado** que el backend está en ejecución  
  **Cuando** se realiza una petición a cualquier endpoint protegido sin token  
  **Entonces** el sistema devuelve `401 Unauthorized`

### 🎯 Happy Path — Frontend Vite+React arranca

- **Dado** que las dependencias están instaladas  
  **Cuando** se ejecuta `pnpm dev` en `apps/web`  
  **Entonces** Vite sirve la SPA en `http://localhost:5173` sin errores, Tailwind está activo y la ruta `/login` renderiza el formulario de autenticación

- **Dado** que el script `generate-client` se ejecuta con el backend en marcha  
  **Cuando** el OpenAPI de `/api/docs-json` está disponible  
  **Entonces** el directorio `apps/web/src/api-client/` contiene el cliente HTTP generado, tipado y sin errores de compilación

### 🎯 Happy Path — Tests pasan en verde

- **Dado** que el monorepo está configurado  
  **Cuando** se ejecuta `pnpm test`  
  **Entonces** Jest ejecuta los tests unitarios del backend y Vitest los del frontend, con 0 fallos en la suite inicial (al menos un test de smoke por módulo presente en el esqueleto)

- **Dado** que el backend tiene la suite de tests de integración configurada  
  **Cuando** se ejecuta `pnpm test:e2e`  
  **Entonces** los tests de integración del módulo `auth` (login correcto, credenciales incorrectas) pasan en verde contra una base de datos de test aislada

### 🔒 Concurrencia / Race Conditions — Garantía atómica desde migración 0

- **Dado** que la migración inicial ha sido aplicada y existe al menos un `TENANT`  
  **Cuando** dos transacciones concurrentes intentan insertar la misma `(tenant_id, fecha)` en `fecha_bloqueada` de forma simultánea  
  **Entonces** exactamente una transacción tiene éxito (INSERT exitoso) y la otra falla con violación de restricción `UNIQUE(tenant_id, fecha)` de PostgreSQL — sin doble fila, sin race condition, garantía determinista desde la primera migración

  > Este test de concurrencia debe estar en `apps/api/src/reservas/__tests__/fecha-bloqueada-concurrencia.spec.ts` y ejecutarse como parte de `test:e2e`. Es el primer test que se escribe (TDD), antes de implementar ningún caso de uso.

- **Dado** que el seed ha sido ejecutado  
  **Cuando** se intenta insertar un segundo registro en `fecha_bloqueada` con el mismo `tenant_id` y `fecha` del tenant piloto  
  **Entonces** Prisma lanza `PrismaClientKnownRequestError` con código `P2002` (unique constraint violation)

### ⚠️ Flujos Alternativos y Edge Cases

#### Variables de entorno faltantes

- **Dado** que `DATABASE_URL` no está definida  
  **Cuando** se intenta arrancar el backend  
  **Entonces** la aplicación falla en el bootstrap con un mensaje explícito indicando qué variable falta (validación con `@nestjs/config` + `Joi` o `zod`)
  - Comportamiento del sistema: la validación de variables de entorno se ejecuta en el módulo de configuración antes de que el módulo de dominio se inicialice; nunca arranca con configuración incompleta

#### JWT_SECRET débil o ausente

- **Dado** que `JWT_ACCESS_SECRET` está vacío o es menor de 32 caracteres  
  **Cuando** arranca el módulo de Auth  
  **Entonces** la aplicación lanza excepción en startup y no acepta peticiones
  - Comportamiento del sistema: la validación de longitud mínima del secreto se aplica en el módulo de configuración

#### Migraciones pendientes en arranque

- **Dado** que hay migraciones no aplicadas  
  **Cuando** arranca el backend en modo desarrollo  
  **Entonces** el sistema loguea una advertencia clara indicando migraciones pendientes (Prisma `migrate status`)

#### Schema drift — modelo de dominio vs. esquema Prisma

- **Dado** que un desarrollador modifica `schema.prisma` sin crear una migración  
  **Cuando** se ejecuta `pnpm typecheck` o `pnpm test`  
  **Entonces** Prisma detecta el drift y el pipeline de CI falla antes de poder commitear código con inconsistencias

### 🚫 Reglas de Validación

- **Regla 1 — PKs UUID:** ningún modelo en `schema.prisma` puede usar `Int @id @default(autoincrement())`. Todos deben usar `String @id @default(uuid())` o `@default(cuid())`.
- **Regla 2 — tenant_id obligatorio:** toda tabla de negocio (RESERVA, CLIENTE, FACTURA, PRESUPUESTO, etc.) tiene un campo `tenantId String` con FK a `Tenant`. Las tablas de soporte (AUDIT_LOG, COMUNICACION) también incluyen `tenantId` directo o vía relación.
- **Regla 3 — No `localStorage` en el frontend:** el scaffolding del frontend no debe inicializar ningún middleware de persistencia de tokens en `localStorage` o `sessionStorage`. El access token vive en el estado de React (memoria).
- **Regla 4 — Secrets en `.env.example`, no en código:** ningún valor sensible (contraseña, API key, JWT secret) puede aparecer en archivos versionados que no sean `.env.example` (con valores placeholder).
- **Regla 5 — Puerta de calidad:** `pnpm lint && pnpm typecheck && pnpm test` debe pasar con código 0. Este comando se convierte en la puerta de CI para todo el proyecto.
- **Regla 6 — Arquitectura hexagonal verificable:** en `apps/api`, ningún import en `*/domain/**` puede referenciar rutas que contengan `infrastructure`, `prisma`, `@nestjs`, o librerías de terceros que no sean tipos puros. Un test de arquitectura con `dependency-cruiser` o similar puede verificar esto de forma automatizada.

---

## 📊 Impacto de Negocio

- **Impacto esperado:** permite iniciar el desarrollo de las 46 US funcionales en paralelo por módulos, con type-safety end-to-end garantizada, sin fricciones técnicas de setup y con la garantía atómica de no-doble-reserva activa desde el primer deploy — incluso antes de implementar ninguna UI
- **Criterio de éxito:** `pnpm install && pnpm db:migrate && pnpm db:seed && pnpm typecheck && pnpm test` ejecutado por cualquier miembro del equipo en un entorno limpio devuelve código de salida 0 en menos de 5 minutos

---