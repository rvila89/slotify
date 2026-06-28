# Change: us-001-iniciar-sesion

## Why

US-001 entrega la **autenticación real** del gestor: la primera puerta de acceso
a la fuente única de verdad. Resuelve **D1** (la fuente única de verdad no puede
ser alterada por actores no autorizados): sin login, cualquier agente externo
podría mutar el estado de las reservas, violando la integridad del single source
of truth. (Fuente: `US-001 §Historia`, `§Contexto de Negocio`, UC-01.)

US-000A (ya archivada) dejó el **scaffolding** de auth como contrato sin
implementación, esperando explícitamente esta US:

- Backend `apps/api/src/auth/`: `auth.module.ts` (JwtModule + PassportModule con
  solo `JWT_ACCESS_SECRET`/`JWT_ACCESS_EXPIRES_IN`), `interface/auth.controller.ts`
  con **solo** `GET /auth/me` (stub que devuelve el payload del JWT). Carpetas
  `domain/`, `application/`, `infrastructure/` vacías (`.gitkeep`).
- `apps/api/src/shared/auth/`: `jwt.strategy.ts`, `usuario-autenticado.ts`,
  `jwt-auth.guard.ts`, `roles.guard.ts`, decorators `current-user`/`roles`/`public`.
- Prisma: modelos `Usuario` y `AuditLog` **completos**; enum `AccionAudit` ya con
  `login`/`logout`; enum `Rol = gestor|admin|operario`.
- Seed: Tenant + Usuario gestor con hash **argon2** (`info@masialencis.com` /
  `Slotify2026!`).
- Frontend: `LoginPage.tsx` (UI completa, submit STUB con `console.info`),
  `session.tsx` (SessionProvider/useSession, solo contrato), `RequireAuth.tsx`
  (guard) y cliente HTTP generado en `apps/web/src/api-client/`.

Este change convierte ese scaffolding en implementación real: **no recrea ni
duplica** ninguno de esos artefactos, los completa.

(Fuente: scaffolding US-000A; `architecture.md §2.8`; `er-diagram §3.3, §3.17`.)

## What Changes

> Alcance propuesto: **slice vertical completo** (backend + contrato + frontend).
> Sujeto al **Gate de revisión humana SDD** (ver "Decisiones de alcance" abajo).

- **Login real** (`POST /auth/login`, ruta pública): valida `email` + `password`
  contra el `passwordHash` argon2 de `Usuario` dentro del `tenant_id`, emite un
  **access token JWT** de vida corta (~15 min) con `{sub, tenantId, rol, email}`
  en el payload, establece el **refresh token** (~7 días) en cookie
  `httpOnly + Secure + SameSite`, y registra el evento `login` en `AUDIT_LOG`.
  (Fuente: `US-001 §Happy Path`, `§Reglas de negocio`; `architecture.md §2.8`.)
- **Anti-enumeration (FA-01)**: credenciales inválidas (email inexistente o
  contraseña que no casa) devuelven un **401 genérico** uniforme, sin distinguir
  qué campo falla (OWASP A01). (Fuente: `US-001 §FA-01`.)
- **Cuenta deshabilitada (FA-02)**: si `Usuario.activo = false` no se emite token
  ni se registra `login`; se informa de la cuenta deshabilitada. El **código de
  estado** (401 genérico vs 403 informativo) es una **decisión abierta** (ver §5).
  (Fuente: `US-001 §FA-02`.)
- **Refresh** (`POST /auth/refresh`, cookie `refresh_token`): renueva el access
  token; refresh expirado/inválido → **401 + limpia la cookie**; el frontend
  redirige al login. (Fuente: `US-001 §Edge case refresh`.)
- **Logout** (`POST /auth/logout` → 204): limpia la cookie de refresh. El alcance
  de invalidación real depende de la estrategia de refresh (ver §2).
- **`GET /auth/me` real**: pasa de stub a leer el `Usuario` autenticado y
  devolver `{idUsuario, email, nombre, apellidos?, rol}`. (Fuente: contrato actual.)
