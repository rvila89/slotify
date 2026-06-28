# Change: us-002-cerrar-sesion

## Why

US-002 entrega el **cierre de sesión explícito** del gestor: la contrapartida de
US-001 que cierra el ciclo de vida de la sesión. Resuelve **D1** (proteger la
fuente única de verdad): sin un logout fiable, una sesión abierta en un dispositivo
compartido o desatendido deja la puerta abierta a mutaciones no autorizadas del
estado de reservas, presupuestos y facturas del tenant. (Fuente: `US-002 §Historia`,
`§Contexto de Negocio` D1, UC-02.)

US-001 (ya archivada) dejó un `POST /auth/logout` **best-effort**: limpia la cookie
de refresh y responde 204, **sin auditar** y **sin garantías de idempotencia**. La
estrategia de refresh adoptada en US-001 fue **stateless** (sin registro de sesiones
en BD); la invalidación real server-side se documentó como diferida (`US-001
proposal §2`). US-002 endurece ese logout para cumplir las postcondiciones de UC-02:

- El logout **siempre** registra `AUDIT_LOG` con `accion = logout` cuando hay un
  usuario identificable (postcondición de UC-02 paso 4; `er-diagram §3.17`).
- El logout es **idempotente**: un doble logout (cookie ya invalidada/expirada)
  responde 200/204 sin error.
- El logout es **no anónimo**: no puede usarse para invalidar la sesión de otro
  usuario (solo actúa sobre la propia cookie del llamante).
- El **frontend** cablea la opción "Cerrar sesión" del app shell (US-000A): llama al
  endpoint, limpia el access token de memoria, redirige al login y degrada con
  aviso ante error de red.

(Fuente: `US-002 §Reglas de negocio`, `§Reglas de Validación`, `§Edge cases`;
`architecture.md §2.8`; `er-diagram §3.17`; `data-model.md §3.17`.)

## What Changes

> Alcance propuesto: **slice vertical** (backend + contrato + frontend). Sujeto al
> **Gate de revisión humana SDD** (ver "Decisiones de alcance" abajo).

- **Logout auditado** (`POST /auth/logout`): identifica al usuario desde el refresh
  token de la cookie `httpOnly`, limpia la cookie y, cuando el usuario es
  identificable, registra `AUDIT_LOG` con `accion = logout`, `usuario_id` y
  `tenant_id` (bajo contexto RLS del tenant). El access token **no se revoca de
  forma activa**: expira por su TTL natural (~15 min) y el frontend lo elimina de
  memoria. (Fuente: `US-002 §Happy Path`, `§Reglas de Validación`; UC-02 paso 4.)
- **Idempotencia** (edge case "logout doble"): un segundo logout con refresh
  expirado/invalidado/ausente responde 200/204 sin error y limpia cualquier cookie;
  el `AUDIT_LOG` se registra **solo si hay usuario identificable** en el token.
  (Fuente: `US-002 §Edge case sesión ya inválida`.)
- **No anónimo** (regla de validación): el endpoint actúa únicamente sobre la cookie
  de refresh del propio llamante; no acepta un identificador de usuario de destino,
  por lo que estructuralmente no puede invalidar sesiones ajenas. (Fuente:
  `US-002 §Reglas de Validación` primera regla.)
- **Access token no revocado activamente** (regla de validación): tras el logout,
  el access token previo sigue siendo criptográficamente válido hasta su expiración
  (≤ 15 min); no se construye blocklist de access tokens en el MVP. (Fuente:
  `US-002 §Reglas de Validación` tercera regla; `architecture.md §2.8`.)
- **Frontend — cierre de sesión**: cablear la opción "Cerrar sesión" del app shell
  (US-000A) a una mutación contra el SDK generado; al completarse, **limpiar el
  access token y la sesión de memoria** (`session.tsx`) y **redirigir al login**.
  (Fuente: `US-002 §Happy Path`; `architecture.md §2.8`.)
