# Tasks — gestion-sesion-ux-modal-f5-error-banner

> Cambio SOLO frontend (`apps/web/src/features/auth/`). No hay endpoints nuevos ni
> cambios de backend/BD/contrato. Los pasos manuales de curl aplican de forma
> reducida (no hay endpoints nuevos: se verifica que los existentes siguen intactos);
> el foco de verificación es unit + E2E (frontend). El AGENTE DEBE EJECUTAR las
> pruebas; nunca se delegan al usuario.

## 0. Setup: crear feature branch (OBLIGATORIO — PRIMER PASO — step-0)
- [x] 0.1 Crear branch `feature/gestion-sesion-ux-modal-f5-error-banner` desde `master`
- [x] 0.2 Verificar la branch creada y la branch actual

## 1. ⏸ Gate revisión humana SDD (OBLIGATORIO — review-gate-sdd)
- [x] 1.1 Presentar al humano `proposal.md` + spec-delta (`specs/auth/spec.md`) +
      `design.md` y ESPERAR su OK explícito ANTES de implementar. PARADA obligatoria.

## 2. Tests primero — TDD RED (OBLIGATORIO — tdd-first)
- [x] 2.1 `api/__tests__/refresh-interceptor.test.ts`: ante 401, con `refrescar()`
      OK, el interceptor reejecuta la request con el nuevo `Authorization` y devuelve
      la Response del reintento (2xx); con `refrescar()` fallido invoca
      `onSesionExpirada` y no reintenta; un 401 de `/auth/refresh` no dispara refresh.
- [x] 2.2 `model/__tests__/session.test.tsx`: `SessionProvider` sin `value` arranca
      en `recovering`; con `value` inyectado se normaliza; `establecerAccessTokenEnMemoria`
      despacha el evento `slotify:token-refreshed`.
- [x] 2.3 `components/__tests__/AuthBootstrap.test.tsx`: on mount llama
      `POST /auth/refresh`; éxito → decodifica JWT e inicia sesión (sin persistir en
      storage); fallo → `unauthenticated`.
- [x] 2.4 `lib/__tests__/useSessionExpiry.test.ts`: timers en `exp−60s` (aviso) y
      `exp` (cierre); `keepSession` renueva y reprograma; el evento
      `slotify:token-refreshed` reprograma los timers (usar fake timers).
- [x] 2.5 `components/__tests__/SessionExpiryWarningModal.test.tsx`: countdown y
      botones "Mantener sesión"/"Cerrar sesión" invocan sus callbacks.
- [x] 2.6 `components/__tests__/SessionExpiredModal.test.tsx`: mensaje y botón
      "Iniciar sesión" navega a `/login`.
- [x] 2.7 Confirmar que TODA la batería está en ROJO (RED) antes de implementar.

## 3. Frontend: implementación + revisar/actualizar tests unitarios (OBLIGATORIO — step-N)
- [x] 3.1 Pieza 1 — `api/refresh-interceptor.ts`: añadir `obtenerToken`, retry y
      devolver la nueva Response tras refresh OK (conservar guarda anti-recursión).
- [x] 3.2 Pieza 2 — `model/session.tsx`: estado `recovering`, evento
      `slotify:token-refreshed` en `establecerAccessTokenEnMemoria`; acción de
      rehidratación sin navegar (ver design §2).
- [x] 3.3 Pieza 2 — `components/AuthBootstrap.tsx` (nuevo): recovery on mount.
- [x] 3.4 Pieza 3 — `lib/useSessionExpiry.ts` (nuevo): decodificar `exp`, timers,
      `keepSession`, escucha del evento.
- [x] 3.5 Pieza 4 — `components/SessionExpiryWarningModal.tsx` y
      `components/SessionExpiredModal.tsx` (nuevos), mobile-first.
- [x] 3.6 Pieza 5 — `components/SessionExpiryWatcher.tsx` (nuevo);
      `components/RequireAuth.tsx` (spinner en `recovering` + monta watcher);
      `components/InterceptorRegistrar.tsx` (pasa `obtenerToken`); `App.tsx`
      (monta `AuthBootstrap`); `index.ts` (barrel).
- [x] 3.7 Verificar que toda la batería del paso 2 pasa a VERDE (GREEN) y sin regresiones.