- **Auditoría del login**: todo login exitoso escribe `AUDIT_LOG` (postcondición
  de UC-01). Se reutiliza/extrae el patrón de `audit-log.prisma.adapter.ts` de
  reservas (decisión menor, ver §6). (Fuente: `US-001 §Reglas de Validación`;
  `er-diagram §3.17`.)
- **Frontend**: cablear `LoginPage` (mutación TanStack Query contra el SDK
  generado), poblar la **sesión en memoria** (sin `localStorage`/`sessionStorage`),
  validación por campo (email/contraseña vacíos o email mal formado bloquean el
  submit antes de llamar a la API), interceptor de refresh y **redirect al
  calendario** tras login. (Fuente: `US-001 §Happy Path`, `§Edge cases`;
  `architecture.md §2.8`.)
- **Config/env**: añadir validación de `JWT_REFRESH_SECRET` (min 32) y
  expiraciones de refresh en `env.validation.ts` (hoy solo existe la del access).

## Impact

- Specs afectadas: **nueva capability `auth`** (autenticación transversal del
  backend + wiring de sesión del frontend). No modifica `foundation`,
  `app-shell`, `bloqueo-fecha` ni `calculo-tarifa`.
- Contrato OpenAPI (`docs/api-spec.yml`): ya define en borrador
  `POST /auth/login`, `/auth/refresh`, `/auth/logout`, `GET /auth/me`,
  `securitySchemes` (bearerAuth/cookieAuth/cronToken) y schemas `LoginRequest`/
  `LoginResponse`/`Usuario`. Este change **no edita** el contrato: lo evolucionará
  el `contract-engineer` tras el gate (gaps en §5). Cambios candidatos: posible
  **429** (throttling) y decisión 401-vs-403 en login.
- Código afectado (implementación posterior, fuera de este change de spec):
  `apps/api/src/auth/{domain,application,infrastructure,interface}/**`,
  `apps/api/src/shared/auth/jwt.strategy.ts`, `auth.module.ts`,
  `apps/api/src/config/env.validation.ts`; `apps/web/src/pages/LoginPage.tsx`,
  `apps/web/src/auth/session.tsx`, interceptor/cliente del SDK.
- Trazabilidad: **US-001**, **UC-01**; entidades `USUARIO`, `TENANT`, `AUDIT_LOG`.
- Dependencias: **US-000A** (app shell + scaffolding de auth, ya archivada);
  el guard `RequireAuth` consume la sesión que esta US puebla.

## Lo que NO entra (anti-scope)

- UI de registro, alta o gestión de usuarios (MVP: 1 gestor por tenant por seed).
  (Fuente: `US-001 §Supuestos`, `architecture.md §2.8`.)
- Roles múltiples operativos (admin-tenant, operario) más allá del enum existente
  — `📐 Solo diseñado`, fuera del MVP. (Fuente: `US-001 §Notas de alcance`.)
- Recuperación / cambio de contraseña, verificación de email, MFA.
- Flujo interactivo de multi-device "informar + dos opciones" de FA-03 (ver §4).
- Política de lockout por cuenta tras N intentos (no hay contador en el schema;
  ver §3).

## Decisiones de alcance pendientes de aprobación humana

> Cada decisión lleva una **recomendación argumentada**, pero queda **abierta**
> hasta el OK del Gate SDD. No se cierran unilateralmente.

### §1 — Alcance vertical: slice completo vs solo backend
- **Opción A (recomendada): slice completo** backend + contrato + frontend (login
  real, refresh, logout, `/auth/me` real, mutación TanStack Query, sesión en
  memoria, interceptor de refresh, redirect).
- Opción B: solo backend + contrato, difiriendo el wiring frontend a otra US.
- **Recomendación: A.** US-000A dejó `LoginPage`/`session` como stubs explícitos
  esperando US-001; US-001 es el spine de la autenticación (fan-out alto: habilita
  toda pantalla autenticada). Partir el slice dejaría la app sin login funcional y
  obligaría a un segundo change solo de wiring. Riesgo de A: mayor superficie de
  QA (incluye E2E Playwright); se mitiga con el contrato como frontera back/front.

