# Design — us-002-cerrar-sesion

Decisiones técnicas no triviales del cierre de sesión. La implementación la ejecuta
`backend-developer` ∥ `frontend-developer` (con el contrato del `contract-engineer`
como frontera) tras el **Gate SDD**. Endurece el `logout` best-effort de US-001 (no
lo recrea) y cablea el cierre de sesión del frontend. Stack: `architecture.md §2.8`,
hexagonal-ddd.

## 1. Por qué este change necesita diseño

US-002 es talla XS funcionalmente, pero arrastra **tres tensiones no triviales** que
deben resolverse en el gate antes de implementar, porque cambian la forma del
contrato y el alcance:

1. La ficha pide invalidación server-side ("0 tokens reutilizables") pero US-001
   adoptó refresh **stateless** (§2 abajo / `proposal §1`).
2. El contrato actual de `/auth/logout` (`cookieAuth` estricto, solo 204) **choca**
   con la idempotencia exigida para el doble logout (§3 abajo / `proposal §2`).
3. La interacción **idempotencia ↔ auditoría obligatoria**: cuándo se escribe (y
   cuándo no) en `AUDIT_LOG` (§4 abajo).

## 2. Invalidación del refresh: best-effort sobre el stateless de US-001

US-001 emite el refresh como JWT **stateless** en cookie `httpOnly` y no mantiene
registro de sesiones. Por tanto el logout, hoy, solo puede **limpiar la cookie**:

- **Recomendación (proposal §1-A): mantener best-effort.** `logout.use-case.ts`
  identifica al usuario verificando el refresh token de la cookie y ordena al
  controlador limpiar la cookie. No hay invalidación criptográfica del token; el
  riesgo residual (token ya copiado) está acotado por: cookie `httpOnly` (no robable
  por XSS) + TTL de refresh (~7 días) + access de vida corta (~15 min).
- **Alternativa diferida (proposal §1-B): stateful.** Denylist de refresh por `jti`
  o modelo `SesionRefresh` en Prisma + verificación en `/auth/refresh`. Habilita el
  global logout. Coste: nuevo modelo + migración + cambio en el use-case de refresh.
  Diferida como deuda técnica, coherente con `US-001 proposal §2`.
- **Acceso tras logout (regla de validación 3):** el access token previo **no se
  revoca**; caduca por TTL. El frontend garantiza la pérdida de acceso borrándolo de
  memoria. No se construye blocklist de access tokens en MVP.

> Esta decisión está **abierta al gate** por el conflicto literal con el criterio de
> éxito de la ficha. Si el humano exige B, el alcance crece más allá de XS.

## 3. Backend: endurecer `logout.use-case` (hexagonal)

Se completa el módulo `auth` existente (`apps/api/src/auth/`) sin recrearlo. El hook
`no-infra-in-domain` mantiene `domain/` libre de framework/infra; el hook
`require-tests-first` exige test hermano de `logout.use-case.ts` antes de tocarlo.

- **application/`logout.use-case.ts`**: pasa de "limpiar cookie" a:
  1. Identificar al usuario desde el refresh token (verificación del JWT de refresh).
  2. Si hay usuario identificable → registrar `logout` vía `AuditLogPort` compartido.
  3. Devolver siempre una señal de éxito idempotente (limpiar cookie), tanto si había
     usuario como si no (token ausente/expirado/inválido). **Nunca lanza error** por
     ausencia o invalidez del refresh.
- **interface/`auth.controller.ts`**: el endpoint **tolera la cookie ausente o
  inválida** y responde 200/204 limpiando la cookie (set-cookie expirada). La
  decisión de relajar el guard `cookieAuth` a "cookie opcional" se refleja en el
  contrato (§3 / `proposal §2`). La cookie se limpia íntegramente en esta capa
  (framework), nunca en dominio.
- **AuditLogPort compartido**: se reutiliza `shared/audit/audit-log.port.ts` y su
  adapter Prisma (extraídos en US-001); el enum `AccionAudit` ya incluye `logout`.
  La inserción ocurre bajo el contexto RLS del tenant (`tenant_id` del token).

## 4. Idempotencia ↔ auditoría: matriz de comportamiento

| Estado del refresh en la petición | Identifica usuario | Respuesta | `AUDIT_LOG` |
|-----------------------------------|--------------------|-----------|-------------|
| Válido                            | Sí                 | 200/204 + limpia cookie | **Sí** (`logout`) |
| Expirado / inválido / ausente     | No                 | 200/204 + limpia cookie | **No** |

