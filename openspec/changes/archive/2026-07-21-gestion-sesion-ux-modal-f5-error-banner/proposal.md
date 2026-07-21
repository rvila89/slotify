# Change: gestion-sesion-ux-modal-f5-error-banner

> Mejora de UX en la **gestión de sesión** del frontend (`apps/web`). Cambio
> **SOLO frontend**: NO toca el contrato OpenAPI (`api-spec.yml`), el backend
> NestJS, Prisma, la BD ni el SDK generado (`api-client/`). No añade endpoints ni
> altera la duración de los tokens (access 15 min / refresh 7 días). Todo el
> trabajo vive en `apps/web/src/features/auth/`. Respeta la regla dura REQ 10 de
> US-001: el access token vive SOLO en memoria, nunca en
> `localStorage`/`sessionStorage`.

## Why

La gestión de tokens de Slotify (US-001 login, US-002 logout) es correcta en el
backend, pero la experiencia de sesión en el frontend tiene tres defectos que
degradan la usabilidad:

1. **Banner de error rojo en cada 401 (bug real).** El interceptor de refresh
   (`api/refresh-interceptor.ts`, `crearMiddlewareRefresh`) intercepta el 401,
   llama a `POST /auth/refresh` y actualiza el access token en memoria, **pero
   devuelve `undefined`** en `onResponse`. Con ello openapi-fetch deja pasar la
   **Response 401 original** a TanStack Query, que la trata como error: el usuario
   ve un banner rojo y debe reintentar manualmente, pese a que el refresh fue
   exitoso. La conducta esperada (descrita ya en la spec `auth` de US-001: "un
   interceptor que, ante un access token expirado, intente renovar vía
   `/auth/refresh` antes de fallar") no se cumple porque falta el **retry**: tras
   renovar hay que reejecutar la petición original con el nuevo token y devolver
   esa nueva Response. (Fuente: `auth/spec.md` REQ "Sesión del frontend en memoria",
   REQ "Renovación de access token vía refresh"; US-001 §Happy Path,
   §Reglas de Validación.)

2. **F5 / recarga cierra la sesión (bug de UX).** El `SessionProvider`
   (`model/session.tsx`) arranca en estado `unauthenticated` cuando no hay `value`
   inyectado, y `RequireAuth` redirige inmediatamente a `/login`. Como el access
   token es memoria volátil (se pierde al recargar), un simple F5 expulsa al gestor
   al login **aunque la cookie de refresh (`httpOnly`, 7 días) siga siendo
   válida**. No existe un "silent refresh on mount" que rehidrate la sesión desde
   la cookie. (Fuente: `auth/spec.md` REQ "Renovación de access token vía refresh",
   REQ "Rutas protegidas"; US-001 §Edge case refresh token.)

3. **Sin aviso de expiración de sesión.** El gestor no recibe ningún preaviso
   cuando el access token (15 min) está a punto de caducar; simplemente empieza a
   ver 401 (que hoy, con el bug 1, se manifiestan como banners de error). Se
   adopta el patrón CaixaBank: un **modal de aviso con countdown 60 s** antes de
   expirar, con opción de mantener la sesión, y un **modal de sesión cerrada** si
   no reacciona. (Fuente: petición de usuario; patrón bancario de referencia;
   coherente con `auth/spec.md` REQ "Sesión del frontend en memoria".)

## What Changes

Cinco piezas acotadas, todas bajo `apps/web/src/features/auth/`:

1. **Fix del interceptor con retry (`api/refresh-interceptor.ts`).** Se amplía
   `OpcionesMiddlewareRefresh` con `obtenerToken: () => string | null`. Tras un
   refresh exitoso, el interceptor **reconstruye la Request original con el nuevo
   header `Authorization`**, hace `fetch()` y **devuelve la nueva Response**, de
   modo que TanStack Query ve un 2xx y **nunca** el 401. Si el refresh falla, se
   invoca `onSesionExpirada()` como hoy. Se mantiene la guarda anti-recursión del
   propio `/auth/refresh`.

2. **Recuperación de sesión en recarga — F5 recovery (`model/session.tsx` +
   nuevo `components/AuthBootstrap.tsx`).** Se amplía el tipo `Session` con un
   tercer estado `| { status: 'recovering' }`. El `SessionProvider` arranca en
   `recovering` cuando **no** hay `value` inyectado (los tests siguen pudiendo
   inyectar sesión). El nuevo `AuthBootstrap` (componente sin UI, montado en
   `App.tsx`) al montar llama `POST /auth/refresh`; si responde OK, decodifica el
   JWT (sin verificar firma, solo lectura del payload) y llama `iniciarSesion()`;
   si falla, llama `cerrarSesion()` (pasa a `unauthenticated`).

3. **Hook de expiración (`lib/useSessionExpiry.ts`).** Decodifica el `exp` del JWT
   en memoria (base64 del payload, sin verificar firma). Programa un timer en
   `exp − 60 s` que activa el modal de aviso, y otro en `exp` que fuerza logout si
   el modal sigue abierto. Expone `keepSession()` (llama a refresh, obtiene nuevo
   token y reprograma los timers). `establecerAccessTokenEnMemoria` despacha un
   evento `slotify:token-refreshed` para que el hook reprograme los timers
   automáticamente ante cualquier renovación (login, refresh del interceptor,
   keepSession).

4. **Modales (`components/`).** `SessionExpiryWarningModal` (countdown circular SVG
   60→0, botones "Mantener sesión" / "Cerrar sesión") y `SessionExpiredModal`
   ("Tu sesión se ha cerrado por inactividad", botón "Iniciar sesión"). Ambos
   mobile-first y responsive (regla dura CLAUDE.md).

5. **Wiring (`components/SessionExpiryWatcher.tsx` + `RequireAuth.tsx` +
   `App.tsx`).** `SessionExpiryWatcher` consume el hook y renderiza los modales;
   se monta **dentro del Outlet autenticado** (RequireAuth). `RequireAuth` pasa a
   distinguir tres casos: `recovering` → spinner de carga; no `authenticated` →
   redirect a `/login`; `authenticated` → Outlet. `App.tsx` monta `AuthBootstrap`.
   Se actualiza el barrel `index.ts`.

## Impact

- **Ámbito:** exclusivamente `apps/web` (frontend SPA), feature `auth`.
- **NO afectado:** contrato OpenAPI (`api-spec.yml`), backend NestJS, Prisma, BD,
  SDK generado (`api-client/`), endpoints existentes, duración de tokens
  (15 m / 7 d), la persistencia del access token (sigue SOLO en memoria, REQ 10).
- **Specs afectadas:** capability **`auth`**. Se **añaden** requisitos de conducta
  frontend (retry del interceptor, F5 recovery, aviso de expiración) y se
  **modifica** el requisito existente "Sesión del frontend en memoria sin
  almacenamiento persistente" para incorporar el estado `recovering` y el retry
  transparente del interceptor. Ver spec-delta.
- **Archivos de producción modificados:**
  - `apps/web/src/features/auth/model/session.tsx` (estado `recovering`, evento
    `slotify:token-refreshed`)
  - `apps/web/src/features/auth/api/refresh-interceptor.ts` (retry + `obtenerToken`)
  - `apps/web/src/features/auth/components/InterceptorRegistrar.tsx` (pasa
    `obtenerToken` al interceptor)
  - `apps/web/src/features/auth/components/RequireAuth.tsx` (spinner en
    `recovering`; monta `SessionExpiryWatcher`)
  - `apps/web/src/App.tsx` (monta `AuthBootstrap`)
  - `apps/web/src/features/auth/index.ts` (barrel)
- **Archivos de producción nuevos:**
  - `apps/web/src/features/auth/components/AuthBootstrap.tsx`
  - `apps/web/src/features/auth/components/SessionExpiryWatcher.tsx`
  - `apps/web/src/features/auth/components/SessionExpiryWarningModal.tsx`
  - `apps/web/src/features/auth/components/SessionExpiredModal.tsx`
  - `apps/web/src/features/auth/lib/useSessionExpiry.ts`
- **Tests añadidos (TDD primero):**
  - `api/__tests__/refresh-interceptor.test.ts` (retry con nuevo token tras 401)
  - `model/__tests__/session.test.tsx` (estado `recovering`, evento token-refreshed)
  - `components/__tests__/AuthBootstrap.test.tsx` (recovery on mount, éxito/fallo)
  - `lib/__tests__/useSessionExpiry.test.ts` (timers, keepSession, evento)
  - `components/__tests__/SessionExpiryWarningModal.test.tsx`
  - `components/__tests__/SessionExpiredModal.test.tsx`
- **Riesgo:** medio. El interceptor y `RequireAuth` son transversales a toda la
  app; un fallo afectaría a la autenticación global. Mitigación: TDD estricto,
  guarda anti-recursión conservada, E2E de los tres flujos (401 transparente, F5,
  expiración) y QA en 3 viewports (390 / 768 / 1280).
- **Verificación:** `pnpm lint` + `pnpm typecheck` + `pnpm test` verdes en
  `apps/web`; E2E Playwright de los tres flujos; QA manual en 3 viewports.

## Decisiones abiertas (a validar en el gate SDD)

- **(a) Capability destino.** Se usa la capability existente `auth` en vez de
  abrir una `auth-ui` dedicada, porque `auth/spec.md` ya alberga la conducta de
  sesión del frontend (REQ "Sesión del frontend en memoria", "Cierre de sesión
  desde el frontend", "Rutas protegidas"). Alternativa: capability frontend
  separada, coherente con el patrón `pipeline-ui`/`ficha-consulta-ui`.
- **(b) Decodificación del JWT en cliente.** El hook y `AuthBootstrap` leen el
  payload del JWT (`exp`, `sub`, `tenantId`, `rol`, `email`) **sin verificar
  firma**: es lectura de un token que el cliente ya posee, no una validación de
  seguridad (esa la hace el backend en cada request). Se documenta como tal.
- **(c) Umbral de aviso.** 60 s antes de `exp`, siguiendo el patrón CaixaBank de
  referencia. Ajustable si se prefiere otro margen.
