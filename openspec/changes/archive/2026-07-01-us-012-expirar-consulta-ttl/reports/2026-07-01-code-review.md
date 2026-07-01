# Informe de code-review — US-012 «Expirar consulta automáticamente por TTL agotado»

- **Fecha**: 2026-07-01
- **Revisor**: code-reviewer (solo lectura, contra `review-checklist` + `architecture-guardrails`)
- **Rama**: `feature/us-012-expirar-consulta-ttl`
- **Alcance**: diff del change US-012 (working tree sobre `master`): dominio (`maquina-estados.ts`),
  aplicación (`expirar-consultas-vencidas.service.ts`), infraestructura (adaptadores de candidatas y
  UoW de expiración), guard `cron-token.guard.ts`, interfaz (controller/dto/scheduler), wiring
  (`reservas.module.ts`, `reservas.tokens.ts`), contrato (`docs/api-spec.yml`) y cliente generado
  (`apps/web/src/api-client/schema.d.ts`).

## Método
- Lectura completa de los ficheros del change y de sus colaboradores (`sub-estado-consulta.mapper.ts`,
  `promocion-cola.stub.adapter.ts`, `jwt-auth.guard.ts`, `public.decorator.ts`, `prisma.service.ts`,
  `schema.prisma`).
- `pnpm lint` (apps/api): **limpio** (ESLint sin errores; `func-style`/`prefer-arrow-callback` OK).
- `pnpm test` (apps/api): **568/568 en verde** en la pasada limpia. En una pasada previa apareció
  1 fallo aislado en `alta-consulta-con-fecha-concurrencia.spec.ts` con `40P01 deadlock detected` —
  es el **flake pre-existente documentado de US-004** (memoria «US-004 concurrency test flaky»),
  NO una regresión de US-012; no volvió a reproducirse. Todas las suites de US-012
  (`expirar-consultas.use-case`, `-integracion`, `-concurrencia`, `maquina-estados-expiracion-ttl`,
  `barrido-expiracion.controller`) pasan.

## Verificación de guardarraíles duros

- **Hexagonal — OK.** `domain/maquina-estados.ts` no importa `@nestjs/*`, `@prisma/*` ni infra
  (solo tipos propios). La aplicación depende SOLO de puertos (`CandidatasExpiracionPort`,
  `ExpiracionReservaPort`) y de tipos de dominio; no importa Prisma ni NestJS. Los adaptadores viven
  en `infrastructure/`.
- **Bloqueo atómico — OK.** Sin Redis/Redlock/lock distribuido. La exclusión mutua es
  `SELECT … FOR UPDATE` en PostgreSQL, en una transacción **por RESERVA**; la liberación de fecha usa
  la semántica de `FECHA_BLOQUEADA` (UNIQUE(tenant_id,fecha)) con DELETE idempotente (0 filas = éxito
  silencioso, US-041) dentro de la misma transacción que la transición.
- **Multi-tenancy / RLS — OK.** La única lectura cross-tenant (adaptador de candidatas) está
  documentada y justificada (rol técnico del proceso de Sistema, D-6). Toda **mutación** abre su
  transacción y ejecuta `fijarTenant(tx, candidata.tenantId)` (→ `SELECT set_config('app.tenant_id', …, true)`,
  local a la TX) como primera operación, derivando el tenant de **la fila candidata**, nunca de input
  externo. Las queries filtran por `tenant_id`.
- **Máquina de estados declarativa — OK.** `MAPA_EXPIRACION_TTL` es una tabla de datos y
  `resolverExpiracionTtl` un lookup puro; sin `if/else` dispersos. Terminales/no-candidatos → `null`
  (inmutables aunque el TTL esté vencido).
- **Jobs asíncronos — OK.** Patrón estado en fila (`ttl_expiracion` + estado) + barrido periódico
  idempotente. `@Cron` (`@nestjs/schedule`) invoca el endpoint HTTP protegido; sin `CRON_TOKEN` el
  disparo automático se desactiva y el endpoint queda para disparo manual. Nada de Lambda/EventBridge
  ni timers exactos.
- **D-8 (solo el seam de promoción) — OK.** Se dispara `PromocionColaPort.promoverPrimeroEnCola`
  exactamente una vez cuando hay cola activa; el adaptador es un stub no-op documentado (FIFO/re-bloqueo
  A15 queda para US-018). No se implementa reordenación aquí.
- **D-7 (comparación por instante) — OK.** Candidatas: `ttl_expiracion < (now() AT TIME ZONE 'UTC')`
  en SQL. Re-evaluación bajo lock: `ttl.getTime() < Date.now()`. Nunca por fecha formateada.
