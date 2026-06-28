# Step N+3 — E2E con Playwright  (2026-06-27)

> Re-QA definitivo tras fix del controller y configuracion de Playwright.
> 3/3 casos en verde con `npx playwright test --reporter=list`.

## Entorno

- Frontend: `apps/web` con `pnpm --filter @slotify/web run dev` → http://localhost:5173
- Backend: `apps/api` con `pnpm --filter @slotify/api run dev` → http://localhost:3000
- DB: Docker `slotify-postgres` (baseline: audit_log=0, usuario activo=true)
- Playwright: `@playwright/test` v1.61.1 instalado en devDependencies raiz del monorepo
- Configuracion: `playwright.config.ts` en la raiz del monorepo (reuseExistingServer: true)
- Spec: `e2e/login.spec.ts` (3 casos)

## Playwright instalado y configurado

Infra Playwright presente en el repositorio:
```
/aplec/
  playwright.config.ts     — defineConfig con webServer (API :3000 + SPA :5173)
  e2e/
    login.spec.ts          — 3 tests de US-001
```

`package.json` raiz:
```json
"devDependencies": {
  "@playwright/test": "^1.61.1"
}
```

Comando de ejecucion:
```
cd /aplec && npx playwright test --reporter=list
```

## Resultado de ejecucion

```
Running 3 tests using 1 worker

  OK  1 [chromium] › e2e/login.spec.ts:22:7 › US-001 — Iniciar Sesion › login correcto redirige a /calendario con sesion activa (398ms)
  OK  2 [chromium] › e2e/login.spec.ts:39:7 › US-001 — Iniciar Sesion › credenciales invalidas muestran error generico y permanecen en /login (351ms)
  OK  3 [chromium] › e2e/login.spec.ts:95:7 › US-001 — Iniciar Sesion › validacion de formulario en cliente — campos vacios y email invalido no llaman a la API (313ms)

  3 passed (1.5s)
```

Resultado: 3/3 PASS.

## Escenarios verificados

### Test 1 — Login correcto → redirect a /calendario con sesion activa (PASS)

Flujo:
1. `page.goto('/login')`.
2. Fill `#email` con `info@masialencis.com`.
3. Fill `#password` con `Slotify2026!`.
4. Click `button[type="submit"]`.
5. `page.waitForURL('**/calendario', { timeout: 10_000 })`.

Verificaciones:
- URL contiene `/calendario`. PASS.
- `<aside>` visible (AppShell activo). PASS.
- Link `Calendario` visible en sidebar. PASS.

Nota audit_log: el login del test genero 1 entrada `accion=login` en audit_log
(`id_audit=11698ad3-1921-49c5-91b0-c6fda95373c4`), borrada en la fase de restauracion.

### Test 2 — Credenciales invalidas → error generico, permanece en /login (PASS)

Workaround activo (bug conocido — ver seccion de hallazgos):
```javascript
await page.route('**/auth/refresh', async (route) => {
  await route.fulfill({ status: 200, contentType: 'application/json',
    body: JSON.stringify({ accessToken: 'stub-refresh-workaround', usuario: {...} }) });
});
```

Flujo:
1. `page.goto('/login')`.
2. Fill email correcto + password incorrecto.
3. Click submit.
4. Esperar `role=alert` visible.

Verificaciones:
- Alerta visible. PASS.
- Texto contiene "Credenciales incorrectas" (respuesta real de la API: 401 con message correcto). PASS.
- Texto NO contiene "cuenta no existe", "email no registrado" ni "inactiv" (anti-enum). PASS.
- URL sigue en `/login`. PASS.

La peticion a `/auth/login` llega al servidor REAL (no mockeada) y devuelve 401 autentico.

### Test 3 — Validacion cliente: campos vacios y email invalido no llaman a la API (PASS)

Flujo:
1. Interceptar `**/auth/login` (detecta si se llama).
2. Submit con formulario vacio → mensajes de error de campo presentes.
3. Fill email invalido + password → submit → mensaje "Introduce un email valido" presente.

Verificaciones:
- "El email es obligatorio" visible tras submit vacio. PASS.
- "La contrasena es obligatoria" visible tras submit vacio. PASS.
- "Introduce un email valido" visible con email mal formado. PASS.
- API NO llamada en ninguno de los subcasos. PASS.

## Hallazgo abierto — Bug en `refresh-interceptor.ts` (NO resuelto en este loop)

