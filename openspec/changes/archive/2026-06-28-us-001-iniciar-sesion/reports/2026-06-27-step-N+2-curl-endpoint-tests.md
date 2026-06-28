# Step N+2 — Pruebas manuales con curl  (2026-06-27)

> Re-QA definitivo tras fix del controller (`try/catch` + `@HttpCode(HttpStatus.OK)`).
> Todos los casos que antes devolvian 500 o 201 ahora devuelven los codigos correctos.

## Entorno

- Backend iniciado con: `pnpm --filter @slotify/api run dev` (ts-node-dev, PID 46529)
- DB: Docker postgres:15 `slotify-postgres` (puerto 5432)
- `GET /api/health` → `{"status":"ok"}` confirmado antes de los tests
- Credenciales seed: `info@masialencis.com` / `Slotify2026!`
- Tests ejecutados mediante script Node.js (`node run-curl-tests.mjs`) + script fa02 + throttler independiente

## Baseline BD pre-tests

| tabla     | count | activo usuario |
|-----------|-------|----------------|
| audit_log | 0     | -              |
| usuario   | 1     | true           |

## Comandos ejecutados y respuestas

### 1. POST /api/auth/login — credenciales VALIDAS (happy path)

```
POST http://localhost:3000/api/auth/login
Content-Type: application/json
{"email":"info@masialencis.com","password":"Slotify2026!"}
```

Respuesta:
```
HTTP/1.1 200 OK
Set-Cookie: refresh_token=<JWT>; Max-Age=604800; Path=/api/auth; Expires=Sat, 04 Jul 2026...; HttpOnly; SameSite=Lax
Content-Type: application/json; charset=utf-8

{
  "accessToken": "<JWT>",
  "usuario": {
    "idUsuario": "00000000-0000-0000-0000-000000000002",
    "email": "info@masialencis.com",
    "nombre": "Roger",
    "apellidos": "Vila",
    "rol": "gestor"
  }
}
```

Observaciones:
- HTTP 200 (corregido: antes 201).
- ACCESS TOKEN en body. CORRECTO.
- REFRESH TOKEN en cookie `refresh_token` con flags `HttpOnly`, `SameSite=Lax`. CORRECTO.
- Flag `Secure` ausente en desarrollo HTTP (se activara en produccion con NODE_ENV=production). ESPERADO.
- AUDIT_LOG: entrada `login` registrada (verificada post-test).

### 2. POST /api/auth/login — email inexistente (FA-01)

```
POST http://localhost:3000/api/auth/login
{"email":"noexiste@test.com","password":"WrongPassword!"}
```

Respuesta:
```
HTTP/1.1 401 Unauthorized
Content-Type: application/json; charset=utf-8

{
  "statusCode": 401,
  "message": "Credenciales incorrectas",
  "error": "Unauthorized",
  "path": "/api/auth/login",
  "timestamp": "2026-06-27T17:57:23.594Z"
}
```

HTTP 401. Sin token. Sin auditoria. CORRECTO.

### 3. POST /api/auth/login — password incorrecto (FA-01b)

```
POST http://localhost:3000/api/auth/login
{"email":"info@masialencis.com","password":"WrongPassword123!"}
```

Respuesta:
```
HTTP/1.1 401 Unauthorized
{
  "statusCode": 401,
  "message": "Credenciales incorrectas",
  "error": "Unauthorized",
  "path": "/api/auth/login",
  "timestamp": "2026-06-27T17:57:23.619Z"
}
```

HTTP 401. Sin token. Sin auditoria. CORRECTO.
Anti-enumeration verificada: FA-01 y FA-01b producen el mismo `statusCode`, `message` y `error`. PASS.

### 4. POST /api/auth/login — cuenta con activo=false (FA-02)

```sql
-- Deshabilitar (transaccion puntual):
UPDATE usuario SET activo = false WHERE id_usuario = '00000000-0000-0000-0000-000000000002';
-- => UPDATE 1
```

```
POST http://localhost:3000/api/auth/login
{"email":"info@masialencis.com","password":"Slotify2026!"}
```

Respuesta:
```
HTTP/1.1 401 Unauthorized
{
  "statusCode": 401,
  "message": "Credenciales incorrectas",
  "error": "Unauthorized",
  "path": "/api/auth/login",
  "timestamp": "2026-06-27T17:58:49.827Z"
}
```

```sql
-- Restauracion inmediata:
UPDATE usuario SET activo = true WHERE id_usuario = '00000000-0000-0000-0000-000000000002';
-- => UPDATE 1; verificado: activo = t
```

