# Design — gestion-sesion-ux-modal-f5-error-banner

> Decisiones técnicas del Enfoque A (hook + modal). Cambio SOLO frontend.

## Contexto y restricciones

- **REQ 10 (regla dura):** el access token vive SOLO en memoria de módulo
  (`accessTokenEnMemoria` en `session.tsx`); jamás en `localStorage`/`sessionStorage`.
- **No editar el SDK generado** (`api-client/`, hook `protect-generated-client`):
  toda intercepción se hace vía `apiClient.use(...)` de openapi-fetch.
- **No añadir endpoints ni tocar el backend:** solo se consumen `POST /auth/refresh`
  (ya existente) y el resto del contrato tal cual.

## Decisión 1 — Retry en el interceptor de refresh

**Problema:** `onResponse` devuelve `undefined` tras un refresh exitoso, así que
openapi-fetch mantiene la Response 401 original y TanStack Query la ve como error.

**Diseño:**
- Ampliar `OpcionesMiddlewareRefresh` con `obtenerToken: () => string | null`
  (implementado con `obtenerAccessTokenEnMemoria`).
- En `onResponse`, ante 401 (no de `/auth/refresh`): `await refrescar()`. Si `true`:
  clonar la `request` original, sustituir el header `Authorization` por
  `Bearer <obtenerToken()>`, hacer `fetch(nuevaRequest)` y **devolver esa Response**.
  openapi-fetch usa la Response devuelta por el middleware como resultado final.
- Si `refrescar()` es `false`: `onSesionExpirada()` y devolver la Response 401
  original (no hay a qué reintentar).
- **Anti-recursión conservada:** un 401 de `/auth/refresh` no dispara refresh; se
  deja fluir. El reintento se hace **una sola vez** (no se reintenta el reintento).

**Alternativa descartada:** reintentar desde TanStack Query (`retry` + `onError`).
Se descarta porque acopla la lógica de auth a cada `useQuery`/`useMutation` y no
cubre las llamadas fuera de React.

## Decisión 2 — Estado `recovering` y AuthBootstrap

**Diseño:**
- `Session = { status:'authenticated', user } | { status:'unauthenticated' } |
  { status:'recovering' }`.
- `SessionProvider`: estado inicial `recovering` si `value` es `undefined`; si se
  inyecta `value` (tests / US-000A) se normaliza como hoy.
- `AuthBootstrap` (sin UI, montado en `App.tsx` fuera del Outlet, dentro del
  provider): `useEffect` on-mount → `POST /auth/refresh`. OK → decodificar payload
  del `accessToken` (`atob` del segmento central, sin verificar firma) → mapear a
  `SessionUser` → `iniciarSesion(accessToken, user)`. Fallo → `cerrarSesion()`.
  Guard de ejecución única (evitar doble efecto en StrictMode).
- `RequireAuth`: `recovering` → spinner accesible; `authenticated` → `<Outlet/>`;
  otro → `<Navigate to="/login" .../>`.

**Nota sobre `iniciarSesion` y navegación:** hoy `iniciarSesion` navega a `from ?? /dashboard`.
En recovery on-mount no queremos redirigir fuera de la ruta actual. Se resolverá en
implementación (p. ej. una acción `rehidratarSesion` que puebla sin navegar, o
`iniciarSesion` con flag `navegar=false`). Se decide en TDD para no romper el
comportamiento de login. Esta sutileza se marca para revisión en code-review.

## Decisión 3 — Hook de expiración y evento de renovación

**Diseño:**
- `useSessionExpiry({ onWarn, onExpire, keepSession })` decodifica `exp` (segundos
  epoch) del token en memoria. Programa `setTimeout` en `(exp*1000 - now) - 60_000`
  (aviso) y en `(exp*1000 - now)` (cierre). Limpia timers en cleanup.
- **Evento `slotify:token-refreshed`:** `establecerAccessTokenEnMemoria` despacha
  `window.dispatchEvent(new Event('slotify:token-refreshed'))`. El hook escucha ese
  evento y reprograma los timers con el nuevo `exp`. Así toda vía de renovación
  (login, retry del interceptor, keepSession) converge en un único punto de
  reprogramación, sin acoplar el hook al árbol de React ni a openapi-fetch.
- `keepSession()`: `POST /auth/refresh` → `establecerAccessTokenEnMemoria(nuevo)`
  (que ya dispara el evento y reprograma) → cerrar modal de aviso.
- **Margen de aviso:** 60 s (constante `MARGEN_AVISO_MS`). Si el token tiene ttl
  < 60 s al programar, el aviso se dispara de inmediato.

**Alternativa descartada:** polling periódico del `exp`. Se descarta por gasto
innecesario; los timers exactos bastan al ser el `exp` conocido.

## Decisión 4 — Modales y responsive

- `SessionExpiryWarningModal`: countdown circular SVG (progreso 60→0), textos y dos
  botones. Recibe `segundosRestantes`, `onKeep`, `onLogout`, `abierto`.
- `SessionExpiredModal`: mensaje + botón "Iniciar sesión" (navega a `/login`).
- Ambos con el patrón shadcn/Dialog del proyecto; mobile-first, sin ancho fijo que
  rompa en 390; verificados en QA a 390 / 768 / 1280.
- Los `.tsx` alojan SOLO componentes; constantes/helpers/tipos van a `lib/`
  (guardrail `components/` solo `.tsx`).

## Decisión 5 — Wiring

- `App.tsx`: monta `<AuthBootstrap/>` junto a `<InterceptorRegistrar/>` (dentro del
  provider, fuera del Outlet).
- `RequireAuth.tsx`: renderiza `<SessionExpiryWatcher/>` junto al `<Outlet/>` para
  que solo viva con sesión activa.
- `index.ts`: exportar lo que consuma `App.tsx` (`AuthBootstrap`) y cualquier tipo
  público nuevo; los modales y el watcher son internos de la feature.

## Riesgos

- Transversalidad de `RequireAuth`/interceptor: un error rompe la auth global →
  mitigado con TDD y E2E de los 3 flujos.
- `iniciarSesion` con navegación en el path de recovery (ver Decisión 2) → cubrir
  con test de `AuthBootstrap`.
- Timers y StrictMode doble-montaje → guard de ejecución única y cleanup estricto.
