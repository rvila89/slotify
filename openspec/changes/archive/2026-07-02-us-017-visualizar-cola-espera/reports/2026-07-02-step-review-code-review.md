# Code review — US-017 Visualizar Cola de Espera de una Fecha

- Change: `us-017-visualizar-cola-espera`
- Rama: `feature/us-017-visualizar-cola-espera` (base `master`)
- Fecha: 2026-07-02
- Revisor: code-reviewer (solo lectura; no aplica fixes)
- Naturaleza: vista de SOLO LECTURA (CQRS-lite). No hay mutación de estado, bloqueo ni cola.

## Alcance revisado
Backend: `domain/cola-espera-lectura.ts`, `application/obtener-cola-espera.query.ts`,
`infrastructure/cola-espera-query.prisma.adapter.ts`, `interface/obtener-cola-espera.controller.ts`,
`interface/cola-espera.dto.ts`, wiring en `reservas.module.ts` / `reservas.tokens.ts`.
Tests: `__tests__/cola-espera-derivacion.spec.ts`, `obtener-cola-espera.query.spec.ts`,
`obtener-cola-espera-integracion.spec.ts`.
Contrato/SDK: `docs/api-spec.yml` (`GET /reservas/{id}/cola`, `ColaEsperaResponse`/`ColaBloqueante`/`ColaItem`),
`apps/web/src/api-client/schema.d.ts` (generado).
Frontend: `apps/web/src/features/cola-espera/**`, `apps/web/src/App.tsx`. E2E: `e2e/us-017-cola-espera.spec.ts`.

Nota de estado del repo: el trabajo de US-017 está presente como cambios de working tree
(modificados + untracked) sobre `master` en la rama de la feature; no como commits distintos.
La revisión se ha hecho sobre esos cambios (el contenido efectivo de la feature).

## Checklist de guardrails

### Hexagonal — OK
- `domain/cola-espera-lectura.ts`: dominio puro. Solo importa `type SubEstadoConsulta` de
  `./maquina-estados`. Sin `@nestjs/*`, sin `@prisma/*`, sin `infrastructure/`. Derivación
  temporal en funciones puras (`derivarTtlRestante`, `derivarTiempoEnCola`) con "ahora" INYECTADO.
- `application/obtener-cola-espera.query.ts`: depende solo del puerto `ColaEsperaQueryPort`
  (interfaz). Sin Prisma ni framework. El error de dominio (`ColaEsperaNoEncontradaError`) vive aquí.
- `infrastructure/cola-espera-query.prisma.adapter.ts`: implementa el puerto; Prisma/`@nestjs`
  confinados a infra, como corresponde.

### Multi-tenancy / RLS — OK
- `tenantId` proviene SIEMPRE del JWT (`@CurrentUser() usuario.tenantId` en el controlador),
  nunca del path/body. El `:id` del path es solo el `reservaId`.
- El adaptador fija el contexto RLS como PRIMERA operación de la transacción
  (`this.prisma.fijarTenant(tx, tenantId)`), y además filtra por `tenantId` en todas las queries
  (defensa en profundidad, mismo patrón que `ColaQueryPrismaAdapter` de US-018).
- Cross-tenant: reserva de otro tenant es invisible por RLS -> `null` -> `ColaEsperaNoEncontradaError`
  -> 404. Sin fuga de existencia. Cubierto por test de integración de aislamiento multi-tenant.

### Bloqueo atómico — N/A (correcto)
- Lectura pura. No se introduce Redis/Redlock/lock distribuido ni timers. Grep confirma que las
  únicas coincidencias de patrones prohibidos son ficheros pre-existentes de US-012
  (`barrido-expiracion.scheduler`), ajenos a esta US.

### Contrato / SDK — OK
- `docs/api-spec.yml`: `ColaEsperaResponse`/`ColaBloqueante`/`ColaItem` bien tipados; `required`
  coherentes; 401/403/404 añadidos. `subEstado` referencia `SubEstadoConsulta`.
- `apps/web/src/api-client/schema.d.ts` coincide exactamente con el spec (regenerado, no editado a
  mano): comentarios/descripciones y tipos derivan del YAML. El frontend consume vía SDK generado
  (`apiClient.GET('/reservas/{id}/cola')`); tipos del modelo son alias sobre `components['schemas']`.
