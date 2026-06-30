# Code Review — US-006 «Extender plazo de bloqueo de fecha»

- Fecha: 2026-06-30
- Revisor: code-reviewer (solo lectura, contra `review-checklist` + `architecture-guardrails`)
- Rama: `feature/us-006-extender-plazo-bloqueo` (diff del working tree sobre `master`)
- Change: `openspec/changes/us-006-extender-plazo-bloqueo/`
- Endpoint: `POST /reservas/{id}/extender-bloqueo`

## Resumen

US-006 implementa el override manual del Gestor para extender el TTL de un bloqueo
blando vigente (prórroga pura: NO transición). La implementación es de alta calidad,
respeta hexagonal/DDD, el bloqueo atómico (FOR UPDATE, sin locks distribuidos), RLS,
la invariancia de estado/subEstado/tipoBloqueo/fecha y el contrato OpenAPI. Los tests
cubren happy/edge/concurrencia/atomicidad y son honestos (no trampeados). `pnpm lint`
pasa en `apps/api` y `apps/web`. No se detectan Bloqueantes.

## Verificación de guardrails

### Hexagonal — OK
- `domain/maquina-estados.ts`: la nueva guarda `esEstadoConBloqueoBlandoExtensible`
  es función pura sobre una tabla de datos (`ESTADOS_BLOQUEO_BLANDO_EXTENSIBLE`); sin
  imports de `@nestjs/*`, `@prisma/*` ni `infrastructure/`.
- `application/extender-bloqueo.use-case.ts`: depende solo de puertos inyectados
  (`UnidadDeTrabajoExtenderBloqueoPort`, `ClockPort`, `AuditLogPort`); no importa
  Prisma ni Nest. Puertos definidos en aplicación; adaptadores en infraestructura.
- `infrastructure/extender-bloqueo-uow.prisma.adapter.ts`: única capa que toca Prisma
  y `@nestjs/common`. Correcto.

### Bloqueo atómico de fecha — OK
- Serialización por `SELECT … FOR UPDATE` sobre la fila de `fecha_bloqueada`
  (`leerBloqueoVigente`, adapter L121-128). Nada de Redis/Redlock/locks distribuidos.
- Las 3 mutaciones (UPDATE RESERVA.ttl, UPDATE FECHA_BLOQUEADA.ttl, INSERT AUDIT_LOG)
  ocurren dentro de un único `$transaction` (all-or-nothing); un fallo propaga y
  revierte (test 3.4 cubre las 3 ramas).
- Coherencia RESERVA↔FECHA_BLOQUEADA: ambos TTL se fijan al MISMO `nuevoTtl`
  (use-case L295-307); el test de concurrencia verifica que no quedan "medio
  extendidos".
- Seguridad ante el barrido (US-012): la base del TTL se RE-LEE bajo el lock
  (use-case L262-289) y se rechaza con 409 si `ttl <= ahora` o si no hay fila blanda
  vigente → no resucita un bloqueo expirado-y-procesado. El test de concurrencia 2
  simula el barrido tomando el mismo lock y verifica los dos desenlaces deterministas.

### Multi-tenancy / RLS — OK
- `tenantId` y `usuarioId` derivan del JWT (`@CurrentUser`), nunca del path/body
  (controller L71-76).
- La UoW ejecuta `fijarTenant(tx, tenantId)` como PRIMERA operación de la transacción
  (adapter L194-195); todas las queries filtran por `tenant_id` (incluida la raw SQL
  del FOR UPDATE).
- Aislamiento cross-tenant probado: extender la RESERVA de otro tenant → 404
  `ReservaNoEncontradaError` (integracion.spec, "aislamiento multi-tenant / RLS").

### Contrato como fuente de verdad / split 409 vs 422 — OK
- `docs/api-spec.yml` añade `extenderBloqueo`, `ExtenderBloqueoRequest`
  (`dias: integer, minimum 1`) y `ExtenderBloqueoConflictoError` (allOf ErrorResponse
  + `motivo`). El 422 referencia `ErrorResponse` (sin `motivo`).
- Implementación coincide: controller mapea `BloqueoNoExtensibleError`→409 con
  `motivo`; `ExtenderBloqueoValidacionError`→422 (solo `message`);
  `ReservaNoEncontradaError`→404.
- Split correcto: 409 = conflicto de bloqueo en BD (TTL expirado / firme / sin fila
  blanda vigente); 422 = guarda de estado no extensible (2a/cola/terminales) y `dias`
  inválido. Coherente con el precedente US-007/008.
