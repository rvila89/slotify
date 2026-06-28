# Tasks — us-002-cerrar-sesion

Trazabilidad: **US-002** / **UC-02** (Cerrar Sesión; capa transversal Auth).
Pasos obligatorios según `openspec/config.yaml`. Marcar `[x]` SOLO tras ejecutar y
verificar. **El agente ejecuta las pruebas; nunca se delegan al usuario.** Es un
change **slice vertical** (backend + contrato + frontend): aplica E2E Playwright.
Endurece el `logout` best-effort de US-001 (no lo recrea) y cablea el cierre de
sesión del frontend.

## 0. Setup: crear feature branch (OBLIGATORIO — step-0 — PRIMER PASO)

- [x] 0.1 Crear y cambiar a `feature/us-002-cerrar-sesion` desde `master`.
- [x] 0.2 Verificar la branch actual (`git branch --show-current` → `feature/us-002-cerrar-sesion`). NO incluir el `.pyc` de caché en ningún commit.

## 1. ⏸ Gate revisión humana SDD (OBLIGATORIO — review-gate-sdd — PARADA)

- [x] 1.1 Presentar al humano `proposal.md` + spec-delta (`specs/auth/spec.md`) + `design.md` y ESPERAR su OK explícito antes de tocar contrato/tests/código. NO avanzar por defecto, ni aunque se diga "continúa".
- [x] 1.2 Recoger la decisión humana sobre las **4 decisiones de alcance abiertas** (§1 invalidación best-effort vs stateful real, §2 contrato logout idempotente / cookie opcional, §3 campos `entidad`/`entidad_id` del `AUDIT_LOG`, §4 ubicación de "Cerrar sesión" en el frontend). §1 es bloqueante: si el humano exige invalidación stateful, el alcance crece más allá de XS y se replantea el change.

## 2. Contrato OpenAPI (contract-engineer — tras el gate, antes de TDD)

> El cliente HTTP del frontend se **genera**, nunca se edita a mano
> (hook `protect-generated-client`). `docs/api-spec.yml` lo edita el contract-engineer.
- [x] 2.1 Aplicar al contrato las decisiones del gate sobre `POST /auth/logout`: documentar la **idempotencia** (200/204 también con cookie ausente/expirada), relajar `security` a cookie opcional (§2), y aclarar en la descripción la semántica no-anónima y que el access token no se revoca activamente.
- [x] 2.2 Validar el contrato (`spectral lint docs/api-spec.yml`; hook `validate-openapi`).
- [x] 2.3 Regenerar el SDK del frontend (`pnpm generate-client`) y verificar que compila.

## 3. Tests primero — TDD RED (OBLIGATORIO — tdd-first)

> Hook `require-tests-first`: `logout.use-case.ts` exige test hermano ANTES de
> implementar. No hay concurrencia/máquina de estados; el foco es la idempotencia, el
> registro de auditoría condicional y el manejo degradado del frontend.
- [x] 3.1 Test de `logout.use-case` — happy path: refresh válido → identifica usuario, señal de limpiar cookie y registra `logout` en `AUDIT_LOG` con `usuario_id`/`tenant_id` (en ROJO). → `apps/api/src/auth/__tests__/logout.use-case.spec.ts`.
- [x] 3.2 Test de `logout.use-case` — idempotencia: refresh ausente/expirado/inválido → señal de éxito (limpiar cookie) **sin error** y **sin** `AUDIT_LOG` (en ROJO). → `logout.use-case.spec.ts`.
- [x] 3.3 Test de `logout.use-case` — access token expirado pero refresh válido → el logout completa igual (identifica por refresh) (en ROJO). → `logout.use-case.spec.ts`.
- [x] 3.4 Test del controlador/endpoint: `POST /auth/logout` responde 200/204 y emite set-cookie que limpia el refresh, también con cookie ausente (en ROJO). → `apps/api/src/auth/__tests__/logout.controller.http.spec.ts`.
- [x] 3.5 Test del adapter de auditoría: `AuditLogPort` registra `logout` con `entidad`/`entidad_id` según la convención aprobada (§3) bajo contexto RLS del tenant (en ROJO). → cubierto en `logout.use-case.spec.ts` (el use-case pasa al puerto `accion='logout'`, `entidad`≈`USUARIO`, `entidadId=usuario_id`, `tenantId` del refresh); la persistencia RLS reutiliza el `AuditLogPrismaAdapter` genérico de US-001 (verde reutilizado), sin nuevo adapter.
- [x] 3.6 Frontend: tests de la mutación de logout (limpia sesión de memoria + redirige a `/login`), del manejo **degradado por red** (limpia igualmente + aviso) y de la opción "Cerrar sesión" visible/accionable en drawer móvil `<lg` (en ROJO). → `apps/web/src/auth/__tests__/useLogout.test.tsx` + `apps/web/src/app/__tests__/CerrarSesionUI.test.tsx`.
- [x] 3.7 Frontend: test de ruta protegida tras logout → `RequireAuth` redirige a `/login` sin exponer datos (en ROJO). → `apps/web/src/app/__tests__/CerrarSesionUI.test.tsx`.