**Fichero afectado**: `apps/web/src/auth/refresh-interceptor.ts`

**Descripcion**:
El middleware `crearMiddlewareRefresh` intercepta TODOS los 401, incluyendo los 401 que
devuelve el propio endpoint `/api/auth/refresh` cuando la cookie de refresh es invalida o
esta ausente. Esto genera una cadena de reintentos infinita:

```
401 de /auth/login
  → interceptor llama refrescar() → POST /auth/refresh
    → 401 de /auth/refresh (sin cookie)
      → interceptor vuelve a llamar refrescar() → POST /auth/refresh
        → 401 ... (recursion indefinida)
```

**Impacto en produccion**: el `onError` de la mutacion de login (en `LoginPage`) nunca
se dispara porque el interceptor entra en loop antes de propagar el error al caller.

**Impacto en el test 2**: el spec usa `page.route('**/auth/refresh', ...)` como workaround
para romper el ciclo. La peticion a `/auth/login` es REAL pero `/auth/refresh` esta mockeada
para devolver 200. Esto ENMASCARA el bug en el test E2E: el escenario pasa, pero la
experiencia real en browser sin mock fallaria.

**Fix recomendado** (decision del humano, no implementado en este QA):
En `crearMiddlewareRefresh`, excluir el endpoint `/auth/refresh` de la logica de reintento:

```typescript
onResponse: async ({ request, response }) => {
  if (response.status !== 401) return undefined;
  // Excluir el propio endpoint de refresh para evitar recursion infinita
  if (request.url.includes('/auth/refresh')) return undefined;
  const renovada = await refrescar();
  if (!renovada) onSesionExpirada();
  return undefined;
},
```

Adicionalmente se podria excluir `/auth/login` (un 401 de login nunca debe desencadenar
un refresh automatico).

**Estado**: PENDIENTE. Deuda a decidir por el humano antes del cierre del PR.

**Escenarios afectados que quedan sin cobertura real** (requieren fix del interceptor):
- 7.6 Refresh edge: simular access expirado → interceptor renueva; refresh invalido → limpia cookie y redirige a /login.

## Restauracion tras E2E

- Audit_log: entrada `login` del test 1 borrada (`DELETE WHERE id_audit='11698ad3-...'`).
- BD final verificada: `audit_log` COUNT=0, `usuario` activo=true.
- Servidores API (puerto 3000) y web (puerto 5173) terminados.

## Comparacion BD pre/post

| tabla     | pre E2E | post E2E | restaurado                          |
|-----------|---------|----------|-------------------------------------|
| audit_log | 0       | 1        | si (DELETE 1 registro login del test 1) |
| usuario   | 1 (t)   | 1 (t)    | n/a (sin mutacion)                  |

## Outcome

PASS (con hallazgo abierto documentado)

- 3/3 tests E2E verdes con `@playwright/test` CLI.
- Bug del `refresh-interceptor.ts` documentado como hallazgo abierto pendiente (deuda tecnica); no bloquea el PASS de los 3 casos verificados.
- Escenario 7.6 (refresh edge completo en browser) queda fuera de cobertura hasta resolver el hallazgo.

---

## Actualizacion 2026-06-28 — Limpieza workaround E2E + re-validacion sin mock

### Contexto

El bug de recursion infinita en `refresh-interceptor.ts` ha sido corregido. El workaround
`page.route('**/auth/refresh', ...)` del test 2 ya no es necesario y enmascaraba el flujo
real del navegador.

### Fix implementado en `apps/web/src/auth/refresh-interceptor.ts`

Se añadio la guarda que corta la recursion en `onResponse`:

```typescript
// Corta la recursion: un 401 del propio /auth/refresh NO debe reintentar
// refrescar. Se deja fluir el fallo tal cual.
if (request?.url?.includes('/auth/refresh')) {
  return undefined;
}
```

Los 401 provenientes de `/auth/refresh` ya no disparan un nuevo intento de refresh.
El error se propaga directamente al caller (la mutacion de login), que invoca `onError`
y muestra el mensaje de error en la UI.

### Cambios en `e2e/login.spec.ts`

**Eliminado del test 2** (credenciales invalidas):
- El bloque completo `page.route('**/auth/refresh', async (route) => { ... })` (17 lineas).
- El comentario JSDoc que documentaba el workaround y el bug conocido.
- El comentario de cabecera "NOTA BUG CONOCIDO" que referenciaba el bug.