- **Frontend — degradado ante error de red**: si la llamada a `/auth/logout` falla
  por red, el frontend **limpia igualmente** el access token de memoria, muestra un
  **aviso** y deja al gestor sin acceso efectivo en el cliente; el refresh en cookie
  caducará por su TTL (~7 días). (Fuente: `US-002 §Edge case error de red`.)
- **Frontend — rutas protegidas tras logout**: cualquier acceso por URL directa a
  una ruta protegida tras el cierre de sesión redirige al login sin exponer datos
  (lo garantiza el guard `RequireAuth` de US-000A al quedar la sesión vacía).
  (Fuente: `US-002 §Happy Path` 2º escenario.)

## Impact

- Specs afectadas: **capability `auth`** existente. Se **MODIFICA** el requisito
  "Logout limpia la sesión de refresh" (añade auditoría, idempotencia y no-anonimato)
  y se **AÑADEN** tres requisitos de frontend (cierre desde la SPA, degradado por
  red, rutas protegidas tras logout). No toca `foundation`, `app-shell`,
  `bloqueo-fecha` ni `calculo-tarifa`.
- Contrato OpenAPI (`docs/api-spec.yml`): `POST /auth/logout` ya existe (autenticado
  por `cookieAuth`, respuesta 204). Este change **no edita** el contrato: lo
  evolucionará el `contract-engineer` tras el gate. Cambios candidatos: documentar
  la **idempotencia** (200/204 también sin cookie válida) y la semántica no-anónima;
  decidir si `security` pasa de `cookieAuth` estricto a "cookie opcional" para no
  romper la idempotencia (gap §2). (Fuente: `docs/api-spec.yml /auth/logout`.)
- Entidad `AUDIT_LOG`: nuevo uso de `accion = logout` (el enum `AccionAudit` ya lo
  incluye; sin cambio de schema). Inserción bajo RLS con `tenant_id` del token.
  (Fuente: `er-diagram §3.17`, `data-model.md §3.17`.)
- Código afectado (implementación posterior, fuera de este change de spec):
  `apps/api/src/auth/application/logout.use-case.ts` (añade auditoría/idempotencia),
  `apps/api/src/auth/interface/auth.controller.ts` (tolerancia a cookie ausente),
  uso del `AuditLogPort` compartido (`shared/audit/`); `apps/web` — opción "Cerrar
  sesión" del app shell, mutación de logout, limpieza de `session.tsx`, manejo
  degradado.
- Trazabilidad: **US-002**, **UC-02**; entidades `USUARIO`, `AUDIT_LOG`.
- Dependencias: **US-001** (login real, cookie de refresh, `session.tsx`,
  `AuditLogPort` compartido) y **US-000A** (app shell + guard `RequireAuth`), ambas
  archivadas.

## Lo que NO entra (anti-scope)

- **Global logout / invalidación de todas las sesiones en otros dispositivos**:
  `📐 Solo diseñado` para post-MVP; requiere registro stateful de sesiones.
  (Fuente: `US-002 §Notas de alcance`, `§Reglas de negocio` MVP.)
- **UI de "gestión de sesiones activas"**: no existe en MVP. (Fuente:
  `US-002 §Notas de alcance`.)
- **Revocación activa del access token** (blocklist/denylist de access JWT): no se
  construye; el access caduca por TTL (~15 min). (Fuente: `US-002 §Reglas de
  Validación` tercera regla.)
- **Invalidación stateful real del refresh token** (modelo `SesionRefresh` /
  denylist server-side): diseñada y diferida desde US-001 §2 (ver decisión §1
  abajo); fuera de alcance salvo decisión humana en contra.

## Decisiones de alcance pendientes de aprobación humana

> Cada decisión lleva una **recomendación argumentada**, pero queda **abierta**
> hasta el OK del Gate SDD. No se cierran unilateralmente.

