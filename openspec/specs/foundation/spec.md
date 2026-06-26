# foundation Specification

## Purpose
TBD - created by archiving change us-000-setup-scaffolding. Update Purpose after archive.
## Requirements
### Requirement: Monorepo pnpm con scripts de ciclo de vida
El repositorio SHALL (DEBE) ser un monorepo pnpm-workspace con `apps/web` y `apps/api` como
paquetes reconocidos, y DEBE exponer los scripts `dev`, `build`, `test`, `test:e2e`,
`lint`, `typecheck`, `db:migrate`, `db:seed` y `generate-client`.
(Fuente: US-000 §Scripts de raíz, §Happy Path estructura.)

#### Scenario: Instalación limpia reconoce los paquetes
- **WHEN** se ejecuta `pnpm install` desde la raíz de un clon limpio
- **THEN** todas las dependencias se instalan sin errores
- **AND** el workspace reconoce `apps/web` y `apps/api` como paquetes

#### Scenario: Typecheck pasa en ambas apps
- **WHEN** se ejecuta `pnpm typecheck`
- **THEN** `tsc --noEmit` finaliza con 0 errores de tipado en `apps/web` y `apps/api`

### Requirement: Esquema Prisma con las 17 entidades y PKs UUID
`apps/api/prisma/schema.prisma` SHALL (DEBE) definir las 17 entidades del `er-diagram.md` y los
enums `EstadoReserva`, `SubEstadoConsulta` y `TipoBloqueo`. Ningún modelo PUEDE usar
`Int @id @default(autoincrement())`; toda PK DEBE ser `String @id @default(uuid())` o
`cuid()`. (Fuente: US-000 §Esquema Prisma, Regla 1, er-diagram decisión 6.)

#### Scenario: Migración aplica sin error
- **WHEN** se ejecuta `pnpm db:migrate` contra un PostgreSQL accesible
- **THEN** todas las migraciones se aplican sin error
- **AND** se crea el constraint `UNIQUE(tenant_id, fecha)` en `fecha_bloqueada`

#### Scenario: Ninguna PK es entero autoincremental
- **WHEN** se inspecciona `schema.prisma`
- **THEN** ningún modelo declara `Int @id @default(autoincrement())`
- **AND** toda PK usa `String @id` con `uuid()` o `cuid()`

### Requirement: Multi-tenancy con tenant_id y RLS
Toda tabla de negocio SHALL (DEBE) incluir `tenantId String` con FK a `Tenant`, y la migración
inicial DEBE habilitar Row-Level Security con una política por tabla usando
`current_setting('app.tenant_id')`. (Fuente: US-000 Regla 2, architecture §1 principio 2.)

#### Scenario: RLS habilitado en la migración inicial
- **WHEN** se aplican las migraciones
- **THEN** cada tabla de negocio tiene `ENABLE ROW LEVEL SECURITY`
- **AND** existe una `POLICY` que filtra por `current_setting('app.tenant_id')`

### Requirement: Bloqueo atómico de fecha desde la migración 0
El constraint `UNIQUE(tenant_id, fecha)` sobre `fecha_bloqueada` SHALL (DEBE) garantizar de
forma determinista que dos inserciones concurrentes de la misma `(tenant_id, fecha)`
no produzcan doble fila. (Fuente: US-000 §Concurrencia, architecture §2.4, er-diagram §3.6.)

#### Scenario: Dos transacciones concurrentes — una gana, otra falla
- **GIVEN** la migración inicial aplicada y al menos un `TENANT`
- **WHEN** dos transacciones concurrentes insertan la misma `(tenant_id, fecha)` en `fecha_bloqueada`
- **THEN** exactamente una tiene éxito
- **AND** la otra falla con violación de `UNIQUE(tenant_id, fecha)` (Prisma `P2002`)