HTTP 401 identico a FA-01 y FA-01b. Sin token. Sin auditoria (COUNT audit_log = 2, igual que antes del test FA-02).
Anti-enumeration total: los tres casos de fallo (email inexistente, password incorrecto, cuenta inactiva) producen exactamente el mismo status y cuerpo. PASS.

### 5. POST /api/auth/refresh — cookie valida

```
POST http://localhost:3000/api/auth/refresh
Cookie: refresh_token=<JWT-del-login>
```

Respuesta:
```
HTTP/1.1 200 OK
Content-Type: application/json; charset=utf-8

{ "accessToken": "<nuevo-JWT>", "usuario": { ... } }
```

HTTP 200 (corregido: antes 201). Nuevo access token emitido. CORRECTO.

### 6. POST /api/auth/refresh — token invalido/expirado

```
POST http://localhost:3000/api/auth/refresh
Cookie: refresh_token=invalid.token.here
```

Respuesta:
```
HTTP/1.1 401 Unauthorized
Set-Cookie: refresh_token=; Path=/api/auth; Expires=Thu, 01 Jan 1970 00:00:00 GMT; HttpOnly; SameSite=Lax

{
  "statusCode": 401,
  "message": "Sesion expirada o invalida",
  "error": "Unauthorized",
  "path": "/api/auth/refresh",
  "timestamp": "2026-06-27T17:57:23.623Z"
}
```

401 + cookie limpiada (expires epoch). CORRECTO.

### 7. POST /api/auth/logout

```
POST http://localhost:3000/api/auth/logout
Authorization: Bearer <access-token>
Cookie: refresh_token=<refresh-token>
```

Respuesta:
```
HTTP/1.1 204 No Content
Set-Cookie: refresh_token=; Path=/api/auth; Expires=Thu, 01 Jan 1970 00:00:00 GMT; HttpOnly; SameSite=Lax
```

204 + cookie limpiada. CORRECTO.

### 8. GET /api/auth/me — bearer valido

```
GET http://localhost:3000/api/auth/me
Authorization: Bearer <access-token>
```

Respuesta:
```
HTTP/1.1 200 OK
{
  "idUsuario": "00000000-0000-0000-0000-000000000002",
  "email": "info@masialencis.com",
  "nombre": "Roger",
  "apellidos": "Vila",
  "rol": "gestor"
}
```

200 con datos reales del usuario. CORRECTO.

### 9. GET /api/auth/me — sin token

```
GET http://localhost:3000/api/auth/me
```

Respuesta:
```
HTTP/1.1 401 Unauthorized
{
  "statusCode": 401,
  "message": "No autenticado: token ausente o invalido",
  "error": "Unauthorized",
  "path": "/api/auth/me",
  "timestamp": "..."
}
```

401. CORRECTO.

### 10. Rate limiting — 429 Throttler

Configuracion: 5 intentos por ventana de 60 000 ms (IP+email). Se usaron 6 intentos con el mismo email (`throttlertest@test.com`):

| Intento | HTTP Status |
|---------|-------------|
| 1       | 401         |
| 2       | 401         |
| 3       | 401         |
| 4       | 401         |
| 5       | 401         |
| 6       | 429         |

El intento 6 devuelve:
```
HTTP/1.1 429 Too Many Requests
{
  "message": "Demasiados intentos de inicio de sesion. Intentalo de nuevo mas tarde."
}
```

Throttler funciona correctamente. PASS.

Nota: en el test anterior (primer QA) se habia usado email diferente para cada intento, por lo que el throttler (clave IP+email) no se disparaba. Con el mismo email el 429 aparece en el intento 6, como se esperaba.

## AUDIT_LOG

Verificado via `docker exec ... psql`:

Registros generados durante los tests:
- `login` (de login exitoso en test 1): accion=login, usuario_id=00000000-...-0002, fecha=2026-06-27 17:57:23
- `logout` (de logout en test 7): accion=logout, usuario_id=00000000-...-0002, fecha=2026-06-27 17:57:23

Verificaciones:
- `login` registrado en login exitoso (correcto).
- `logout` registrado en logout (correcto).
- Ningun registro de `login` en intentos fallidos FA-01, FA-01b, FA-02, throttler (correcto: anti-enumeration).

## Conformidad ErrorResponse con contrato OpenAPI

Contrato (`docs/api-spec.yml`, `#/components/schemas/ErrorResponse`):
```yaml
required: [statusCode, message]
properties:
  statusCode: { type: integer }
  message: { oneOf: [string, array<string>] }
  error: { type: string }
```

