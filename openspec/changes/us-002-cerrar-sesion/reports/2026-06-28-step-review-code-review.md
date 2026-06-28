# Code-review — US-002 "Cerrar Sesión"

- Fecha: 2026-06-28
- Rama: `feature/us-002-cerrar-sesion` (working tree, sin commit; incluye untracked)
- Revisor: code-reviewer (solo lectura)
- Skills cargadas: `review-checklist`, `architecture-guardrails`
- Alcance: backend (use-case/controller/module + tests), contrato + SDK generado, frontend (hook/UI + tests), E2E.

---

## Resumen ejecutivo

Implementación limpia y bien alineada con las decisiones del Gate 1. No se detectan
**Bloqueantes**. Hexagonal respetado, bloqueo de fecha no aplica (sin tocar fechas),
multi-tenancy correcta (tenant del refresh/JWT), arrow-functions cumplido, responsive
con evidencia en 3 viewports. Hay un puñado de observaciones menores (Baja) de higiene
de código y coherencia, ninguna bloquea el merge.

---

## Bloqueantes

Ninguno.

---

## Verificación de las decisiones del Gate 1

- **§1 Logout best-effort / stateless** — CUMPLE.
  `logout.use-case.ts` solo verifica el refresh y, si identifica usuario, audita; no
  hay invalidación stateful. El controlador (`auth.controller.ts:184-187`) limpia la
  cookie y devuelve 204. La deuda post-MVP queda documentada en `api-spec.yml` y en el
  JSDoc del use-case.

- **§2 Cookie opcional / idempotente (nunca 401)** — CUMPLE.
  `logout.use-case.ts:39-50`: refresh ausente/`''` → retorna sin auditar; refresh
  inválido/expirado → `try/catch` retorna sin error. Controlador marcado `@Public()`
  (`auth.controller.ts:164`), limpia cookie SIEMPRE. Tests HTTP cubren doble logout y
  ausencia de cookie devolviendo 200/204 y `not 401`
  (`logout.controller.http.spec.ts:113-128`).

- **§3 AUDIT_LOG (entidad='Usuario', entidad_id=usuario_id, accion='logout', usuario_id,
  tenant_id)** — CUMPLE.
  `logout.use-case.ts:52-58` registra exactamente esos campos con `tenantId`/`sub` del
  payload del refresh (convención de login). Verificado en
  `logout.use-case.spec.ts` (happy path + multi-tenant) y curl report.

- **§4 Botón "Cerrar sesión" en pie del sidebar / drawer responsive (<lg), redirige a
  /login** — CUMPLE.
  `SidebarContent.tsx` añade el botón en el pie; E2E confirma botón en aside fijo en
  1280 y dentro del `dialog`/drawer en 390 y 768, con redirección a `/login`.

---

## Cumplimiento de reglas duras

- **Hexagonal** — OK. `logout.use-case.ts` solo importa *tipos* de puertos
  (`AuditLogPort`, `TokenEmitterPort`) desde `application/login.use-case`; sin
  `@nestjs/*`, `@prisma/*` ni `infrastructure/`. La inyección se resuelve en
  `auth.module.ts` (factory) y el adaptador HTTP en el controller.

- **Multi-tenancy / RLS** — OK. El `tenant_id` proviene del payload del refresh token
  (JWT), nunca del path/body. `logout.controller.http.spec.ts:145-158` prueba que un
  `usuarioId`/`tenantId` enviado en el body se ignora (no-anónimo, solo sesión propia).

- **Bloqueo de fecha / Redis** — N/A. La US no toca fechas; grep sin coincidencias de
  redis/redlock/ioredis en `apps/api/src/auth`.

- **Arrow functions (func-style expression)** — OK. Grep de `function` declarativa en
  todo el código nuevo de `apps/api`, `apps/web` y `e2e/logout.spec.ts`: ninguna. Los
  métodos `ejecutar`/`logout` son métodos de clase (exentos).

- **Cliente HTTP generado** — OK/coherente. `schema.d.ts` refleja `api-spec.yml`
  (descripción ampliada + respuestas 200 y 204). No hay incoherencias respecto al
  contrato. Recomendación menor abajo.

- **Importes en Decimal** — N/A (sin importes en esta US).

- **DTOs / class-validator** — N/A: `logout` no tiene body (`requestBody?: never`).

- **Errores y comentarios en español** — OK.

- **Tests primero (TDD)** — OK. Existen y, según reports de QA, pasan: dominio
  (`logout.use-case.spec.ts`), HTTP (`logout.controller.http.spec.ts`), hook
  (`useLogout.test.tsx`), UI (`CerrarSesionUI.test.tsx`, `LoginPage.test.tsx`) y E2E
  (`e2e/logout.spec.ts`).

---

## Responsive (mobile-first, 390 / 768 / 1280)

CUMPLE con evidencia.
- Botón `w-full` con `rounded-full`/`py-3`, sin anchos px fijos que rompan en móvil.
- Banner de aviso en `LoginPage` usa clases seguras (`mb-8`, `size-4`, `text-[14px]`
  solo tamaño de fuente, no ancho); icono `shrink-0`.
- `e2e/logout.spec.ts` valida: 1280 → aside fijo visible + hamburguesa oculta; 390 y
  768 → aside oculto + hamburguesa + botón dentro del `dialog`; asercion explícita de
  ausencia de overflow horizontal (`scrollWidth <= viewport`) en 390 y 768.

---

## Observaciones no bloqueantes

- **[Baja · código muerto / consistencia ARIA]** `SidebarContent.tsx` (bloque
  `{aviso ? <p role="alert">…</p> : null}`) consume `aviso` de `useLogout`, pero
  `useLogout` SIEMPRE navega a `/login` en el `finally`, desmontando `SidebarContent`
  antes de pintar. Ese párrafo nunca se mostrará: es código muerto. Además usa
  `role="alert"` mientras que el aviso real ahora vive en `LoginPage` con
  `role="status"`. Recomendación: eliminar el bloque de aviso de `SidebarContent` (y,
  si se desea, recortar `aviso` de la superficie de retorno de `useLogout`, dejándolo
  solo si aporta valor a tests). No afecta a la funcionalidad: el banner persistente de
  `/login` es el mecanismo correcto y está cubierto por test y E2E.

- **[Baja · duplicación de constante]** `LoginPage.test.tsx` redeclara el literal
  `AVISO_DEGRADADO` en vez de importar `AVISO_DEGRADADO` desde `@/auth/useLogout`. Si el
  texto cambia, el test podría quedar desincronizado. Recomendación: importar la
  constante exportada.

- **[Baja · contrato/SDK]** El diff de `schema.d.ts` es coherente con `api-spec.yml`,
  pero conviene confirmar que se regeneró vía el flujo de `contract-engineer`
  (contract-sync) y no se editó a mano. La alternativa de seguridad `{}` (sin auth) de
  `api-spec.yml` no se refleja en el tipo generado, lo cual es normal en
  openapi-typescript; no es incoherencia.

- **[Baja · doc/comentario obsoleto]** El encabezado JSDoc de `auth.controller.ts:10`
  aún describe `POST /auth/logout` como "(autenticado): 204"; con `@Public()` y cookie
  opcional ya no es "autenticado". Actualizar el comentario para evitar confusión.

---

## Veredicto

APTO para merge. Sin Bloqueantes; las observaciones son de severidad Baja (higiene de
código y comentarios) y pueden abordarse en este PR o como follow-up sin condicionar el
cierre.

Veredicto: APTO
