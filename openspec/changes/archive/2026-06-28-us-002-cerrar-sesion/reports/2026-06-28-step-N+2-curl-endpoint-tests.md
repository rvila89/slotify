# Step N+2 — Pruebas Manuales con curl — POST /auth/logout
**Change:** us-002-cerrar-sesion
**Date:** 2026-06-28
**Ejecutado por:** qa-verifier

Credenciales seed: `info@masialencis.com` / `Slotify2026!`
Backend corriendo en `http://localhost:3000`

---

## Baseline BD pre-curl

| Entidad   | accion  | Count |
|-----------|---------|-------|
| AuditLog  | login   | 16    |
| AuditLog  | logout  | 6     |
| Total     |         | 22    |

---

## 6.1 — Login previo (obtener cookie de refresh)

```bash
curl -s -c cookies.txt \
  -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"info@masialencis.com","password":"Slotify2026!"}' \
  -D login_headers.txt
```

**Response status:** 200 OK

**Response body:**
```json
{
  "accessToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIwMDAwMDAwMC0wMDAwLTAwMDAtMDAwMC0wMDAwMDAwMDAwMDIiLCJ0ZW5hbnRJZCI6IjAwMDAwMDAwLTAwMDAtMDAwMC0wMDAwLTAwMDAwMDAwMDAwMSIsInJvbCI6Imdlc3RvciIsImVtYWlsIjoiaW5mb0BtYXNpYWxlbmNpcy5jb20iLCJpYXQiOjE3ODI2NTA5NDksImV4cCI6MTc4MjY1MTg0OX0...",
  "usuario": {
    "idUsuario": "00000000-0000-0000-0000-000000000002",
    "email": "info@masialencis.com",
    "nombre": "Roger",
    "apellidos": "Vila",
    "rol": "gestor"
  }
}
```

**Set-Cookie response header:**
```
Set-Cookie: refresh_token=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...; Max-Age=604800; Path=/api/auth; Expires=Sun, 05 Jul 2026 12:49:09 GMT; HttpOnly; SameSite=Lax
```

---

## 6.2 — Happy path: POST /auth/logout con cookie válida

```bash
curl -sv -X POST http://localhost:3000/api/auth/logout \
  -H "Cookie: refresh_token=${REFRESH_JWT}"
```

**Response:**
```
< HTTP/1.1 204 No Content
< Set-Cookie: refresh_token=; Path=/api/auth; Expires=Thu, 01 Jan 1970 00:00:00 GMT; HttpOnly; SameSite=Lax
```

**Verificación contrato:**
- Status: 204 ✓ (coincide con spec OpenAPI: `POST /auth/logout → 204`)
- Set-Cookie: limpia la cookie (`Expires=1970`, vacía) ✓
- httpOnly: sí ✓
- SameSite: Lax (dev) ✓

**Verificación AUDIT_LOG post-logout:**
```json
{
  "idAudit": "b4faa3c9-78df-4a37-889b-5179d7026249",
  "tenantId": "00000000-0000-0000-0000-000000000001",
  "usuarioId": "00000000-0000-0000-0000-000000000002",
  "entidad": "Usuario",
  "entidadId": "00000000-0000-0000-0000-000000000002",
  "accion": "logout",
  "fechaCreacion": "2026-06-28T12:49:28.274Z"
}
```

Convención `entidad='Usuario'` / `entidadId=usuarioId` — coincide con la decisión §3 del gate. ✓

---

## 6.3 — Idempotencia: logout sin cookie (doble logout)

```bash
curl -sv -X POST http://localhost:3000/api/auth/logout
```

**Response:**
```
< HTTP/1.1 204 No Content
< Set-Cookie: refresh_token=; Path=/api/auth; Expires=Thu, 01 Jan 1970 00:00:00 GMT; HttpOnly; SameSite=Lax
```

**Verificación:**
- Status: 204 (NO 401) ✓
- Cookie limpiada (incluso sin cookie) ✓
- AUDIT_LOG count: 7 (sin nuevo entry) ✓ — no audita cuando no hay usuario identificable

---

## 6.4 — Idempotencia: logout con token inválido/expirado

```bash
curl -sv -X POST http://localhost:3000/api/auth/logout \
  -H "Cookie: refresh_token=invalid.jwt.token.that.will.fail"
```

**Response:**
```
< HTTP/1.1 204 No Content
< Set-Cookie: refresh_token=; Path=/api/auth; Expires=Thu, 01 Jan 1970 00:00:00 GMT; HttpOnly; SameSite=Lax
```

**Verificación:**
- Status: 204 ✓ (no 401)
- Cookie limpiada ✓
- AUDIT_LOG count: 7 (sin nuevo entry) ✓

---

## 6.5 — Access token expirado + refresh válido

Login previo para obtener nuevo refresh token. Logout con cookie válida pero Authorization con access inválido.

```bash
curl -sv -X POST http://localhost:3000/api/auth/logout \
  -H "Cookie: refresh_token=${REFRESH_JWT_2}" \
  -H "Authorization: Bearer expired.access.token.invalid"
```

**Response:**
```
< HTTP/1.1 204 No Content
< Set-Cookie: refresh_token=; Path=/api/auth; Expires=Thu, 01 Jan 1970 00:00:00 GMT; HttpOnly; SameSite=Lax
```

**Verificación:**
- Status: 204 ✓
- Cookie limpiada ✓
- AUDIT_LOG count: 8 (nuevo entry con usuarioId/tenantId del refresh) ✓
- Identifica correctamente por el refresh, ignora el access inválido ✓

---

## AUDIT_LOG: estado post-curl

| Entidad   | accion  | Count | Delta desde baseline |
|-----------|---------|-------|----------------------|
| AuditLog  | login   | 18    | +2 (dos logins de test) |
| AuditLog  | logout  | 8     | +2 (happy path + expired-access) |
| Total     |         | 26    | +4 |

---

## Restauración de BD

**Intento de restauración BLOQUEADO** por la política de sandbox (clasificado como "audit tampering"). Los 2 entries de logout de prueba (creados a partir de 12:48:00Z) no pudieron eliminarse programáticamente.

**Acción necesaria (manual):**
```sql
-- Eliminar los 2 entries de logout de prueba del QA
DELETE FROM audit_log
WHERE accion = 'logout'
  AND fecha_creacion > '2026-06-28T12:48:00Z';
-- 2 rows

-- Eliminar los 2 entries de login de prueba del QA
DELETE FROM audit_log
WHERE accion = 'login'
  AND fecha_creacion > '2026-06-28T12:48:00Z';
-- 2 rows
```

O re-seed completo: `pnpm --filter @slotify/api prisma db seed`

---

## Resumen de verificaciones contra contrato OpenAPI

| Caso                                    | Status esperado | Status obtenido | Set-Cookie limpia | AUDIT_LOG |
|-----------------------------------------|-----------------|-----------------|-------------------|-----------|
| Logout con refresh válido               | 200/204         | 204 ✓           | Sí ✓              | Sí ✓      |
| Logout sin cookie                       | 200/204 (no 401)| 204 ✓           | Sí ✓              | No ✓      |
| Logout con token inválido/expirado      | 200/204 (no 401)| 204 ✓           | Sí ✓              | No ✓      |
| Logout con access expirado, refresh OK  | 200/204         | 204 ✓           | Sí ✓              | Sí ✓      |

---

## Outcome

**OUTCOME: PASS** — Los 4 casos del contrato funcionan correctamente. La restauración de BD queda pendiente de acción manual.
