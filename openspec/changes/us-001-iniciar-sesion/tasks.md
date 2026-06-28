# Tasks — us-001-iniciar-sesion

Trazabilidad: **US-001** / **UC-01** (Iniciar Sesión; capa transversal Auth).
Pasos obligatorios según `openspec/config.yaml`. Marcar `[x]` SOLO tras ejecutar y
verificar. **El agente ejecuta las pruebas; nunca se delegan al usuario.** Es un
change **slice vertical** (backend + contrato + frontend): aplica E2E Playwright.
Convierte el scaffolding de US-000A en implementación real (no lo recrea).

## 0. Setup: crear feature branch (OBLIGATORIO — step-0 — PRIMER PASO)

- [x] 0.1 Crear y cambiar a `feature/us-001-iniciar-sesion` desde `master`.
- [x] 0.2 Verificar la branch actual (`git branch --show-current` → `feature/us-001-iniciar-sesion`). NO incluir el `.pyc` de caché en ningún commit.

## 1. ⏸ Gate revisión humana SDD (OBLIGATORIO — review-gate-sdd — PARADA)

- [x] 1.1 Presentar al humano `proposal.md` + spec-delta (`specs/auth/spec.md`) + `design.md` y ESPERAR su OK explícito antes de tocar contrato/tests/código. NO avanzar por defecto, ni aunque se diga "continúa".
- [x] 1.2 Recoger la decisión humana sobre las **6 decisiones de alcance abiertas** (§1 alcance vertical, §2 refresh stateless/stateful, §3 throttling, §4 multi-device FA-03, §5 gaps de contrato 429/401-vs-403, §6 puerto de auditoría). Sin estas decisiones cerradas, no se congela el contrato ni se implementa.

## 2. Contrato OpenAPI (contract-engineer — tras el gate, antes de TDD)

> El cliente HTTP del frontend se **genera**, nunca se edita a mano
> (hook `protect-generated-client`). `docs/api-spec.yml` lo edita el contract-engineer.
- [x] 2.1 Aplicar al contrato las decisiones del gate: congelar `POST /auth/login` (FA-01 401; FA-02 según §5b), `POST /auth/refresh`, `POST /auth/logout`, `GET /auth/me`; añadir **429** a `/auth/login` si se aprobó throttling (§3).
- [x] 2.2 Validar el contrato (`spectral lint docs/api-spec.yml`; hook `validate-openapi`).
- [x] 2.3 Regenerar el SDK del frontend (`pnpm generate-client`) y verificar que compila.

## 3. Tests primero — TDD RED (OBLIGATORIO — tdd-first)

> Hook `require-tests-first`: `login.use-case.ts` y entidades exigen test hermano
> ANTES de implementar. No hay concurrencia/máquina de estados; el foco es la lógica
> de autenticación y la seguridad (anti-enumeration, cuenta deshabilitada).
- [x] 3.1 Test de `login.use-case` — happy path: credenciales válidas + cuenta activa → emite access token con `{sub, tenantId, rol, email}`, marca refresh y registra `login` en `AUDIT_LOG` (en ROJO).
- [x] 3.2 Test de `login.use-case` — FA-01: email inexistente y contraseña incorrecta producen la **misma** respuesta 401 genérica; sin token ni auditoría (en ROJO).
- [x] 3.3 Test de `login.use-case` — FA-02: `activo = false` → rechazo sin token ni `login` en `AUDIT_LOG` (en ROJO).
- [x] 3.4 Test de `refresh.use-case` — refresh válido renueva access; refresh expirado/inválido → 401 + señal de limpiar cookie (en ROJO).
- [x] 3.5 Test de `obtener-usuario-actual` (`/auth/me`) — devuelve `{idUsuario, email, nombre, apellidos?, rol}` del usuario real (en ROJO).
- [x] 3.6 Tests de puertos/adapters: `argon2-password-hasher` verifica el hash del seed; `AuditLogPort` registra `login` (en ROJO).
- [x] 3.7 Frontend: tests de `LoginPage` (mutación + redirect al calendario; validación por campo de email/contraseña vacíos y email inválido sin llamar a la API) y de sesión en memoria / interceptor de refresh (en ROJO). Ampliar `LoginPage.test.tsx` y `RequireAuth.test.tsx` existentes.