### §2 — Refresh token: stateless vs stateful con rotación
- **Opción A: refresh JWT stateless sin rotación.** Más simple; `logout` solo
  borra la cookie (no invalida el token de verdad si fue copiado); FA-03 real no
  es posible (no hay registro de sesiones).
- **Opción B: refresh stateful hasheado en BD con rotación e invalidación.**
  Requiere **nuevo modelo Prisma** (p. ej. `SesionRefresh`/`RefreshToken`);
  habilita logout real (US-002) y FA-03 (cerrar sesión anterior) reales.
- **Recomendación: A para US-001**, con B explícitamente diferido. `architecture
  §2.8` permite empezar simple. Implicación para **US-002 (logout)**: con A el
  logout es "best-effort" (borra cookie; el access caduca solo en ~15 min); el
  logout con invalidación real se reabre cuando se adopte B. Implicación para
  **FA-03**: con A, las sesiones multi-device coexisten en silencio (ver §4).

### §3 — Brute-force / rate-limiting
- **Opción A: rate-limiting genérico por IP+email con `@nestjs/throttler`** en
  `/auth/login`, difiriendo el lockout por cuenta.
- Opción B: lockout por cuenta tras N intentos — requiere **cambio de schema**
  (contador + `bloqueadoHasta` en `Usuario`).
- Opción C: nada en US-001.
- **Recomendación: A.** Mitiga brute-force sin tocar el schema y respeta la
  anti-enumeration. **Implicación de contrato**: si se adopta A, `/auth/login`
  necesita documentar un **429**. La ficha deja la política de lockout
  "configurable y no fijada por la spec" (`US-001 §Notas de alcance`), por lo que
  B queda fuera.

### §4 — Sesión múltiple / multi-device (FA-03)
- **Opción A (recomendada): diferir.** Las sesiones multi-device coexisten en
  silencio. Encaja con el refresh stateless de §2-A. El criterio BDD de FA-03 se
  documenta en el spec-delta como **diferido** (no implementado en US-001).
- Opción B: implementar "informar + dos opciones (continuar / cerrar la anterior)"
  — requiere registro de sesiones activas y depende de §2-B.
- **Recomendación: A.** La ficha marca FA-03 "sujeto a decisión de sprint"
  (`US-001 §Notas de alcance`); B arrastra §2-B (nuevo modelo) y encarece el MVP.

### §5 — Contrato: gaps a cerrar antes de congelar
- **(a) 429 en `/auth/login`**: añadir si se adopta §3-A (throttling). Decisión
  ligada a §3.
- **(b) FA-02 cuenta deshabilitada — 401 genérico vs 403 informativo**: la ficha
  pide "mensaje informando de que la cuenta está deshabilitada"
  (`US-001 §FA-02`), lo que **tensiona** con la anti-enumeration de FA-01 (un 403
  distinguible revela que el email existe). **Recomendación: 401 genérico** en la
  respuesta de API (no revela enumeración) y mensaje de cuenta deshabilitada
  manejado solo cuando la cuenta es legítimamente del usuario (decisión a
  ratificar por el humano por el conflicto seguridad vs UX).
- **(c) ¿congelar login/refresh/logout/me tal cual?** Recomendación: congelar el
  contrato actual salvo los cambios de (a) y (b); el `contract-engineer` aplica el
  delta fino tras el gate.

### §6 — Auditoría: puerto compartido vs adapter propio
- **Opción A (recomendada): extraer un `AuditLogPort` compartido** a partir de
  `apps/api/src/reservas/infrastructure/audit-log.prisma.adapter.ts`, para que
  auth (y futuros módulos) registren acciones sin duplicar adapter.
- Opción B: auth escribe su propio adapter Prisma de auditoría.
- **Recomendación: A** (DRY + hexagonal: un puerto en dominio compartido, un
  adapter en infraestructura). Decisión arquitectónica menor; si la extracción
  resultara invasiva para reservas, se acepta B como fallback.