## 4. QA: unit tests + verificación de estado (OBLIGATORIO — step-N+1 — EL AGENTE DEBE EJECUTARLO)
- [x] 4.1 Ejecutar tests dirigidos de los módulos tocados (`apps/web` auth).
- [x] 4.2 Ejecutar la suite requerida: `pnpm lint`, `pnpm typecheck`, `pnpm test` en `apps/web`.
- [x] 4.3 Verificar que NO hay mutación de BD (cambio solo frontend): confirmar que
      no se ha tocado backend/BD; anotar baseline nulo.
- [x] 4.4 Crear report `openspec/changes/gestion-sesion-ux-modal-f5-error-banner/reports/2026-07-21-step-4-unit-test-and-db-verification.md`.
- [x] 4.5 Marcar completado solo tras tests en verde y report creado.

## 5. QA: pruebas manuales con curl (OBLIGATORIO — step-N+2 — EL AGENTE DEBE EJECUTARLO)
- [x] 5.1 Levantar el backend (no hay endpoints nuevos; se verifica no-regresión).
- [x] 5.2 `curl POST /auth/login` (credenciales de seed) → 200 con `accessToken`; anotar token.
- [x] 5.3 `curl POST /auth/refresh` con la cookie de refresh → 200 con nuevo `accessToken`.
- [x] 5.4 `curl POST /auth/refresh` sin cookie / cookie inválida → 401 y limpieza de cookie.
- [x] 5.5 Confirmar que ningún contrato/respuesta ha cambiado respecto a la baseline.
- [x] 5.6 Restaurar BD (login/refresh no mutan datos de negocio; verificar AUDIT_LOG sin residuos indebidos).
- [x] 5.7 Crear report `openspec/changes/gestion-sesion-ux-modal-f5-error-banner/reports/2026-07-21-step-5-curl-endpoint-tests.md`.

## 6. QA: E2E con Playwright MCP (OBLIGATORIO — hay frontend — step-N+3 — EL AGENTE DEBE EJECUTARLO)
- [x] 6.1 Levantar frontend y backend; BD en estado conocido (seed tenant piloto).
- [x] 6.2 Flujo 401 transparente: forzar un access token expirado y comprobar que
      una acción autenticada NO muestra banner de error (el retry lo resuelve).
- [x] 6.3 Flujo F5 recovery: autenticar, recargar la página (F5) y comprobar que se
      ve el spinner de `recovering` y luego se permanece en la ruta protegida sin login.
- [x] 6.4 Flujo F5 sin cookie: sin cookie válida, recargar y comprobar redirección a `/login`.
- [x] 6.5 Flujo aviso de expiración: comprobar el modal de aviso con countdown;
      "Mantener sesión" renueva y cierra el modal; sin reaccionar, el modal de sesión
      cerrada aparece al llegar a `exp`. (LIMITACION: no simulable en E2E real — token dura 15 min; cubierto por unit tests con fake timers)
- [x] 6.6 Verificar en 3 viewports (390 / 768 / 1280) que los modales no rompen ni dan overflow.
- [x] 6.7 Restaurar entorno y estado de BD; mover capturas a `reports/e2e-screenshots/`.
- [x] 6.8 Crear report `openspec/changes/gestion-sesion-ux-modal-f5-error-banner/reports/2026-07-21-step-6-e2e-playwright.md`.

## 7. Docs: actualizar documentación técnica (OBLIGATORIO — step-N+4)
- [x] 7.1 Actualizar `docs/frontend-standards.md` (o doc de auth) con el ciclo de
      sesión: retry transparente del interceptor, recovery en recarga y aviso de expiración.
- [x] 7.2 Anotar el evento `slotify:token-refreshed` como contrato interno de la feature `auth`.

## 8. Code review (OBLIGATORIO — code-review — EL AGENTE DEBE EJECUTARLO)
- [x] 8.1 Ejecutar `code-reviewer` sobre el diff (guardrails: REQ 10 sin persistencia,
      SDK no editado, `components/` solo `.tsx`, arrow functions, responsive, sin bucles de refresh).
- [x] 8.2 Dejar informe `openspec/changes/gestion-sesion-ux-modal-f5-error-banner/reports/2026-07-21-step-8-code-review.md` con `Veredicto: APTO`.

## 9. ⏸ Gate revisión humana final (OBLIGATORIO — review-gate-final)
- [x] 9.1 Tras code-review APTO + validación manual, ESPERAR el OK humano ANTES de archive/PR. PARADA obligatoria.

## 10. Archivar change + abrir PR (OBLIGATORIO — archive)
- [x] 10.1 `openspec archive gestion-sesion-ux-modal-f5-error-banner` y abrir PR
      (solo tras gate final y code-review APTO).
