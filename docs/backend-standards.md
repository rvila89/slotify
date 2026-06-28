---
description: Estándares, buenas prácticas y convenciones del backend de Slotify (NestJS + TypeScript + Prisma) incluyendo arquitectura hexagonal, DDD, multi-tenancy con RLS, bloqueo atómico de fechas, diseño de API con OpenAPI, seguridad y testing.
globs: ["apps/api/src/**/*.ts", "apps/api/prisma/**/*.{prisma,ts}", "apps/api/test/**/*.ts", "apps/api/tsconfig.json", "apps/api/package.json"]
alwaysApply: true
---

# Estándares y buenas prácticas del Backend — Slotify

## Índice

- [Visión general](#visión-general)
- [Stack tecnológico](#stack-tecnológico)
- [Arquitectura](#arquitectura)
  - [Hexagonal + DDD + capas](#hexagonal--ddd--capas)
  - [Organización por módulos de dominio](#organización-por-módulos-de-dominio)
  - [Estructura de carpetas](#estructura-de-carpetas)
- [El núcleo crítico: bloqueo atómico de fecha](#el-núcleo-crítico-bloqueo-atómico-de-fecha)
- [Máquina de estados de la reserva](#máquina-de-estados-de-la-reserva)
- [Multi-tenancy y RLS](#multi-tenancy-y-rls)
- [DDD: entidades, value objects, agregados, puertos](#ddd-entidades-value-objects-agregados-puertos)
- [Principios SOLID y DRY](#principios-solid-y-dry)
- [Convenciones de código](#convenciones-de-código)
- [Diseño de la API (OpenAPI)](#diseño-de-la-api-openapi)
- [Patrones de base de datos (Prisma)](#patrones-de-base-de-datos-prisma)
- [Autenticación y autorización](#autenticación-y-autorización)
- [Procesos asíncronos: cron y barrido](#procesos-asíncronos-cron-y-barrido)
- [Testing](#testing)
- [Seguridad](#seguridad)
- [Rendimiento](#rendimiento)
- [Flujo de desarrollo](#flujo-de-desarrollo)

---

## Visión general

El backend de Slotify es una API **NestJS + TypeScript** que aplica **arquitectura hexagonal (puertos y adaptadores) + DDD + capas**. Es la pieza `apps/api` del monorepo, corre como **proceso vivo** contra una **única base de datos PostgreSQL** y expone su contrato vía **OpenAPI/Swagger**. La decisión de fondo (ver [architecture.md](./architecture.md)) es: un solo backend de dominio y una sola base de datos transaccional, lo que preserva las transacciones ACID nativas que protegen el bloqueo atómico de fecha.

**Lenguaje:** dominio en español (ver [base-standards.md §2](./base-standards.md)); andamiaje de NestJS/Prisma en su forma nativa; comentarios y mensajes de error en español.

## Stack tecnológico

| Capa | Tecnología | Notas |
|---|---|---|
| Runtime | Node.js 20 LTS | |
| Lenguaje | TypeScript (strict) | `any` prohibido salvo justificación |
| Framework | NestJS | Módulos, DI, guards, pipes, interceptors |
| ORM | Prisma | Migraciones controladas; `$transaction` y `$queryRaw` para `SELECT ... FOR UPDATE` |
| Base de datos | PostgreSQL (gestionada) | RLS multi-tenant, `UNIQUE(tenant_id, fecha)`, FTS |
| Auth | `@nestjs/passport` + `@nestjs/jwt` + Passport | Estrategias `local` y `jwt`; bcrypt/argon2 |
| Validación | `class-validator` + `class-transformer` | En DTOs de la capa interface |
| Documentación | `@nestjs/swagger` | Contrato OpenAPI = fuente del cliente del front |
| Jobs | `@nestjs/schedule` (cron) | Barrido idempotente de TTLs y cola |
| PDF | Puppeteer (plantillas HTML) o `react-pdf` | Presupuestos y facturas |
| Email | Resend / Postmark (SDK) | Plantillas E1–E8 |
| Storage | Supabase Storage / Railway | PDFs y justificantes |
| Observabilidad | Sentry | Captura de errores |
| Testing | Jest + Supertest | Unitario + integración/e2e |

## Arquitectura

### Hexagonal + DDD + capas

Cada módulo de dominio se organiza en cuatro capas con una **regla de dependencia estricta**: el dominio no importa nada de infraestructura ni del framework.

```
<modulo>/
  domain/           Entidades, value objects, eventos de dominio, PUERTOS (interfaces)
  application/      Casos de uso (orquestan el dominio; un caso de uso ≈ un UC)
  infrastructure/   ADAPTADORES: repositorios Prisma, email, PDF, storage
  interface/        Controladores HTTP + DTOs + documentación OpenAPI
```

- **`domain`** no depende de NestJS, Prisma ni servicios externos: depende solo de sus propios puertos. Esto lo hace testeable de forma aislada (TDD).
- **`application`** orquesta el dominio. Los casos de uso reciben los puertos por inyección de dependencias.
- **`infrastructure`** implementa los puertos (adaptadores). Aquí vive Prisma.
- **`interface`** traduce HTTP ↔ casos de uso; valida con DTOs y documenta con decoradores Swagger.

### Organización por módulos de dominio

Módulos alineados con los componentes de [c4-diagrams.md](./c4-diagrams.md) (no por capas técnicas globales). Un módulo llama a otro **solo a través de su interfaz pública**.

| Módulo | Responsabilidad | UC |
|---|---|---|
| `auth` | Login, refresh, guards de rol/tenant | UC-01, UC-02 |
| `reservas` | **Core.** Ciclo de vida de la reserva, máquina de estados, bloqueo atómico, cola | UC-03 a UC-13, UC-23 a UC-28 |
| `calendario` | Disponibilidad, bloqueo y liberación de fechas | UC-29 a UC-31 |
| `clientes` | Datos de contacto y fiscales | UC-03, UC-14 |
| `presupuestos` | Motor de tarifas + generación/versionado de PDF | UC-14 a UC-16 |
| `facturacion` | Facturas (señal, liquidación, fianza, complementaria), pagos, fianza | UC-17, UC-18, UC-21, UC-22, UC-26, UC-27 |
| `comunicaciones` | Motor `DespacharEmailService` (application) + puertos `EnviarEmailPort` y `CatalogoPlantillasPort` (domain) + adaptadores `ResendEmailAdapter`/`FakeEmailAdapter` (infra, US-045) + catálogo de plantillas (infra); idempotencia por índice UNIQUE parcial `(reserva_id, codigo_email) WHERE reserva_id IS NOT NULL`; trazabilidad en `COMUNICACION` y `AUDIT_LOG`. E1 activa; E2–E8 diseñadas/inactivas (cableado diferido). Ver [architecture.md §2.10](./architecture.md) | UC-03, UC-35, UC-36 |
| `ficha-operativa` | Briefing operativo del evento | UC-20, UC-24 |
| `dashboards` | KPIs operativos y financieros, exports | UC-32, UC-33, UC-34 |
| `configuracion` | Tarifario, plantillas, TTLs, festivos por tenant | Transversal |
| `cron` | Barrido idempotente de TTLs, cola y recordatorios | Transversal |

### Estructura de carpetas

```
apps/api/
├── src/
│   ├── reservas/
│   │   ├── domain/
│   │   │   ├── reserva.entity.ts
│   │   │   ├── maquina-estados.ts
│   │   │   ├── eventos/            # ReservaConfirmada, FechaBloqueada, ColaPromovida...
│   │   │   └── puertos/            # reserva.repository.ts (interface), ...
│   │   ├── application/
│   │   │   └── casos-uso/          # bloquear-fecha.use-case.ts, promover-cola.use-case.ts...
│   │   ├── infrastructure/
│   │   │   └── prisma-reserva.repository.ts
│   │   └── interface/
│   │       ├── reservas.controller.ts
│   │       └── dto/               # create-reserva.dto.ts, transicion.dto.ts...
│   ├── calendario/  ...           # misma estructura
│   ├── shared/                    # PrismaService, filtros de excepción, decoradores @TenantId...
│   ├── app.module.ts
│   └── main.ts                    # bootstrap, CORS, Swagger, ValidationPipe global
├── prisma/
│   ├── schema.prisma
│   ├── migrations/
│   └── seed.ts
└── test/                          # tests e2e (Supertest)
```

## El núcleo crítico: bloqueo atómico de fecha

Es la decisión técnica más importante (ver [architecture.md §2.4](./architecture.md)). **No usa locks distribuidos (Redis/Redlock)**: usa la garantía nativa de PostgreSQL.

- La entidad `FechaBloqueada` tiene `@@unique([tenant_id, fecha])`.
- Toda mutación pasa por **dos funciones transaccionales del dominio**: `bloquearFecha()` y `liberarFecha()`, que sincronizan la fila de `FechaBloqueada` y el estado de la `Reserva` en la **misma transacción**.
- Toda la mecánica de cola (promoción, reordenación, encadenamiento) se construye sobre ellas.

```ts
// infrastructure: adaptador Prisma del puerto BloqueoFechaPort
async bloquearFecha(tenantId: string, fecha: Date, reservaId: string, tipo: TipoBloqueo) {
  return this.prisma.$transaction(async (tx) => {
    // Serializa el acceso a la fecha dentro de la transacción
    await tx.$queryRaw`SELECT id_bloqueo FROM fecha_bloqueada
                       WHERE tenant_id = ${tenantId} AND fecha = ${fecha} FOR UPDATE`;
    // La restricción UNIQUE(tenant_id, fecha) garantiza atomicidad:
    // dos transacciones concurrentes -> un insert OK y una violación determinista.
    return tx.fechaBloqueada.create({
      data: { tenant_id: tenantId, fecha, reserva_id: reservaId, tipo_bloqueo: tipo },
    });
  });
}
```

- Una violación de unicidad (`P2002` de Prisma) se traduce a **HTTP 409** (doble reserva evitada), nunca a 500.
- **Los tests de concurrencia de estas funciones se escriben primero** (TDD), antes que cualquier CRUD o UI.

## Máquina de estados de la reserva

Las transiciones permitidas y sus guardas se modelan como **datos** (una tabla declarativa), consultados por una **única función de transición** — no como `if/else` dispersos.

```ts
// domain/maquina-estados.ts
type Transicion = { desde: EstadoReserva; hasta: EstadoReserva; guarda?: (r: Reserva) => boolean };

const TRANSICIONES: Transicion[] = [
  { desde: 'reserva_confirmada', hasta: 'evento_en_curso',
    guarda: (r) => r.preEventoStatus === 'cerrado'
                && r.liquidacionStatus === 'cobrada'
                && r.fianzaStatus === 'cobrada' },
  // ...
];

export function puedeTransicionar(reserva: Reserva, destino: EstadoReserva): boolean { /* ... */ }
```

- Las specs SDD se traducen casi 1:1 a esta tabla y a sus tests.
- Una transición inválida o con guarda no satisfecha devuelve **HTTP 422**.

## Multi-tenancy y RLS

- `tenant_id` está en toda entidad de negocio. **El `tenant_id` se deriva del JWT, nunca del path ni del body.**
- Un decorador/guard inyecta el `tenant_id` del usuario autenticado y la sesión configura el contexto de RLS de PostgreSQL (`SET LOCAL app.tenant_id = ...`).
- Toda consulta de repositorio filtra por `tenant_id`. Una entidad nunca referencia otra de un tenant distinto.

```ts
@Get()
listar(@TenantId() tenantId: string, @Query() filtros: ListarReservasDto) {
  return this.listarReservas.ejecutar(tenantId, filtros);
}
```

## DDD: entidades, value objects, agregados, puertos

- **Agregado raíz: `Reserva`.** Toda transición de estado, bloqueo y cola se modela alrededor de ella. Las operaciones que afectan a líneas (`ReservaExtra`), presupuestos o facturas pasan por el agregado o por casos de uso que mantienen las invariantes.
- **Entidades** tienen identidad (`id_*` UUID) y encapsulan reglas de negocio.
- **Value objects** (p. ej. `Importe`, `Tarifa` calculada, rango de fechas) se definen por sus atributos, sin identidad.
- **Puertos** = interfaces en `domain/puertos`. Ejemplos: `ReservaRepository`, `BloqueoFechaPort`, `EmailPort`, `PdfPort`, `StoragePort`. Los **adaptadores** los implementan en `infrastructure`.
- **Eventos de dominio** (`ReservaConfirmada`, `FechaBloqueada`, `ColaPromovida`) son la base de las automatizaciones.

```ts
// domain/puertos/reserva.repository.ts
export interface ReservaRepository {
  buscarPorId(tenantId: string, id: string): Promise<Reserva | null>;
  guardar(reserva: Reserva): Promise<Reserva>;
}
export const RESERVA_REPOSITORY = Symbol('ReservaRepository');
```

## Principios SOLID y DRY

- **SRP**: el controlador traduce HTTP; el caso de uso orquesta; el repositorio persiste. No mezclar.
- **DIP**: los casos de uso dependen de **puertos (interfaces)**, no de Prisma. Se inyectan vía tokens de DI de NestJS (`@Inject(RESERVA_REPOSITORY)`).
- **OCP**: la máquina de estados y el motor de tarifas se extienden por datos/configuración, no modificando código.
- **DRY**: cálculos de IVA, señal y congelación de precios viven en un único value object/servicio de dominio reutilizado.

## Convenciones de código

- **Identificadores de dominio en español** (`Reserva`, `bloquearFecha`, `fecha_evento`); andamiaje técnico en su forma nativa.
- **Clases/interfaces/DTOs**: `PascalCase` (`ReservaController`, `CreateReservaDto`).
- **Variables/funciones**: `camelCase` con verbo de negocio en español (`promoverCola`, `calcularTarifa`).
- **Constantes**: `UPPER_SNAKE_CASE` (`TTL_CONSULTA_DIAS_DEFAULT`).
- **Ficheros**: `kebab-case` con sufijo de rol (`reservas.controller.ts`, `bloquear-fecha.use-case.ts`, `reserva.entity.ts`).
- **Modelos Prisma**: `PascalCase` español con `@@map` a tabla `snake_case` (ver [data-model.md](./data-model.md)).
- **Comentarios y mensajes de error en español**:

```ts
throw new NotFoundException('No se encontró la reserva con el código indicado');
throw new ConflictException('La fecha ya está bloqueada');
```

## Diseño de la API (OpenAPI)

- **Recursos anidados bajo la reserva** cuando aplique (`/reservas/{id}/presupuestos`, `/reservas/{id}/facturas`). Las transiciones de estado se exponen como acción POST (`/reservas/{id}/transiciones`).
- **Métodos HTTP**: `GET` (leer), `POST` (crear/acción), `PATCH` (actualización parcial), `PUT` (upsert 1:1 como ficha), `DELETE` (liberar/borrar).
- **Prefijo global** `/api`. El `tenant_id` no aparece en las rutas (va en el JWT).
- **Documentación viva**: cada endpoint y DTO se anota con `@ApiOperation`, `@ApiResponse`, `@ApiProperty`. El contrato resultante debe coincidir con [api-spec.yml](./api-spec.yml) y es la fuente del cliente type-safe del frontend.
- **Formato de error estándar de NestJS** (alineado con `ErrorResponse` de la spec):

```json
{ "statusCode": 409, "message": "La fecha ya está bloqueada", "error": "Conflict" }
```

| Situación | Código |
|---|---|
| Validación de entrada fallida | 400 |
| No autenticado / token inválido / credenciales incorrectas | 401 |
| Recurso no encontrado en el tenant | 404 |
| Fecha ya bloqueada / colisión del `codigo` correlativo de `RESERVA` / todo conflicto UNIQUE (`P2002` → `HttpExceptionFilter` global → 409, nunca 500) | 409 |
| Transición de estado no permitida / guarda no satisfecha | 422 |
| Demasiados intentos de login (throttle self-contained, 5/60 s) | 429 |

## Patrones de base de datos (Prisma)

- `prisma/schema.prisma` es la **única fuente de verdad** de la estructura, consistente con [data-model.md](./data-model.md) y [er-diagram.md](./er-diagram.md).
- **Migraciones versionadas**: `prisma migrate dev --name <descriptivo>`; en producción `prisma migrate deploy`.
- **Patrón repositorio**: interfaz (puerto) en `domain`; implementación Prisma en `infrastructure`. `PrismaService` se inyecta, nunca se instancia un cliente global por entidad.
- **Importes** en `Decimal`, nunca `Float`.
- **Transacciones** (`prisma.$transaction`) para toda operación que toque bloqueo de fecha + estado de reserva.
- **Retry-on-conflict para correlativos:** la generación de códigos correlativos (`YY-NNNN`) usa `count(*)+1` dentro de la transacción; ante una colisión concurrente (`P2002` sobre el `@unique` del `codigo`), el adaptador reabre la `$transaction` y reintenta (hasta 3 intentos) en lugar de propagar el error. El segundo intento re-lee el `count` con el ganador ya confirmado y obtiene el siguiente correlativo sin colisión. Si se agotan los reintentos, el `P2002` se propaga al `HttpExceptionFilter` global → 409. Coherente con la filosofía del proyecto: PostgreSQL + UNIQUE, sin locks distribuidos.

## Autenticación y autorización

(Ver [architecture.md §2.8](./architecture.md) para la implementación completa y [architecture.md §2.9](./architecture.md) para la deuda técnica registrada.)

- **JWT access + refresh**. Access token de ~15 min (lo consume el front en memoria); refresh token de ~7 días en cookie `httpOnly + Secure + SameSite` (`path: '/api/auth'`), solo válido para `POST /auth/refresh`.
- `tenant_id` y `rol` van en el payload firmado del access token; el backend los extrae en cada petición para RLS y autorización. **Nunca se toman del path ni del body.**
- Contraseñas verificadas con **argon2** (coherente con el seed de Prisma). No usar bcrypt en esta implementación.
- Estrategia Passport: **`jwt`** (validación del access token). El login valida credenciales en `login.use-case.ts` sin estrategia `local` explícita de Passport.
- Guards: `JwtAuthGuard` global + `RolesGuard` por rol. En el MVP todos los usuarios tienen `rol = gestor`.
- **Anti-enumeration (OWASP A01):** el dominio lanza `CredencialesInvalidasError` para email inexistente, contraseña incorrecta y `activo=false`; el controlador lo traduce siempre a **401 genérico uniforme** con el mismo body. Los intentos fallidos **no** escriben en `AUDIT_LOG`; solo el login exitoso genera registro `login`.
- **Protección brute-force — throttler self-contained:** `LoginThrottleGuard` con `Map` en memoria del proceso, clave `IP+email` normalizada, ventana 5 intentos / 60 s → **429** genérico. No usa `@nestjs/throttler` ni Redis (ver DT-AUTH-03 en [architecture.md §2.9](./architecture.md) para la deuda de migración multi-instancia).
- **Módulo `auth` hexagonal:** `domain/` (entidad `Usuario`), `application/` (casos de uso + puertos, sin NestJS ni Prisma), `infrastructure/` (adaptadores Prisma/argon2/JWT), `interface/` (controlador HTTP + gestión de cookies). Cookie de refresh gestionada íntegramente en la capa `interface`.
- **`AuditLogPort` compartido:** interfaz pura en `shared/audit/audit-log.port.ts`, reutilizada por `auth` y `reservas` con un único adaptador Prisma genérico. Los módulos pueden estrechar el tipo de registro sin duplicar la interfaz.

## Procesos asíncronos: cron y barrido

(Ver [architecture.md §2.5](./architecture.md).)

- Patrón **estado en la fila + barrido periódico**, no timers exactos. Cada reserva con bloqueo blando lleva `ttl_expiracion`.
- `@nestjs/schedule` invoca el barrido cada N minutos; también se expone el endpoint protegido `POST /api/cron/barrido` (token `X-Cron-Token`) para disparadores externos.
- El barrido es **idempotente**: expira filas vencidas, libera fechas, promueve la cola y dispara recordatorios. Si el cron se retrasa o cae, al volver barre lo pendiente sin pérdida de consistencia.
- Trivial de testear: se llama a la función de barrido con una fecha simulada.

## Testing

Orden TDD impuesto por la arquitectura: **primero los tests del núcleo crítico**.

1. **Concurrencia del bloqueo atómico** (transacciones simultáneas → un OK + un 409), promoción de cola, encadenamiento, salida concurrente de cola (edge cases de la especificación).
2. **Máquina de estados**: cada transición permitida/prohibida y sus guardas.
3. **Motor de tarifas** y cálculos de IVA/señal/liquidación.
4. CRUD, controladores e integración.

- **Framework**: Jest (unitario) + Supertest (e2e contra base de datos de test).
- **Aislamiento del dominio**: los casos de uso se testean con **dobles de los puertos** (mocks de repositorios), sin tocar Prisma.
- **Patrón AAA** (Arrange-Act-Assert). Nombres descriptivos en español orientados a comportamiento: `debe_rechazar_segunda_reserva_cuando_fecha_ya_bloqueada`.
- **Concurrencia**: usar `Promise.allSettled()` para simular operaciones simultáneas.
- **Cobertura**: objetivo alto en `reservas` (núcleo). Reportes con `pnpm test:cov`.
- No usar conexiones reales a servicios externos (email, storage) en unitarios: mockear los puertos.

```ts
describe('BloquearFechaUseCase', () => {
  it('debe_permitir_un_bloqueo_y_rechazar_el_segundo_cuando_son_concurrentes', async () => {
    // Arrange
    const fecha = new Date('2026-09-12');
    // Act
    const resultados = await Promise.allSettled([
      bloquear.ejecutar(tenantId, fecha, reservaA),
      bloquear.ejecutar(tenantId, fecha, reservaB),
    ]);
    // Assert
    const ok = resultados.filter(r => r.status === 'fulfilled');
    const ko = resultados.filter(r => r.status === 'rejected');
    expect(ok).toHaveLength(1);
    expect(ko).toHaveLength(1);
  });
});
```

## Seguridad

- **Validar toda entrada** con DTOs + `class-validator`; `ValidationPipe` global con `whitelist: true`.
- **Aislamiento por tenant** reforzado por RLS; nunca confiar en IDs del cliente para cruzar tenants.
- **Secretos** en variables de entorno cifradas del hosting; nunca en el repo.
- **CORS** restringido al origen de la SPA (`CORS_ORIGIN`).
- **Nunca devolver** `password_hash` ni tokens en las respuestas.
- Errores reportados a Sentry; los mensajes al cliente no filtran detalles internos.

## Flujo de desarrollo

- Rama `feature/<nombre>` antes de cualquier cambio.
- `pnpm lint && pnpm typecheck && pnpm test` antes de cada commit.
- Mantén las migraciones revisadas y los artefactos OpenSpec actualizados (ver [openspec-tasks-mandatory-steps.md](./openspec-tasks-mandatory-steps.md)).
- Actualiza `api-spec.yml`, `data-model.md` y `er-diagram.md` cuando cambie el contrato o el modelo.

---

*Este documento es la base para mantener calidad y consistencia en el backend de Slotify. Consistente con [architecture.md](./architecture.md), [data-model.md](./data-model.md), [api-spec.yml](./api-spec.yml) y [c4-diagrams.md](./c4-diagrams.md). Actualizado en US-045 (28/06/2026): tabla de módulos — fila `comunicaciones` refleja el motor hexagonal `DespacharEmailService`, adaptadores Resend+Fake, catálogo de plantillas, idempotencia UNIQUE parcial y referencia a §2.10 de architecture.md.*
