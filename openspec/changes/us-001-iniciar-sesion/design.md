# Design — us-001-iniciar-sesion

Decisiones técnicas no triviales de la autenticación. La implementación la ejecuta
`backend-developer` ∥ `frontend-developer` (con el contrato del `contract-engineer`
como frontera) tras el **Gate SDD**. Stack: `architecture.md §2`, hexagonal-ddd.
Convierte el scaffolding de US-000A en implementación real (no lo recrea).

## 1. Módulo auth hexagonal (backend)

Se completa `apps/api/src/auth/` respetando la arquitectura hexagonal (el hook
`no-infra-in-domain` bloquea imports de framework/infra en `domain/`).

- **domain/**
  - `usuario.entity.ts` — entidad/representación del `Usuario` autenticable (sin
    contraseña en claro), invariante `activo`.
  - `usuario-repository.port.ts` — puerto: `buscarPorEmail(email, tenantId?)`.
  - `audit-log.port.ts` — puerto de auditoría (`registrar(accion, …)`); ver §5.
  - `password-hasher.port.ts` — puerto de verificación de hash (argon2), para no
    acoplar el dominio a la librería.
  - `token-emitter.port.ts` — puerto de emisión de access/refresh tokens.
- **application/**
  - `login.use-case.ts` — orquesta: buscar usuario → comprobar `activo` →
    verificar hash → emitir tokens → registrar `login` en `AUDIT_LOG`. Aplica la
    anti-enumeration (FA-01) y el rechazo de cuenta deshabilitada (FA-02).
  - `refresh.use-case.ts` — valida refresh y emite nuevo access.
  - `logout.use-case.ts` — limpia la sesión de refresh (alcance según §3).
  - `obtener-usuario-actual.use-case.ts` — resuelve `/auth/me` real.
- **infrastructure/**
  - `usuario.prisma.adapter.ts` — adapter del repositorio (Prisma).
  - `argon2-password-hasher.adapter.ts` — verificación argon2 (coherente con el
    seed que ya hashea con argon2).
  - `jwt-token-emitter.adapter.ts` — emisión con `@nestjs/jwt` (access; refresh
    según §3).
- **interface/**
  - `auth.controller.ts` — añade `POST /auth/login` (`@Public`), `/auth/refresh`,
    `/auth/logout`, y **convierte** el `GET /auth/me` stub en su versión real. La
    cookie de refresh se setea/limpia aquí (capa de framework, no en dominio).

> **TDD primero** (hook `require-tests-first`): `login.use-case.ts` y las entidades
> exigen su test hermano antes de implementar. Foco de tests: FA-01 (respuesta
> uniforme), FA-02 (sin token ni auditoría), happy path (audita), refresh inválido.

## 2. Estrategia JWT y guards (ya en scaffolding)

`apps/api/src/shared/auth/jwt.strategy.ts` ya valida el access token con payload
`{sub, tenantId, rol, email}`; `jwt-auth.guard.ts`/`roles.guard.ts` y los
decorators `current-user`/`roles`/`public` ya existen. US-001 **los reutiliza**:
no se redefine la estrategia. El `login.use-case` produce el payload que la
estrategia consume. El aislamiento multi-tenant/RLS se resuelve leyendo `tenantId`
del token (no consulta BD por petición).

## 3. Tokens y cookie de refresh

- **Access token**: JWT firmado con `JWT_ACCESS_SECRET`, expiración
  `JWT_ACCESS_EXPIRES_IN` (~15 min). Ya configurado en `auth.module.ts`. Se
  devuelve en el body (`LoginResponse.accessToken`) y vive **solo en memoria** del
  frontend.
- **Refresh token**: cookie `refresh_token` con `httpOnly + Secure + SameSite`,
  vida ~7 días. **Requiere** añadir `JWT_REFRESH_SECRET` (min 32) y la expiración
  de refresh a `env.validation.ts` (hoy solo valida el access) y registrar un
  segundo secreto/opciones en el `JwtModule` o un signer dedicado.
- **Estrategia stateless vs stateful** → **decisión §2 del `proposal.md`**
  (recomendado stateless sin rotación para US-001). Con stateless, `logout` borra
  la cookie pero no invalida un token ya copiado; el riesgo se acota por la vida
  corta del access. La opción stateful (modelo `SesionRefresh` en Prisma, rotación)
  queda diseñada pero **diferida** (habilita logout/FA-03 reales en US-002+).

## 4. Frontend: mutación, sesión en memoria e interceptor

- `LoginPage.tsx` pasa del submit STUB (`console.info`) a una **mutación TanStack
  Query** contra el SDK generado (`apps/web/src/api-client/`, `openapi-fetch`).
  El cliente HTTP **no se edita a mano** (hook `protect-generated-client`): si el
  contrato cambia, se regenera con `pnpm generate-client`.
- `session.tsx` (SessionProvider/useSession) pasa de contrato a **poblar la sesión
  real** en memoria (access token + datos de `/auth/me`), nunca en
  `localStorage`/`sessionStorage`. El guard `RequireAuth.tsx` (US-000A) la consume.
- **Validación por campo** (email/contraseña vacíos, email mal formado) bloquea el
  submit antes de llamar a la API (TanStack Forms / shadcn).
- **Interceptor de refresh**: ante 401 por access expirado, intenta
  `POST /auth/refresh`; si falla, limpia sesión + cookie y redirige a `/login`.
- **Redirect**: login exitoso → calendario (respetando el `state.from` que
  `RequireAuth` preserva).
- Tests existentes `LoginPage.test.tsx` y `RequireAuth.test.tsx` se revisan/amplían.

## 5. Auditoría: puerto compartido (decisión §6)

Recomendado **extraer un `AuditLogPort`** común a partir de
`apps/api/src/reservas/infrastructure/audit-log.prisma.adapter.ts`, con el puerto
en un dominio compartido y un único adapter Prisma reutilizado por auth y reservas.
El enum `AccionAudit` ya incluye `login`/`logout`, así que auth solo invoca el
puerto. Fallback: adapter propio de auth si la extracción resulta invasiva.

## 6. Contrato OpenAPI (lo decide el contract-engineer tras el gate)

El contrato ya define login/refresh/logout/me, `securitySchemes`
(bearerAuth/cookieAuth/cronToken) y schemas `LoginRequest`/`LoginResponse`/
`Usuario`. Gaps a cerrar (decisión §5 del `proposal.md`): (a) posible **429** en
`/auth/login` si se adopta throttling (§3 del proposal); (b) código de FA-02
(401 genérico recomendado vs 403). Este change **no edita** `docs/api-spec.yml`.

## 7. Decisiones de alcance abiertas (resumen — detalle en proposal.md)

| # | Decisión | Recomendación |
|---|----------|---------------|
| §1 | Alcance vertical (slice completo vs solo backend) | **Slice completo** |
| §2 | Refresh stateless vs stateful con rotación | **Stateless** (stateful diferido) |
| §3 | Brute-force: throttler IP+email vs lockout vs nada | **`@nestjs/throttler`** (→ 429) |
| §4 | Multi-device FA-03 | **Diferir** (coexisten en silencio) |
| §5 | Gaps de contrato (429 / 401-vs-403 / congelar) | **429 si §3; 401 genérico; congelar el resto** |
| §6 | Auditoría: puerto compartido vs adapter propio | **Extraer `AuditLogPort` compartido** |

> Todas quedan **pendientes del OK humano** en el Gate SDD; no se cierran aquí.

## 8. Fuera de alcance (anti-scope)

- UI de registro/gestión de usuarios; roles operativos múltiples; recuperación o
  cambio de contraseña; MFA. (Fuente: `US-001 §Supuestos`, `§Notas de alcance`.)
- Refresh stateful con rotación e invalidación real (§2-B) y lockout por cuenta
  (§3-B): diseñados, diferidos.
- Flujo interactivo de FA-03 (§4-B).
- Edición manual del cliente HTTP generado o de `docs/api-spec.yml`.