**Test 2 actualizado**: valida el flujo REAL del navegador sin ningun mock de `/auth/refresh`.
Ambas peticiones (`/auth/login` y cualquier intento de `/auth/refresh`) llegan al servidor real.
El interceptor corregido no entra en recursion; el 401 de login se propaga a la UI y aparece
la alerta "Credenciales incorrectas".

No se anadieron mocks nuevos. El test 3 conserva su `page.route('**/auth/login', ...)` de
deteccion (es parte de la logica del caso, no un workaround).

### Re-ejecucion E2E (2026-06-28) — SIN mock `/auth/refresh`

Entorno:
- BD baseline: audit_log=0, usuario activo=true (verificado antes de levantar servidores).
- API: `pnpm --filter @slotify/api run dev` → http://localhost:3000/api/health OK.
- Web: http://localhost:5173 (ya en marcha, reuseExistingServer=true).

```
Running 3 tests using 1 worker

  ✓  1 [chromium] › e2e/login.spec.ts:16:7 › US-001 — Iniciar Sesion › login correcto redirige a /calendario con sesion activa (543ms)
  ✓  2 [chromium] › e2e/login.spec.ts:33:7 › US-001 — Iniciar Sesion › credenciales invalidas muestran error generico y permanecen en /login (327ms)
  ✓  3 [chromium] › e2e/login.spec.ts:59:7 › US-001 — Iniciar Sesion › validacion de formulario en cliente — campos vacios y email invalido no llaman a la API (379ms)

  3 passed (3.1s)
```

Resultado: **3/3 PASS** sin el mock. El test 2 valida el flujo real del navegador.

### Restauracion BD tras re-ejecucion

- Entrada `login` del test 1: `id_audit=6b240841-ad02-4ac6-bf8d-a5fb0c09015a`, borrada.
- `DELETE FROM audit_log WHERE id_audit='6b240841-ad02-4ac6-bf8d-a5fb0c09015a';` → DELETE 1.
- BD verificada post-restauracion: `audit_log` COUNT=0, `usuario` activo=true.

| tabla     | pre E2E | post E2E | restaurado                               |
|-----------|---------|----------|------------------------------------------|
| audit_log | 0       | 1        | si (DELETE 1 registro login del test 1)  |
| usuario   | 1 (t)   | 1 (t)    | n/a (sin mutacion)                       |

### No-regresion (2026-06-28)

**Web unit tests** (`npx vitest run` desde `apps/web`):
```
Test Files  10 passed (10)
      Tests  31 passed (31)
   Duration  1.17s
```
PASS. 31/31 incluyendo `refresh-interceptor.test.ts` (3 tests) y
`refresh-interceptor.recursion.test.ts` (2 tests).

**API tests** (`pnpm test` desde raiz via turbo):
```
Test Suites: 28 passed, 28 total
Tests:       130 passed, 130 total
Time:        5.894 s
```
PASS. 130/130 sin regresion. Arch check: `no dependency violations found (105 modules, 244 dependencies cruised)`.

**Lint web** (`pnpm lint` desde `apps/web`): PASS, 0 errores, 0 warnings.

**Lint API** (`pnpm lint` desde `apps/api`): PASS, 0 errores, 0 warnings.

**Typecheck web** (`pnpm typecheck` desde `apps/web`): PASS, 0 errores de tipo.

**Typecheck API** (`pnpm typecheck` desde `apps/api`): PASS, 0 errores de tipo.

### Hallazgo abierto — CERRADO

El bug de recursion infinita en `refresh-interceptor.ts` documentado en la ejecucion de
2026-06-27 ha sido corregido. El workaround del test 2 ha sido eliminado. El flujo real
es ahora testeable y esta en verde.

Escenario 7.6 (refresh edge: access expirado → renovacion automatica; refresh invalido →
limpia cookie y redirige a /login) queda pendiente de test E2E dedicado en una US futura.

### Outcome 2026-06-28

**PASS**

- 3/3 E2E verdes sin mock de `/auth/refresh`.
- 31/31 web unit (vitest). 130/130 API (jest). Arch check limpio.
- Lint PASS en ambas apps. Typecheck PASS en ambas apps.
- BD restaurada a baseline (audit_log=0, usuario activo=true).