- Cliente SDK regenerado, no editado a mano: solo cambia `schema.d.ts`; `client.ts` e
  `index.ts` no tienen diff de contenido. El barrel y `model/types.ts` consumen los
  tipos generados.

### Convenciones / estructura / responsive — OK
- Arrow functions en todo el código nuevo; no hay `function` declarativo (verificado).
  `pnpm lint` pasa limpio en `apps/api` y `apps/web` (solo warnings preexistentes del
  plugin boundaries, ajenos a US-006).
- Nombres en español, errores y mensajes en español.
- Estructura Bulletproof React: feature `reservas/` con segmentos correctos; hook en
  `api/`, componentes en `components/`, sub-componente de página co-localizado en
  `pages/FichaConsulta/components/`; export por barrel `index.ts`. Todos los ficheros
  web < 300 líneas (mayor: dialog 214).
- Responsive: `Dialog` mobile-first (`w-[calc(100%-2rem)]`/`max-w-lg`), botones
  `w-full sm:w-auto`, touch targets `h-12`/`h-14` (≥48px). E2E Playwright cubre los 3
  viewports 390/768/1280 con asserts de ausencia de overflow horizontal (step-8: PASS).
- No es importe monetario: la operación solo toca `ttlExpiracion` (Date); regla
  Decimal/Float no aplica.

### Invariancia — OK
- El use-case solo escribe `ttl_expiracion` en ambas tablas + AUDIT_LOG; no toca
  estado/subEstado/tipoBloqueo/fecha (D-8). Tests 3.3 (unit) e integración verifican
  que estado/subEstado/tipoBloqueo/fecha quedan idénticos y que los args de los
  repos NO incluyen esos campos.
- AUDIT_LOG `accion='actualizar'`, `entidad='RESERVA'`, con
  `datosAnteriores.ttlExpiracion`/`datosNuevos.ttlExpiracion` (use-case L331-346);
  verificado en unit e integración.

### TDD / calidad de tests — OK
- 6 specs backend: guarda declarativa, use-case (happy/edge/atomicidad/dias), controller
  unit, HTTP boundary, integración real (PG) y concurrencia real (PG). 59/59 en verde
  (step-6). E2E 11/11 (step-8).
- Tests honestos: la concurrencia usa `Promise.allSettled` con carrera real contra
  Postgres y asserts de estado final coherente; no hay relajaciones para forzar verde.

## Verificación de las correcciones señaladas

### Fix cast `tenant_id::uuid` en el test de concurrencia — LEGÍTIMO
`tenant_id` es columna `text` (Prisma `String @map("tenant_id")`), no `uuid`. La raw
SQL del adapter (`WHERE tenant_id = ${params.tenantId}`) y la del barrido simulado en
el test comparan `text` con `text` sin cast. Quitar `::uuid` corrige un error de tipo
real; el test sigue ejerciendo el FOR UPDATE y la serialización (no se relaja: mantiene
los asserts de estado final y de `BloqueoNoExtensibleError`). No quedan `::uuid` en los
tests de US-006.

### Fix divergencia `dias` inválido 400→422 — LIMPIO
El DTO usa `@Allow()` + `@Type(() => Number)` (sin `@IsInt`/`@Min`) para que el
`ValidationPipe` GLOBAL (whitelist) deje pasar `dias` sin rechazar con 400, y delega el
rechazo en la guarda defensiva del dominio (`validarDias` → `ExtenderBloqueoValidacionError`
→ 422). Enfoque correcto: el pipe global NO se toca (no debilita otros endpoints) y se
añade `extender-bloqueo.controller.http.spec.ts` que prueba 422 (no 400) para 0,
negativo, no entero y tipo string contra el pipe global real. La nota "400" del
step-7 (curl) es PREVIA al fix; el estado actual del código produce 422.

## Hallazgos

### Bloqueante
- Ninguno.

### Mayor
- Ninguno.

### Menor
- Ninguno que requiera acción para el merge.

### Nit (no bloquea)
- `extender-bloqueo.use-case.ts` (347 líneas) supera 300; `max-lines` solo se aplica a
  `apps/web` por config, así que no rompe lint. Gran parte son comentarios y tipos de
  puertos; si se desea, los puertos podrían extraerse a un `.ports.ts`. Opcional.
- El step-7 (curl) conserva la nota de la divergencia 400/422 ya resuelta; conviene
  anotar en ese report que quedó corregida para evitar confusión futura. Documental.

## Veredicto

Veredicto: APTO