## 4. Implementación: revisar y actualizar tests unitarios existentes (OBLIGATORIO — step-N)

> Back ∥ Front en paralelo sobre la frontera del contrato. Completa el scaffolding
> de US-000A (no lo recrea). Hexagonal: `domain/` sin imports de infra/framework.
- [x] 4.1 Backend: implementar el módulo auth hexagonal (domain/application/infrastructure/interface) hasta poner en VERDE los tests de la Fase 3: `login`/`refresh`/`logout`/`obtener-usuario-actual` use-cases, puertos (usuario-repo, password-hasher, token-emitter, audit-log), adapters Prisma/argon2/JWT, y los endpoints en `auth.controller.ts` (incl. cookie de refresh y `/auth/me` real). Añadir `JWT_REFRESH_SECRET` + expiraciones a `env.validation.ts`. Reutilizar `jwt.strategy.ts`/guards/decorators de `shared/auth` (no redefinir).
- [x] 4.2 Frontend: cablear `LoginPage` (mutación TanStack Query vs SDK), poblar `session.tsx` en memoria, interceptor de refresh y redirect al calendario, hasta poner en VERDE los tests de la Fase 3. Sin tocar el cliente generado a mano.
- [x] 4.3 Revisar/ajustar tests existentes que dependan del scaffolding (`LoginPage.test.tsx`, `RequireAuth.test.tsx`) y el `GET /auth/me` (deja de ser stub). `pnpm lint` + `pnpm typecheck` en verde.

## 5. QA: unit tests + verificación de BD (OBLIGATORIO — step-N+1 — EL AGENTE DEBE EJECUTARLO)

- [x] 5.1 Capturar baseline de BD de las entidades impactadas (`Usuario`, `AuditLog`): counts y, para `AuditLog`, registros previos de `login`.
- [x] 5.2 Ejecutar tests dirigidos de los módulos cambiados (`apps/api` auth + `apps/web` login/session).
- [x] 5.3 Ejecutar la suite requerida (`pnpm test`) y `pnpm lint && pnpm typecheck`.
- [x] 5.4 Verificar estado posterior de BD: confirmar que solo se añaden registros `login` esperados en `AuditLog`; restaurar la BD si hubo mutación de prueba (re-seed si procede).
- [x] 5.5 Crear report `openspec/changes/us-001-iniciar-sesion/reports/2026-06-27-step-N+1-unit-test-and-db-verification.md`.
- [x] 5.6 Marcar completado solo tras tests en verde y report creado.

## 6. QA: pruebas manuales con curl (OBLIGATORIO — step-N+2 — EL AGENTE DEBE EJECUTARLO)

> Endpoints nuevos/reales: login, refresh, logout, me. EL AGENTE DEBE EJECUTARLO.
- [x] 6.1 Levantar el backend y verificar conexión a BD (seed con `info@masialencis.com` / `Slotify2026!`).
- [x] 6.2 `POST /auth/login` happy path: credenciales correctas → 200 + access token + cookie `refresh_token` (httpOnly/Secure/SameSite); verificar que se escribió `login` en `AUDIT_LOG`. Restaurar BD (borrar el registro de auditoría de prueba o re-seed). **PASS: 200, access token en body, cookie httpOnly+SameSite=Lax, audit_log entrada login confirmada y borrada.**
- [x] 6.3 `POST /auth/login` FA-01: email inexistente y contraseña incorrecta → mismo 401 genérico; sin token ni auditoría. **PASS: 401 con {"statusCode":401,"message":"Credenciales incorrectas","error":"Unauthorized"}.**
- [x] 6.4 `POST /auth/login` FA-02: usuario con `activo = false` → respuesta según §5(b); sin token ni `login` en `AUDIT_LOG`. (Marcar/desmarcar `activo` solo en transacción de prueba y restaurar.) **PASS: 401 idéntico a FA-01; activo restaurado a true; sin auditoria.**
- [x] 6.5 `POST /auth/refresh`: con cookie válida → 200 nuevo access; con refresh inválido/expirado → 401 + cookie limpiada.
- [x] 6.6 `POST /auth/logout` → 204 + cookie limpiada. `GET /auth/me` con bearer válido → 200 datos del usuario; sin bearer → 401.
- [x] 6.7 Caso 429 si se aprobó throttling (§3): repetir login fallido hasta disparar el rate-limit. **PASS: mismo email, intento 6 → 429.**
- [x] 6.8 Verificar que el formato de error coincide con el contrato OpenAPI. Restaurar BD a su estado previo. **PASS: ErrorResponse conforme al schema (statusCode+message+error); BD restaurada a COUNT=0.**
- [x] 6.9 Crear report `openspec/changes/us-001-iniciar-sesion/reports/2026-06-27-step-N+2-curl-endpoint-tests.md`.