- DTO backend (`cola-espera.dto.ts`) coherente con el schema. Al ser solo de salida no requiere
  `class-validator` (correcto; no hay entrada de usuario que validar más allá del path param).
- Mapper `subEstadoPrismaADominio('s2b') -> '2b'` alinea el valor emitido con el enum del contrato
  `['2b','2c','2v']`.

### Anti off-by-one de TZ — OK (bien resuelto)
- `ttlRestante` y `tiempoEnCola` se derivan en backend como delta entre INSTANTES `Date`, no
  formateando strings. El "ahora" se inyecta vía `ClockPort`, determinista y unit-testeable.
- El frontend muestra esos strings TAL CUAL (`SeccionBloqueante`, `ColaItemFila`), sin recalcular.
- `formatearFechaVisita` ancla la fecha de solo-día a `T12:00:00Z` para evitar el off-by-one de TZ
  documentado en memoria. Acierto.

### Convenciones — OK
- Arrow functions en todo el código nuevo; no hay `function` declarativo (los métodos de clase de
  NestJS quedan exentos por ser métodos). Grep confirma 0 `function ...(` en la feature web.
- Nombres en español, PascalCase/camelCase/kebab-case; comentarios y mensajes de error en español.

### Estructura frontend por dominio — OK
- `features/cola-espera/` con segmentos `api/ components/ lib/ model/ pages/` y barrel `index.ts`
  como única API pública. `App.tsx` importa por el barrel (`@/features/cola-espera` equivalente).
- Ficheros pequeños y cohesionados (todos muy por debajo de 300 líneas). Sub-componentes
  co-localizados (`SeccionBloqueante`, `SeccionCola`, `ColaItemFila`, `EstadosCola`).

### Responsive mobile-first — OK
- Contenedor `mx-auto w-full max-w-[1000px]`, layout en columna, cortes `sm:`/`lg:`; sin anchos px
  fijos que rompan en 390px. `min-w-0` + `truncate` evitan overflow horizontal en las filas de cola.
- Objetivos táctiles amplios (la fila entera es enlace), `focus-visible` accesible.
- QA aporta evidencia E2E en 390/768/1280 (11/11) en los reports del change.

### TDD — OK
- Test hermano de la derivación pura (`cola-espera-derivacion.spec.ts`), del caso de uso
  (`obtener-cola-espera.query.spec.ts`) y de integración real contra `slotify_test`
  (`obtener-cola-espera-integracion.spec.ts`) cubriendo happy path, FIFO estricto, filtrado
  (excluye terminales y la bloqueante), FA-01/02/03/04/05 y aislamiento RLS. Ausencia de tests de
  concurrencia/estado es CORRECTA aquí (lectura pura, sin mutación).

## Bloqueantes
Ninguno.

## Observaciones no bloqueantes (informativas, no requieren cambio)
- [O-1] `cola-espera-query.prisma.adapter.ts:112` usa `entrada.posicionCola ?? 0` como defensa; en la
  práctica toda reserva en `s2d` de una bloqueante tiene `posicionCola` no nulo. Fallback inocuo;
  podría documentarse como invariante o mapearse a `1` si alguna vez se quisiera evitar un `0`.
- [O-2] El estado del repo mantiene la US como working-tree sin commit; antes del PR conviene
  commitear en la rama de la feature (no afecta a la calidad del código revisado).
- [O-3] Fallo conocido `40P01` en `alta-consulta-con-fecha-concurrencia.spec.ts` es deuda
  pre-existente de US-004 (documentada en memoria); ajena a US-017, no se imputa a esta US.

## Veredicto: APTO

Cumple todos los guardrails duros (hexagonal, RLS/multi-tenancy con tenant del JWT y aislamiento
cross-tenant, sin lock distribuido, cliente generado no editado a mano, contrato-DTO coherentes,
anti off-by-one de TZ, convenciones, estructura por dominio + barrel, responsive, TDD). Sin
bloqueantes. Apto para pasar al gate final y, tras el OK humano, a archive/PR.
