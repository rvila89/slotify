# Code Review — gestion-sesion-ux-modal-f5-error-banner (step 8)

- Fecha: 2026-07-21
- Revisor: code-reviewer (solo lectura)
- Alcance: diff de la rama `feature/gestion-sesion-ux-modal-f5-error-banner` vs `master`
- Naturaleza: cambio SOLO frontend (`apps/web/`), sin backend/BD/contrato.

## Archivos revisados

Modificados:
- `apps/web/src/App.tsx`
- `apps/web/src/components/ui/dialog.tsx`
- `apps/web/src/features/auth/api/refresh-interceptor.ts`
- `apps/web/src/features/auth/model/session.tsx`
- `apps/web/src/features/auth/components/InterceptorRegistrar.tsx`
- `apps/web/src/features/auth/components/RequireAuth.tsx`
- `apps/web/src/features/auth/index.ts`

Creados:
- `apps/web/src/features/auth/components/AuthBootstrap.tsx`
- `apps/web/src/features/auth/components/SessionExpiryWatcher.tsx`
- `apps/web/src/features/auth/components/SessionExpiryWarningModal.tsx`
- `apps/web/src/features/auth/components/SessionExpiredModal.tsx`
- `apps/web/src/features/auth/lib/useSessionExpiry.ts`
- `apps/web/src/features/auth/lib/jwt.ts`

## Verificación de guardrails

1. REQ 10 — access token solo en memoria: CUMPLE. Ningún archivo de producción escribe en
   `localStorage`/`sessionStorage`. El token vive en `accessTokenEnMemoria` (variable de módulo).
   Las únicas apariciones de `localStorage`/`sessionStorage` son comentarios JSDoc y aserciones de
   test que verifican la NO persistencia (`session.test.tsx`, `AuthBootstrap.test.tsx` comprueban
   `storage.length === 0`).
2. SDK no editado: CUMPLE. `git diff --name-only` no incluye ningún archivo bajo
   `apps/web/src/api-client/`. El retry usa el `fetch` nativo, no reescribe el cliente generado.
3. `components/` solo `.tsx`: CUMPLE. `jwt.ts` y `useSessionExpiry.ts` están en `lib/`. `components/`
   contiene únicamente `.tsx`.
4. Arrow functions: CUMPLE. No hay declaraciones `function` en los archivos nuevos/modificados
   (grep sin resultados). ESLint (`func-style`) pasa limpio sobre todo el diff.
5. Responsive mobile-first: CUMPLE. Los modales heredan `DialogContent` con `w-[calc(100%-2rem)]
   max-w-lg` (ancho fluido con margen lateral, tope en desktop; sin px fijos que rompan). Los pies
   apilan en columna en móvil y pasan a fila en `sm:`; botones `w-full sm:w-auto`. Sin overflow
   horizontal. tasks.md 6.6 documenta verificación en 390/768/1280 (report step-6 E2E).
6. Sin bucles de refresh: CUMPLE. `refresh-interceptor.ts` mantiene la guarda anti-recursión
   (`request?.url?.includes('/auth/refresh')` → `undefined`). El retry se hace con `fetch(reintento)`
   NATIVO (no `apiClient`), por lo que la respuesta del reintento no vuelve a pasar por el middleware:
   un 401 persistente en el reintento se devuelve tal cual, sin re-interceptar. No hay loop posible.
7. Sin imports cruzados entre features: CUMPLE. `features/auth` no importa de otros `features/*`.
   Las únicas referencias a `@/features/...` son tests importando su PROPIO barrel `@/features/auth`
   (permitido). Los módulos internos importan por rutas relativas dentro de la feature.
8. REQ 10 en `AuthBootstrap`: CUMPLE. La rehidratación F5 decodifica el JWT del `accessToken`
   devuelto por `POST /auth/refresh`, lo pasa a `rehidratarSesion(token, user)` (que solo escribe
   memoria + estado React) y NO persiste en storage. Guard `useRef` evita doble POST en StrictMode.
9. Evento `slotify:token-refreshed`: CUMPLE. Constante `EVENTO_TOKEN_REFRESCADO` exportada por el
   barrel y documentada con JSDoc como contrato interno de la feature. No hay race condition: en
   `establecerAccessTokenEnMemoria` el token se asigna a memoria ANTES de despachar el evento, de
   modo que el listener `programar` siempre lee el `exp` nuevo al reprogramar. Todos los caminos de
   renovación (login, retry del interceptor, keepSession, rehidratación F5) pasan por
   `establecerAccessTokenEnMemoria`, por lo que el evento se emite de forma consistente.

## Otros checks del checklist

- Convenciones: nombres/comentarios/errores en español. CUMPLE.
- TS strict sin `any` injustificado: los `as never`/`as unknown as Request` están confinados a los
  dobles de test; el código de producción es tipado. CUMPLE.
- Tests primero y en verde: 46 tests de `apps/web` auth PASAN (11 suites). ESLint pasa sobre el diff.

## Hallazgos

### Baja — fuga menor del intervalo de countdown en `useSessionExpiry.ts`
Ubicación: `apps/web/src/features/auth/lib/useSessionExpiry.ts:75-83` (`timerCierre`).
Regla: limpieza de temporizadores / higiene de efectos.
Al disparar el cierre (`setShowExpired(true)`) NO se limpia `intervaloCuenta`, por lo que el
`setInterval` del countdown sigue ejecutándose (decrementando `secondsLeft`, ya clamped a 0) hasta el
desmontaje del hook. No es un bug de correctitud (el valor queda en 0 y el watcher gestiona el
logout), y `limpiarTemporizadores` corre en cleanup del efecto y en cada `programar`, así que no
persiste tras desmontar. Recomendación: invocar `limpiarTemporizadores()` (o al menos
`clearInterval(intervaloCuenta.current)`) dentro del callback de `timerCierre` para detener el tick
en cuanto la sesión expira.

### Baja — dos ficheros de test para el mismo módulo del interceptor
Ubicación: `apps/web/src/features/auth/__tests__/refresh-interceptor.test.ts` (tracked, actualizado)
y `apps/web/src/features/auth/api/__tests__/refresh-interceptor.test.ts` (nuevo, Pieza 1).
Regla: co-localización de tests / mantenibilidad.
Ambos cubren `crearMiddlewareRefresh` y ambos pasan; no hay contradicción entre ellos. Queda
solapamiento: el fichero histórico bajo `__tests__/` de la raíz de la feature duplica parcialmente el
nuevo, co-localizado junto a `api/`. Recomendación (no bloqueante): consolidar en el co-localizado
`api/__tests__/` y retirar el duplicado de la raíz, o dejar constancia de por qué conviven.

Ningún hallazgo es Bloqueante ni de severidad Alta/Media.

## Veredicto

Todos los guardrails específicos del change (1-9) se cumplen; los dos hallazgos son de severidad
Baja y no comprometen seguridad, contrato ni arquitectura. Tests y lint en verde.

Veredicto: APTO