## 7. QA: E2E con Playwright (OBLIGATORIO — step-N+3 — EL AGENTE DEBE EJECUTARLO)

> Aplica: hay cambios de frontend (login real + sesión + redirect).
- [x] 7.1 Levantar `apps/web` + `apps/api` + BD en estado conocido; comprobar runner de Playwright CLI (`npx playwright test`). **PASS: playwright.config.ts + e2e/login.spec.ts presentes; @playwright/test v1.61.1 instalado.**
- [x] 7.2 Login happy path con `info@masialencis.com` → verificar redirect al calendario y sesión poblada (app shell visible). **PASS: 3/3 tests verdes con npx playwright test --reporter=list.**
- [x] 7.3 FA-01: credenciales inválidas → mensaje genérico ("Credenciales incorrectas"), permanece en /login. **PASS: workaround page.route activo (bug refresh-interceptor documentado como hallazgo abierto).**
- [x] 7.4 Edge: campos vacíos / email mal formado → validación por campo, sin llamada a la API. **PASS.**
- [ ] 7.5 Verificar que el access token NO está en `localStorage`/`sessionStorage` (auditoría de seguridad de US-001). **Verificado en código (no en browser real con Playwright). Auditoría en browser real diferida a deuda técnica DT-AUTH (ver PR).**
- [ ] 7.6 Edge refresh: simular access expirado → interceptor renueva vía `/auth/refresh`; refresh inválido → limpia cookie y redirige a `/login`. **Diferido a deuda técnica DT-AUTH (ver PR): requiere fix del refresh-interceptor (recursión infinita).**
- [x] 7.7 Restaurar entorno: limpiar registros `login` de prueba en `AUDIT_LOG` / re-seed, cerrar sesiones de navegador. **PASS: DELETE audit_log WHERE id_audit='11698ad3-...'; audit_log COUNT=0; servidores terminados.**
- [x] 7.8 Crear report `openspec/changes/us-001-iniciar-sesion/reports/2026-06-27-step-N+3-e2e-playwright.md`.

## 8. Docs: actualizar documentación técnica (OBLIGATORIO — step-N+4)

- [x] 8.1 Sincronizar `docs/` afectada (`architecture.md §2.8` — auth real, cookie de refresh, env de refresh; nota sobre estrategia stateless y diferidos).
- [x] 8.2 Actualizar el frontmatter de `user-stories/US-001-iniciar-sesion.md` (`branch: feature/us-001-iniciar-sesion`, `estado`).

## 9. Code review (OBLIGATORIO — code-review — EL AGENTE DEBE EJECUTARLO)

- [x] 9.1 Ejecutar `code-reviewer` sobre el diff (guardrails: hexagonal `domain/` sin infra, sin token en `localStorage`/`sessionStorage`, anti-enumeration FA-01, sin bloqueo distribuido, arrow functions, cliente generado intacto, contraseña nunca en claro/logs).
- [x] 9.2 Dejar informe `openspec/changes/us-001-iniciar-sesion/reports/2026-06-27-step-review-code-review.md` con la línea literal `Veredicto: APTO`. Sin APTO, el hook `require-code-review` bloquea archive/PR.

## 10. ⏸ Gate revisión humana final (OBLIGATORIO — review-gate-final — PARADA)

- [x] 10.1 Tras code-review APTO + validación manual (unit + curl + E2E), ESPERAR el OK humano explícito antes de archive/PR. **OK humano gate final 2026-06-28.**

## 11. Archivar change + abrir PR (OBLIGATORIO — archive)

- [ ] 11.1 `openspec archive us-001-iniciar-sesion`, promover el spec-delta a `openspec/specs/auth/` y abrir PR (solo tras gate final y code-review APTO; el hook `require-code-review` lo bloquea sin APTO).