### §1 — Invalidación del refresh token: best-effort (stateless) vs stateful real
- **Tensión**: el criterio de éxito de la ficha pide "**0 tokens activos
  reutilizables tras logout (refresh token invalidado en servidor)**"
  (`US-002 §Impacto`), pero US-001 adoptó refresh **stateless** sin registro de
  sesiones, por lo que hoy el logout solo puede **limpiar la cookie** (best-effort):
  un refresh token ya copiado seguiría siendo válido hasta su TTL (~7 días).
- **Opción A (recomendada): mantener stateless / best-effort.** Logout = limpiar la
  cookie `httpOnly` + auditar. La cookie es `httpOnly` (no robable por XSS), el
  riesgo residual es acotado y la propia ficha lo documenta como "comportamiento
  degradado aceptable en MVP" en el edge case de error de red. No toca schema ni
  rendimiento. **Implica reinterpretar** el criterio de éxito como "la cookie de
  sesión del dispositivo queda limpiada" en vez de "invalidación criptográfica
  server-side".
- **Opción B: adoptar invalidación stateful** (denylist de refresh por `jti` o
  modelo `SesionRefresh` en Prisma + verificación en `/auth/refresh`). Cumple el
  criterio al pie de la letra y habilita el global logout futuro. Coste: **nuevo
  modelo Prisma + migración + verificación en refresh**; supera la talla **XS** de
  la US y reabre la decisión §2 de US-001.
- **Recomendación: A** para US-002 (coherente con el diferimiento explícito de
  US-001 §2 y con la talla XS), dejando B como deuda técnica diferida. **Requiere
  ratificación humana** por el conflicto literal con el criterio de éxito de la ficha.

### §2 — Contrato de `/auth/logout`: seguridad estricta vs idempotente
- **Tensión**: el contrato actual declara `security: [cookieAuth]` y única respuesta
  **204**. Un guard estricto de cookie haría **fallar con 401** un doble logout (la
  cookie ya fue limpiada), rompiendo la idempotencia que pide la ficha.
- **Opción A (recomendada): logout idempotente con cookie opcional.** El endpoint
  acepta la petición, identifica al usuario **si** hay refresh válido (entonces
  audita) y responde **204 siempre** (también con cookie ausente/expirada), sin
  auditar cuando no hay usuario identificable. El no-anonimato se preserva porque el
  endpoint nunca recibe un usuario de destino: solo actúa sobre la cookie propia.
  Contrato: documentar idempotencia y relajar `security` a cookie opcional.
- **Opción B: mantener `cookieAuth` estricto** → el doble logout devuelve 401. Choca
  con `US-002 §Edge case sesión ya inválida` ("responde 200 o 204 de forma
  idempotente, no devuelve error"). **Descartada salvo decisión humana.**
- **Recomendación: A.** El delta fino del contrato lo aplica el `contract-engineer`
  tras el gate.

### §3 — `AUDIT_LOG`: campos `entidad` / `entidad_id` del registro de logout
- `AUDIT_LOG` exige `entidad` (VARCHAR 50) y `entidad_id` (UUID) además de
  `accion`, `usuario_id`, `tenant_id` (`er-diagram §3.17`). La ficha solo fija
  `accion = logout`, `usuario_id`, `tenant_id`.
- **Recomendación**: reutilizar la convención del registro `login` de US-001
  (`entidad = 'USUARIO'`, `entidad_id = usuario_id`), por consistencia y para
  auditar el ciclo login→logout por usuario. Decisión menor; a ratificar para que
  el spec-delta cite la fuente exacta de la convención de `login`.

### §4 — Ubicación de la opción "Cerrar sesión" en el frontend
- El app shell de US-000A (sidebar 288px + header) es el contenedor natural del
  botón. **Recomendación**: situar "Cerrar sesión" en el área de usuario del header
  o pie del sidebar, **accesible y responsive** (regla dura mobile-first: visible y
  usable en el drawer móvil `<lg`). Decisión de UX menor; a confirmar la ubicación
  exacta contra el diseño de Figma si existe frame para ella.
