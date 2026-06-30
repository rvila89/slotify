# Informe de code-review — US-007 (transición «pendiente de invitados» 2.b → 2.c)

- **Change**: `2026-06-30-us-007-transicion-pendiente-invitados`
- **Branch**: `feature/us-007-transicion-pendiente-invitados` (diff = working tree sobre `master`, HEAD == master)
- **Rol**: code-reviewer (solo lectura — no se aplica fix)
- **Fecha**: 2026-06-30

## Resumen

Revisión del diff completo (backend hexagonal + frontend por feature + contrato OpenAPI/SDK + suite
TDD) contra `review-checklist` y `architecture-guardrails`, con foco en las decisiones humanas
aprobadas D-1 (origen estricto 2.b), D-7 (ningún email) y D-8 (sin migración Prisma).

La implementación es coherente y limpia: la guarda de origen es declarativa (tabla
`ORIGENES_TRANSICION_PENDIENTE_INVITADOS` con una única entrada `{consulta, 2b}`), las cuatro
operaciones (sub_estado + TTL RESERVA + TTL FECHA_BLOQUEADA + vaciado de cola) viven en una sola
unidad de trabajo `prisma.$transaction` serializada por `SELECT … FOR UPDATE` sobre la fila
bloqueante, el TTL se deriva de `TENANT_SETTINGS.ttl_consulta_dias` vía `resolverPlanBloqueo({ fase:
'2.c' })` y `extenderTtl(base, delta)` (base = TTL actual, nunca `now()`), el dominio no importa
infraestructura, el tenant viaja por JWT y el SDK del frontend está regenerado (coincide verbatim
con `api-spec.yml`). No hay Bloqueantes ni Mayores.

## Hallazgos por severidad

### Bloqueantes
- Ninguno.

### Mayores
- Ninguno.

### Menores (no bloquean merge)
- **[menor] Defecto de TTL hardcodeado como fallback** —
  `apps/api/src/reservas/application/transicion-pendiente-invitados.use-case.ts:48` y `:344-355`:
  `TTL_CONSULTA_DIAS_DEFECTO = 3` se usa si el tenant no tiene settings. El guardrail "TTL derivado
  del setting, nunca hardcode" se cumple en la ruta normal (el valor viene de
  `TENANT_SETTINGS.ttl_consulta_dias`); el `3` es solo un fallback defensivo coherente con
  `bloquear-fecha.service` (que en cambio lanza `ValidacionBloqueoError` si no hay settings).
  Recomendación: alinear el comportamiento — o bien fallar si no hay settings (como el servicio de
  bloqueo), o documentar explícitamente por qué aquí se tolera un defecto. No es violación dura.
- **[menor] `aReservaDominio` mapea `estado` con doble cast** —
  `apps/api/src/reservas/infrastructure/transicion-pendiente-invitados-uow.prisma.adapter.ts:60`
  (`fila.estado as EstadoReservaDominio`) y `:64` (`as unknown as SubEstadoConsultaPrisma`). Es un
  patrón de frontera de mapper aceptable, pero el `estado` se castea sin validar. Recomendación
  (opcional): reutilizar un mapper de estado análogo al de sub-estado para simetría. Sin impacto
  funcional.
- **[menor] Sin `@Public` ni `@UseGuards` explícito en el controlador** —
  `apps/api/src/reservas/interface/pendiente-invitados.controller.ts`: la protección depende del
  `JwtAuthGuard` global (`APP_GUARD` en `app.module.ts:52`), igual que los controladores hermanos.
  Correcto, pero conviene tenerlo presente: si alguna vez se retira el guard global, este endpoint
  quedaría abierto. No es un hallazgo de este diff.

## Verificación de guardrails