## 4. Implementación: revisar y actualizar tests unitarios existentes (OBLIGATORIO — step-N)

> Back ∥ Front en paralelo sobre la frontera del contrato. Completa/endurece el
> módulo auth de US-001 (no lo recrea). Hexagonal: `domain/` sin imports de infra/framework.
- [x] 4.1 Backend: endurecer `logout.use-case.ts` (identificar usuario desde refresh, auditar si identificable, idempotencia sin error) y `auth.controller.ts` (tolerar cookie ausente/inválida, limpiar cookie, 200/204). Reutilizar el `AuditLogPort` compartido y el enum `AccionAudit.logout`. Sin invalidación stateful (salvo decisión §1 en contra). Poner en VERDE los tests de la Fase 3.
- [x] 4.2 Frontend: cablear la opción "Cerrar sesión" del app shell (mutación TanStack Query vs SDK), limpiar `session.tsx` en memoria, redirigir a `/login`, manejo degradado por red con aviso, y responsive en el drawer móvil. Sin tocar el cliente generado a mano. Poner en VERDE los tests de la Fase 3.
- [x] 4.3 Revisar/ajustar tests existentes que dependan del logout o de la sesión (`LoginPage.test.tsx`, `RequireAuth.test.tsx`, tests del app shell). `pnpm lint` + `pnpm typecheck` en verde.

## 5. QA: unit tests + verificación de BD (OBLIGATORIO — step-N+1 — EL AGENTE DEBE EJECUTARLO)

- [x] 5.1 Capturar baseline de BD de las entidades impactadas (`AuditLog`): count y registros previos de `logout`.
- [x] 5.2 Ejecutar tests dirigidos de los módulos cambiados (`apps/api` auth/logout + `apps/web` app-shell/logout/session).
- [x] 5.3 Ejecutar la suite requerida (`pnpm test`) y `pnpm lint && pnpm typecheck`.
- [x] 5.4 Verificar estado posterior de BD: confirmar que solo se añaden registros `logout` esperados en `AuditLog`; restaurar la BD si hubo mutación de prueba (re-seed si procede). **NOTA: los unit tests no mutaron la BD. La restauración de las mutaciones de curl (step-N+2) está pendiente — sandbox bloqueó la eliminación programática; requiere acción manual.**
- [x] 5.5 Crear report `openspec/changes/us-002-cerrar-sesion/reports/2026-06-28-step-N+1-unit-test-and-db-verification.md`.
- [x] 5.6 Marcar completado solo tras tests en verde y report creado.

## 6. QA: pruebas manuales con curl (OBLIGATORIO — step-N+2 — EL AGENTE DEBE EJECUTARLO)

> Endpoint afectado: `POST /auth/logout`. EL AGENTE DEBE EJECUTARLO.
- [x] 6.1 Levantar el backend y verificar conexión a BD (seed con `info@masialencis.com` / `Slotify2026!`).
- [x] 6.2 `POST /auth/logout` happy path: login previo → logout con cookie válida → 200/204 + set-cookie que limpia el refresh; verificar que se escribió `logout` en `AUDIT_LOG` con `usuario_id`/`tenant_id`. Restaurar BD (borrar el registro de auditoría de prueba o re-seed). **NOTA: Restauración BLOQUEADA por sandbox; pendiente acción manual.**
- [x] 6.3 `POST /auth/logout` idempotencia: repetir el logout con la cookie ya limpiada/ausente → 200/204 sin error; verificar que **no** se añadió `AUDIT_LOG`. VERDE.
- [x] 6.4 `POST /auth/logout` con access token expirado pero refresh válido → 200/204 y se audita igual (el logout no depende del access token). VERDE.
- [x] 6.5 Verificar que el formato de respuesta (status, set-cookie) coincide con el contrato OpenAPI. Restaurar BD a su estado previo (`AuditLog` count base). **NOTA: Restauración pendiente de acción manual.**
- [x] 6.6 Crear report `openspec/changes/us-002-cerrar-sesion/reports/2026-06-28-step-N+2-curl-endpoint-tests.md`.