Respuesta real de 401 (login invalido):
```json
{
  "statusCode": 401,
  "message": "Credenciales incorrectas",
  "error": "Unauthorized",
  "path": "/api/auth/login",
  "timestamp": "..."
}
```

Conformidad: PASS.
- `statusCode`: 401 (integer) — campo requerido presente.
- `message`: "Credenciales incorrectas" (string) — campo requerido presente.
- `error`: "Unauthorized" (string) — campo opcional presente.
- `path` y `timestamp`: campos extra del NestJS exception filter, no en el schema pero no invalidan la conformidad (OpenAPI no require exclusividad por defecto).

## Tabla de resultados

| Endpoint / Caso                               | Status esperado | Status obtenido    | Resultado |
|-----------------------------------------------|-----------------|--------------------|-----------|
| POST /auth/login credenciales validas         | 200             | 200                | PASS      |
| POST /auth/login email inexistente (FA-01)    | 401             | 401                | PASS      |
| POST /auth/login password incorrecto (FA-01b) | 401             | 401                | PASS      |
| POST /auth/login activo=false (FA-02)         | 401 = FA-01     | 401 = FA-01        | PASS      |
| Anti-enumeration FA-01 = FA-01b = FA-02       | mismo body      | mismo body         | PASS      |
| POST /auth/refresh valido                     | 200             | 200                | PASS      |
| POST /auth/refresh invalido/expirado          | 401 + cookie limpiada | 401 + cookie limpiada | PASS |
| POST /auth/logout                             | 204 + cookie limpiada | 204 + cookie limpiada | PASS |
| GET /auth/me con bearer valido               | 200 + datos usuario | 200 + datos usuario | PASS   |
| GET /auth/me sin token                        | 401             | 401                | PASS      |
| Rate limit (6o intento, mismo email)          | 429             | 429                | PASS      |
| AUDIT_LOG: login en login exitoso             | entrada login   | entrada login      | PASS      |
| AUDIT_LOG: logout en logout                   | entrada logout  | entrada logout     | PASS      |
| Sin audit en login fallido                    | sin entrada     | sin entrada        | PASS      |
| Conformidad ErrorResponse contrato OpenAPI    | schema valido   | schema valido      | PASS      |

## Comparacion BD pre/post

| tabla     | pre curl-tests | post curl-tests | restaurado                                           |
|-----------|----------------|-----------------|------------------------------------------------------|
| audit_log | 0              | 2               | si (DELETE 2 registros: login + logout del happy path) |
| usuario   | 1 (activo=t)   | 1 (activo=t)    | si (activo restaurado a true inmediatamente tras FA-02) |

Restauracion:
```sql
DELETE FROM audit_log WHERE id_audit IN (
  'ed5bffc6-7c7c-4645-8758-4e1451facdd4',  -- login del happy path
  '7153b309-b8a9-46a0-b33b-e78fdece57d0'   -- logout del test 7
);
-- resultado: DELETE 2

UPDATE usuario SET activo = true WHERE id_usuario = '00000000-0000-0000-0000-000000000002';
-- resultado: UPDATE 1 (inmediatamente tras test FA-02)
```

Estado final verificado: `audit_log` COUNT = 0, `usuario` activo = true.

## Restauracion

BD restaurada al baseline pre-tests:
- `audit_log`: COUNT = 0 (confirmado).
- `usuario` activo = true (confirmado).
- Proceso del servidor API terminado (`kill $(lsof -ti :3000)`).

## Outcome

PASS

Todos los casos pasan con los codigos HTTP correctos. El fix del controller (`try/catch` + `@HttpCode(HttpStatus.OK)`) resuelve los FAIL/WARN del QA anterior:
- Login valido: 201 → 200. RESUELTO.
- Login invalido (FA-01, FA-01b, FA-02): 500 → 401. RESUELTO.
- Refresh valido: 201 → 200. RESUELTO.

---

## Addendum 2026-06-28 — Re-QA Minimo de Confirmacion (cierre hallazgo Menor)

### Hallazgo cerrado

**Hallazgo Menor (code-review 2026-06-27):** El bloque `catch` amplio en `login()` y `refresh()` del controller enmascaraba errores de infraestructura inesperados como 401 en vez de permitir que el filtro global los convirtiera en 500. Un fallo de BD, por ejemplo, devolveria "Credenciales incorrectas" al cliente en lugar de un 500, ocultando el problema real.