- **Idempotencia / RC-1..RC-3 — OK.** Re-lectura del estado bajo `FOR UPDATE` + re-evaluación de la
  guarda + del instante; si dejó de ser candidata → `expirada=false`, no cuenta como fallo. Fallo
  aislado por RESERVA (try/catch en el bucle), sin abortar el lote.
- **Endpoint protegido `X-Cron-Token` — OK.** `@Public()` salta el `JwtAuthGuard` global
  (`APP_GUARD`, honra `IS_PUBLIC_KEY`) y `CronTokenGuard` exige la cabecera con comparación en tiempo
  constante (`timingSafeEqual`); ausente/incorrecto/sin `CRON_TOKEN` → 401. Un `Bearer` sin la
  cabecera de cron NO autoriza.
- **Casts `::uuid` eliminados (fix del backend-developer) — OK.** En `schema.prisma`, `id_reserva` y
  `tenant_id` son `String` (TEXT, no `@db.Uuid`); castear un parámetro TEXT a `::uuid` era incorrecto.
  Los valores viajan como **bindings parametrizados** de `Prisma.sql` (`${…}`), no por concatenación,
  por lo que **no hay riesgo de inyección** ni se rompe el aislamiento. El cast que permanece
  (`${fechaIso}::date`) es correcto contra la columna `fecha @db.Date` y también parametrizado.
- **Contrato / cliente — OK.** `BarridoExpiracionResponse` y el `operationId barridoExpiracion`
  coinciden con `BarridoExpiracionResponseDto` (`candidatas/expiradas/promocionesDisparadas/fallos`,
  todos `integer minimum:0` / `number`). El securityScheme `cronToken` existe. `schema.d.ts` es cliente
  **generado** (regenerado desde el contrato), no editado a mano.
- **Convenciones / tipos — OK.** Nombres y comentarios/errores en español; arrow functions salvo
  métodos de clase NestJS; sin `any` injustificado; sin `Float` (el change no toca importes).
- **Tests primero — OK.** Existen y pasan las suites de concurrencia, integración, use-case, controller
  y máquina de estados.
- **Responsive (frontend) — N/A.** US-012 no aporta UI (solo el cliente generado); no aplica el check
  de 3 viewports.

## Hallazgos

### Bloqueantes
- (ninguno)

### Alta
- (ninguno)

### Media
- (ninguno)

### Baja / informativo
- [infra] `expiracion-reserva-uow.prisma.adapter.ts` toma **dos** `SELECT … FOR UPDATE` sobre
  `fecha_bloqueada` para la misma `(tenant, fecha)`: uno tras el lock de la RESERVA (líneas ~103-107,
  para serializar con US-006) y otro antes del DELETE para capturar `reserva_id` (líneas ~136-140). Es
  correcto y seguro (misma TX, lock ya poseído), pero el segundo es **redundante**: podría fusionarse
  con el primero (p. ej. seleccionando `reserva_id` en el lock inicial) para ahorrar un round-trip.
  Recomendación: consolidar en un único `SELECT … FOR UPDATE`. No bloqueante.
- [infra] El recuento de cola post-commit (`tx.reserva.count(... s2d ...)`) se hace en una transacción
  separada tras el COMMIT de la expiración, coherente con el enfoque «seam only» de D-8. Al no re-tomar
  el lock, existe una ventana teórica donde la cola cambie entre commit y conteo; dado que el destinatario
  es hoy un stub no-op y la reordenación real es de US-018, no tiene efecto práctico. Recomendación:
  revisar esta secuencia cuando se implemente la promoción real (US-018).

## Veredicto
Todos los guardarraíles duros se cumplen; lint limpio; suite de US-012 en verde; el único fallo
observado es el flake pre-existente de US-004 (deadlock 40P01), ajeno a este change. Los dos hallazgos
son de severidad Baja/informativa y no condicionan el merge.

Veredicto: APTO

---

## ADENDA — Re-revisión de delta (scheduler dinámico) — 2026-07-01