### Requirement: Seed del tenant piloto Masia l'Encís
`apps/api/prisma/seed.ts` SHALL (DEBE) provisionar el tenant **Masia l'Encís** con sus datos
fiscales reales (`email_contacto=info@masialencis.com`, NIF `B10874287`, dirección de Sant
Martí Sarroca, `capacidad_maxima=50`), su `TENANT_SETTINGS` (`pct_senal=40`,
`fianza_default_eur=500`, `ttl_consulta_dias=3`, `ttl_prereserva_dias=7`,
`max_dias_programar_visita=7`), un `USUARIO` gestor (`info@masialencis.com`, Roger Vilà,
password argon2), 12 `TEMPORADA_CALENDARIO`, 45 `TARIFA` (`vigente_desde=2026-01-01`) y 2
`EXTRA` activos. Las 45 tarifas DEBEN ser los importes reales del dossier oficial (IVA
incluido) con tramos de invitados `1-20`, `21-25`, `26-30`, `31-40`, `41-50`; el tramo
`+51` ("a consultar") NO genera fila. (Fuente: US-000 §Seed; dossier oficial Masia l'Encís.)

#### Scenario: Seed crea los datos piloto
- **WHEN** se ejecuta `pnpm db:seed` tras migrar
- **THEN** existe el tenant "Masia l'Encís" con su gestor y `TENANT_SETTINGS`
- **AND** hay 45 `TARIFA`, 12 `TEMPORADA_CALENDARIO` y 2 `EXTRA` activos

#### Scenario: Reinsertar misma fecha bloqueada del piloto falla con P2002
- **GIVEN** el seed ejecutado
- **WHEN** se inserta un segundo `fecha_bloqueada` con el mismo `tenant_id` y `fecha`
- **THEN** Prisma lanza `PrismaClientKnownRequestError` con código `P2002`

### Requirement: Backend NestJS arrancable con validación de entorno
El backend SHALL (DEBE) arrancar con Swagger en `GET /api/docs`, `GET /api/health` devolviendo
`{ status: "ok" }`, `ValidationPipe` y `HttpExceptionFilter` globales, y un `ConfigModule`
que valide las variables de entorno con **zod** antes de inicializar el dominio. Todo
endpoint protegido sin token DEBE devolver `401`. (Fuente: US-000 §Backend arranca, edge cases.)

#### Scenario: Health y Swagger responden
- **WHEN** se arranca `apps/api` y se consulta `GET /api/health`
- **THEN** responde `{ status: "ok" }`
- **AND** `GET /api/docs` sirve la UI de Swagger

#### Scenario: Endpoint protegido sin token devuelve 401
- **WHEN** se llama a un endpoint protegido sin token
- **THEN** la respuesta es `401 Unauthorized`

#### Scenario: Arranque falla si falta una variable o el secreto JWT es débil
- **GIVEN** `DATABASE_URL` ausente o `JWT_ACCESS_SECRET` con menos de 32 caracteres
- **WHEN** se intenta arrancar el backend
- **THEN** la validación zod falla en el bootstrap con un mensaje explícito
- **AND** la aplicación no acepta peticiones

### Requirement: Frontend Vite+React sin persistencia de token en localStorage
`apps/web` SHALL (DEBE) servir la SPA con Tailwind activo y la ruta `/login` renderizando un
formulario shadcn. El scaffolding NO PUEDE inicializar persistencia de tokens en
`localStorage` ni `sessionStorage`; el access token vive en memoria de React.
(Fuente: US-000 §Frontend arranca, Regla 3.)

#### Scenario: /login renderiza el formulario
- **WHEN** se arranca `apps/web` y se navega a `/login`
- **THEN** se renderiza el formulario de autenticación con Tailwind activo

#### Scenario: Sin persistencia de token en almacenamiento del navegador
- **WHEN** se inspecciona el scaffolding del frontend
- **THEN** no existe middleware que escriba el access token en `localStorage` o `sessionStorage`

### Requirement: Cliente HTTP generado desde OpenAPI
El script `generate-client` (openapi-typescript) SHALL (DEBE) generar el cliente HTTP tipado en
`apps/web/src/api-client/` a partir del OpenAPI del backend. El cliente generado NO se
edita a mano. (Fuente: US-000 §Scripts, nota de alcance.)

#### Scenario: generate-client produce un cliente tipado
- **GIVEN** el backend en marcha exponiendo el OpenAPI
- **WHEN** se ejecuta `pnpm generate-client`
- **THEN** `apps/web/src/api-client/` contiene el cliente tipado sin errores de compilación

### Requirement: Puerta de calidad y arquitectura hexagonal verificable
`pnpm lint && pnpm typecheck && pnpm test` SHALL (DEBE) devolver exit 0. Un test de arquitectura
(dependency-cruiser) DEBE verificar que ningún import en `*/domain/**` referencie rutas
con `infrastructure`, `prisma`, `@nestjs` o librerías de terceros que no sean tipos puros.
(Fuente: US-000 Reglas 5 y 6, architecture §2.6.)

#### Scenario: La puerta de calidad pasa en verde
- **WHEN** se ejecuta `pnpm lint && pnpm typecheck && pnpm test`
- **THEN** el comando finaliza con código de salida 0

#### Scenario: Import de infra en domain falla el test de arquitectura
- **GIVEN** un import de `infrastructure`, `prisma` o `@nestjs` en `*/domain/**`
- **WHEN** se ejecuta el test de dependency-cruiser
- **THEN** el test falla señalando la violación de la regla de dependencia hexagonal