- "El `AUDIT_LOG` registra el intento **solo si hay usuario identificable**"
  (`US-002 §Edge case sesión ya inválida`). La obligatoriedad de auditar
  (`§Reglas de Validación` 2) aplica a "todo logout **procesado** por el servidor",
  es decir, a los cierres con usuario identificable; el doble logout sin usuario es
  idempotente y silencioso.
- **No-anonimato**: el endpoint nunca recibe un `usuario_id` de destino; opera solo
  sobre la cookie del llamante. Por construcción no puede cerrar sesiones ajenas, sin
  necesidad de un guard que rechace al anónimo (lo que rompería la idempotencia).
- **Campos del registro (`proposal §3`)**: reutilizar la convención de `login` de
  US-001 — `entidad = 'USUARIO'`, `entidad_id = usuario_id` — para auditar el ciclo
  login→logout por usuario. A ratificar en el gate.

## 5. Frontend: mutación de logout, limpieza de sesión y degradado

El app shell (US-000A) y la sesión en memoria (`session.tsx`, US-001) ya existen; se
cablea el cierre:

- **Opción "Cerrar sesión"** en el área de usuario del header / pie del sidebar del
  `AppShell`. Regla dura responsive (`CLAUDE.md`): visible y accionable también en el
  **drawer móvil** (`<lg`), sin overflow horizontal, objetivo táctil accesible.
  Ubicación exacta contra Figma si hay frame (`proposal §4`).
- **Mutación TanStack Query** contra el SDK generado (`apps/web/src/api-client/`). El
  cliente HTTP **no se edita a mano** (hook `protect-generated-client`); si el
  contrato cambia, se regenera con `pnpm generate-client`.
- **Happy path**: éxito → `session.tsx` limpia access token + datos de usuario
  (memoria, nunca storage) → redirige a `/login`.
- **Degradado por red** (`US-002 §Edge case error de red`): `onError` de red → limpia
  igualmente la sesión de memoria + muestra **aviso** (toast/alert shadcn) → el
  usuario queda sin acceso en el cliente. El refresh en cookie caduca por TTL.
- **Rutas protegidas**: al vaciarse la sesión, el guard `RequireAuth` (US-000A)
  redirige a `/login` cualquier acceso por URL a rutas protegidas. No requiere código
  nuevo de guard; se verifica en E2E.

## 6. Contrato OpenAPI (lo decide el contract-engineer tras el gate)

`POST /auth/logout` ya existe (`docs/api-spec.yml`): `security: [cookieAuth]`,
respuesta 204. Gaps a cerrar (`proposal §2`):
- (a) Documentar **idempotencia**: 200/204 también con cookie ausente/expirada.
- (b) Relajar `security` a **cookie opcional** (o documentar que la ausencia de cookie
  no produce 401), para no romper la idempotencia del doble logout.
- (c) Aclarar en la descripción la semántica **no-anónima** (solo cierra la sesión
  propia) y que el access token no se revoca activamente.
Este change **no edita** `docs/api-spec.yml`.

## 7. Decisiones de alcance abiertas (resumen — detalle en proposal.md)

| # | Decisión | Recomendación |
|---|----------|---------------|
| §1 | Invalidación refresh: best-effort (stateless) vs stateful real | **Best-effort** (stateful diferido) — abierta por conflicto con criterio de éxito |
| §2 | Contrato logout: `cookieAuth` estricto vs idempotente (cookie opcional) | **Idempotente / cookie opcional** |
| §3 | Campos `entidad`/`entidad_id` del `AUDIT_LOG` de logout | **`'USUARIO'` / `usuario_id`** (convención de `login`) |
| §4 | Ubicación de "Cerrar sesión" en el frontend | **Header / pie del sidebar**, responsive en drawer móvil |

> Todas quedan **pendientes del OK humano** en el Gate SDD; no se cierran aquí.

## 8. Fuera de alcance (anti-scope)

- Global logout / invalidación multi-dispositivo; UI de gestión de sesiones activas.
  (`US-002 §Notas de alcance`.)
- Revocación activa del access token (blocklist de access JWT).
- Invalidación stateful real del refresh (modelo `SesionRefresh` / denylist):
  diseñada, diferida desde US-001 §2.
- Edición manual del cliente HTTP generado o de `docs/api-spec.yml`.