| Guardrail | Estado | Evidencia |
|---|---|---|
| Hexagonal (domain sin `@nestjs`/`@prisma`/infra) | OK | `domain/maquina-estados.ts` y `domain/bloquear-fecha.service.ts` solo declaran tipos/puertos/funciones puras; el use-case depende solo de puertos; Prisma/`@nestjs` viven en `infrastructure/`/`interface/`. |
| Bloqueo atómico solo PostgreSQL (FOR UPDATE + UNIQUE), sin Redis/locks | OK | `leerBloqueoVigente` usa `$queryRaw … FOR UPDATE` sobre `fecha_bloqueada` (adapter `:125-132`). Sin Redis/Redlock/setTimeout/Lambda en los ficheros nuevos. |
| Atomicidad de las 4 operaciones en una única tx (all-or-nothing) | OK | Un único `prisma.$transaction` en el UoW adapter `:233-244`; las 4 mutaciones se ejecutan dentro del callback del use-case; cualquier `throw` (404/422/409) revierte. |
| Multi-tenancy / RLS (tenant del JWT, `SET LOCAL`, no path) | OK | `tenantId = usuario.tenantId` (controlador `:60`), `:id` es la reserva; `fijarTenant(tx, tenantId)` como 1ª operación de la tx (adapter `:235`); queries filtran `tenant_id`. |
| Máquina de estados declarativa (tabla, no if/else; terminales inmutables) | OK | `ORIGENES_TRANSICION_PENDIENTE_INVITADOS` + `esOrigenValidoParaPendienteInvitados` (`maquina-estados.ts:219-235`); D-1 origen estricto `{consulta,2b}`, sin admitir 2a; 2x/2y/2z/cancelada/completada no son orígenes. Re-lectura bajo lock antes de la guarda (use-case `:280-298`). |
| TTL derivado del setting, nunca hardcode | OK (con matiz menor) | `resolverPlanBloqueo({ fase:'2.c' }) → extend` con `ttlDeltaDias = settings.ttlConsultaDias`; `extenderTtl(base, delta)` sobre TTL actual, no `now()` (use-case `:300-302`). Matiz: fallback `3` si no hay settings (ver Menores). |
| Contrato: SDK generado no editado a mano; DTOs coherentes | OK | `schema.d.ts` coincide verbatim con `api-spec.yml` (descripciones idénticas) → regenerado. DTOs (`pendiente-invitados.dto.ts`) y `BloqueoNoVigenteError`/`PendienteInvitadosResponse` alineados con el contrato. |
| D-7: ningún email/puerto de comunicación en el flujo | OK | `TransicionPendienteInvitadosDeps` no expone puerto de email; sin import/uso de email/Resend/Postmark. Las únicas referencias son comentarios documentando la exclusión. |
| D-8: sin migración Prisma | OK | `git status` no muestra cambios en `apps/api/prisma/`; el único match "prisma" es el nombre del fichero adapter. |
| Frontend: estructura por feature + barrel (boundaries) | OK | Todo en `features/reservas/{api,components,lib,model,pages}`; `index.ts` reexporta el hook/tipos; los componentes importan por rutas internas relativas dentro de la feature. |
| Frontend: arrow functions | OK | Sin `function` declarativo en los ficheros nuevos; todo `const … = () => {}`. |
| Frontend: max-lines ≤300 | OK | Mayor fichero nuevo/modificado: use-case 389 líneas (backend, sin límite 300); en `apps/web` el mayor es `FichaConsultaPage.tsx` 194. |
| Frontend: responsive mobile-first | OK | `PendienteInvitadosDialog` reutiliza `DialogContent` shadcn (`w-[calc(100%-2rem)]`/`max-w-lg`); botones `w-full sm:w-auto`; grids `grid-cols-1 sm:grid-cols-2`. Sin anchos px fijos que rompan. Evidencia de 3 viewports: ver report step-8 E2E. |
| TS strict, sin `any` injustificado | OK | Sin `: any`/`as any` en los ficheros nuevos de backend; el cast `as unknown as` del mapper es de frontera y está acotado. |
| DTOs validados / errores en español | OK | Errores de dominio en español; mapeo HTTP 409/422/404 en el controlador; body vacío (`PendienteInvitadosRequestDto`) sin parámetros que validar. |
| Importes en Decimal | N/A | Esta US no manipula importes. |
| TDD: lógica crítica con test hermano, no debilitados | OK | 5 specs (`maquina-estados`, `use-case`, `concurrencia`, `integracion`, `ttl`) + e2e. Concurrencia asserta exactamente-1 transición (1 cumplida / 1 rechazada), sin doble extensión de TTL ni colas huérfanas en 2d. Reports step-6/7/8 en verde. |

## Conclusión

Diff conforme a los guardrails duros y a las decisiones humanas D-1, D-7 y D-8. Hallazgos solo de
severidad Menor (fallback de TTL, casts de mapper, dependencia del guard global), ninguno
bloqueante. La concurrencia, la atomicidad y la serialización por `SELECT … FOR UPDATE` están
correctamente implementadas y cubiertas por tests.

Veredicto: APTO

---

## Addendum — verificación de fixes de menores (fecha)

- **Tipo**: pasada de verificación rápida tras el APTO original, posterior a que el
  backend-developer aplicara los 3 hallazgos Menores. Solo lectura. Objetivo: confirmar
  ausencia de regresión y mantener el veredicto.
- **Fecha**: 2026-06-30.

### Menor #1 — Fallback de TTL hardcodeado — OK