**Fix aplicado:** El `catch` de `login()` se estrechó para traducir SOLO `CredencialesInvalidasError` → 401 y re-lanzar cualquier otro error. El `catch` de `refresh()` se estrechó para traducir SOLO el error de refresh invalido → 401 (con limpieza de cookie) y re-lanzar el resto (sin limpiar cookie, ya que es un fallo de infra, no de sesion).

**Test RED → GREEN:** Se añadio el caso "error de infra inesperado → 500" en `apps/api/src/auth/__tests__/auth.controller.http.spec.ts`. Suite completa api: 132/132 verde.

**Nota sobre el caso "fallo de infra → 500" via curl:** No se puede provocar con curl real sin derribar la BD; queda cubierto por el test de integracion HTTP (mock de `AuthService.login` que lanza `new Error('DB down')`) — no se ejecuto curl para este caso.

### Smoke curl ejecutado (2026-06-28)

Entorno: API ya en ejecucion (PID 25050, puerto 3000). DB: Docker `slotify-postgres`.

**Baseline BD pre-smoke:** `audit_log` COUNT = 0, `usuario` activo = true.

**Caso 1 — Credenciales validas → 200**

```
POST http://localhost:3000/api/auth/login
{"email":"info@masialencis.com","password":"Slotify2026!"}
```

Respuesta:
```
HTTP/1.1 200 OK
Set-Cookie: refresh_token=<JWT>; Max-Age=604800; Path=/api/auth; HttpOnly; SameSite=Lax
{"accessToken":"<JWT>","usuario":{"idUsuario":"00000000-0000-0000-0000-000000000002","email":"info@masialencis.com","nombre":"Roger","apellidos":"Vila","rol":"gestor"}}
```

PASS. 200. accessToken en body. refresh_token en cookie HttpOnly. Sin regresion.

**Caso 2 — Credenciales invalidas (email inexistente) → 401**

```
POST http://localhost:3000/api/auth/login
{"email":"noexiste@test.com","password":"WrongPassword!"}
```

Respuesta:
```
HTTP/1.1 401 Unauthorized
{"statusCode":401,"message":"Credenciales incorrectas","error":"Unauthorized","path":"/api/auth/login","timestamp":"2026-06-28T09:03:52.902Z"}
```

PASS. 401. Cuerpo "Credenciales incorrectas". Sin regresion.

**Caso 3 — Cuenta inactiva (activo=false) → 401 identico**

```sql
UPDATE usuario SET activo = false WHERE id_usuario = '00000000-0000-0000-0000-000000000002'; -- UPDATE 1
```

```
POST http://localhost:3000/api/auth/login
{"email":"info@masialencis.com","password":"Slotify2026!"}
```

Respuesta:
```
HTTP/1.1 401 Unauthorized
{"statusCode":401,"message":"Credenciales incorrectas","error":"Unauthorized","path":"/api/auth/login","timestamp":"2026-06-28T09:03:59.540Z"}
```

```sql
UPDATE usuario SET activo = true WHERE id_usuario = '00000000-0000-0000-0000-000000000002'; -- UPDATE 1 (restauracion inmediata)
```

PASS. 401 identico al caso 2. Anti-enumeration mantenida. Sin regresion.

### Estado BD post-smoke

audit_log generado por el login exitoso del caso 1: 1 entrada (id_audit=9bc5c05c-5ab6-4d49-bf39-f05e4e996c14, accion=login).

Restauracion:
```sql
DELETE FROM audit_log WHERE id_audit = '9bc5c05c-5ab6-4d49-bf39-f05e4e996c14'; -- DELETE 1
```

**Estado final verificado:** `audit_log` COUNT = 0, `usuario` activo = true. BD identica al baseline pre-smoke.

### Resultado re-QA

| Caso | Status esperado | Status obtenido | Resultado |
|------|-----------------|-----------------|-----------|
| Login credenciales validas | 200 + accessToken + cookie | 200 + accessToken + cookie | PASS |
| Login email inexistente | 401 "Credenciales incorrectas" | 401 "Credenciales incorrectas" | PASS |
| Login cuenta inactiva | 401 = invalido (anti-enum) | 401 = invalido (anti-enum) | PASS |
| Login fallo infra → 500 | cubierto por test unitario | cubierto por test unitario (132/132 verde) | PASS |

**Hallazgo Menor: CERRADO.** No hay regresion funcional. El estrechamiento del catch es transparente para clientes que envian credenciales validas o invalidas; solo modifica el comportamiento ante fallos de infra inesperados (ahora → 500 via filtro global, comportamiento correcto).