- **Revisor**: code-reviewer (solo lectura)
- **Motivo**: cambio acotado decidido en el gate final tras el veredicto APTO original.
- **Alcance del delta (SOLO esto, no se re-revisa el change completo)**:
  - `apps/api/src/reservas/interface/barrido-expiracion.scheduler.ts` — se sustituye el decorador
    estático `@Cron` por registro DINÁMICO: la clase `implements OnModuleInit`; en `onModuleInit()`
    lee `CRON_BARRIDO_EXPIRACION` del `ConfigService` (default `'0 * * * *'`), crea un `CronJob`
    (`import { CronJob } from 'cron'`) con nombre `'barrido-expiracion-ttl'`, lo registra en el
    `SchedulerRegistry` inyectado y lo arranca. `dispararBarrido()` conserva su lógica intacta.
  - `apps/api/src/reservas/__tests__/barrido-expiracion.scheduler.spec.ts` — spec nueva (5 tests).
  - `apps/api/package.json` — `cron: ^3.2.1` (dep directa; `@nestjs/schedule` v4 no re-exporta `CronJob`).
  - `.env.example` / `apps/api/.env.test` — documentadas `CRON_TOKEN` y `CRON_BARRIDO_EXPIRACION`.

### Verificación del delta

- **Hexagonal — OK.** El import de `cron` está en la capa `interface/` (adaptador de entrada), no en
  `domain/`. El dominio (`maquina-estados.ts`) y la aplicación no se tocan (confirmado por mtimes:
  domain/service/controller/contrato son anteriores al delta). No se viola `no-infra-in-domain`.
- **Registro dinámico correcto — OK.** `ScheduleModule.forRoot()` está importado en `ReservasModule`
  (provee `SchedulerRegistry`) y `BarridoExpiracionScheduler` está declarado como provider. En
  `onModuleInit()` se resuelve la expresión cron, se crea `CronJob.from({ cronTime, onTick })`, se
  registra con `schedulerRegistry.addCronJob(NOMBRE_JOB, job)` y se arranca con `job.start()`.
  Motivación válida: `@Cron` se evalúa en carga del módulo y no puede consultar `ConfigService`.
- **Sin handles/timers colgando en tests — OK.** El `afterEach` del spec recorre
  `registry.getCronJobs().forEach((job) => job.stop())` sobre todos los registros creados y limpia
  `registrosActivos`, deteniendo los timers de cada `CronJob` arrancado. Verificado con
  `jest --detectOpenHandles`: **5/5 en verde, sin handles abiertos** y sin cuelgue del runner.
- **Comportamiento sin `CRON_TOKEN` — OK (invariante preservada).** `dispararBarrido()` mantiene:
  sin token → `logger.warn(...)` + `return` (no hay fetch). Cubierto por el test
  `sin_CRON_TOKEN_no_dispara_el_fetch_y_emite_WARN` (fetch no llamado, WARN x1). Con token → POST a
  `/api/cron/barrido-expiracion` con cabecera `X-Cron-Token`, idéntico a lo aprobado.
- **Sin cambios en negocio / contrato / atomicidad / RLS / idempotencia — OK.** El controller
  (`barrido-expiracion.controller.ts`), el caso de uso, los adaptadores UoW/candidatas, el
  `CronTokenGuard` y `docs/api-spec.yml` no forman parte del delta y no se han modificado. El scheduler
  sigue siendo un mero disparador HTTP del mismo endpoint protegido; el patrón "estado en fila +
  barrido periódico" idempotente se mantiene, sin Lambda/EventBridge ni timers exactos.
- **Convenciones / lint — OK.** `onModuleInit` y `dispararBarrido` son métodos de clase NestJS
  (exentos de `func-style`); los helpers del spec (`crearConfig`, `crearScheduler`) y los callbacks
  (`onTick`, `forEach`) son arrow functions. `npx eslint` sobre el scheduler y su spec: **limpio**.
  La dependencia `cron` es transitiva de `@nestjs/schedule`, ahora declarada como directa: correcto.

### Hallazgos del delta

- **Bloqueantes**: (ninguno)
- **Alta**: (ninguno)
- **Media**: (ninguno)
- **Baja / informativo**:
  - [interface] `dispararBarrido()` construye la URL con `http://localhost:${API_PORT}` (llamada
    HTTP a sí mismo). Es coherente con lo ya aprobado (el endpoint debe ser invocable externamente),
    pero acopla el scheduler al puerto local; si en el futuro la API corre tras un proxy o en otra
    interfaz, convendrá parametrizar el host base. No bloqueante; sin cambio respecto al original.

### Veredicto del delta

El delta se limita al mecanismo de agendado (decorador estático → registro dinámico vía
`SchedulerRegistry`) para poder leer la frecuencia del `ConfigService`. No altera lógica de negocio,
contrato, atomicidad, RLS ni idempotencia; preserva la invariante "sin CRON_TOKEN no dispara + WARN";
no introduce imports de infra en dominio; lint limpio; spec 5/5 sin handles colgando. El veredicto
APTO original sigue siendo válido.

Veredicto: APTO