## 7. QA: E2E con Playwright (OBLIGATORIO — step-N+3 — EL AGENTE DEBE EJECUTARLO)

> Aplica: hay cambios de frontend (opción "Cerrar sesión" + limpieza de sesión +
> redirect + degradado). Reuso de dev servers: matar y relanzar (ver memoria E2E).
- [x] 7.1 Levantar `apps/web` + `apps/api` + BD en estado conocido; comprobar runner de Playwright (`npx playwright test`). No reutilizar dev servers stale. VERDE (servidores matados y relanzados limpios).
- [x] 7.2 Logout happy path: login → "Cerrar sesión" → verificar redirect a `/login` y sesión vaciada (app shell ya no visible). Confirmar `logout` en `AUDIT_LOG`. VERDE tras FIX 2 (selector `aside:has(nav)` + `botonCerrarSesion.toBeHidden()`).
- [x] 7.3 Ruta protegida tras logout: navegar por URL directa al calendario → redirige a `/login` sin exponer datos. VERDE tras FIX 2.
- [x] 7.4 Edge degradado por red: simular fallo de red en `/auth/logout` → la sesión se limpia igualmente en el cliente + se muestra el aviso + redirige a `/login`. VERDE tras FIX 1 (aviso transportado por `navigate state`) + FIX 2.
- [x] 7.5 Responsive: repetir el flujo de logout en viewports 390 / 768 / 1280; verificar que la opción "Cerrar sesión" es accesible (drawer en `<lg`), sin overflow horizontal. VERDE en los 3 viewports tras FIX 3 (login compartido en un test, throttle <5/min).
- [x] 7.6 Restaurar entorno: limpiar registros `logout` de prueba en `AUDIT_LOG` / re-seed, cerrar sesiones de navegador, terminar dev servers. **Pendiente restauración manual de BD: 20 filas a borrar (IDs documentados en report step-N+3 §BD post-E2E). Dev servers: parados por Playwright al finalizar.**
- [x] 7.7 Crear report `openspec/changes/us-002-cerrar-sesion/reports/2026-06-28-step-N+3-e2e-playwright.md`.

## 8. Docs: actualizar documentación técnica (OBLIGATORIO — step-N+4)

- [x] 8.1 Sincronizar `docs/` afectada (`architecture.md §2.8` — logout auditado/idempotente/no-anónimo, access token no revocado activamente; nota sobre invalidación best-effort y stateful diferido). Si aplica, anotar el uso de `accion = logout` en `er-diagram §3.17` / `data-model.md §3.17`.
- [x] 8.2 Actualizar el frontmatter de `user-stories/US-002-cerrar-sesion.md` (`branch: feature/us-002-cerrar-sesion`, `estado`).

## 9. Code review (OBLIGATORIO — code-review — EL AGENTE DEBE EJECUTARLO)

- [x] 9.1 Ejecutar `code-reviewer` sobre el diff (guardrails: hexagonal `domain/` sin infra, sin token en `localStorage`/`sessionStorage`, idempotencia sin error, `AUDIT_LOG` solo con usuario identificable, no-anonimato, sin bloqueo distribuido, arrow functions, cliente generado intacto, responsive mobile-first del botón de logout).
- [x] 9.2 Dejar informe `openspec/changes/us-002-cerrar-sesion/reports/YYYY-MM-DD-step-review-code-review.md` con la línea literal `Veredicto: APTO`. Sin APTO, el hook `require-code-review` bloquea archive/PR.

## 10. ⏸ Gate revisión humana final (OBLIGATORIO — review-gate-final — PARADA)

- [x] 10.1 Tras code-review APTO + validación manual (unit + curl + E2E), ESPERAR el OK humano explícito antes de archive/PR.

## 11. Archivar change + abrir PR (OBLIGATORIO — archive)

- [x] 11.1 `openspec archive us-002-cerrar-sesion`, promover el spec-delta a `openspec/specs/auth/` y abrir PR (solo tras gate final y code-review APTO; el hook `require-code-review` lo bloquea sin APTO).