`apps/api/src/reservas/application/transicion-pendiente-invitados.use-case.ts`:
- Eliminado el `TTL_CONSULTA_DIAS_DEFECTO = 3` (grep de la constante = 0 ocurrencias).
- `resolverDeltaDias()` (`:353-367`) ahora LANZA `ValidacionBloqueoError` (importado de
  `../domain/bloquear-fecha.service`, `:36`) si `tenantSettings.obtener()` devuelve `null`
  (`:355-359`) o si `plan.ttlDeltaDias === undefined` (`:361-365`). Comportamiento alineado
  verbatim con `BloquearFechaService` (`bloquear-fecha.service.ts:283,305,324`): la falta de
  settings es misconfiguración del tenant, no defecto silencioso. Single source of truth.
- **Precedencia de errores preservada**: `resolverDeltaDias` se invoca en `:300`, DESPUÉS de
  las tres guardas dentro de la tx — 404 existencia (`:247`), 409 bloqueo no vigente/expirado
  (`:266-271`), re-lectura bajo lock + 422 guarda de origen (`:281-295`). Un cross-tenant
  (RLS → 404) o un origen inválido (422) NO se enmascaran como error de settings; el error de
  settings solo aflora en misconfiguración real con la reserva ya validada. Contrato 404→409→422
  intacto. Sin valor de TTL hardcodeado en el flujo.

### Menor #2 — Doble cast del mapper — OK

`apps/api/src/reservas/infrastructure/transicion-pendiente-invitados-uow.prisma.adapter.ts`:
- Eliminado el `as unknown as SubEstadoConsultaPrisma` (`git grep "as unknown as"` sobre el
  fichero = sin coincidencias). `subEstado` se mapea ahora con cast simple `as
  SubEstadoConsultaPrisma` y pasa por `subEstadoPrismaADominio` (`:70-73`), única fuente de
  verdad de la conversión `s2x ↔ 2x` (`sub-estado-consulta.mapper.ts:22-24`, total y
  reversible). El `null` se preserva antes del mapper.
- El cast restante (`fila.estado as EstadoReservaDominio`, `:69`) es el patrón de frontera de
  persistencia aceptado, ahora justificado con comentario (`:45-54`) y simétrico con los
  adaptadores hermanos `transicion-fecha-uow`/`reserva-detalle-query` (literales VERBATIM
  `consulta`/`pre_reserva`…). Conversión de sub_estado correcta; sin doble cast.

### Menor #3 — Guard del controlador — OK

`apps/api/src/reservas/interface/pendiente-invitados.controller.ts`:
- SIN cambio de mecánica: no se introdujo `@UseGuards`/`@Public` local. Solo se añadió un
  comentario (`:40-43`) aclarando que la protección procede del `JwtAuthGuard` global
  (`APP_GUARD`), consistente con los controladores hermanos. No hay guard local inconsistente.

### Reverificación de guardrails clave — sin regresión

- **Hexagonal**: el use-case sigue sin importar `@nestjs/*`/`@prisma/*` (solo puertos +
  `bloquear-fecha.service`/`maquina-estados` de dominio). `ValidacionBloqueoError` es un error de
  DOMINIO, no de framework: su reutilización no rompe la frontera.
- **Atomicidad / `SELECT … FOR UPDATE`**: intactos. El lock sobre la fila bloqueante
  (adapter `:134-141`) y la única `$transaction` (`:242-253`) no se tocaron; `resolverDeltaDias`
  se ejecuta DENTRO de la tx, tras el lock, sin abrir nuevas conexiones ni romper la
  serialización. Sin Redis/locks distribuidos.
- **D-7 (sin email)**: `TransicionPendienteInvitadosDeps` sigue sin puerto de comunicación.
- **D-8 (sin migración)**: `git diff master..HEAD -- apps/api/prisma/` vacío.

### Nota sobre la suite de tests

La suite US-007 (49 tests) pasa. En `pnpm test` completo hay UN fallo en
`alta-consulta-con-fecha-concurrencia.spec.ts`, que pertenece a **US-004** (deadlock PostgreSQL
40P01), reproducible aislado y ajeno al diff de US-007 — ningún archivo de este change lo toca.
El harness lo verificó como **pre-existente, NO regresión** de US-007. No afecta a este veredicto;
queda registrado para seguimiento por el equipo de US-004.

### Conclusión del addendum

Los 3 fixes Menores están correctamente aplicados, sin introducir regresión y sin nuevos
hallazgos. La precedencia de errores 404→409→422, la atomicidad y la serialización por
`SELECT … FOR UPDATE` se mantienen; ya no hay TTL hardcodeado ni doble cast. Se mantiene el
veredicto.

Veredicto: APTO
